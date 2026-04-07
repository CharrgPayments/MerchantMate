-- Schema Deployment SQL
-- Generated: 2025-10-10T03:37:15.091Z
-- Source: DEVELOPMENT Database
-- Target: TEST Database
-- Total Changes: 30 columns across 3 tables
--
-- REVIEW THIS FILE CAREFULLY BEFORE APPLYING
-- ============================================================

-- Add missing columns to email_templates
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS use_wrapper boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS wrapper_type character varying DEFAULT 'notification'::character varying,
  ADD COLUMN IF NOT EXISTS header_gradient text,
  ADD COLUMN IF NOT EXISTS header_subtitle text,
  ADD COLUMN IF NOT EXISTS cta_button_text text,
  ADD COLUMN IF NOT EXISTS cta_button_url text,
  ADD COLUMN IF NOT EXISTS cta_button_color text,
  ADD COLUMN IF NOT EXISTS custom_footer text;

-- Add missing columns to email_wrappers
ALTER TABLE email_wrappers
  ADD COLUMN IF NOT EXISTS id integer NOT NULL DEFAULT nextval('email_wrappers_id_seq'::regclass),
  ADD COLUMN IF NOT EXISTS name character varying NOT NULL,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS type character varying NOT NULL,
  ADD COLUMN IF NOT EXISTS header_gradient text,
  ADD COLUMN IF NOT EXISTS header_subtitle text,
  ADD COLUMN IF NOT EXISTS cta_button_text text,
  ADD COLUMN IF NOT EXISTS cta_button_url text,
  ADD COLUMN IF NOT EXISTS cta_button_color text,
  ADD COLUMN IF NOT EXISTS custom_footer text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamp without time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

-- Add missing columns to user_alerts
ALTER TABLE user_alerts
  ADD COLUMN IF NOT EXISTS id integer NOT NULL DEFAULT nextval('user_alerts_id_seq'::regclass),
  ADD COLUMN IF NOT EXISTS user_id character varying NOT NULL,
  ADD COLUMN IF NOT EXISTS message text NOT NULL,
  ADD COLUMN IF NOT EXISTS type character varying NOT NULL DEFAULT 'info'::character varying,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS action_activity_id integer,
  ADD COLUMN IF NOT EXISTS created_at timestamp without time zone NOT NULL DEFAULT now();