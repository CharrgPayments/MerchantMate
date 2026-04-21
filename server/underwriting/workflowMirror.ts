// Task #28 — Mirror underwriting runs into the generic Workflows engine
// (workflow_tickets + workflow_ticket_stages) so the unified Worklist UI
// surfaces underwriting work without the underwriting domain losing
// authority. The underwriting_* tables remain the system of record;
// these helpers are additive and idempotent.
//
// db-tier-allow: This file mixes typed Drizzle with raw SQL for the
// mutation paths. The mutations (UPDATE/INSERT) use CASE WHEN, COALESCE,
// and JSONB casts that are awkward in Drizzle's builder; the raw SQL
// fragments stay column-aware via the typed schema imports below. All
// access goes through the per-request DynamicDB Proxy passed in as `db`,
// so environment isolation is preserved.

import { sql, eq, and } from "drizzle-orm";
import type { ProspectApplication } from "@shared/schema";
import {
  workflowDefinitions,
  workflowStages,
  workflowTicketStages,
  workflowTickets,
} from "@shared/schema";
import { PATHWAYS, PHASES, type Pathway, type PhaseResult } from "@shared/underwriting";
import type { db as defaultDb } from "../db";

// Definition codes seeded in server/scripts/seedUnderwritingWorkflows.ts.
const DEF_CODE_BY_PATHWAY: Record<Pathway, string> = {
  [PATHWAYS.TRADITIONAL]: "merchant_underwriting_traditional_v1",
  [PATHWAYS.PAYFAC]: "merchant_underwriting_payfac_v1",
};

// MirrorDB is the actual per-request DynamicDB Proxy from server/db.ts.
// Typed as `typeof db` so callers can't accidentally pass a wrong client
// (e.g. the static fallback) — env isolation is enforced by typing.
export type MirrorDB = typeof defaultDb;

interface ExecResult<T = Record<string, unknown>> { rows?: T[] }

async function firstRow<T = Record<string, unknown>>(
  db: MirrorDB, q: ReturnType<typeof sql>,
): Promise<T | null> {
  const r = (await db.execute(q)) as ExecResult<T>;
  return r.rows?.[0] ?? null;
}

