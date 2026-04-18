import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

export type Env = "development" | "test" | "production";

export type StmtKind =
  | "create_table"
  | "drop_table"
  | "rename_table"
  | "add_column"
  | "drop_column"
  | "rename_column"
  | "alter_column_type"
  | "alter_column_default"
  | "alter_column_nullability"
  | "create_index"
  | "drop_index"
  | "add_constraint"
  | "drop_constraint"
  | "other";

export type StmtRisk = "safe" | "risky" | "ambiguous";

export interface PlanStatement {
  index: number;
  sql: string;
  kind: StmtKind;
  risk: StmtRisk;
  description: string;
}

export interface Plan {
  planId: string;
  targetEnv: Env;
  generatedAt: string;
  statements: PlanStatement[];
  promptsLog: string[];
  noChanges: boolean;
  hasAmbiguous: boolean;
  warnings: string[];
}

export interface SchemaSnapshot {
  env: Env;
  takenAt: string;
  file: string;
  tables: Record<
    string,
    {
      columns: Array<{
        name: string;
        type: string;
        nullable: boolean;
        default: string | null;
      }>;
      indexes: Array<{
        name: string;
        columns: string[];
        unique: boolean;
        primary: boolean;
      }>;
    }
  >;
}

export interface ApplyResult {
  success: boolean;
  appliedCount: number;
  failedAt?: number;
  error?: string;
  snapshotFile?: string;
  durationMs: number;
}

const ENV_VAR: Record<Env, string> = {
  development: "DEV_DATABASE_URL",
  test: "TEST_DATABASE_URL",
  production: "DATABASE_URL",
};

function urlFor(env: Env): string {
  const url = process.env[ENV_VAR[env]] || process.env.DATABASE_URL;
  if (!url) throw new Error(`No database URL configured for env=${env}`);
  return url;
}

