-- Schema Synchronization: production → development
-- Generated: 2025-10-23T21:24:14.892Z
-- Total statements: 4

BEGIN;

ALTER TABLE acquirer_application_templates ADD COLUMN IF NOT EXISTS address_groups JSONB DEFAULT '[]'::jsonb;
CREATE SEQUENCE IF NOT EXISTS campaign_application_templates_id_seq;
CREATE TABLE IF NOT EXISTS campaign_application_templates (
  id INTEGER NOT NULL DEFAULT nextval('campaign_application_templates_id_seq'::regclass),
  campaign_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE pdf_form_fields ADD COLUMN IF NOT EXISTS pdf_field_id TEXT;

COMMIT;

-- Verification query:
-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;