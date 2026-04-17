import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  agents,
  agentHierarchy,
  agentOverrides,
  commissionEvents,
  commissionSettings,
  COMMISSION_SETTING_KEYS,
  merchants,
  payouts,
  transactions,
  type CommissionEvent,
  type Payout,
} from "@shared/schema";
import type { Db } from "./hierarchyService";

const DEFAULT_OVERRIDE_PCT = 0.5;          // fallback if no setting row & no edge override
const DEFAULT_BASIS = "processing_fee";    // commission_basis fallback

export type CommissionBasis = "amount" | "processing_fee";

async function getSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(commissionSettings).where(eq(commissionSettings.key, key));
  return row?.value ?? null;
}

export async function getCommissionConfig(db: Db): Promise<{
  defaultOverridePct: number;
  basis: CommissionBasis;
}> {
  const [pct, basis] = await Promise.all([
    getSetting(db, COMMISSION_SETTING_KEYS.DEFAULT_OVERRIDE_PCT),
    getSetting(db, COMMISSION_SETTING_KEYS.COMMISSION_BASIS),
  ]);
  const parsedPct = pct != null ? Number(pct) : DEFAULT_OVERRIDE_PCT;
  const parsedBasis = (basis === "amount" || basis === "processing_fee") ? basis : DEFAULT_BASIS;
  return {
    defaultOverridePct: Number.isFinite(parsedPct) ? parsedPct : DEFAULT_OVERRIDE_PCT,
    basis: parsedBasis as CommissionBasis,
  };
}

export async function setSetting(db: Db, key: string, value: string, updatedBy?: string | null) {
  const existing = await getSetting(db, key);
  if (existing == null) {
    await db.insert(commissionSettings).values({ key, value, updatedBy: updatedBy ?? null });
  } else {
    await db.update(commissionSettings)
      .set({ value, updatedBy: updatedBy ?? null, updatedAt: new Date() })
      .where(eq(commissionSettings.key, key));
  }
}

/** Walk the upline of `agentId`, returning ancestor IDs ordered nearest-first
 *  (depth 1, 2, …). Excludes the agent itself. */
export async function getUplineAncestors(db: Db, agentId: number): Promise<{ id: number; depth: number }[]> {
  const rows = await db.select({ id: agentHierarchy.ancestorId, depth: agentHierarchy.depth })
    .from(agentHierarchy)
    .where(and(eq(agentHierarchy.descendantId, agentId), sql`${agentHierarchy.depth} > 0`));
  return rows.sort((a, b) => a.depth - b.depth);
}

