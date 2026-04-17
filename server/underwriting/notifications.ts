import { eq, and, inArray } from "drizzle-orm";
import { userAlerts, users, prospectApplications, merchantProspects } from "@shared/schema";
import { ROLE_CODES } from "@shared/permissions";
import type { getDynamicDatabase } from "../db";

type DB = ReturnType<typeof getDynamicDatabase>;

// Notify all users holding any of the given role codes (legacy `role` column or
// new `roles[]` array). Best-effort — never throws.
export async function alertRoles(db: DB, roleCodes: string[], message: string, actionUrl?: string, type: "info" | "warning" | "error" | "success" = "info") {
  try {
    const all = await db.select().from(users);
    const targets = all.filter((u: any) => {
      const arr: string[] = Array.isArray(u.roles) ? u.roles : [];
      return roleCodes.includes(u.role) || arr.some(r => roleCodes.includes(r));
    });
    if (!targets.length) return;
    await db.insert(userAlerts).values(
      targets.map((u: any) => ({ userId: u.id, message, type, actionUrl: actionUrl ?? null })),
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

// Fan-out helpers used by the underwriting routes/orchestrator.
export async function notifyRunCompleted(db: DB, applicationId: number, score: number, tier: string) {
  const url = `/underwriting-review/${applicationId}`;
  await alertRoles(db, [ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER],
    `Underwriting run completed for application #${applicationId} — score ${score} (${tier})`,
    url, tier === "high" ? "warning" : "info");
}

export async function notifyTransition(db: DB, applicationId: number, toStatus: string) {
  const url = `/underwriting-review/${applicationId}`;
  if (toStatus === "approved" || toStatus === "declined") {
    const [app] = await db.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
    if (app?.assignedReviewerId) await alertUser(db, app.assignedReviewerId, `Application #${applicationId} ${toStatus}`, url, toStatus === "approved" ? "success" : "warning");
  }
  if (toStatus === "pending_info") {
    await alertRoles(db, [ROLE_CODES.AGENT, ROLE_CODES.DATA_PROCESSING],
      `Application #${applicationId} requires additional information`, url, "warning");
  }
}
