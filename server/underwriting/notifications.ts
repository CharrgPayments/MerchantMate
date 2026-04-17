import { eq } from "drizzle-orm";
import { userAlerts, users, prospectApplications } from "@shared/schema";
import { ROLE_CODES } from "@shared/permissions";
import { APP_STATUS, STATUS_FAMILY, STATUS_LABEL, type AppStatus } from "@shared/underwriting";
import type { getDynamicDatabase } from "../db";

type DB = ReturnType<typeof getDynamicDatabase>;
type UserRow = { id: string; role?: string | null; roles?: string[] | null };

export async function alertRoles(db: DB, roleCodes: string[], message: string, actionUrl?: string, type: "info" | "warning" | "error" | "success" = "info") {
  try {
    const all = await db.select().from(users);
    const targets = (all as unknown as UserRow[]).filter((u) => {
      const arr = Array.isArray(u.roles) ? u.roles : [];
      return (u.role && roleCodes.includes(u.role)) || arr.some((r) => roleCodes.includes(r));
    });
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

export async function notifyTransition(db: DB, applicationId: number, toStatus: string) {
  const url = `/underwriting-review/${applicationId}`;
  const family = STATUS_FAMILY[toStatus as AppStatus];
  const label = STATUS_LABEL[toStatus as AppStatus] || toStatus;

  if (family === "approved" || family === "declined") {
    const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
    if (app?.assignedReviewerId) {
      await alertUser(db, app.assignedReviewerId, `Application #${applicationId} ${label}`, url,
        family === "approved" ? "success" : "warning");
    }
  }
  // Pending statuses → alert ops/agent depending on which pending.
  if (toStatus === APP_STATUS.P1) {
    await alertRoles(db, [ROLE_CODES.AGENT, ROLE_CODES.DATA_PROCESSING],
      `Application #${applicationId} requires additional information (P1)`, url, "warning");
  }
  if (toStatus === APP_STATUS.P2) {
    await alertRoles(db, [ROLE_CODES.UNDERWRITER],
      `Application #${applicationId} awaiting external response (P2)`, url, "info");
  }
  if (toStatus === APP_STATUS.P3) {
    await alertRoles(db, [ROLE_CODES.SENIOR_UNDERWRITER],
      `Application #${applicationId} escalated for senior review (P3)`, url, "warning");
  }
}
