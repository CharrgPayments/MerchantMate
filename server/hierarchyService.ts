import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@shared/schema";
import { agents, merchants, agentHierarchy, merchantHierarchy } from "@shared/schema";

export const MAX_HIERARCHY_DEPTH = 5;

export class HierarchyError extends Error {
  code: "CYCLE" | "MAX_DEPTH" | "PARENT_MISSING" | "SELF_PARENT";
  constructor(code: HierarchyError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** Accepts either the top-level Drizzle DB or a transaction client (both share the same query API). */
type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
type TxClient = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type Db = DrizzleDB | TxClient;

/** Insert the self-row (depth 0) for a brand new agent. Idempotent. */
export async function initAgentClosure(db: Db, agentId: number) {
  await db.insert(agentHierarchy).values({ ancestorId: agentId, descendantId: agentId, depth: 0 }).onConflictDoNothing();
}

export async function initMerchantClosure(db: Db, merchantId: number) {
  await db.insert(merchantHierarchy).values({ ancestorId: merchantId, descendantId: merchantId, depth: 0 }).onConflictDoNothing();
}

/** Validate setting parentId on a node and (re)build closure rows. parentId may be null. */
export async function setAgentParent(db: Db, agentId: number, parentId: number | null) {
  await ensureNoCycleAndDepth(db, "agent", agentId, parentId);
  await db.update(agents).set({ parentAgentId: parentId }).where(eq(agents.id, agentId));
  await rebuildAgentClosureForSubtree(db, agentId, parentId);
}

export async function setMerchantParent(db: Db, merchantId: number, parentId: number | null) {
  await ensureNoCycleAndDepth(db, "merchant", merchantId, parentId);
  await db.update(merchants).set({ parentMerchantId: parentId }).where(eq(merchants.id, merchantId));
  await rebuildMerchantClosureForSubtree(db, merchantId, parentId);
}

async function ensureNoCycleAndDepth(db: Db, kind: "agent" | "merchant", nodeId: number, parentId: number | null) {
  if (parentId === null || parentId === undefined) return;
  if (parentId === nodeId) throw new HierarchyError("SELF_PARENT", "A node cannot be its own parent");

  const closureTable = kind === "agent" ? agentHierarchy : merchantHierarchy;
  const nodeTable = kind === "agent" ? agents : merchants;

  // Parent must exist
  const [parent] = await db.select({ id: nodeTable.id }).from(nodeTable).where(eq(nodeTable.id, parentId));
  if (!parent) throw new HierarchyError("PARENT_MISSING", `Parent ${kind} ${parentId} not found`);

  // Cycle: parent must NOT be a descendant of node
  const cycle = await db.select({ d: closureTable.descendantId }).from(closureTable)
    .where(and(eq(closureTable.ancestorId, nodeId), eq(closureTable.descendantId, parentId)));
  if (cycle.length > 0) throw new HierarchyError("CYCLE", "Cannot move node under one of its own descendants");

  // Depth check: max chain length must remain ≤ MAX_HIERARCHY_DEPTH
  // chosen-parent's depth from root + 1 (this node) + max descendant depth of this node
  const [{ maxDescDepth }] = await db.select({
    maxDescDepth: sql<number>`COALESCE(MAX(${closureTable.depth}), 0)`,
  }).from(closureTable).where(eq(closureTable.ancestorId, nodeId));
  const [{ maxParentDepth }] = await db.select({
    maxParentDepth: sql<number>`COALESCE(MAX(${closureTable.depth}), 0)`,
  }).from(closureTable).where(eq(closureTable.descendantId, parentId));
  const newMaxDepth = Number(maxParentDepth) + 1 + Number(maxDescDepth);
  if (newMaxDepth > MAX_HIERARCHY_DEPTH) {
    throw new HierarchyError("MAX_DEPTH", `Hierarchy would exceed max depth of ${MAX_HIERARCHY_DEPTH}`);
  }
}

/** Detach the subtree rooted at nodeId from any old ancestor rows, then attach under newParent. */
async function rebuildAgentClosureForSubtree(db: Db, nodeId: number, newParentId: number | null) {
  // Remove old ancestor links for everything in the subtree (keep self-rows)
  await db.execute(sql`
    DELETE FROM agent_hierarchy
    WHERE descendant_id IN (SELECT descendant_id FROM agent_hierarchy WHERE ancestor_id = ${nodeId})
      AND ancestor_id NOT IN (SELECT descendant_id FROM agent_hierarchy WHERE ancestor_id = ${nodeId})
  `);
  if (newParentId !== null && newParentId !== undefined) {
    await db.execute(sql`
      INSERT INTO agent_hierarchy (ancestor_id, descendant_id, depth)
      SELECT p.ancestor_id, c.descendant_id, p.depth + c.depth + 1
      FROM agent_hierarchy p, agent_hierarchy c
      WHERE p.descendant_id = ${newParentId} AND c.ancestor_id = ${nodeId}
      ON CONFLICT DO NOTHING
    `);
  }
}

async function rebuildMerchantClosureForSubtree(db: Db, nodeId: number, newParentId: number | null) {
  await db.execute(sql`
    DELETE FROM merchant_hierarchy
    WHERE descendant_id IN (SELECT descendant_id FROM merchant_hierarchy WHERE ancestor_id = ${nodeId})
      AND ancestor_id NOT IN (SELECT descendant_id FROM merchant_hierarchy WHERE ancestor_id = ${nodeId})
  `);
  if (newParentId !== null && newParentId !== undefined) {
    await db.execute(sql`
      INSERT INTO merchant_hierarchy (ancestor_id, descendant_id, depth)
      SELECT p.ancestor_id, c.descendant_id, p.depth + c.depth + 1
      FROM merchant_hierarchy p, merchant_hierarchy c
      WHERE p.descendant_id = ${newParentId} AND c.ancestor_id = ${nodeId}
      ON CONFLICT DO NOTHING
    `);
  }
}

/**
 * Maintain closure-table integrity when a node is about to be deleted.
 * Direct children are reattached to the deleted node's current parent
 * (so the chain "grandparent → child" survives), then every closure row
 * referencing the deleted node is removed. Call this BEFORE deleting the
 * node row itself.
 */
export async function detachAgentForDelete(db: Db, agentId: number) {
  const [self] = await db.select({ parentAgentId: agents.parentAgentId }).from(agents).where(eq(agents.id, agentId));
  if (!self) return;
  const grandparentId = self.parentAgentId ?? null;
  const directChildren = await db.select({ id: agents.id }).from(agents).where(eq(agents.parentAgentId, agentId));
  for (const child of directChildren) {
    await setAgentParent(db, child.id, grandparentId);
  }
  await db.delete(agentHierarchy).where(eq(agentHierarchy.ancestorId, agentId));
  await db.delete(agentHierarchy).where(eq(agentHierarchy.descendantId, agentId));
}

export async function detachMerchantForDelete(db: Db, merchantId: number) {
  const [self] = await db.select({ parentMerchantId: merchants.parentMerchantId }).from(merchants).where(eq(merchants.id, merchantId));
  if (!self) return;
  const grandparentId = self.parentMerchantId ?? null;
  const directChildren = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.parentMerchantId, merchantId));
  for (const child of directChildren) {
    await setMerchantParent(db, child.id, grandparentId);
  }
  await db.delete(merchantHierarchy).where(eq(merchantHierarchy.ancestorId, merchantId));
  await db.delete(merchantHierarchy).where(eq(merchantHierarchy.descendantId, merchantId));
}

