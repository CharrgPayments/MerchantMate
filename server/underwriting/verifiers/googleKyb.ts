// Built-in Google KYB-style check using the Google Places "Find Place" API.
// Confirms that the legal name + address resolves to a real, operating
// business listing. Requires GOOGLE_MAPS_API_KEY; otherwise returns skipped.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";

interface PlacesCandidate {
  name?: string;
  formatted_address?: string;
  business_status?: string;
  place_id?: string;
}

interface PlacesResponse {
  status?: string;
  candidates?: PlacesCandidate[];
  error_message?: string;
}

export interface GoogleKybInput {
  legalName?: string | null;
  address?: string | null;
  state?: string | null;
}

export async function verifyGoogleKyb(input: GoogleKybInput): Promise<PhaseResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    return {
      status: "skipped",
      score: 0,
      findings: [{ severity: "info", code: "google_kyb_no_key", message: "GOOGLE_MAPS_API_KEY not set; skipping built-in Google KYB" }],
    };
  }
  if (!input.legalName) {
    return {
      status: "fail", score: 0,
      findings: [{ severity: "error", code: "google_kyb_no_name", message: "Legal name required for Google KYB", fieldPath: "companyName" }],
    };
  }
  const queryParts = [input.legalName, input.address, input.state].filter(Boolean).join(" ");
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", queryParts);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "name,formatted_address,business_status,place_id");
  url.searchParams.set("key", key);

  let resp: PlacesResponse;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    resp = (await r.json()) as PlacesResponse;
  } catch (e) {
    return {
      status: "error", score: 0,
      findings: [{ severity: "error", code: "google_kyb_fetch_error", message: e instanceof Error ? e.message : String(e) }],
    };
  }
  if (resp.status === "REQUEST_DENIED" || resp.status === "INVALID_REQUEST") {
    return {
      status: "error", score: 0,
      findings: [{ severity: "error", code: "google_kyb_api_error", message: resp.error_message || resp.status || "Places API error" }],
    };
  }
  const candidates = resp.candidates ?? [];
  if (candidates.length === 0) {
    return {
      status: "warn", score: 40,
      findings: [{ severity: "warning", code: "google_kyb_no_match", message: `No Google Places match for "${input.legalName}"` }],
    };
  }
  const top = candidates[0];
  const findings: PhaseFinding[] = [
    { severity: "info", code: "google_kyb_match", message: `Matched: ${top.name} — ${top.formatted_address}` },
  ];
  if (top.business_status === "CLOSED_PERMANENTLY" || top.business_status === "CLOSED_TEMPORARILY") {
    findings.push({ severity: "error", code: "google_kyb_closed", message: `Listing reports ${top.business_status}` });
    return { status: "fail", score: 20, findings };
  }
  return { status: "pass", score: 90, findings };
}
