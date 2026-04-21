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

export async function runDbAbstractionGuard(): Promise<void> {
  const serverDir = path.join(PROJECT_ROOT, "server");
  const violations: Violation[] = [];

  for await (const file of walk(serverDir)) {
    const rel = path.normalize(path.relative(PROJECT_ROOT, file));
    const content = await fs.readFile(file, "utf8");
    const lines = content.split("\n");
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
