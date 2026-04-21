import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
async function main() {
  const db = getDynamicDatabase("test");
  const r:any = await db.execute(dsql.raw(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'acquirer_application_templates'::regclass AND contype='u'`));
  for (const row of r.rows) console.log(row);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
