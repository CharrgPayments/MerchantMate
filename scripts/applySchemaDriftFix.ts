/**
 * Schema-Drift Reconciliation
 * ===========================
 *
 * Closes the gap between `shared/schema.ts` and the live PostgreSQL
 * database that has accumulated because `npm run db:push` was skipped
 * over many commits.
 *
 * Idempotent: re-running is a no-op. Each ADD CONSTRAINT / CREATE INDEX
 * is wrapped so a "duplicate_object" error counts as success.
 *
 * Usage:
 *   tsx scripts/applySchemaDriftFix.ts <env> [phases]
 *     <env>    = development | test | production
 *     [phases] = comma-separated subset of: 1,2,3,4   (default: 1,2,3,4)
 *
 * Phases:
 *   1 = additive constraints  (78 FKs + 4 composite PKs + 18 indexes
 *                              + 16 column defaults)  — strictly safe
 *   2 = cosmetic type changes (varchar(N)→varchar, timestamp(6)→timestamp,
 *                              and three NARROWINGS that audit confirmed
 *                              are safe because columns have no offending
 *                              values)
 *   3 = fee_* id integer→serial, attaching the existing per-table
 *                              sequence as the column DEFAULT and aligning
 *                              ownership.  Avoids drizzle-kit's destructive
 *                              `truncate cascade` strategy.
 *   4 = numeric precision tightenings on `merchants` / `transactions`.
 *                              Audit confirmed all 7 affected columns are
 *                              empty so there is nothing to lose.
 *
 *   5 = `external_endpoints.name` UNIQUE constraint.
 *
 * Production rollout result (after Phases 1-5):
 *   FKs: 3 → 81 (matches schema's 81 references())
 *   indexes: 174 → 196
 *   real type drift: 0 remaining
 *
 * Required pre-step on production: NULL or DELETE 6 orphan rows that violate
 * the new FKs (campaigns.created_by='test-runner', email_activity.template_id=6,
 * security_events.audit_log_id × 4, prospect_applications #119, sla_breaches
 * #1 + #466).  See git history for the one-shot cleanup snippet.
 *
 * NOT included (deferred — needs separate task):
 *   - Drop 5 legacy `stage_api_configs` columns. 17 rows still rely on
 *     `endpoint_url` and ZERO have the new `endpoint_id` set, so the
 *     Task #33 cutover backfill must run first.
 *
 * Known cosmetic drift drizzle-kit will keep flagging (do NOT chase):
 *   - 5 FKs whose schema names exceed PostgreSQL's 63-char identifier limit
 *     (e.g. `..._pdf_form_submissions_id_fk` → DB stores `..._id_f`). The
 *     constraints exist and are enforced; only the name differs.
 *   - 12 column DEFAULT values where schema declares `'[]'`/`'{}'` /
 *     `ARRAY[]::text[]` and DB stores them with explicit `::jsonb` /
 *     `::text[]` casts.  Functionally identical; drizzle-kit's diff is a
 *     pure string comparison.
 */
import { getDynamicDatabase } from "../server/db";
import { sql as dsql } from "drizzle-orm";

type Env = "development" | "test" | "production";
type Stmt = { label: string; sql: string };

