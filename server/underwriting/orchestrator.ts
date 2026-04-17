import { eq, and } from "drizzle-orm";
import {
  prospectApplications, merchantProspects, prospectOwners, acquirers,
  workflowEndpoints, underwritingRuns, underwritingPhaseResults,
  underwritingIssues, mccPolicies, mccCodes,
  type ProspectApplication, type MerchantProspect, type ProspectOwner,
} from "@shared/schema";
import {
  PHASES, PATHWAYS, type Pathway, type PhaseDef, type PhaseResult,
  type PhaseFinding, phasesForPathway, tierFromScore, tierFromCheckpoints,
  computeSlaDeadline, PHASE_DECLINE_MAP, APP_STATUS,
} from "@shared/underwriting";
import { computeRiskScore } from "./scoring";
import type { getDynamicDatabase } from "../db";

type DB = ReturnType<typeof getDynamicDatabase>;

interface PhaseContext {
  db: DB;
  app: ProspectApplication;
  prospect: MerchantProspect;
  owners: ProspectOwner[];
  pathway: Pathway;
}

// ─── Endpoint helpers ────────────────────────────────────────────────────────

interface EndpointRecord {
  id: number;
  url: string;
  method: string | null;
  authType: string | null;
  authConfig: Record<string, unknown> | null;
  headers: Record<string, string> | null;
  isActive: boolean;
}

async function lookupEndpoint(db: DB, name: string): Promise<EndpointRecord | null> {
  const rows = await db.select().from(workflowEndpoints)
    .where(and(eq(workflowEndpoints.name, name), eq(workflowEndpoints.isActive, true))).limit(1);
  return (rows[0] as EndpointRecord) ?? null;
}

interface EndpointResponse { ok: boolean; status: number; data: unknown; error?: string }

