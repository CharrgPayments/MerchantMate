import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { dbEnvironmentMiddleware, type RequestWithDB } from "../dbMiddleware";
import { isAuthenticated, requirePerm } from "../replitAuth";
import { ACTIONS } from "@shared/permissions";
import { insertExternalEndpointSchema } from "@shared/schema";
import { resolveSecrets, resolveSecretsDeep } from "../lib/resolveSecrets";

const AUTH_TYPES = ["none", "api_key", "bearer", "basic"] as const;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const baseEndpointSchema = insertExternalEndpointSchema.extend({
  name: z.string().min(1).max(255),
  url: z.string().url().max(2048),
  method: z.enum(HTTP_METHODS).default("POST"),
  authType: z.enum(AUTH_TYPES).default("none"),
  headers: z.record(z.string()).optional().nullable(),
  authConfig: z.record(z.any()).optional().nullable(),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
  maxRetries: z.number().int().min(0).max(10).default(0),
  retryDelaySeconds: z.number().int().min(0).max(600).default(5),
});

const updateEndpointSchema = baseEndpointSchema.partial();

const testSendSchema = z.object({
  url: z.string().url().max(2048).optional(),
  method: z.enum(HTTP_METHODS).optional(),
  headers: z.record(z.string()).optional(),
  authType: z.enum(AUTH_TYPES).optional(),
  authConfig: z.record(z.any()).optional(),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
  body: z.string().optional(),
  endpointId: z.number().int().positive().optional(),
});

/**
 * Apply auth_type + auth_config to an outgoing fetch by mutating headers /
 * URL parameters. Mirrors how the workflow runner historically attached creds.
 */
function applyAuth(
  authType: string,
  authConfig: Record<string, any>,
  headers: Record<string, string>,
  url: string,
): { headers: Record<string, string>; url: string } {
  switch (authType) {
    case "bearer": {
      const token = authConfig.token ?? authConfig.bearerToken;
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return { headers, url };
    }
    case "basic": {
      const username = authConfig.username ?? "";
      const password = authConfig.password ?? "";
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      return { headers, url };
    }
    case "api_key": {
      const placement = authConfig.in ?? "header";
      const name = authConfig.headerName ?? authConfig.name ?? "X-API-Key";
      const value = authConfig.value ?? authConfig.apiKey ?? "";
      if (!value) return { headers, url };
      if (placement === "query") {
        const sep = url.includes("?") ? "&" : "?";
        return { headers, url: `${url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}` };
      }
      headers[name] = value;
      return { headers, url };
    }
    default:
      return { headers, url };
  }
}

