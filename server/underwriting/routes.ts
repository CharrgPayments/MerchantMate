import type { Express } from "express";
import { eq, and, desc, sql as sqlTag, inArray, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  prospectApplications, merchantProspects, acquirers,
  underwritingRuns, underwritingPhaseResults, underwritingIssues,
  underwritingTasks, underwritingNotes, underwritingStatusHistory,
  underwritingFiles,
  insertUnderwritingTaskSchema, insertUnderwritingNoteSchema,
} from "@shared/schema";
import {
  APP_STATUS, allowedTransitions, findTransition, type AppStatus,
  type TransitionRule, PATHWAYS, PHASES,
} from "@shared/underwriting";
import { ACTIONS } from "@shared/permissions";
import { hasPermission, getActionScope } from "@shared/permissions";
import { getOverrides } from "../permissionRegistry";
import { dbEnvironmentMiddleware, getRequestDB, type RequestWithDB } from "../dbMiddleware";
import { isAuthenticated, requirePerm } from "../replitAuth";
import { auditService } from "../auditService";
import { runUnderwritingPipeline, runManualPhase } from "./orchestrator";
import { notifyRunCompleted, notifyTransition } from "./notifications";

function userId(req: RequestWithDB): string | null {
  const sess = req.session as { userId?: string } | undefined;
  const claims = (req.user as { claims?: { sub?: string } } | undefined)?.claims;
  return sess?.userId || claims?.sub || null;
}

// Scope-aware ownership check: when the caller's permScope is 'own' they may
// view/act on (a) applications they are the assigned reviewer for, OR
// (b) unassigned applications in their queue (so they can pick up new work).
// 'all' (or SUPER_ADMIN's implicit 'all') passes through. Returns true on allow.
async function enforceAppScope(req: RequestWithDB, applicationId: number): Promise<boolean> {
  const scope = req.permScope;
  if (!scope || scope === "all") return true;
  const db = getRequestDB(req);
  const [row] = await db.select({ assignedReviewerId: prospectApplications.assignedReviewerId })
    .from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
  if (!row) return false;
  if (row.assignedReviewerId === null) return true;
  const uid = userId(req);
  return !!uid && row.assignedReviewerId === uid;
}

// Allowed sub-statuses (typed). Free-text sub-statuses are no longer
// accepted; transitions must use one of these codes.
const SUB_STATUS_VALUES = [
  "awaiting_docs", "awaiting_owner_signature", "awaiting_bank_info",
  "awaiting_processing_statement", "awaiting_credit_review",
  "awaiting_match_review", "awaiting_ofac_review", "awaiting_senior_review",
  "awaiting_data_processing", "awaiting_deployment", "withdrawn_by_merchant",
  "withdrawn_by_agent", "withdrawn_by_underwriter",
] as const;
type SubStatus = (typeof SUB_STATUS_VALUES)[number];
const subStatusSchema = z.object({
  toSubStatus: z.enum(SUB_STATUS_VALUES),
  reason: z.string().min(1, "Reason is required for sub-status changes"),
});

interface AuditOptions {
  riskLevel?: "low" | "medium" | "high";
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  notes?: string;
}

