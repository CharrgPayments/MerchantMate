import type { Express, Request, Response } from "express";
import {
  generatePlan,
  getPlan,
  applyPlan,
  rollback,
  listSnapshots,
  listCertifications,
  isPlanCertified,
  planSha,
  type Env,
  type ApplyEvent,
} from "../schemaSync";
import { auditService } from "../auditService";

const VALID_ENVS: Env[] = ["development", "test", "production"];

function isValidEnv(s: any): s is Env {
  return typeof s === "string" && VALID_ENVS.includes(s as Env);
}

export function registerSchemaSyncRoutes(app: Express, requirePerm: any) {
  // POST /api/admin/schema-sync/plan
  app.post(
    "/api/admin/schema-sync/plan",
    requirePerm("system:superadmin"),
    async (req: Request, res: Response) => {
      try {
        const { targetEnv, renameAnswers } = req.body ?? {};
        if (!isValidEnv(targetEnv)) {
          return res
            .status(400)
            .json({ success: false, message: "targetEnv must be development|test|production" });
        }
        const plan = await generatePlan(
          targetEnv,
          Array.isArray(renameAnswers) ? renameAnswers.map((n: any) => Number(n) || 0) : [],
        );
        const cert = isPlanCertified(plan);
        res.json({
          success: true,
          plan: {
            ...plan,
            sha: planSha(plan),
            certifiedFromTest: cert.certified,
            certification: cert.record ?? null,
          },
        });
      } catch (e: any) {
        console.error("[schema-sync] plan error:", e);
        res.status(500).json({ success: false, message: e?.message ?? String(e) });
      }
    },
  );

  // GET /api/admin/schema-sync/plan/:planId — refetch a cached plan
  app.get(
    "/api/admin/schema-sync/plan/:planId",
    requirePerm("system:superadmin"),
    async (req: Request, res: Response) => {
      const plan = getPlan(req.params.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan expired or not found" });
      res.json({ success: true, plan });
    },
  );

  // POST /api/admin/schema-sync/apply  (returns SSE stream)
  app.post(
    "/api/admin/schema-sync/apply",
    requirePerm("system:superadmin"),
    async (req: Request, res: Response) => {
      const { planId, confirmProd } = req.body ?? {};
      const plan = getPlan(planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan expired or not found" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const send = (e: ApplyEvent) => {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      };

      try {
        const userId = (req.session as any)?.userId;
        const result = await applyPlan(
          plan,
          { confirmProd: !!confirmProd, userId },
          send,
        );
        send({ type: "done", ok: result.success, message: JSON.stringify(result) });

        try {
          await auditService.logAction(
            "schema_sync_apply",
            "schema-sync",
            { userId: (req.session as any)?.userId },
            {
              resourceId: plan.planId,
              riskLevel: plan.targetEnv === "production" ? "critical" : "high",
              notes: result.success
                ? `Applied ${result.appliedCount}/${plan.statements.length} to ${plan.targetEnv}`
                : `FAILED at stmt ${result.failedAt}: ${result.error}`,
              tags: { targetEnv: plan.targetEnv, snapshotFile: result.snapshotFile },
            },
          );
        } catch {}
      } catch (e: any) {
        send({ type: "error", error: e?.message ?? String(e) });
      } finally {
        res.end();
      }
    },
  );

  // POST /api/admin/schema-sync/rollback (SSE)
  app.post(
    "/api/admin/schema-sync/rollback",
    requirePerm("system:superadmin"),
    async (req: Request, res: Response) => {
      const { targetEnv, snapshotFile } = req.body ?? {};
      if (!isValidEnv(targetEnv)) {
        return res.status(400).json({ success: false, message: "targetEnv invalid" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const send = (e: ApplyEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      try {
        const result = await rollback(targetEnv, snapshotFile, send);
        send({ type: "done", ok: result.success, message: JSON.stringify(result) });

        try {
          await auditService.logAction(
            "schema_sync_rollback",
            "schema-sync",
            { userId: (req.session as any)?.userId },
            {
              resourceId: snapshotFile ?? "latest",
              riskLevel: targetEnv === "production" ? "critical" : "high",
              notes: result.success
                ? `Rolled back ${result.appliedCount} change(s) on ${targetEnv}`
                : `Rollback FAILED: ${result.error}`,
              tags: { targetEnv, snapshotFile: result.snapshotFile },
            },
          );
        } catch {}
      } catch (e: any) {
        send({ type: "error", error: e?.message ?? String(e) });
      } finally {
        res.end();
      }
    },
  );

  // GET /api/admin/schema-sync/certifications
  app.get(
    "/api/admin/schema-sync/certifications",
    requirePerm("system:superadmin"),
    async (_req: Request, res: Response) => {
      res.json({ success: true, certifications: listCertifications() });
    },
  );

  // GET /api/admin/schema-sync/snapshots?env=development
  app.get(
    "/api/admin/schema-sync/snapshots",
    requirePerm("system:superadmin"),
    async (req: Request, res: Response) => {
      const env = req.query.env as Env | undefined;
      const snaps = listSnapshots(env && isValidEnv(env) ? env : undefined);
      res.json({ success: true, snapshots: snaps });
    },
  );
}
