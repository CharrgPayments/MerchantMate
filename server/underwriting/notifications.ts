import { eq } from "drizzle-orm";
import { userAlerts, users, prospectApplications, merchantProspects, agents } from "@shared/schema";
import { ROLE_CODES } from "@shared/permissions";
import { APP_STATUS, STATUS_FAMILY, STATUS_LABEL, type AppStatus } from "@shared/underwriting";
import { emailService } from "../emailService";
import type { getDynamicDatabase } from "../db";

type DB = ReturnType<typeof getDynamicDatabase>;
type UserRow = { id: string; email?: string | null; firstName?: string | null; role?: string | null; roles?: string[] | null };

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "";

async function targetsForRoles(db: DB, roleCodes: string[]): Promise<UserRow[]> {
  const all = (await db.select().from(users)) as unknown as UserRow[];
  return all.filter((u) => {
    const arr = Array.isArray(u.roles) ? u.roles : [];
    return (u.role && roleCodes.includes(u.role)) || arr.some((r) => roleCodes.includes(r));
  });
}

export async function alertRoles(db: DB, roleCodes: string[], message: string, actionUrl?: string, type: "info" | "warning" | "error" | "success" = "info") {
  try {
    const targets = await targetsForRoles(db, roleCodes);
    if (!targets.length) return;
    await db.insert(userAlerts).values(
      targets.map((u) => ({ userId: u.id, message, type, actionUrl: actionUrl ?? null })),
    );
  } catch (e) {
    console.error("alertRoles failed:", e);
  }
}

export async function alertUser(db: DB, userId: string, message: string, actionUrl?: string, type: "info" | "warning" | "error" | "success" = "info") {
  try {
    await db.insert(userAlerts).values({ userId, message, type, actionUrl: actionUrl ?? null });
  } catch (e) {
    console.error("alertUser failed:", e);
  }
}

export async function notifyRunCompleted(db: DB, applicationId: number, score: number, tier: string) {
  const url = `/underwriting-review/${applicationId}`;
  await alertRoles(db, [ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
    `Underwriting run completed for application #${applicationId} — score ${score} (${tier})`,
    url, tier === "high" ? "warning" : "info");
}

// Per-status routing matrix: which role codes get an in-app alert + email.
const STATUS_ROLE_ROUTING: Partial<Record<AppStatus, string[]>> = {
  [APP_STATUS.SUB]: [ROLE_CODES.UNDERWRITER, ROLE_CODES.DATA_PROCESSING],
  [APP_STATUS.CUW]: [ROLE_CODES.UNDERWRITER, ROLE_CODES.DATA_PROCESSING],
  [APP_STATUS.P1]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.DATA_PROCESSING],
  [APP_STATUS.P2]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER],
  [APP_STATUS.P3]: [ROLE_CODES.AGENT, ROLE_CODES.SENIOR_UNDERWRITER, ROLE_CODES.UNDERWRITER],
  [APP_STATUS.W1]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER],
  [APP_STATUS.W2]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER],
  [APP_STATUS.W3]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
  [APP_STATUS.D1]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
  [APP_STATUS.D2]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
  [APP_STATUS.D3]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
  [APP_STATUS.D4]: [ROLE_CODES.AGENT, ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
  [APP_STATUS.APPROVED]: [
    ROLE_CODES.AGENT, ROLE_CODES.DEPLOYMENT, ROLE_CODES.SENIOR_UNDERWRITER,
    ROLE_CODES.UNDERWRITER, ROLE_CODES.DATA_PROCESSING,
  ],
};

export async function notifyTransition(db: DB, applicationId: number, toStatus: string, opts: { fromStatus?: string | null; reason?: string } = {}) {
  const status = toStatus as AppStatus;
  const family = STATUS_FAMILY[status];
  const label = STATUS_LABEL[status] || toStatus;
  const url = `/underwriting-review/${applicationId}`;
  const fullUrl = APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, "")}${url}` : url;

  const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
  const [prospect] = app ? await db.select().from(merchantProspects).where(eq(merchantProspects.id, app.prospectId)).limit(1) : [undefined];

  const alertType: "info" | "warning" | "error" | "success" =
    family === "approved" ? "success"
    : family === "declined" ? "warning"
    : family === "pending" ? "warning"
    : "info";

  const message = `Application #${applicationId} → ${toStatus} · ${label}`;
  const emailPayload = {
    applicationId, fromStatus: opts.fromStatus ?? null, toStatus, statusLabel: label,
    reason: opts.reason, reviewUrl: fullUrl,
  };

  if (app?.assignedReviewerId) {
    await alertUser(db, app.assignedReviewerId, message, url, alertType);
  }

  const fullRoleCodes = STATUS_ROLE_ROUTING[status] || [];
  const internalRoles = fullRoleCodes.filter((r) => r !== ROLE_CODES.AGENT);
  const includesAgent = fullRoleCodes.includes(ROLE_CODES.AGENT);

  if (internalRoles.length) {
    await alertRoles(db, internalRoles, message, url, alertType);
    try {
      const targets = await targetsForRoles(db, internalRoles);
      await Promise.all(targets.filter((u) => u.email).map((u) =>
        emailService.sendUnderwritingTransitionEmail({
          to: u.email!, firstName: u.firstName ?? undefined, ...emailPayload,
        }),
      ));
    } catch (e) { console.error("transition email fan-out failed:", e); }
  }

  // App-scoped agent notify (the prospect's owning agent only).
  if (includesAgent && prospect?.agentId) {
    try {
      const [agentRow] = await db.select().from(agents).where(eq(agents.id, prospect.agentId)).limit(1);
      if (agentRow?.userId) await alertUser(db, agentRow.userId, message, url, alertType);
      if (agentRow?.email) {
        await emailService.sendUnderwritingTransitionEmail({
          to: agentRow.email, firstName: agentRow.firstName ?? undefined, ...emailPayload,
        });
      }
    } catch (e) { console.error("agent transition notify failed:", e); }
  }

  // Email the merchant/prospect for any actionable family (pending/withdrawn/
  // approved/declined) — the merchant has visibility into all non-internal states.
  const merchantEmailFamilies = new Set(["pending", "withdrawn", "approved", "declined"]);
  if (merchantEmailFamilies.has(family) && prospect?.email) {
    try {
      await emailService.sendUnderwritingTransitionEmail({
        to: prospect.email, firstName: prospect.firstName ?? undefined, ...emailPayload,
      });
    } catch (e) { console.error("merchant transition email failed:", e); }
  }
}