// ------------------------------------------------------------------ Phase 1
// Foreign keys. 78 entries: every `references(() => …)` declaration in
// shared/schema.ts that the DB is missing.
const PHASE_1_FKS: Stmt[] = [
  { label: "action_templates.endpoint_id → external_endpoints.id", sql: `ALTER TABLE "action_templates" ADD CONSTRAINT "action_templates_endpoint_id_external_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."external_endpoints"("id") ON DELETE set null ON UPDATE no action` },
  { label: "addresses.location_id → locations.id", sql: `ALTER TABLE "addresses" ADD CONSTRAINT "addresses_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "agent_hierarchy.ancestor_id → agents.id", sql: `ALTER TABLE "agent_hierarchy" ADD CONSTRAINT "agent_hierarchy_ancestor_id_agents_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "agent_hierarchy.descendant_id → agents.id", sql: `ALTER TABLE "agent_hierarchy" ADD CONSTRAINT "agent_hierarchy_descendant_id_agents_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "agent_overrides.child_agent_id → agents.id", sql: `ALTER TABLE "agent_overrides" ADD CONSTRAINT "agent_overrides_child_agent_id_agents_id_fk" FOREIGN KEY ("child_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "agent_overrides.parent_agent_id → agents.id", sql: `ALTER TABLE "agent_overrides" ADD CONSTRAINT "agent_overrides_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "agents.user_id → users.id", sql: `ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "api_request_logs.api_key_id → api_keys.id", sql: `ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "business_ownership.form_submission_id → pdf_form_submissions.id", sql: `ALTER TABLE "business_ownership" ADD CONSTRAINT "business_ownership_form_submission_id_pdf_form_submissions_id_fk" FOREIGN KEY ("form_submission_id") REFERENCES "public"."pdf_form_submissions"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "business_ownership.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "business_ownership" ADD CONSTRAINT "business_ownership_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_application_templates.campaign_id → campaigns.id", sql: `ALTER TABLE "campaign_application_templates" ADD CONSTRAINT "campaign_application_templates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_application_templates.template_id → acquirer_application_templates.id", sql: `ALTER TABLE "campaign_application_templates" ADD CONSTRAINT "campaign_application_templates_template_id_acquirer_application_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."acquirer_application_templates"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_assignment_rules.acquirer_id → acquirers.id", sql: `ALTER TABLE "campaign_assignment_rules" ADD CONSTRAINT "campaign_assignment_rules_acquirer_id_acquirers_id_fk" FOREIGN KEY ("acquirer_id") REFERENCES "public"."acquirers"("id") ON DELETE set null ON UPDATE no action` },
  { label: "campaign_assignment_rules.agent_id → agents.id", sql: `ALTER TABLE "campaign_assignment_rules" ADD CONSTRAINT "campaign_assignment_rules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action` },
  { label: "campaign_assignment_rules.campaign_id → campaigns.id", sql: `ALTER TABLE "campaign_assignment_rules" ADD CONSTRAINT "campaign_assignment_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_assignment_rules.created_by → users.id", sql: `ALTER TABLE "campaign_assignment_rules" ADD CONSTRAINT "campaign_assignment_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "campaign_assignments.assigned_by → users.id", sql: `ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "campaign_assignments.campaign_id → campaigns.id", sql: `ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action` },
  { label: "campaign_assignments.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_equipment.campaign_id → campaigns.id", sql: `ALTER TABLE "campaign_equipment" ADD CONSTRAINT "campaign_equipment_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_equipment.equipment_item_id → equipment_items.id", sql: `ALTER TABLE "campaign_equipment" ADD CONSTRAINT "campaign_equipment_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_fee_values.campaign_id → campaigns.id", sql: `ALTER TABLE "campaign_fee_values" ADD CONSTRAINT "campaign_fee_values_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaign_fee_values.fee_item_id → fee_items.id", sql: `ALTER TABLE "campaign_fee_values" ADD CONSTRAINT "campaign_fee_values_fee_item_id_fee_items_id_fk" FOREIGN KEY ("fee_item_id") REFERENCES "public"."fee_items"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "campaigns.created_by → users.id", sql: `ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "campaigns.pricing_type_id → pricing_types.id", sql: `ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_pricing_type_id_pricing_types_id_fk" FOREIGN KEY ("pricing_type_id") REFERENCES "public"."pricing_types"("id") ON DELETE no action ON UPDATE no action` },
  { label: "commission_events.beneficiary_agent_id → agents.id", sql: `ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_beneficiary_agent_id_agents_id_fk" FOREIGN KEY ("beneficiary_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "commission_events.transaction_id → transactions.id", sql: `ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "data_access_logs.audit_log_id → audit_logs.id", sql: `ALTER TABLE "data_access_logs" ADD CONSTRAINT "data_access_logs_audit_log_id_audit_logs_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_logs"("id") ON DELETE no action ON UPDATE no action` },
  { label: "disclosure_definitions.created_by → users.id", sql: `ALTER TABLE "disclosure_definitions" ADD CONSTRAINT "disclosure_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "disclosure_versions.created_by → users.id", sql: `ALTER TABLE "disclosure_versions" ADD CONSTRAINT "disclosure_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "disclosure_versions.definition_id → disclosure_definitions.id", sql: `ALTER TABLE "disclosure_versions" ADD CONSTRAINT "disclosure_versions_definition_id_disclosure_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."disclosure_definitions"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "email_activity.template_id → email_templates.id", sql: `ALTER TABLE "email_activity" ADD CONSTRAINT "email_activity_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action` },
  { label: "email_triggers.template_id → email_templates.id", sql: `ALTER TABLE "email_triggers" ADD CONSTRAINT "email_triggers_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action` },
  { label: "fee_group_fee_items.fee_group_id → fee_groups.id", sql: `ALTER TABLE "fee_group_fee_items" ADD CONSTRAINT "fee_group_fee_items_fee_group_id_fee_groups_id_fk" FOREIGN KEY ("fee_group_id") REFERENCES "public"."fee_groups"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "fee_group_fee_items.fee_item_group_id → fee_item_groups.id", sql: `ALTER TABLE "fee_group_fee_items" ADD CONSTRAINT "fee_group_fee_items_fee_item_group_id_fee_item_groups_id_fk" FOREIGN KEY ("fee_item_group_id") REFERENCES "public"."fee_item_groups"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "fee_group_fee_items.fee_item_id → fee_items.id", sql: `ALTER TABLE "fee_group_fee_items" ADD CONSTRAINT "fee_group_fee_items_fee_item_id_fee_items_id_fk" FOREIGN KEY ("fee_item_id") REFERENCES "public"."fee_items"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "fee_item_groups.fee_group_id → fee_groups.id", sql: `ALTER TABLE "fee_item_groups" ADD CONSTRAINT "fee_item_groups_fee_group_id_fee_groups_id_fk" FOREIGN KEY ("fee_group_id") REFERENCES "public"."fee_groups"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "locations.merchant_id → merchants.id", sql: `ALTER TABLE "locations" ADD CONSTRAINT "locations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "mcc_policies.acquirer_id → acquirers.id", sql: `ALTER TABLE "mcc_policies" ADD CONSTRAINT "mcc_policies_acquirer_id_acquirers_id_fk" FOREIGN KEY ("acquirer_id") REFERENCES "public"."acquirers"("id") ON DELETE no action ON UPDATE no action` },
  { label: "mcc_policies.created_by → users.id", sql: `ALTER TABLE "mcc_policies" ADD CONSTRAINT "mcc_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "mcc_policies.mcc_code_id → mcc_codes.id", sql: `ALTER TABLE "mcc_policies" ADD CONSTRAINT "mcc_policies_mcc_code_id_mcc_codes_id_fk" FOREIGN KEY ("mcc_code_id") REFERENCES "public"."mcc_codes"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "merchant_hierarchy.ancestor_id → merchants.id", sql: `ALTER TABLE "merchant_hierarchy" ADD CONSTRAINT "merchant_hierarchy_ancestor_id_merchants_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "merchant_hierarchy.descendant_id → merchants.id", sql: `ALTER TABLE "merchant_hierarchy" ADD CONSTRAINT "merchant_hierarchy_descendant_id_merchants_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "merchant_prospects.agent_id → agents.id", sql: `ALTER TABLE "merchant_prospects" ADD CONSTRAINT "merchant_prospects_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action` },
  { label: "merchants.user_id → users.id", sql: `ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "payouts.agent_id → agents.id", sql: `ALTER TABLE "payouts" ADD CONSTRAINT "payouts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action` },
  { label: "pdf_form_fields.form_id → pdf_forms.id", sql: `ALTER TABLE "pdf_form_fields" ADD CONSTRAINT "pdf_form_fields_form_id_pdf_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."pdf_forms"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "pdf_forms.uploaded_by → users.id", sql: `ALTER TABLE "pdf_forms" ADD CONSTRAINT "pdf_forms_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "pdf_form_submissions.form_id → pdf_forms.id", sql: `ALTER TABLE "pdf_form_submissions" ADD CONSTRAINT "pdf_form_submissions_form_id_pdf_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."pdf_forms"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "pdf_form_submissions.submitted_by → users.id", sql: `ALTER TABLE "pdf_form_submissions" ADD CONSTRAINT "pdf_form_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "portal_magic_links.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "portal_magic_links" ADD CONSTRAINT "portal_magic_links_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "pricing_type_fee_items.fee_item_id → fee_items.id", sql: `ALTER TABLE "pricing_type_fee_items" ADD CONSTRAINT "pricing_type_fee_items_fee_item_id_fee_items_id_fk" FOREIGN KEY ("fee_item_id") REFERENCES "public"."fee_items"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "pricing_type_fee_items.pricing_type_id → pricing_types.id", sql: `ALTER TABLE "pricing_type_fee_items" ADD CONSTRAINT "pricing_type_fee_items_pricing_type_id_pricing_types_id_fk" FOREIGN KEY ("pricing_type_id") REFERENCES "public"."pricing_types"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "prospect_applications.template_id → acquirer_application_templates.id", sql: `ALTER TABLE "prospect_applications" ADD CONSTRAINT "prospect_applications_template_id_acquirer_application_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."acquirer_application_templates"("id") ON DELETE no action ON UPDATE no action` },
  { label: "prospect_file_requests.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "prospect_file_requests" ADD CONSTRAINT "prospect_file_requests_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "prospect_messages.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "prospect_messages" ADD CONSTRAINT "prospect_messages_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "prospect_owners.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "prospect_owners" ADD CONSTRAINT "prospect_owners_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "prospect_signatures.owner_id → prospect_owners.id", sql: `ALTER TABLE "prospect_signatures" ADD CONSTRAINT "prospect_signatures_owner_id_prospect_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."prospect_owners"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "prospect_signatures.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "prospect_signatures" ADD CONSTRAINT "prospect_signatures_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "scheduled_report_runs.report_id → scheduled_reports.id", sql: `ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "scheduled_report_runs_report_id_scheduled_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "security_events.audit_log_id → audit_logs.id", sql: `ALTER TABLE "security_events" ADD CONSTRAINT "security_events_audit_log_id_audit_logs_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_logs"("id") ON DELETE no action ON UPDATE no action` },
  { label: "sla_breaches.application_id → prospect_applications.id", sql: `ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "sla_breaches.prospect_id → merchant_prospects.id", sql: `ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "stage_api_configs.endpoint_id → external_endpoints.id", sql: `ALTER TABLE "stage_api_configs" ADD CONSTRAINT "stage_api_configs_endpoint_id_external_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."external_endpoints"("id") ON DELETE set null ON UPDATE no action` },
  { label: "trigger_actions.action_template_id → action_templates.id", sql: `ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_action_template_id_action_templates_id_fk" FOREIGN KEY ("action_template_id") REFERENCES "public"."action_templates"("id") ON DELETE no action ON UPDATE no action` },
  { label: "trigger_actions.trigger_id → trigger_catalog.id", sql: `ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_trigger_id_trigger_catalog_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."trigger_catalog"("id") ON DELETE no action ON UPDATE no action` },
  { label: "two_factor_codes.user_id → users.id", sql: `ALTER TABLE "two_factor_codes" ADD CONSTRAINT "two_factor_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_files.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_files" ADD CONSTRAINT "underwriting_files_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_issues.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_issues" ADD CONSTRAINT "underwriting_issues_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_issues.run_id → underwriting_runs.id", sql: `ALTER TABLE "underwriting_issues" ADD CONSTRAINT "underwriting_issues_run_id_underwriting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."underwriting_runs"("id") ON DELETE set null ON UPDATE no action` },
  { label: "underwriting_notes.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_notes" ADD CONSTRAINT "underwriting_notes_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_phase_results.endpoint_id → external_endpoints.id", sql: `ALTER TABLE "underwriting_phase_results" ADD CONSTRAINT "underwriting_phase_results_endpoint_id_external_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."external_endpoints"("id") ON DELETE set null ON UPDATE no action` },
  { label: "underwriting_phase_results.run_id → underwriting_runs.id", sql: `ALTER TABLE "underwriting_phase_results" ADD CONSTRAINT "underwriting_phase_results_run_id_underwriting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."underwriting_runs"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_runs.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_runs" ADD CONSTRAINT "underwriting_runs_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_status_history.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_status_history" ADD CONSTRAINT "underwriting_status_history_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "underwriting_tasks.application_id → prospect_applications.id", sql: `ALTER TABLE "underwriting_tasks" ADD CONSTRAINT "underwriting_tasks_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action` },
  { label: "workflow_definitions.created_by → users.id", sql: `ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action` },
  { label: "workflow_environment_configs.workflow_id → workflow_definitions.id", sql: `ALTER TABLE "workflow_environment_configs" ADD CONSTRAINT "workflow_environment_configs_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action` },
];

const PHASE_1_PKS: Stmt[] = [
  { label: "agent_hierarchy composite PK", sql: `ALTER TABLE "agent_hierarchy" ADD CONSTRAINT "agent_hierarchy_ancestor_id_descendant_id_pk" PRIMARY KEY("ancestor_id","descendant_id")` },
  { label: "merchant_hierarchy composite PK", sql: `ALTER TABLE "merchant_hierarchy" ADD CONSTRAINT "merchant_hierarchy_ancestor_id_descendant_id_pk" PRIMARY KEY("ancestor_id","descendant_id")` },
  { label: "role_action_grants composite PK", sql: `ALTER TABLE "role_action_grants" ADD CONSTRAINT "role_action_grants_role_code_action_pk" PRIMARY KEY("role_code","action")` },
  { label: "user_preferences composite PK", sql: `ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_key_pk" PRIMARY KEY("user_id","key")` },
];

const PHASE_1_INDEXES: Stmt[] = [
  { label: "audit_logs(user_id)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id")` },
  { label: "audit_logs(action)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" USING btree ("action")` },
  { label: "audit_logs(resource)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource")` },
  { label: "audit_logs(ip_address)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_ip_address_idx" ON "audit_logs" USING btree ("ip_address")` },
  { label: "audit_logs(created_at)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at")` },
  { label: "audit_logs(risk_level)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_risk_level_idx" ON "audit_logs" USING btree ("risk_level")` },
  { label: "audit_logs(environment)", sql: `CREATE INDEX IF NOT EXISTS "audit_logs_environment_idx" ON "audit_logs" USING btree ("environment")` },
  { label: "api_request_logs(api_key_id)", sql: `CREATE INDEX IF NOT EXISTS "api_key_id_idx" ON "api_request_logs" USING btree ("api_key_id")` },
  { label: "api_request_logs(created_at)", sql: `CREATE INDEX IF NOT EXISTS "created_at_idx" ON "api_request_logs" USING btree ("created_at")` },
  { label: "data_access_logs(user_id)", sql: `CREATE INDEX IF NOT EXISTS "data_access_logs_user_id_idx" ON "data_access_logs" USING btree ("user_id")` },
  { label: "data_access_logs(data_type)", sql: `CREATE INDEX IF NOT EXISTS "data_access_logs_data_type_idx" ON "data_access_logs" USING btree ("data_type")` },
  { label: "data_access_logs(table_name)", sql: `CREATE INDEX IF NOT EXISTS "data_access_logs_table_name_idx" ON "data_access_logs" USING btree ("table_name")` },
  { label: "data_access_logs(access_type)", sql: `CREATE INDEX IF NOT EXISTS "data_access_logs_access_type_idx" ON "data_access_logs" USING btree ("access_type")` },
  { label: "data_access_logs(created_at)", sql: `CREATE INDEX IF NOT EXISTS "data_access_logs_created_at_idx" ON "data_access_logs" USING btree ("created_at")` },
  { label: "security_events(event_type)", sql: `CREATE INDEX IF NOT EXISTS "security_events_event_type_idx" ON "security_events" USING btree ("event_type")` },
  { label: "security_events(severity)", sql: `CREATE INDEX IF NOT EXISTS "security_events_severity_idx" ON "security_events" USING btree ("severity")` },
  { label: "security_events(alert_status)", sql: `CREATE INDEX IF NOT EXISTS "security_events_alert_status_idx" ON "security_events" USING btree ("alert_status")` },
  { label: "security_events(detected_at)", sql: `CREATE INDEX IF NOT EXISTS "security_events_detected_at_idx" ON "security_events" USING btree ("detected_at")` },
];

const PHASE_1_DEFAULTS: Stmt[] = [
  { label: "acquirer_application_templates.required_fields", sql: `ALTER TABLE "acquirer_application_templates" ALTER COLUMN "required_fields" SET DEFAULT ARRAY[]::text[]` },
  { label: "api_keys.permissions", sql: `ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DEFAULT '[]'` },
  { label: "equipment_items.specifications", sql: `ALTER TABLE "equipment_items" ALTER COLUMN "specifications" SET DEFAULT '{}'` },
  { label: "pdf_forms.allowed_roles", sql: `ALTER TABLE "pdf_forms" ALTER COLUMN "allowed_roles" SET DEFAULT '{"admin"}'` },
  { label: "prospect_applications.application_data", sql: `ALTER TABLE "prospect_applications" ALTER COLUMN "application_data" SET DEFAULT '{}'` },
  { label: "role_definitions.capabilities", sql: `ALTER TABLE "role_definitions" ALTER COLUMN "capabilities" SET DEFAULT ARRAY[]::text[]` },
  { label: "role_definitions.permissions", sql: `ALTER TABLE "role_definitions" ALTER COLUMN "permissions" SET DEFAULT ARRAY[]::text[]` },
  { label: "underwriting_phase_results.findings", sql: `ALTER TABLE "underwriting_phase_results" ALTER COLUMN "findings" SET DEFAULT '[]'` },
  { label: "user_dashboard_preferences.configuration", sql: `ALTER TABLE "user_dashboard_preferences" ALTER COLUMN "configuration" SET DEFAULT '{}'::jsonb` },
  { label: "users.permissions", sql: `ALTER TABLE "users" ALTER COLUMN "permissions" SET DEFAULT '{}'` },
  { label: "users.roles", sql: `ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT '{"merchant"}'` },
  { label: "workflow_definitions.allowed_roles", sql: `ALTER TABLE "workflow_definitions" ALTER COLUMN "allowed_roles" SET DEFAULT '{"admin"}'` },
  { label: "workflow_definitions.final_statuses", sql: `ALTER TABLE "workflow_definitions" ALTER COLUMN "final_statuses" SET DEFAULT ARRAY['approved'::text, 'declined'::text, 'withdrawn'::text]` },
  { label: "workflow_definitions.steps", sql: `ALTER TABLE "workflow_definitions" ALTER COLUMN "steps" SET DEFAULT '[]'` },
  { label: "workflow_definitions.trigger_config", sql: `ALTER TABLE "workflow_definitions" ALTER COLUMN "trigger_config" SET DEFAULT '{}'` },
  { label: "workflow_environment_configs.config", sql: `ALTER TABLE "workflow_environment_configs" ALTER COLUMN "config" SET DEFAULT '{}'` },
];

// ------------------------------------------------------------------ Phase 2
// Type changes audited safe.  Most are widenings (varchar(N) → varchar);
// the three "narrowings" (locations.mid, transactions.mid, environment) were
// confirmed against current data — affected columns are unbounded varchar
// containing no rows, or already varchar(50).
const PHASE_2_TYPES: Stmt[] = [
  { label: "action_templates.name → varchar", sql: `ALTER TABLE "action_templates" ALTER COLUMN "name" SET DATA TYPE varchar` },
  { label: "action_templates.action_type → varchar", sql: `ALTER TABLE "action_templates" ALTER COLUMN "action_type" SET DATA TYPE varchar` },
  { label: "action_templates.category → varchar", sql: `ALTER TABLE "action_templates" ALTER COLUMN "category" SET DATA TYPE varchar` },
  { label: "trigger_catalog.trigger_key → varchar", sql: `ALTER TABLE "trigger_catalog" ALTER COLUMN "trigger_key" SET DATA TYPE varchar` },
  { label: "trigger_catalog.name → varchar", sql: `ALTER TABLE "trigger_catalog" ALTER COLUMN "name" SET DATA TYPE varchar` },
  { label: "trigger_catalog.category → varchar", sql: `ALTER TABLE "trigger_catalog" ALTER COLUMN "category" SET DATA TYPE varchar` },
  { label: "action_activity.action_type → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "action_type" SET DATA TYPE varchar` },
  { label: "action_activity.recipient → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "recipient" SET DATA TYPE varchar` },
  { label: "action_activity.recipient_name → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "recipient_name" SET DATA TYPE varchar` },
  { label: "action_activity.status → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "status" SET DATA TYPE varchar` },
  { label: "action_activity.trigger_source → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "trigger_source" SET DATA TYPE varchar` },
  { label: "action_activity.triggered_by → varchar", sql: `ALTER TABLE "action_activity" ALTER COLUMN "triggered_by" SET DATA TYPE varchar` },
  { label: "sessions.expire → timestamp", sql: `ALTER TABLE "sessions" ALTER COLUMN "expire" SET DATA TYPE timestamp` },
  { label: "prospect_applications.assigned_reviewer_id → varchar", sql: `ALTER TABLE "prospect_applications" ALTER COLUMN "assigned_reviewer_id" SET DATA TYPE varchar` },
  // Underwriting user-id columns: schema declares unbounded varchar, DBs hold varchar(255). Pure widening.
  { label: "underwriting_runs.started_by → varchar", sql: `ALTER TABLE "underwriting_runs" ALTER COLUMN "started_by" SET DATA TYPE varchar` },
  { label: "underwriting_issues.resolved_by → varchar", sql: `ALTER TABLE "underwriting_issues" ALTER COLUMN "resolved_by" SET DATA TYPE varchar` },
  { label: "underwriting_tasks.assigned_to_user_id → varchar", sql: `ALTER TABLE "underwriting_tasks" ALTER COLUMN "assigned_to_user_id" SET DATA TYPE varchar` },
  { label: "underwriting_tasks.created_by → varchar", sql: `ALTER TABLE "underwriting_tasks" ALTER COLUMN "created_by" SET DATA TYPE varchar` },
  { label: "underwriting_notes.author_user_id → varchar", sql: `ALTER TABLE "underwriting_notes" ALTER COLUMN "author_user_id" SET DATA TYPE varchar` },
  { label: "underwriting_status_history.changed_by → varchar", sql: `ALTER TABLE "underwriting_status_history" ALTER COLUMN "changed_by" SET DATA TYPE varchar` },
  // Narrowings — audited safe (columns currently unbounded varchar, contain no rows that exceed target).
  { label: "locations.mid → varchar(50)", sql: `ALTER TABLE "locations" ALTER COLUMN "mid" SET DATA TYPE varchar(50)` },
  { label: "transactions.mid → varchar(50)", sql: `ALTER TABLE "transactions" ALTER COLUMN "mid" SET DATA TYPE varchar(50)` },
  { label: "workflow_environment_configs.environment → varchar(20)", sql: `ALTER TABLE "workflow_environment_configs" ALTER COLUMN "environment" SET DATA TYPE varchar(20)` },
];

// ------------------------------------------------------------------ Phase 3
// fee_* tables: id is `integer DEFAULT nextval(seq)` instead of `serial`.
// drizzle-kit's strategy is `truncate cascade` then `SET DATA TYPE serial`,
// which deletes data.  Postgres has no real difference between
// `integer DEFAULT nextval(seq) NOT NULL` (what we have) and
// `serial PRIMARY KEY` (what schema.ts declares) — `serial` is just sugar.
// We re-attach the existing sequence to the column with proper OWNED BY and
// drop+recreate the default in the canonical form.  This is a no-op at the
// data level; drizzle-kit will then see the column as `serial`-shaped.
const PHASE_3_SERIAL: Stmt[] = [
  // For each fee_* table: ensure sequence is owned by the column, then
  // ensure DEFAULT references the canonical sequence name. These statements
  // are no-ops if already aligned.
  { label: "fee_groups: align serial sequence",
    sql: `DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname='fee_groups_id_seq') THEN
              EXECUTE 'ALTER SEQUENCE fee_groups_id_seq OWNED BY fee_groups.id';
              EXECUTE 'ALTER TABLE fee_groups ALTER COLUMN id SET DEFAULT nextval(''fee_groups_id_seq''::regclass)';
            END IF;
          END $$` },
  { label: "fee_items: align serial sequence",
    sql: `DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname='fee_items_id_seq') THEN
              EXECUTE 'ALTER SEQUENCE fee_items_id_seq OWNED BY fee_items.id';
              EXECUTE 'ALTER TABLE fee_items ALTER COLUMN id SET DEFAULT nextval(''fee_items_id_seq''::regclass)';
            END IF;
          END $$` },
  { label: "fee_item_groups: align serial sequence",
    sql: `DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname='fee_item_groups_id_seq') THEN
              EXECUTE 'ALTER SEQUENCE fee_item_groups_id_seq OWNED BY fee_item_groups.id';
              EXECUTE 'ALTER TABLE fee_item_groups ALTER COLUMN id SET DEFAULT nextval(''fee_item_groups_id_seq''::regclass)';
            END IF;
          END $$` },
  { label: "fee_group_fee_items: align serial sequence",
    sql: `DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname='fee_group_fee_items_id_seq') THEN
              EXECUTE 'ALTER SEQUENCE fee_group_fee_items_id_seq OWNED BY fee_group_fee_items.id';
              EXECUTE 'ALTER TABLE fee_group_fee_items ALTER COLUMN id SET DEFAULT nextval(''fee_group_fee_items_id_seq''::regclass)';
            END IF;
          END $$` },
];

// ------------------------------------------------------------------ Phase 4
// Numeric precision tightenings.  All target columns confirmed empty.
const PHASE_4_NUMERIC: Stmt[] = [
  { label: "merchants.monthly_volume → numeric(12,2)", sql: `ALTER TABLE "merchants" ALTER COLUMN "monthly_volume" SET DATA TYPE numeric(12, 2)` },
  { label: "merchants.processing_fee → numeric(5,2)", sql: `ALTER TABLE "merchants" ALTER COLUMN "processing_fee" SET DATA TYPE numeric(5, 2)` },
  { label: "transactions.amount → numeric(12,2)", sql: `ALTER TABLE "transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 2)` },
  { label: "transactions.commission_rate → numeric(5,4)", sql: `ALTER TABLE "transactions" ALTER COLUMN "commission_rate" SET DATA TYPE numeric(5, 4)` },
  { label: "transactions.commission_amount → numeric(12,2)", sql: `ALTER TABLE "transactions" ALTER COLUMN "commission_amount" SET DATA TYPE numeric(12, 2)` },
  { label: "transactions.processing_fee → numeric(12,2)", sql: `ALTER TABLE "transactions" ALTER COLUMN "processing_fee" SET DATA TYPE numeric(12, 2)` },
  { label: "transactions.net_amount → numeric(12,2)", sql: `ALTER TABLE "transactions" ALTER COLUMN "net_amount" SET DATA TYPE numeric(12, 2)` },
];

// ------------------------------------------------------------------ Phase 5
// Unique constraints declared in schema.ts but missing in some DBs.
const PHASE_5_UNIQUES: Stmt[] = [
  { label: "external_endpoints.name unique",
    sql: `ALTER TABLE "external_endpoints" ADD CONSTRAINT "external_endpoints_name_unique" UNIQUE("name")` },
];


// ------------------------------------------------------------------ Phase 6
// FKs that were declared in earlier schema versions but later removed from
// shared/schema.ts. Dev DB still carries them (drizzle-kit push never drops
// constraints without explicit data-loss confirmation), so dev had 50 extra
// FKs vs schema (141 vs 81). Re-added to schema.ts and now to test/prod so
// all environments enforce the same referential integrity.
const PHASE_6_FKS: Stmt[] = [
  { label: "action_activity.action_template_id → action_templates.id (NO ACTION)",
    sql: "ALTER TABLE \"action_activity\" ADD CONSTRAINT \"action_activity_action_template_id_action_templates_id_fk\" FOREIGN KEY (\"action_template_id\") REFERENCES \"action_templates\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "action_activity.trigger_action_id → trigger_actions.id (NO ACTION)",
    sql: "ALTER TABLE \"action_activity\" ADD CONSTRAINT \"action_activity_trigger_action_id_trigger_actions_id_fk\" FOREIGN KEY (\"trigger_action_id\") REFERENCES \"trigger_actions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "action_activity.trigger_id → trigger_catalog.id (NO ACTION)",
    sql: "ALTER TABLE \"action_activity\" ADD CONSTRAINT \"action_activity_trigger_id_trigger_catalog_id_fk\" FOREIGN KEY (\"trigger_id\") REFERENCES \"trigger_catalog\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "agents.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"agents\" ADD CONSTRAINT \"agents_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "agents.parent_agent_id → agents.id (SET NULL)",
    sql: "ALTER TABLE \"agents\" ADD CONSTRAINT \"agents_parent_agent_id_agents_id_fk\" FOREIGN KEY (\"parent_agent_id\") REFERENCES \"agents\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "campaign_fee_values.fee_group_fee_item_id → fee_group_fee_items.id (CASCADE)",
    sql: "ALTER TABLE \"campaign_fee_values\" ADD CONSTRAINT \"campaign_fee_values_fee_group_fee_item_id_fee_group_fee_items_i\" FOREIGN KEY (\"fee_group_fee_item_id\") REFERENCES \"fee_group_fee_items\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "campaigns.acquirer_id → acquirers.id (NO ACTION)",
    sql: "ALTER TABLE \"campaigns\" ADD CONSTRAINT \"campaigns_acquirer_id_acquirers_id_fk\" FOREIGN KEY (\"acquirer_id\") REFERENCES \"acquirers\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "company_addresses.address_id → addresses.id (CASCADE)",
    sql: "ALTER TABLE \"company_addresses\" ADD CONSTRAINT \"company_addresses_address_id_addresses_id_fk\" FOREIGN KEY (\"address_id\") REFERENCES \"addresses\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "company_addresses.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"company_addresses\" ADD CONSTRAINT \"company_addresses_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "disclosure_acknowledgments.prospect_id → merchant_prospects.id (CASCADE)",
    sql: "ALTER TABLE \"disclosure_acknowledgments\" ADD CONSTRAINT \"disclosure_acknowledgments_prospect_id_merchant_prospects_id_fk\" FOREIGN KEY (\"prospect_id\") REFERENCES \"merchant_prospects\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "disclosure_contents.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"disclosure_contents\" ADD CONSTRAINT \"disclosure_contents_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "disclosure_definitions.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"disclosure_definitions\" ADD CONSTRAINT \"disclosure_definitions_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "disclosure_signatures.disclosure_version_id → disclosure_versions.id (RESTRICT)",
    sql: "ALTER TABLE \"disclosure_signatures\" ADD CONSTRAINT \"disclosure_signatures_disclosure_version_id_disclosure_versions\" FOREIGN KEY (\"disclosure_version_id\") REFERENCES \"disclosure_versions\"(\"id\") ON DELETE RESTRICT ON UPDATE NO ACTION" },
  { label: "disclosure_signatures.prospect_id → merchant_prospects.id (SET NULL)",
    sql: "ALTER TABLE \"disclosure_signatures\" ADD CONSTRAINT \"disclosure_signatures_prospect_id_merchant_prospects_id_fk\" FOREIGN KEY (\"prospect_id\") REFERENCES \"merchant_prospects\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "disclosure_signatures.revoked_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"disclosure_signatures\" ADD CONSTRAINT \"disclosure_signatures_revoked_by_users_id_fk\" FOREIGN KEY (\"revoked_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "disclosure_signatures.template_id → acquirer_application_templates.id (SET NULL)",
    sql: "ALTER TABLE \"disclosure_signatures\" ADD CONSTRAINT \"disclosure_signatures_template_id_acquirer_application_template\" FOREIGN KEY (\"template_id\") REFERENCES \"acquirer_application_templates\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "disclosure_signatures.user_id → users.id (SET NULL)",
    sql: "ALTER TABLE \"disclosure_signatures\" ADD CONSTRAINT \"disclosure_signatures_user_id_users_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"users\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "fee_items.fee_item_group_id → fee_item_groups.id (CASCADE)",
    sql: "ALTER TABLE \"fee_items\" ADD CONSTRAINT \"fee_items_fee_item_group_id_fee_item_groups_id_fk\" FOREIGN KEY (\"fee_item_group_id\") REFERENCES \"fee_item_groups\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "locations.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"locations\" ADD CONSTRAINT \"locations_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "merchant_prospects.user_id → users.id (SET NULL)",
    sql: "ALTER TABLE \"merchant_prospects\" ADD CONSTRAINT \"merchant_prospects_user_id_users_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"users\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "merchants.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"merchants\" ADD CONSTRAINT \"merchants_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "merchants.parent_merchant_id → merchants.id (SET NULL)",
    sql: "ALTER TABLE \"merchants\" ADD CONSTRAINT \"merchants_parent_merchant_id_merchants_id_fk\" FOREIGN KEY (\"parent_merchant_id\") REFERENCES \"merchants\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "password_history.user_id → users.id (CASCADE)",
    sql: "ALTER TABLE \"password_history\" ADD CONSTRAINT \"password_history_user_id_users_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "permission_audit_log.actor_user_id → users.id (NO ACTION)",
    sql: "ALTER TABLE \"permission_audit_log\" ADD CONSTRAINT \"permission_audit_log_actor_user_id_users_id_fk\" FOREIGN KEY (\"actor_user_id\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "permission_audit_log.resource_id → rbac_resources.id (NO ACTION)",
    sql: "ALTER TABLE \"permission_audit_log\" ADD CONSTRAINT \"permission_audit_log_resource_id_rbac_resources_id_fk\" FOREIGN KEY (\"resource_id\") REFERENCES \"rbac_resources\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "pricing_type_fee_items.fee_group_id → fee_groups.id (CASCADE)",
    sql: "ALTER TABLE \"pricing_type_fee_items\" ADD CONSTRAINT \"pricing_type_fee_items_fee_group_id_fee_groups_id_fk\" FOREIGN KEY (\"fee_group_id\") REFERENCES \"fee_groups\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "prospect_documents.prospect_id → merchant_prospects.id (CASCADE)",
    sql: "ALTER TABLE \"prospect_documents\" ADD CONSTRAINT \"prospect_documents_prospect_id_merchant_prospects_id_fk\" FOREIGN KEY (\"prospect_id\") REFERENCES \"merchant_prospects\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "prospect_documents.uploaded_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"prospect_documents\" ADD CONSTRAINT \"prospect_documents_uploaded_by_users_id_fk\" FOREIGN KEY (\"uploaded_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "prospect_messages.agent_id → agents.id (SET NULL)",
    sql: "ALTER TABLE \"prospect_messages\" ADD CONSTRAINT \"prospect_messages_agent_id_agents_id_fk\" FOREIGN KEY (\"agent_id\") REFERENCES \"agents\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION" },
  { label: "prospect_messages.sender_id → users.id (CASCADE)",
    sql: "ALTER TABLE \"prospect_messages\" ADD CONSTRAINT \"prospect_messages_sender_id_users_id_fk\" FOREIGN KEY (\"sender_id\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "prospect_notifications.created_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"prospect_notifications\" ADD CONSTRAINT \"prospect_notifications_created_by_users_id_fk\" FOREIGN KEY (\"created_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "prospect_notifications.prospect_id → merchant_prospects.id (CASCADE)",
    sql: "ALTER TABLE \"prospect_notifications\" ADD CONSTRAINT \"prospect_notifications_prospect_id_merchant_prospects_id_fk\" FOREIGN KEY (\"prospect_id\") REFERENCES \"merchant_prospects\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "role_permissions.granted_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"role_permissions\" ADD CONSTRAINT \"role_permissions_granted_by_users_id_fk\" FOREIGN KEY (\"granted_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "role_permissions.resource_id → rbac_resources.id (CASCADE)",
    sql: "ALTER TABLE \"role_permissions\" ADD CONSTRAINT \"role_permissions_resource_id_rbac_resources_id_fk\" FOREIGN KEY (\"resource_id\") REFERENCES \"rbac_resources\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "signature_captures.application_id → prospect_applications.id (CASCADE)",
    sql: "ALTER TABLE \"signature_captures\" ADD CONSTRAINT \"signature_captures_application_id_prospect_applications_id_fk\" FOREIGN KEY (\"application_id\") REFERENCES \"prospect_applications\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "signature_captures.prospect_id → merchant_prospects.id (CASCADE)",
    sql: "ALTER TABLE \"signature_captures\" ADD CONSTRAINT \"signature_captures_prospect_id_merchant_prospects_id_fk\" FOREIGN KEY (\"prospect_id\") REFERENCES \"merchant_prospects\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "signature_disclosure_links.disclosure_definition_id → disclosure_definitions.id (NO ACTION)",
    sql: "ALTER TABLE \"signature_disclosure_links\" ADD CONSTRAINT \"signature_disclosure_links_disclosure_definition_id_disclosure_\" FOREIGN KEY (\"disclosure_definition_id\") REFERENCES \"disclosure_definitions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "signature_disclosure_links.disclosure_version_id → disclosure_versions.id (NO ACTION)",
    sql: "ALTER TABLE \"signature_disclosure_links\" ADD CONSTRAINT \"signature_disclosure_links_disclosure_version_id_disclosure_ver\" FOREIGN KEY (\"disclosure_version_id\") REFERENCES \"disclosure_versions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "signature_disclosure_links.signature_capture_id → signature_captures.id (CASCADE)",
    sql: "ALTER TABLE \"signature_disclosure_links\" ADD CONSTRAINT \"signature_disclosure_links_signature_capture_id_signature_captu\" FOREIGN KEY (\"signature_capture_id\") REFERENCES \"signature_captures\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "signature_requests.application_id → prospect_applications.id (CASCADE)",
    sql: "ALTER TABLE \"signature_requests\" ADD CONSTRAINT \"signature_requests_application_id_prospect_applications_id_fk\" FOREIGN KEY (\"application_id\") REFERENCES \"prospect_applications\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "signature_requests.created_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"signature_requests\" ADD CONSTRAINT \"signature_requests_created_by_users_id_fk\" FOREIGN KEY (\"created_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "signature_requests.signature_capture_id → signature_captures.id (CASCADE)",
    sql: "ALTER TABLE \"signature_requests\" ADD CONSTRAINT \"signature_requests_signature_capture_id_signature_captures_id_f\" FOREIGN KEY (\"signature_capture_id\") REFERENCES \"signature_captures\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "stage_api_configs.created_by → users.id (NO ACTION)",
    sql: "ALTER TABLE \"stage_api_configs\" ADD CONSTRAINT \"stage_api_configs_created_by_users_id_fk\" FOREIGN KEY (\"created_by\") REFERENCES \"users\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "stage_api_configs.integration_id → api_integration_configs.id (NO ACTION)",
    sql: "ALTER TABLE \"stage_api_configs\" ADD CONSTRAINT \"stage_api_configs_integration_id_api_integration_configs_id_fk\" FOREIGN KEY (\"integration_id\") REFERENCES \"api_integration_configs\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION" },
  { label: "stage_api_configs.stage_id → workflow_stages.id (CASCADE)",
    sql: "ALTER TABLE \"stage_api_configs\" ADD CONSTRAINT \"stage_api_configs_stage_id_workflow_stages_id_fk\" FOREIGN KEY (\"stage_id\") REFERENCES \"workflow_stages\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "user_alerts.action_activity_id → action_activity.id (CASCADE)",
    sql: "ALTER TABLE \"user_alerts\" ADD CONSTRAINT \"user_alerts_action_activity_id_action_activity_id_fk\" FOREIGN KEY (\"action_activity_id\") REFERENCES \"action_activity\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "user_alerts.user_id → users.id (CASCADE)",
    sql: "ALTER TABLE \"user_alerts\" ADD CONSTRAINT \"user_alerts_user_id_users_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "user_company_associations.company_id → companies.id (CASCADE)",
    sql: "ALTER TABLE \"user_company_associations\" ADD CONSTRAINT \"user_company_associations_company_id_companies_id_fk\" FOREIGN KEY (\"company_id\") REFERENCES \"companies\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "user_company_associations.user_id → users.id (CASCADE)",
    sql: "ALTER TABLE \"user_company_associations\" ADD CONSTRAINT \"user_company_associations_user_id_users_id_fk\" FOREIGN KEY (\"user_id\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
  { label: "workflow_stages.workflow_definition_id → workflow_definitions.id (CASCADE)",
    sql: "ALTER TABLE \"workflow_stages\" ADD CONSTRAINT \"workflow_stages_workflow_definition_id_workflow_definitions_id_\" FOREIGN KEY (\"workflow_definition_id\") REFERENCES \"workflow_definitions\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION" },
];



// ------------------------------------------------------------------ Phase 7
// Duplicate FK cleanup. dev and test have legacy duplicate FK constraints
// (the same column→column relationship enforced twice with different names).
// Drop the older "_fkey" / short variants, keeping the canonical drizzle "_fk"
// name that matches schema.ts. Idempotent via "IF EXISTS".
const PHASE_7_DROP_DUPS: Stmt[] = [
  { label: "drop dup FK action_templates.action_templates_endpoint_id_fkey",
    sql: "ALTER TABLE \"action_templates\" DROP CONSTRAINT IF EXISTS \"action_templates_endpoint_id_fkey\"" },
  { label: "drop dup FK agent_hierarchy.agent_hierarchy_ancestor_id_fkey",
    sql: "ALTER TABLE \"agent_hierarchy\" DROP CONSTRAINT IF EXISTS \"agent_hierarchy_ancestor_id_fkey\"" },
  { label: "drop dup FK agent_hierarchy.agent_hierarchy_descendant_id_fkey",
    sql: "ALTER TABLE \"agent_hierarchy\" DROP CONSTRAINT IF EXISTS \"agent_hierarchy_descendant_id_fkey\"" },
  { label: "drop dup FK agents.agents_parent_agent_fk",
    sql: "ALTER TABLE \"agents\" DROP CONSTRAINT IF EXISTS \"agents_parent_agent_fk\"" },
  { label: "drop dup FK merchant_hierarchy.merchant_hierarchy_ancestor_id_fkey",
    sql: "ALTER TABLE \"merchant_hierarchy\" DROP CONSTRAINT IF EXISTS \"merchant_hierarchy_ancestor_id_fkey\"" },
  { label: "drop dup FK merchant_hierarchy.merchant_hierarchy_descendant_id_fkey",
    sql: "ALTER TABLE \"merchant_hierarchy\" DROP CONSTRAINT IF EXISTS \"merchant_hierarchy_descendant_id_fkey\"" },
  { label: "drop dup FK merchants.merchants_parent_merchant_fk",
    sql: "ALTER TABLE \"merchants\" DROP CONSTRAINT IF EXISTS \"merchants_parent_merchant_fk\"" },
  { label: "drop dup FK password_history.password_history_user_id_fkey",
    sql: "ALTER TABLE \"password_history\" DROP CONSTRAINT IF EXISTS \"password_history_user_id_fkey\"" },
  { label: "drop dup FK portal_magic_links.portal_magic_links_prospect_id_fkey",
    sql: "ALTER TABLE \"portal_magic_links\" DROP CONSTRAINT IF EXISTS \"portal_magic_links_prospect_id_fkey\"" },
  { label: "drop dup FK pricing_type_fee_items.pricing_type_fee_items_fee_group_id_fkey",
    sql: "ALTER TABLE \"pricing_type_fee_items\" DROP CONSTRAINT IF EXISTS \"pricing_type_fee_items_fee_group_id_fkey\"" },
  { label: "drop dup FK prospect_file_requests.prospect_file_requests_prospect_id_fkey",
    sql: "ALTER TABLE \"prospect_file_requests\" DROP CONSTRAINT IF EXISTS \"prospect_file_requests_prospect_id_fkey\"" },
  { label: "drop dup FK scheduled_report_runs.scheduled_report_runs_report_id_fkey",
    sql: "ALTER TABLE \"scheduled_report_runs\" DROP CONSTRAINT IF EXISTS \"scheduled_report_runs_report_id_fkey\"" },
  { label: "drop dup FK stage_api_configs.stage_api_configs_endpoint_id_fkey",
    sql: "ALTER TABLE \"stage_api_configs\" DROP CONSTRAINT IF EXISTS \"stage_api_configs_endpoint_id_fkey\"" },
  { label: "drop dup FK workflow_environment_configs.workflow_environment_configs_workflow_id_fkey",
    sql: "ALTER TABLE \"workflow_environment_configs\" DROP CONSTRAINT IF EXISTS \"workflow_environment_configs_workflow_id_fkey\"" },
];


// ------------------------------------------------------------------ Phase 8
// Backfill 6 unique constraints that exist in dev (and in shared/schema.ts via
// .unique() modifiers) but were never propagated to test/prod. Verified zero
// duplicate values in test and prod before adding. Idempotent via DO block
// guard on pg_constraint.conname.
const PHASE_8_UNIQUES: Stmt[] = [
  { label: "add unique disclosure_contents(slug) as disclosure_contents_slug_unique",
    sql: "ALTER TABLE \"disclosure_contents\" ADD CONSTRAINT \"disclosure_contents_slug_unique\" UNIQUE (\"slug\")" },
  { label: "add unique disclosure_contents(slug, version) as disclosure_contents_slug_version_unique",
    sql: "ALTER TABLE \"disclosure_contents\" ADD CONSTRAINT \"disclosure_contents_slug_version_unique\" UNIQUE (\"slug\", \"version\")" },
  { label: "add unique prospect_documents(storage_key) as prospect_documents_storage_key_unique",
    sql: "ALTER TABLE \"prospect_documents\" ADD CONSTRAINT \"prospect_documents_storage_key_unique\" UNIQUE (\"storage_key\")" },
  { label: "add unique schema_migrations(migration_id) as schema_migrations_migration_id_key",
    sql: "ALTER TABLE \"schema_migrations\" ADD CONSTRAINT \"schema_migrations_migration_id_key\" UNIQUE (\"migration_id\")" },
  { label: "add unique signature_captures(request_token) as signature_captures_request_token_unique",
    sql: "ALTER TABLE \"signature_captures\" ADD CONSTRAINT \"signature_captures_request_token_unique\" UNIQUE (\"request_token\")" },
  { label: "add unique signature_requests(request_token) as signature_requests_request_token_unique",
    sql: "ALTER TABLE \"signature_requests\" ADD CONSTRAINT \"signature_requests_request_token_unique\" UNIQUE (\"request_token\")" },
];

const PHASES: Record<string, { name: string; stmts: Stmt[] }> = {
  "1": { name: "Additive constraints (FKs / PKs / indexes / defaults)",
         stmts: [...PHASE_1_FKS, ...PHASE_1_PKS, ...PHASE_1_INDEXES, ...PHASE_1_DEFAULTS] },
  "2": { name: "Cosmetic type changes (audited safe)", stmts: PHASE_2_TYPES },
  "3": { name: "fee_* serial sequence alignment", stmts: PHASE_3_SERIAL },
  "4": { name: "Numeric precision (empty-table tightening)", stmts: PHASE_4_NUMERIC },
  "5": { name: "Unique constraints", stmts: PHASE_5_UNIQUES },
  "6": { name: "Re-introduced FKs (dev had, schema lost)", stmts: PHASE_6_FKS },
  "7": { name: "Drop duplicate FKs (older _fkey / short names)", stmts: PHASE_7_DROP_DUPS },
  "8": { name: "Backfill missing unique constraints in test/prod", stmts: PHASE_8_UNIQUES },
};

// db-tier-allow: schema migration script
async function runStmt(env: Env, s: Stmt): Promise<"applied" | "exists" | "error"> {
  const db = getDynamicDatabase(env);
  try {
    await db.execute(dsql.raw(`SET lock_timeout = '5s'`));
    await db.execute(dsql.raw(s.sql));
    return "applied";
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    // 42710 duplicate_object, 42P07 duplicate_table, 42P16 invalid_table_definition (PK exists)
    if (code === "42710" || code === "42P07" ||
        /already exists|multiple primary keys/i.test(msg)) {
      return "exists";
    }
    console.log(`    ✗ [${env}] ${s.label}\n      ${msg.slice(0, 200)}`);
    return "error";
  }
}

async function reportDriftCounts(env: Env) {
  const db = getDynamicDatabase(env);
  const fk = await db.execute(dsql.raw(`SELECT COUNT(*)::int AS n FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'`));
  const idx = await db.execute(dsql.raw(`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname='public'`));
  const fkN = (fk.rows[0] as { n: number }).n;
  const idxN = (idx.rows[0] as { n: number }).n;
  console.log(`  📊 [${env}] FKs=${fkN}  indexes=${idxN}`);
}

async function main() {
  const env = (process.argv[2] as Env) || "development";
  const phaseList = (process.argv[3] || "1,2,3,4,5,6,7,8").split(",").map(s => s.trim());
  if (!["development", "test", "production"].includes(env)) {
    console.error(`Invalid env "${env}" (development | test | production)`); process.exit(2);
  }
  console.log(`\n=== Schema-drift reconciliation: ${env} ===`);
  console.log(`Phases: ${phaseList.join(", ")}\n`);

  console.log("Before:");
  await reportDriftCounts(env);

  const totals = { applied: 0, exists: 0, error: 0 };
  for (const p of phaseList) {
    const phase = PHASES[p];
    if (!phase) { console.log(`  (skipping unknown phase "${p}")`); continue; }
    console.log(`\n--- Phase ${p}: ${phase.name} (${phase.stmts.length} statements) ---`);
    for (const s of phase.stmts) {
      const r = await runStmt(env, s);
      totals[r] += 1;
      if (r === "applied") console.log(`    ✓ ${s.label}`);
      else if (r === "exists") console.log(`    · ${s.label} (already present)`);
    }
  }

  console.log(`\nResults: applied=${totals.applied}  already-present=${totals.exists}  errors=${totals.error}`);
  console.log("\nAfter:");
  await reportDriftCounts(env);
  process.exit(totals.error > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
