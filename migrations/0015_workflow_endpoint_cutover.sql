-- Workflow Endpoint Cutover (Task #33)
-- Adds nullable FK from stage_api_configs → external_endpoints so workflow
-- stages can reference a transport row in the shared registry instead of
-- inlining url/method/headers/auth on the row. The legacy inline columns
-- (endpoint_url, http_method, headers, auth_type, auth_secret_key) remain
-- in place as fallback; cleanup is deferred to a follow-up task.

ALTER TABLE stage_api_configs
  ADD COLUMN IF NOT EXISTS endpoint_id integer
  REFERENCES external_endpoints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stage_api_configs_endpoint_id
  ON stage_api_configs(endpoint_id);
