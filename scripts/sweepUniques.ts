// Compare unique constraints declared in shared/schema.ts vs what each env actually has.
// Add any missing ones. Outputs a clean diff per env.
import * as schema from "../shared/schema";
import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

interface UniqDef { name: string; table: string; cols: string[] }

function declaredUniques(): UniqDef[] {
  const out: UniqDef[] = [];
  for (const v of Object.values(schema as any)) {
    if (!v || typeof v !== "object") continue;
    try {
      const cfg = getTableConfig(v as PgTable);
      const tname = cfg.name;
      for (const u of cfg.uniqueConstraints ?? []) {
        const cols = u.columns.map((c: any) => c.name);
        out.push({ name: u.name ?? `${tname}_${cols.join("_")}_unique`, table: tname, cols });
      }
      // Column-level .unique() — captured on the column itself
      for (const col of cfg.columns ?? []) {
        const c: any = col;
        if (c.isUnique) {
          out.push({
            name: c.uniqueName ?? `${tname}_${c.name}_unique`,
            table: tname,
            cols: [c.name],
          });
        }
      }
    } catch { /* not a table */ }
  }
  return out;
}

async function existingUniques(env: "production"|"test"|"development", tables: string[]) {
  const db = getDynamicDatabase(env);
  const r:any = await db.execute(dsql.raw(`
    SELECT c.relname AS table_name, con.conname,
           array_agg(a.attname ORDER BY u.ord) AS cols
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN unnest(con.conkey) WITH ORDINALITY u(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
    WHERE con.contype='u'
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
    GROUP BY c.relname, con.conname`));
  return r.rows as { table_name: string; conname: string; cols: string[] }[];
}

async function main() {
  const declared = declaredUniques();
  console.log(`Declared unique constraints in schema.ts: ${declared.length}`);
  for (const env of ["production","test","development"] as const) {
    console.log(`\n── ${env} ──`);
    const existing = await existingUniques(env, declared.map(d=>d.table));
    const existingByTableCols = new Map<string,string>();
    for (const e of existing) existingByTableCols.set(`${e.table_name}|${[...e.cols].sort().join(",")}`, e.conname);
    const missing: UniqDef[] = [];
    for (const d of declared) {
      const key = `${d.table}|${[...d.cols].sort().join(",")}`;
      if (!existingByTableCols.has(key)) missing.push(d);
    }
    console.log(`  missing: ${missing.length}`);
    const db = getDynamicDatabase(env);
    await db.execute(dsql.raw(`SET lock_timeout='5s'`));
    for (const m of missing) {
      const stmt = `ALTER TABLE "${m.table}" ADD CONSTRAINT "${m.name}" UNIQUE (${m.cols.map(c=>`"${c}"`).join(",")})`;
      try { await db.execute(dsql.raw(stmt)); console.log(`  +  ${m.table}(${m.cols.join(",")}) as ${m.name}`); }
      catch(e:any){ console.log(`  !  ${m.table}(${m.cols.join(",")}) → ${e.message?.slice(0,140)}`); }
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