async function lookupDefinitionId(db: MirrorDB, pathway: Pathway): Promise<number | null> {
  const code = DEF_CODE_BY_PATHWAY[pathway] ?? DEF_CODE_BY_PATHWAY[PATHWAYS.TRADITIONAL];
  // Typed Drizzle SELECT — column name verified at compile time.
  const rows = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.code, code))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function lookupStageId(
  db: MirrorDB, definitionId: number, stageCode: string,
): Promise<number | null> {
  // Typed Drizzle SELECT.
  const rows = await db
    .select({ id: workflowStages.id })
    .from(workflowStages)
    .where(
      and(
        eq(workflowStages.workflowDefinitionId, definitionId),
        eq(workflowStages.code, stageCode),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// Translate the underwriting per-phase status into the workflow engine's
// terminal vocabulary. Both pass and warn count as completed at the
// engine level (the underwriting domain still tracks the warning via
// underwriting_issues); `fail`/`error` map to `failed` so the Worklist
// surfaces the blockage.
function mapStageStatus(uwStatus: PhaseResult["status"]): {
  status: "completed" | "failed";
  result: "approved" | "rejected" | "warning" | "error";
} {
  switch (uwStatus) {
    case "pass": return { status: "completed", result: "approved" };
    case "warn": return { status: "completed", result: "warning" };
    case "fail": return { status: "failed", result: "rejected" };
    case "error": default: return { status: "failed", result: "error" };
  }
}

// Ensure a workflow_ticket exists for this application. Idempotent:
// returns the existing id when one is already present, otherwise inserts
// one. When the pathway changes we relink to the new definition and
// reset current_stage_id so the next phase becomes "current". Also
// pre-creates the manual-phase ticket stage rows so reviewers see them
// in the Worklist before the orchestrator touches them.
export async function ensureTicket(
  db: MirrorDB, app: ProspectApplication,
): Promise<{ ticketId: number; definitionId: number } | null> {
  const pathway = (app.pathway as Pathway) || PATHWAYS.TRADITIONAL;
  const definitionId = await lookupDefinitionId(db, pathway);
  if (!definitionId) {
    console.warn(`[workflowMirror] no workflow_definition for pathway=${pathway} — seed not run yet?`);
    return null;
  }

  const existing = await firstRow<{ id: number; workflow_definition_id: number }>(db, sql`
    SELECT id, workflow_definition_id FROM workflow_tickets
    WHERE entity_type = 'prospect_application' AND entity_id = ${app.id}
    LIMIT 1
  `);

  let ticketId: number;
  if (existing) {
    ticketId = existing.id;
    if (existing.workflow_definition_id !== definitionId) {
      // Pathway changed → relink ticket to the new definition. We don't
      // delete prior stages (they're audit history) but we do clear
      // current_stage_id so a fresh stage row gets created on the next
      // phase result.
      await db.execute(sql`
        UPDATE workflow_tickets SET
          workflow_definition_id = ${definitionId},
          current_stage_id = NULL,
          updated_at = NOW()
        WHERE id = ${ticketId}
      `);
    }
  } else {
    // ticket_number is varchar(50) NOT NULL with no default. Deterministic
    // shape so re-runs against the same app produce the same number, and
    // a UNIQUE-style human read for the Worklist.
    const ticketNumber = `UW-${String(app.id).padStart(6, "0")}`;
    const initialStatus = app.status === "draft" ? "submitted" : (app.status ?? "submitted");
    const inserted = await firstRow<{ id: number }>(db, sql`
      INSERT INTO workflow_tickets
        (ticket_number, workflow_definition_id, entity_type, entity_id, status,
         priority, risk_level, risk_score, assigned_to_id, submitted_at, metadata)
      VALUES
        (${ticketNumber}, ${definitionId}, 'prospect_application', ${app.id}, ${initialStatus},
         'normal', ${app.riskTier ?? null}, ${app.riskScore ?? null},
         ${app.assignedReviewerId ?? null},
         ${app.submittedAt ?? new Date()},
         ${JSON.stringify({ pathway, source: "underwriting_mirror" })}::jsonb)
      RETURNING id
    `);
    if (!inserted) return null;
    ticketId = inserted.id;
  }

  // Pre-seed manual phases as pending stage rows so the Worklist shows
  // outstanding manual reviews even before the underwriter has acted.
  // Skip phases excluded for this pathway (e.g. PayFac skips manuals).
  const manualPhases = PHASES.filter(p => p.manual && !p.skipPaths.includes(pathway));
  for (const phase of manualPhases) {
    const stageId = await lookupStageId(db, definitionId, phase.key);
    if (!stageId) continue;
    const existingStage = await firstRow<{ id: number }>(db, sql`
      SELECT id FROM workflow_ticket_stages
      WHERE ticket_id = ${ticketId} AND stage_id = ${stageId} LIMIT 1
    `);
    if (existingStage) continue;
    await db.execute(sql`
      INSERT INTO workflow_ticket_stages
        (ticket_id, stage_id, status, created_at, updated_at)
      VALUES
        (${ticketId}, ${stageId}, 'pending', NOW(), NOW())
    `);
  }

  return { ticketId, definitionId };
}

// Upsert a single stage result on the ticket. Bumps execution_count and
// records the most recent run via last_executed_at/handler_response. Also
// nudges the parent ticket so the Worklist sees movement.
export async function upsertTicketStage(opts: {
  db: MirrorDB;
  ticketId: number;
  definitionId: number;
  phaseKey: string;
  result: PhaseResult;
  startedAt: Date;
  completedAt: Date;
  executedBy: string | null;
  externalResponse?: unknown;
}): Promise<void> {
  const { db, ticketId, definitionId, phaseKey, result, startedAt, completedAt, executedBy, externalResponse } = opts;
  const stageId = await lookupStageId(db, definitionId, phaseKey);
  if (!stageId) {
    console.warn(`[workflowMirror] no workflow_stages row for definition=${definitionId} phase=${phaseKey}`);
    return;
  }
  const mapped = mapStageStatus(result.status);
  const errorMessage = result.status === "fail" || result.status === "error"
    ? (result.findings.find(f => f.severity === "error" || f.severity === "critical")?.message ?? null)
    : null;
  const handlerPayload = JSON.stringify({
    score: result.score, findings: result.findings, externalResponse: externalResponse ?? null,
  });

  const existing = await firstRow<{ id: number; execution_count: number }>(db, sql`
    SELECT id, execution_count FROM workflow_ticket_stages
    WHERE ticket_id = ${ticketId} AND stage_id = ${stageId} LIMIT 1
  `);

  if (existing) {
    await db.execute(sql`
      UPDATE workflow_ticket_stages SET
        status = ${mapped.status},
        result = ${mapped.result},
        started_at = COALESCE(started_at, ${startedAt}),
        completed_at = ${completedAt},
        execution_count = ${existing.execution_count + 1},
        last_executed_at = NOW(),
        last_executed_by = ${executedBy ?? null},
        handler_response = ${handlerPayload}::jsonb,
        error_message = ${errorMessage},
        updated_at = NOW()
      WHERE id = ${existing.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO workflow_ticket_stages
        (ticket_id, stage_id, status, result, started_at, completed_at,
         execution_count, last_executed_at, last_executed_by,
         handler_response, error_message, created_at, updated_at)
      VALUES
        (${ticketId}, ${stageId}, ${mapped.status}, ${mapped.result},
         ${startedAt}, ${completedAt}, 1, NOW(), ${executedBy ?? null},
         ${handlerPayload}::jsonb, ${errorMessage}, NOW(), NOW())
    `);
  }

  // Nudge parent ticket: started_at on first stage, current_stage_id on
  // active progress, and bump updated_at so live filters refresh.
  await db.execute(sql`
    UPDATE workflow_tickets SET
      started_at = COALESCE(started_at, ${startedAt}),
      current_stage_id = ${stageId},
      status = CASE WHEN status = 'submitted' THEN 'in_progress' ELSE status END,
      updated_at = NOW()
    WHERE id = ${ticketId}
  `);
}

// Mark the parent ticket completed/failed at end of pipeline. Does NOT
// touch the underwriting domain's own status (that's driven by the
// transition matrix in server/underwriting/routes.ts).
export async function markTicketPipelineFinished(opts: {
  db: MirrorDB;
  ticketId: number;
  haltedAtPhase: string | null;
  riskScore: number | null;
  riskTier: string | null;
}): Promise<void> {
  const { db, ticketId, haltedAtPhase, riskScore, riskTier } = opts;
  const newStatus = haltedAtPhase ? "blocked" : "in_progress";
  await db.execute(sql`
    UPDATE workflow_tickets SET
      status = CASE WHEN status IN ('approved','declined','withdrawn') THEN status ELSE ${newStatus} END,
      risk_score = ${riskScore},
      risk_level = ${riskTier},
      updated_at = NOW()
    WHERE id = ${ticketId}
  `);
}

// Task #29: Recompute the ticket's SLA deadline from
// `workflow_stages.timeout_minutes` for the current stage and propagate
// it to both `workflow_tickets.due_at` and the legacy
// `prospect_applications.sla_deadline` so existing SLA scans, badges,
// and emails keep working without changing their query shape.
//
// Rules:
//  - If pipeline is halted at a checkpoint, deadline is null (work is
//    blocked on a reviewer decision; SLA timer should not run).
//  - If current_stage_id is null (no active stage), deadline is null.
//  - If the stage has no timeout_minutes configured, deadline is null.
//  - Otherwise deadline = (current_stage's started_at OR ticket.started_at
//    OR now) + timeout_minutes.
export async function refreshTicketSlaDeadline(opts: {
  db: MirrorDB;
  ticketId: number;
  applicationId: number;
}): Promise<{ deadline: Date | null }> {
  const { db, ticketId, applicationId } = opts;
  const row = await firstRow<{
    timeout_minutes: number | null;
    stage_started_at: Date | null;
    ticket_started_at: Date | null;
    halted_at: string | null;
    current_stage_id: number | null;
  }>(db, sql`
    SELECT ws.timeout_minutes,
           wts.started_at AS stage_started_at,
           wt.started_at AS ticket_started_at,
           pa.pipeline_halted_at_phase AS halted_at,
           wt.current_stage_id
    FROM workflow_tickets wt
    LEFT JOIN workflow_stages ws ON ws.id = wt.current_stage_id
    LEFT JOIN workflow_ticket_stages wts
      ON wts.ticket_id = wt.id AND wts.stage_id = wt.current_stage_id
    LEFT JOIN prospect_applications pa ON pa.id = wt.entity_id
    WHERE wt.id = ${ticketId}
    LIMIT 1
  `);
  let deadline: Date | null = null;
  if (row && !row.halted_at && row.current_stage_id && row.timeout_minutes) {
    const anchor = row.stage_started_at
      ? new Date(row.stage_started_at)
      : row.ticket_started_at
      ? new Date(row.ticket_started_at)
      : new Date();
    deadline = new Date(anchor.getTime() + row.timeout_minutes * 60_000);
  }
  await db.execute(sql`
    UPDATE workflow_tickets SET due_at = ${deadline}, updated_at = NOW() WHERE id = ${ticketId}
  `);
  await db.execute(sql`
    UPDATE prospect_applications SET sla_deadline = ${deadline}, updated_at = NOW() WHERE id = ${applicationId}
  `);
  return { deadline };
}

// Refresh SLA deadlines for every active underwriting ticket. Used by
// the SLA scan job so deadlines reflect the current workflow stage's
// timeout_minutes before breach detection runs.
export async function refreshAllOpenTicketSlaDeadlines(db: MirrorDB): Promise<{ refreshed: number }> {
  const r = (await db.execute(sql`
    SELECT wt.id AS ticket_id, wt.entity_id AS application_id
    FROM workflow_tickets wt
    JOIN prospect_applications pa ON pa.id = wt.entity_id
    WHERE wt.entity_type = 'prospect_application'
      AND pa.status IN ('SUB','CUW','P1','P2','P3')
      AND pa.archived_at IS NULL
  `)) as ExecResult<{ ticket_id: number; application_id: number }>;
  let refreshed = 0;
  for (const t of r.rows ?? []) {
    try {
      await refreshTicketSlaDeadline({ db, ticketId: t.ticket_id, applicationId: t.application_id });
      refreshed += 1;
    } catch (e) {
      console.error(`[workflowMirror] refreshTicketSlaDeadline failed for ticket=${t.ticket_id}:`, e);
    }
  }
  return { refreshed };
}

// Helper used by routes to find the application backing a ticket stage,
// when dispatching manual approvals back into the underwriting domain.
export async function loadTicketContext(
  db: MirrorDB, ticketStageId: number,
): Promise<{
  ticketId: number;
  applicationId: number;
  pathway: Pathway;
  stageCode: string;
  handlerKey: string | null;
  stageType: "automated" | "manual";
} | null> {
  const row = await firstRow<{
    ticket_id: number;
    entity_id: number;
    entity_type: string;
    pathway: string | null;
    stage_code: string;
    handler_key: string | null;
    stage_type: string;
  }>(db, sql`
    SELECT wt.id AS ticket_id, wt.entity_id, wt.entity_type,
           pa.pathway,
           ws.code AS stage_code, ws.handler_key, ws.stage_type
    FROM workflow_ticket_stages wts
    JOIN workflow_tickets wt ON wt.id = wts.ticket_id
    JOIN workflow_stages ws ON ws.id = wts.stage_id
    LEFT JOIN prospect_applications pa ON pa.id = wt.entity_id AND wt.entity_type = 'prospect_application'
    WHERE wts.id = ${ticketStageId}
    LIMIT 1
  `);
  if (!row || row.entity_type !== "prospect_application") return null;
  return {
    ticketId: row.ticket_id,
    applicationId: row.entity_id,
    pathway: (row.pathway as Pathway) || PATHWAYS.TRADITIONAL,
    stageCode: row.stage_code,
    handlerKey: row.handler_key,
    stageType: (row.stage_type as "automated" | "manual"),
  };
}
