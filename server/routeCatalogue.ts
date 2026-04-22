import type { Express, RequestHandler } from "express";

export interface RouteCatalogueEntry {
  method: string;
  path: string;
  permission: string;
  permissionType: "session" | "action" | "permission" | "public";
  validated: boolean;
  schema?: string;
  internal: boolean;
  source?: string;
}

type TaggedHandler = RequestHandler & {
  __docPermission?: string;
  __docPermissionType?: "session" | "action" | "permission";
  __docInternal?: boolean;
  __docSchema?: string;
  __docValidated?: boolean;
  __docSource?: string;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function markInternal(): RequestHandler {
  const handler: TaggedHandler = (_req, _res, next) => next();
  handler.__docInternal = true;
  return handler;
}

export function markSchema(schemaName: string): RequestHandler {
  const handler: TaggedHandler = (_req, _res, next) => next();
  handler.__docSchema = schemaName;
  handler.__docValidated = true;
  return handler;
}

function regexpToPath(re: RegExp, mountFallback?: string): string {
  const src = re.source;
  // Common Express patterns:
  //   ^\/?(?=\/|$)               -> '' (root)
  //   ^\/api\/?(?=\/|$)          -> '/api'
  //   ^\/api\/dashboard\/?(?=\/|$)
  let s = src
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\?\(\?=\/\|\$\)$/, "")
    .replace(/\?\(\?=\/\|\$\)/, "")
    .replace(/\(\?:\/\(\?=\$\)\)\?$/, "")
    .replace(/\/\?$/, "");
  if (s === "" || s === "/") {
    return mountFallback ?? "";
  }
  return s;
}

function extractMetadata(handlers: TaggedHandler[]): {
  permission: string;
  permissionType: RouteCatalogueEntry["permissionType"];
  validated: boolean;
  schema?: string;
  internal: boolean;
} {
  let permission = "public";
  let permissionType: RouteCatalogueEntry["permissionType"] = "public";
  let validated = false;
  let schema: string | undefined;
  let internal = false;

  for (const h of handlers) {
    if (!h) continue;
    if (h.__docInternal) internal = true;
    if (h.__docSchema) {
      schema = h.__docSchema;
      validated = true;
    }
    if (h.__docValidated) validated = true;
    if (h.__docPermission) {
      // Action / permission middleware wins over session-only middleware so
      // a chain like [isAuthenticated, requirePerm('admin:manage')] reports
      // 'admin:manage'.
      const incomingType = h.__docPermissionType ?? "permission";
      const rank = (t: string) =>
        t === "public" ? 0 : t === "session" ? 1 : 2;
      if (rank(incomingType) >= rank(permissionType)) {
        permission = h.__docPermission;
        permissionType = incomingType;
      }
    }
  }

  return { permission, permissionType, validated, schema, internal };
}

interface WalkContext {
  prefix: string;
  source?: string;
  inherited: TaggedHandler[];
}

function isRootMatchingRegexp(re: RegExp): boolean {
  // Express's `app.use(fn)` / `router.use(fn)` (no path) produces a regexp
  // like /^\/?(?=\/|$)/i that matches every request. Path-scoped middleware
  // (`app.use("/api/foo", fn)`) produces a more specific regexp. We only
  // want to inherit the unconditional case.
  const src = re.source;
  return src === "^\\/?(?=\\/|$)" || src === "^\\/?$" || src === "^\\/?";
}

function walkStack(
  layers: any[],
  ctx: WalkContext,
  out: RouteCatalogueEntry[],
): void {
  // Walk in order so middleware registered earlier in the stack (e.g. via
  // `router.use(isAuthenticated)`) is inherited by every route registered
  // after it — mirroring Express's own dispatch order.
  let inherited = ctx.inherited;

  for (const layer of layers) {
    if (layer.route) {
      const routePath = layer.route.path as string | string[];
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      const stack = (layer.route.stack ?? []) as Array<{ handle: TaggedHandler; method?: string }>;
      const handlers = [...inherited, ...stack.map((s) => s.handle)];
      const meta = extractMetadata(handlers);

      for (const p of paths) {
        const fullPath = `${ctx.prefix}${p}`.replace(/\/+/g, "/");
        for (const method of HTTP_METHODS) {
          if (layer.route.methods?.[method]) {
            out.push({
              method: method.toUpperCase(),
              path: fullPath,
              permission: meta.permission,
              permissionType: meta.permissionType,
              validated: meta.validated,
              schema: meta.schema,
              internal: meta.internal,
              source: ctx.source,
            });
          }
        }
      }
      continue;
    }

    if (layer.name === "router" && layer.handle?.stack) {
      const mountPath = regexpToPath(layer.regexp, "");
      const childPrefix = `${ctx.prefix}${mountPath}`.replace(/\/+/g, "/");
      // Sub-routers inherit whatever middleware was already registered on
      // the parent, but they manage their own internal inheritance order.
      walkStack(
        layer.handle.stack,
        { prefix: childPrefix, source: ctx.source, inherited: [...inherited] },
        out,
      );
      continue;
    }

    // Plain middleware layer. If it was mounted unconditionally (no path),
    // every subsequent route in this stack inherits its tags.
    const handle = layer.handle as TaggedHandler | undefined;
    if (!handle) continue;
    const isUnconditional = layer.regexp ? isRootMatchingRegexp(layer.regexp) : true;
    if (isUnconditional) {
      inherited = [...inherited, handle];
    }
  }
}

export function buildRouteCatalogue(app: Express): RouteCatalogueEntry[] {
  const stack = (app as any)._router?.stack ?? [];
  const out: RouteCatalogueEntry[] = [];
  walkStack(stack, { prefix: "", inherited: [] }, out);
  // Stable sort: path, then method.
  out.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });
  return out;
}

// Routes whose path matches one of these patterns are treated as internal.
// Used as a safety net for routes registered by third-party libraries (e.g.
// Passport / OIDC) that we cannot annotate at the call site.
const INTERNAL_PATH_PATTERNS: RegExp[] = [
  /^\/api\/login(\/.*)?$/,
  /^\/api\/logout$/,
  /^\/api\/callback$/,
  /^\/api\/csrf-token$/,
  /^\/api\/auth\/check-username$/,
  /^\/api\/auth\/check-email$/,
  /^\/api\/auth\/verify-email$/,
  /^\/api\/testing(\/.*)?$/,
];

export function isInternalRoute(entry: RouteCatalogueEntry): boolean {
  if (entry.internal) return true;
  return INTERNAL_PATH_PATTERNS.some((re) => re.test(entry.path));
}

export function publicRouteCatalogue(app: Express): RouteCatalogueEntry[] {
  return buildRouteCatalogue(app).filter((e) => !isInternalRoute(e));
}

// Auto-grouping: bucket by the second URL segment so the frontend can render
// the catalogue with the same section/jump-nav UX without a hand-curated list.
export interface RouteCatalogueSection {
  id: string;
  title: string;
  endpoints: RouteCatalogueEntry[];
}

export function groupCatalogue(entries: RouteCatalogueEntry[]): RouteCatalogueSection[] {
  const buckets = new Map<string, RouteCatalogueEntry[]>();
  for (const entry of entries) {
    const segs = entry.path.split("/").filter(Boolean);
    // /api/foo/... -> bucket "foo"; /api/v1/... -> bucket "v1"; fallback "other"
    const key = (segs[0] === "api" ? segs[1] : segs[0]) ?? "other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(entry);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, eps]) => ({
      id,
      title: id,
      endpoints: eps.sort((a: RouteCatalogueEntry, b: RouteCatalogueEntry) =>
        a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
      ),
    }));
}
