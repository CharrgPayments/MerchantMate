// db-tier-allow: schemaSync.ts performs cross-environment schema
// introspection and DDL planning. It must construct dedicated pools
// per target environment (production/test/development) to read
// information_schema and pg_catalog, which Drizzle does not model.
// All pools are created and disposed within the sync lifecycle —
// never bound to a request — so the per-request env-isolation
// guarantee is unaffected.
import * as fs from "fs";
import * as path from "path";
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

// ---------------- Promotion gating (dev → test → prod) ----------------

function certificationsFile(): string {
  const dir = path.join(process.cwd(), "migrations", "schema-backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "certifications.json");
}

interface Certification {
  sha: string;            // sha256 of normalized statements
  certifiedAt: string;
  certifiedBy?: string;   // userId if known
  statementCount: number;
  snapshotFile?: string;  // pre-apply snapshot of test
}

function readCerts(): Certification[] {
  try {
    const f = certificationsFile();
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, "utf8")) as Certification[];
  } catch {
    return [];
  }
}

function writeCerts(certs: Certification[]) {
  fs.writeFileSync(certificationsFile(), JSON.stringify(certs, null, 2));
}

export function planSha(plan: Plan): string {
  const norm = plan.statements
    .map((s) => s.sql.replace(/\s+/g, " ").trim())
    .join("\n;\n");
  return crypto.createHash("sha256").update(norm).digest("hex");
}

export function isPlanCertified(plan: Plan): { certified: boolean; record?: Certification } {
  const sha = planSha(plan);
  const rec = readCerts().find((c) => c.sha === sha);
  return rec ? { certified: true, record: rec } : { certified: false };
}

export function listCertifications(): Certification[] {
  return readCerts().sort((a, b) => (a.certifiedAt < b.certifiedAt ? 1 : -1));
}

