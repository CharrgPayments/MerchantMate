import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
async function main() {
  const db = getDynamicDatabase("test");
  await db.execute(dsql.raw(`SET lock_timeout='5s'`));
  // Remove orphan trigger_actions rows that block trigger_actions→trigger_catalog FK re-add
  const r:any = await db.execute(dsql.raw(`DELETE FROM trigger_actions WHERE trigger_id NOT IN (SELECT id FROM trigger_catalog)`));
  console.log(`  cleaned trigger_actions orphans: ${r.rowCount ?? 0} rows`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
