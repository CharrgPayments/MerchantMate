// Referenced from blueprint: javascript_object_storage
import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class AccessDeniedError extends Error {
  constructor(message: string = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
    Object.setPrototypeOf(this, AccessDeniedError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  async getUploadUrl(
    storageKey: string,
    options?: {
      contentType?: string;
      ownerId?: string;
      acl?: string;
    }
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900
    });
  }

  async setFileAcl(
    storageKey: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<void> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    
    await setObjectAclPolicy(file, aclPolicy);
  }

  async getDownloadUrl(
    storageKey: string,
    options?: {
      userId?: string;
      acl?: string;
    }
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    
    // Verify ACL if userId is provided
    if (options?.userId) {
      const hasAccess = await canAccessObject({
        userId: options.userId,
        objectFile: file,
        requestedPermission: ObjectPermission.READ
      });
      
      if (!hasAccess) {
        throw new AccessDeniedError();
      }
    }
    
    return signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: 3600
    });
  }

  async deleteFile(storageKey: string): Promise<void> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    
    // Check if file exists before attempting delete
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    
    await file.delete();
  }

  /**
   * Save a buffer directly to object storage with ACL
   * @param storageKey The path/key under the private object directory
   * @param buffer The buffer content to save
   * @param options Optional metadata and ACL settings
   * @returns The full storage path where the file was saved
   */
  async saveBuffer(
    storageKey: string,
    buffer: Buffer,
    options?: {
      contentType?: string;
      ownerId?: string;
      visibility?: 'public' | 'owner-only' | 'custom';
    }
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    
    // Save the buffer to object storage
    await file.save(buffer, {
      contentType: options?.contentType || 'application/octet-stream',
      resumable: false,
    });
    
    // Set ACL policy if specified
    if (options?.ownerId || options?.visibility) {
      const aclPolicy: ObjectAclPolicy = {
        visibility: options?.visibility || 'owner-only',
        ownerId: options?.ownerId,
      };
      await setObjectAclPolicy(file, aclPolicy);
    }
    
    console.log(`Saved buffer to object storage: ${storageKey}`);
    return storageKey;
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

// Export singleton instance for use across the application
export const objectStorageService = new ObjectStorageService();
