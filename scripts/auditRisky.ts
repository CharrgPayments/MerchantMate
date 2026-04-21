import { generatePlan } from "../server/schemaSync";
async function main() {
  for (const env of ["test","development","production"] as const) {
    const p = await generatePlan(env);
    const risky = p.statements.filter(s=>s.risk!=="safe");
    console.log(`\n── ${env}: ${risky.length} risky / ${p.statements.length} total ──`);
    for (const s of risky) console.log(`  [${s.risk}] ${s.sql.replace(/\s+/g," ").trim().slice(0,180)}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
