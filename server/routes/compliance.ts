// Epic F — Compliance, SLAs & Operations Polish: HTTP endpoints.
//
// Mounted by registerRoutes() in server/routes.ts. Most endpoints require an
// admin permission; the entity-activity feed is broader (any authenticated
// user) since it only exposes audit log rows scoped to a single resource.

import { Router } from "express";
import { db } from "../db";
import {
  auditLogs,
  prospectApplications,
  prospectSignatures,
  prospectOwners,
  slaBreaches,
  scheduledReports,
  scheduledReportRuns,
  schemaDriftAlerts,
  archivedApplications,
  insertScheduledReportSchema,
} from "@shared/schema";
import { and, eq, desc, lt, isNotNull, sql, count } from "drizzle-orm";
import { isAuthenticated, requirePerm } from "../replitAuth";
import {
  detectSlaBreaches,
  detectSchemaDrift,
  archiveExpiredApplications,
  buildReport,
  runScheduledReport,
  type ReportTemplate,
} from "../complianceJobs";
import { z } from "zod";

const router = Router();

// ─── Per-entity activity feed (audit_logs scoped) ────────────────────────────
//
// Returns recent audit-log entries for a single resource. Restricted to users
// with `audit:read` (admins, underwriters, deployment) so audit metadata cannot
// be enumerated cross-tenant by ordinary authenticated users (IDOR mitigation).
// Whitelist of resources we expose through this generic endpoint.
const ALLOWED_AUDIT_RESOURCES = new Set([
  "prospect", "application", "merchant", "agent", "user", "campaign",
]);

