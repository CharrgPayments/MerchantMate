/**
 * Workflow Endpoint Cutover (Task #33) — Backfill
 *
 * Mirrors the Communications-side backfill (Task #32) for the workflow
 * runtime side. Two passes, both idempotent:
 *
 *   1. For every row in `workflow_endpoints`, ensure a matching row exists
 *      in `external_endpoints` (de-duped by normalized URL + auth signature).
 *      Names are preserved when free; otherwise suffixed.
 *
 *   2. For every row in `stage_api_configs` that does NOT yet have
 *      `endpoint_id` set, derive transport from either the linked
 *      workflow_endpoints row (`integration_id`) or the inline columns
 *      (endpoint_url + http_method + auth_type + auth_secret_key), find or
 *      create a matching `external_endpoints` row, and set `endpoint_id`.
 *
 * Re-running on already-migrated rows is a no-op.
 *
 * Usage:
 *   tsx scripts/backfillWorkflowEndpoints.ts            # default DATABASE_URL
 *   DATABASE_URL=$DEV_DATABASE_URL tsx scripts/backfillWorkflowEndpoints.ts
 *   tsx scripts/backfillWorkflowEndpoints.ts --dry-run
 */
import "dotenv/config";
import { db } from "../server/db";
import {
  externalEndpoints,
  stageApiConfigs,
  workflowEndpoints,
} from "../shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");

function normalizeUrl(url: string): string {
  return (url || "").trim().toLowerCase().replace(/\/+$/, "");
}

function authSignature(authType: string, authConfig: any): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify({ authType: authType || "none", authConfig: authConfig || {} }))
    .digest("hex")
    .slice(0, 8);
}

function parseHeaders(raw: any): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, string>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
  }
  return {};
}

async function findOrCreateEndpoint(args: {
  baseName: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  authType: string;
  authConfig: Record<string, any>;
}) {
  if (!args.url) return { row: null as any, created: false };
  const sig = authSignature(args.authType, args.authConfig);
  const normalized = normalizeUrl(args.url);

  const candidates = await db.select().from(externalEndpoints);
  for (const c of candidates) {
    if (
      normalizeUrl(c.url) === normalized &&
      authSignature(c.authType ?? "none", c.authConfig ?? {}) === sig
    ) {
      return { row: c, created: false };
    }
  }

  let name = args.baseName || `endpoint_${normalized.slice(-32)}`;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [existing] = await db
      .select()
      .from(externalEndpoints)
      .where(eq(externalEndpoints.name, name));
    if (!existing) break;
    suffix += 1;
    name = `${args.baseName} (${suffix})`;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would create endpoint "${name}" for ${args.url}`);
    return { row: { id: -1, name, url: args.url } as any, created: true };
  }

  const [created] = await db
    .insert(externalEndpoints)
    .values({
      name,
      url: args.url,
      method: args.method || "POST",
      headers: args.headers,
      authType: args.authType || "none",
      authConfig: args.authConfig || {},
      isActive: true,
    })
    .returning();
  return { row: created, created: true };
}

async function main() {
  // ── Pass 1: workflow_endpoints → external_endpoints ───────────────────
  const weRows = await db.select().from(workflowEndpoints);
  console.log(`Pass 1: ${weRows.length} workflow_endpoints rows.`);
  const weToRegistry = new Map<number, number>(); // workflow_endpoints.id → external_endpoints.id

  let weCreated = 0;
  let weReused = 0;
  for (const we of weRows) {
    const headers = parseHeaders(we.headers);
    const { row, created } = await findOrCreateEndpoint({
      baseName: we.name,
      url: we.url,
      method: we.method || "POST",
      headers,
      authType: (we as any).authType || "none",
      authConfig: ((we as any).authConfig || {}) as Record<string, any>,
    });
    if (row) {
      weToRegistry.set(we.id, row.id);
      if (created) weCreated += 1; else weReused += 1;
    }
  }
  console.log(`  endpoints_created=${weCreated} endpoints_reused=${weReused}`);

  // ── Pass 2: stage_api_configs → endpoint_id ───────────────────────────
  const sacRows = await db.select().from(stageApiConfigs);
  console.log(`Pass 2: ${sacRows.length} stage_api_configs rows.`);

  let sacMigrated = 0;
  let sacSkipped = 0;
  let sacCreated = 0;
  let sacReused = 0;

  for (const sac of sacRows) {
    if (sac.endpointId) {
      sacSkipped += 1;
      continue;
    }

    let derivedUrl = sac.endpointUrl ?? "";
    let derivedMethod = sac.httpMethod || "POST";
    let derivedHeaders = parseHeaders(sac.headers);
    let derivedAuthType = (sac.authType ?? "none") as string;
    let derivedAuthConfig: Record<string, any> = sac.authSecretKey
      ? { secretKey: sac.authSecretKey }
      : {};
    let baseName = `stage_${sac.stageId}_endpoint`;

    // Prefer linked workflow_endpoints row when available
    if (sac.integrationId && weToRegistry.has(sac.integrationId)) {
      const epId = weToRegistry.get(sac.integrationId)!;
      if (DRY_RUN) {
        console.log(`[dry-run] sac #${sac.id} → existing endpoint #${epId} (via integration_id)`);
      } else {
        await db
          .update(stageApiConfigs)
          .set({ endpointId: epId, updatedAt: new Date() })
          .where(eq(stageApiConfigs.id, sac.id));
      }
      sacMigrated += 1;
      sacReused += 1;
      continue;
    }

    if (!derivedUrl) {
      sacSkipped += 1;
      continue;
    }

    const { row, created } = await findOrCreateEndpoint({
      baseName,
      url: derivedUrl,
      method: derivedMethod,
      headers: derivedHeaders,
      authType: derivedAuthType,
      authConfig: derivedAuthConfig,
    });
    if (!row) {
      sacSkipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] sac #${sac.id} → endpoint ${created ? "NEW" : "REUSE"} "${row.name}"`);
    } else {
      await db
        .update(stageApiConfigs)
        .set({ endpointId: row.id, updatedAt: new Date() })
        .where(eq(stageApiConfigs.id, sac.id));
    }
    sacMigrated += 1;
    if (created) sacCreated += 1; else sacReused += 1;
  }

  console.log("───────────────────────────────");
  console.log(
    `Done. sac_migrated=${sacMigrated} sac_skipped=${sacSkipped} ` +
    `endpoints_created=${weCreated + sacCreated} endpoints_reused=${weReused + sacReused}` +
    `${DRY_RUN ? " (dry run, no writes)" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
