import { Pool } from "pg";

async function migrate(pool: Pool, label: string) {
  console.log(`\n=== role_action_grants in ${label} ===`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_action_grants (
      role_code varchar(50) NOT NULL,
      action varchar(100) NOT NULL,
      scope varchar(20) NOT NULL,
      updated_at timestamp DEFAULT now(),
      updated_by varchar,
      PRIMARY KEY (role_code, action)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_action_audit (
      id serial PRIMARY KEY,
      role_code varchar(50) NOT NULL,
      action varchar(100) NOT NULL,
      prev_scope varchar(20),
      new_scope varchar(20),
      changed_by varchar,
      changed_at timestamp DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS role_action_audit_role_action_idx
      ON role_action_audit (role_code, action, changed_at DESC);
  `);
  console.log("  ✓ tables ready");
}

async function main() {
  const prodUrl = process.env.DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;
  if (prodUrl) {
    const p = new Pool({ connectionString: prodUrl });
    await migrate(p, "PROD");
    await p.end();
  }
  if (devUrl && devUrl !== prodUrl) {
    const p = new Pool({ connectionString: devUrl });
    await migrate(p, "DEV");
    await p.end();
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
