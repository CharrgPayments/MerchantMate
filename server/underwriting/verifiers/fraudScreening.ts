// Built-in fraud-screening (TMF/MATCH + EIN) verifier.
//
// 1. Calls a configurable third-party MATCH/TMF provider when
//    MATCH_API_URL is set (Mastercard MATCH, FIS TMF, etc.).
// 2. Falls back to deterministic local checks: EIN format/structure
//    validation, IRS-prefix sanity check, and owner cross-screen against
//    the OFAC SDN list (a known fraud signal).
//
// Fail/critical findings are surfaced as underwriting issues so reviewers
// have actionable messages even when no paid provider is wired in.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";
import { verifyOfac } from "./ofac";

export interface FraudScreeningOwner { name?: string | null; email?: string | null }
export interface FraudScreeningInput {
  ein?: string | null;
  legalName?: string | null;
  owners: FraudScreeningOwner[];
}

interface MatchProviderHit {
  reasonCode?: string;
  description?: string;
  addedOn?: string;
}
interface MatchProviderResponse {
  matched?: boolean;
  hits?: MatchProviderHit[];
  status?: string;
  error?: string;
}

// Valid IRS EIN prefixes (campus codes). See IRS Publication 1635 — used to
// reject obviously bogus EINs before incurring a paid MATCH lookup.
const VALID_EIN_PREFIXES = new Set([
  "01","02","03","04","05","06","10","11","12","13","14","15","16","20","21","22","23","24","25","26","27",
  "30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48","50","51",
  "52","53","54","55","56","57","58","59","60","61","62","63","64","65","66","67","68","71","72","73","74",
  "75","76","77","80","81","82","83","84","85","86","87","88","90","91","92","93","94","95","98","99",
]);

function validateEin(ein: string | null | undefined): { ok: boolean; reason?: string; normalized?: string } {
  if (!ein) return { ok: false, reason: "EIN missing" };
  const digits = ein.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return { ok: false, reason: `EIN must be 9 digits, got ${digits.length}` };
  if (/^(\d)\1{8}$/.test(digits)) return { ok: false, reason: "EIN is all-same-digit (likely placeholder)" };
  const prefix = digits.slice(0, 2);
  if (!VALID_EIN_PREFIXES.has(prefix)) return { ok: false, reason: `EIN prefix ${prefix} not assigned by IRS` };
  return { ok: true, normalized: `${digits.slice(0, 2)}-${digits.slice(2)}` };
}

async function callMatchProvider(input: FraudScreeningInput): Promise<MatchProviderResponse | null> {
  const url = process.env.MATCH_API_URL;
  const key = process.env.MATCH_API_KEY;
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ein: input.ein,
        legalName: input.legalName,
        owners: (input.owners || []).map(o => ({ name: o.name, email: o.email })),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      return { error: `MATCH provider HTTP ${r.status}` };
    }
    return (await r.json()) as MatchProviderResponse;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function verifyFraudScreening(input: FraudScreeningInput): Promise<PhaseResult> {
  const findings: PhaseFinding[] = [];
  let worstStatus: PhaseResult["status"] = "pass";
  let phaseScore = 95;
  const order = { pass: 0, warn: 1, fail: 2, error: 3, skipped: -1 } as const;
  const escalate = (s: PhaseResult["status"], score: number) => {
    if (order[s] > order[worstStatus]) worstStatus = s;
    phaseScore = Math.min(phaseScore, score);
  };

  // ── 1. EIN validation ────────────────────────────────────────────────
  const ein = validateEin(input.ein);
  if (!ein.ok) {
    findings.push({
      severity: "error",
      code: "ein_invalid",
      message: `EIN validation failed: ${ein.reason}`,
      fieldPath: "federalTaxId",
    });
    escalate("fail", 10);
  } else {
    findings.push({ severity: "info", code: "ein_format_valid", message: `EIN ${ein.normalized} passes IRS format check` });
  }

  // ── 2. MATCH/TMF provider lookup (paid; optional) ────────────────────
  const provider = await callMatchProvider(input);
  if (provider) {
    if (provider.error) {
      findings.push({ severity: "error", code: "match_provider_error", message: provider.error });
      escalate("error", 0);
    } else if (provider.matched) {
      const hits = provider.hits || [];
      for (const hit of hits) {
        findings.push({
          severity: "critical",
          code: "match_hit",
          message: `MATCH hit${hit.reasonCode ? ` [${hit.reasonCode}]` : ""}: ${hit.description ?? "Listed on terminated-merchant file"}`,
        });
      }
      if (hits.length === 0) {
        findings.push({ severity: "critical", code: "match_hit", message: "Provider returned MATCH=true with no hit details" });
      }
      escalate("fail", 0);
    } else {
      findings.push({ severity: "info", code: "match_clear", message: "MATCH/TMF: no hits for entity or principals" });
    }
  } else {
    findings.push({
      severity: "warning",
      code: "match_provider_unconfigured",
      message: "MATCH/TMF provider not configured (set MATCH_API_URL); fraud screening is using local heuristics only.",
    });
    escalate("warn", 60);
  }

  // ── 3. Cross-screen owners against OFAC SDN list (free fraud signal) ─
  try {
    const ofac = await verifyOfac({ entity: input.legalName, owners: input.owners.map(o => ({ name: o.name })) });
    const sdnHits = ofac.findings.filter(f => f.severity === "critical");
    if (sdnHits.length > 0) {
      for (const hit of sdnHits) {
        findings.push({ severity: "critical", code: "fraud_sdn_hit", message: `Fraud signal — SDN match: ${hit.message}`, fieldPath: hit.fieldPath });
      }
      escalate("fail", 0);
    }
  } catch (e) {
    findings.push({ severity: "warning", code: "fraud_ofac_xref_error", message: e instanceof Error ? e.message : String(e) });
  }

  return { status: worstStatus, score: phaseScore, findings };
}
