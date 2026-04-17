// Built-in website review: confirms the site is reachable, prefers HTTPS,
// flags obviously dead/redirect-spam pages, and scans the page body for a
// small list of high-risk keywords. Heavier checks (TLS chain, malware
// reputation, content category) belong in a configured workflow_endpoint.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";

const PROHIBITED_KEYWORDS = [
  "cbd", "marijuana", "cannabis", "kratom", "firearms", "ammunition",
  "escort", "adult cam", "casino", "online gambling", "cryptocurrency exchange",
];

export async function verifyWebsite(input: { url?: string | null }): Promise<PhaseResult> {
  const findings: PhaseFinding[] = [];
  const raw = (input.url || "").trim();
  if (!raw) {
    findings.push({ severity: "error", code: "website_missing", message: "Website URL not provided", fieldPath: "websiteUrl" });
    return { status: "fail", score: 0, findings };
  }
  let target: URL;
  try {
    target = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    findings.push({ severity: "error", code: "website_invalid_url", message: `Invalid URL "${raw}"`, fieldPath: "websiteUrl" });
    return { status: "fail", score: 0, findings };
  }
  if (target.protocol !== "https:") {
    findings.push({ severity: "warning", code: "website_no_https", message: "Site is not served over HTTPS" });
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  let body = "";
  let httpStatus = 0;
  try {
    const r = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "CoreCRM-UnderwritingBot/1.0" },
    });
    httpStatus = r.status;
    if (!r.ok) {
      findings.push({ severity: "error", code: "website_unreachable", message: `HTTP ${r.status} from ${target.host}` });
      return { status: "fail", score: 20, findings };
    }
    // Read at most 64KB of the body for keyword scanning.
    const reader = r.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 64 * 1024) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      reader.cancel().catch(() => {});
    }
  } catch (e) {
    findings.push({ severity: "error", code: "website_fetch_error", message: e instanceof Error ? e.message : String(e) });
    return { status: "fail", score: 10, findings };
  } finally {
    clearTimeout(timeout);
  }

  const lowered = body.toLowerCase();
  const hits = PROHIBITED_KEYWORDS.filter((k) => lowered.includes(k));
  if (hits.length > 0) {
    findings.push({ severity: "critical", code: "website_prohibited_content", message: `Prohibited keywords detected: ${hits.join(", ")}` });
    return { status: "fail", score: 10, findings };
  }
  if (body.length < 200) {
    findings.push({ severity: "warning", code: "website_thin_content", message: `Very small page body (${body.length} bytes)` });
    return { status: "warn", score: 55, findings };
  }
  findings.unshift({ severity: "info", code: "website_reachable", message: `HTTP ${httpStatus} ${target.host}` });
  return { status: "pass", score: target.protocol === "https:" ? 90 : 75, findings };
}
