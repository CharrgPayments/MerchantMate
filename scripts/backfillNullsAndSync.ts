// One-off bringup helper:
//   1. Backfill placeholder values for the small set of NULL rows that block
//      SET NOT NULL ALTERs (audited at 2-5 rows per env, all seed leftovers).
//   2. Delete orphan rows whose required FK parent is NULL — fabricating fake
//      parent IDs would be worse than removing the orphan.
//   3. Re-generate and apply the schema-sync plan for the chosen env.
//
// Run: SYNC_ENV=test|development|production tsx scripts/backfillNullsAndSync.ts

import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
import { generatePlan, applyPlan } from "../server/schemaSync";

type Env = "test" | "development" | "production";
const ENV: Env = (process.env.SYNC_ENV as Env) || "test";
const CONFIRM_PROD = process.env.CONFIRM_PROD === "1";

async function backfill(env: Env) {
  const db = getDynamicDatabase(env);
  const steps: { label: string; sql: string }[] = [
    { label: "agents.email",       sql: `UPDATE agents SET email = format('agent-%s@unknown.local', id) WHERE email IS NULL` },
    { label: "agents.phone",       sql: `UPDATE agents SET phone = '000-000-0000' WHERE phone IS NULL` },
    { label: "campaigns.acquirer", sql: `UPDATE campaigns SET acquirer = 'unknown' WHERE acquirer IS NULL` },
    { label: "locations(orphans)", sql: `DELETE FROM locations WHERE merchant_id IS NULL` },
    { label: "merchant_prospects(orphans)", sql: `DELETE FROM merchant_prospects WHERE agent_id IS NULL` },
    // Production-only extras observed in audit
    { label: "addresses(orphans)", sql: `DELETE FROM addresses WHERE location_id IS NULL` },
    { label: "audit_logs.resource",   sql: `UPDATE audit_logs SET resource = 'unknown' WHERE resource IS NULL` },
    { label: "audit_logs.risk_level", sql: `UPDATE audit_logs SET risk_level = 'low' WHERE risk_level IS NULL` },
    { label: "audit_logs.created_at", sql: `UPDATE audit_logs SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "merchants.business_name", sql: `UPDATE merchants SET business_name = COALESCE(business_name, 'Unknown Business')` },
    { label: "merchants.business_type", sql: `UPDATE merchants SET business_type = COALESCE(business_type, 'unknown')` },
    { label: "merchants.email",       sql: `UPDATE merchants SET email = format('merchant-%s@unknown.local', id) WHERE email IS NULL` },
    { label: "merchants.phone",       sql: `UPDATE merchants SET phone = COALESCE(phone, '000-000-0000')` },
    { label: "merchants.status",      sql: `UPDATE merchants SET status = COALESCE(status, 'inactive')` },
    { label: "merchants.created_at",  sql: `UPDATE merchants SET created_at = COALESCE(created_at, NOW())` },
    { label: "users.password_hash",   sql: `UPDATE users SET password_hash = '!disabled' WHERE password_hash IS NULL` },
    { label: "users.roles",           sql: `UPDATE users SET roles = COALESCE(roles, ARRAY['agent']::text[])` },
    { label: "campaign_fee_values(orphans)", sql: `DELETE FROM campaign_fee_values WHERE fee_item_id IS NULL` },
    { label: "equipment_items.created_at", sql: `UPDATE equipment_items SET created_at = COALESCE(created_at, NOW())` },
    { label: "equipment_items.updated_at", sql: `UPDATE equipment_items SET updated_at = COALESCE(updated_at, NOW())` },
    { label: "locations.status",      sql: `UPDATE locations SET status = COALESCE(status, 'active')` },
    { label: "pricing_types.created_at", sql: `UPDATE pricing_types SET created_at = COALESCE(created_at, NOW())` },
    { label: "pricing_types.updated_at", sql: `UPDATE pricing_types SET updated_at = COALESCE(updated_at, NOW())` },
    { label: "transactions.merchant_id(orphans)", sql: `DELETE FROM transactions WHERE merchant_id IS NULL` },
    { label: "transactions.payment_method", sql: `UPDATE transactions SET payment_method = COALESCE(payment_method, 'unknown')` },
    { label: "transactions.status",   sql: `UPDATE transactions SET status = COALESCE(status, 'unknown')` },
    { label: "transactions.created_at", sql: `UPDATE transactions SET created_at = COALESCE(created_at, NOW())` },
    { label: "workflow_environment_configs.is_active", sql: `UPDATE workflow_environment_configs SET is_active = COALESCE(is_active, false)` },
  ];

  console.log(`\n── BACKFILL: ${env} ──`);
  for (const s of steps) {
    try {
      const r: any = await db.execute(dsql.raw(s.sql));
      const n = r.rowCount ?? 0;
      if (n > 0) console.log(`  ${s.label}: ${n} rows`);
    } catch (e: any) {
      // Tolerate "does not exist" — table/column may be absent in this env until CREATE/ALTER runs
      if (!/does not exist/.test(e.message || "")) console.log(`  ${s.label}: SKIP (${e.message?.slice(0, 100)})`);
    }
  }
}

async function syncEnv(env: Env) {
  console.log(`\n── PLAN: ${env} ──`);
  const plan = await generatePlan(env);
  const drops = plan.statements.filter(s => /^\s*DROP\s+(TABLE|COLUMN)/i.test(s.sql)).length;
  console.log(`  total=${plan.statements.length} CREATE=${plan.statements.filter(s=>/^\s*CREATE TABLE/i.test(s.sql)).length} ALTER=${plan.statements.filter(s=>/^\s*ALTER TABLE/i.test(s.sql)).length} DROP=${drops}`);
  if (plan.statements.length === 0) { console.log("  already in sync"); return true; }

  console.log(`── APPLY: ${env} (planId=${plan.planId}) ──`);
  const result = await applyPlan(plan, { confirmProd: env === "production" && CONFIRM_PROD, userId: "schema-sync-script" }, (e) => {
    if (e.type === "statement" && !e.success) console.log(`  FAIL #${e.index}: ${e.sql.slice(0, 100)} → ${e.error}`);
    else if (e.type === "error") console.error(`  ERR: ${e.error}`);
  });
  console.log(`  result: success=${result.success} applied=${result.appliedCount}/${plan.statements.length} ${result.error ? "error="+result.error : ""}`);
  return result.success;
}

async function main() {
  console.log(`Bringup orchestrator — env=${ENV}`);
  await backfill(ENV);
  const ok = await syncEnv(ENV);
  process.exitCode = ok ? 0 : 1;
}
main().catch(e => { console.error(e); process.exit(1); });
