-- Migration: 0002_fix_transactions_schema
-- Description: Fix remaining transactions table schema differences
-- Synchronizes transactions table column set between environments  
-- Generated: 2025-08-18T17:55:00Z

-- Add missing columns that exist in production but not in development
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS location_id integer;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'payment';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone;

-- Note: Removing extra columns (transaction_id, mid) would require data migration
-- For safety, we'll leave these columns in development but add the missing ones
-- This ensures development has all production columns plus any development-specific ones

-- Update column constraints to match production
-- (Any specific constraint updates would go here if needed)