/** Look up the parent's override % for a specific child agent. Returns null if none. */
async function getEdgeOverridePct(db: Db, parentId: number, childId: number): Promise<number | null> {
  const [row] = await db.select({ percent: agentOverrides.percent })
    .from(agentOverrides)
    .where(and(eq(agentOverrides.parentAgentId, parentId), eq(agentOverrides.childAgentId, childId)));
  return row ? Number(row.percent) : null;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Compute commission events for a transaction.
 *
 * Historical immutability: by default, if any commission_events already exist
 * for this transaction (in any status), this function is a no-op. This means
 * editing override percentages or settings only affects FUTURE transactions.
 *
 * Pass `force: true` ONLY for an explicit operator-driven recompute on a
 * single transaction (e.g. when fixing a misconfigured agent). Even with
 * force, paid and reversed rows are preserved — only pending/payable rows are
 * wiped and recomputed.
 */
export async function calculateCommissionsForTransaction(
  db: Db,
  transactionId: number,
  opts: { force?: boolean } = {},
): Promise<CommissionEvent[]> {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
  if (!tx) return [];
  if (tx.status !== "completed") return [];

  // Default path: skip if events already exist (immutability guarantee).
  const existing = await db.select({ id: commissionEvents.id, status: commissionEvents.status })
    .from(commissionEvents).where(eq(commissionEvents.transactionId, transactionId));
  if (existing.length > 0 && !opts.force) {
    return [];
  }

  const [merchant] = await db.select({ id: merchants.id, agentId: merchants.agentId })
    .from(merchants).where(eq(merchants.id, tx.merchantId));
  if (!merchant?.agentId) return [];

  const directAgentId = merchant.agentId;
  const [directAgent] = await db.select({ id: agents.id, commissionRate: agents.commissionRate })
    .from(agents).where(eq(agents.id, directAgentId));
  if (!directAgent) return [];

  const config = await getCommissionConfig(db);
  const basisAmount = Number(config.basis === "amount" ? tx.amount : (tx.processingFee ?? tx.amount));
  if (!Number.isFinite(basisAmount) || basisAmount <= 0) return [];

  // Forced recompute: wipe only non-final rows, preserve paid/reversed.
  if (opts.force && existing.length > 0) {
    await db.delete(commissionEvents)
      .where(and(eq(commissionEvents.transactionId, transactionId),
        inArray(commissionEvents.status, ["pending", "payable"])));
  }

  const inserts: typeof commissionEvents.$inferInsert[] = [];

  // Direct agent slice
  const directRate = Number(directAgent.commissionRate ?? 0);
  if (directRate > 0) {
    inserts.push({
      transactionId,
      merchantId: tx.merchantId,
      sourceAgentId: directAgentId,
      beneficiaryAgentId: directAgentId,
      depth: 0,
      basisAmount: round2(basisAmount),
      ratePct: directRate.toFixed(3),
      amount: round2(basisAmount * directRate / 100),
      status: "pending",
    });
  }

  // Upline overrides
  const ancestors = await getUplineAncestors(db, directAgentId);
  let prevChildId = directAgentId;
  for (const anc of ancestors) {
    const edgePct = await getEdgeOverridePct(db, anc.id, prevChildId);
    const pct = edgePct ?? config.defaultOverridePct;
    if (pct > 0) {
      inserts.push({
        transactionId,
        merchantId: tx.merchantId,
        sourceAgentId: directAgentId,
        beneficiaryAgentId: anc.id,
        depth: anc.depth,
        basisAmount: round2(basisAmount),
        ratePct: pct.toFixed(3),
        amount: round2(basisAmount * pct / 100),
        status: "pending",
      });
    }
    prevChildId = anc.id;
  }

  if (inserts.length === 0) return [];
  const rows = await db.insert(commissionEvents).values(inserts).returning();
  return rows;
}

/** Promote pending → payable for a set of events. */
export async function markEventsPayable(db: Db, eventIds: number[]) {
  if (eventIds.length === 0) return;
  await db.update(commissionEvents)
    .set({ status: "payable", updatedAt: new Date() })
    .where(and(inArray(commissionEvents.id, eventIds), eq(commissionEvents.status, "pending")));
}

/** Build a payout for one agent over a date range, attaching all payable events. */
export async function createPayoutForAgent(db: Db, params: {
  agentId: number;
  periodStart: Date;
  periodEnd: Date;
  method?: "ach" | "check" | "manual" | "wire";
  notes?: string | null;
  createdBy?: string | null;
}): Promise<Payout> {
  const { agentId, periodStart, periodEnd } = params;

  // Only events already promoted to "payable" are eligible. Pending events
  // must be explicitly approved (markEventsPayable) before they can be paid.
  const eligible = await db.select({ id: commissionEvents.id, amount: commissionEvents.amount })
    .from(commissionEvents)
    .where(and(
      eq(commissionEvents.beneficiaryAgentId, agentId),
      eq(commissionEvents.status, "payable"),
      gte(commissionEvents.createdAt, periodStart),
      lte(commissionEvents.createdAt, periodEnd),
    ));

  const gross = eligible.reduce((acc, e) => acc + Number(e.amount), 0);

  const [payout] = await db.insert(payouts).values({
    agentId,
    periodStart,
    periodEnd,
    grossAmount: round2(gross),
    adjustments: "0",
    netAmount: round2(gross),
    method: params.method ?? "ach",
    status: "draft",
    notes: params.notes ?? null,
    createdBy: params.createdBy ?? null,
  }).returning();

  if (eligible.length > 0) {
    // Attach to payout (status remains "payable" until the payout is marked paid).
    await db.update(commissionEvents)
      .set({ payoutId: payout.id, updatedAt: new Date() })
      .where(inArray(commissionEvents.id, eligible.map((e) => e.id)));
  }

  return payout;
}

/** Mark a payout paid; locks its events to status=paid. */
export async function markPayoutPaid(db: Db, payoutId: number, opts?: { reference?: string | null }) {
  const [payout] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!payout) throw new Error("Payout not found");
  if (payout.status === "paid") return payout;
  if (payout.status === "void") throw new Error("Cannot pay a void payout");
  await db.update(commissionEvents)
    .set({ status: "paid", updatedAt: new Date() })
    .where(eq(commissionEvents.payoutId, payoutId));
  const [updated] = await db.update(payouts)
    .set({ status: "paid", paidAt: new Date(), reference: opts?.reference ?? payout.reference })
    .where(eq(payouts.id, payoutId))
    .returning();
  return updated;
}

/** Void a payout: detach events back to payable so they can be re-paid. */
export async function voidPayout(db: Db, payoutId: number) {
  const [payout] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!payout) throw new Error("Payout not found");
  if (payout.status === "paid") throw new Error("Cannot void a paid payout — reverse it instead");
  // Detach events back to "payable" — they were promoted from pending when the
  // payout was created, so returning them to payable preserves their accounting
  // state (ready-to-pay, not freshly accrued).
  await db.update(commissionEvents)
    .set({ payoutId: null, status: "payable", updatedAt: new Date() })
    .where(eq(commissionEvents.payoutId, payoutId));
  const [updated] = await db.update(payouts)
    .set({ status: "void" })
    .where(eq(payouts.id, payoutId))
    .returning();
  return updated;
}

