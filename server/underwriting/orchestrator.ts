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
import { BUILTIN_VERIFIERS, hasBuiltin } from "./verifiers";
import { ensureTicket, upsertTicketStage, markTicketPipelineFinished } from "./workflowMirror";

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
  return runEndpointOrBuiltin(ctx, "uw_google_kyb", "google_kyb", () => {
    const data = appData(ctx.app);
    return { legalName: data.companyName, ein: data.federalTaxId, address: data.address, state: data.state };
  });
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
  return runEndpointOrBuiltin(ctx, "uw_phone_verification", "phone_verification", () => {
    const data = appData(ctx.app);
    return { phone: data.businessPhone || data.phone, name: data.companyName };
  });
}

async function phaseMatchEin(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_match_ein", "match_ein", () => {
    const data = appData(ctx.app);
    return { ein: data.federalTaxId, legalName: data.companyName, owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  });
}

async function phaseOfac(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_ofac_sanctions", "ofac_sanctions", () => {
    const data = appData(ctx.app);
    return { entity: data.companyName, owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })) };
  });
}

async function phaseSosLookup(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_sos_lookup", "sos_lookup", () => {
    const data = appData(ctx.app);
    return { legalName: data.companyName, state: data.state };
  });
}

async function phaseSsn(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_ssn_verification", "ssn_verification", () => ({
    owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })),
  }));
}

async function phaseCredit(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_credit_check", "credit_check", () => ({
    owners: ctx.owners.map((o) => ({ name: o.name, email: o.email })),
  }));
}

