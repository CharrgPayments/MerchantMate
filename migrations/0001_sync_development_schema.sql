-- Migration: 0001_sync_development_schema
-- Description: Synchronize development database with production schema
-- Adds missing columns to bring development up to date
-- Generated: 2025-08-18T17:42:00Z

-- Audit logs enhancements for SOC2 compliance
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS timestamp timestamp without time zone NOT NULL DEFAULT now();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info'::text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id character varying;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id character varying;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS geolocation jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_info jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS retention_policy text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS encryption_key_id character varying;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

-- Equipment items enhancements for inventory management
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS image_data text;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS model_number text;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS specifications jsonb DEFAULT '{}'::jsonb;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS status text DEFAULT 'available'::text;

-- Fee groups enhancements for pricing management
ALTER TABLE fee_groups ADD COLUMN IF NOT EXISTS fees jsonb DEFAULT '{}'::jsonb;
ALTER TABLE fee_groups ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE fee_groups ADD COLUMN IF NOT EXISTS created_by text;

-- Locations enhancements for multi-location support
ALTER TABLE locations ADD COLUMN IF NOT EXISTS mid character varying;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'store'::text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS operating_hours jsonb;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address text NOT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS city text NOT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS state text NOT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS zip_code text NOT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP;

-- Merchants enhancements for comprehensive merchant profiles
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email text NOT NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS processing_fee numeric NOT NULL DEFAULT 2.50;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS monthly_volume numeric NOT NULL DEFAULT '0'::numeric;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dba_name text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ein text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP;

-- Transactions enhancements for comprehensive transaction tracking
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS commission_rate numeric DEFAULT 0.025;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS commission_amount numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processing_fee numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS net_amount numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_number text;