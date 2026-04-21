// Task #39 — End-to-end verification of the unified queue.
//
// Drives the live API end-to-end for the workflow_tickets-backed queue:
// seeds an application + ticket, hits /api/underwriting/queue and asserts
// it surfaces ticketId / currentStageCode / ticketDueAt; claims the
// application via the assign endpoint and verifies the assignee is
// mirrored into workflow_tickets.assigned_to_id; and finally calls
// /api/applications/sla-status to confirm the deadline matches the
// workflow_stages.timeout_minutes for the ticket's current stage.
//
// Run with:
//   NODE_ENV=development npx tsx scripts/e2e-unified-queue.ts
//
// Exit code is 0 on pass, 1 on any failure. All seeded rows are removed
// in the finally block so it is safe against the dev DB.

import { db } from "../server/db";
import {
  merchantProspects,
  prospectApplications,
  twoFactorCodes,
  users,
  agents,
  workflowTickets,
  workflowTicketStages,
  workflowDefinitions,
  workflowStages,
  workflowNotes,
  workflowTransitions,
} from "../shared/schema";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import {
  ensureTicket,
  refreshTicketSlaDeadline,
} from "../server/underwriting/workflowMirror";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5000";
const TEST_USER_ID = "test-admin-001";
const TEST_USERNAME = "testadmin";
const TEST_PASSWORD = "E2EUnifiedQueueTest!";

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];
function record(name: string, ok: boolean, detail?: string) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function fetchJson(
  path: string,
  init: RequestInit & { cookieJar?: { cookie: string | null } } = {},
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  if (init.cookieJar?.cookie) headers.set("cookie", init.cookieJar.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && init.cookieJar) {
    const sid = setCookie.split(",").map((c) => c.split(";")[0]).join("; ");
    init.cookieJar.cookie = sid;
  }
  return { status: res.status, body };
}

