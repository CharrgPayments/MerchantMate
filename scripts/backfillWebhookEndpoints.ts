/**
 * Communications Endpoint Cutover (Task #32) — Backfill
 *
 * Walks every webhook action template, ensures a matching row exists in the
 * external_endpoints registry (de-duped by normalized URL + auth signature),
 * sets `endpoint_id` on the template, and removes the inlined transport
 * fields from `config` (url/method/headers/auth/authType/authConfig).
 *
 * Idempotent: re-running on an already-migrated row is a no-op.
 *
 * Usage:
 *   tsx scripts/backfillWebhookEndpoints.ts          # default DATABASE_URL
 *   DATABASE_URL=$DEV_DATABASE_URL tsx scripts/backfillWebhookEndpoints.ts
 *   tsx scripts/backfillWebhookEndpoints.ts --dry-run
 */
import "dotenv/config";
import { db } from "../server/db";
import { actionTemplates, externalEndpoints } from "../shared/schema";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");

const TRANSPORT_KEYS = new Set([
  "url",
  "method",
  "headers",
  "auth",
  "authType",
  "auth_type",
  "authConfig",
  "auth_config",
  "timeoutSeconds",
  "timeout_seconds",
]);

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
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return {};
}

function deriveAuthFromConfig(cfg: any): { authType: string; authConfig: Record<string, any> } {
  // Existing webhook templates never modeled auth as a first-class field —
  // tokens lived inline in the URL or headers via {{$SECRET}} placeholders.
  // Honor explicit auth fields if any caller set them, otherwise default to
  // "none" (the secrets remain in the URL/header strings, which the registry
  // resolves at runtime).
  const authType = cfg?.authType ?? cfg?.auth_type ?? cfg?.auth?.type ?? "none";
  const authConfig =
    cfg?.authConfig ?? cfg?.auth_config ?? (cfg?.auth && typeof cfg.auth === "object" ? cfg.auth : {});
  return { authType, authConfig: authConfig || {} };
}

function pickConsumerConfig(cfg: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(cfg || {})) {
    if (!TRANSPORT_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function findOrCreateEndpoint(args: {
  baseName: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  authType: string;
  authConfig: Record<string, any>;
}) {
  const sig = authSignature(args.authType, args.authConfig);
  const normalized = normalizeUrl(args.url);

  // Try to find an existing endpoint with the same normalized URL + auth
  // signature. If multiple rows match URL but different auth, treat them as
  // separate endpoints.
  const candidates = await db.select().from(externalEndpoints);
  for (const c of candidates) {
    if (
      normalizeUrl(c.url) === normalized &&
      authSignature(c.authType ?? "none", c.authConfig ?? {}) === sig
    ) {
      return { row: c, created: false };
    }
  }

  // Allocate a unique name (registry has UNIQUE on name)
  let name = args.baseName;
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
  const all = await db.select().from(actionTemplates);
  const webhooks = all.filter((t) => t.actionType === "webhook");
  console.log(`Found ${webhooks.length} webhook templates (of ${all.length} total).`);

  let migrated = 0;
  let skipped = 0;
  let createdCount = 0;
  let reusedCount = 0;

  for (const t of webhooks) {
    const cfg = (t.config as any) || {};

    if (t.endpointId) {
      // Already migrated — make sure config is slim too.
      const slim = pickConsumerConfig(cfg);
      const hasInline = Object.keys(cfg).some((k) => TRANSPORT_KEYS.has(k));
      if (hasInline) {
        if (!DRY_RUN) {
          await db
            .update(actionTemplates)
            .set({ config: slim, updatedAt: new Date() })
            .where(eq(actionTemplates.id, t.id));
        }
        console.log(`✓ template #${t.id} "${t.name}": stripped lingering inline transport`);
      } else {
        skipped += 1;
      }
      continue;
    }

    if (!cfg.url) {
      console.log(`⚠ template #${t.id} "${t.name}": no url in config, skipping`);
      skipped += 1;
      continue;
    }

    const headers = parseHeaders(cfg.headers);
    const { authType, authConfig } = deriveAuthFromConfig(cfg);
    const { row: endpoint, created } = await findOrCreateEndpoint({
      baseName: t.name,
      url: cfg.url,
      method: cfg.method || "POST",
      headers,
      authType,
      authConfig,
    });

    const slim = pickConsumerConfig(cfg);
    if (DRY_RUN) {
      console.log(
        `[dry-run] template #${t.id} "${t.name}" → endpoint ${created ? "NEW" : "REUSE"} "${endpoint.name}"`,
      );
    } else {
      await db
        .update(actionTemplates)
        .set({ endpointId: endpoint.id, config: slim, updatedAt: new Date() })
        .where(eq(actionTemplates.id, t.id));
      console.log(
        `✓ template #${t.id} "${t.name}" → endpoint ${created ? "NEW" : "REUSE"} #${endpoint.id} "${endpoint.name}"`,
      );
    }
    migrated += 1;
    if (created) createdCount += 1;
    else reusedCount += 1;
  }

  console.log("───────────────────────────────");
  console.log(
    `Done. migrated=${migrated} skipped=${skipped} endpoints_created=${createdCount} endpoints_reused=${reusedCount}${
      DRY_RUN ? " (dry run, no writes)" : ""
    }`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