async function phaseWebsite(ctx: PhaseContext): Promise<PhaseResult> {
  return runEndpointOrBuiltin(ctx, "uw_website_review", "website_review", () => {
    const data = appData(ctx.app);
    return { url: data.websiteUrl || data.website };
  });
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

// Endpoint-or-builtin: prefers the operator-configured workflow_endpoint, but
// when none exists falls back to the in-process verifier (OFAC, Phone, Website,
// Google KYB). Phases without a built-in continue returning the legacy
// `skipped` PhaseResult so paid integrations (SSN/Credit/MATCH) remain opt-in.
async function runEndpointOrBuiltin(
  ctx: PhaseContext,
  endpointName: string,
  phaseKey: string,
  buildRequest: () => Record<string, unknown>,
): Promise<PhaseResult> {
  const ep = await lookupEndpoint(ctx.db, endpointName);
  if (ep) {
    const req = buildRequest();
    const resp = await callEndpoint(ep, req);
    const r = adaptExternal(phaseKey, resp);
    r.endpointId = ep.id;
    r.externalRequest = req;
    r.externalResponse = resp;
    return r;
  }
  if (hasBuiltin(phaseKey)) {
    try {
      return await BUILTIN_VERIFIERS[phaseKey]({ app: ctx.app, owners: ctx.owners });
    } catch (e) {
      return {
        status: "error", score: 0,
        findings: [{ severity: "error", code: `${phaseKey}_builtin_error`, message: e instanceof Error ? e.message : String(e) }],
      };
    }
  }
  return skippedNoEndpoint(endpointName);
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
  mirror?: { ticketId: number; definitionId: number; startedBy: string | null; startedAt: Date },
) {
  const completedAt = new Date();
  await db.insert(underwritingPhaseResults).values({
    runId, phaseKey: phase.key, phaseOrder: phase.order,
    status: result.status, score: result.score, findings: result.findings,
    endpointId: result.endpointId ?? null,
    externalRequest: result.externalRequest ?? null,
    externalResponse: result.externalResponse ?? null,
    durationMs, completedAt,
  });
  for (const f of result.findings) {
    if (f.severity === "info") continue;
    await db.insert(underwritingIssues).values({
      applicationId, runId, phaseKey: phase.key,
      severity: f.severity, code: f.code || `${phase.key}_finding`, message: f.message,
      fieldPath: f.fieldPath ?? null, status: "open",
    });
  }
  // Mirror into the workflow_ticket_stages so the unified Worklist UI
  // sees the phase outcome. Wrapped in try/catch so a mirror failure
  // never breaks the underwriting domain (it's the system of record).
  if (mirror) {
    try {
      await upsertTicketStage({
        db: db as unknown as Parameters<typeof upsertTicketStage>[0]["db"],
        ticketId: mirror.ticketId,
        definitionId: mirror.definitionId,
        phaseKey: phase.key,
        result,
        startedAt: mirror.startedAt,
        completedAt,
        executedBy: mirror.startedBy,
        externalResponse: result.externalResponse,
      });
    } catch (mirrorErr) {
      console.error(`[orchestrator] workflow ticket stage mirror failed for app=${applicationId} phase=${phase.key}:`, mirrorErr);
    }
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

  // Mirror into the generic Workflows engine so the unified Worklist
  // surfaces this application + its phase progress. Best-effort: a
  // mirror failure must not abort the pipeline.
  let ticketCtx: { ticketId: number; definitionId: number } | null = null;
  try {
    ticketCtx = await ensureTicket(db as unknown as Parameters<typeof ensureTicket>[0], app);
  } catch (e) {
    console.error(`[orchestrator] ensureTicket failed for app=${applicationId}:`, e);
  }

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
      const startedAt = new Date(t0);
      await db.update(underwritingRuns).set({ currentPhase: phase.key }).where(eq(underwritingRuns.id, run.id));

      let result: PhaseResult;
      try {
        const adapter = PHASE_ADAPTERS[phase.key];
        if (!adapter) throw new Error(`No adapter for phase ${phase.key}`);
        result = await adapter(ctx);
      } catch (e) {
        result = { status: "error", score: 0, findings: [{ severity: "error", code: "phase_exception", message: e instanceof Error ? e.message : String(e) }] };
      }

      await persistPhaseResult(
        db, run.id, applicationId, phase, result, Date.now() - t0,
        ticketCtx ? { ticketId: ticketCtx.ticketId, definitionId: ticketCtx.definitionId, startedBy, startedAt } : undefined,
      );
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
    let breakdown: ReturnType<typeof computeRiskScore>["breakdown"] | null = null;

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
      breakdown = agg.breakdown;
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
      riskScore: score, riskTier: tier, riskScoreBreakdown: breakdown, completedAt: new Date(),
    }).where(eq(underwritingRuns.id, run.id));

    await db.update(prospectApplications).set({
      riskScore: score, riskTier: tier, riskScoreBreakdown: breakdown,
      slaDeadline, pipelineHaltedAtPhase: haltedAtPhase,
      updatedAt: new Date(),
    }).where(eq(prospectApplications.id, applicationId));

    if (ticketCtx) {
      try {
        await markTicketPipelineFinished({
          db: db as unknown as Parameters<typeof markTicketPipelineFinished>[0]["db"],
          ticketId: ticketCtx.ticketId,
          haltedAtPhase, riskScore: score, riskTier: tier,
        });
      } catch (e) {
        console.error(`[orchestrator] markTicketPipelineFinished failed for app=${applicationId}:`, e);
      }
    }

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

  // Make sure the workflow ticket exists so this manual-phase result
  // is visible in the unified Worklist alongside the automated phases.
  let ticketCtx: { ticketId: number; definitionId: number } | null = null;
  try {
    ticketCtx = await ensureTicket(db as unknown as Parameters<typeof ensureTicket>[0], app);
  } catch (e) {
    console.error(`[orchestrator] ensureTicket (manual) failed for app=${applicationId}:`, e);
  }

  const [run] = await db.insert(underwritingRuns).values({
    applicationId, startedBy, status: "running",
    currentPhase: phase.key, totalPhases: 1,
  }).returning();

  const t0 = Date.now();
  const startedAt = new Date(t0);
  const ctx: PhaseContext = { db, app, prospect, owners, pathway: (app.pathway as Pathway) || PATHWAYS.TRADITIONAL };
  let result: PhaseResult;
  try {
    result = await PHASE_ADAPTERS[phaseKey](ctx);
  } catch (e) {
    result = { status: "error", score: 0, findings: [{ severity: "error", code: "phase_exception", message: e instanceof Error ? e.message : String(e) }] };
  }

  await persistPhaseResult(
    db, run.id, applicationId, phase, result, Date.now() - t0,
    ticketCtx ? { ticketId: ticketCtx.ticketId, definitionId: ticketCtx.definitionId, startedBy, startedAt } : undefined,
  );
  await db.update(underwritingRuns).set({
    status: "completed", currentPhase: null, completedAt: new Date(),
  }).where(eq(underwritingRuns.id, run.id));

  return { runId: run.id, phaseKey, result };
}

// Re-export tierFromScore for the routes layer.
export { tierFromScore };
