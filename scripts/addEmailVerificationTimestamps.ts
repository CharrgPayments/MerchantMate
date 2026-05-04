// One-off, idempotent schema additions for email-verification audit fields.
// Adds: merchant_prospects.validated_ip, merchant_prospects.validated_user_agent,
//       users.email_verified_at — all nullable, so safe to apply on populated tables.
// We avoid `npm run db:push` here because the project has unrelated pre-existing
// drift that drizzle-kit would try to "fix" destructively.
import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";

const STATEMENTS: Array<{ label: string; stmt: string }> = [
  {
    label: "merchant_prospects.validated_ip",
    stmt: `ALTER TABLE "merchant_prospects" ADD COLUMN IF NOT EXISTS "validated_ip" varchar`,
  },
  {
    label: "merchant_prospects.validated_user_agent",
    stmt: `ALTER TABLE "merchant_prospects" ADD COLUMN IF NOT EXISTS "validated_user_agent" text`,
  },
  {
    label: "users.email_verified_at",
    stmt: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp`,
  },
  // Backfill: for users already verified, stamp emailVerifiedAt = updatedAt
  // (best-effort historical proxy) so existing verified accounts don't show as
  // "verified but never timestamped".
  {
    label: "users.email_verified_at backfill",
    stmt: `UPDATE "users" SET "email_verified_at" = COALESCE("updated_at", "created_at", NOW())
           WHERE "email_verified" = true AND "email_verified_at" IS NULL`,
  },
];

async function go(
  env: "production" | "test" | "development",
  stmt: string,
  label: string,
) {
  const db = getDynamicDatabase(env);
  try {
    await db.execute(dsql.raw(`SET lock_timeout='5s'`));
    await db.execute(dsql.raw(stmt));
    console.log(`  OK  [${env}] ${label}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERR [${env}] ${label} → ${msg.slice(0, 200)}`);
  }
}

async function main() {
  for (const env of ["development", "test", "production"] as const) {
    console.log(`\n=== ${env} ===`);
    for (const { label, stmt } of STATEMENTS) {
      await go(env, stmt, label);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
