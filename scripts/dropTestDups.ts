import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
const drops: [string,string][] = [
  ["company_addresses",        "unique_company_address_type"],
  ["stage_api_configs",        "stage_api_configs_stage_id_unique"],
  ["schema_migrations",        "schema_migrations_migration_id_key"],
  ["role_definitions",         "role_definitions_code_key"],
  ["workflow_ticket_stages",   "workflow_ticket_stages_ticket_id_stage_id_unique"],
  ["disclosure_contents",      "disclosure_contents_slug_unique"],
  ["disclosure_contents",      "disclosure_contents_slug_version_unique"],
  ["user_company_associations","unique_user_company"],
  ["api_integration_configs",  "api_integration_configs_integration_key_unique"],
];
async function main() {
  const db = getDynamicDatabase("test");
  await db.execute(dsql.raw(`SET lock_timeout='5s'`));
  for (const [t,c] of drops) {
    try {
      await db.execute(dsql.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${c}"`));
      console.log(`  OK  drop ${t}.${c}`);
    } catch(e:any){ console.log(`  ERR ${t}.${c} → ${e.message?.slice(0,140)}`); }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
