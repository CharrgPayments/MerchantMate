import { Pool } from "pg";
import { backfillAgentClosure, backfillMerchantClosure } from "../server/hierarchyService";
import { drizzle } from "drizzle-orm/node-postgres";

async function migrate(label: string, url: string) {
  console.log(`\n=== ${label} ===`);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_agent_id INTEGER`);
    await client.query(`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS parent_merchant_id INTEGER`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_hierarchy (
        ancestor_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        descendant_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        depth INTEGER NOT NULL,
        PRIMARY KEY (ancestor_id, descendant_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS agent_hier_anc_idx ON agent_hierarchy(ancestor_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS agent_hier_desc_idx ON agent_hierarchy(descendant_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchant_hierarchy (
        ancestor_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        descendant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        depth INTEGER NOT NULL,
        PRIMARY KEY (ancestor_id, descendant_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS merchant_hier_anc_idx ON merchant_hierarchy(ancestor_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS merchant_hier_desc_idx ON merchant_hierarchy(descendant_id)`);

    // Add self-FK on parent columns (separately so failure doesn't kill the rest)
    try {
      await client.query(`
        ALTER TABLE agents ADD CONSTRAINT agents_parent_agent_fk
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id) ON DELETE SET NULL
      `);
    } catch (e: any) { if (!String(e.message).includes("already exists")) throw e; }
    try {
      await client.query(`
        ALTER TABLE merchants ADD CONSTRAINT merchants_parent_merchant_fk
        FOREIGN KEY (parent_merchant_id) REFERENCES merchants(id) ON DELETE SET NULL
      `);
    } catch (e: any) { if (!String(e.message).includes("already exists")) throw e; }

    await client.query("COMMIT");
    console.log("Schema applied.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Backfill closure tables using drizzle (gives us the helper)
  const db = drizzle(pool);
  await backfillAgentClosure(db);
  await backfillMerchantClosure(db);
  const { rows: a } = await pool.query("SELECT COUNT(*)::int AS c FROM agent_hierarchy");
  const { rows: m } = await pool.query("SELECT COUNT(*)::int AS c FROM merchant_hierarchy");
  console.log(`Closure rows — agents: ${a[0].c}, merchants: ${m[0].c}`);
  await pool.end();
}

(async () => {
  const prodUrl = process.env.DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;
  if (!prodUrl) throw new Error("DATABASE_URL not set");
  await migrate("PRODUCTION", prodUrl);
  if (devUrl && devUrl !== prodUrl) {
    await migrate("DEVELOPMENT", devUrl);
  } else {
    console.log("\n(no separate DEV_DATABASE_URL — skipping dev push)");
  }
  console.log("\nDone.");
})().catch((e) => { console.error(e); process.exit(1); });
