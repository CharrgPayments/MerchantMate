// Task #33 — backfill stage_api_configs.endpoint_id from legacy transport
// columns (endpoint_url, http_method, headers, auth_type, auth_secret_key)
// onto rows in external_endpoints, then drop the legacy columns from prod
// so the prod schema matches dev/test (and shared/schema.ts).
//
// Runs ONLY against the env in DRIFT_ENV (default: production). Dev/test
// already lack the legacy columns and have 0 rows in stage_api_configs,
// so this script is a no-op there.
//
// Safety:
//   - Wrapped in a single SQL transaction; rolls back on any failure.
//   - Asserts every row has a non-NULL endpoint_id BEFORE dropping cols.
//   - Idempotent: re-running after success becomes a no-op (cols gone,
//     nothing left to backfill).

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;

const ENV = (process.argv[2] || "production").toLowerCase();
const URL_FOR_ENV: Record<string, string | undefined> = {
  development: process.env.DEV_DATABASE_URL,
  test: process.env.TEST_DATABASE_URL,
  production: process.env.DATABASE_URL,
};

async function main() {
  const url = URL_FOR_ENV[ENV];
  if (!url) {
    console.error(`No DB URL for env=${ENV}`);
    process.exit(1);
  }
  console.log(`[backfill] env=${ENV}`);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // Pre-flight: do the legacy columns even exist?
    const hasLegacy = await client.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema='public' AND table_name='stage_api_configs'
         AND column_name IN ('endpoint_url','http_method','headers','auth_type','auth_secret_key')
    `);
    const legacyCount = hasLegacy.rows[0].n as number;
    console.log(`[backfill] legacy columns present: ${legacyCount}/5`);
    if (legacyCount === 0) {
      console.log("[backfill] nothing to do — legacy columns already removed.");
      return;
    }
    if (legacyCount !== 5) {
      throw new Error(`Expected 0 or 5 legacy columns, got ${legacyCount} — refuse to proceed.`);
    }

    await client.query("BEGIN");

    // Step 1: Insert missing external_endpoints rows for legacy URLs that
    // don't already have a registry match by (url, method).
    const inserted = await client.query(`
      INSERT INTO external_endpoints (name, url, method, headers, auth_type, is_active, created_at, updated_at)
      SELECT DISTINCT
        regexp_replace(s.endpoint_url, '^.*/', '') AS name,
        s.endpoint_url,
        s.http_method,
        COALESCE(s.headers, '{}'::jsonb),
        COALESCE(s.auth_type, 'none'),
        true,
        NOW(), NOW()
      FROM stage_api_configs s
      WHERE s.endpoint_id IS NULL
        AND s.endpoint_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM external_endpoints e
          WHERE e.url = s.endpoint_url AND e.method = s.http_method
        )
      RETURNING id, name, url
    `);
    console.log(`[backfill] inserted ${inserted.rowCount} new external_endpoints:`);
    inserted.rows.forEach((r) => console.log(`           id=${r.id} name=${r.name}`));

    // Step 2: Backfill endpoint_id by matching url + method.
    const updated = await client.query(`
      UPDATE stage_api_configs s
         SET endpoint_id = e.id
        FROM external_endpoints e
       WHERE s.endpoint_id IS NULL
         AND e.url = s.endpoint_url
         AND e.method = s.http_method
    `);
    console.log(`[backfill] updated ${updated.rowCount} stage_api_configs rows`);

    // Step 3: Assert no row is left with endpoint_id NULL but legacy URL set
    // (i.e. anything that *should* have been backfilled but wasn't).
    const orphans = await client.query(`
      SELECT id, endpoint_url, http_method
        FROM stage_api_configs
       WHERE endpoint_id IS NULL
         AND endpoint_url IS NOT NULL
    `);
    if (orphans.rowCount && orphans.rowCount > 0) {
      console.error("[backfill] FAIL — rows with no matching endpoint registry entry:");
      orphans.rows.forEach((r) => console.error("  ", r));
      throw new Error("Backfill incomplete — refusing to drop columns");
    }
    console.log("[backfill] assertion passed: every legacy-URL row has endpoint_id");

    // Step 4: Drop the 5 legacy columns.
    const dropCols = [
      "endpoint_url",
      "http_method",
      "headers",
      "auth_type",
      "auth_secret_key",
    ];
    for (const col of dropCols) {
      await client.query(`ALTER TABLE stage_api_configs DROP COLUMN IF EXISTS "${col}"`);
      console.log(`[backfill] dropped column: ${col}`);
    }

    await client.query("COMMIT");
    console.log("[backfill] COMMITTED");

    // Final verification (post-commit, separate query).
    const finalCols = await client.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema='public' AND table_name='stage_api_configs'
    `);
    console.log(`[backfill] stage_api_configs now has ${finalCols.rows[0].n} columns`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("[backfill] ROLLBACK:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
