-- Migration: Add campaign_application_templates junction table
-- Purpose: Links campaigns to multiple application templates
-- Date: 2025-10-23
-- Environments: DEV, TEST (Production already has this table)

-- Create the campaign_application_templates table
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

-- Optional: Add comment to document the table's purpose
COMMENT ON TABLE campaign_application_templates IS 'Junction table linking campaigns to acquirer application templates. Supports multiple templates per campaign with primary template designation.';

