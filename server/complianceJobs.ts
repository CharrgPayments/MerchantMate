// Epic F — Compliance, SLAs & Operations Polish
//
// Background tickers and helpers for SLA breach detection, retention archival,
// scheduled report dispatch, and schema drift monitoring. All jobs run on
// simple in-process timers, are best-effort (errors are logged, not thrown),
// and use the static `db` pool — no per-request env switching.

import { db } from "./db";
import {
  prospectApplications,
  merchantProspects,
  slaBreaches,
  archivedApplications,
  scheduledReports,
  scheduledReportRuns,
  schemaDriftAlerts,
  users,
  agents,
  type ScheduledReport,
} from "@shared/schema";
import { and, eq, lt, isNotNull, sql, desc, gte, inArray } from "drizzle-orm";
import { auditService } from "./auditService";
import { emailService } from "./emailService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OPEN_FAMILIES = new Set([
  "draft", "submitted", "in_review",
  "SUB", "CUW", "P1", "P2", "P3",
]);

function isOpenStatus(status: string): boolean {
  if (OPEN_FAMILIES.has(status)) return true;
  // Treat any pending sub-state and the underwriting code prefix groups as open.
  return /^P[0-9]/.test(status) || status === "in_review";
}

function isTerminalArchivable(status: string): boolean {
  // Withdrawn (W*) and Declined (D*) families are eligible for archival.
  return /^W[0-9]/.test(status) || /^D[0-9]/.test(status) ||
         status === "withdrawn" || status === "declined";
}

function nextRunFromCadence(now: Date, cadence: string): Date {
  const d = new Date(now);
  switch (cadence) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1); break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7); break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1); break;
    default:
      d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

// ─── SLA breach detection ────────────────────────────────────────────────────

export async function detectSlaBreaches(): Promise<{ inserted: number }> {
  const now = new Date();
  let inserted = 0;
  try {
    const overdue = await db.select({
      id: prospectApplications.id,
      prospectId: prospectApplications.prospectId,
      pathway: prospectApplications.pathway,
      status: prospectApplications.status,
      slaDeadline: prospectApplications.slaDeadline,
    })
    .from(prospectApplications)
    .where(and(isNotNull(prospectApplications.slaDeadline), lt(prospectApplications.slaDeadline, now)));

    for (const a of overdue) {
      if (!a.slaDeadline) continue;
      if (!isOpenStatus(a.status)) continue; // closed apps no longer breach
      const hoursOverdue = Math.max(0, Math.floor((now.getTime() - a.slaDeadline.getTime()) / 3_600_000));
      try {
        const result = await db.insert(slaBreaches).values({
          applicationId: a.id,
          prospectId: a.prospectId,
          pathway: a.pathway,
          status: a.status,
          deadlineAt: a.slaDeadline,
          hoursOverdue,
          acknowledged: false,
        }).onConflictDoNothing().returning({ id: slaBreaches.id });
        if (result.length > 0) {
          inserted += 1;
          await auditService.logAction("sla_breach_detected", "applications", {
            ipAddress: "system",
          }, {
            resourceId: String(a.id),
            riskLevel: "high",
            notes: `Application ${a.id} breached ${a.pathway.toUpperCase()} SLA by ${hoursOverdue}h`,
          });
          await dispatchSlaBreachEmails(a.id, a.pathway, a.status, hoursOverdue, a.slaDeadline);
        }
      } catch (err) {
        console.error("[complianceJobs] sla insert failed", err);
      }
    }
  } catch (err) {
    console.error("[complianceJobs] detectSlaBreaches failed", err);
  }
  return { inserted };
}

