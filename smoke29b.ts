import { db } from "./server/db";
import { refreshTicketSlaDeadline } from "./server/underwriting/workflowMirror";
import { sql } from "drizzle-orm";
(async () => {
  // Force ticket #2 to point at google_kyb (1440 min timeout) and not halted, with a known started_at.
  await db.execute(sql`UPDATE workflow_tickets SET current_stage_id=(SELECT id FROM workflow_stages WHERE workflow_definition_id=(SELECT workflow_definition_id FROM workflow_tickets WHERE id=2) AND code='google_kyb'), started_at=NOW() - INTERVAL '2 hours' WHERE id=2`);
  await db.execute(sql`UPDATE prospect_applications SET pipeline_halted_at_phase=NULL WHERE id=8`);
  const r = await refreshTicketSlaDeadline({ db: db as any, ticketId: 2, applicationId: 8 });
  console.log("REFRESHED:", r.deadline);
  const check = await db.execute(sql`SELECT wt.due_at, pa.sla_deadline FROM workflow_tickets wt LEFT JOIN prospect_applications pa ON pa.id=wt.entity_id WHERE wt.id=2`);
  console.log("CHECK:", check.rows);
})().catch(e => { console.error(e); process.exit(1); });
