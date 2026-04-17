import type { Express } from "express";
import { eq, and, desc, sql as sqlTag, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  prospectApplications, merchantProspects, agents, acquirers,
  underwritingRuns, underwritingPhaseResults, underwritingIssues,
  underwritingTasks, underwritingNotes, underwritingStatusHistory,
  insertUnderwritingTaskSchema, insertUnderwritingNoteSchema,
} from "@shared/schema";
import {
  APP_STATUS, APP_SUB_STATUS, canTransition, type AppStatus,
} from "@shared/underwriting";
import { ACTIONS } from "@shared/permissions";
import { dbEnvironmentMiddleware, getRequestDB, type RequestWithDB } from "../dbMiddleware";
import { isAuthenticated, requirePerm } from "../replitAuth";
import { auditService } from "../auditService";
import { runUnderwritingPipeline } from "./orchestrator";
import { notifyRunCompleted, notifyTransition } from "./notifications";

function userId(req: RequestWithDB): string | null {
  return (req.session as any)?.userId || (req as any).user?.claims?.sub || null;
}

async function audit(req: RequestWithDB, action: string, resource: string, resourceId: string, options: any = {}) {
  await auditService.logAction(action, resource, {
    userId: userId(req) || undefined,
    sessionId: req.sessionID,
    ipAddress: req.ip,
    method: req.method,
    endpoint: req.path,
    statusCode: 200,
    environment: req.dbEnv,
  }, { resourceId, ...options });
}

