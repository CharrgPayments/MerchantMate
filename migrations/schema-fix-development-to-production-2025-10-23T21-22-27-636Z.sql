-- Schema Synchronization: development → production
-- Generated: 2025-10-23T21:22:27.636Z
-- Total statements: 3

BEGIN;

ALTER TABLE acquirer_application_templates DROP COLUMN IF EXISTS address_groups;
DROP TABLE IF EXISTS campaign_application_templates;
ALTER TABLE pdf_form_fields DROP COLUMN IF EXISTS pdf_field_id;

COMMIT;

-- Verification query:
-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;