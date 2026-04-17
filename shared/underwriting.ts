// Epic B — Underwriting state machine + phase catalogue.
// Status codes follow the Charrg FRD taxonomy:
//   SUB    Submitted
//   CUW    Currently Under Writing (in active review)
//   P1     Pending — info requested from applicant
//   P2     Pending — awaiting external response
//   P3     Pending — escalated to senior review
//   W1     Withdrawn by applicant
//   W2     Withdrawn by agent
//   W3     Withdrawn — system / SLA timeout
//   D1     Declined — KYC / identity failure
//   D2     Declined — OFAC / sanctions hit
//   D3     Declined — credit / financial
//   D4     Declined — policy / other
//   APPROVED  Approved (terminal)

import { ACTIONS, type Action } from "./permissions";

export const APP_STATUS = {
  DRAFT: "draft",
  SUB: "SUB",
  CUW: "CUW",
  P1: "P1",
  P2: "P2",
  P3: "P3",
  W1: "W1",
  W2: "W2",
  W3: "W3",
  D1: "D1",
  D2: "D2",
  D3: "D3",
  D4: "D4",
  APPROVED: "APPROVED",
} as const;
export type AppStatus = (typeof APP_STATUS)[keyof typeof APP_STATUS];

// Status families used for queue filters and badge styling.
export const STATUS_FAMILY = {
  draft: "draft",
  SUB: "submitted",
  CUW: "in_review",
  P1: "pending", P2: "pending", P3: "pending",
  W1: "withdrawn", W2: "withdrawn", W3: "withdrawn",
  D1: "declined", D2: "declined", D3: "declined", D4: "declined",
  APPROVED: "approved",
} as const;
export type StatusFamily = (typeof STATUS_FAMILY)[keyof typeof STATUS_FAMILY];

export const STATUS_LABEL: Record<AppStatus, string> = {
  draft: "Draft",
  SUB: "Submitted",
  CUW: "In Review",
  P1: "Pending — Info Requested",
  P2: "Pending — External Response",
  P3: "Pending — Senior Review",
  W1: "Withdrawn — Applicant",
  W2: "Withdrawn — Agent",
  W3: "Withdrawn — System",
  D1: "Declined — KYC / Identity",
  D2: "Declined — OFAC / Sanctions",
  D3: "Declined — Credit / Financial",
  D4: "Declined — Policy / Other",
  APPROVED: "Approved",
};

// Transition matrix: each allowed transition declares the action permission
// the actor must hold. `requireReason` forces a non-empty reason on the
// transition endpoint so audit + status_history capture intent.
export interface TransitionRule {
  to: AppStatus;
  requires: Action;
  requireReason: boolean;
  description: string;
}

