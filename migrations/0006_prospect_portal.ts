import { Pool } from "pg";

async function migrate(pool: Pool, label: string) {
  console.log(`\n=== Migrating ${label} ===`);

  // Add portal auth columns to merchant_prospects
  await pool.query(`
    ALTER TABLE merchant_prospects
      ADD COLUMN IF NOT EXISTS portal_password_hash text,
      ADD COLUMN IF NOT EXISTS portal_setup_at timestamp;
  `);
  console.log("✓ merchant_prospects: added portal_password_hash, portal_setup_at");

  // Create prospect_file_requests table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospect_file_requests (
      id serial PRIMARY KEY,
      prospect_id integer NOT NULL REFERENCES merchant_prospects(id) ON DELETE CASCADE,
      label text NOT NULL,
      description text,
      required boolean NOT NULL DEFAULT true,
      status text NOT NULL DEFAULT 'pending',
      file_name text,
      mime_type text,
      file_data text,
      uploaded_by varchar,
      created_at timestamp NOT NULL DEFAULT now(),
      fulfilled_at timestamp
    );
  `);
  console.log("✓ prospect_file_requests: created");
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
