// Epic B — Underwriting state machine + phase catalogue.
// Shared client/server so both ends agree on legal transitions and phase keys.

export const APP_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  IN_REVIEW: "in_review",
  PENDING_INFO: "pending_info",
  APPROVED: "approved",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
} as const;
export type AppStatus = (typeof APP_STATUS)[keyof typeof APP_STATUS];

export const APP_SUB_STATUS = {
  INTAKE: "intake",
  EXTERNAL_CHECKS: "external_checks",
  MANUAL_REVIEW: "manual_review",
  SCORING: "scoring",
  COMMITTEE: "committee",
} as const;
export type AppSubStatus = (typeof APP_SUB_STATUS)[keyof typeof APP_SUB_STATUS];

// Allowed transitions. Empty array = terminal.
export const STATUS_TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  [APP_STATUS.DRAFT]: [APP_STATUS.SUBMITTED, APP_STATUS.WITHDRAWN],
  [APP_STATUS.SUBMITTED]: [APP_STATUS.IN_REVIEW, APP_STATUS.WITHDRAWN, APP_STATUS.DECLINED],
  [APP_STATUS.IN_REVIEW]: [APP_STATUS.PENDING_INFO, APP_STATUS.APPROVED, APP_STATUS.DECLINED, APP_STATUS.WITHDRAWN],
  [APP_STATUS.PENDING_INFO]: [APP_STATUS.IN_REVIEW, APP_STATUS.WITHDRAWN, APP_STATUS.DECLINED],
  [APP_STATUS.APPROVED]: [],
  [APP_STATUS.DECLINED]: [],
  [APP_STATUS.WITHDRAWN]: [],
};

export function canTransition(from: string | null | undefined, to: AppStatus): boolean {
  if (!from) return false;
  const list = STATUS_TRANSITIONS[from as AppStatus];
  return Array.isArray(list) && list.includes(to);
}

// 10-phase pipeline. `endpointName` references workflow_endpoints.name when an
// external integration is required; null phases are pure rules-engine.
export const PHASES: Array<{
  key: string;
  order: number;
  label: string;
  endpointName: string | null;
  weight: number;
  description: string;
}> = [
  { key: "intake_validation",      order: 1,  label: "Intake Validation",      endpointName: null,                       weight: 5,  description: "Required-field, format and schema checks." },
  { key: "ownership_kyc",          order: 2,  label: "Ownership / KYC",        endpointName: null,                       weight: 15, description: "Owners listed, identity fields present, ownership totals 100%." },
  { key: "business_verification",  order: 3,  label: "Business Verification",  endpointName: "uw_business_verification", weight: 10, description: "Verify legal name, EIN and business status with external bureau." },
  { key: "credit_check",           order: 4,  label: "Credit Check",           endpointName: "uw_credit_check",          weight: 15, description: "Soft-pull principal credit score." },
  { key: "ofac_sanctions",         order: 5,  label: "OFAC / Sanctions",       endpointName: "uw_ofac_sanctions",        weight: 20, description: "Screen owners and entity against sanctions lists." },
  { key: "mcc_policy",             order: 6,  label: "MCC Policy",             endpointName: null,                       weight: 10, description: "Validate MCC against acquirer policy & restricted list." },
  { key: "fraud_screening",        order: 7,  label: "Fraud Screening",        endpointName: "uw_fraud_screening",       weight: 10, description: "Device, email, IP and velocity screening." },
  { key: "document_review",        order: 8,  label: "Document Review",        endpointName: null,                       weight: 5,  description: "Required documents present and not expired." },
  { key: "financial_analysis",     order: 9,  label: "Financial Analysis",     endpointName: null,                       weight: 5,  description: "Volume, average ticket and high ticket within policy." },
  { key: "final_scoring",          order: 10, label: "Final Scoring",          endpointName: null,                       weight: 5,  description: "Aggregate weighted score and assign tier." },
];

export type PhaseStatus = "pass" | "warn" | "fail" | "skipped" | "error";
export type IssueSeverity = "info" | "warning" | "error" | "critical";

export function tierFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 80) return "low";
  if (score >= 50) return "medium";
  return "high";
}