async function dispatchSlaBreachEmails(
  applicationId: number,
  pathway: string,
  status: string,
  hoursOverdue: number,
  deadlineAt: Date,
): Promise<void> {
  try {
    const [appRow] = await db.select({
      assignedReviewerId: prospectApplications.assignedReviewerId,
    }).from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);

    const reviewUrl = `${(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/underwriting-review/${applicationId}`;
    const recipients = new Map<string, { firstName?: string }>();

    if (appRow?.assignedReviewerId) {
      const [u] = await db.select().from(users).where(eq(users.id, appRow.assignedReviewerId)).limit(1);
      if (u?.email) recipients.set(u.email, { firstName: u.firstName ?? undefined });
    }
    const seniorRoles = ["senior_underwriter"];
    const seniors = (await db.select().from(users)).filter((u) => {
      const arr = Array.isArray(u.roles) ? u.roles : [];
      return arr.some((r) => seniorRoles.includes(r));
    });
    for (const s of seniors) {
      if (s.email) recipients.set(s.email, { firstName: s.firstName ?? undefined });
    }

    await Promise.all(Array.from(recipients.entries()).map(([to, meta]) =>
      emailService.sendSlaBreachAlert({
        to, firstName: meta.firstName, applicationId, pathway, status,
        hoursOverdue, deadlineAt, reviewUrl,
      }),
    ));
  } catch (err) {
    console.error("[complianceJobs] sla breach email dispatch failed", err);
  }
}

// ─── Retention archival ──────────────────────────────────────────────────────

const RETENTION_DAYS = Number(process.env.APPLICATION_RETENTION_DAYS ?? 90);

export async function archiveExpiredApplications(): Promise<{ archived: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let archived = 0;
  try {
    // Soft archive only: copy a snapshot into archived_applications but DO NOT
    // delete the source row. Many underwriting tables FK to prospect_applications
    // with onDelete: cascade, so a destructive delete here would permanently lose
    // audit / underwriting evidence — explicitly forbidden by SOC2 retention.
    // Operators can hard-delete later via a separate authorized purge job.
    const candidates = await db.select().from(prospectApplications)
      .where(lt(prospectApplications.updatedAt, cutoff));
    const toArchive = candidates.filter((a) => isTerminalArchivable(a.status));
    for (const a of toArchive) {
      try {
        // Skip if already archived (idempotent).
        const existing = await db.select({ id: archivedApplications.id })
          .from(archivedApplications)
          .where(eq(archivedApplications.originalApplicationId, a.id))
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(archivedApplications).values({
          originalApplicationId: a.id,
          prospectId: a.prospectId,
          finalStatus: a.status,
          applicationSnapshot: a,
          archivedReason: `retention_policy_${RETENTION_DAYS}d`,
        });
        archived += 1;
        await auditService.logAction("application_archived", "applications", { ipAddress: "system" }, {
          resourceId: String(a.id),
          riskLevel: "medium",
          notes: `Archived ${a.status} application after ${RETENTION_DAYS}d retention`,
        });
      } catch (err) {
        console.error("[complianceJobs] archive failed for app", a.id, err);
      }
    }
  } catch (err) {
    console.error("[complianceJobs] archiveExpiredApplications failed", err);
  }
  return { archived };
}

// ─── Scheduled reports ───────────────────────────────────────────────────────

export type ReportTemplate =
  | "sla_summary"
  | "underwriting_pipeline"
  | "commission_payouts"
  | "residual_summary"
  | "prospect_funnel";

