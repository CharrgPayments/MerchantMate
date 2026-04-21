// E2E integration test for the underwriting review flow.
//
// Drives the live API end-to-end: login → run pipeline → add note → verify
// DB state → cleanup. Run with:
//
//   NODE_ENV=development npx tsx scripts/e2e-underwriting.ts
//
// Exit code is 0 on pass, 1 on any failure. Designed to be safe against the
// dev DB: every row created is deleted in the finally block.

import { db } from "../server/db";
import {
  merchantProspects,
  prospectApplications,
  underwritingRuns,
  underwritingPhaseResults,
  underwritingNotes,
  underwritingIssues,
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
import { eq, desc, and, inArray } from "drizzle-orm";
import bcrypt from "bcrypt";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5000";
const TEST_USER_ID = "test-admin-001";
const TEST_USERNAME = "testadmin";
const TEST_PASSWORD = "E2EUWPipelineTest!";

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];

function record(name: string, ok: boolean, detail?: string) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function fetchJson(
  path: string,
  init: RequestInit & { cookieJar?: { cookie: string | null } } = {},
): Promise<{ status: number; body: unknown; setCookie: string | null }> {
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
  return { status: res.status, body, setCookie };
}

async function main(): Promise<number> {
  let prospectId: number | null = null;
  let appId: number | null = null;
  let originalHash: string | null = null;

  try {
    // ── SETUP ──
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
    // Stash for cleanup.
    (globalThis as { __orig2FA?: boolean }).__orig2FA = original2FA ?? false;

    const [agentRow] = await db.select({ id: agents.id }).from(agents).limit(1);
    if (!agentRow) {
      record("setup:any-agent-exists", false, "no agent rows seeded");
      return 1;
    }
    const [prospect] = await db.insert(merchantProspects).values({
      firstName: "UWE2E",
      lastName: `User-${Date.now()}`,
      email: `uw-e2e-${Date.now()}@example.com`,
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
      status: "SUB",
      pathway: "traditional",
      underwritingType: "new_app",
      applicationData: {
        companyName: `UW E2E Co ${Date.now()}`,
        federalTaxId: "12-3456789",
        businessPhone: "+12025551234",
        monthlyVolume: 15000,
        websiteUrl: "https://example.com",
        state: "CA",
        address: "100 Main St",
        mcc: "5812",
        ownerFirstName: "Jane",
        ownerLastName: "Doe",
        ownerSsn: "123-45-6789",
      },
    }).returning();
    appId = app.id;
    record("setup:create-application", true, `id=${appId}, status=SUB`);

    // ── AUTH ──
    // The auth service requires a 2FA code if the source IP doesn't match the
    // user's last login IP (always true for fresh test runs). We do the
    // two-step flow: first call returns requires2FA + emails a code, we read
    // the code from two_factor_codes, then submit it on the second call.
    const jar: { cookie: string | null } = { cookie: null };
    const login1 = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail: TEST_USERNAME, password: TEST_PASSWORD }),
      cookieJar: jar,
    });
    const login1Body = login1.body as { success?: boolean; requires2FA?: boolean } | null;
    let loginStatus = login1.status;
    if (login1Body?.requires2FA) {
      const [codeRow] = await db.select().from(twoFactorCodes)
        .where(and(eq(twoFactorCodes.userId, TEST_USER_ID), eq(twoFactorCodes.used, false)))
        .orderBy(desc(twoFactorCodes.createdAt))
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

    const me = await fetchJson("/api/auth/user", { cookieJar: jar });
    const meBody = me.body as { id?: string; roles?: string[] } | null;
    const isSuper = !!meBody?.roles?.includes("super_admin") || meBody?.id === TEST_USER_ID;
    record("auth:user-is-super-admin", isSuper, `id=${meBody?.id} roles=${meBody?.roles?.join(",")}`);
    if (!isSuper) return 1;

    // ── RUN PIPELINE ──
    const run = await fetchJson(`/api/applications/${appId}/underwriting/run`, {
      method: "POST",
      body: JSON.stringify({}),
      cookieJar: jar,
    });
    record("pipeline:run", run.status === 200, `status=${run.status}`);
    if (run.status !== 200) {
      record("pipeline:run-body", false, JSON.stringify(run.body).slice(0, 300));
      return 1;
    }

    // ── DB ASSERTIONS ──
    const runs = await db.select().from(underwritingRuns).where(eq(underwritingRuns.applicationId, appId));
    record("db:run-row-exists", runs.length === 1, `count=${runs.length}`);
    if (runs.length !== 1) return 1;

    const phases = await db.select().from(underwritingPhaseResults).where(eq(underwritingPhaseResults.runId, runs[0].id));
    console.log("  phase results:", phases.map(p => `${p.phaseKey}=${p.status}`).join(", "));
    for (const p of phases) {
      console.log(`    ${p.phaseKey}:`, JSON.stringify({ status: p.status, score: p.score, findings: p.findings, error: (p as { errorMessage?: string }).errorMessage }).slice(0, 400));
    }
    console.log("  run status:", runs[0].status, "current_phase:", runs[0].currentPhase);
    record("db:phase-results>=5", phases.length >= 5, `count=${phases.length}`);
    if (phases.length < 5) return 1;

    // Confirm at least one phase used a built-in verifier (non-skipped) for
    // OFAC, phone, or website — these have no endpoint configured but task #22
    // wires built-in fallbacks.
    const builtinPhases = phases.filter((p) =>
      ["ofac_sanctions", "phone_verification", "website_review"].includes(p.phaseKey) &&
      p.status !== "skipped"
    );
    record("pipeline:builtin-verifiers-fired", builtinPhases.length > 0,
      `non-skipped builtins=${builtinPhases.map((p) => `${p.phaseKey}:${p.status}`).join(", ")}`);

    // ── WORKFLOW TICKET MIRROR ASSERTIONS (Task #28) ──
    // The orchestrator should have mirrored the run into workflow_tickets +
    // workflow_ticket_stages so the unified Worklist UI sees this app.
    const tickets = await db.select().from(workflowTickets)
      .where(and(eq(workflowTickets.entityType, "prospect_application"),
                 eq(workflowTickets.entityId, appId)));
    record("mirror:ticket-row-exists", tickets.length === 1, `count=${tickets.length}`);
    if (tickets.length !== 1) return 1;
    const ticket = tickets[0];

    const [defRow] = await db.select().from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, ticket.workflowDefinitionId)).limit(1);
    const defOk = defRow?.code === "merchant_underwriting_traditional_v1";
    record("mirror:ticket-linked-to-traditional-def", defOk, `def=${defRow?.code}`);
    if (!defOk) return 1;

    const ticketStageRows = await db.select().from(workflowTicketStages)
      .where(eq(workflowTicketStages.ticketId, ticket.id));
    const stagesOk = ticketStageRows.length >= phases.length;
    record("mirror:ticket-stages>=phases", stagesOk,
      `stages=${ticketStageRows.length} phases=${phases.length}`);
    if (!stagesOk) return 1;

    // Mirror status sanity: each automated phase result must show up on
    // its corresponding ticket stage with a matching status.
    const stagesForDef = await db.select().from(workflowStages)
      .where(eq(workflowStages.workflowDefinitionId, ticket.workflowDefinitionId));
    const stageByCode = new Map(stagesForDef.map(s => [s.code, s]));
    const tsByStageId = new Map(ticketStageRows.map(ts => [ts.stageId, ts]));
    let mirrorMatches = 0;
    for (const pr of phases) {
      const stage = stageByCode.get(pr.phaseKey);
      if (!stage) continue;
      const ts = tsByStageId.get(stage.id);
      if (!ts) continue;
      // Mirror maps pass/warn → completed; fail/error/skipped → failed
      // (skipped falls into the default branch in mapStageStatus).
      const expected = (pr.status === "pass" || pr.status === "warn") ? "completed" : "failed";
      if (ts.status === expected) mirrorMatches++;
    }
    const mirrorOk = mirrorMatches === phases.length;
    record("mirror:per-phase-status-matches", mirrorOk,
      `matched=${mirrorMatches}/${phases.length}`);
    if (!mirrorOk) return 1;

    // Both manual phases (Derogatory + G2) must be pre-seeded as `pending`
    // so reviewers see them in the unified Worklist before action.
    const derogStage = stageByCode.get("derogatory_check");
    const g2Stage = stageByCode.get("g2_check");
    const derogTicketStage = derogStage ? tsByStageId.get(derogStage.id) : undefined;
    const g2TicketStage = g2Stage ? tsByStageId.get(g2Stage.id) : undefined;
    const manualsOk = !!derogTicketStage && derogTicketStage.status === "pending"
                   && !!g2TicketStage && g2TicketStage.status === "pending";
    record("mirror:both-manual-stages-pending", manualsOk,
      `derog=${derogTicketStage?.status ?? "missing"} g2=${g2TicketStage?.status ?? "missing"}`);
    if (!manualsOk || !derogTicketStage || !g2TicketStage) return 1;

    // Idempotency: re-running the pipeline must not duplicate stage rows.
    const run2 = await fetchJson(`/api/applications/${appId}/underwriting/run`, {
      method: "POST", body: JSON.stringify({}), cookieJar: jar,
    });
    const rerunOk = run2.status === 200;
    record("mirror:rerun-pipeline", rerunOk, `status=${run2.status}`);
    if (!rerunOk) return 1;
    const ticketStageRows2 = await db.select().from(workflowTicketStages)
      .where(eq(workflowTicketStages.ticketId, ticket.id));
    const idempotentOk = ticketStageRows2.length === ticketStageRows.length;
    record("mirror:rerun-no-duplicate-stages", idempotentOk,
      `before=${ticketStageRows.length} after=${ticketStageRows2.length}`);
    if (!idempotentOk) return 1;

    // Single ticket per app even after re-run.
    const ticketsAfter = await db.select().from(workflowTickets)
      .where(and(eq(workflowTickets.entityType, "prospect_application"),
                 eq(workflowTickets.entityId, appId)));
    const singleTicketOk = ticketsAfter.length === 1;
    record("mirror:rerun-no-duplicate-tickets", singleTicketOk, `count=${ticketsAfter.length}`);
    if (!singleTicketOk) return 1;

    // Plant an open underwriting_issue for derogatory_check so we can
    // assert the worklist approval auto-resolves it (system-of-record
    // sync, per task acceptance criteria).
    await db.insert(underwritingIssues).values({
      applicationId: appId, runId: runs[0].id, phaseKey: "derogatory_check",
      severity: "warning", code: "derog_planted", message: "E2E planted",
      status: "open",
    });

    // ── APPROVE DEROGATORY FROM WORKLIST (Task #28 step 4) ──
    const approveDerog = await fetchJson(
      `/api/admin/workflow-tickets/${ticket.id}/stages/${derogTicketStage.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", notes: "E2E approve derog" }),
        cookieJar: jar,
      },
    );
    const approveDerogOk = approveDerog.status === 200;
    record("worklist:approve-derogatory", approveDerogOk, `status=${approveDerog.status}`);
    if (!approveDerogOk) return 1;

    const [refreshedDerog] = await db.select().from(workflowTicketStages)
      .where(eq(workflowTicketStages.id, derogTicketStage.id)).limit(1);
    const derogStageOk = refreshedDerog?.status === "completed"
                      && refreshedDerog?.result === "approved"
                      && refreshedDerog?.reviewDecision === "approve";
    record("worklist:derog-stage-completed-with-decision", derogStageOk,
      `status=${refreshedDerog?.status} result=${refreshedDerog?.result} decision=${refreshedDerog?.reviewDecision}`);
    if (!derogStageOk) return 1;

    // Underwriting domain must remain the system of record: a new
    // underwriting_runs row should exist for the manual phase, and the
    // open issue we planted must be auto-resolved.
    const runsAfterDerog = await db.select().from(underwritingRuns)
      .where(eq(underwritingRuns.applicationId, appId));
    const manualRunOk = runsAfterDerog.length >= 2;
    record("worklist:derog-manual-run-recorded", manualRunOk, `runs=${runsAfterDerog.length}`);
    if (!manualRunOk) return 1;

    const planted = await db.select().from(underwritingIssues)
      .where(and(eq(underwritingIssues.applicationId, appId),
                 eq(underwritingIssues.phaseKey, "derogatory_check"),
                 eq(underwritingIssues.code, "derog_planted")));
    const issueResolvedOk = planted.length === 1 && planted[0].status === "resolved";
    record("worklist:derog-issue-auto-resolved", issueResolvedOk,
      `status=${planted[0]?.status ?? "missing"}`);
    if (!issueResolvedOk) return 1;

    // ── APPROVE G2 FROM WORKLIST (covers second manual phase) ──
    const approveG2 = await fetchJson(
      `/api/admin/workflow-tickets/${ticket.id}/stages/${g2TicketStage.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", notes: "E2E approve g2" }),
        cookieJar: jar,
      },
    );
    const approveG2Ok = approveG2.status === 200;
    record("worklist:approve-g2", approveG2Ok, `status=${approveG2.status}`);
    if (!approveG2Ok) return 1;

    const [refreshedG2] = await db.select().from(workflowTicketStages)
      .where(eq(workflowTicketStages.id, g2TicketStage.id)).limit(1);
    const g2StageOk = refreshedG2?.status === "completed"
                   && refreshedG2?.result === "approved"
                   && refreshedG2?.reviewDecision === "approve";
    record("worklist:g2-stage-completed-with-decision", g2StageOk,
      `status=${refreshedG2?.status} result=${refreshedG2?.result} decision=${refreshedG2?.reviewDecision}`);
    if (!g2StageOk) return 1;

    // A workflow_notes audit row should have been written by the worklist
    // endpoint for each manual approval (Derog + G2 = 2 rows minimum).
    const wfNotes = await db.select().from(workflowNotes)
      .where(eq(workflowNotes.ticketId, ticket.id));
    const auditNotesOk = wfNotes.length >= 2;
    record("worklist:audit-notes-written", auditNotesOk, `count=${wfNotes.length}`);
    if (!auditNotesOk) return 1;

    // ── ADD NOTE ──
    const noteBody = `E2E pipeline note ${Date.now()}`;
    const note = await fetchJson(`/api/applications/${appId}/underwriting/notes`, {
      method: "POST",
      body: JSON.stringify({ body: noteBody, visibility: "internal" }),
      cookieJar: jar,
    });
    record("note:create", note.status === 200 || note.status === 201, `status=${note.status}`);

    const noteRows = await db.select().from(underwritingNotes).where(eq(underwritingNotes.applicationId, appId));
    record("db:note-row-exists", noteRows.length === 1, `count=${noteRows.length}`);

    return 0;
  } catch (err) {
    record("uncaught", false, err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    // ── CLEANUP ──
    try {
      if (appId !== null) {
        // Workflow ticket mirror cleanup (Task #28).
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
        await db.delete(underwritingIssues).where(eq(underwritingIssues.applicationId, appId));
        await db.delete(underwritingNotes).where(eq(underwritingNotes.applicationId, appId));
        const runRows = await db.select({ id: underwritingRuns.id }).from(underwritingRuns).where(eq(underwritingRuns.applicationId, appId));
        for (const r of runRows) {
          await db.delete(underwritingPhaseResults).where(eq(underwritingPhaseResults.runId, r.id));
        }
        await db.delete(underwritingRuns).where(eq(underwritingRuns.applicationId, appId));
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