export function registerExternalEndpointsRoutes(app: Express) {
  // List
  app.get(
    "/api/external-endpoints",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const search = typeof req.query.search === "string" ? req.query.search : undefined;
        const isActiveRaw = req.query.isActive;
        const isActive =
          isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined;
        const rows = await storage.listExternalEndpoints({ search, isActive });
        res.json(rows);
      } catch (error: any) {
        console.error("[external-endpoints] list error", error);
        res.status(500).json({ message: "Failed to list external endpoints", error: error.message });
      }
    },
  );

  // Get one
  app.get(
    "/api/external-endpoints/:id",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
        const row = await storage.getExternalEndpoint(id);
        if (!row) return res.status(404).json({ message: "Endpoint not found" });
        res.json(row);
      } catch (error: any) {
        res.status(500).json({ message: "Failed to fetch external endpoint", error: error.message });
      }
    },
  );

  // Create
  app.post(
    "/api/external-endpoints",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const parsed = baseEndpointSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid endpoint payload", errors: parsed.error.flatten() });
        }
        const created = await storage.createExternalEndpoint({
          ...parsed.data,
          createdBy: req.currentUser?.id ?? null,
        });
        res.status(201).json(created);
      } catch (error: any) {
        console.error("[external-endpoints] create error", error);
        res.status(500).json({ message: "Failed to create external endpoint", error: error.message });
      }
    },
  );

  // Update
  app.put(
    "/api/external-endpoints/:id",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
        const parsed = updateEndpointSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid endpoint payload", errors: parsed.error.flatten() });
        }
        const updated = await storage.updateExternalEndpoint(id, parsed.data);
        if (!updated) return res.status(404).json({ message: "Endpoint not found" });
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: "Failed to update external endpoint", error: error.message });
      }
    },
  );

  // Delete
  app.delete(
    "/api/external-endpoints/:id",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
        const ok = await storage.deleteExternalEndpoint(id);
        if (!ok) return res.status(404).json({ message: "Endpoint not found" });
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ message: "Failed to delete external endpoint", error: error.message });
      }
    },
  );

  // Test send — performs a real outbound HTTP call but DOES NOT persist the
  // request, the response, or any execution log. Either pass an `endpointId`
  // to test a stored endpoint, or pass full transport fields inline to test
  // before saving.
  app.post(
    "/api/external-endpoints/test-send",
    isAuthenticated,
    dbEnvironmentMiddleware,
    requirePerm(ACTIONS.EXTERNAL_ENDPOINTS_MANAGE),
    async (req: RequestWithDB, res) => {
      try {
        const parsed = testSendSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid test payload", errors: parsed.error.flatten() });
        }

        let url: string | undefined = parsed.data.url;
        let method: string = parsed.data.method ?? "GET";
        let headers: Record<string, string> = { ...(parsed.data.headers ?? {}) };
        let authType: string = parsed.data.authType ?? "none";
        let authConfig: Record<string, any> = { ...(parsed.data.authConfig ?? {}) };
        let timeoutSeconds: number = parsed.data.timeoutSeconds ?? 30;
        const body = parsed.data.body;

        if (parsed.data.endpointId) {
          const stored = await storage.getExternalEndpoint(parsed.data.endpointId);
          if (!stored) return res.status(404).json({ message: "Endpoint not found" });
          url = url ?? stored.url;
          method = parsed.data.method ?? stored.method;
          headers = { ...((stored.headers ?? {}) as Record<string, string>), ...headers };
          authType = parsed.data.authType ?? stored.authType ?? "none";
          authConfig = { ...((stored.authConfig ?? {}) as Record<string, any>), ...authConfig };
          timeoutSeconds = parsed.data.timeoutSeconds ?? stored.timeoutSeconds ?? 30;
        }

        if (!url) return res.status(400).json({ message: "url is required" });

        // Resolve {{$SECRET}} placeholders in url, headers, and authConfig.
        try {
          url = resolveSecrets(url);
          headers = resolveSecretsDeep(headers);
          authConfig = resolveSecretsDeep(authConfig);
        } catch (secretErr: any) {
          return res.status(400).json({ message: secretErr.message });
        }

        const applied = applyAuth(authType, authConfig, headers, url);
        headers = applied.headers;
        url = applied.url;

        const finalHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...headers,
        };

        const fetchOptions: RequestInit = { method, headers: finalHeaders };
        if (method !== "GET" && method !== "HEAD" && body) {
          fetchOptions.body = body;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        fetchOptions.signal = controller.signal;

        const startTime = Date.now();
        let upstream: Response;
        try {
          upstream = await fetch(url, fetchOptions);
        } catch (err: any) {
          clearTimeout(timer);
          const elapsed = Date.now() - startTime;
          const aborted = err?.name === "AbortError";
          return res.status(200).json({
            success: false,
            elapsed,
            error: aborted ? `Request timed out after ${timeoutSeconds}s` : err.message,
          });
        }
        clearTimeout(timer);
        const elapsed = Date.now() - startTime;

        let data: any;
        const contentType = upstream.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            data = await upstream.json();
          } catch {
            data = { _raw: await upstream.text().catch(() => "") };
          }
        } else {
          const text = await upstream.text();
          // Cap response preview to keep payloads reasonable in the UI
          const preview = text.length > 4000 ? `${text.slice(0, 4000)}…[truncated]` : text;
          try {
            data = JSON.parse(preview);
          } catch {
            data = { _raw: preview };
          }
        }

        res.json({
          success: upstream.ok,
          status: upstream.status,
          statusText: upstream.statusText,
          elapsed,
          data,
        });
      } catch (error: any) {
        console.error("[external-endpoints] test-send error", error);
        res.status(500).json({ message: "Failed to test send", error: error.message });
      }
    },
  );
}
