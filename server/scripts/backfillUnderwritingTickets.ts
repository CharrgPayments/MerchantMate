// Task #28 — Backfill workflow_tickets and workflow_ticket_stages for all
// existing prospect_applications and their phase results, so historical
// underwriting work shows up in the unified Worklist UI.
//
// Idempotent: safe to run on every server boot. ensureTicket() upserts
// the ticket; for each phase result we look up the matching workflow
// stage and upsert a ticket-stage row carrying the same status/result.
// Any mirroring failure for a single application is logged and skipped
// so a bad row never aborts the rest of the backfill.

import { db } from "../db";
import { prospectApplications, underwritingPhaseResults, underwritingRuns } from "@shared/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";
import type { PhaseResult } from "@shared/underwriting";
import { ensureTicket, upsertTicketStage } from "../underwriting/workflowMirror";

export async function backfillUnderwritingTickets(): Promise<{
  applicationsScanned: number;
  ticketsEnsured: number;
  stagesUpserted: number;
  failures: number;
}> {
  let applicationsScanned = 0;
  let ticketsEnsured = 0;
  let stagesUpserted = 0;
  let failures = 0;

  const apps = await db.select().from(prospectApplications);
  applicationsScanned = apps.length;
  if (apps.length === 0) {
    return { applicationsScanned, ticketsEnsured, stagesUpserted, failures };
  }

  // Fetch all underwriting runs for these apps in one query so we can
  // group phase results without N+1 lookups.
  const appIds = apps.map(a => a.id);
  const runs = appIds.length
    ? await db.select().from(underwritingRuns).where(inArray(underwritingRuns.applicationId, appIds))
    : [];
  const runIdToAppId = new Map<number, number>(runs.map(r => [r.id, r.applicationId]));
  const runIds = runs.map(r => r.id);
  const phaseResults = runIds.length
    ? await db.select().from(underwritingPhaseResults)
        .where(inArray(underwritingPhaseResults.runId, runIds))
        .orderBy(asc(underwritingPhaseResults.startedAt))
    : [];

  // Group phase results by applicationId, keeping only the most recent
  // result per (app, phase_key) so re-runs collapse to current state —
  // matches the orchestrator's "upsert latest" semantics.
  const latestByAppPhase = new Map<string, typeof phaseResults[number]>();
  for (const pr of phaseResults) {
    const appId = runIdToAppId.get(pr.runId);
    if (!appId) continue;
    const key = `${appId}::${pr.phaseKey}`;
    const prev = latestByAppPhase.get(key);
    if (!prev || (pr.completedAt ?? pr.startedAt) > (prev.completedAt ?? prev.startedAt)) {
      latestByAppPhase.set(key, pr);
    }
  }

  for (const app of apps) {
    try {
      const ticket = await ensureTicket(db as unknown as Parameters<typeof ensureTicket>[0], app);
      if (!ticket) continue;
      ticketsEnsured++;

      // Upsert each known phase result for this app onto its ticket.
      for (const [key, pr] of Array.from(latestByAppPhase.entries())) {
        if (!key.startsWith(`${app.id}::`)) continue;
        const phaseResult: PhaseResult = {
          status: pr.status as PhaseResult["status"],
          score: pr.score ?? 0,
          findings: Array.isArray(pr.findings) ? (pr.findings as PhaseResult["findings"]) : [],
        };
        await upsertTicketStage({
          db: db as unknown as Parameters<typeof upsertTicketStage>[0]["db"],
          ticketId: ticket.ticketId,
          definitionId: ticket.definitionId,
          phaseKey: pr.phaseKey,
          result: phaseResult,
          startedAt: pr.startedAt,
          completedAt: pr.completedAt ?? pr.startedAt,
          executedBy: null,
          externalResponse: pr.externalResponse,
        });
        stagesUpserted++;
      }
    } catch (err) {
      failures++;
      console.error(`[backfill] application ${app.id} failed:`, err);
    }
  }

  return { applicationsScanned, ticketsEnsured, stagesUpserted, failures };
}
