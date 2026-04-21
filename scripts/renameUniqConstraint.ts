import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
const NEW_NAME = "acq_app_tmpl_acq_name_ver_uniq";
async function fix(env: "production"|"test"|"development") {
  const db = getDynamicDatabase(env);
  await db.execute(dsql.raw(`SET lock_timeout='5s'`));
  // Find any existing unique constraint on (acquirer_id, template_name, version)
  const r:any = await db.execute(dsql.raw(`
    SELECT conname FROM pg_constraint
    WHERE conrelid='acquirer_application_templates'::regclass
      AND contype='u'`));
  const names = r.rows.map((x:any)=>x.conname);
  console.log(`  [${env}] existing unique constraints:`, names);
  for (const name of names) {
    if (name === NEW_NAME) { console.log(`  [${env}] already renamed`); return; }
    await db.execute(dsql.raw(`ALTER TABLE "acquirer_application_templates" RENAME CONSTRAINT "${name}" TO "${NEW_NAME}"`));
    console.log(`  [${env}] renamed ${name} → ${NEW_NAME}`);
  }
}
async function main() {
  for (const env of ["production","test","development"] as const) {
    try { await fix(env); }
    catch(e:any) { console.log(`  [${env}] ERR ${e.message?.slice(0,140)}`); }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
