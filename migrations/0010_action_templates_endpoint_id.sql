-- Communications Endpoint Cutover (Task #32)
-- Adds nullable FK from action_templates → external_endpoints so webhook
-- action templates can reference a transport row in the registry instead of
-- inlining url/method/headers/auth in their `config` JSON. Non-webhook
-- templates leave the column NULL.

ALTER TABLE action_templates
  ADD COLUMN IF NOT EXISTS endpoint_id integer
  REFERENCES external_endpoints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_templates_endpoint_id
  ON action_templates(endpoint_id);
