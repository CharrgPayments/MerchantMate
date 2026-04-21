// One-shot orchestrator that drives the cross-environment schema sync
// without going through HTTP/auth. Reuses the same generatePlan/applyPlan
// functions the admin UI calls. Order: dev → test (auto-certifies) → production.
//
// Run with: SYNC_PHASE=plan|test|dev|prod tsx scripts/runSchemaSync.ts
// Default phase = plan (dry run only, no DDL executed).

import { generatePlan, applyPlan, type Plan } from "../server/schemaSync";

type Phase = "plan" | "test" | "dev" | "prod";
const PHASE: Phase = (process.env.SYNC_PHASE as Phase) || "plan";

function summarize(plan: Plan): string {
  const safe = plan.statements.filter((s) => s.risk === "safe").length;
  const risky = plan.statements.filter((s) => s.risk === "risky").length;
  const ambiguous = plan.statements.filter((s) => s.risk === "ambiguous").length;
  const drops = plan.statements.filter((s) => /^\s*DROP\s+(TABLE|COLUMN)/i.test(s.sql)).length;
  const creates = plan.statements.filter((s) => /^\s*CREATE\s+TABLE/i.test(s.sql)).length;
  const alters = plan.statements.filter((s) => /^\s*ALTER\s+TABLE/i.test(s.sql)).length;
  return `total=${plan.statements.length} safe=${safe} risky=${risky} ambiguous=${ambiguous} | CREATE TABLE=${creates} ALTER=${alters} DROP=${drops}`;
}

function previewStatements(plan: Plan, n = 8) {
  const head = plan.statements.slice(0, n);
  for (const s of head) {
    const oneline = s.sql.replace(/\s+/g, " ").trim().slice(0, 140);
    console.log(`  [${s.risk.padEnd(9)}] ${oneline}${s.sql.length > 140 ? " …" : ""}`);
  }
  if (plan.statements.length > n) console.log(`  … and ${plan.statements.length - n} more`);
}

async function planFor(env: "production" | "test" | "development"): Promise<Plan> {
  console.log(`\n── PLAN: ${env} ──────────────────────────────────────`);
  const plan = await generatePlan(env);
  console.log(`planId=${plan.planId}`);
  console.log(`summary: ${summarize(plan)}`);
  previewStatements(plan);
  return plan;
}

async function applyFor(env: "production" | "test" | "development", plan: Plan, opts: { confirmProd?: boolean } = {}) {
  console.log(`\n── APPLY: ${env} (planId=${plan.planId}) ──────────────`);
  const result = await applyPlan(plan, { ...opts, userId: "schema-sync-script" }, (e) => {
    if (e.type === "statement") {
      const tag = e.success ? "OK " : "FAIL";
      const oneline = e.sql.replace(/\s+/g, " ").trim().slice(0, 100);
      console.log(`  ${tag} #${e.index} ${oneline}${e.error ? ` → ${e.error}` : ""}`);
    } else if (e.type === "error") {
      console.error(`  ERR: ${e.error}`);
    } else if (e.type === "summary") {
      console.log(`  summary: applied=${e.appliedCount} duration=${e.durationMs}ms`);
    }
  });
  console.log(`result: success=${result.success} applied=${result.appliedCount} ${result.error ? "error=" + result.error : ""}`);
  return result;
}

async function main() {
  console.log(`Schema-sync orchestrator — phase=${PHASE}`);

  if (PHASE === "plan") {
    // Dry-run: show diffs for all 3 envs side-by-side. No DDL executed.
    await planFor("production");
    await planFor("test");
    await planFor("development");
    console.log(`\nDone (plan-only). Re-run with SYNC_PHASE=test|dev|prod to apply.`);
    return;
  }

  if (PHASE === "test") {
    const plan = await planFor("test");
    if (plan.statements.length === 0) {
      console.log("Test env already in sync — nothing to apply.");
      return;
    }
    const result = await applyFor("test", plan);
    if (!result.success) process.exitCode = 1;
    return;
  }

  if (PHASE === "dev") {
    const plan = await planFor("development");
    if (plan.statements.length === 0) {
      console.log("Dev env already in sync — nothing to apply.");
      return;
    }
    const result = await applyFor("development", plan);
    if (!result.success) process.exitCode = 1;
    return;
  }

  if (PHASE === "prod") {
    const plan = await planFor("production");
    if (plan.statements.length === 0) {
      console.log("Prod env already in sync — nothing to apply.");
      return;
    }
    const result = await applyFor("production", plan, { confirmProd: true });
    if (!result.success) process.exitCode = 1;
    return;
  }

  console.error(`Unknown SYNC_PHASE=${PHASE}. Use plan|test|dev|prod.`);
  process.exitCode = 2;
}

main().catch((e) => {
  console.error("orchestrator failed:", e);
  process.exitCode = 1;
});
