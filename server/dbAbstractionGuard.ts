// db-tier-allow: this file IS the guard — it must contain the literal
// patterns it scans for, and the `\.execute\\s*\\(\\s*sql` regex itself
// matches the very check it implements.
/**
 * Data-tier abstraction guard.
 *
 * Enforces that nobody bypasses the Drizzle ORM / per-request DB context
 * by importing the static `pool` from `./db` or constructing their own
 * `new Pool()` outside the two allow-listed files.
 *
 * Runs once at startup; logs a hard error and (in dev/test) throws on the
 * first violation. Production logs but does not throw, so a misbehaving
 * deploy still serves traffic while we get loud signal.
 *
 * Allow-list:
 *   - server/db.ts          — defines `pool` and the dynamic-pool registry.
 *   - server/schemaSync.ts  — must construct cross-env pools to introspect
 *                             and apply DDL to other environments.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const ALLOWLIST = new Set<string>([
  path.normalize("server/db.ts"),
  path.normalize("server/schemaSync.ts"),
  // The guard itself contains the literal patterns it scans for.
  path.normalize("server/dbAbstractionGuard.ts"),
  // Ops scripts may import `pool` only if they wrap work in runWithDb;
  // current code base has none. Add explicitly here if ever needed.
]);

const PROJECT_ROOT = path.resolve(process.cwd());

interface Violation {
  file: string;
  line: number;
  match: string;
  reason: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
      yield full;
    }
  }
}

const POOL_IMPORT_RE = /import\s*\{[^}]*\bpool\b[^}]*\}\s*from\s*['"][^'"]*\bdb['"]/;
const NEW_POOL_RE = /\bnew\s+Pool\s*\(/;
// Raw SQL DML through .execute(sql`...`). We only care about statement-shaped
// SQL (SELECT/INSERT/UPDATE/DELETE/WITH); ad-hoc fragments used as builder
// arguments stay free. Single-line check (cheap, catches most cases).
const RAW_SQL_RE = /\.execute\s*\(\s*sql\s*`[\s\S]*?(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
// Detects the start of a multi-line raw SQL block: `.execute(sql\`` with
// no DML keyword on the same line. The walker peeks forward up to 5
// lines for the keyword to handle the common formatter style.
const RAW_SQL_OPEN_RE = /\.execute\s*\(\s*sql\s*`\s*$/;
const RAW_SQL_KEYWORD_RE = /\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const ALLOW_TAG = "db-tier-allow:";
// Files where Drizzle does not (yet) cover the use case and raw SQL is the
// pragmatic choice. Each file MUST also carry a `// db-tier-allow:` header
// comment explaining why. Listing here suppresses the per-call requirement.
const RAW_SQL_FILE_ALLOWLIST = new Set<string>([
  // Recursive CTE traversals over the agent/merchant closure tables.
  // Drizzle has no first-class recursive CTE builder.
  path.normalize("server/hierarchyService.ts"),
  // Mirrors underwriting runs into the generic Workflows engine using
  // CASE WHEN, COALESCE, and JSONB casts that Drizzle's update builder
  // does not express ergonomically. Schema imports keep column names
  // type-checked even where raw SQL fragments are used.
  path.normalize("server/underwriting/workflowMirror.ts"),
  // schema introspection (information_schema queries).
  path.normalize("server/schemaSync.ts"),
  // The guard itself contains the literal patterns it scans for.
  path.normalize("server/dbAbstractionGuard.ts"),
]);

export async function runDbAbstractionGuard(): Promise<void> {
  const serverDir = path.join(PROJECT_ROOT, "server");
  const violations: Violation[] = [];

  for await (const file of walk(serverDir)) {
    const rel = path.normalize(path.relative(PROJECT_ROOT, file));
    const content = await fs.readFile(file, "utf8");
    const lines = content.split("\n");
    // File-level allow tag must be in the first 30 lines (header comment).
    const fileHasAllowTag = lines.slice(0, 30).some((l) => l.includes(ALLOW_TAG));
    const fileExempt = RAW_SQL_FILE_ALLOWLIST.has(rel);
    // Sanity: a file in RAW_SQL_FILE_ALLOWLIST must also have a header tag
    // documenting *why*. Forces the rationale to live next to the code.
    if (fileExempt && !fileHasAllowTag) {
      violations.push({
        file: rel, line: 1, match: "(missing header `// db-tier-allow:` rationale)",
        reason: "file is on raw-SQL allow-list but lacks header `// db-tier-allow:` comment with rationale",
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // strip trailing line comment
      const code = line.replace(/\/\/.*$/, "");
      if (POOL_IMPORT_RE.test(code) && !ALLOWLIST.has(rel)) {
        violations.push({
          file: rel, line: i + 1, match: line.trim(),
          reason: "imports `pool` from ./db — bypasses per-request env context",
        });
      }
      if (NEW_POOL_RE.test(code) && !ALLOWLIST.has(rel)) {
        violations.push({
          file: rel, line: i + 1, match: line.trim(),
          reason: "constructs `new Pool(...)` outside allow-list — breaks env isolation",
        });
      }
      // Raw SQL DML check: report when neither the file nor a nearby
      // line carries the `db-tier-allow:` tag. Per-call exemption is
      // checked on the same line or the immediately preceding line so
      // multi-line `sql\`` blocks can be tagged on the opening `.execute`.
      // Two patterns are checked: same-line keyword, and multi-line form
      // where the DML keyword shows up within the next 5 lines.
      let isRawSqlDml = RAW_SQL_RE.test(code);
      if (!isRawSqlDml && RAW_SQL_OPEN_RE.test(code)) {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (RAW_SQL_KEYWORD_RE.test(lines[j].replace(/\/\/.*$/, ""))) {
            isRawSqlDml = true; break;
          }
        }
      }
      if (isRawSqlDml && !fileExempt && !fileHasAllowTag) {
        // Check the call line itself and the 3 lines preceding it so a
        // multi-line `// db-tier-allow:` comment block above the call
        // counts as an exemption.
        let lineHasTag = line.includes(ALLOW_TAG);
        for (let k = 1; k <= 3 && !lineHasTag && i - k >= 0; k++) {
          if (lines[i - k].includes(ALLOW_TAG)) lineHasTag = true;
        }
        if (!lineHasTag) {
          violations.push({
            file: rel, line: i + 1, match: line.trim().slice(0, 120),
            reason: "raw SQL DML (`.execute(sql\\`SELECT|INSERT|UPDATE|DELETE…\\`)`) — convert to typed Drizzle, or annotate with `// db-tier-allow: <reason>`",
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`[dbGuard] OK — data-tier abstraction intact (allow-list: ${[...ALLOWLIST].join(", ")})`);
    return;
  }

  const banner =
    `\n[dbGuard] DATA-TIER ABSTRACTION VIOLATION (${violations.length}):\n` +
    violations.map((v) => `  - ${v.file}:${v.line}  ${v.reason}\n      ${v.match}`).join("\n") +
    `\nAllow-list: ${[...ALLOWLIST].join(", ")}\n`;

  console.error(banner);
  if (process.env.NODE_ENV !== "production" && process.env.SKIP_DB_GUARD !== "1") {
    throw new Error(
      `Data-tier abstraction guard failed: ${violations.length} violation(s). ` +
      `Set SKIP_DB_GUARD=1 to bypass during emergency.`
    );
  }
}
