import { storage } from "../storage";
import type { ExternalEndpoint } from "@shared/schema";
import { resolveSecrets, resolveSecretsDeep } from "./resolveSecrets";

export interface ResolvedTransport {
  url: string;
  method: string;
  headers: Record<string, string>;
  authType: string;
  authConfig: Record<string, any>;
  timeoutSeconds: number;
}

/**
 * Apply auth_type + auth_config to an outgoing fetch by mutating headers /
 * URL parameters. Mirrors how the workflow runner historically attached creds.
 */
export function applyAuth(
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
        return {
          headers,
          url: `${url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        };
      }
      headers[name] = value;
      return { headers, url };
    }
    default:
      return { headers, url };
  }
}

/**
 * Resolve transport details for a webhook action template:
 *   - If `endpointId` is set, load url/method/headers/auth from the
 *     external_endpoints registry.
 *   - Otherwise fall back to the legacy inline values in `config`.
 *
 * Returns the merged transport (still containing {{$SECRET}} placeholders;
 * call resolveSecrets/applyAuth afterward to finalize).
 */
export async function resolveTemplateTransport(template: {
  endpointId?: number | null;
  config: any;
}): Promise<{ transport: ResolvedTransport; endpoint: ExternalEndpoint | null }> {
  const cfg = (template.config || {}) as Record<string, any>;

  let endpoint: ExternalEndpoint | null = null;
  if (template.endpointId) {
    const stored = await storage.getExternalEndpoint(template.endpointId);
    if (!stored) {
      throw new Error(
        `Webhook template references endpoint id=${template.endpointId} which no longer exists`,
      );
    }
    endpoint = stored;
  }

  // Headers in the registry are stored as an object; in legacy inline config
  // they were stored as a JSON string. Normalize both to an object.
  const inlineHeaders: Record<string, string> = (() => {
    if (!cfg.headers) return {};
    if (typeof cfg.headers === "string") {
      try {
        return JSON.parse(cfg.headers) as Record<string, string>;
      } catch {
        return {};
      }
    }
    if (typeof cfg.headers === "object") return cfg.headers as Record<string, string>;
    return {};
  })();

  const transport: ResolvedTransport = endpoint
    ? {
        url: endpoint.url,
        method: endpoint.method ?? "POST",
        headers: { ...((endpoint.headers ?? {}) as Record<string, string>) },
        authType: endpoint.authType ?? "none",
        authConfig: { ...((endpoint.authConfig ?? {}) as Record<string, any>) },
        timeoutSeconds: endpoint.timeoutSeconds ?? 30,
      }
    : {
        url: cfg.url ?? "",
        method: cfg.method ?? "POST",
        headers: inlineHeaders,
        authType: cfg.authType ?? "none",
        authConfig: (cfg.authConfig ?? {}) as Record<string, any>,
        timeoutSeconds: cfg.timeoutSeconds ?? 30,
      };

  return { transport, endpoint };
}

/**
 * Final-stage helper: resolve {{$SECRET}} placeholders, apply auth, and merge
 * a default Content-Type. Returns the values you can pass directly to fetch().
 */
export function finalizeTransport(t: ResolvedTransport): {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutSeconds: number;
} {
  let url = resolveSecrets(t.url);
  let headers = resolveSecretsDeep(t.headers);
  const authConfig = resolveSecretsDeep(t.authConfig);
  const applied = applyAuth(t.authType, authConfig, headers, url);
  return {
    url: applied.url,
    method: t.method,
    headers: { "Content-Type": "application/json", ...applied.headers },
    timeoutSeconds: t.timeoutSeconds,
  };
}
