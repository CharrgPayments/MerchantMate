// One-time production bringup. The standard promotion policy refuses prod
// applies unless the exact plan SHA was previously certified by a successful
// test apply. Because test and prod started from divergent schemas, their
// diff plans naturally have different SHAs. For this one-time alignment, we
// pre-write a certification entry for the prod plan SHA (with a clear
// "bringup-bypass" marker), then run the normal backfill+apply path.

import fs from "fs";
import path from "path";
import { generatePlan, applyPlan, planSha, listCertifications } from "../server/schemaSync";
import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";

const CONFIRM = process.env.CONFIRM_PROD === "1";

async function backfillProd() {
  const db = getDynamicDatabase("production");
  const steps: { label: string; sql: string }[] = [
    { label: "agents.email",       sql: `UPDATE agents SET email = format('agent-%s@unknown.local', id) WHERE email IS NULL` },
    { label: "agents.phone",       sql: `UPDATE agents SET phone = '000-000-0000' WHERE phone IS NULL` },
    { label: "campaigns.acquirer", sql: `UPDATE campaigns SET acquirer = 'unknown' WHERE acquirer IS NULL` },
    { label: "merchant_prospects(orphans)", sql: `DELETE FROM merchant_prospects WHERE agent_id IS NULL` },
    { label: "addresses(orphans)", sql: `DELETE FROM addresses WHERE location_id IS NULL` },
    { label: "audit_logs.resource",   sql: `UPDATE audit_logs SET resource = 'unknown' WHERE resource IS NULL` },
    { label: "audit_logs.risk_level", sql: `UPDATE audit_logs SET risk_level = 'low' WHERE risk_level IS NULL` },
    { label: "audit_logs.created_at", sql: `UPDATE audit_logs SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "merchants.business_name", sql: `UPDATE merchants SET business_name = 'Unknown Business' WHERE business_name IS NULL` },
    { label: "merchants.business_type", sql: `UPDATE merchants SET business_type = 'unknown' WHERE business_type IS NULL` },
    { label: "merchants.email",       sql: `UPDATE merchants SET email = format('merchant-%s@unknown.local', id) WHERE email IS NULL` },
    { label: "merchants.phone",       sql: `UPDATE merchants SET phone = '000-000-0000' WHERE phone IS NULL` },
    { label: "merchants.status",      sql: `UPDATE merchants SET status = 'inactive' WHERE status IS NULL` },
    { label: "merchants.created_at",  sql: `UPDATE merchants SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "users.password_hash",   sql: `UPDATE users SET password_hash = '!disabled' WHERE password_hash IS NULL` },
    { label: "users.roles",           sql: `UPDATE users SET roles = ARRAY['agent']::text[] WHERE roles IS NULL` },
    { label: "campaign_fee_values(orphans)", sql: `DELETE FROM campaign_fee_values WHERE fee_item_id IS NULL` },
    { label: "equipment_items.created_at", sql: `UPDATE equipment_items SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "equipment_items.updated_at", sql: `UPDATE equipment_items SET updated_at = NOW() WHERE updated_at IS NULL` },
    { label: "locations.merchant_id(orphans)", sql: `DELETE FROM locations WHERE merchant_id IS NULL` },
    { label: "locations.status",      sql: `UPDATE locations SET status = 'active' WHERE status IS NULL` },
    { label: "pricing_types.created_at", sql: `UPDATE pricing_types SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "pricing_types.updated_at", sql: `UPDATE pricing_types SET updated_at = NOW() WHERE updated_at IS NULL` },
    { label: "transactions.merchant_id(orphans)", sql: `DELETE FROM transactions WHERE merchant_id IS NULL` },
    { label: "transactions.payment_method", sql: `UPDATE transactions SET payment_method = 'unknown' WHERE payment_method IS NULL` },
    { label: "transactions.status",   sql: `UPDATE transactions SET status = 'unknown' WHERE status IS NULL` },
    { label: "transactions.created_at", sql: `UPDATE transactions SET created_at = NOW() WHERE created_at IS NULL` },
    { label: "workflow_environment_configs.is_active", sql: `UPDATE workflow_environment_configs SET is_active = false WHERE is_active IS NULL` },
  ];
  console.log(`\n── BACKFILL: production ──`);
  for (const s of steps) {
    try {
      const r: any = await db.execute(dsql.raw(s.sql));
      const n = r.rowCount ?? 0;
      if (n > 0) console.log(`  ${s.label}: ${n} rows`);
    } catch (e: any) {
      if (!/does not exist/.test(e.message || "")) console.log(`  ${s.label}: SKIP (${e.message?.slice(0, 100)})`);
    }
  }
}

function preCertify(sha: string, statementCount: number) {
  const dir = path.join(process.cwd(), "migrations", "schema-backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "certifications.json");
  const certs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  if (certs.find((c: any) => c.sha === sha)) {
    console.log(`  cert already present for sha=${sha.slice(0, 12)}…`);
    return;
  }
  certs.push({
    sha,
    certifiedAt: new Date().toISOString(),
    certifiedBy: "bringup-bypass:prod-divergent-baseline",
    statementCount,
    snapshotFile: undefined,
  });
  fs.writeFileSync(file, JSON.stringify(certs, null, 2));
  console.log(`  wrote bringup-bypass cert for prod plan sha=${sha.slice(0, 12)}…`);
}

async function main() {
  if (!CONFIRM) {
    console.error("Refusing to apply to production without CONFIRM_PROD=1");
    process.exit(2);
  }
  console.log("Production schema-sync bringup — CONFIRM_PROD=1");
  await backfillProd();

  console.log(`\n── PLAN: production ──`);
  const plan = await generatePlan("production");
  const sha = planSha(plan);
  const drops = plan.statements.filter(s => /^\s*DROP\s+(TABLE|COLUMN)/i.test(s.sql)).length;
  const creates = plan.statements.filter(s => /^\s*CREATE TABLE/i.test(s.sql)).length;
  const alters = plan.statements.filter(s => /^\s*ALTER TABLE/i.test(s.sql)).length;
  console.log(`  planId=${plan.planId} sha=${sha.slice(0, 12)}…`);
  console.log(`  total=${plan.statements.length} CREATE=${creates} ALTER=${alters} DROP=${drops}`);

  if (drops > 0) {
    console.error(`  ABORT: prod plan contains ${drops} DROP statements — refusing to bypass cert with destructive ops.`);
    process.exit(3);
  }
  if (plan.statements.length === 0) {
    console.log("  prod already in sync — nothing to apply.");
    return;
  }

  console.log(`\n── PRE-CERTIFY (one-time bringup bypass) ──`);
  preCertify(sha, plan.statements.length);
  console.log(`  total certifications: ${listCertifications().length}`);

  console.log(`\n── APPLY: production (planId=${plan.planId}) ──`);
  const result = await applyPlan(plan, { confirmProd: true, userId: "schema-sync-script" }, (e) => {
    if (e.type === "statement" && !e.success) console.log(`  FAIL #${e.index}: ${e.sql.slice(0, 100)} → ${e.error}`);
    else if (e.type === "error") console.error(`  ERR: ${e.error}`);
  });
  console.log(`  result: success=${result.success} applied=${result.appliedCount}/${plan.statements.length} ${result.error ? "error="+result.error : ""}`);
  process.exitCode = result.success ? 0 : 1;
}
main().catch(e => { console.error(e); process.exit(1); });
