// Task #27 — Seed the underwriting pipeline as Workflow Definitions so it
// becomes visible/editable in the Workflows admin UI without changing
// runtime behavior. The orchestrator (server/underwriting/orchestrator.ts)
// continues to drive execution off the hardcoded PHASES constant in
// shared/underwriting.ts; this script just mirrors that catalogue as data
// in workflow_definitions / workflow_stages / stage_api_configs and
// workflow_endpoints so the Workflows admin surface lights up.
//
// Idempotent: safe to run on every server boot. Looks up by `code` (defs)
// and (workflow_definition_id, code) (stages) before deciding insert vs
// update; preserves any admin-customized URL/auth on stage_api_configs
// and workflow_endpoints.
//
// All DB access is via typed Drizzle (no raw SQL). The `code` columns are
// not declared UNIQUE in shared/schema.ts, so we use SELECT-then-INSERT/
// UPDATE rather than .onConflictDoUpdate() — both patterns stay through
// the per-request DynamicDB Proxy and remain env-isolated.

import { eq, and } from "drizzle-orm";
import {
  db as defaultDb,
} from "../db";
import {
  workflowDefinitions,
  workflowStages,
  stageApiConfigs,
  workflowEndpoints,
} from "@shared/schema";
import {
  PHASES,
  PATHWAYS,
  APP_STATUS,
  PAYFAC_SLA_HOURS,
  type Pathway,
} from "@shared/underwriting";

// Two definitions — one per pathway — matching the orchestrator's runtime
// branching. Codes are stable identifiers used by external tooling and the
// Workflows admin URL slugs.
const DEFINITIONS: Array<{
  code: string;
  name: string;
  description: string;
  pathway: Pathway;
}> = [
  {
    code: "merchant_underwriting_traditional_v1",
    name: "Merchant Underwriting — Traditional",
    description:
      "Traditional acquirer underwriting pipeline: 10 automated phases plus Derogatory and G2 manual reviews. Mirrors the PHASES catalogue in shared/underwriting.ts and is driven by server/underwriting/orchestrator.ts.",
    pathway: PATHWAYS.TRADITIONAL,
  },
  {
    code: "merchant_underwriting_payfac_v1",
    name: "Merchant Underwriting — PayFac",
    description:
      "PayFac underwriting pipeline: same checkpoint structure as traditional but skips Volume Threshold and Credit Check; 48h final-review SLA after a clean run.",
    pathway: PATHWAYS.PAYFAC,
  },
];

// Final statuses for the prospect_application state machine. Stored on
// workflow_definitions.final_statuses (text[]) so the Workflows admin
// knows which statuses are terminal.
const FINAL_STATUSES: string[] = [
  APP_STATUS.APPROVED,
  APP_STATUS.D1, APP_STATUS.D2, APP_STATUS.D3, APP_STATUS.D4,
  APP_STATUS.W1, APP_STATUS.W2, APP_STATUS.W3,
];

// Per-phase default SLA in minutes. Pulled from values currently encoded
// around the orchestrator: external/API phases get a 24h soft cap, manual
// phases get the PayFac 48h SLA, instant local checks get 5 min. These
// are metadata only — the orchestrator does not honor them at runtime yet.
function timeoutMinutesFor(phaseKey: string, manual: boolean): number {
  if (manual) return PAYFAC_SLA_HOURS * 60;
  if (phaseKey === "mcc_validation" || phaseKey === "volume_threshold") return 5;
  return 24 * 60;
}

interface SeededStage {
  code: string;
  name: string;
  description: string;
  orderIndex: number;
  stageType: "automated" | "manual";
  handlerKey: string;
  requiresReview: boolean;
  autoAdvance: boolean;
  isRequired: boolean;
  timeoutMinutes: number;
  endpointName: string | null;
  configuration: Record<string, unknown>;
}

function buildStages(pathway: Pathway): SeededStage[] {
  return PHASES
    .filter((ph) => !ph.skipPaths.includes(pathway))
    .map((ph): SeededStage => ({
      code: ph.key,
      name: ph.label,
      description: ph.description,
      orderIndex: ph.order,
      stageType: ph.manual ? "manual" : "automated",
      handlerKey: ph.key, // matches the orchestrator's runtime dispatch key
      requiresReview: !!ph.manual,
      autoAdvance: !ph.manual,
      isRequired: true,
      timeoutMinutes: timeoutMinutesFor(ph.key, !!ph.manual),
      endpointName: ph.endpointName,
      configuration: { weight: ph.weight, checkpoint: ph.checkpoint },
    }));
}

type DbLike = typeof defaultDb;

