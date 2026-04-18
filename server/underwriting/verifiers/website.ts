// Built-in website review: confirms the site is reachable, prefers HTTPS,
// flags obviously dead/redirect-spam pages, and scans the page body for a
// small list of high-risk keywords. Heavier checks (TLS chain, malware
// reputation, content category) belong in a configured workflow_endpoint.

import type { PhaseResult, PhaseFinding } from "@shared/underwriting";
import { promises as dns } from "node:dns";
import net from "node:net";

// SSRF guard: block non-HTTP(S) protocols, non-standard ports, and any DNS
// resolution that lands on loopback / private / link-local / unique-local /
// CGNAT / multicast / broadcast / cloud metadata ranges.
const ALLOWED_PORTS = new Set([80, 443]);

function isBlockedIPv4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // 127.0.0.0/8 loopback
  if (a === 0) return true;                           // 0.0.0.0/8
  if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                          // multicast/reserved/broadcast
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const norm = ip.toLowerCase();
  if (norm === "::1" || norm === "::") return true;
  if (norm.startsWith("fe80:")) return true;          // link-local
  if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // unique-local
  if (norm.startsWith("ff")) return true;             // multicast
  // IPv4-mapped (::ffff:a.b.c.d)
  const m = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isBlockedIPv4(m[1]);
  return false;
}

async function assertSafeUrl(target: URL): Promise<void> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Disallowed protocol ${target.protocol}`);
  }
  const port = target.port
    ? Number(target.port)
    : target.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new Error(`Disallowed port ${port}`);
  const host = target.hostname;
  if (!host) throw new Error("Empty host");
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new Error("Loopback hostname blocked");
  }
  // If host is already a literal IP, validate directly.
  const ipKind = net.isIP(host);
  if (ipKind === 4) {
    if (isBlockedIPv4(host)) throw new Error(`Blocked IP ${host}`);
    return;
  }
  if (ipKind === 6) {
    if (isBlockedIPv6(host)) throw new Error(`Blocked IP ${host}`);
    return;
  }
  // Otherwise resolve DNS and check every A/AAAA record. Reject if ANY record
  // resolves to a blocked range (defense against DNS rebinding pre-fetch).
  let records: { address: string; family: number }[] = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw new Error(`DNS lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (records.length === 0) throw new Error("No DNS records");
  for (const r of records) {
    if (r.family === 4 && isBlockedIPv4(r.address)) {
      throw new Error(`Blocked IP ${r.address} for ${host}`);
    }
    if (r.family === 6 && isBlockedIPv6(r.address)) {
      throw new Error(`Blocked IP ${r.address} for ${host}`);
    }
  }
}

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
  try {
    await assertSafeUrl(target);
  } catch (e) {
    findings.push({
      severity: "error",
      code: "website_blocked_target",
      message: `Target rejected by SSRF guard: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { status: "fail", score: 0, findings };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  let body = "";
  let httpStatus = 0;
  try {
    // redirect: "manual" so we can re-validate every hop against assertSafeUrl
    // (defends against open redirects pointing at internal infrastructure).
    let currentUrl = target;
    let r: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      r = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "CoreCRM-UnderwritingBot/1.0" },
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        const next = new URL(r.headers.get("location")!, currentUrl);
        await assertSafeUrl(next);
        currentUrl = next;
        continue;
      }
      break;
    }
    if (!r) throw new Error("No response");
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
