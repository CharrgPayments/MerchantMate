import { Pool } from "pg";

const NEW_ROLES = [
  {
    code: "underwriter",
    label: "Underwriter",
    description:
      "Reviews merchant applications, runs risk checks, and recommends approval or decline. Cannot finalise approvals.",
    color: "default",
    permissions: [
      "view_all_merchants",
      "view_all_agents",
      "view_all_locations",
      "view_analytics",
      "view_reports",
    ],
    capabilities: [
      "View underwriting queue",
      "Review submitted applications",
      "Run KYC / KYB risk checks",
      "Recommend approval or decline",
    ],
  },
  {
    code: "senior_underwriter",
    label: "Senior Underwriter",
    description:
      "Has all underwriter capabilities plus authority to finalise approvals, declines, and exception overrides.",
    color: "destructive",
    permissions: [
      "view_all_users",
      "view_all_merchants",
      "edit_merchants",
      "view_all_agents",
      "view_all_locations",
      "view_all_transactions",
      "view_analytics",
      "view_reports",
      "view_financial_data",
      "export_data",
    ],
    capabilities: [
      "Approve or decline applications",
      "Override exceptions",
      "Reassign queue items",
      "Audit underwriter decisions",
    ],
  },
  {
    code: "data_processing",
    label: "Data Processing",
    description:
      "Processes batch data, manages MID setup, and reconciles processor responses. Limited to operational data only.",
    color: "secondary",
    permissions: [
      "view_all_merchants",
      "edit_merchants",
      "view_all_locations",
      "view_all_transactions",
      "edit_transactions",
      "view_reports",
    ],
    capabilities: [
      "Manage MID setup data",
      "Process batch reconciliation",
      "Edit transaction metadata",
      "Generate processing reports",
    ],
  },
  {
    code: "deployment",
    label: "Deployment",
    description:
      "Coordinates equipment shipping, terminal provisioning, and merchant go-live activities.",
    color: "outline",
    permissions: [
      "view_all_merchants",
      "view_all_locations",
      "edit_locations",
      "view_reports",
    ],
    capabilities: [
      "Track deployment / shipping status",
      "Provision terminals",
      "Coordinate merchant go-live",
      "View deployment reports",
    ],
  },
];

async function migrate(pool: Pool, label: string) {
  console.log(`\n=== Seeding new system roles in ${label} ===`);

  // Idempotent: ensure table exists (matches 0005)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_definitions (
      id serial PRIMARY KEY,
      code varchar(50) UNIQUE NOT NULL,
      label varchar(100) NOT NULL,
      description text,
      color varchar(50) DEFAULT 'secondary',
      is_system boolean DEFAULT false,
      permissions text[] DEFAULT ARRAY[]::text[],
      capabilities text[] DEFAULT ARRAY[]::text[],
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  for (const role of NEW_ROLES) {
    await pool.query(
      `INSERT INTO role_definitions (code, label, description, color, is_system, permissions, capabilities)
       VALUES ($1, $2, $3, $4, true, $5, $6)
       ON CONFLICT (code) DO NOTHING`,
      [role.code, role.label, role.description, role.color, role.permissions, role.capabilities],
    );
    console.log(`  ✓ ${role.code}`);
  }
}

async function main() {
  // Convention (matches scripts/migrate-hierarchy.ts):
  //   DATABASE_URL     → production
  //   DEV_DATABASE_URL → development (optional)
  const prodUrl = process.env.DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;

  if (prodUrl) {
    const prodPool = new Pool({ connectionString: prodUrl });
    await migrate(prodPool, "PROD");
    await prodPool.end();
  } else {
    console.log("(no DATABASE_URL — skipping prod seed)");
  }

  if (devUrl && devUrl !== prodUrl) {
    const devPool = new Pool({ connectionString: devUrl });
    await migrate(devPool, "DEV");
    await devPool.end();
  } else {
    console.log("(no separate DEV_DATABASE_URL — skipping dev seed)");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
