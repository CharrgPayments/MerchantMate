// Built-in OFAC sanctions screening using the U.S. Treasury Specially
// Designated Nationals (SDN) consolidated CSV. We download once per process,
// refresh every 24h, and screen entity + owner names with case-insensitive
// substring matching. For fuzzy/aliased screening the operator can configure
// a workflow_endpoint (e.g. ComplyAdvantage) which the orchestrator prefers.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";

const SDN_URL = process.env.OFAC_SDN_CSV_URL
  || "https://www.treasury.gov/ofac/downloads/sdn.csv";
const REFRESH_MS = 24 * 60 * 60 * 1000;

interface SdnEntry { name: string; type: string; program: string }

const cache: { entries: SdnEntry[] | null; loadedAt: number; loadError: string | null } = {
  entries: null,
  loadedAt: 0,
  loadError: null,
};

async function loadSdn(): Promise<SdnEntry[] | null> {
  const now = Date.now();
  if (cache.entries && now - cache.loadedAt < REFRESH_MS) return cache.entries;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const r = await fetch(SDN_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status} loading SDN list`);
    const text = await r.text();
    const entries: SdnEntry[] = [];
    // sdn.csv columns: ent_num, SDN_Name, SDN_Type, Program, ... (no header row)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const fields = parseCsvRow(line);
      if (fields.length < 4) continue;
      entries.push({
        name: stripQuotes(fields[1]).trim().toLowerCase(),
        type: stripQuotes(fields[2]).trim().toLowerCase(),
        program: stripQuotes(fields[3]).trim(),
      });
    }
    cache.entries = entries;
    cache.loadedAt = now;
    cache.loadError = null;
    return entries;
  } catch (e) {
    cache.loadError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}

// Minimal RFC4180 parser sufficient for SDN.csv (commas inside quoted fields,
// no embedded newlines for the rows we read here).
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '""'; i += 1; }
      else if (ch === '"') { inQuotes = false; cur += ch; }
      else cur += ch;
    } else if (ch === '"') { inQuotes = true; cur += ch; }
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export interface OfacInput {
  entity?: string | null;
  owners?: Array<{ name?: string | null }>;
}

export async function verifyOfac(input: OfacInput): Promise<PhaseResult> {
  const sdn = await loadSdn();
  if (!sdn) {
    return {
      status: "skipped",
      score: 0,
      findings: [{ severity: "warning", code: "ofac_list_unavailable", message: `Could not load OFAC SDN list: ${cache.loadError ?? "unknown"}` }],
    };
  }
  const candidates: Array<{ field: string; value: string }> = [];
  if (input.entity) candidates.push({ field: "entity", value: normalize(input.entity) });
  for (const o of input.owners || []) {
    if (o?.name) candidates.push({ field: `owner:${o.name}`, value: normalize(o.name) });
  }
  if (candidates.length === 0) {
    return {
      status: "warn", score: 50,
      findings: [{ severity: "warning", code: "ofac_no_subjects", message: "No entity or owners supplied for screening" }],
    };
  }
  const findings: PhaseFinding[] = [];
  for (const c of candidates) {
    if (c.value.length < 4) continue; // avoid junk hits like "abc"
    const hit = sdn.find((s) => s.name.includes(c.value) || c.value.includes(s.name));
    if (hit) {
      findings.push({
        severity: "critical",
        code: "ofac_match",
        message: `Possible OFAC SDN match for ${c.field}: "${hit.name}" (${hit.type}, ${hit.program})`,
        fieldPath: c.field,
      });
    }
  }
  if (findings.some((f) => f.severity === "critical")) {
    return { status: "fail", score: 0, findings };
  }
  return {
    status: "pass",
    score: 95,
    findings: [{ severity: "info", code: "ofac_clear", message: `Screened ${candidates.length} subjects against ${sdn.length} SDN entries; no matches` }],
  };
}