export async function seedUnderwritingWorkflows(db: DbLike = defaultDb): Promise<{
  upsertedDefinitions: number;
  upsertedStages: number;
  upsertedEndpoints: number;
}> {
  let upsertedDefinitions = 0;
  let upsertedStages = 0;
  let upsertedEndpoints = 0;

  for (const def of DEFINITIONS) {
    const stages = buildStages(def.pathway);
    const configuration = {
      pathway: def.pathway,
      slaHours: def.pathway === PATHWAYS.PAYFAC ? PAYFAC_SLA_HOURS : null,
      seededFromOrchestrator: true,
    };

    // ── Upsert workflow_definitions by code ─────────────────────────────
    const existing = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.code, def.code))
      .limit(1);

    let workflowId: number;
    const defValues = {
      name: def.name,
      description: def.description,
      version: "1.0",
      category: "underwriting",
      entityType: "prospect_application",
      initialStatus: APP_STATUS.SUB,
      finalStatuses: FINAL_STATUSES,
      configuration,
      isActive: true,
    } as const;

    if (existing[0]) {
      workflowId = existing[0].id;
      await db
        .update(workflowDefinitions)
        .set({ ...defValues, updatedAt: new Date() })
        .where(eq(workflowDefinitions.id, workflowId));
    } else {
      const inserted = await db
        .insert(workflowDefinitions)
        .values({ code: def.code, ...defValues })
        .returning({ id: workflowDefinitions.id });
      workflowId = inserted[0].id;
    }
    upsertedDefinitions++;

    // ── Upsert workflow_stages by (workflow_definition_id, code) ───────
    for (const stage of stages) {
      const existingStage = await db
        .select({ id: workflowStages.id })
        .from(workflowStages)
        .where(
          and(
            eq(workflowStages.workflowDefinitionId, workflowId),
            eq(workflowStages.code, stage.code),
          ),
        )
        .limit(1);

      let stageId: number;
      const stageValues = {
        name: stage.name,
        description: stage.description,
        orderIndex: stage.orderIndex,
        stageType: stage.stageType,
        handlerKey: stage.handlerKey,
        isRequired: stage.isRequired,
        requiresReview: stage.requiresReview,
        autoAdvance: stage.autoAdvance,
        timeoutMinutes: stage.timeoutMinutes,
        configuration: stage.configuration,
        isActive: true,
      } as const;

      if (existingStage[0]) {
        stageId = existingStage[0].id;
        await db
          .update(workflowStages)
          .set({ ...stageValues, updatedAt: new Date() })
          .where(eq(workflowStages.id, stageId));
      } else {
        const insertedStage = await db
          .insert(workflowStages)
          .values({
            workflowDefinitionId: workflowId,
            code: stage.code,
            ...stageValues,
          })
          .returning({ id: workflowStages.id });
        stageId = insertedStage[0].id;
      }
      upsertedStages++;

      // ── stage_api_configs (1:1 with stage; UNIQUE on stage_id) ───────
      // Only create when there's an external endpoint; preserves admin
      // edits to URL/auth by skipping update if a row already exists.
      if (stage.endpointName) {
        const existingCfg = await db
          .select({ id: stageApiConfigs.id })
          .from(stageApiConfigs)
          .where(eq(stageApiConfigs.stageId, stageId))
          .limit(1);
        if (!existingCfg[0]) {
          await db.insert(stageApiConfigs).values({
            stageId,
            endpointUrl: `https://example.invalid/${stage.endpointName}`,
            httpMethod: "POST",
            authType: "none",
            isActive: false,
            fallbackOnError: "pending_review",
            fallbackOnTimeout: "pending_review",
          });
        }
      }
    }

    // ── workflow_endpoints (legacy/parallel registry the orchestrator
    // looks up by name today). Keep one row per external phase, scoped
    // to this workflow definition so the Workflows admin shows the
    // mapping. Preserve admin-edited URL/auth.
    for (const stage of stages) {
      if (!stage.endpointName) continue;
      const existingEp = await db
        .select({ id: workflowEndpoints.id })
        .from(workflowEndpoints)
        .where(
          and(
            eq(workflowEndpoints.workflowId, workflowId),
            eq(workflowEndpoints.name, stage.endpointName),
          ),
        )
        .limit(1);
      if (existingEp[0]) continue;
      await db.insert(workflowEndpoints).values({
        workflowId,
        name: stage.endpointName,
        url: `https://example.invalid/${stage.endpointName}`,
        method: "POST",
        headers: {},
        authType: "none",
        authConfig: {},
        isActive: false,
      });
      upsertedEndpoints++;
    }
  }

  return { upsertedDefinitions, upsertedStages, upsertedEndpoints };
}