router.get("/audit/entity/:resource/:resourceId", isAuthenticated, requirePerm("admin:read"), async (req, res) => {
  try {
    const { resource, resourceId } = req.params;
    if (!ALLOWED_AUDIT_RESOURCES.has(resource)) {
      return res.status(400).json({ message: "Unsupported resource" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const rows = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.resource, resource), eq(auditLogs.resourceId, resourceId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (err) {
    console.error("[compliance] entity activity failed", err);
    res.status(500).json({ message: "Failed to load activity" });
  }
});

// ─── SLA status summary ──────────────────────────────────────────────────────

router.get("/applications/sla-status", isAuthenticated, requirePerm("admin:read"), async (_req, res) => {
  try {
    const now = new Date();
    const overdueOpen = await db.select({
      id: prospectApplications.id,
      prospectId: prospectApplications.prospectId,
      pathway: prospectApplications.pathway,
      status: prospectApplications.status,
      slaDeadline: prospectApplications.slaDeadline,
    })
    .from(prospectApplications)
    .where(and(isNotNull(prospectApplications.slaDeadline), lt(prospectApplications.slaDeadline, now)));

    const breaches = await db.select().from(slaBreaches)
      .where(eq(slaBreaches.acknowledged, false))
      .orderBy(desc(slaBreaches.detectedAt))
      .limit(200);

    res.json({
      overdueOpenCount: overdueOpen.length,
      unacknowledgedBreaches: breaches.length,
      breaches,
      overdueApplications: overdueOpen.map((a) => ({
        ...a,
        hoursOverdue: a.slaDeadline ? Math.floor((now.getTime() - a.slaDeadline.getTime()) / 3_600_000) : 0,
      })),
    });
  } catch (err) {
    console.error("[compliance] sla-status failed", err);
    res.status(500).json({ message: "Failed to load SLA status" });
  }
});

router.post("/applications/sla-breaches/:id/acknowledge", isAuthenticated, requirePerm("admin:manage"), async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user?.claims?.sub ?? req.user?.id ?? "unknown";
    const result = await db.update(slaBreaches).set({
      acknowledged: true,
      acknowledgedBy: String(userId),
      acknowledgedAt: new Date(),
      notes: typeof req.body?.notes === "string" ? req.body.notes : null,
    }).where(eq(slaBreaches.id, id)).returning();
    if (result.length === 0) return res.status(404).json({ message: "Breach not found" });
    res.json(result[0]);
  } catch (err) {
    console.error("[compliance] acknowledge breach failed", err);
    res.status(500).json({ message: "Failed to acknowledge breach" });
  }
});

router.post("/applications/sla-breaches/scan", isAuthenticated, requirePerm("admin:manage"), async (_req, res) => {
  const result = await detectSlaBreaches();
  res.json(result);
});

// ─── E-sign trail ────────────────────────────────────────────────────────────

router.get("/prospects/:id/signature-trail", isAuthenticated, requirePerm("admin:read"), async (req, res) => {
  try {
    const prospectId = Number(req.params.id);
    if (Number.isNaN(prospectId)) return res.status(400).json({ message: "Invalid prospect id" });
    const rows = await db.select({
      id: prospectSignatures.id,
      ownerId: prospectSignatures.ownerId,
      ownerName: prospectOwners.name,
      ownerEmail: prospectOwners.email,
      signatureType: prospectSignatures.signatureType,
      ipAddress: prospectSignatures.ipAddress,
      userAgent: prospectSignatures.userAgent,
      documentHash: prospectSignatures.documentHash,
      submittedAt: prospectSignatures.submittedAt,
    }).from(prospectSignatures)
      .leftJoin(prospectOwners, eq(prospectSignatures.ownerId, prospectOwners.id))
      .where(eq(prospectSignatures.prospectId, prospectId))
      .orderBy(desc(prospectSignatures.submittedAt));
    res.json(rows);
  } catch (err) {
    console.error("[compliance] signature trail failed", err);
    res.status(500).json({ message: "Failed to load signature trail" });
  }
});

// ─── Scheduled reports CRUD ──────────────────────────────────────────────────

const reportCadenceSchema = z.enum(["daily", "weekly", "monthly"]);
const reportTemplateSchema = z.enum(["sla_summary", "underwriting_pipeline", "commission_payouts"]);

const createReportSchema = z.object({
  name: z.string().min(1).max(120),
  template: reportTemplateSchema,
  cadence: reportCadenceSchema,
  recipients: z.array(z.string().email()).min(1).max(20),
  enabled: z.boolean().optional().default(true),
});

router.get("/admin/scheduled-reports", isAuthenticated, requirePerm("admin:read"), async (_req, res) => {
  const rows = await db.select().from(scheduledReports).orderBy(desc(scheduledReports.createdAt));
  res.json(rows);
});

router.post("/admin/scheduled-reports", isAuthenticated, requirePerm("admin:manage"), async (req: any, res) => {
  try {
    const parsed = createReportSchema.parse(req.body);
    const userId = req.user?.claims?.sub ?? req.user?.id ?? null;
    const [row] = await db.insert(scheduledReports).values({
      ...parsed,
      createdBy: userId ? String(userId) : null,
      // Schedule first run within 5 minutes so users see results promptly.
      nextRunAt: new Date(Date.now() + 5 * 60 * 1000),
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid report payload", issues: err.issues });
    }
    console.error("[compliance] create report failed", err);
    res.status(500).json({ message: "Failed to create scheduled report" });
  }
});

router.delete("/admin/scheduled-reports/:id", isAuthenticated, requirePerm("admin:manage"), async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
  res.json({ ok: true });
});

router.post("/admin/scheduled-reports/:id/run-now", isAuthenticated, requirePerm("admin:manage"), async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(scheduledReports).where(eq(scheduledReports.id, id)).limit(1);
  if (!row) return res.status(404).json({ message: "Report not found" });
  const result = await runScheduledReport(row);
  res.json(result);
});

router.get("/admin/scheduled-reports/:id/runs", isAuthenticated, requirePerm("admin:read"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(scheduledReportRuns)
    .where(eq(scheduledReportRuns.reportId, id))
    .orderBy(desc(scheduledReportRuns.ranAt))
    .limit(50);
  res.json(rows);
});

router.get("/admin/report-templates/:template/preview", isAuthenticated, requirePerm("admin:read"), async (req, res) => {
  const t = req.params.template as ReportTemplate;
  if (!["sla_summary", "underwriting_pipeline", "commission_payouts"].includes(t)) {
    return res.status(400).json({ message: "Unknown template" });
  }
  const built = await buildReport(t);
  res.json(built);
});

// ─── Schema drift alerts ─────────────────────────────────────────────────────

router.get("/admin/schema-drift-alerts", isAuthenticated, requirePerm("system:superadmin"), async (_req, res) => {
  const rows = await db.select().from(schemaDriftAlerts).orderBy(desc(schemaDriftAlerts.detectedAt)).limit(100);
  res.json(rows);
});

router.post("/admin/schema-drift-alerts/:id/acknowledge", isAuthenticated, requirePerm("system:superadmin"), async (req: any, res) => {
  const id = Number(req.params.id);
  const userId = req.user?.claims?.sub ?? req.user?.id ?? "unknown";
  const result = await db.update(schemaDriftAlerts).set({
    acknowledged: true,
    acknowledgedBy: String(userId),
    acknowledgedAt: new Date(),
  }).where(eq(schemaDriftAlerts.id, id)).returning();
  if (result.length === 0) return res.status(404).json({ message: "Alert not found" });
  res.json(result[0]);
});

router.post("/admin/schema-drift/scan", isAuthenticated, requirePerm("system:superadmin"), async (_req, res) => {
  const result = await detectSchemaDrift();
  res.json(result);
});

// ─── Archived applications ───────────────────────────────────────────────────

router.get("/admin/archived-applications", isAuthenticated, requirePerm("admin:read"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const rows = await db.select().from(archivedApplications)
    .orderBy(desc(archivedApplications.archivedAt))
    .limit(limit);
  res.json(rows);
});

router.post("/admin/archived-applications/run-now", isAuthenticated, requirePerm("system:superadmin"), async (_req, res) => {
  const result = await archiveExpiredApplications();
  res.json(result);
});

router.get("/admin/archived-applications/stats", isAuthenticated, requirePerm("admin:read"), async (_req, res) => {
  const [{ value }] = await db.select({ value: count() }).from(archivedApplications);
  res.json({ total: value });
});

export default router;