function backupsDir(): string {
  const dir = path.join(process.cwd(), "migrations", "schema-backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------- Introspection / Snapshots ----------------

export async function introspectSchema(env: Env): Promise<SchemaSnapshot["tables"]> {
  const pool = new Pool({ connectionString: urlFor(env), max: 2 });
  try {
    const cols = await pool.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema='public'
       ORDER BY table_name, ordinal_position`,
    );
    const idx = await pool.query(
      `SELECT t.relname AS table_name,
              i.relname AS index_name,
              array_agg(a.attname ORDER BY c.ordinality) AS columns,
              ix.indisunique AS is_unique,
              ix.indisprimary AS is_primary
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN unnest(ix.indkey) WITH ORDINALITY AS c(colnum, ordinality) ON true
       JOIN pg_attribute a ON t.oid = a.attrelid AND a.attnum = c.colnum
       WHERE t.relkind='r'
         AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
       GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary
       ORDER BY t.relname, i.relname`,
    );

    const tables: SchemaSnapshot["tables"] = {};
    for (const r of cols.rows as any[]) {
      const t = r.table_name as string;
      tables[t] = tables[t] || { columns: [], indexes: [] };
      tables[t].columns.push({
        name: r.column_name,
        type: r.data_type === "ARRAY" ? `${r.udt_name}[]` : r.data_type,
        nullable: r.is_nullable === "YES",
        default: r.column_default,
      });
    }
    for (const r of idx.rows as any[]) {
      const t = r.table_name as string;
      if (!tables[t]) tables[t] = { columns: [], indexes: [] };
      tables[t].indexes.push({
        name: r.index_name,
        columns: r.columns,
        unique: r.is_unique,
        primary: r.is_primary,
      });
    }
    return tables;
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function snapshotSchema(env: Env): Promise<SchemaSnapshot> {
  const tables = await introspectSchema(env);
  const takenAt = new Date().toISOString();
  const file = path.join(
    backupsDir(),
    `${env}-snapshot-${takenAt.replace(/[:.]/g, "-")}.json`,
  );
  const snapshot: SchemaSnapshot = { env, takenAt, file, tables };
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export function listSnapshots(env?: Env) {
  const dir = backupsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && (!env || f.startsWith(`${env}-snapshot-`)))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { file: full, name: f, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

export function loadSnapshot(file: string): SchemaSnapshot {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ---------------- Plan generation ----------------

const planCache = new Map<string, Plan>();
const PLAN_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of Array.from(planCache.entries())) {
    if (now - new Date(p.generatedAt).getTime() > PLAN_TTL_MS) planCache.delete(id);
  }
}, 5 * 60 * 1000).unref();

export function getPlan(planId: string): Plan | undefined {
  return planCache.get(planId);
}

export async function generatePlan(
  targetEnv: Env,
  renameAnswers: number[] = [],
): Promise<Plan> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "schema-sync-"));
  try {
    // Write the config inside the workspace so node_modules resolution works
    // for any imports drizzle-kit may need to do, and use a plain object export
    // (no imports) to avoid resolving "drizzle-kit" from a foreign tmp path.
    const wsTmp = path.join(process.cwd(), ".local", "schema-sync-tmp");
    fs.mkdirSync(wsTmp, { recursive: true });
    const cfgFile = path.join(wsTmp, `drizzle.config.${Date.now()}.ts`);
    fs.writeFileSync(
      cfgFile,
      `export default {
  out: ${JSON.stringify(tmp)},
  schema: ${JSON.stringify(path.join(process.cwd(), "shared", "schema.ts"))},
  dialect: "postgresql",
  dbCredentials: { url: process.env.SCHEMA_SYNC_TARGET_URL! },
};
`,
    );

    const promptsLog: string[] = [];

    // Helper: spawn drizzle-kit with stdin pre-fed for any prompts.
    const runDrizzle = (args: string[], label: string, timeoutMs = 90_000) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        const child = spawn("npx", ["drizzle-kit", ...args], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SCHEMA_SYNC_TARGET_URL: urlFor(targetEnv),
            FORCE_COLOR: "0",
            NO_COLOR: "1",
          },
        });

        const answers: string[] = [];
        for (let i = 0; i < 200; i++) answers.push(String(renameAnswers[i] ?? 0));
        try {
          child.stdin.write(answers.join("\n") + "\n");
          child.stdin.end();
        } catch {}

        child.stdout.on("data", (b) => {
          const s = b.toString();
          stdoutChunks.push(s);
          if (/created or renamed/i.test(s)) promptsLog.push(s.trim());
        });
        child.stderr.on("data", (b) => stderrChunks.push(b.toString()));

        const killer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          reject(new Error(`drizzle-kit ${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        child.on("error", (e) => {
          clearTimeout(killer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(killer);
          const stdout = stdoutChunks.join("");
          const stderr = stderrChunks.join("");
          if (code === 0) resolve({ stdout, stderr });
          else
            reject(
              new Error(
                `drizzle-kit ${label} exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
              ),
            );
        });
      });

    // Step 1: introspect the live target DB into `tmp` so drizzle-kit has a
    // baseline snapshot in tmp/meta/. This produces a 0000_*.sql + meta entry.
    await runDrizzle(["introspect", "--config", cfgFile], "introspect");

    // After introspect, drizzle wrote a `schema.ts` into the out dir. We must
    // point the next generate at OUR schema.ts (already set in cfgFile.schema)
    // so the diff is OUR schema vs the introspected snapshot.
    // Wipe the SQL file produced by introspect (not the meta/) so we can
    // unambiguously identify the new diff file.
    for (const f of fs.readdirSync(tmp)) {
      if (f.endsWith(".sql")) fs.unlinkSync(path.join(tmp, f));
    }

    // Step 2: generate the diff (schema.ts vs snapshot from introspect)
    await runDrizzle(
      ["generate", "--config", cfgFile, "--name", "schema_sync_plan"],
      "generate",
    );

    // Locate the produced SQL file (drizzle names it like 0001_<name>.sql in `out`)
    const sqlFile = fs
      .readdirSync(tmp)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => path.join(tmp, f))[0];

    let statements: PlanStatement[] = [];
    let noChanges = false;
    if (!sqlFile) {
      noChanges = true;
    } else {
      const sql = fs.readFileSync(sqlFile, "utf8");
      const raw = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^--/.test(s.split("\n")[0]?.trim() ?? ""));
      statements = raw.map((s, i) => classifyStatement(s, i));
      if (statements.length === 0) noChanges = true;
    }

    const planId = crypto.randomUUID();
    const warnings: string[] = [];
    const dropTables = statements.filter((s) => s.kind === "drop_table").length;
    const dropCols = statements.filter((s) => s.kind === "drop_column").length;
    if (dropTables > 0)
      warnings.push(`${dropTables} DROP TABLE statement(s) will permanently delete data.`);
    if (dropCols > 0)
      warnings.push(`${dropCols} DROP COLUMN statement(s) will permanently delete data.`);
    const plan: Plan = {
      planId,
      targetEnv,
      generatedAt: new Date().toISOString(),
      statements,
      promptsLog,
      noChanges,
      hasAmbiguous: promptsLog.length > 0,
      warnings,
    };
    planCache.set(planId, plan);
    return plan;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

export function classifyStatement(sqlIn: string, index: number): PlanStatement {
  const sql = sqlIn.replace(/\s+/g, " ").trim();
  const upper = sql.toUpperCase();

  let kind: StmtKind = "other";
  let risk: StmtRisk = "risky";
  let description = sql.slice(0, 200);

  const m = (re: RegExp) => sql.match(re);

  if (/^CREATE TABLE\b/i.test(sql)) {
    kind = "create_table";
    risk = "safe";
    const t = m(/^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([\w.]+)"?/i)?.[1];
    description = `Create table ${t ?? "?"}`;
  } else if (/^DROP TABLE\b/i.test(sql)) {
    kind = "drop_table";
    risk = "risky";
    description = `Drop table ${m(/^DROP TABLE(?:\s+IF EXISTS)?\s+"?([\w.]+)"?/i)?.[1] ?? "?"}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bRENAME TO\b/i.test(sql)) {
    kind = "rename_table";
    risk = "ambiguous";
    const mt = m(/^ALTER TABLE\s+"?([\w.]+)"?\s+RENAME TO\s+"?([\w.]+)"?/i);
    description = `Rename table ${mt?.[1]} → ${mt?.[2]}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bRENAME COLUMN\b/i.test(sql)) {
    kind = "rename_column";
    risk = "ambiguous";
    const mt = m(/RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i);
    description = `Rename column ${mt?.[1]} → ${mt?.[2]}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bADD COLUMN\b/i.test(sql)) {
    kind = "add_column";
    const tableName = m(/^ALTER TABLE\s+"?([\w.]+)"?/i)?.[1];
    const colName = m(/ADD COLUMN\s+"?(\w+)"?/i)?.[1];
    const isNotNull = /\bNOT NULL\b/i.test(sql);
    const hasDefault = /\bDEFAULT\b/i.test(sql);
    risk = isNotNull && !hasDefault ? "risky" : "safe";
    description = `Add column ${tableName}.${colName}${isNotNull ? " NOT NULL" : ""}${hasDefault ? " (with default)" : ""}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bDROP COLUMN\b/i.test(sql)) {
    kind = "drop_column";
    risk = "risky";
    const t = m(/^ALTER TABLE\s+"?([\w.]+)"?/i)?.[1];
    const c = m(/DROP COLUMN\s+(?:IF EXISTS\s+)?"?(\w+)"?/i)?.[1];
    description = `Drop column ${t}.${c}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bALTER COLUMN\b/i.test(sql) && /\bSET DATA TYPE\b/i.test(sql)) {
    kind = "alter_column_type";
    risk = "risky";
    const t = m(/^ALTER TABLE\s+"?([\w.]+)"?/i)?.[1];
    const c = m(/ALTER COLUMN\s+"?(\w+)"?/i)?.[1];
    const ty = m(/SET DATA TYPE\s+([^,;]+)/i)?.[1]?.trim();
    description = `Alter ${t}.${c} type → ${ty}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bALTER COLUMN\b/i.test(sql) && /\bDEFAULT\b/i.test(sql)) {
    kind = "alter_column_default";
    risk = "safe";
    description = sql.slice(0, 160);
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bALTER COLUMN\b/i.test(sql) && /\b(NOT NULL|DROP NOT NULL)\b/i.test(sql)) {
    kind = "alter_column_nullability";
    risk = /\bSET NOT NULL\b/i.test(sql) ? "risky" : "safe";
    description = sql.slice(0, 160);
  } else if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql)) {
    kind = "create_index";
    risk = "safe";
    const n = m(/^CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/i)?.[1];
    description = `Create index ${n}`;
  } else if (/^DROP\s+INDEX\b/i.test(sql)) {
    kind = "drop_index";
    risk = "risky";
    description = `Drop index ${m(/^DROP\s+INDEX(?:\s+IF EXISTS)?\s+"?(\w+)"?/i)?.[1] ?? "?"}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bADD CONSTRAINT\b/i.test(sql)) {
    kind = "add_constraint";
    risk = "safe";
    const n = m(/ADD CONSTRAINT\s+"?(\w+)"?/i)?.[1];
    description = `Add constraint ${n}`;
  } else if (/^ALTER TABLE\b/i.test(sql) && /\bDROP CONSTRAINT\b/i.test(sql)) {
    kind = "drop_constraint";
    risk = "risky";
    const n = m(/DROP CONSTRAINT\s+(?:IF EXISTS\s+)?"?(\w+)"?/i)?.[1];
    description = `Drop constraint ${n}`;
  } else if (/^CREATE TYPE\b/i.test(upper) || /^CREATE SCHEMA\b/i.test(upper)) {
    kind = "other";
    risk = "safe";
    description = sql.slice(0, 160);
  }

  return { index, sql: sqlIn.trim(), kind, risk, description };
}

// ---------------- Apply / Rollback ----------------

export interface ApplyEvent {
  type: "snapshot" | "begin" | "statement" | "commit" | "rollback" | "done" | "error";
  message?: string;
  index?: number;
  total?: number;
  ok?: boolean;
  error?: string;
  snapshotFile?: string;
}

export async function applyPlan(
  plan: Plan,
  opts: { confirmProd?: boolean } = {},
  onEvent?: (e: ApplyEvent) => void,
): Promise<ApplyResult> {
  const start = Date.now();
  const emit = (e: ApplyEvent) => {
    try {
      onEvent?.(e);
    } catch {}
  };

  if (plan.targetEnv === "production" && !opts.confirmProd) {
    return {
      success: false,
      appliedCount: 0,
      error: "Production apply requires explicit confirmation",
      durationMs: Date.now() - start,
    };
  }
  if (plan.noChanges || plan.statements.length === 0) {
    emit({ type: "done", ok: true, message: "No changes to apply" });
    return { success: true, appliedCount: 0, durationMs: Date.now() - start };
  }

  let snapshotFile: string | undefined;
  try {
    const snap = await snapshotSchema(plan.targetEnv);
    snapshotFile = snap.file;
    emit({ type: "snapshot", snapshotFile, message: `Snapshot saved` });
  } catch (e: any) {
    emit({ type: "error", error: `Snapshot failed: ${e?.message ?? e}` });
    return {
      success: false,
      appliedCount: 0,
      error: `Snapshot failed: ${e?.message ?? e}`,
      durationMs: Date.now() - start,
    };
  }

  const pool = new Pool({ connectionString: urlFor(plan.targetEnv), max: 2 });
  const client = await pool.connect();
  try {
    emit({ type: "begin" });
    await client.query("BEGIN");
    let i = 0;
    for (; i < plan.statements.length; i++) {
      const s = plan.statements[i];
      try {
        await client.query(s.sql);
        emit({
          type: "statement",
          index: i,
          total: plan.statements.length,
          ok: true,
          message: s.description,
        });
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        emit({
          type: "statement",
          index: i,
          total: plan.statements.length,
          ok: false,
          error: e?.message ?? String(e),
          message: s.description,
        });
        emit({ type: "rollback" });
        return {
          success: false,
          appliedCount: i,
          failedAt: i,
          error: `Statement ${i + 1} failed: ${e?.message ?? e}`,
          snapshotFile,
          durationMs: Date.now() - start,
        };
      }
    }
    await client.query("COMMIT");
    emit({ type: "commit" });
    emit({ type: "done", ok: true, message: `Applied ${i} statement(s)` });
    return {
      success: true,
      appliedCount: i,
      snapshotFile,
      durationMs: Date.now() - start,
    };
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// Compute inverse SQL from snapshot (live → snapshot)
export async function rollback(
  env: Env,
  snapshotFile?: string,
  onEvent?: (e: ApplyEvent) => void,
): Promise<ApplyResult> {
  const start = Date.now();
  const emit = (e: ApplyEvent) => {
    try {
      onEvent?.(e);
    } catch {}
  };

  const snaps = listSnapshots(env);
  const useFile =
    snapshotFile ??
    snaps.find((s) => s.name.startsWith(`${env}-snapshot-`))?.file;
  if (!useFile) {
    return {
      success: false,
      appliedCount: 0,
      error: `No snapshot available for ${env}`,
      durationMs: Date.now() - start,
    };
  }

  const snap = loadSnapshot(useFile);
  const live = await introspectSchema(env);

  const inverse: string[] = [];

  // Tables that exist live but not in snapshot → drop
  for (const t of Object.keys(live)) {
    if (!snap.tables[t]) inverse.push(`DROP TABLE IF EXISTS "${t}" CASCADE;`);
  }
  // For shared tables, reconcile columns
  for (const [t, snapT] of Object.entries(snap.tables)) {
    const liveT = live[t];
    if (!liveT) {
      // Table missing live but present in snapshot — we cannot reliably
      // recreate the full table from snapshot JSON (FKs etc). Note it.
      emit({
        type: "statement",
        ok: false,
        error: `Table ${t} present in snapshot but missing live; manual restore required`,
      });
      continue;
    }
    const liveCols = new Set<string>(liveT.columns.map((c) => c.name));
    const snapCols = new Set<string>(snapT.columns.map((c) => c.name));
    // Columns added since snapshot → drop
    for (const c of Array.from(liveCols)) {
      if (!snapCols.has(c)) inverse.push(`ALTER TABLE "${t}" DROP COLUMN IF EXISTS "${c}";`);
    }
    // Columns removed since snapshot → add back as nullable
    for (const c of snapT.columns) {
      if (!liveCols.has(c.name)) {
        const def = c.default ? ` DEFAULT ${c.default}` : "";
        inverse.push(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${c.name}" ${c.type}${def};`);
      }
    }
  }

  if (inverse.length === 0) {
    emit({ type: "done", ok: true, message: "Schema already matches snapshot" });
    return { success: true, appliedCount: 0, snapshotFile: useFile, durationMs: Date.now() - start };
  }

  const pool = new Pool({ connectionString: urlFor(env), max: 2 });
  const client = await pool.connect();
  try {
    emit({ type: "begin" });
    await client.query("BEGIN");
    let i = 0;
    for (; i < inverse.length; i++) {
      const sql = inverse[i];
      try {
        await client.query(sql);
        emit({ type: "statement", index: i, total: inverse.length, ok: true, message: sql });
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        emit({ type: "statement", index: i, total: inverse.length, ok: false, error: e?.message ?? String(e), message: sql });
        emit({ type: "rollback" });
        return {
          success: false,
          appliedCount: i,
          failedAt: i,
          error: `Rollback statement ${i + 1} failed: ${e?.message ?? e}`,
          snapshotFile: useFile,
          durationMs: Date.now() - start,
        };
      }
    }
    await client.query("COMMIT");
    emit({ type: "commit" });
    emit({ type: "done", ok: true, message: `Rolled back ${i} change(s)` });
    return { success: true, appliedCount: i, snapshotFile: useFile, durationMs: Date.now() - start };
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}
