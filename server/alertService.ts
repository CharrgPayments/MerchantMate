// In-app notification helper used by every server-side event source that
// wants to drop a row into the bell dropdown. Keeps insertions to
// `user_alerts` consistent and emits a real-time event on the SSE bus
// (see server/alertBus.ts) so connected clients update their badge
// without waiting for the 60s polling fallback.
//
// All callers should use createAlert / createAlertForUsers / createAlertForRoles
// rather than touching the userAlerts table directly so that future cross-
// cutting concerns (rate limiting, dedupe, metrics) live in one place.

import { sql } from "drizzle-orm";
import { db as defaultDb } from "./db";
import { userAlerts, users } from "@shared/schema";
import { alertBus } from "./alertBus";

type AlertType = "info" | "warning" | "error" | "success";

interface CreateAlertParams {
  userId: string;
  message: string;
  type?: AlertType;
  actionUrl?: string;
  actionActivityId?: number;
  // Optional override for the database connection. Used by callers that run
  // inside a request context tied to a specific environment (dev/test/prod).
  // Falls back to the shared default db.
  db?: typeof defaultDb;
}

export async function createAlert(params: CreateAlertParams) {
  const { userId, message, type = "info", actionUrl, actionActivityId, db } = params;
  const conn = db ?? defaultDb;
  try {
    const [row] = await conn
      .insert(userAlerts)
      .values({ userId, message, type, actionUrl, actionActivityId })
      .returning();
    if (row) {
      alertBus.emit(userId, row);
    }
    return row ?? null;
  } catch (err) {
    // Notifications are best-effort — never let a failure cascade into the
    // originating business operation (prospect submit, status change, etc.).
    console.error("[alertService] createAlert failed:", err);
    return null;
  }
}

export async function createAlertForUsers(
  userIds: string[],
  message: string,
  opts: { type?: AlertType; actionUrl?: string; actionActivityId?: number; db?: typeof defaultDb } = {},
) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  await Promise.all(unique.map((uid) => createAlert({ userId: uid, message, ...opts })));
}

// Look up every user that has any of the given role codes (text[] roles
// column on the users table) and create an identical alert for each.
// Used by event sources that target a role rather than a specific user
// (e.g. "any underwriter" when a new application lands in the queue).
export async function createAlertForRoles(
  roleCodes: string[],
  message: string,
  opts: { type?: AlertType; actionUrl?: string; actionActivityId?: number; db?: typeof defaultDb } = {},
) {
  if (roleCodes.length === 0) return;
  const conn = opts.db ?? defaultDb;
  try {
    // users.roles is text[]; use && (overlap) to find any user whose roles
    // intersect the requested set.
    const rows = await conn
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.roles} && ${roleCodes}::text[]`);
    await createAlertForUsers(
      rows.map((r) => r.id),
      message,
      opts,
    );
  } catch (err) {
    console.error("[alertService] createAlertForRoles failed:", err);
  }
}
