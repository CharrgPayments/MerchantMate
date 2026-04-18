import { db } from "../db";
import { prospectApplications } from "@shared/schema";
import { eq } from "drizzle-orm";

export class ArchivedApplicationError extends Error {
  status = 409;
  code = "application_archived";
  constructor(applicationId: number | string) {
    super(`Application ${applicationId} is archived (cold storage) and cannot be modified.`);
  }
}

// Throws ArchivedApplicationError if the given prospect_application has a
// non-null archivedAt timestamp. Call this at the top of every write path
// touching prospect_applications, underwriting_runs, prospect_signatures,
// etc., so retained-but-archived records are read-only.
export async function assertNotArchived(applicationId: number | string): Promise<void> {
  const id = typeof applicationId === "string" ? Number(applicationId) : applicationId;
  if (!Number.isFinite(id)) return;
  const [row] = await db
    .select({ archivedAt: prospectApplications.archivedAt })
    .from(prospectApplications)
    .where(eq(prospectApplications.id, id))
    .limit(1);
  if (row?.archivedAt) throw new ArchivedApplicationError(applicationId);
}
