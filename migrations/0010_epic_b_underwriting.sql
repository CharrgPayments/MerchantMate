-- Epic B — Underwriting Engine
-- Adds 6 underwriting tables and extends prospect_applications with state-machine columns.
-- Idempotent: safe to re-run.

ALTER TABLE prospect_applications
  ADD COLUMN IF NOT EXISTS sub_status              text,
  ADD COLUMN IF NOT EXISTS underwriting_type       text NOT NULL DEFAULT 'new_app',
  ADD COLUMN IF NOT EXISTS risk_score              integer,
  ADD COLUMN IF NOT EXISTS risk_tier               text,
  ADD COLUMN IF NOT EXISTS assigned_reviewer_id    varchar(255);

CREATE TABLE IF NOT EXISTS underwriting_runs (
  id               serial PRIMARY KEY,
  application_id   integer NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  started_by       varchar(255),
  status           text NOT NULL DEFAULT 'running',
  current_phase    text,
  total_phases     integer NOT NULL DEFAULT 10,
  risk_score       integer,
  risk_tier        text,
  error_message    text,
  started_at       timestamp NOT NULL DEFAULT now(),
  completed_at     timestamp
);
CREATE INDEX IF NOT EXISTS idx_uw_runs_app  ON underwriting_runs(application_id);
CREATE INDEX IF NOT EXISTS idx_uw_runs_stat ON underwriting_runs(status);

CREATE TABLE IF NOT EXISTS underwriting_phase_results (
  id                serial PRIMARY KEY,
  run_id            integer NOT NULL REFERENCES underwriting_runs(id) ON DELETE CASCADE,
  phase_key         text NOT NULL,
  phase_order       integer NOT NULL,
  status            text NOT NULL,
  score             integer NOT NULL DEFAULT 0,
  findings          jsonb DEFAULT '[]'::jsonb,
  endpoint_id       integer REFERENCES workflow_endpoints(id),
  external_request  jsonb,
  external_response jsonb,
  duration_ms       integer,
  started_at        timestamp NOT NULL DEFAULT now(),
  completed_at      timestamp
);
CREATE INDEX IF NOT EXISTS idx_uw_phase_run ON underwriting_phase_results(run_id);

CREATE TABLE IF NOT EXISTS underwriting_issues (
  id              serial PRIMARY KEY,
  application_id  integer NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  run_id          integer REFERENCES underwriting_runs(id) ON DELETE SET NULL,
  phase_key       text,
  severity        text NOT NULL DEFAULT 'warning',
  code            text NOT NULL,
  message         text NOT NULL,
  field_path      text,
  status          text NOT NULL DEFAULT 'open',
  resolved_by     varchar(255),
  resolved_at     timestamp,
  resolution_note text,
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uw_issues_app ON underwriting_issues(application_id);
CREATE INDEX IF NOT EXISTS idx_uw_issues_open ON underwriting_issues(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS underwriting_tasks (
  id                  serial PRIMARY KEY,
  application_id      integer NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  assigned_to_user_id varchar(255),
  assigned_role       text,
  title               text NOT NULL,
  description         text,
  due_at              timestamp,
  status              text NOT NULL DEFAULT 'open',
  created_by          varchar(255),
  completed_at        timestamp,
  created_at          timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uw_tasks_app ON underwriting_tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_uw_tasks_assignee ON underwriting_tasks(assigned_to_user_id);

CREATE TABLE IF NOT EXISTS underwriting_notes (
  id              serial PRIMARY KEY,
  application_id  integer NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  author_user_id  varchar(255),
  body            text NOT NULL,
  visibility      text NOT NULL DEFAULT 'internal',
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uw_notes_app ON underwriting_notes(application_id);

CREATE TABLE IF NOT EXISTS underwriting_status_history (
  id               serial PRIMARY KEY,
  application_id   integer NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  from_status      text,
  to_status        text NOT NULL,
  from_sub_status  text,
  to_sub_status    text,
  changed_by       varchar(255),
  reason           text,
  created_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uw_history_app ON underwriting_status_history(application_id);