export async function buildReport(template: ReportTemplate): Promise<{ subject: string; html: string; text: string; rowCount: number }> {
  if (template === "sla_summary") {
    const open = await db.select().from(slaBreaches).where(eq(slaBreaches.acknowledged, false)).orderBy(desc(slaBreaches.detectedAt));
    const rows = open.slice(0, 50);
    const tableRows = rows.map((r) =>
      `<tr><td>${r.applicationId}</td><td>${r.pathway}</td><td>${r.status}</td><td>${r.hoursOverdue}h</td><td>${r.detectedAt.toISOString()}</td></tr>`
    ).join("");
    return {
      rowCount: open.length,
      subject: `[CoreCRM] SLA Breach Summary — ${open.length} unacknowledged`,
      html: `<h2>Unacknowledged SLA breaches: ${open.length}</h2>` +
            `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
            `<th>App</th><th>Pathway</th><th>Status</th><th>Overdue</th><th>Detected</th></tr></thead>` +
            `<tbody>${tableRows}</tbody></table>`,
      text: `Unacknowledged SLA breaches: ${open.length}\n` + rows.map((r) =>
        `App ${r.applicationId} (${r.pathway}, ${r.status}) overdue ${r.hoursOverdue}h since ${r.detectedAt.toISOString()}`
      ).join("\n"),
    };
  }
  if (template === "underwriting_pipeline") {
    const counts = await db.execute(sql`
      SELECT status, COUNT(*)::int as count
      FROM prospect_applications
      GROUP BY status ORDER BY status`);
    const rows = (counts.rows as Array<{ status: string; count: number }>) || [];
    const tableRows = rows.map((r) => `<tr><td>${r.status}</td><td>${r.count}</td></tr>`).join("");
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    return {
      rowCount: total,
      subject: `[CoreCRM] Underwriting Pipeline — ${total} applications`,
      html: `<h2>Pipeline: ${total} applications</h2>` +
            `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
            `<th>Status</th><th>Count</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      text: `Pipeline (${total} apps):\n` + rows.map((r) => `${r.status}: ${r.count}`).join("\n"),
    };
  }
  if (template === "residual_summary") {
    const data = await db.execute(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount),0)::numeric AS total
      FROM commission_events
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1 DESC`)
      .catch(() => ({ rows: [] as Array<{ period: string; count: number; total: string }> }));
    const rows = (data.rows as Array<{ period: string; count: number; total: string }>) || [];
    const tableRows = rows.map((r) => `<tr><td>${r.period}</td><td>${r.count}</td><td>$${Number(r.total).toFixed(2)}</td></tr>`).join("");
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const grand = rows.reduce((s, r) => s + Number(r.total), 0);
    return {
      rowCount: total,
      subject: `[CoreCRM] Residual Summary (6mo) — $${grand.toFixed(2)}`,
      html: `<h2>Residuals — last 6 months</h2>` +
            `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
            `<th>Period</th><th>Entries</th><th>Net Total</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      text: `Residuals (6mo):\n` + rows.map((r) => `${r.period}: ${r.count} ($${Number(r.total).toFixed(2)})`).join("\n"),
    };
  }
  if (template === "prospect_funnel") {
    const data = await db.execute(sql`
      SELECT status AS stage, COUNT(*)::int AS count
      FROM merchant_prospects
      GROUP BY status ORDER BY status`)
      .catch(() => ({ rows: [] as Array<{ stage: string; count: number }> }));
    const rows = (data.rows as Array<{ stage: string; count: number }>) || [];
    const tableRows = rows.map((r) => `<tr><td>${r.stage ?? "(none)"}</td><td>${r.count}</td></tr>`).join("");
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    return {
      rowCount: total,
      subject: `[CoreCRM] Prospect Funnel — ${total} prospects`,
      html: `<h2>Prospect funnel: ${total}</h2>` +
            `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
            `<th>Stage</th><th>Count</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      text: `Prospect funnel (${total}):\n` + rows.map((r) => `${r.stage ?? "(none)"}: ${r.count}`).join("\n"),
    };
  }
  // commission_payouts — last 30 days of commission_events grouped by status.
  const commissionData = await db.execute(sql`
    SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS total
    FROM commission_events
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY status ORDER BY status`).catch(() => ({ rows: [] as Array<{ status: string; count: number; total: string }> }));
  const rows = (commissionData.rows as Array<{ status: string; count: number; total: string }>) || [];
  const tableRows = rows.map((r) => `<tr><td>${r.status}</td><td>${r.count}</td><td>$${Number(r.total).toFixed(2)}</td></tr>`).join("");
  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return {
    rowCount: total,
    subject: `[CoreCRM] Commission Payouts (last 30d) — ${total} entries`,
    html: `<h2>Commission payouts — last 30 days</h2>` +
          `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
          `<th>Status</th><th>Count</th><th>Total</th></tr></thead><tbody>${tableRows}</tbody></table>`,
    text: `Commission payouts (last 30d):\n` + rows.map((r) => `${r.status}: ${r.count} ($${Number(r.total).toFixed(2)})`).join("\n"),
  };
}

export async function runScheduledReport(report: ScheduledReport): Promise<{ status: "success" | "failed"; rowCount: number; error?: string }> {
  try {
    const built = await buildReport(report.template as ReportTemplate);
    let allOk = true;
    for (const recipient of report.recipients) {
      const ok = await emailService.sendGenericEmail({
        to: recipient,
        subject: built.subject,
        html: built.html,
        text: built.text,
      }).catch((e) => {
        console.error(`[complianceJobs] report email failed → ${recipient}`, e);
        return false;
      });
      if (!ok) allOk = false;
    }
    const status: "success" | "failed" = allOk ? "success" : "failed";
    await db.insert(scheduledReportRuns).values({
      reportId: report.id, status, rowCount: built.rowCount,
      errorMessage: allOk ? null : "one or more recipients failed",
    });
    await db.update(scheduledReports).set({
      lastRunAt: new Date(),
      nextRunAt: nextRunFromCadence(new Date(), report.cadence),
      updatedAt: new Date(),
    }).where(eq(scheduledReports.id, report.id));
    return { status, rowCount: built.rowCount };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await db.insert(scheduledReportRuns).values({
      reportId: report.id, status: "failed", rowCount: 0, errorMessage: msg,
    }).catch(() => {});
    await db.update(scheduledReports).set({
      lastRunAt: new Date(),
      nextRunAt: nextRunFromCadence(new Date(), report.cadence),
      updatedAt: new Date(),
    }).where(eq(scheduledReports.id, report.id)).catch(() => {});
    return { status: "failed", rowCount: 0, error: msg };
  }
}

export async function dispatchDueReports(): Promise<{ dispatched: number }> {
  let dispatched = 0;
  try {
    const due = await db.select().from(scheduledReports)
      .where(and(eq(scheduledReports.enabled, true), lt(scheduledReports.nextRunAt, new Date())));
    for (const r of due) {
      const result = await runScheduledReport(r);
      dispatched += 1;
      await auditService.logAction("scheduled_report_dispatched", "reports", { ipAddress: "system" }, {
        resourceId: String(r.id),
        riskLevel: "low",
        notes: `Report ${r.name} (${r.template}) ${result.status} — ${result.rowCount} rows`,
      });
    }
  } catch (err) {
    console.error("[complianceJobs] dispatchDueReports failed", err);
  }
  return { dispatched };
}

// ─── Schema drift detection ──────────────────────────────────────────────────

async function getSchemaSnapshot(env: string): Promise<any | null> {
  try {
    const { getDynamicDatabase } = await import("./db");
    const envDb = getDynamicDatabase(env);
    const tables = await envDb.execute(sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`);
    return { env, columns: tables.rows ?? [] };
  } catch (err) {
    console.error(`[complianceJobs] schema snapshot for ${env} failed`, err);
    return null;
  }
}

