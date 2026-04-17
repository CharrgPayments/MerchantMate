import type { Express, Response } from "express";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agents,
  agentHierarchy,
  agentOverrides,
  commissionEvents,
  commissionSettings,
  COMMISSION_EVENT_STATUSES,
  COMMISSION_SETTING_KEYS,
  merchants,
  payouts,
  PAYOUT_METHODS,
  insertAgentOverrideSchema,
} from "@shared/schema";
import { ACTIONS, getActionScope } from "@shared/permissions";
import { dbEnvironmentMiddleware, type RequestWithDB } from "../dbMiddleware";
import { isAuthenticated, requirePerm } from "../replitAuth";
import { getAgentDescendantIds } from "../hierarchyService";
import {
  buildStatement,
  calculateCommissionsForTransaction,
  createPayoutForAgent,
  getCommissionConfig,
  markEventsPaid,
  markPayoutPaid,
  recalcAll,
  setSetting,
  voidPayout,
} from "../commissions";

/** Resolve which agent IDs the current user is allowed to see. */
async function resolveScopedAgentIds(req: RequestWithDB, requestedAgentId?: number): Promise<number[]> {
  const db = req.db!;
  const user = req.currentUser as any;
  const scope = getActionScope(user, ACTIONS.COMMISSIONS_VIEW);
  if (!scope) return [];

  // Find agent record for the current user (may be null for non-agent admins)
  const [selfAgent] = await db.select({ id: agents.id })
    .from(agents).where(eq(agents.userId, user?.id));

  if (scope === "all") {
    if (requestedAgentId) return [requestedAgentId];
    return (await db.select({ id: agents.id }).from(agents)).map((r) => r.id);
  }

  if (scope === "downline") {
    if (!selfAgent) return [];
    const downline = await getAgentDescendantIds(db, selfAgent.id);
    if (requestedAgentId) {
      return downline.includes(requestedAgentId) ? [requestedAgentId] : [];
    }
    return downline;
  }

  // own
  if (!selfAgent) return [];
  if (requestedAgentId && requestedAgentId !== selfAgent.id) return [];
  return [selfAgent.id];
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function registerCommissionsRoutes(app: Express) {
  // ---------------- Settings ---------------------------------------------
  app.get("/api/commissions/settings",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const cfg = await getCommissionConfig(req.db!);
        res.json(cfg);
      } catch (err: any) {
        console.error("[commissions] settings GET failed", err);
        res.status(500).json({ message: "Failed to load settings" });
      }
    });

  app.put("/api/commissions/settings",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const schema = z.object({
          defaultOverridePct: z.coerce.number().min(0).max(100).optional(),
          basis: z.enum(["amount", "processing_fee"]).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
        const userId = (req.currentUser as any)?.id ?? null;
        if (parsed.data.defaultOverridePct !== undefined) {
          await setSetting(req.db!, COMMISSION_SETTING_KEYS.DEFAULT_OVERRIDE_PCT,
            String(parsed.data.defaultOverridePct), userId);
        }
        if (parsed.data.basis !== undefined) {
          await setSetting(req.db!, COMMISSION_SETTING_KEYS.COMMISSION_BASIS, parsed.data.basis, userId);
        }
        const cfg = await getCommissionConfig(req.db!);
        res.json(cfg);
      } catch (err: any) {
        console.error("[commissions] settings PUT failed", err);
        res.status(500).json({ message: "Failed to update settings" });
      }
    });

  // ---------------- Overrides --------------------------------------------
  app.get("/api/commissions/overrides",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const parentId = req.query.parentAgentId ? Number(req.query.parentAgentId) : undefined;
        const allowedIds = await resolveScopedAgentIds(req);
        const conds = [];
        if (parentId) {
          if (!allowedIds.includes(parentId)) return res.status(403).json({ message: "Forbidden" });
          conds.push(eq(agentOverrides.parentAgentId, parentId));
        } else if (allowedIds.length > 0) {
          conds.push(inArray(agentOverrides.parentAgentId, allowedIds));
        } else {
          return res.json([]);
        }
        const rows = await req.db!.select().from(agentOverrides).where(and(...conds))
          .orderBy(desc(agentOverrides.updatedAt));
        res.json(rows);
      } catch (err: any) {
        console.error("[commissions] overrides GET failed", err);
        res.status(500).json({ message: "Failed to fetch overrides" });
      }
    });

  app.post("/api/commissions/overrides",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const schema = insertAgentOverrideSchema.extend({
          percent: z.coerce.number().min(0).max(100).transform((n) => n.toFixed(2)),
        });
        const parsed = schema.safeParse({
          ...req.body,
          createdBy: (req.currentUser as any)?.id ?? null,
        });
        if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
        if (parsed.data.parentAgentId === parsed.data.childAgentId) {
          return res.status(400).json({ message: "Parent and child must differ" });
        }
        // Enforce that (parent, child) is a real edge in the agent hierarchy
        // (direct parent/child link, depth=1). Overrides on non-edges are
        // meaningless because the engine walks the upline edge-by-edge.
        const [edge] = await req.db!.select({ depth: agentHierarchy.depth })
          .from(agentHierarchy)
          .where(and(
            eq(agentHierarchy.ancestorId, parsed.data.parentAgentId),
            eq(agentHierarchy.descendantId, parsed.data.childAgentId),
            eq(agentHierarchy.depth, 1),
          ));
        if (!edge) {
          return res.status(400).json({
            message: "Override must be set on a direct parent→child hierarchy edge.",
          });
        }
        // Upsert by (parent, child)
        const existing = await req.db!.select({ id: agentOverrides.id }).from(agentOverrides)
          .where(and(
            eq(agentOverrides.parentAgentId, parsed.data.parentAgentId),
            eq(agentOverrides.childAgentId, parsed.data.childAgentId),
          ));
        if (existing.length > 0) {
          const [row] = await req.db!.update(agentOverrides)
            .set({ percent: parsed.data.percent, notes: parsed.data.notes ?? null, updatedAt: new Date() })
            .where(eq(agentOverrides.id, existing[0].id))
            .returning();
          return res.json(row);
        }
        const [row] = await req.db!.insert(agentOverrides).values(parsed.data).returning();
        res.status(201).json(row);
      } catch (err: any) {
        console.error("[commissions] overrides POST failed", err);
        res.status(500).json({ message: "Failed to save override" });
      }
    });

  app.delete("/api/commissions/overrides/:id",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const id = Number(req.params.id);
        await req.db!.delete(agentOverrides).where(eq(agentOverrides.id, id));
        res.status(204).end();
      } catch (err: any) {
        console.error("[commissions] overrides DELETE failed", err);
        res.status(500).json({ message: "Failed to delete override" });
      }
    });

  // ---------------- Events / Statement -----------------------------------
  app.get("/api/commissions/events",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const agentIdParam = req.query.agentId ? Number(req.query.agentId) : undefined;
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const periodStart = parseDate(req.query.periodStart);
        const periodEnd = parseDate(req.query.periodEnd);
        const allowed = await resolveScopedAgentIds(req, agentIdParam);
        if (allowed.length === 0) return res.json([]);
        const conds = [inArray(commissionEvents.beneficiaryAgentId, allowed)];
        if (status && (COMMISSION_EVENT_STATUSES as readonly string[]).includes(status)) {
          conds.push(eq(commissionEvents.status, status));
        }
        if (periodStart) conds.push(gte(commissionEvents.createdAt, periodStart));
        if (periodEnd) conds.push(lte(commissionEvents.createdAt, periodEnd));
        const rows = await req.db!.select().from(commissionEvents).where(and(...conds))
          .orderBy(desc(commissionEvents.createdAt)).limit(500);
        res.json(rows);
      } catch (err: any) {
        console.error("[commissions] events GET failed", err);
        res.status(500).json({ message: "Failed to fetch commission events" });
      }
    });

  app.get("/api/commissions/statement",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const agentIdParam = req.query.agentId ? Number(req.query.agentId) : undefined;
        const periodStart = parseDate(req.query.periodStart);
        const periodEnd = parseDate(req.query.periodEnd);
        const allowed = await resolveScopedAgentIds(req, agentIdParam);
        const stmt = await buildStatement(req.db!, { agentIds: allowed, periodStart, periodEnd });
        res.json(stmt);
      } catch (err: any) {
        console.error("[commissions] statement failed", err);
        res.status(500).json({ message: "Failed to build statement" });
      }
    });

  // ---------------- Recalculation ----------------------------------------
  app.post("/api/commissions/recalculate/:transactionId",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const txId = Number(req.params.transactionId);
        // Explicit operator action → force=true so paid rows are preserved
        // but pending/payable rows are recomputed for this single tx.
        const force = req.body?.force === true || req.body?.force === "true";
        const events = await calculateCommissionsForTransaction(req.db!, txId, { force });
        res.json({ transactionId: txId, eventCount: events.length, events });
      } catch (err: any) {
        console.error("[commissions] recalc failed", err);
        res.status(500).json({ message: "Recalculation failed" });
      }
    });

  // Bulk mark commission events as paid (without creating a payout batch).
  app.post("/api/commissions/events/mark-paid",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.PAYOUTS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const schema = z.object({
          eventIds: z.array(z.coerce.number().int().positive()).min(1),
          reference: z.string().optional().nullable(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });

        // Scope check: every event's beneficiary must be in the caller's allowed set.
        const allowed = await resolveScopedAgentIds(req);
        const rows = await req.db!.select({
          id: commissionEvents.id,
          beneficiaryAgentId: commissionEvents.beneficiaryAgentId,
        }).from(commissionEvents).where(inArray(commissionEvents.id, parsed.data.eventIds));
        const denied = rows.filter((r) => !allowed.includes(r.beneficiaryAgentId));
        if (denied.length > 0) return res.status(403).json({ message: "Forbidden" });

        const updated = await markEventsPaid(
          req.db!, rows.map((r) => r.id), parsed.data.reference ?? null);
        res.json({ updated });
      } catch (err: any) {
        console.error("[commissions] events mark-paid failed", err);
        res.status(500).json({ message: err?.message || "Mark paid failed" });
      }
    });

  // Agent dashboard widget: current-month earnings, pending payout, downline split.
  app.get("/api/commissions/dashboard-summary",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const user = req.currentUser as any;
        const [selfAgent] = await req.db!.select({ id: agents.id })
          .from(agents).where(eq(agents.userId, user?.id));

        // Determine which agent's dashboard we're showing.
        // If non-agent admin without selfAgent and no explicit ?agentId, fall back
        // to the org-wide totals (sum across all scoped agents).
        const explicit = req.query.agentId ? Number(req.query.agentId) : undefined;
        const allowed = await resolveScopedAgentIds(req, explicit);
        const focusAgentId = explicit ?? selfAgent?.id;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Residual totals must be computed for the focus agent only
        // (not the whole scope), otherwise an upline agent's "earned this
        // month" would double-count their downline's own beneficiary events.
        // When there's no focus agent (e.g. a non-agent admin viewing a global
        // dashboard), fall back to the full scoped agent list.
        const beneficiarySet = focusAgentId
          ? [focusAgentId]
          : (allowed.length ? allowed : [-1]);

        const baseConds = (status?: string, since?: Date) => {
          const c: any[] = [inArray(commissionEvents.beneficiaryAgentId, beneficiarySet)];
          if (status) c.push(eq(commissionEvents.status, status));
          if (since) c.push(gte(commissionEvents.createdAt, since));
          return and(...c);
        };

        const sumRow = async (where: any): Promise<number> => {
          const [row] = await req.db!.select({
            v: sql<string>`COALESCE(SUM(${commissionEvents.amount}), 0)`,
          }).from(commissionEvents).where(where);
          return Number(row?.v ?? 0);
        };

        const [currentMonthTotal, pendingTotal, payableTotal, paidThisMonth] = await Promise.all([
          sumRow(baseConds(undefined, monthStart)),
          sumRow(baseConds("pending")),
          sumRow(baseConds("payable")),
          sumRow(and(baseConds("paid"), gte(commissionEvents.createdAt, monthStart))),
        ]);

        // Downline contribution: events where the current agent is beneficiary
        // and depth > 0 (i.e. earnings sourced from sub-agents), this month.
        let downlineContribution = 0;
        let directContribution = 0;
        if (focusAgentId) {
          const [dl] = await req.db!.select({
            v: sql<string>`COALESCE(SUM(${commissionEvents.amount}), 0)`,
          }).from(commissionEvents).where(and(
            eq(commissionEvents.beneficiaryAgentId, focusAgentId),
            sql`${commissionEvents.depth} > 0`,
            gte(commissionEvents.createdAt, monthStart),
          ));
          downlineContribution = Number(dl?.v ?? 0);
          const [d0] = await req.db!.select({
            v: sql<string>`COALESCE(SUM(${commissionEvents.amount}), 0)`,
          }).from(commissionEvents).where(and(
            eq(commissionEvents.beneficiaryAgentId, focusAgentId),
            eq(commissionEvents.depth, 0),
            gte(commissionEvents.createdAt, monthStart),
          ));
          directContribution = Number(d0?.v ?? 0);
        }

        // Pending payout = the most recent draft/processing payout for the focus agent.
        let pendingPayout: any = null;
        if (focusAgentId) {
          const [p] = await req.db!.select().from(payouts)
            .where(and(
              eq(payouts.agentId, focusAgentId),
              inArray(payouts.status, ["draft", "processing"]),
            ))
            .orderBy(desc(payouts.createdAt))
            .limit(1);
          pendingPayout = p ?? null;
        }

        res.json({
          focusAgentId: focusAgentId ?? null,
          currentMonth: {
            total: currentMonthTotal,
            paid: paidThisMonth,
            directContribution,
            downlineContribution,
          },
          pending: pendingTotal,
          payable: payableTotal,
          pendingPayout,
        });
      } catch (err: any) {
        console.error("[commissions] dashboard-summary failed", err);
        res.status(500).json({ message: "Failed to build summary" });
      }
    });

  app.post("/api/commissions/recalculate-all",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const sinceDays = req.body?.sinceDays ? Number(req.body.sinceDays) : undefined;
        const result = await recalcAll(req.db!, { sinceDays });
        res.json(result);
      } catch (err: any) {
        console.error("[commissions] recalc-all failed", err);
        res.status(500).json({ message: "Bulk recalculation failed" });
      }
    });

  // ---------------- Payouts ----------------------------------------------
  app.get("/api/payouts",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const agentIdParam = req.query.agentId ? Number(req.query.agentId) : undefined;
        const allowed = await resolveScopedAgentIds(req, agentIdParam);
        if (allowed.length === 0) return res.json([]);
        const rows = await req.db!.select().from(payouts)
          .where(inArray(payouts.agentId, allowed))
          .orderBy(desc(payouts.createdAt));
        res.json(rows);
      } catch (err: any) {
        console.error("[commissions] payouts GET failed", err);
        res.status(500).json({ message: "Failed to fetch payouts" });
      }
    });

  app.get("/api/payouts/:id",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.COMMISSIONS_VIEW),
    async (req: RequestWithDB, res: Response) => {
      try {
        const id = Number(req.params.id);
        const [payout] = await req.db!.select().from(payouts).where(eq(payouts.id, id));
        if (!payout) return res.status(404).json({ message: "Not found" });
        const allowed = await resolveScopedAgentIds(req);
        if (!allowed.includes(payout.agentId)) return res.status(403).json({ message: "Forbidden" });
        const events = await req.db!.select().from(commissionEvents)
          .where(eq(commissionEvents.payoutId, id))
          .orderBy(desc(commissionEvents.createdAt));
        res.json({ payout, events });
      } catch (err: any) {
        console.error("[commissions] payout GET failed", err);
        res.status(500).json({ message: "Failed to fetch payout" });
      }
    });

  app.post("/api/payouts",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.PAYOUTS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const schema = z.object({
          agentId: z.coerce.number().int().positive(),
          periodStart: z.string(),
          periodEnd: z.string(),
          method: z.enum(PAYOUT_METHODS).optional(),
          notes: z.string().optional().nullable(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
        const ps = parseDate(parsed.data.periodStart);
        const pe = parseDate(parsed.data.periodEnd);
        if (!ps || !pe) return res.status(400).json({ message: "Invalid period dates" });
        const payout = await createPayoutForAgent(req.db!, {
          agentId: parsed.data.agentId,
          periodStart: ps,
          periodEnd: pe,
          method: parsed.data.method,
          notes: parsed.data.notes ?? null,
          createdBy: (req.currentUser as any)?.id ?? null,
        });
        res.status(201).json(payout);
      } catch (err: any) {
        console.error("[commissions] payout create failed", err);
        res.status(500).json({ message: err?.message || "Failed to create payout" });
      }
    });

  app.post("/api/payouts/:id/mark-paid",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.PAYOUTS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const id = Number(req.params.id);
        const reference = typeof req.body?.reference === "string" ? req.body.reference : null;
        const updated = await markPayoutPaid(req.db!, id, { reference });
        res.json(updated);
      } catch (err: any) {
        console.error("[commissions] mark-paid failed", err);
        res.status(400).json({ message: err?.message || "Mark paid failed" });
      }
    });

  app.post("/api/payouts/:id/void",
    isAuthenticated, dbEnvironmentMiddleware, requirePerm(ACTIONS.PAYOUTS_MANAGE),
    async (req: RequestWithDB, res: Response) => {
      try {
        const id = Number(req.params.id);
        const updated = await voidPayout(req.db!, id);
        res.json(updated);
      } catch (err: any) {
        console.error("[commissions] void failed", err);
        res.status(400).json({ message: err?.message || "Void failed" });
      }
    });
}
