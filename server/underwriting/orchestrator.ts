import { eq, and } from "drizzle-orm";
import {
  prospectApplications, merchantProspects, prospectOwners, acquirers,
  workflowEndpoints, underwritingRuns, underwritingPhaseResults,
  underwritingIssues, mccPolicies, mccCodes,
} from "@shared/schema";
import { PHASES, type PhaseStatus, type IssueSeverity } from "@shared/underwriting";
import { computeRiskScore, type PhaseOutcome } from "./scoring";
import type { getDynamicDatabase } from "../db";

type DB = ReturnType<typeof getDynamicDatabase>;

interface PhaseFinding { code: string; severity: IssueSeverity; message: string; field?: string; }
interface PhaseRunResult {
  status: PhaseStatus;
  score: number;
  findings: PhaseFinding[];
  endpointId?: number | null;
  externalRequest?: any;
  externalResponse?: any;
}

// Lookup an endpoint by name. Returns null if missing — phase will be skipped.
async function lookupEndpoint(db: DB, name: string) {
  const [ep] = await db.select().from(workflowEndpoints)
    .where(and(eq(workflowEndpoints.name, name), eq(workflowEndpoints.isActive, true))).limit(1);
  return ep ?? null;
}

async function callEndpoint(ep: any, body: any): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(ep.headers || {}) };
  const auth = ep.authConfig || {};
  if (ep.authType === "api_key" && auth.headerName && auth.apiKey) headers[auth.headerName] = auth.apiKey;
  if (ep.authType === "bearer" && auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (ep.authType === "basic" && auth.username) headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password ?? ""}`).toString("base64")}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(ep.url, { method: ep.method || "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(t);
    const text = await r.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* keep as text */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message || String(e) };
  }
}

// Convert an external response into a phase outcome. Provider adapters can be
// swapped in later; for the MVP we expect `{ score, severity, findings[] }`.
function adaptResponse(resp: any): PhaseRunResult {
  if (!resp || resp.error || !resp.ok) {
    return { status: "error", score: 0, findings: [{ code: "endpoint_error", severity: "error", message: resp?.error || `HTTP ${resp?.status}` }] };
  }
  const d = resp.data || {};
  const score = typeof d.score === "number" ? d.score : 70;
  const sev: IssueSeverity = d.severity || (score >= 80 ? "info" : score >= 50 ? "warning" : "error");
  const status: PhaseStatus = sev === "critical" || sev === "error" ? "fail" : sev === "warning" ? "warn" : "pass";
  const findings: PhaseFinding[] = Array.isArray(d.findings) ? d.findings : [];
  return { status, score, findings };
}

// ─── Rules-engine phases (no external endpoint needed) ───────────────────────

async function intakeValidation(db: DB, app: any, prospect: any): Promise<PhaseRunResult> {
  const f: PhaseFinding[] = [];
  const data = (app.applicationData || {}) as Record<string, any>;
  const required = ["companyName", "businessType", "federalTaxId", "address", "city", "state", "zipCode"];
  for (const k of required) if (!data[k]) f.push({ code: "missing_field", severity: "error", message: `Missing required field: ${k}`, field: k });
  if (!prospect.email) f.push({ code: "missing_field", severity: "error", message: "Prospect email missing", field: "email" });
  const score = Math.max(0, 100 - f.length * 15);
  return { status: f.length ? (score < 50 ? "fail" : "warn") : "pass", score, findings: f };
}

async function ownershipKyc(db: DB, app: any): Promise<PhaseRunResult> {
  const owners = await db.select().from(prospectOwners).where(eq(prospectOwners.prospectId, app.prospectId));
  const f: PhaseFinding[] = [];
  if (owners.length === 0) f.push({ code: "no_owners", severity: "critical", message: "No business owners listed" });
  const totalPct = owners.reduce((s, o) => s + Number(o.ownershipPercentage || 0), 0);
  if (owners.length && Math.abs(totalPct - 100) > 0.01) f.push({ code: "ownership_mismatch", severity: "error", message: `Ownership totals ${totalPct}%, expected 100%` });
  for (const o of owners) {
    if (!o.email) f.push({ code: "owner_missing_email", severity: "warning", message: `Owner ${o.name} missing email` });
    if (!o.name?.trim()) f.push({ code: "owner_missing_name", severity: "warning", message: "Owner missing name" });
  }
  const critical = f.some(x => x.severity === "critical");
  const errors = f.filter(x => x.severity === "error").length;
  const score = critical ? 0 : Math.max(0, 100 - errors * 25 - (f.length - errors) * 5);
  return { status: critical || errors > 0 ? (score < 50 ? "fail" : "warn") : f.length ? "warn" : "pass", score, findings: f };
}

async function mccPolicyCheck(db: DB, app: any): Promise<PhaseRunResult> {
  const data = (app.applicationData || {}) as Record<string, any>;
  const mcc = data.mcc || data.mccCode;
  const f: PhaseFinding[] = [];
  if (!mcc) {
    f.push({ code: "mcc_missing", severity: "warning", message: "MCC not specified on application" });
    return { status: "warn", score: 60, findings: f };
  }
  try {
    const [code] = await db.select().from(mccCodes).where(eq(mccCodes.code, String(mcc))).limit(1);
    if (!code) {
      f.push({ code: "mcc_unknown", severity: "warning", message: `MCC ${mcc} not in catalogue` });
      return { status: "warn", score: 60, findings: f };
    }
    const [policy] = await db.select().from(mccPolicies)
      .where(and(eq(mccPolicies.mccCodeId, code.id), eq(mccPolicies.isActive, true))).limit(1);
    const effectiveRisk = (policy?.riskLevelOverride || code.riskLevel || "low").toLowerCase();
    const policyType = policy?.policyType?.toLowerCase();
    if (policyType === "prohibited" || effectiveRisk === "prohibited") {
      f.push({ code: "mcc_prohibited", severity: "critical", message: `MCC ${mcc} is prohibited by policy` });
      return { status: "fail", score: 0, findings: f };
    }
    if (effectiveRisk === "high" || policyType === "restricted") {
      f.push({ code: "mcc_high_risk", severity: "warning", message: `MCC ${mcc} is ${policyType || effectiveRisk}` });
      return { status: "warn", score: 60, findings: f };
    }
    return { status: "pass", score: 95, findings: f };
  } catch {
    return { status: "warn", score: 70, findings: [{ code: "mcc_lookup_failed", severity: "warning", message: "MCC policy lookup failed" }] };
  }
}

async function documentReview(db: DB, app: any): Promise<PhaseRunResult> {
  const data = (app.applicationData || {}) as Record<string, any>;
  const f: PhaseFinding[] = [];
  const docs = Array.isArray(data.documents) ? data.documents : [];
  if (!data.signaturesComplete && !app.submittedAt) f.push({ code: "signatures_incomplete", severity: "error", message: "Owner signatures not complete" });
  if (docs.length === 0) f.push({ code: "no_documents", severity: "warning", message: "No supporting documents on file" });
  const errors = f.filter(x => x.severity === "error").length;
  const score = errors ? 30 : f.length ? 70 : 100;
  return { status: errors ? "fail" : f.length ? "warn" : "pass", score, findings: f };
}

async function financialAnalysis(db: DB, app: any): Promise<PhaseRunResult> {
  const data = (app.applicationData || {}) as Record<string, any>;
  const f: PhaseFinding[] = [];
  const monthly = Number(data.monthlyVolume || data.estimatedMonthlyVolume || 0);
  const avgTicket = Number(data.averageTicket || data.avgTicket || 0);
  const highTicket = Number(data.highTicket || data.maxTicket || 0);
  if (monthly <= 0) f.push({ code: "missing_volume", severity: "warning", message: "Monthly volume not provided" });
  if (avgTicket <= 0) f.push({ code: "missing_avg_ticket", severity: "warning", message: "Average ticket not provided" });
  if (monthly > 1_000_000) f.push({ code: "high_volume", severity: "warning", message: "Monthly volume exceeds $1M — committee review suggested" });
  if (highTicket > avgTicket * 20 && avgTicket > 0) f.push({ code: "ticket_ratio", severity: "warning", message: "High ticket >20× average ticket" });
  const score = Math.max(0, 100 - f.length * 12);
  return { status: f.length > 2 ? "warn" : "pass", score, findings: f };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runUnderwritingPipeline(opts: {
  db: DB; applicationId: number; startedBy: string | null;
}): Promise<{ runId: number; score: number; tier: "low" | "medium" | "high"; phases: any[] }> {
  const { db, applicationId, startedBy } = opts;

  const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.id, app.prospectId)).limit(1);
  if (!prospect) throw new Error(`Prospect ${app.prospectId} not found`);

  const [run] = await db.insert(underwritingRuns).values({
    applicationId, startedBy, status: "running", currentPhase: PHASES[0].key, totalPhases: PHASES.length,
  }).returning();

  const outcomes: PhaseOutcome[] = [];
  const phaseRows: any[] = [];

  try {
    for (const phase of PHASES) {
      const t0 = Date.now();
      await db.update(underwritingRuns).set({ currentPhase: phase.key }).where(eq(underwritingRuns.id, run.id));

      let result: PhaseRunResult;
      let endpointId: number | null = null;
      let extReq: any = null, extResp: any = null;

      try {
        if (phase.key === "intake_validation") result = await intakeValidation(db, app, prospect);
        else if (phase.key === "ownership_kyc") result = await ownershipKyc(db, app);
        else if (phase.key === "mcc_policy") result = await mccPolicyCheck(db, app);
        else if (phase.key === "document_review") result = await documentReview(db, app);
        else if (phase.key === "financial_analysis") result = await financialAnalysis(db, app);
        else if (phase.key === "final_scoring") {
          const agg = computeRiskScore(outcomes);
          result = { status: agg.tier === "high" ? "warn" : "pass", score: agg.score, findings: [{ code: "score_assigned", severity: "info", message: `Risk score ${agg.score} (${agg.tier})` }] };
        } else if (phase.endpointName) {
          const ep = await lookupEndpoint(db, phase.endpointName);
          if (!ep) {
            result = { status: "skipped", score: 0, findings: [{ code: "endpoint_unconfigured", severity: "info", message: `Workflow endpoint '${phase.endpointName}' not configured` }] };
          } else {
            endpointId = ep.id;
            extReq = { applicationId, prospectId: app.prospectId, applicationData: app.applicationData };
            const resp = await callEndpoint(ep, extReq);
            extResp = { status: resp.status, ok: resp.ok, data: resp.data, error: resp.error };
            result = adaptResponse(resp);
          }
        } else {
          result = { status: "skipped", score: 0, findings: [] };
        }
      } catch (err: any) {
        result = { status: "error", score: 0, findings: [{ code: "phase_exception", severity: "error", message: err?.message || "Phase threw" }] };
      }

      const completedAt = new Date();
      const [pr] = await db.insert(underwritingPhaseResults).values({
        runId: run.id, phaseKey: phase.key, phaseOrder: phase.order,
        status: result.status, score: result.score, findings: result.findings,
        endpointId, externalRequest: extReq, externalResponse: extResp,
        durationMs: Date.now() - t0, completedAt,
      }).returning();
      phaseRows.push(pr);

      // Persist findings as issues so reviewers can work them.
      for (const finding of result.findings) {
        if (finding.severity === "info") continue;
        await db.insert(underwritingIssues).values({
          applicationId, runId: run.id, phaseKey: phase.key,
          severity: finding.severity, code: finding.code, message: finding.message,
          fieldPath: finding.field || null, status: "open",
        });
      }

      outcomes.push({ key: phase.key, status: result.status, score: result.score });
    }

    const { score, tier } = computeRiskScore(outcomes);
    await db.update(underwritingRuns).set({
      status: "completed", currentPhase: null, riskScore: score, riskTier: tier, completedAt: new Date(),
    }).where(eq(underwritingRuns.id, run.id));

    await db.update(prospectApplications).set({
      riskScore: score, riskTier: tier, updatedAt: new Date(),
    }).where(eq(prospectApplications.id, applicationId));

    return { runId: run.id, score, tier, phases: phaseRows };
  } catch (err: any) {
    await db.update(underwritingRuns).set({
      status: "failed", errorMessage: err?.message || String(err), completedAt: new Date(),
    }).where(eq(underwritingRuns.id, run.id));
    throw err;
  }
}