/**
 * Aggregate statement for an agent (or a list of agents) over a period.
 *
 * Totals and per-agent rollups are computed via DB-side SUM aggregates over
 * the FULL filtered dataset (no limit). The `events` list returned alongside
 * is a recent slice (default 500, newest first) intended for display only.
 */
export async function buildStatement(db: Db, params: {
  agentIds: number[];
  periodStart?: Date;
  periodEnd?: Date;
  eventLimit?: number;
}) {
  const { agentIds, periodStart, periodEnd, eventLimit = 500 } = params;
  if (agentIds.length === 0) return { totals: emptyTotals(), events: [], byAgent: [] };

  const conds = [inArray(commissionEvents.beneficiaryAgentId, agentIds)];
  if (periodStart) conds.push(gte(commissionEvents.createdAt, periodStart));
  if (periodEnd) conds.push(lte(commissionEvents.createdAt, periodEnd));

  // Full-population aggregates by status — independent of event display limit.
  const totalsRows = await db.select({
    status: commissionEvents.status,
    sum: sql<string>`COALESCE(SUM(${commissionEvents.amount}), 0)`,
  }).from(commissionEvents).where(and(...conds))
    .groupBy(commissionEvents.status);

  const totals = emptyTotals();
  for (const r of totalsRows) {
    const amt = Number(r.sum);
    totals.total += amt;
    if (r.status === "pending") totals.pending += amt;
    else if (r.status === "payable") totals.payable += amt;
    else if (r.status === "paid") totals.paid += amt;
    else if (r.status === "reversed") totals.reversed += amt;
  }

  // Per-agent rollups by status — also full-population.
  const perAgentRows = await db.select({
    agentId: commissionEvents.beneficiaryAgentId,
    status: commissionEvents.status,
    sum: sql<string>`COALESCE(SUM(${commissionEvents.amount}), 0)`,
  }).from(commissionEvents).where(and(...conds))
    .groupBy(commissionEvents.beneficiaryAgentId, commissionEvents.status);

  const byAgentMap = new Map<number, ReturnType<typeof emptyTotals>>();
  for (const r of perAgentRows) {
    const cur = byAgentMap.get(r.agentId) ?? emptyTotals();
    const amt = Number(r.sum);
    cur.total += amt;
    if (r.status === "pending") cur.pending += amt;
    else if (r.status === "payable") cur.payable += amt;
    else if (r.status === "paid") cur.paid += amt;
    else if (r.status === "reversed") cur.reversed += amt;
    byAgentMap.set(r.agentId, cur);
  }
  const byAgent = Array.from(byAgentMap.entries()).map(([agentId, t]) => ({ agentId, ...t }));

  // Recent events for display only — limited.
  const events = await db.select().from(commissionEvents).where(and(...conds))
    .orderBy(desc(commissionEvents.createdAt)).limit(eventLimit);

  return { totals, events, byAgent };
}

function emptyTotals() {
  return { total: 0, pending: 0, payable: 0, paid: 0, reversed: 0 };
}

/**
 * Backfill commissions for completed transactions that have NO existing events.
 * Never touches transactions that already have an event slate — this preserves
 * historical immutability of past splits.
 */
export async function recalcAll(db: Db, opts?: { sinceDays?: number }): Promise<{ processed: number; skipped: number }> {
  const since = opts?.sinceDays
    ? new Date(Date.now() - opts.sinceDays * 86400_000)
    : null;
  const conds = [eq(transactions.status, "completed")];
  if (since) conds.push(gte(transactions.createdAt, since));
  const txs = await db.select({ id: transactions.id }).from(transactions).where(and(...conds));
  let processed = 0;
  let skipped = 0;
  for (const t of txs) {
    const result = await calculateCommissionsForTransaction(db, t.id);
    if (result.length > 0) processed += 1;
    else skipped += 1;
  }
  return { processed, skipped };
}

/** Mark commission events as paid in bulk (no payout batch). */
export async function markEventsPaid(db: Db, eventIds: number[], reference?: string | null): Promise<number> {
  if (eventIds.length === 0) return 0;
  // Only pending/payable rows can transition to paid — never re-flip paid/reversed.
  const updated = await db.update(commissionEvents)
    .set({ status: "paid", updatedAt: new Date(), notes: reference ?? undefined })
    .where(and(
      inArray(commissionEvents.id, eventIds),
      inArray(commissionEvents.status, ["pending", "payable"]),
    ))
    .returning({ id: commissionEvents.id });
  return updated.length;
}
