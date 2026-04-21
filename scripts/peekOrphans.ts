import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
async function main() {
  for (const env of ["test","development","production"] as const) {
    const db = getDynamicDatabase(env);
    console.log(`\n── ${env} ──`);
    const tables = [
      ["locations", `SELECT id,name,merchant_id,created_at FROM locations WHERE merchant_id IS NULL LIMIT 10`],
      ["merchant_prospects", `SELECT id,business_name,agent_id,created_at FROM merchant_prospects WHERE agent_id IS NULL LIMIT 10`],
      ["agents", `SELECT id,first_name,last_name,email,phone FROM agents WHERE email IS NULL OR phone IS NULL LIMIT 10`],
      ["campaigns", `SELECT id,name,acquirer FROM campaigns WHERE acquirer IS NULL LIMIT 10`],
    ];
    for (const [t,q] of tables) {
      try {
        const r:any = await db.execute(dsql.raw(q));
        if (r.rows?.length) {
          console.log(` ${t}:`);
          for (const row of r.rows) console.log(`   `, JSON.stringify(row));
        }
      } catch(e:any){ console.log(`  ${t}: ERR ${e.message?.slice(0,90)}`)}
    }
    // Anchor for placeholder assignment
    const m:any = await db.execute(dsql.raw(`SELECT id,business_name FROM merchants ORDER BY id LIMIT 1`));
    const a:any = await db.execute(dsql.raw(`SELECT id,first_name,last_name FROM agents ORDER BY id LIMIT 1`));
    console.log(`  anchor merchant:`, m.rows?.[0]);
    console.log(`  anchor agent:`, a.rows?.[0]);
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
