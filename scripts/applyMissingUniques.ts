import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
async function go(env: "production"|"test"|"development", stmt: string, label: string) {
  const db = getDynamicDatabase(env);
  try {
    await db.execute(dsql.raw(`SET lock_timeout='5s'`));
    await db.execute(dsql.raw(stmt));
    console.log(`  OK  [${env}] ${label}`);
  } catch(e:any) {
    console.log(`  ERR [${env}] ${label} → ${e.message?.slice(0,140)}`);
  }
}
async function main() {
  await go("production", `ALTER TABLE "campaign_application_templates" ADD CONSTRAINT "campaign_application_templates_campaign_id_template_id_unique" UNIQUE ("campaign_id","template_id")`, "campaign_application_templates(campaign_id,template_id)");
  await go("test", `ALTER TABLE "acquirer_application_templates" ADD CONSTRAINT "acquirer_application_templates_acquirer_id_template_name_version_unique" UNIQUE ("acquirer_id","template_name","version")`, "acquirer_application_templates(acquirer_id,template_name,version)");
  await go("development", `ALTER TABLE "agents" ADD CONSTRAINT "agents_email_unique" UNIQUE ("email")`, "agents(email)");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
