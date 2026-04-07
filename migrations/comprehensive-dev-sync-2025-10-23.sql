-- Comprehensive Migration: Sync Development with Production Schema
-- Date: 2025-10-23
-- Environment: DEV, TEST
-- Description: Adds missing table and columns identified in schema comparison

-- 1. Add address_groups column to acquirer_application_templates
-- This is critical for the address mapper functionality
ALTER TABLE acquirer_application_templates 
ADD COLUMN IF NOT EXISTS address_groups jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN acquirer_application_templates.address_groups IS 'Configuration for address field groups with canonical-to-template field mappings';

-- 2. Create campaign_application_templates table (entire table is missing)
CREATE TABLE IF NOT EXISTS campaign_application_templates (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES acquirer_application_templates(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_application_templates_campaign_id_template_id_unique UNIQUE (campaign_id, template_id)
);

-- Create indexes for foreign keys to improve query performance
CREATE INDEX IF NOT EXISTS idx_campaign_application_templates_campaign_id 
  ON campaign_application_templates(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_application_templates_template_id 
  ON campaign_application_templates(template_id);

COMMENT ON TABLE campaign_application_templates IS 'Junction table linking campaigns to acquirer application templates. Supports multiple templates per campaign with primary template designation.';

-- 3. Add pdf_field_id column to pdf_form_fields
ALTER TABLE pdf_form_fields 
ADD COLUMN IF NOT EXISTS pdf_field_id TEXT;

COMMENT ON COLUMN pdf_form_fields.pdf_field_id IS 'Original PDF field identifier for mapping';

-- Summary of changes:
-- - Added address_groups column to acquirer_application_templates (jsonb)
-- - Created campaign_application_templates table with all columns
-- - Added pdf_field_id column to pdf_form_fields (text)
