import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
const drops: [string,string][] = [
  ["companies",            "companies_name_unique"],
  ["signature_requests",   "signature_requests_request_token_unique"],
  ["email_wrappers",       "email_wrappers_name_unique"],
  ["workflow_definitions", "workflow_definitions_code_unique"],
  ["workflow_definitions", "workflow_definitions_code_version_unique"],
  ["mcc_policies",         "mcc_policies_mcc_code_id_acquirer_id_unique"],
  ["rbac_resources",       "rbac_resources_resource_key_unique"],
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