type ColumnInfo = { table_name: string; column_name: string; data_type: string; is_nullable: string };
type SchemaSnapshot = { columns: ColumnInfo[] };
type SchemaDiff =
  | { kind: "missing_in_target"; column: string; base: ColumnInfo }
  | { kind: "extra_in_target"; column: string; target: ColumnInfo }
  | { kind: "type_mismatch"; column: string; base: ColumnInfo; target: ColumnInfo };

function diffSchemas(base: SchemaSnapshot, target: SchemaSnapshot): SchemaDiff[] {
  const baseSet = new Map<string, ColumnInfo>();
  for (const c of base.columns) baseSet.set(`${c.table_name}.${c.column_name}`, c);
  const targetSet = new Map<string, ColumnInfo>();
  for (const c of target.columns) targetSet.set(`${c.table_name}.${c.column_name}`, c);
  const diffs: SchemaDiff[] = [];
  baseSet.forEach((v, k) => {
    if (!targetSet.has(k)) diffs.push({ kind: "missing_in_target", column: k, base: v });
  });
  targetSet.forEach((v, k) => {
    const b = baseSet.get(k);
    if (!b) {
      diffs.push({ kind: "extra_in_target", column: k, target: v });
    } else if (b.data_type !== v.data_type || b.is_nullable !== v.is_nullable) {
      diffs.push({ kind: "type_mismatch", column: k, base: b, target: v });
    }
  });
  return diffs;
}

