// In-memory cache of role×action scope overrides loaded from the
// role_action_grants DB table. The cache is consulted by requirePerm and by
// API endpoints that surface the registry to the client.
//
// Cache strategy: reload on demand (TTL 30s) and explicitly after writes.
// Keeps the hot middleware path zero-DB-call in steady state.
import { db } from "./db";
import { roleActionGrants, roleActionAudit } from "@shared/schema";
import type { GrantOverrides, Scope } from "@shared/permissions";
import { sql } from "drizzle-orm";

let cache: GrantOverrides = {};
let cachedAt = 0;
const TTL_MS = 30_000;

async function loadFromDb(): Promise<GrantOverrides> {
  try {
    const rows = await db.select().from(roleActionGrants);
    const out: GrantOverrides = {};
    for (const r of rows) {
      const action = r.action;
      const bucket: Partial<Record<string, Scope | null>> = out[action] ?? {};
      const scope: Scope | null = r.scope === "none" ? null : (r.scope as Scope);
      bucket[r.roleCode] = scope;
      out[action] = bucket;
    }
    return out;
  } catch (err) {
    // Table may not exist yet on first boot; treat as empty overrides.
    console.warn("[permissionRegistry] load failed (using defaults):", (err as Error).message);
    return {};
  }
}

export async function getOverrides(forceReload = false): Promise<GrantOverrides> {
  if (!forceReload && Date.now() - cachedAt < TTL_MS) return cache;
  cache = await loadFromDb();
  cachedAt = Date.now();
  return cache;
}

export function invalidateRegistry() {
  cachedAt = 0;
}

export async function setGrant(
  roleCode: string,
  action: string,
  scope: Scope | "none",
  changedBy: string | null,
): Promise<{ prev: string | null; next: string }> {
  // Read previous scope for audit
  const existing = await db
    .select()
    .from(roleActionGrants)
    .where(sql`role_code = ${roleCode} AND action = ${action}`);
  const prev = existing[0]?.scope ?? null;

  await db.execute(sql`
    INSERT INTO role_action_grants (role_code, action, scope, updated_at, updated_by)
    VALUES (${roleCode}, ${action}, ${scope}, now(), ${changedBy})
    ON CONFLICT (role_code, action) DO UPDATE
      SET scope = EXCLUDED.scope,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
  `);

  await db.insert(roleActionAudit).values({
    roleCode,
    action,
    prevScope: prev,
    newScope: scope,
    changedBy: changedBy ?? null,
  });

  invalidateRegistry();
  return { prev, next: scope };
}