export const TRANSITION_RULES: Record<AppStatus, TransitionRule[]> = {
  draft: [
    { to: APP_STATUS.SUB, requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: false, description: "Submit application" },
    { to: APP_STATUS.W1,  requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: true,  description: "Applicant withdrew before submit" },
  ],
  SUB: [
    { to: APP_STATUS.CUW, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: false, description: "Begin review" },
    { to: APP_STATUS.W1,  requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true,  description: "Applicant withdrew" },
    { to: APP_STATUS.W2,  requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true,  description: "Agent withdrew" },
    { to: APP_STATUS.D4,  requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true,  description: "Decline at intake (policy)" },
  ],
  CUW: [
    { to: APP_STATUS.P1, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Request info from applicant" },
    { to: APP_STATUS.P2, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Hold for external response" },
    { to: APP_STATUS.P3, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Escalate to senior review" },
    { to: APP_STATUS.APPROVED, requires: ACTIONS.UNDERWRITING_APPROVE, requireReason: true, description: "Approve" },
    { to: APP_STATUS.D1, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — KYC / identity" },
    { to: APP_STATUS.D2, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — OFAC / sanctions" },
    { to: APP_STATUS.D3, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — credit / financial" },
    { to: APP_STATUS.D4, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — policy / other" },
    { to: APP_STATUS.W1, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Applicant withdrew" },
    { to: APP_STATUS.W2, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Agent withdrew" },
    { to: APP_STATUS.W3, requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "System / SLA timeout" },
  ],
  P1: [
    { to: APP_STATUS.CUW, requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: true, description: "Info received, resume review" },
    { to: APP_STATUS.W1,  requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: true, description: "Applicant withdrew" },
    { to: APP_STATUS.W3,  requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: true, description: "Auto-withdraw on info SLA timeout" },
    { to: APP_STATUS.D4,  requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — info not provided" },
  ],
  P2: [
    { to: APP_STATUS.CUW, requires: ACTIONS.UNDERWRITING_REVIEW, requireReason: true, description: "External response received" },
    { to: APP_STATUS.D4,  requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Decline — external response negative" },
    { to: APP_STATUS.W3,  requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Auto-withdraw on external SLA timeout" },
  ],
  P3: [
    { to: APP_STATUS.CUW,      requires: ACTIONS.UNDERWRITING_REVIEW,  requireReason: true, description: "Senior review complete — return to queue" },
    { to: APP_STATUS.APPROVED, requires: ACTIONS.UNDERWRITING_APPROVE, requireReason: true, description: "Senior review — approve" },
    { to: APP_STATUS.D1, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Senior review — decline KYC" },
    { to: APP_STATUS.D2, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Senior review — decline OFAC" },
    { to: APP_STATUS.D3, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Senior review — decline credit" },
    { to: APP_STATUS.D4, requires: ACTIONS.UNDERWRITING_DECLINE, requireReason: true, description: "Senior review — decline policy" },
  ],
  W1: [], W2: [], W3: [],
  D1: [], D2: [], D3: [], D4: [],
  APPROVED: [],
};

export function allowedTransitions(from: AppStatus | null | undefined): TransitionRule[] {
  if (!from) return [];
  return TRANSITION_RULES[from] || [];
}

export function findTransition(from: AppStatus, to: AppStatus): TransitionRule | null {
  return (TRANSITION_RULES[from] || []).find(r => r.to === to) || null;
}

// Pathways drive which phases run and which scoring model applies.
export const PATHWAYS = { TRADITIONAL: "traditional", PAYFAC: "payfac" } as const;
export type Pathway = (typeof PATHWAYS)[keyof typeof PATHWAYS];

// Adapter contract — orchestrator passes context, adapter returns a typed result.
export interface PhaseFinding {
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  code?: string;
  fieldPath?: string;
}
export interface PhaseResult {
  status: "pass" | "warn" | "fail" | "skipped" | "error";
  score: number; // 0-100
  findings: PhaseFinding[];
  externalRequest?: unknown;
  externalResponse?: unknown;
  endpointId?: number;
}

// 10-phase pipeline in spec-correct order. Each phase declares:
//   - whether it applies to traditional / payfac (skipPaths)
//   - whether it is a checkpoint (halts pipeline on fail)
//   - the workflow_endpoints lookup name for external phases
//   - weight for risk-scoring path (Traditional)
export interface PhaseDef {
  key: string;
  order: number;
  label: string;
  description: string;
  endpointName: string | null;
  weight: number;
  checkpoint: boolean;
  skipPaths: Pathway[];
  manual?: boolean; // true = only triggered by reviewer action, never auto
}

export const PHASES: PhaseDef[] = [
  { key: "mcc_validation",     order: 1,  label: "MCC Validation",            description: "MCC supported by acquirer; not on restricted list.",       endpointName: null,                        weight: 10, checkpoint: true,  skipPaths: [] },
  { key: "google_kyb",         order: 2,  label: "Google KYB",                description: "Verify legal entity via Google KYB.",                       endpointName: "uw_google_kyb",             weight: 10, checkpoint: false, skipPaths: [] },
  { key: "volume_threshold",   order: 3,  label: "Volume Threshold",          description: "Projected volume within acquirer & pathway limits.",        endpointName: null,                        weight: 8,  checkpoint: false, skipPaths: [PATHWAYS.PAYFAC] },
  { key: "phone_verification", order: 4,  label: "Phone Verification",        description: "Business phone reachable & matches application.",          endpointName: "uw_phone_verification",     weight: 5,  checkpoint: false, skipPaths: [] },
  { key: "match_ein",          order: 5,  label: "MATCH / EIN Lookup",        description: "TMF/MATCH and EIN lookup.",                                 endpointName: "uw_match_ein",              weight: 15, checkpoint: true,  skipPaths: [] },
  { key: "ofac_sanctions",     order: 6,  label: "OFAC / Sanctions",          description: "Owners and entity screened against sanctions lists.",       endpointName: "uw_ofac_sanctions",         weight: 20, checkpoint: true,  skipPaths: [] },
  { key: "sos_lookup",         order: 7,  label: "Secretary of State Lookup", description: "Active registration in formation state.",                   endpointName: "uw_sos_lookup",             weight: 8,  checkpoint: false, skipPaths: [] },
  { key: "ssn_verification",   order: 8,  label: "SSN Verification",          description: "Principal SSN verification.",                               endpointName: "uw_ssn_verification",       weight: 10, checkpoint: false, skipPaths: [] },
  { key: "credit_check",       order: 9,  label: "Credit Check",              description: "Soft-pull principal credit (Traditional only).",            endpointName: "uw_credit_check",           weight: 10, checkpoint: false, skipPaths: [PATHWAYS.PAYFAC] },
  { key: "website_review",     order: 10, label: "Website Review",            description: "Site live, terms/refunds present, content within policy.",  endpointName: "uw_website_review",         weight: 4,  checkpoint: false, skipPaths: [] },

  // Manual-only phases — Traditional pathway, reviewer triggers.
  { key: "derogatory_check",   order: 11, label: "Derogatory Check",          description: "Manual derogatory background check (Traditional).",         endpointName: "uw_derogatory_check",       weight: 0,  checkpoint: false, skipPaths: [PATHWAYS.PAYFAC], manual: true },
  { key: "g2_check",           order: 12, label: "G2 Check",                  description: "Manual G2 web check (Traditional).",                        endpointName: "uw_g2_check",               weight: 0,  checkpoint: false, skipPaths: [PATHWAYS.PAYFAC], manual: true },
];

export function phasesForPathway(p: Pathway, includeManual = false): PhaseDef[] {
  return PHASES.filter(ph => !ph.skipPaths.includes(p) && (includeManual || !ph.manual));
}

export type PhaseStatus = PhaseResult["status"];
export type IssueSeverity = PhaseFinding["severity"];

// Risk tier thresholds — Traditional pathway uses weighted scoring; PayFac uses
// checkpoint-only (any non-pass downgrades tier).
export function tierFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  return "high";
}

// PayFac: no scoring, tier derived from worst phase status.
export function tierFromCheckpoints(results: PhaseResult[]): "low" | "medium" | "high" {
  let worst: "low" | "medium" | "high" = "low";
  for (const r of results) {
    if (r.status === "fail" || r.status === "error") return "high";
    if (r.status === "warn" && worst === "low") worst = "medium";
  }
  return worst;
}

// PayFac SLA: 48h after a clean pipeline finishes — final-review window
// (per FRD acceptance criteria).
export const PAYFAC_SLA_HOURS = 48;
export function computeSlaDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + PAYFAC_SLA_HOURS * 3600 * 1000);
}

// Map a phase fail to the correct decline status code so the orchestrator can
// recommend a destination on auto-decline checkpoints.
export const PHASE_DECLINE_MAP: Record<string, AppStatus> = {
  mcc_validation: APP_STATUS.D4,
  match_ein: APP_STATUS.D1,
  ofac_sanctions: APP_STATUS.D2,
  credit_check: APP_STATUS.D3,
  ssn_verification: APP_STATUS.D1,
  google_kyb: APP_STATUS.D1,
};