export async function detectSchemaDrift(): Promise<{ alerts: number }> {
  let alerts = 0;
  try {
    const base = await getSchemaSnapshot("production");
    if (!base) return { alerts: 0 };
    for (const target of ["development", "test"] as const) {
      const t = await getSchemaSnapshot(target);
      if (!t) continue;
      const diffs = diffSchemas(base, t);
      if (diffs.length === 0) continue;
      // Dedup: only alert if no unacknowledged alert already exists for this pair.
      const existing = await db.select().from(schemaDriftAlerts).where(and(
        eq(schemaDriftAlerts.acknowledged, false),
        eq(schemaDriftAlerts.baseEnvironment, "production"),
        eq(schemaDriftAlerts.targetEnvironment, target),
      )).limit(1);
      if (existing.length > 0) continue;
      await db.insert(schemaDriftAlerts).values({
        baseEnvironment: "production",
        targetEnvironment: target,
        differenceCount: diffs.length,
        differences: diffs,
      });
      alerts += 1;
      await auditService.logAction("schema_drift_detected", "system", { ipAddress: "system" }, {
        riskLevel: "high",
        notes: `Schema drift production vs ${target}: ${diffs.length} differences`,
      });
      // Notify super-admins (best effort).
      try {
        const admins = await db.select({ email: users.email }).from(users)
          .where(sql`'super_admin' = ANY(${users.roles})`);
        for (const a of admins) {
          if (!a.email) continue;
          await emailService.sendGenericEmail({
            to: a.email,
            subject: `[CoreCRM] Schema drift detected: production vs ${target}`,
            html: `<p>${diffs.length} schema differences detected between production and ${target}.</p>` +
                  `<p>Review in Security &rarr; Schema Drift Alerts.</p>`,
            text: `${diffs.length} schema differences detected between production and ${target}.`,
          }).catch((e) => console.error("[complianceJobs] drift email failed", e));
        }
      } catch (e) {
        console.error("[complianceJobs] drift notify failed", e);
      }
    }
  } catch (err) {
    console.error("[complianceJobs] detectSchemaDrift failed", err);
  }
  return { alerts };
}

// ─── Scheduler bootstrap ─────────────────────────────────────────────────────

let started = false;
const handles: NodeJS.Timeout[] = [];

const MIN = 60_000;
const HOUR = 60 * MIN;

export function startComplianceJobs(): void {
  if (started) return;
  started = true;
  // Stagger initial runs so we don't slam the DB at boot.
  setTimeout(() => detectSlaBreaches(), 30_000);
  setTimeout(() => dispatchDueReports(), 60_000);
  setTimeout(() => archiveExpiredApplications(), 90_000);
  setTimeout(() => detectSchemaDrift(), 120_000);

  handles.push(setInterval(detectSlaBreaches, 15 * MIN));
  handles.push(setInterval(dispatchDueReports, HOUR));
  handles.push(setInterval(archiveExpiredApplications, 24 * HOUR));
  handles.push(setInterval(detectSchemaDrift, 24 * HOUR));
  console.log("[complianceJobs] scheduled tickers started (sla=15m, reports=1h, archive=24h, drift=24h)");
}

export function stopComplianceJobs(): void {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
  started = false;
}
