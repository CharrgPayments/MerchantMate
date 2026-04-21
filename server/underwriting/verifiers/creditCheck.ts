// Built-in credit-check verifier. Calls a configurable third-party credit
// bureau (e.g. Experian Connect, Equifax) when CREDIT_REPORT_API_URL is set.
// When unconfigured, surfaces an explicit error finding so reviewers know
// the phase did not actually execute against a live provider.
//
// Operators normally configure the workflow_endpoint `uw_credit_check`
// (preferred path) — this builtin only runs as a fallback when no active
// endpoint exists, so it must produce real output rather than silently skip.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";

export interface CreditCheckOwner { name?: string | null; email?: string | null; ssn?: string | null }
export interface CreditCheckInput { owners: CreditCheckOwner[] }

interface ProviderOwnerScore {
  name?: string;
  score?: number;        // FICO 300-850
  status?: string;       // pass | warn | fail
  delinquencies?: number;
  bankruptcies?: number;
  notes?: string;
}
interface ProviderResponse {
  owners?: ProviderOwnerScore[];
  status?: string;
  error?: string;
}

function tierFromFico(fico: number): { sev: PhaseFinding["severity"]; status: PhaseResult["status"]; phaseScore: number } {
  if (fico >= 720) return { sev: "info",     status: "pass", phaseScore: 95 };
  if (fico >= 660) return { sev: "info",     status: "pass", phaseScore: 80 };
  if (fico >= 600) return { sev: "warning",  status: "warn", phaseScore: 60 };
  if (fico >= 550) return { sev: "warning",  status: "warn", phaseScore: 40 };
  return { sev: "error", status: "fail", phaseScore: 10 };
}

export async function verifyCreditCheck(input: CreditCheckInput): Promise<PhaseResult> {
  const url = process.env.CREDIT_REPORT_API_URL;
  const key = process.env.CREDIT_REPORT_API_KEY;

  if (!url) {
    return {
      status: "error",
      score: 0,
      findings: [{
        severity: "error",
        code: "credit_check_provider_unconfigured",
        message: "Credit-check provider not configured. Set CREDIT_REPORT_API_URL/CREDIT_REPORT_API_KEY or activate workflow endpoint 'uw_credit_check'.",
      }],
    };
  }
  const owners = (input.owners || []).filter(o => o?.name);
  if (owners.length === 0) {
    return {
      status: "fail",
      score: 0,
      findings: [{ severity: "error", code: "credit_check_no_subjects", message: "No principal owners supplied for credit check" }],
    };
  }

  let resp: ProviderResponse;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ owners: owners.map(o => ({ name: o.name, email: o.email, ssn: o.ssn })) }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      return {
        status: "error", score: 0,
        findings: [{ severity: "error", code: "credit_check_http_error", message: `Credit provider HTTP ${r.status}` }],
      };
    }
    resp = (await r.json()) as ProviderResponse;
  } catch (e) {
    return {
      status: "error", score: 0,
      findings: [{ severity: "error", code: "credit_check_fetch_error", message: e instanceof Error ? e.message : String(e) }],
    };
  }

  const reports = Array.isArray(resp.owners) ? resp.owners : [];
  if (reports.length === 0) {
    return {
      status: "warn", score: 50,
      findings: [{ severity: "warning", code: "credit_check_no_reports", message: "Credit provider returned no owner reports" }],
    };
  }

  const findings: PhaseFinding[] = [];
  let worstStatus: PhaseResult["status"] = "pass";
  let worstScore = 100;
  const order = { pass: 0, warn: 1, fail: 2, error: 3, skipped: -1 } as const;

  for (const report of reports) {
    const fico = typeof report.score === "number" ? Math.round(report.score) : NaN;
    if (Number.isNaN(fico)) {
      findings.push({ severity: "warning", code: "credit_check_missing_score", message: `No FICO score returned for ${report.name ?? "owner"}` });
      if (order.warn > order[worstStatus]) worstStatus = "warn";
      worstScore = Math.min(worstScore, 50);
      continue;
    }
    const tier = tierFromFico(fico);
    findings.push({
      severity: tier.sev,
      code: `credit_score_${tier.status}`,
      message: `FICO ${fico} for ${report.name ?? "owner"}${report.delinquencies ? ` (${report.delinquencies} delinquencies)` : ""}${report.bankruptcies ? `, ${report.bankruptcies} bankruptcies` : ""}`,
    });
    if (order[tier.status] > order[worstStatus]) worstStatus = tier.status;
    worstScore = Math.min(worstScore, tier.phaseScore);
    if ((report.bankruptcies ?? 0) > 0) {
      findings.push({ severity: "error", code: "credit_check_bankruptcy", message: `Bankruptcy on file for ${report.name ?? "owner"}` });
      worstStatus = "fail";
      worstScore = Math.min(worstScore, 10);
    }
  }

  return { status: worstStatus, score: worstScore, findings };
}
