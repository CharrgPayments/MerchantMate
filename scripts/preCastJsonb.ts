import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
async function main() {
  const target = process.argv[2];
  const db = getDynamicDatabase("production");
  // short lock timeout so a hung session releases instead of blocking forever
  await db.execute(dsql.raw(`SET lock_timeout = '5s'`));
  await db.execute(dsql.raw(`SET statement_timeout = '15s'`));
  const all: Record<string,string> = {
    flags: `ALTER TABLE "audit_logs" ALTER COLUMN "compliance_flags" SET DATA TYPE jsonb USING to_jsonb(compliance_flags)`,
    tags:  `ALTER TABLE "audit_logs" ALTER COLUMN "tags" SET DATA TYPE jsonb USING to_jsonb(tags)`,
    sess:  `ALTER TABLE "sessions" ALTER COLUMN "sess" SET DATA TYPE jsonb USING sess::jsonb`,
  };
  const stmts = target ? [all[target]] : Object.values(all);
  for (const s of stmts) {
    const t0 = Date.now();
    try { await db.execute(dsql.raw(s)); console.log(`OK  (${Date.now()-t0}ms)`, s.slice(0,90)); }
    catch(e:any){ console.log(`ERR (${Date.now()-t0}ms)`, s.slice(0,90), "→", e.message?.slice(0,140)); }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
