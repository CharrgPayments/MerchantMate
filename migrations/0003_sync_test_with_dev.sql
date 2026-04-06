-- Migration: 0003_sync_test_with_dev
-- Description: Add development-specific columns to test environment
-- Synchronizes test with development enhancements
-- Generated: 2025-08-18T17:59:00Z

-- Add development-specific columns to transactions table in test environment
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id text NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mid character varying;

-- Update any existing records to have valid transaction_id values
UPDATE transactions SET transaction_id = 'TXN_' || id::text WHERE transaction_id = '' OR transaction_id IS NULL;