/** Returns descendant IDs (including self at depth 0). */
export async function getAgentDescendantIds(db: Db, agentId: number): Promise<number[]> {
  const rows = await db.select({ id: agentHierarchy.descendantId })
    .from(agentHierarchy).where(eq(agentHierarchy.ancestorId, agentId));
  return rows.map((r) => r.id);
}

export async function getMerchantDescendantIds(db: Db, merchantId: number): Promise<number[]> {
  const rows = await db.select({ id: merchantHierarchy.descendantId })
    .from(merchantHierarchy).where(eq(merchantHierarchy.ancestorId, merchantId));
  return rows.map((r) => r.id);
}

/** Rebuild closure for ALL existing nodes from scratch. Used for backfill. */
export async function backfillAgentClosure(db: Db) {
  await db.execute(sql`DELETE FROM agent_hierarchy`);
  await db.execute(sql`INSERT INTO agent_hierarchy (ancestor_id, descendant_id, depth) SELECT id, id, 0 FROM agents`);
  // Iteratively expand using BFS (max 5 hops is enough)
  for (let i = 0; i < MAX_HIERARCHY_DEPTH; i++) {
    await db.execute(sql`
      INSERT INTO agent_hierarchy (ancestor_id, descendant_id, depth)
      SELECT ah.ancestor_id, a.id, ah.depth + 1
      FROM agents a
      JOIN agent_hierarchy ah ON ah.descendant_id = a.parent_agent_id
      WHERE a.parent_agent_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }
}

export async function backfillMerchantClosure(db: Db) {
  await db.execute(sql`DELETE FROM merchant_hierarchy`);
  await db.execute(sql`INSERT INTO merchant_hierarchy (ancestor_id, descendant_id, depth) SELECT id, id, 0 FROM merchants`);
  for (let i = 0; i < MAX_HIERARCHY_DEPTH; i++) {
    await db.execute(sql`
      INSERT INTO merchant_hierarchy (ancestor_id, descendant_id, depth)
      SELECT mh.ancestor_id, m.id, mh.depth + 1
      FROM merchants m
      JOIN merchant_hierarchy mh ON mh.descendant_id = m.parent_merchant_id
      WHERE m.parent_merchant_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }
}