async function audit(
  req: RequestWithDB, action: string, resource: string, resourceId: string,
  options: AuditOptions = {},
) {
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

        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        if (appRow.status === APP_STATUS.DRAFT) return res.status(400).json({ message: "Cannot run underwriting on draft application" });

        const result = await runUnderwritingPipeline({ db, applicationId, startedBy: userId(req) });

        // Auto-advance SUB → CUW on first run.
        if (appRow.status === APP_STATUS.SUB) {
          await db.update(prospectApplications).set({ status: APP_STATUS.CUW, updatedAt: new Date() }).where(eq(prospectApplications.id, applicationId));
          await db.insert(underwritingStatusHistory).values({
            applicationId, fromStatus: APP_STATUS.SUB, toStatus: APP_STATUS.CUW,
            changedBy: userId(req), reason: "Auto-advanced after underwriting run",
          });
        }

        await notifyRunCompleted(db, applicationId, result.score ?? 0, result.tier);
        await audit(req, "create", "underwriting_run", String(result.runId), {
          riskLevel: result.haltedAtPhase ? "high" : "medium",
          notes: result.haltedAtPhase
            ? `Pipeline halted at ${result.haltedAtPhase} (recommend ${result.recommendedDecline})`
            : `Score ${result.score ?? "n/a"} (${result.tier})`,
        });

        res.json(result);
      } catch (err) {
        console.error("underwriting/run failed:", err);
        res.status(500).json({ message: err instanceof Error ? err.message : "Run failed" });
      }
    });

  // ── Manual phase (Derogatory / G2) ──
  const manualPhaseSchema = z.object({
    phaseKey: z.enum(["derogatory_check", "g2_check"]),
  });
  app.post("/api/applications/:id/underwriting/manual-phase",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const parsed = manualPhaseSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
        const db = getRequestDB(req);
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        if (appRow.pathway !== PATHWAYS.TRADITIONAL) {
          return res.status(400).json({ message: "Manual checks only available on Traditional pathway" });
        }
        const result = await runManualPhase({ db, applicationId, phaseKey: parsed.data.phaseKey, startedBy: userId(req) });
        await audit(req, "create", "underwriting_manual_phase", String(result.runId), {
          notes: `Manual ${parsed.data.phaseKey} → ${result.result.status}`,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Get latest run + phases + issues ──
  app.get("/api/applications/:id/underwriting",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const db = getRequestDB(req);
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        const runs = await db.select().from(underwritingRuns).where(eq(underwritingRuns.applicationId, applicationId)).orderBy(desc(underwritingRuns.startedAt));
        const latest = runs[0] || null;
        const phases = latest
          ? await db.select().from(underwritingPhaseResults).where(eq(underwritingPhaseResults.runId, latest.id)).orderBy(asc(underwritingPhaseResults.phaseOrder))
          : [];
        // include all phase results across runs so manual-phase rows from later runs are visible
        const allPhases = await db.select().from(underwritingPhaseResults)
          .innerJoin(underwritingRuns, eq(underwritingPhaseResults.runId, underwritingRuns.id))
          .where(eq(underwritingRuns.applicationId, applicationId))
          .orderBy(asc(underwritingPhaseResults.phaseOrder));
        const issues = await db.select().from(underwritingIssues).where(eq(underwritingIssues.applicationId, applicationId)).orderBy(desc(underwritingIssues.createdAt));
        // also enumerate allowed transitions for the current actor so the UI can gate buttons.
        const transitions = allowedTransitions(appRow.status as AppStatus).filter((t: TransitionRule) =>
          hasPermission(req.currentUser as Parameters<typeof hasPermission>[0], t.requires));
        res.json({ application: appRow, latestRun: latest, runs, phases, allPhases, issues, transitions });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Status transition (matrix-driven) ──
  const transitionSchema = z.object({
    toStatus: z.string(),
    toSubStatus: z.enum(SUB_STATUS_VALUES).optional().nullable(),
    reason: z.string().max(2000).optional(),
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
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });

        const rule = findTransition(appRow.status as AppStatus, toStatus as AppStatus);
        if (!rule) return res.status(409).json({ message: `Illegal transition: ${appRow.status} → ${toStatus}` });

        // Override-aware permission check (parity with requirePerm).
        const overrides = await getOverrides(req.dbEnv ?? 'production', db);
        const scope = getActionScope(
          req.currentUser as Parameters<typeof getActionScope>[0],
          rule.requires,
          overrides,
        );
        if (!scope) {
          return res.status(403).json({ message: `Missing permission: ${rule.requires}` });
        }
        if (rule.requireReason && !reason?.trim()) {
          return res.status(400).json({ message: "Reason is required for this transition" });
        }

        const nextSubStatus: SubStatus | null = toSubStatus ?? null;
        const updates: Record<string, unknown> = { status: toStatus, subStatus: nextSubStatus, updatedAt: new Date() };
        if (toStatus === APP_STATUS.APPROVED) updates.approvedAt = new Date();
        const declineCodes: AppStatus[] = [APP_STATUS.D1, APP_STATUS.D2, APP_STATUS.D3, APP_STATUS.D4];
        if (declineCodes.includes(toStatus as AppStatus)) {
          updates.rejectedAt = new Date();
          updates.rejectionReason = rejectionReason || reason;
        }

        await db.update(prospectApplications).set(updates).where(eq(prospectApplications.id, applicationId));
        await db.insert(underwritingStatusHistory).values({
          applicationId,
          fromStatus: appRow.status, toStatus,
          fromSubStatus: appRow.subStatus, toSubStatus: nextSubStatus,
          changedBy: userId(req), reason: reason || rule.description,
        });

        await notifyTransition(db, applicationId, toStatus, { fromStatus: appRow.status, reason: reason || rule.description });
        await audit(req, "update", "application_status", String(applicationId), {
          riskLevel: toStatus === APP_STATUS.APPROVED || toStatus.startsWith("D") ? "high" : "medium",
          oldValues: { status: appRow.status },
          newValues: { status: toStatus },
          notes: reason || rule.description,
        });

        res.json({ ok: true, status: toStatus });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Assign reviewer ──
  app.post("/api/applications/:id/underwriting/assign",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        let reviewerId = String((req.body as { reviewerId?: unknown })?.reviewerId || "").trim();
        if (reviewerId === "me") reviewerId = userId(req) || "";
        if (!reviewerId) return res.status(400).json({ message: "reviewerId required" });
        const db = getRequestDB(req);
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        await db.update(prospectApplications).set({ assignedReviewerId: reviewerId, updatedAt: new Date() }).where(eq(prospectApplications.id, applicationId));
        await audit(req, "update", "application_reviewer", String(applicationId), {
          oldValues: { assignedReviewerId: appRow.assignedReviewerId }, newValues: { assignedReviewerId: reviewerId },
        });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Set pathway (traditional / payfac) ──
  app.post("/api/applications/:id/underwriting/pathway",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const pathway = String((req.body as { pathway?: unknown })?.pathway || "");
        if (pathway !== PATHWAYS.TRADITIONAL && pathway !== PATHWAYS.PAYFAC) {
          return res.status(400).json({ message: "Invalid pathway" });
        }
        const db = getRequestDB(req);
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        await db.update(prospectApplications).set({ pathway, updatedAt: new Date() }).where(eq(prospectApplications.id, applicationId));
        await audit(req, "update", "application_pathway", String(applicationId), {
          oldValues: { pathway: appRow.pathway }, newValues: { pathway },
        });
        res.json({ ok: true, pathway });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Issues ──
  app.patch("/api/underwriting/issues/:id",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const status = String((req.body as { status?: unknown })?.status || "");
        const note = (req.body as { note?: string })?.note;
        if (!["open", "acknowledged", "resolved", "waived"].includes(status)) return res.status(400).json({ message: "Invalid status" });
        const db = getRequestDB(req);
        const [issueRow] = await db.select().from(underwritingIssues).where(eq(underwritingIssues.id, id)).limit(1);
        if (!issueRow) return res.status(404).json({ message: "Issue not found" });
        if (!(await enforceAppScope(req, issueRow.applicationId))) return res.status(403).json({ message: "Out of scope" });
        const updates: Record<string, unknown> = { status };
        if (status === "resolved" || status === "waived") {
          updates.resolvedBy = userId(req);
          updates.resolvedAt = new Date();
          updates.resolutionNote = note ?? null;
        }
        const [updated] = await db.update(underwritingIssues).set(updates).where(eq(underwritingIssues.id, id)).returning();
        if (!updated) return res.status(404).json({ message: "Issue not found" });
        await audit(req, "update", "underwriting_issue", String(id), { newValues: updates });
        res.json(updated);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Failed" }); }
    });

  // ── Tasks ──
  app.get("/api/applications/:id/underwriting/tasks",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const applicationId = parseInt(req.params.id);
      if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
      const db = getRequestDB(req);
      const tasks = await db.select().from(underwritingTasks)
        .where(eq(underwritingTasks.applicationId, applicationId))
        .orderBy(desc(underwritingTasks.createdAt));
      res.json(tasks);
    });

  app.post("/api/applications/:id/underwriting/tasks",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        const body = (req.body || {}) as Record<string, unknown>;
        const parsed = insertUnderwritingTaskSchema.safeParse({ ...body, applicationId, createdBy: userId(req) });
        if (!parsed.success) return res.status(400).json({ message: "Invalid task", errors: parsed.error.flatten() });
        const db = getRequestDB(req);
        const [t] = await db.insert(underwritingTasks).values(parsed.data).returning();
        await audit(req, "create", "underwriting_task", String(t.id), { newValues: t as unknown as Record<string, unknown> });
        res.json(t);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Failed" }); }
    });

  app.patch("/api/underwriting/tasks/:id",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const allowed = ["status", "assignedToUserId", "assignedRole", "title", "description", "dueAt"] as const;
        const body = (req.body || {}) as Record<string, unknown>;
        const updates: Record<string, unknown> = {};
        for (const k of allowed) if (k in body) updates[k] = body[k];
        if (updates.status === "done") updates.completedAt = new Date();
        const db = getRequestDB(req);
        const [existing] = await db.select().from(underwritingTasks).where(eq(underwritingTasks.id, id)).limit(1);
        if (!existing) return res.status(404).json({ message: "Task not found" });
        if (!(await enforceAppScope(req, existing.applicationId))) return res.status(403).json({ message: "Out of scope" });
        const [t] = await db.update(underwritingTasks).set(updates).where(eq(underwritingTasks.id, id)).returning();
        if (!t) return res.status(404).json({ message: "Task not found" });
        await audit(req, "update", "underwriting_task", String(id), { newValues: updates });
        res.json(t);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Failed" }); }
    });

  // ── Notes ──
  app.get("/api/applications/:id/underwriting/notes",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const applicationId = parseInt(req.params.id);
      if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
      const db = getRequestDB(req);
      const notes = await db.select().from(underwritingNotes)
        .where(eq(underwritingNotes.applicationId, applicationId))
        .orderBy(desc(underwritingNotes.createdAt));
      res.json(notes);
    });

  app.post("/api/applications/:id/underwriting/notes",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        const body = (req.body || {}) as Record<string, unknown>;
        const parsed = insertUnderwritingNoteSchema.safeParse({ ...body, applicationId, authorUserId: userId(req) });
        if (!parsed.success) return res.status(400).json({ message: "Invalid note", errors: parsed.error.flatten() });
        const db = getRequestDB(req);
        const [n] = await db.insert(underwritingNotes).values(parsed.data).returning();
        await audit(req, "create", "underwriting_note", String(n.id), { newValues: n as unknown as Record<string, unknown> });
        res.json(n);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Failed" }); }
    });

  // ── Status history ──
  app.get("/api/applications/:id/underwriting/history",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const applicationId = parseInt(req.params.id);
      if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
      const db = getRequestDB(req);
      const rows = await db.select().from(underwritingStatusHistory)
        .where(eq(underwritingStatusHistory.applicationId, applicationId))
        .orderBy(desc(underwritingStatusHistory.createdAt));
      res.json(rows);
    });

  // ── Sub-status PATCH ── reason is mandatory (audit trail requirement).
  const subStatusPatchSchema = z.object({
    subStatus: z.enum(SUB_STATUS_VALUES).nullable(),
    reason: z.string().trim().min(1, "Reason is required for sub-status changes").max(2000),
  });
  app.patch("/api/applications/:id/underwriting/sub-status",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        const parsed = subStatusPatchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
        const { subStatus, reason } = parsed.data;
        const db = getRequestDB(req);
        const [appRow] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
        if (!appRow) return res.status(404).json({ message: "Application not found" });
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        await db.update(prospectApplications)
          .set({ subStatus, updatedAt: new Date() })
          .where(eq(prospectApplications.id, applicationId));
        await db.insert(underwritingStatusHistory).values({
          applicationId,
          fromStatus: appRow.status, toStatus: appRow.status,
          fromSubStatus: appRow.subStatus, toSubStatus: subStatus,
          changedBy: userId(req), reason: reason || "Sub-status change",
        });
        await audit(req, "update", "application_sub_status", String(applicationId), {
          oldValues: { subStatus: appRow.subStatus }, newValues: { subStatus },
          notes: reason,
        });
        res.json({ ok: true, subStatus });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Queue ──
  // Filters:
  //   status=<code>   exact status (SUB|CUW|P1..D4|APPROVED) OR family (submitted|in_review|pending|withdrawn|declined|approved)
  //   tier=low|medium|high
  //   pathway=traditional|payfac
  //   mode=checkpoint|final  (payfac queue mode)
  //   assignee=me|unassigned
  app.get("/api/underwriting/queue",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      try {
        const db = getRequestDB(req);
        const status = String(req.query.status || "");
        const tier = String(req.query.tier || "");
        const pathway = String(req.query.pathway || "");
        const mode = String(req.query.mode || "");
        const assignee = String(req.query.assignee || "");

        const conds: ReturnType<typeof eq>[] = [];
        const familyMap: Record<string, string[]> = {
          submitted: [APP_STATUS.SUB],
          in_review: [APP_STATUS.CUW],
          pending: [APP_STATUS.P1, APP_STATUS.P2, APP_STATUS.P3],
          withdrawn: [APP_STATUS.W1, APP_STATUS.W2, APP_STATUS.W3],
          declined: [APP_STATUS.D1, APP_STATUS.D2, APP_STATUS.D3, APP_STATUS.D4],
          approved: [APP_STATUS.APPROVED],
        };
        if (status && familyMap[status]) conds.push(inArray(prospectApplications.status, familyMap[status]) as ReturnType<typeof eq>);
        else if (status) conds.push(eq(prospectApplications.status, status));
        else conds.push(inArray(prospectApplications.status, [APP_STATUS.SUB, APP_STATUS.CUW, APP_STATUS.P1, APP_STATUS.P2, APP_STATUS.P3]) as ReturnType<typeof eq>);

        if (tier && ["low", "medium", "high"].includes(tier)) conds.push(eq(prospectApplications.riskTier, tier));
        if (pathway === PATHWAYS.TRADITIONAL || pathway === PATHWAYS.PAYFAC) conds.push(eq(prospectApplications.pathway, pathway));

        // mode=checkpoint = pipeline halted at a checkpoint and not yet decided
        // mode=final      = clean-pipeline payfac apps awaiting final review (slaDeadline set, status CUW)
        if (mode === "checkpoint") {
          conds.push(sqlTag`${prospectApplications.pipelineHaltedAtPhase} IS NOT NULL` as ReturnType<typeof eq>);
        } else if (mode === "final") {
          conds.push(sqlTag`${prospectApplications.slaDeadline} IS NOT NULL` as ReturnType<typeof eq>);
          conds.push(eq(prospectApplications.pathway, PATHWAYS.PAYFAC));
        }

        if (assignee === "me") {
          const uid = userId(req);
          if (uid) conds.push(eq(prospectApplications.assignedReviewerId, uid));
        } else if (assignee === "unassigned") {
          conds.push(isNull(prospectApplications.assignedReviewerId) as ReturnType<typeof eq>);
        }

        // Scope-aware: 'own' permission scope sees their own assignments PLUS
        // unassigned items (so they can pick up new work).
        if (req.permScope === 'own') {
          const uid = userId(req);
          if (uid) {
            conds.push(sqlTag`(${prospectApplications.assignedReviewerId} = ${uid} OR ${prospectApplications.assignedReviewerId} IS NULL)` as ReturnType<typeof eq>);
          } else {
            conds.push(isNull(prospectApplications.assignedReviewerId) as ReturnType<typeof eq>);
          }
        }

        const rows = await db.select({
          id: prospectApplications.id,
          prospectId: prospectApplications.prospectId,
          status: prospectApplications.status,
          subStatus: prospectApplications.subStatus,
          underwritingType: prospectApplications.underwritingType,
          pathway: prospectApplications.pathway,
          slaDeadline: prospectApplications.slaDeadline,
          pipelineHaltedAtPhase: prospectApplications.pipelineHaltedAtPhase,
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
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(prospectApplications.updatedAt))
          .limit(500);

        res.json(rows);
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : "Failed" });
      }
    });

  // ── Files (upload / list / download) ──
  const filesDir = path.resolve(process.cwd(), "uploads", "underwriting");
  fs.mkdirSync(filesDir, { recursive: true });
  const fileStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, filesDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
    },
  });
  const upload = multer({ storage: fileStorage, limits: { fileSize: 25 * 1024 * 1024 } });

  app.get("/api/applications/:id/underwriting/files",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      const applicationId = parseInt(req.params.id);
      if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
      const db = getRequestDB(req);
      const rows = await db.select().from(underwritingFiles)
        .where(eq(underwritingFiles.applicationId, applicationId))
        .orderBy(desc(underwritingFiles.uploadedAt));
      res.json(rows);
    });

  app.post("/api/applications/:id/underwriting/files",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    upload.single("file"),
    async (req: RequestWithDB, res) => {
      try {
        const applicationId = parseInt(req.params.id);
        if (!(await enforceAppScope(req, applicationId))) return res.status(403).json({ message: "Out of scope" });
        const file = (req as unknown as { file?: Express.Multer.File }).file;
        if (!file) return res.status(400).json({ message: "file required" });
        const db = getRequestDB(req);
        const body = (req.body || {}) as Record<string, string>;
        const [row] = await db.insert(underwritingFiles).values({
          applicationId,
          fileName: file.originalname,
          storedPath: path.relative(process.cwd(), file.path),
          contentType: file.mimetype,
          size: file.size,
          category: body.category || null,
          description: body.description || null,
          uploadedBy: userId(req),
        }).returning();
        await audit(req, "create", "underwriting_file", String(row.id), {
          newValues: { applicationId, fileName: row.fileName, size: row.size, category: row.category },
        });
        res.json(row);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Upload failed" }); }
    });

  app.get("/api/underwriting/files/:id/download",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const db = getRequestDB(req);
        const [row] = await db.select().from(underwritingFiles).where(eq(underwritingFiles.id, id)).limit(1);
        if (!row) return res.status(404).json({ message: "File not found" });
        if (!(await enforceAppScope(req, row.applicationId))) return res.status(403).json({ message: "Out of scope" });
        const abs = path.resolve(process.cwd(), row.storedPath);
        if (!fs.existsSync(abs)) return res.status(404).json({ message: "File missing on disk" });
        res.download(abs, row.fileName);
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Download failed" }); }
    });

  app.delete("/api/underwriting/files/:id",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_REVIEW),
    async (req: RequestWithDB, res) => {
      try {
        const id = parseInt(req.params.id);
        const db = getRequestDB(req);
        const [row] = await db.select().from(underwritingFiles).where(eq(underwritingFiles.id, id)).limit(1);
        if (!row) return res.status(404).json({ message: "File not found" });
        if (!(await enforceAppScope(req, row.applicationId))) return res.status(403).json({ message: "Out of scope" });
        const abs = path.resolve(process.cwd(), row.storedPath);
        try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
        await db.delete(underwritingFiles).where(eq(underwritingFiles.id, id));
        await audit(req, "delete", "underwriting_file", String(id), { oldValues: { fileName: row.fileName } });
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ message: err instanceof Error ? err.message : "Delete failed" }); }
    });

  // ── Phase catalogue ──
  app.get("/api/underwriting/phases",
    dbEnvironmentMiddleware, isAuthenticated, requirePerm(ACTIONS.UNDERWRITING_VIEW_QUEUE),
    async (_req: RequestWithDB, res) => res.json(PHASES));
}