function recordCertification(plan: Plan, snapshotFile?: string, userId?: string) {
  const certs = readCerts();
  const sha = planSha(plan);
  if (!certs.find((c) => c.sha === sha)) {
    certs.push({
      sha,
      certifiedAt: new Date().toISOString(),
      certifiedBy: userId,
      statementCount: plan.statements.length,
      snapshotFile,
    });
    writeCerts(certs);
  }
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

// ----- In-process schema diff -----
// We previously shelled out to drizzle-kit, but its CLI mishandled absolute
// `out` paths and silently produced empty diffs. We now build the desired
// schema directly from shared/schema.ts via getTableConfig() and diff it
// against the live DB introspected via information_schema.

interface DesiredColumn {
  name: string;
  sqlType: string;
  notNull: boolean;
  hasDefault: boolean;
  defaultLiteral: string | null;
  primary: boolean;
}
interface DesiredTable {
  name: string;
  columns: DesiredColumn[];
}

async function loadDesiredTables(): Promise<Record<string, DesiredTable>> {
  const mod = await import("../shared/schema.js" as any).catch(() =>
    import("../shared/schema" as any),
  );
  const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
  const out: Record<string, DesiredTable> = {};
  for (const v of Object.values(mod) as any[]) {
    if (!v || !(v instanceof PgTable)) continue;
    const cfg = getTableConfig(v);
    out[cfg.name] = {
      name: cfg.name,
      columns: cfg.columns.map((c: any) => ({
        name: c.name,
        sqlType: typeof c.getSQLType === "function" ? c.getSQLType() : String(c.columnType ?? ""),
        notNull: !!c.notNull,
        hasDefault: !!c.hasDefault,
        defaultLiteral: serializeDefault(c),
        primary: !!c.primary,
      })),
    };
  }
  return out;
}

function serializeDefault(c: any): string | null {
  if (!c.hasDefault) return null;
  const d = c.default;
  if (d === undefined || d === null) {
    // serial / identity columns generate sequence defaults; treat as managed
    if (typeof c.getSQLType === "function" && /^serial/i.test(c.getSQLType())) return "__SEQ__";
    return null;
  }
  if (typeof d === "boolean") return d ? "true" : "false";
  if (typeof d === "number") return String(d);
  if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
  if (d && typeof d === "object" && "queryChunks" in d) {
    // sql`...` template — best-effort string rep
    try {
      return d.queryChunks
        .map((q: any) => (typeof q === "string" ? q : q?.value ?? ""))
        .join("");
    } catch {
      return "__SQL__";
    }
  }
  return null;
}

// Normalize types so `serial`↔`integer` (etc.) compare equal.
function normalizeType(t: string): string {
  const x = t.toLowerCase().trim();
  if (x === "serial" || x === "bigserial" || x === "smallserial") return "integer";
  if (x === "varchar" || x.startsWith("varchar(") || x === "character varying")
    return "character varying";
  if (x === "timestamp" || x.startsWith("timestamp(")) return "timestamp without time zone";
  if (x === "timestamptz") return "timestamp with time zone";
  if (x === "bool") return "boolean";
  if (x === "int" || x === "int4") return "integer";
  if (x === "int8" || x === "bigint") return "bigint";
  if (x === "int2" || x === "smallint") return "smallint";
  if (x === "float8" || x === "double precision") return "double precision";
  if (x === "float4" || x === "real") return "real";
  if (x.startsWith("numeric")) return "numeric";
  if (x === "json") return "json";
  if (x === "jsonb") return "jsonb";
  // arrays: text[] vs _text[] from introspect
  if (x.endsWith("[]")) {
    let inner = x.slice(0, -2);
    if (inner.startsWith("_")) inner = inner.slice(1);
    return normalizeType(inner) + "[]";
  }
  return x;
}

function normalizeDefault(d: string | null | undefined): string | null {
  if (d == null) return null;
  let s = String(d).trim();
  // strip ::type casts
  s = s.replace(/::[a-zA-Z_ \[\]"]+(\(\d+(,\s*\d+)?\))?/g, "");
  // sequence defaults
  if (/^nextval\(/i.test(s)) return "__SEQ__";
  if (s === "__SEQ__") return "__SEQ__";
  // booleans
  if (/^true$/i.test(s)) return "true";
  if (/^false$/i.test(s)) return "false";
  // strip outer quotes
  s = s.replace(/^'(.*)'$/s, "$1");
  return s;
}

function buildAddColumnSQL(table: string, col: DesiredColumn): string {
  let sql = `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${col.sqlType}`;
  if (col.notNull) sql += " NOT NULL";
  if (col.hasDefault && col.defaultLiteral && col.defaultLiteral !== "__SEQ__") {
    sql += ` DEFAULT ${col.defaultLiteral}`;
  }
  return sql + ";";
}

function buildCreateTableSQL(t: DesiredTable): string {
  const colDefs = t.columns.map((c) => {
    let s = `  "${c.name}" ${c.sqlType}`;
    if (c.primary) s += " PRIMARY KEY";
    if (c.notNull && !c.primary) s += " NOT NULL";
    if (c.hasDefault && c.defaultLiteral && c.defaultLiteral !== "__SEQ__")
      s += ` DEFAULT ${c.defaultLiteral}`;
    return s;
  });
  return `CREATE TABLE "${t.name}" (\n${colDefs.join(",\n")}\n);`;
}

export async function generatePlan(
  targetEnv: Env,
  _renameAnswers: number[] = [],
): Promise<Plan> {
  const [desired, actual] = await Promise.all([
    loadDesiredTables(),
    introspectSchema(targetEnv),
  ]);

  const statements: PlanStatement[] = [];
  let idx = 0;
  const push = (sql: string) => {
    statements.push(classifyStatement(sql, idx++));
  };

  // 1. Tables in desired but missing in actual → CREATE TABLE
  for (const [name, dt] of Object.entries(desired)) {
    if (!actual[name]) push(buildCreateTableSQL(dt));
  }

  // 2. Tables in actual but not in desired → DROP TABLE
  for (const name of Object.keys(actual)) {
    if (!desired[name]) push(`DROP TABLE "${name}" CASCADE;`);
  }

  // 3. Common tables: column-level diff
  for (const [name, dt] of Object.entries(desired)) {
    const at = actual[name];
    if (!at) continue;
    const actualCols = new Map(at.columns.map((c) => [c.name, c]));
    const desiredCols = new Map(dt.columns.map((c) => [c.name, c]));

    for (const dc of dt.columns) {
      const ac = actualCols.get(dc.name);
      if (!ac) {
        push(buildAddColumnSQL(name, dc));
        continue;
      }
      // Compare type
      const dType = normalizeType(dc.sqlType);
      const aType = normalizeType(ac.type);
      if (dType !== aType) {
        push(
          `ALTER TABLE "${name}" ALTER COLUMN "${dc.name}" SET DATA TYPE ${dc.sqlType}; -- was ${ac.type}`,
        );
      }
      // Nullability
      if (dc.notNull && ac.nullable) {
        push(`ALTER TABLE "${name}" ALTER COLUMN "${dc.name}" SET NOT NULL;`);
      } else if (!dc.notNull && !ac.nullable) {
        push(`ALTER TABLE "${name}" ALTER COLUMN "${dc.name}" DROP NOT NULL;`);
      }
      // Default
      const dDef = normalizeDefault(dc.defaultLiteral);
      const aDef = normalizeDefault(ac.default);
      if (dDef === "__SEQ__" || aDef === "__SEQ__") {
        // sequence-managed, skip
      } else if (dDef !== aDef) {
        if (dDef == null) {
          push(`ALTER TABLE "${name}" ALTER COLUMN "${dc.name}" DROP DEFAULT;`);
        } else {
          push(
            `ALTER TABLE "${name}" ALTER COLUMN "${dc.name}" SET DEFAULT ${dc.defaultLiteral};`,
          );
        }
      }
    }
    for (const ac of at.columns) {
      if (!desiredCols.has(ac.name)) {
        push(`ALTER TABLE "${name}" DROP COLUMN "${ac.name}";`);
      }
    }
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
    promptsLog: [],
    noChanges: statements.length === 0,
    hasAmbiguous: false,
    warnings,
  };
  planCache.set(planId, plan);
  return plan;
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
  opts: { confirmProd?: boolean; userId?: string } = {},
  onEvent?: (e: ApplyEvent) => void,
): Promise<ApplyResult> {
  const start = Date.now();
  const emit = (e: ApplyEvent) => {
    try {
      onEvent?.(e);
    } catch {}
  };

  // Promotion policy: changes flow dev → test → production.
  // Direct apply to production is forbidden unless this exact plan was
  // already certified by a successful apply against the test environment.
  if (plan.targetEnv === "production") {
    if (!opts.confirmProd) {
      return {
        success: false,
        appliedCount: 0,
        error: "Production apply requires explicit confirmation",
        durationMs: Date.now() - start,
      };
    }
    const cert = isPlanCertified(plan);
    if (!cert.certified) {
      const msg =
        "Production apply rejected: this plan has not been certified by a successful apply against Test. " +
        "Apply the same plan to Test first, then re-generate the plan for Production.";
      emit({ type: "error", error: msg });
      return {
        success: false,
        appliedCount: 0,
        error: msg,
        durationMs: Date.now() - start,
      };
    }
    emit({
      type: "info",
      message: `Plan certified by Test apply at ${cert.record!.certifiedAt}`,
    } as any);
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
    // A successful Test apply certifies this exact plan for promotion to Production.
    if (plan.targetEnv === "test") {
      try {
        recordCertification(plan, snapshotFile, opts.userId);
        emit({
          type: "info",
          message: "Plan certified — promotion to Production unlocked",
        } as any);
      } catch {}
    }
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