async function main(): Promise<number> {
  let prospectId: number | null = null;
  let appId: number | null = null;
  let originalHash: string | null = null;
  let ticketId: number | null = null;

  try {
    // ── SETUP: test user password + 2FA reset ──
    const [origUser] = await db.select().from(users).where(eq(users.id, TEST_USER_ID)).limit(1);
    if (!origUser) {
      record("setup:test-user-exists", false, `user ${TEST_USER_ID} not found`);
      return 1;
    }
    originalHash = origUser.passwordHash;
    const original2FA = origUser.twoFactorEnabled;
    const newHash = await bcrypt.hash(TEST_PASSWORD, 10);
    await db.update(users).set({ passwordHash: newHash, twoFactorEnabled: false }).where(eq(users.id, TEST_USER_ID));
    record("setup:reset-password+disable-2fa", true);
    (globalThis as { __orig2FA?: boolean }).__orig2FA = original2FA ?? false;

    const [agentRow] = await db.select({ id: agents.id }).from(agents).limit(1);
    if (!agentRow) {
      record("setup:any-agent-exists", false, "no agent rows seeded");
      return 1;
    }

    // ── SETUP: prospect + application ──
    const [prospect] = await db.insert(merchantProspects).values({
      firstName: "QueueE2E",
      lastName: `User-${Date.now()}`,
      email: `queue-e2e-${Date.now()}@example.com`,
      agentId: agentRow.id,
      status: "validated",
    }).returning();
    prospectId = prospect.id;
    record("setup:create-prospect", true, `id=${prospectId}`);

    const [app] = await db.insert(prospectApplications).values({
      prospectId,
      acquirerId: 1,
      templateId: 1,
      templateVersion: "v1",
      status: "CUW",
      pathway: "traditional",
      underwritingType: "new_app",
      applicationData: {
        companyName: `Queue E2E Co ${Date.now()}`,
        federalTaxId: "12-3456789",
        businessPhone: "+12025551234",
        monthlyVolume: 15000,
        websiteUrl: "https://example.com",
        state: "CA",
        address: "100 Main St",
        mcc: "5812",
      },
      submittedAt: new Date(),
    }).returning();
    appId = app.id;
    record("setup:create-application", true, `id=${appId}, status=CUW`);

    // ── SETUP: workflow ticket via the same mirror code paths the
    // orchestrator uses, then plant a current stage with a backdated
    // started_at so the SLA deadline lands in the past (lets us assert
    // the value through /api/applications/sla-status which only
    // surfaces overdue rows). ──
    const ensured = await ensureTicket(db, app);
    if (!ensured) {
      record("setup:ensure-ticket", false, "ensureTicket returned null");
      return 1;
    }
    ticketId = ensured.ticketId;
    record("setup:ensure-ticket", true, `ticketId=${ticketId}`);

    // Pick the first non-skipped stage for this definition (lowest order).
    const defStages = await db.select().from(workflowStages)
      .where(eq(workflowStages.workflowDefinitionId, ensured.definitionId))
      .orderBy(asc(workflowStages.orderIndex));
    const firstStage = defStages.find(s => s.timeoutMinutes != null) ?? defStages[0];
    if (!firstStage) {
      record("setup:first-stage-found", false, "no stages for definition");
      return 1;
    }
    record("setup:first-stage-found", true,
      `code=${firstStage.code} timeout_minutes=${firstStage.timeoutMinutes}`);
    const timeoutMinutes = firstStage.timeoutMinutes ?? 60;

    // Backdate by 2× the timeout so the deadline is comfortably in the past.
    const backdatedStartedAt = new Date(Date.now() - timeoutMinutes * 60_000 * 2);

    // Upsert workflow_ticket_stages row for the current stage with the
    // backdated started_at. Mirror behaviour: status=in_progress so the
    // ticket is treated as actively running this stage.
    const existingStageRow = await db.select().from(workflowTicketStages)
      .where(and(
        eq(workflowTicketStages.ticketId, ticketId),
        eq(workflowTicketStages.stageId, firstStage.id),
      )).limit(1);
    if (existingStageRow[0]) {
      await db.update(workflowTicketStages).set({
        status: "in_progress",
        startedAt: backdatedStartedAt,
        updatedAt: new Date(),
      }).where(eq(workflowTicketStages.id, existingStageRow[0].id));
    } else {
      await db.insert(workflowTicketStages).values({
        ticketId,
        stageId: firstStage.id,
        status: "in_progress",
        startedAt: backdatedStartedAt,
      });
    }

    // Point the ticket at the current stage and clear any halt so the
    // SLA refresh actually computes a deadline.
    await db.update(workflowTickets).set({
      currentStageId: firstStage.id,
      startedAt: backdatedStartedAt,
      status: "in_progress",
      updatedAt: new Date(),
    }).where(eq(workflowTickets.id, ticketId));
    await db.update(prospectApplications).set({
      pipelineHaltedAtPhase: null,
      updatedAt: new Date(),
    }).where(eq(prospectApplications.id, appId));

    const { deadline: refreshedDeadline } = await refreshTicketSlaDeadline({
      db, ticketId, applicationId: appId,
    });
    if (!refreshedDeadline) {
      record("setup:refresh-deadline", false, "deadline came back null");
      return 1;
    }
    record("setup:refresh-deadline", true, `deadline=${refreshedDeadline.toISOString()}`);

    // Expected deadline computed straight from workflow_stages.timeout_minutes.
    const expectedDeadlineMs = backdatedStartedAt.getTime() + timeoutMinutes * 60_000;

    // ── AUTH ──
    const jar: { cookie: string | null } = { cookie: null };
    const login1 = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail: TEST_USERNAME, password: TEST_PASSWORD }),
      cookieJar: jar,
    });
    const login1Body = login1.body as { requires2FA?: boolean } | null;
    let loginStatus = login1.status;
    if (login1Body?.requires2FA) {
      const [codeRow] = await db.select().from(twoFactorCodes)
        .where(and(eq(twoFactorCodes.userId, TEST_USER_ID), eq(twoFactorCodes.used, false)))
        .orderBy(sql`created_at DESC`)
        .limit(1);
      if (!codeRow) {
        record("auth:fetch-2fa-code", false, "no code row found");
        return 1;
      }
      const login2 = await fetchJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail: TEST_USERNAME, password: TEST_PASSWORD, twoFactorCode: codeRow.code }),
        cookieJar: jar,
      });
      loginStatus = login2.status;
    }
    record("auth:login", loginStatus === 200, `status=${loginStatus}`);
    if (loginStatus !== 200) return 1;

    // ── ASSERT 1: /api/underwriting/queue surfaces the ticket fields ──
    // Use status=in_review so CUW rows are returned without other
    // queue noise affecting our row lookup.
    const queueRes = await fetchJson(`/api/underwriting/queue?status=in_review`, { cookieJar: jar });
    if (queueRes.status !== 200) {
      record("queue:get", false, `status=${queueRes.status} body=${JSON.stringify(queueRes.body).slice(0,200)}`);
      return 1;
    }
    const queueRows = queueRes.body as Array<{
      id: number;
      ticketId: number | null;
      ticketStatus: string | null;
      ticketDueAt: string | null;
      currentStageCode: string | null;
      currentStageName: string | null;
    }>;
    const ourRow = queueRows.find(r => r.id === appId);
    if (!ourRow) {
      record("queue:row-present", false, `not found in ${queueRows.length} rows`);
      return 1;
    }
    record("queue:row-present", true, `rows=${queueRows.length}`);
    record("queue:ticket-id-mirrored", ourRow.ticketId === ticketId,
      `expected=${ticketId} got=${ourRow.ticketId}`);
    record("queue:current-stage-code-mirrored",
      ourRow.currentStageCode === firstStage.code,
      `expected=${firstStage.code} got=${ourRow.currentStageCode}`);
    if (!ourRow.ticketDueAt) {
      record("queue:ticket-due-at-present", false, "ticketDueAt missing");
      return 1;
    }
    const queueDueAtMs = new Date(ourRow.ticketDueAt).getTime();
    const queueDueAtMatches = Math.abs(queueDueAtMs - expectedDeadlineMs) < 60_000;
    record("queue:ticket-due-at-matches-stage-timeout", queueDueAtMatches,
      `expected=${new Date(expectedDeadlineMs).toISOString()} got=${ourRow.ticketDueAt}`);
    if (!queueDueAtMatches || ourRow.ticketId !== ticketId
        || ourRow.currentStageCode !== firstStage.code) return 1;

    // ── ASSERT 2: claim the application and verify ticket mirror ──
    const claimRes = await fetchJson(
      `/api/applications/${appId}/underwriting/assign`,
      {
        method: "POST",
        body: JSON.stringify({ reviewerId: "me" }),
        cookieJar: jar,
      },
    );
    if (claimRes.status !== 200) {
      record("assign:claim-self", false, `status=${claimRes.status} body=${JSON.stringify(claimRes.body).slice(0,200)}`);
      return 1;
    }
    record("assign:claim-self", true);

    const [claimedTicket] = await db.select().from(workflowTickets)
      .where(eq(workflowTickets.id, ticketId)).limit(1);
    record("assign:ticket-assignee-mirrored",
      claimedTicket?.assignedToId === TEST_USER_ID,
      `expected=${TEST_USER_ID} got=${claimedTicket?.assignedToId ?? "null"}`);
    if (claimedTicket?.assignedToId !== TEST_USER_ID) return 1;

    // ── ASSERT 3: /api/applications/sla-status reflects stage timeout ──
    const slaRes = await fetchJson(`/api/applications/sla-status`, { cookieJar: jar });
    if (slaRes.status !== 200) {
      record("sla:get", false, `status=${slaRes.status}`);
      return 1;
    }
    const slaBody = slaRes.body as {
      overdueApplications: Array<{ id: number; slaDeadline: string | null }>;
    };
    const ourOverdue = slaBody.overdueApplications.find(a => a.id === appId);
    if (!ourOverdue) {
      record("sla:app-listed-overdue", false,
        `app ${appId} not in ${slaBody.overdueApplications.length} overdue rows`);
      return 1;
    }
    record("sla:app-listed-overdue", true);
    if (!ourOverdue.slaDeadline) {
      record("sla:deadline-present", false, "slaDeadline null in overdue row");
      return 1;
    }
    const slaDeadlineMs = new Date(ourOverdue.slaDeadline).getTime();
    const slaMatches = Math.abs(slaDeadlineMs - expectedDeadlineMs) < 60_000;
    record("sla:deadline-matches-stage-timeout-minutes", slaMatches,
      `expected=${new Date(expectedDeadlineMs).toISOString()} got=${ourOverdue.slaDeadline}`);
    if (!slaMatches) return 1;

    // Cross-check: the deadline reported by the queue and by sla-status
    // must agree (single source of truth = workflow_stages.timeout_minutes).
    const queueAndSlaAgree = Math.abs(slaDeadlineMs - queueDueAtMs) < 60_000;
    record("sla:queue-and-sla-status-agree", queueAndSlaAgree,
      `queue=${ourRow.ticketDueAt} sla=${ourOverdue.slaDeadline}`);
    if (!queueAndSlaAgree) return 1;

    return 0;
  } catch (err) {
    record("uncaught", false, err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    return 1;
  } finally {
    // ── CLEANUP ──
    try {
      if (appId !== null) {
        const ticketRows = await db.select({ id: workflowTickets.id }).from(workflowTickets)
          .where(and(eq(workflowTickets.entityType, "prospect_application"),
                     eq(workflowTickets.entityId, appId)));
        const ticketIds = ticketRows.map(r => r.id);
        if (ticketIds.length) {
          await db.delete(workflowTicketStages).where(inArray(workflowTicketStages.ticketId, ticketIds));
          await db.delete(workflowNotes).where(inArray(workflowNotes.ticketId, ticketIds));
          await db.delete(workflowTransitions).where(inArray(workflowTransitions.ticketId, ticketIds));
          await db.delete(workflowTickets).where(inArray(workflowTickets.id, ticketIds));
        }
        await db.delete(prospectApplications).where(eq(prospectApplications.id, appId));
      }
      if (prospectId !== null) {
        await db.delete(merchantProspects).where(eq(merchantProspects.id, prospectId));
      }
      if (originalHash) {
        const orig2FA = (globalThis as { __orig2FA?: boolean }).__orig2FA ?? false;
        await db.update(users).set({ passwordHash: originalHash, twoFactorEnabled: orig2FA }).where(eq(users.id, TEST_USER_ID));
      }
      console.log("✓ cleanup complete");
    } catch (e) {
      console.error("✗ cleanup failed:", e);
    }
  }
}

main().then((code) => {
  console.log("\n──────── SUMMARY ────────");
  for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"} ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}\n`);
  process.exit(code);
}).catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
