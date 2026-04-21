// Per-environment cache of role×action scope overrides loaded from the
// role_action_grants table that lives in EACH database (dev / test / prod).
// Cache is keyed by DB environment so a toggle in dev never bleeds into
// production permission decisions and vice-versa.
//
// Cache strategy: reload on demand (TTL 30s) and explicitly after writes.
// Keeps the hot middleware path zero-DB-call in steady state.
import { roleActionGrants, roleActionAudit } from "@shared/schema";
import type { GrantOverrides, Scope } from "@shared/permissions";
import { sql } from "drizzle-orm";
import { getDynamicDatabase } from "./db";

type DynamicDB = ReturnType<typeof getDynamicDatabase>;

interface CacheEntry { data: GrantOverrides; at: number; }
const cacheByEnv = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

function resolveDb(env: string, db?: DynamicDB): DynamicDB {
  return db ?? getDynamicDatabase(env);
}

async function loadFromDb(db: DynamicDB): Promise<GrantOverrides> {
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

export async function getOverrides(
  env: string,
  db?: DynamicDB,
  forceReload = false,
): Promise<GrantOverrides> {
  const cached = cacheByEnv.get(env);
  if (!forceReload && cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const data = await loadFromDb(resolveDb(env, db));
  cacheByEnv.set(env, { data, at: Date.now() });
  return data;
}

export function invalidateRegistry(env?: string) {
  if (env) cacheByEnv.delete(env);
  else cacheByEnv.clear();
}

export async function setGrant(
  env: string,
  db: DynamicDB,
  roleCode: string,
  action: string,
  scope: Scope | "none",
  changedBy: string | null,
): Promise<{ prev: string | null; next: string }> {
  // Read previous scope for audit (env-specific DB).
  const existing = await db
    .select()
    .from(roleActionGrants)
    .where(sql`role_code = ${roleCode} AND action = ${action}`);
  const prev = existing[0]?.scope ?? null;

  // Typed upsert via Drizzle's onConflictDoUpdate — env-isolated through
  // the per-request `db` parameter (DynamicDB).
  await db
    .insert(roleActionGrants)
    .values({ roleCode, action, scope, updatedBy: changedBy ?? undefined })
    .onConflictDoUpdate({
      target: [roleActionGrants.roleCode, roleActionGrants.action],
      set: { scope, updatedAt: sql`now()`, updatedBy: changedBy ?? null },
    });

  await db.insert(roleActionAudit).values({
    roleCode,
    action,
    prevScope: prev,
    newScope: scope,
    changedBy: changedBy ?? null,
  });

  invalidateRegistry(env);
  return { prev, next: scope };
}
