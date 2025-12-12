-- Schema Synchronization: development → test
-- Generated: 2025-12-12T18:31:24.779Z
-- Total statements: 26

BEGIN;

CREATE SEQUENCE IF NOT EXISTS api_integration_configs_id_seq;
CREATE TABLE IF NOT EXISTS api_integration_configs (
  id INTEGER NOT NULL DEFAULT nextval('api_integration_configs_id_seq'::regclass),
  integration_key CHARACTER VARYING NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  sandbox_url TEXT,
  configuration JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  use_sandbox BOOLEAN NOT NULL DEFAULT true,
  rate_limit INTEGER,
  rate_limit_window INTEGER DEFAULT 60,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS mcc_policies_id_seq;
CREATE TABLE IF NOT EXISTS mcc_policies (
  id INTEGER NOT NULL DEFAULT nextval('mcc_policies_id_seq'::regclass),
  mcc_code CHARACTER VARYING NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  acquirer_id INTEGER,
  risk_level TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by CHARACTER VARYING,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS volume_thresholds_id_seq;
CREATE TABLE IF NOT EXISTS volume_thresholds (
  id INTEGER NOT NULL DEFAULT nextval('volume_thresholds_id_seq'::regclass),
  acquirer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  max_monthly_volume NUMERIC,
  min_card_present_percent NUMERIC,
  max_high_ticket NUMERIC,
  requires_approved_mcc BOOLEAN NOT NULL DEFAULT false,
  risk_tier TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by CHARACTER VARYING,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_artifacts_id_seq;
CREATE TABLE IF NOT EXISTS workflow_artifacts (
  id INTEGER NOT NULL DEFAULT nextval('workflow_artifacts_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  ticket_stage_id INTEGER,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  file_path TEXT,
  artifact_type TEXT NOT NULL,
  category TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active'::text,
  uploaded_by CHARACTER VARYING,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_assignments_id_seq;
CREATE TABLE IF NOT EXISTS workflow_assignments (
  id INTEGER NOT NULL DEFAULT nextval('workflow_assignments_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  assigned_to_id CHARACTER VARYING NOT NULL,
  assigned_by_id CHARACTER VARYING,
  assignment_type TEXT NOT NULL DEFAULT 'primary'::text,
  assigned_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMP WITHOUT TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_definitions_id_seq;
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id INTEGER NOT NULL DEFAULT nextval('workflow_definitions_id_seq'::regclass),
  code CHARACTER VARYING NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0'::text,
  category TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  initial_status TEXT NOT NULL DEFAULT 'submitted'::text,
  final_statuses ARRAY NOT NULL DEFAULT ARRAY['approved'::text, 'declined'::text, 'withdrawn'::text],
  configuration JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by CHARACTER VARYING,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_issues_id_seq;
CREATE TABLE IF NOT EXISTS workflow_issues (
  id INTEGER NOT NULL DEFAULT nextval('workflow_issues_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  ticket_stage_id INTEGER,
  issue_code CHARACTER VARYING NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'::text,
  title TEXT NOT NULL,
  description TEXT,
  affected_field TEXT,
  affected_entity TEXT,
  affected_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'::text,
  resolution TEXT,
  resolved_at TIMESTAMP WITHOUT TIME ZONE,
  resolved_by CHARACTER VARYING,
  override_reason TEXT,
  overridden_at TIMESTAMP WITHOUT TIME ZONE,
  overridden_by CHARACTER VARYING,
  score_impact INTEGER,
  source_data JSONB,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_notes_id_seq;
CREATE TABLE IF NOT EXISTS workflow_notes (
  id INTEGER NOT NULL DEFAULT nextval('workflow_notes_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  ticket_stage_id INTEGER,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'general'::text,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_by CHARACTER VARYING NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_stages_id_seq;
CREATE TABLE IF NOT EXISTS workflow_stages (
  id INTEGER NOT NULL DEFAULT nextval('workflow_stages_id_seq'::regclass),
  workflow_definition_id INTEGER NOT NULL,
  code CHARACTER VARYING NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL,
  stage_type TEXT NOT NULL DEFAULT 'automated'::text,
  handler_key TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  auto_advance BOOLEAN NOT NULL DEFAULT true,
  issue_blocks_severity TEXT,
  timeout_minutes INTEGER,
  retry_config JSONB,
  configuration JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_tasks_id_seq;
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id INTEGER NOT NULL DEFAULT nextval('workflow_tasks_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  issue_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'action'::text,
  assigned_to_id CHARACTER VARYING,
  assigned_to_role TEXT,
  assigned_at TIMESTAMP WITHOUT TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending'::text,
  priority TEXT NOT NULL DEFAULT 'normal'::text,
  due_at TIMESTAMP WITHOUT TIME ZONE,
  completed_at TIMESTAMP WITHOUT TIME ZONE,
  completed_by CHARACTER VARYING,
  completion_notes TEXT,
  created_by CHARACTER VARYING,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_ticket_stages_id_seq;
CREATE TABLE IF NOT EXISTS workflow_ticket_stages (
  id INTEGER NOT NULL DEFAULT nextval('workflow_ticket_stages_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  stage_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'::text,
  result TEXT,
  started_at TIMESTAMP WITHOUT TIME ZONE,
  completed_at TIMESTAMP WITHOUT TIME ZONE,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMP WITHOUT TIME ZONE,
  last_executed_by CHARACTER VARYING,
  handler_response JSONB,
  error_message TEXT,
  reviewed_at TIMESTAMP WITHOUT TIME ZONE,
  reviewed_by CHARACTER VARYING,
  review_notes TEXT,
  review_decision TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_tickets_id_seq;
CREATE TABLE IF NOT EXISTS workflow_tickets (
  id INTEGER NOT NULL DEFAULT nextval('workflow_tickets_id_seq'::regclass),
  ticket_number CHARACTER VARYING NOT NULL,
  workflow_definition_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'::text,
  sub_status TEXT,
  current_stage_id INTEGER,
  priority TEXT NOT NULL DEFAULT 'normal'::text,
  risk_level TEXT,
  risk_score INTEGER,
  assigned_to_id CHARACTER VARYING,
  assigned_at TIMESTAMP WITHOUT TIME ZONE,
  submitted_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITHOUT TIME ZONE,
  completed_at TIMESTAMP WITHOUT TIME ZONE,
  due_at TIMESTAMP WITHOUT TIME ZONE,
  last_reviewed_at TIMESTAMP WITHOUT TIME ZONE,
  last_reviewed_by CHARACTER VARYING,
  review_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE SEQUENCE IF NOT EXISTS workflow_transitions_id_seq;
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id INTEGER NOT NULL DEFAULT nextval('workflow_transitions_id_seq'::regclass),
  ticket_id INTEGER NOT NULL,
  transition_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  from_stage_id INTEGER,
  to_stage_id INTEGER,
  reason TEXT,
  notes TEXT,
  triggered_by CHARACTER VARYING,
  triggered_by_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMIT;

-- Verification query:
-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;