// Task #27 — Seed the underwriting pipeline as Workflow Definitions so it
// becomes visible/editable in the Workflows admin UI without changing
// runtime behavior. The orchestrator (server/underwriting/orchestrator.ts)
// continues to drive execution off the hardcoded PHASES constant in
// shared/underwriting.ts; this script just mirrors that catalogue as data
// in workflow_definitions / workflow_stages / stage_api_configs and
// workflow_endpoints so the Workflows admin surface lights up.
//
// IMPORTANT: the production schema for these tables differs from
// shared/schema.ts (the Drizzle definitions are stale/alternate). The
// real columns — code, version, category, entity_type, initial_status,
// final_statuses, configuration on workflow_definitions; full
// workflow_stages and stage_api_configs tables — are what the Workflows
// admin actually reads. Existing routes (server/routes.ts) already use
// raw SQL against these tables, so this seed follows the same pattern.
//
// Idempotent: safe to run on every server boot. Looks up by `code` (defs)
// and (workflow_definition_id, code) (stages) before deciding insert vs
// update; preserves any admin-customized URL/auth on stage_api_configs
// and workflow_endpoints.

import { sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import { PHASES, PATHWAYS, APP_STATUS, PAYFAC_SLA_HOURS, type Pathway } from "@shared/underwriting";

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
const FINAL_STATUSES = [
  APP_STATUS.APPROVED,
  APP_STATUS.D1, APP_STATUS.D2, APP_STATUS.D3, APP_STATUS.D4,
  APP_STATUS.W1, APP_STATUS.W2, APP_STATUS.W3,
];

// Build a Postgres `ARRAY['a','b',...]::text[]` literal as a SQL fragment.
// drizzle's default array binding gets serialized as a record (which can't
// be cast to text[]) by the neon driver, so we inline the values. All
// inputs here come from the APP_STATUS constant so there's no injection
// surface, but we still escape single quotes defensively.
function textArrayLiteral(values: readonly string[]) {
  const escaped = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
  return sql.raw(`ARRAY[${escaped}]::text[]`);
}

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
    const existing = await db.execute(sql`
      SELECT id FROM workflow_definitions WHERE code = ${def.code} LIMIT 1
    `);
    let workflowId: number;
    const existingRow = (existing as { rows?: Array<{ id: number }> }).rows?.[0];
    if (existingRow) {
      workflowId = existingRow.id;
      await db.execute(sql`
        UPDATE workflow_definitions SET
          name = ${def.name},
          description = ${def.description},
          version = '1.0',
          category = 'underwriting',
          entity_type = 'prospect_application',
          initial_status = ${APP_STATUS.SUB},
          final_statuses = ${textArrayLiteral(FINAL_STATUSES)},
          configuration = ${JSON.stringify(configuration)}::jsonb,
          is_active = true,
          updated_at = now()
        WHERE id = ${workflowId}
      `);
    } else {
      const inserted = await db.execute(sql`
        INSERT INTO workflow_definitions
          (code, name, description, version, category, entity_type, initial_status, final_statuses, configuration, is_active)
        VALUES
          (${def.code}, ${def.name}, ${def.description}, '1.0', 'underwriting',
           'prospect_application', ${APP_STATUS.SUB}, ${textArrayLiteral(FINAL_STATUSES)},
           ${JSON.stringify(configuration)}::jsonb, true)
        RETURNING id
      `);
      workflowId = (inserted as { rows: Array<{ id: number }> }).rows[0].id;
    }
    upsertedDefinitions++;

    // ── Upsert workflow_stages by (workflow_definition_id, code) ───────
    for (const stage of stages) {
      const existingStage = await db.execute(sql`
        SELECT id FROM workflow_stages
        WHERE workflow_definition_id = ${workflowId} AND code = ${stage.code}
        LIMIT 1
      `);
      let stageId: number;
      const stageRow = (existingStage as { rows?: Array<{ id: number }> }).rows?.[0];
      if (stageRow) {
        stageId = stageRow.id;
        await db.execute(sql`
          UPDATE workflow_stages SET
            name = ${stage.name},
            description = ${stage.description},
            order_index = ${stage.orderIndex},
            stage_type = ${stage.stageType},
            handler_key = ${stage.handlerKey},
            is_required = ${stage.isRequired},
            requires_review = ${stage.requiresReview},
            auto_advance = ${stage.autoAdvance},
            timeout_minutes = ${stage.timeoutMinutes},
            configuration = ${JSON.stringify(stage.configuration)}::jsonb,
            is_active = true,
            updated_at = now()
          WHERE id = ${stageId}
        `);
      } else {
        const insertedStage = await db.execute(sql`
          INSERT INTO workflow_stages
            (workflow_definition_id, code, name, description, order_index,
             stage_type, handler_key, is_required, requires_review,
             auto_advance, timeout_minutes, configuration, is_active)
          VALUES
            (${workflowId}, ${stage.code}, ${stage.name}, ${stage.description}, ${stage.orderIndex},
             ${stage.stageType}, ${stage.handlerKey}, ${stage.isRequired}, ${stage.requiresReview},
             ${stage.autoAdvance}, ${stage.timeoutMinutes},
             ${JSON.stringify(stage.configuration)}::jsonb, true)
          RETURNING id
        `);
        stageId = (insertedStage as { rows: Array<{ id: number }> }).rows[0].id;
      }
      upsertedStages++;

      // ── stage_api_configs (1:1 with stage; UNIQUE on stage_id) ───────
      // Only create when there's an external endpoint; preserves admin
      // edits to URL/auth by skipping update if a row already exists.
      if (stage.endpointName) {
        const existingCfg = await db.execute(sql`
          SELECT id FROM stage_api_configs WHERE stage_id = ${stageId} LIMIT 1
        `);
        const cfgRow = (existingCfg as { rows?: Array<{ id: number }> }).rows?.[0];
        if (!cfgRow) {
          await db.execute(sql`
            INSERT INTO stage_api_configs
              (stage_id, endpoint_url, http_method, auth_type, is_active, fallback_on_error, fallback_on_timeout)
            VALUES
              (${stageId}, ${`https://example.invalid/${stage.endpointName}`}, 'POST', 'none',
               false, 'pending_review', 'pending_review')
          `);
        }
      }
    }

    // ── workflow_endpoints (legacy/parallel registry the orchestrator
    // looks up by name today). Keep one row per external phase, scoped
    // to this workflow definition so the Workflows admin shows the
    // mapping. Preserve admin-edited URL/auth.
    for (const stage of stages) {
      if (!stage.endpointName) continue;
      const existingEp = await db.execute(sql`
        SELECT id FROM workflow_endpoints
        WHERE workflow_id = ${workflowId} AND name = ${stage.endpointName}
        LIMIT 1
      `);
      const epRow = (existingEp as { rows?: Array<{ id: number }> }).rows?.[0];
      if (epRow) continue;
      await db.execute(sql`
        INSERT INTO workflow_endpoints
          (workflow_id, name, url, method, headers, auth_type, auth_config, is_active)
        VALUES
          (${workflowId}, ${stage.endpointName},
           ${`https://example.invalid/${stage.endpointName}`}, 'POST',
           '{}'::jsonb, 'none', '{}'::jsonb, false)
      `);
      upsertedEndpoints++;
    }
  }

  return { upsertedDefinitions, upsertedStages, upsertedEndpoints };
}