async function callEndpoint(ep: EndpointRecord, body: unknown): Promise<EndpointResponse> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(ep.headers || {}) };
  const auth = (ep.authConfig || {}) as Record<string, string>;
  if (ep.authType === "api_key" && auth.headerName && auth.apiKey) headers[auth.headerName] = auth.apiKey;
  if (ep.authType === "bearer" && auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (ep.authType === "basic" && auth.username) headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password ?? ""}`).toString("base64")}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(ep.url, { method: ep.method || "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(t);
    const text = await r.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep as text */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// Adapter: external response → PhaseResult. Each provider can be specialized
// later by switching on phase key inside the call site.
function adaptExternal(phaseKey: string, resp: EndpointResponse): PhaseResult {
  if (!resp.ok) {
    return { status: "error", score: 0, findings: [
      { severity: "error", code: "endpoint_error", message: resp.error || `HTTP ${resp.status}` },
    ]};
  }
  const d = (resp.data || {}) as Record<string, unknown>;
  const score = typeof d.score === "number" ? d.score : 70;
  const sev = (d.severity as PhaseFinding["severity"]) || (score >= 80 ? "info" : score >= 50 ? "warning" : "error");
  const status: PhaseResult["status"] = sev === "critical" || sev === "error" ? "fail" : sev === "warning" ? "warn" : "pass";
  const rawFindings = Array.isArray(d.findings) ? d.findings : [];
  const findings: PhaseFinding[] = rawFindings.map((f) => {
    const obj = f as Record<string, unknown>;
    return {
      severity: (obj.severity as PhaseFinding["severity"]) || sev,
      message: String(obj.message ?? "Provider finding"),
      code: typeof obj.code === "string" ? obj.code : `${phaseKey}_finding`,
      fieldPath: typeof obj.field === "string" ? obj.field : undefined,
    };
  });
  return { status, score, findings };
}

// ─── Per-phase adapters (one function per spec phase) ────────────────────────

function appData(app: ProspectApplication): Record<string, unknown> {
  return (app.applicationData as Record<string, unknown>) || {};
}

async function phaseMccValidation(ctx: PhaseContext): Promise<PhaseResult> {
  const data = appData(ctx.app);
  const mcc = (data.mcc || data.mccCode) as string | undefined;
  const findings: PhaseFinding[] = [];
  if (!mcc) {
    findings.push({ severity: "error", code: "mcc_missing", message: "MCC not specified on application", fieldPath: "mcc" });
    return { status: "fail", score: 0, findings };
  }
  const [code] = await ctx.db.select().from(mccCodes).where(eq(mccCodes.code, String(mcc))).limit(1);
  if (!code) {
    findings.push({ severity: "warning", code: "mcc_unknown", message: `MCC ${mcc} not in catalogue` });
    return { status: "warn", score: 60, findings };
  }
  const [policy] = await ctx.db.select().from(mccPolicies)
    .where(and(eq(mccPolicies.mccCodeId, code.id), eq(mccPolicies.isActive, true))).limit(1);
  const effectiveRisk = (policy?.riskLevelOverride || code.riskLevel || "low").toLowerCase();
  const policyType = policy?.policyType?.toLowerCase();
  if (policyType === "prohibited" || effectiveRisk === "prohibited") {
    findings.push({ severity: "critical", code: "mcc_prohibited", message: `MCC ${mcc} is prohibited` });
    return { status: "fail", score: 0, findings };
  }
  if (effectiveRisk === "high" || policyType === "restricted") {
    findings.push({ severity: "warning", code: "mcc_high_risk", message: `MCC ${mcc} is ${policyType || effectiveRisk}` });
    return { status: "warn", score: 60, findings };
  }
  return { status: "pass", score: 95, findings };
}

async function phaseGoogleKyb(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_google_kyb");
  if (!ep) return skippedNoEndpoint("uw_google_kyb");
  const data = appData(ctx.app);
  const req = { legalName: data.companyName, ein: data.federalTaxId, address: data.address, state: data.state };
  const resp = await callEndpoint(ep, req);
  const result = adaptExternal("google_kyb", resp);
  result.endpointId = ep.id;
  result.externalRequest = req;
  result.externalResponse = resp;
  return result;
}

async function phaseVolumeThreshold(ctx: PhaseContext): Promise<PhaseResult> {
  const data = appData(ctx.app);
  const monthly = Number(data.monthlyVolume || data.estimatedMonthlyVolume || 0);
  const avgTicket = Number(data.averageTicket || data.avgTicket || 0);
  const highTicket = Number(data.highTicket || data.maxTicket || 0);
  const findings: PhaseFinding[] = [];
  if (monthly <= 0) findings.push({ severity: "warning", code: "missing_volume", message: "Monthly volume not provided", fieldPath: "monthlyVolume" });
  // Acquirer-policy threshold lookup; default $5M monthly cap when no policy.
  const [acq] = await ctx.db.select().from(acquirers).where(eq(acquirers.id, ctx.app.acquirerId)).limit(1);
  const cap = Number((acq as unknown as Record<string, unknown>)?.monthlyVolumeCap ?? 5_000_000);
  if (monthly > cap) findings.push({ severity: "error", code: "volume_over_cap", message: `Monthly volume ${monthly} exceeds acquirer cap ${cap}` });
  if (highTicket > avgTicket * 20 && avgTicket > 0) findings.push({ severity: "warning", code: "ticket_ratio", message: "High ticket > 20× average ticket" });
  const errors = findings.filter(f => f.severity === "error" || f.severity === "critical").length;
  const score = errors ? 30 : findings.length ? 70 : 95;
  return { status: errors ? "fail" : findings.length ? "warn" : "pass", score, findings };
}

async function phasePhoneVerification(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_phone_verification");
  if (!ep) return skippedNoEndpoint("uw_phone_verification");
  const data = appData(ctx.app);
  const req = { phone: data.businessPhone || data.phone, name: data.companyName };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("phone_verification", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseMatchEin(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_match_ein");
  if (!ep) return skippedNoEndpoint("uw_match_ein");
  const data = appData(ctx.app);
  const req = { ein: data.federalTaxId, legalName: data.companyName, owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("match_ein", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseOfac(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_ofac_sanctions");
  if (!ep) return skippedNoEndpoint("uw_ofac_sanctions");
  const data = appData(ctx.app);
  const req = { entity: data.companyName, owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("ofac_sanctions", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseSosLookup(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_sos_lookup");
  if (!ep) return skippedNoEndpoint("uw_sos_lookup");
  const data = appData(ctx.app);
  const req = { legalName: data.companyName, state: data.state };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("sos_lookup", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseSsn(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_ssn_verification");
  if (!ep) return skippedNoEndpoint("uw_ssn_verification");
  const req = { owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("ssn_verification", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseCredit(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_credit_check");
  if (!ep) return skippedNoEndpoint("uw_credit_check");
  const req = { owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("credit_check", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

async function phaseWebsite(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_website_review");
  if (!ep) return skippedNoEndpoint("uw_website_review");
  const data = appData(ctx.app);
  const req = { url: data.websiteUrl || data.website };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("website_review", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

// Manual phases — same shape, different invocation path (see runManualPhase).
async function phaseDerogatory(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_derogatory_check");
  if (!ep) return skippedNoEndpoint("uw_derogatory_check");
  const req = { owners: ctx.owners.map(o => ({ name: o.name })) };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("derogatory_check", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}
async function phaseG2(ctx: PhaseContext): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, "uw_g2_check");
  if (!ep) return skippedNoEndpoint("uw_g2_check");
  const data = appData(ctx.app);
  const req = { entity: data.companyName, ein: data.federalTaxId };
  const resp = await callEndpoint(ep, req);
  const r = adaptExternal("g2_check", resp);
  r.endpointId = ep.id; r.externalRequest = req; r.externalResponse = resp;
  return r;
}

function skippedNoEndpoint(name: string): PhaseResult {
  return {
    status: "skipped", score: 0,
    findings: [{ severity: "info", code: "endpoint_unconfigured", message: `Workflow endpoint '${name}' not configured` }],
  };
}

const PHASE_ADAPTERS: Record<string, (ctx: PhaseContext) => Promise<PhaseResult>> = {
  mcc_validation: phaseMccValidation,
  google_kyb: phaseGoogleKyb,
  volume_threshold: phaseVolumeThreshold,
  phone_verification: phasePhoneVerification,
  match_ein: phaseMatchEin,
  ofac_sanctions: phaseOfac,
  sos_lookup: phaseSosLookup,
  ssn_verification: phaseSsn,
  credit_check: phaseCredit,
  website_review: phaseWebsite,
  derogatory_check: phaseDerogatory,
  g2_check: phaseG2,
};

// ─── Persistence helpers ─────────────────────────────────────────────────────

async function persistPhaseResult(
  db: DB, runId: number, applicationId: number, phase: PhaseDef, result: PhaseResult,
  durationMs: number,
) {
  await db.insert(underwritingPhaseResults).values({
    runId, phaseKey: phase.key, phaseOrder: phase.order,
    status: result.status, score: result.score, findings: result.findings,
    endpointId: result.endpointId ?? null,
    externalRequest: result.externalRequest ?? null,
    externalResponse: result.externalResponse ?? null,
    durationMs, completedAt: new Date(),
  });
  for (const f of result.findings) {
    if (f.severity === "info") continue;
    await db.insert(underwritingIssues).values({
      applicationId, runId, phaseKey: phase.key,
      severity: f.severity, code: f.code || `${phase.key}_finding`, message: f.message,
      fieldPath: f.fieldPath ?? null, status: "open",
    });
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export interface PipelineResult {
  runId: number;
  pathway: Pathway;
  score: number | null;
  tier: "low" | "medium" | "high";
  haltedAtPhase: string | null;
  recommendedDecline: string | null; // status code suggestion when checkpoint halts
  slaDeadline: Date | null;
}

export async function runUnderwritingPipeline(opts: {
  db: DB; applicationId: number; startedBy: string | null;
}): Promise<PipelineResult> {
  const { db, applicationId, startedBy } = opts;

  const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.id, app.prospectId)).limit(1);
  if (!prospect) throw new Error(`Prospect ${app.prospectId} not found`);
  const owners = await db.select().from(prospectOwners).where(eq(prospectOwners.prospectId, app.prospectId));

  const pathway = (app.pathway as Pathway) || PATHWAYS.TRADITIONAL;
  const phases = phasesForPathway(pathway, false);

  const [run] = await db.insert(underwritingRuns).values({
    applicationId, startedBy, status: "running",
    currentPhase: phases[0]?.key, totalPhases: phases.length,
  }).returning();

  const ctx: PhaseContext = { db, app, prospect, owners, pathway };
  const collected: PhaseResult[] = [];
  let haltedAtPhase: string | null = null;
  let recommendedDecline: string | null = null;

  try {
    for (const phase of phases) {
      const t0 = Date.now();
      await db.update(underwritingRuns).set({ currentPhase: phase.key }).where(eq(underwritingRuns.id, run.id));

      let result: PhaseResult;
      try {
        const adapter = PHASE_ADAPTERS[phase.key];
        if (!adapter) throw new Error(`No adapter for phase ${phase.key}`);
        result = await adapter(ctx);
      } catch (e) {
        result = { status: "error", score: 0, findings: [{ severity: "error", code: "phase_exception", message: e instanceof Error ? e.message : String(e) }] };
      }

      await persistPhaseResult(db, run.id, applicationId, phase, result, Date.now() - t0);
      collected.push(result);

      // Checkpoint halt: a critical/fail at a checkpoint phase stops the pipeline.
      if (phase.checkpoint && (result.status === "fail" || result.status === "error")) {
        haltedAtPhase = phase.key;
        recommendedDecline = PHASE_DECLINE_MAP[phase.key] || APP_STATUS.D4;
        break;
      }
    }

    // Scoring + SLA per pathway.
    let score: number | null = null;
    let tier: "low" | "medium" | "high";
    let slaDeadline: Date | null = null;

    // Always compute a weighted risk score from whatever phases ran. PayFac
    // applications enumerate fewer phases (only checkpoints + Volume), but a
    // numeric score is still required so reviewers see a quantitative tier.
    {
      const outcomes = phases.slice(0, collected.length).map((p, i) => ({
        key: p.key, status: collected[i].status, score: collected[i].score,
      }));
      const agg = computeRiskScore(outcomes);
      score = agg.score;
      tier = agg.tier;
    }
    if (pathway === PATHWAYS.PAYFAC) {
      // Worst-of checkpoint tier wins so a single bad checkpoint can't be
      // hidden by an otherwise rosy weighted average.
      const checkpointTier = tierFromCheckpoints(collected);
      const order = { low: 0, medium: 1, high: 2 } as const;
      if (order[checkpointTier] > order[tier]) tier = checkpointTier;
      slaDeadline = haltedAtPhase ? null : computeSlaDeadline();
    }

    await db.update(underwritingRuns).set({
      status: "completed", currentPhase: null,
      riskScore: score, riskTier: tier, completedAt: new Date(),
    }).where(eq(underwritingRuns.id, run.id));

    await db.update(prospectApplications).set({
      riskScore: score, riskTier: tier,
      slaDeadline, pipelineHaltedAtPhase: haltedAtPhase,
      updatedAt: new Date(),
    }).where(eq(prospectApplications.id, applicationId));

    return { runId: run.id, pathway, score, tier, haltedAtPhase, recommendedDecline, slaDeadline };
  } catch (err) {
    await db.update(underwritingRuns).set({
      status: "failed", errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date(),
    }).where(eq(underwritingRuns.id, run.id));
    throw err;
  }
}

// ─── Manual phase invocation (Derogatory / G2) ───────────────────────────────

export async function runManualPhase(opts: {
  db: DB; applicationId: number; phaseKey: "derogatory_check" | "g2_check"; startedBy: string | null;
}): Promise<{ runId: number; phaseKey: string; result: PhaseResult }> {
  const { db, applicationId, phaseKey, startedBy } = opts;
  const phase = PHASES.find(p => p.key === phaseKey && p.manual);
  if (!phase) throw new Error(`Manual phase ${phaseKey} not found`);

  const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.id, app.prospectId)).limit(1);
  if (!prospect) throw new Error(`Prospect ${app.prospectId} not found`);
  const owners = await db.select().from(prospectOwners).where(eq(prospectOwners.prospectId, app.prospectId));

  const [run] = await db.insert(underwritingRuns).values({
    applicationId, startedBy, status: "running",
    currentPhase: phase.key, totalPhases: 1,
  }).returning();

  const t0 = Date.now();
  const ctx: PhaseContext = { db, app, prospect, owners, pathway: (app.pathway as Pathway) || PATHWAYS.TRADITIONAL };
  let result: PhaseResult;
  try {
    result = await PHASE_ADAPTERS[phaseKey](ctx);
  } catch (e) {
    result = { status: "error", score: 0, findings: [{ severity: "error", code: "phase_exception", message: e instanceof Error ? e.message : String(e) }] };
  }

  await persistPhaseResult(db, run.id, applicationId, phase, result, Date.now() - t0);
  await db.update(underwritingRuns).set({
    status: "completed", currentPhase: null, completedAt: new Date(),
  }).where(eq(underwritingRuns.id, run.id));

  return { runId: run.id, phaseKey, result };
}

// Re-export tierFromScore for the routes layer.
export { tierFromScore };