export function registerUnderwritingRoutes(app: Express) {
  // ── Run pipeline ──
  app.post("/api/applications/:id/underwriting/run",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        if (Number.isNaN(applicationId)) return res.status(400).json({ message: "Invalid application id" });
        const db = getRequestDB(req);

        const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!app) return res.status(404).json({ message: "Application not found" });
        if (app.status === APP_STATUS.DRAFT) return res.status(400).json({ message: "Cannot run underwriting on draft application" });

        const result = await runUnderwritingPipeline({ db, applicationId, startedBy: userId(req) });

        // Auto-advance submitted → in_review on first successful run.
        if (app.status === APP_STATUS.SUBMITTED) {
          await db.update(prospectApplications).set({
            status: APP_STATUS.IN_REVIEW, subStatus: APP_SUB_STATUS.SCORING, updatedAt: new Date(),
          }).where(eq(prospectApplications.id, applicationId));
          await db.insert(underwritingStatusHistory).values({
            applicationId, fromStatus: APP_STATUS.SUBMITTED, toStatus: APP_STATUS.IN_REVIEW,
            toSubStatus: APP_SUB_STATUS.SCORING, changedBy: userId(req), reason: "Auto-advanced after underwriting run",
          });
        }

        await notifyRunCompleted(db, applicationId, result.score, result.tier);
        await audit(req, "create", "underwriting_run", String(result.runId), {
          riskLevel: "high",
          notes: `Underwriting run for app ${applicationId} → score ${result.score} (${result.tier})`,
        });

        res.json(result);
      } catch (err: any) {
        console.error("underwriting/run failed:", err);
        res.status(500).json({ message: err?.message || "Run failed" });
      }
    });

  // ── Get latest run + phases ──
  app.get("/api/applications/:id/underwriting",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const db = getRequestDB(req);
        const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!app) return res.status(404).json({ message: "Application not found" });
        const runs = await db.select().from(underwritingRuns).where(eq(underwritingRuns.applicationId, applicationId)).orderBy(desc(underwritingRuns.startedAt));
        const latest = runs[0] || null;
        const phases = latest
          ? await db.select().from(underwritingPhaseResults).where(eq(underwritingPhaseResults.runId, latest.id)).orderBy(underwritingPhaseResults.phaseOrder)
          : [];
        const issues = await db.select().from(underwritingIssues).where(eq(underwritingIssues.applicationId, applicationId)).orderBy(desc(underwritingIssues.createdAt));
        res.json({ application: app, latestRun: latest, runs, phases, issues });
      } catch (err: any) {
        console.error("underwriting GET failed:", err);
        res.status(500).json({ message: err?.message || "Failed" });
      }
    });

  // ── Status transition ──
  const transitionSchema = z.object({
    toStatus: z.enum([
      APP_STATUS.SUBMITTED, APP_STATUS.IN_REVIEW, APP_STATUS.PENDING_INFO,
      APP_STATUS.APPROVED, APP_STATUS.DECLINED, APP_STATUS.WITHDRAWN,
    ]),
    toSubStatus: z.string().optional(),
    reason: z.string().min(1).max(2000),
    rejectionReason: z.string().optional(),
  });

  app.post("/api/applications/:id/underwriting/transition",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const parsed = transitionSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
        const { toStatus, toSubStatus, reason, rejectionReason } = parsed.data;

        const db = getRequestDB(req);
        const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!app) return res.status(404).json({ message: "Application not found" });

        if (!canTransition(app.status, toStatus as AppStatus)) {
          return res.status(409).json({ message: `Illegal transition: ${app.status} → ${toStatus}` });
        }

        // Approve/decline require elevated permission.
        if (toStatus === APP_STATUS.APPROVED || toStatus === APP_STATUS.DECLINED) {
          const required = toStatus === APP_STATUS.APPROVED ? ACTIONS.UNDERWRITING_APPROVE : ACTIONS.UNDERWRITING_DECLINE;
          // Re-check by hand since requirePerm middleware already gated UNDERWRITING_REVIEW.
          const { hasPermission } = await import("@shared/permissions");
          if (!hasPermission(req.currentUser as any, required)) {
            return res.status(403).json({ message: `Missing permission: ${required}` });
          }
        }

        const updates: any = { status: toStatus, subStatus: toSubStatus ?? null, updatedAt: new Date() };
        if (toStatus === APP_STATUS.APPROVED) updates.approvedAt = new Date();
        if (toStatus === APP_STATUS.DECLINED) {
          updates.rejectedAt = new Date();
          updates.rejectionReason = rejectionReason || reason;
        }

        await db.update(prospectApplications).set(updates).where(eq(prospectApplications.id, applicationId));
        await db.insert(underwritingStatusHistory).values({
          applicationId,
          fromStatus: app.status, toStatus,
          fromSubStatus: app.subStatus, toSubStatus: toSubStatus ?? null,
          changedBy: userId(req), reason,
        });

        await notifyTransition(db, applicationId, toStatus);
        await audit(req, "update", "application_status", String(applicationId), {
          riskLevel: toStatus === APP_STATUS.APPROVED || toStatus === APP_STATUS.DECLINED ? "high" : "medium",
          oldValues: { status: app.status, subStatus: app.subStatus },
          newValues: { status: toStatus, subStatus: toSubStatus },
          notes: reason,
        });

        res.json({ ok: true, application: { ...app, ...updates } });
      } catch (err: any) {
        console.error("transition failed:", err);
        res.status(500).json({ message: err?.message || "Failed" });
      }
    });

  // ── Assign reviewer ──
  app.post("/api/applications/:id/underwriting/assign",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const reviewerId = String(req.body?.reviewerId || "").trim();
        if (!reviewerId) return res.status(400).json({ message: "reviewerId required" });
        const db = getRequestDB(req);
        const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!app) return res.status(404).json({ message: "Application not found" });
        await db.update(prospectApplications).set({ assignedReviewerId: reviewerId, updatedAt: new Date() }).where(eq(prospectApplications.id, applicationId));
        await audit(req, "update", "application_reviewer", String(applicationId), {
          oldValues: { assignedReviewerId: app.assignedReviewerId }, newValues: { assignedReviewerId: reviewerId },
        });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ message: err?.message || "Failed" });
      }
    });

  // ── Issues CRUD ──
  app.patch("/api/underwriting/issues/:id",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const status = String(req.body?.status || "");
        if (!["open", "acknowledged", "resolved", "waived"].includes(status)) return res.status(400).json({ message: "Invalid status" });
        const db = getRequestDB(req);
        const updates: any = { status };
        if (status === "resolved" || status === "waived") {
          updates.resolvedBy = userId(req);
          updates.resolvedAt = new Date();
          updates.resolutionNote = req.body?.note ?? null;
        }
        const [updated] = await db.update(underwritingIssues).set(updates).where(eq(underwritingIssues.id, id)).returning();
        if (!updated) return res.status(404).json({ message: "Issue not found" });
        await audit(req, "update", "underwriting_issue", String(id), { newValues: updates });
        res.json(updated);
      } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
    });

  // ── Tasks ──
  app.get("/api/applications/:id/underwriting/tasks",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const db = getRequestDB(req);
      const tasks = await db.select().from(underwritingTasks)
        .where(eq(underwritingTasks.applicationId, parseInt(req.params.id)))
        .orderBy(desc(underwritingTasks.createdAt));
      res.json(tasks);
    });

  app.post("/api/applications/:id/underwriting/tasks",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const parsed = insertUnderwritingTaskSchema.safeParse({ ...req.body, applicationId, createdBy: userId(req) });
        if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
        const db = getRequestDB(req);
        const [t] = await db.insert(underwritingTasks).values(parsed.data).returning();
        await audit(req, "create", "underwriting_task", String(t.id), { newValues: t });
        res.json(t);
      } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
    });

  app.patch("/api/underwriting/tasks/:id",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const allowed = ["status", "assignedToUserId", "assignedRole", "title", "description", "dueAt"] as const;
        const updates: any = {};
        for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
        if (updates.status === "done") updates.completedAt = new Date();
        const db = getRequestDB(req);
        const [t] = await db.update(underwritingTasks).set(updates).where(eq(underwritingTasks.id, id)).returning();
        if (!t) return res.status(404).json({ message: "Task not found" });
        res.json(t);
      } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
    });

  // ── Notes ──
  app.get("/api/applications/:id/underwriting/notes",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const db = getRequestDB(req);
      const notes = await db.select().from(underwritingNotes)
        .where(eq(underwritingNotes.applicationId, parseInt(req.params.id)))
        .orderBy(desc(underwritingNotes.createdAt));
      res.json(notes);
    });

  app.post("/api/applications/:id/underwriting/notes",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const parsed = insertUnderwritingNoteSchema.safeParse({ ...req.body, applicationId, authorUserId: userId(req) });
        if (!parsed.success) return res.status(400).json({ message: "Invalid note", errors: parsed.error.flatten() });
        const db = getRequestDB(req);
        const [n] = await db.insert(underwritingNotes).values(parsed.data).returning();
        res.json(n);
      } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
    });

  // ── Status history ──
  app.get("/api/applications/:id/underwriting/history",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const db = getRequestDB(req);
      const rows = await db.select().from(underwritingStatusHistory)
        .where(eq(underwritingStatusHistory.applicationId, parseInt(req.params.id)))
        .orderBy(desc(underwritingStatusHistory.createdAt));
      res.json(rows);
    });

  // ── Queue ──
  app.get("/api/underwriting/queue",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      try {
        const db = getRequestDB(req);
        const status = String(req.query.status || "");
        const tier = String(req.query.tier || "");
        const assignee = String(req.query.assignee || "");
        const validStatuses: string[] = [
          APP_STATUS.SUBMITTED, APP_STATUS.IN_REVIEW, APP_STATUS.PENDING_INFO,
          APP_STATUS.APPROVED, APP_STATUS.DECLINED,
        ];
        const conds: any[] = [];
        if (status && validStatuses.includes(status)) conds.push(eq(prospectApplications.status, status));
        else conds.push(inArray(prospectApplications.status, [APP_STATUS.SUBMITTED, APP_STATUS.IN_REVIEW, APP_STATUS.PENDING_INFO]));
        if (tier && ["low", "medium", "high"].includes(tier)) conds.push(eq(prospectApplications.riskTier, tier));
        if (assignee === "me") {
          const uid = userId(req);
          if (uid) conds.push(eq(prospectApplications.assignedReviewerId, uid));
        } else if (assignee === "unassigned") {
          conds.push(sqlTag`${prospectApplications.assignedReviewerId} IS NULL`);
        }

        const rows = await db.select({
          id: prospectApplications.id,
          prospectId: prospectApplications.prospectId,
          status: prospectApplications.status,
          subStatus: prospectApplications.subStatus,
          underwritingType: prospectApplications.underwritingType,
          riskScore: prospectApplications.riskScore,
          riskTier: prospectApplications.riskTier,
          assignedReviewerId: prospectApplications.assignedReviewerId,
          submittedAt: prospectApplications.submittedAt,
          updatedAt: prospectApplications.updatedAt,
          firstName: merchantProspects.firstName,
          lastName: merchantProspects.lastName,
          email: merchantProspects.email,
          companyName: sqlTag<string>`${prospectApplications.applicationData}->>'companyName'`,
          acquirerName: acquirers.name,
        })
          .from(prospectApplications)
          .leftJoin(merchantProspects, eq(merchantProspects.id, prospectApplications.prospectId))
          .leftJoin(acquirers, eq(acquirers.id, prospectApplications.acquirerId))
          .where(conds.length ? and(...conds) : undefined as any)
          .orderBy(desc(prospectApplications.updatedAt))
          .limit(500);

        res.json(rows);
      } catch (err: any) {
        console.error("queue failed:", err);
        res.status(500).json({ message: err?.message || "Failed" });
      }
    });
}
