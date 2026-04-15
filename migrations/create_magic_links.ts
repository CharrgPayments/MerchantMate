import { Pool } from "pg";

async function migrate(pool: Pool, label: string) {
  console.log(`\n=== Migrating ${label} ===`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_magic_links (
      id SERIAL PRIMARY KEY,
      prospect_id INTEGER NOT NULL REFERENCES merchant_prospects(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_magic_links_token ON portal_magic_links(token);
    CREATE INDEX IF NOT EXISTS idx_magic_links_prospect ON portal_magic_links(prospect_id);
  `);
  console.log("✓ portal_magic_links: created");
}

async function main() {
  const devPool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  const prodPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(devPool, "DEV");
  await migrate(prodPool, "PROD");
  await devPool.end();
  await prodPool.end();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
