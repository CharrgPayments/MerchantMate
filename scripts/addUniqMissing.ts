import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
const STMT = `ALTER TABLE "acquirer_application_templates" ADD CONSTRAINT "acq_app_tmpl_acq_name_ver_uniq" UNIQUE ("acquirer_id","template_name","version")`;
async function main() {
  for (const env of ["production","development"] as const) {
    const db = getDynamicDatabase(env);
    try {
      await db.execute(dsql.raw(`SET lock_timeout='5s'`));
      await db.execute(dsql.raw(STMT));
      console.log(`  OK  [${env}] added acq_app_tmpl_acq_name_ver_uniq`);
    } catch(e:any) {
      console.log(`  ERR [${env}] ${e.message?.slice(0,140)}`);
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
