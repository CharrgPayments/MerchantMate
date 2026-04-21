import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";

// (table, column) pairs taken from the risky SET NOT NULL list
const checks: [string,string][] = [
  ["addresses","location_id"],
  ["agents","email"], ["agents","phone"],
  ["audit_logs","resource"], ["audit_logs","risk_level"], ["audit_logs","created_at"],
  ["campaign_fee_values","fee_item_id"],
  ["campaigns","acquirer"],
  ["equipment_items","created_at"], ["equipment_items","updated_at"],
  ["locations","merchant_id"], ["locations","status"],
  ["merchant_prospects","agent_id"],
  ["merchants","business_name"], ["merchants","business_type"], ["merchants","email"],
  ["merchants","phone"], ["merchants","status"], ["merchants","created_at"],
  ["pricing_types","created_at"], ["pricing_types","updated_at"],
  ["transactions","merchant_id"], ["transactions","payment_method"], ["transactions","status"], ["transactions","created_at"],
  ["users","password_hash"], ["users","roles"],
  ["workflow_environment_configs","is_active"],
];

async function main() {
  for (const env of ["test","development","production"] as const) {
    const db = getDynamicDatabase(env);
    console.log(`\n── ${env} ──────────────────────────────`);
    for (const [t,c] of checks) {
      try {
        const totalRes:any = await db.execute(dsql.raw(`SELECT COUNT(*)::int AS n FROM "${t}"`));
        const total = totalRes.rows?.[0]?.n ?? 0;
        if (total === 0) continue; // empty table — SET NOT NULL trivially succeeds
        const nullRes:any = await db.execute(dsql.raw(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "${c}" IS NULL`));
        const nulls = nullRes.rows?.[0]?.n ?? 0;
        if (nulls > 0) console.log(`  ${t}.${c}: ${nulls} NULL of ${total}`);
      } catch(e:any) {
        if (!/does not exist/.test(e.message||"")) console.log(`  ${t}.${c}: ERR ${e.message?.slice(0,80)}`);
      }
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
