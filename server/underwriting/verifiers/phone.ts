// Built-in phone verification: format + length validity for US/NANP numbers.
// We deliberately keep this dependency-free; for richer carrier/line-type
// checks the operator can configure a workflow_endpoint (Twilio Lookup etc.)
// which the orchestrator will prefer.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";

export function verifyPhone(input: { phone?: string | null; name?: string | null }): PhaseResult {
  const findings: PhaseFinding[] = [];
  const raw = (input.phone || "").trim();
  if (!raw) {
    findings.push({ severity: "error", code: "phone_missing", message: "Business phone not provided", fieldPath: "businessPhone" });
    return { status: "fail", score: 0, findings };
  }
  // Strip everything but digits and a leading +.
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.length < 10 || digits.length > 15) {
    findings.push({ severity: "error", code: "phone_invalid_length", message: `Phone "${raw}" has ${digits.length} digits; expected 10-15`, fieldPath: "businessPhone" });
    return { status: "fail", score: 20, findings };
  }
  // NANP-specific sanity: area + exchange must not start with 0 or 1.
  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1)
    : digits.length === 10 ? digits : null;
  if (nanp) {
    const area = nanp.slice(0, 3);
    const exchange = nanp.slice(3, 6);
    if (area.startsWith("0") || area.startsWith("1")) {
      findings.push({ severity: "error", code: "phone_invalid_area", message: `Invalid area code ${area}`, fieldPath: "businessPhone" });
      return { status: "fail", score: 20, findings };
    }
    if (exchange.startsWith("0") || exchange.startsWith("1")) {
      findings.push({ severity: "warning", code: "phone_invalid_exchange", message: `Suspicious exchange ${exchange}`, fieldPath: "businessPhone" });
      return { status: "warn", score: 60, findings };
    }
  }
  // Reject obviously fake patterns (all same digit).
  if (/^(\d)\1+$/.test(digits.replace(/^1/, ""))) {
    findings.push({ severity: "error", code: "phone_repeated_digit", message: "Phone is a repeated-digit sequence", fieldPath: "businessPhone" });
    return { status: "fail", score: 0, findings };
  }
  return {
    status: "pass",
    score: 90,
    findings: [{ severity: "info", code: "phone_format_ok", message: `Format valid (${digits.length} digits)` }],
  };
}
