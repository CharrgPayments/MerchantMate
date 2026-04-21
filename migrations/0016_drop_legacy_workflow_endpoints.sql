-- Retire legacy per-workflow endpoint storage (Task #43).
-- Task #33 cut the workflow stage runner over to the shared
-- external_endpoints registry, leaving the legacy storage as a fallback.
-- This migration removes the duplicate columns/tables now that the
-- registry is the source of truth.

-- 1. Repoint underwriting_phase_results.endpoint_id from the legacy
--    workflow_endpoints table to the shared external_endpoints registry.
--    Existing values point at the wrong table (their IDs are not stable
--    across the registry), so clear them before rewriting the FK.
ALTER TABLE underwriting_phase_results
  DROP CONSTRAINT IF EXISTS underwriting_phase_results_endpoint_id_fkey;
UPDATE underwriting_phase_results SET endpoint_id = NULL;
ALTER TABLE underwriting_phase_results
  ADD CONSTRAINT underwriting_phase_results_endpoint_id_fkey
  FOREIGN KEY (endpoint_id) REFERENCES external_endpoints(id) ON DELETE SET NULL;

-- 2. Drop the deprecated transport columns from stage_api_configs.
--    Transport (URL/method/headers/auth) now lives on external_endpoints
--    via stage_api_configs.endpoint_id.
ALTER TABLE stage_api_configs
  DROP COLUMN IF EXISTS endpoint_url,
  DROP COLUMN IF EXISTS http_method,
  DROP COLUMN IF EXISTS headers,
  DROP COLUMN IF EXISTS auth_type,
  DROP COLUMN IF EXISTS auth_secret_key;

-- 3. Drop the legacy per-workflow endpoint registry. The shared
--    external_endpoints table replaces it; the mirror-write helper that
--    kept the two in sync has been removed in the same task.
DROP TABLE IF EXISTS workflow_endpoints;
