-- Migration: 0004_add_dev_transaction_enhancements
-- Description: Add development transaction enhancements for improved tracking
-- Adds transaction_id and mid columns for enhanced transaction management
-- Generated: 2025-08-18T18:01:00Z
-- Origin: Development enhancements ready for test and production deployment

-- Add transaction_id column for unique transaction tracking
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id text NOT NULL DEFAULT '';

-- Add mid column for merchant identification
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mid character varying;

-- Update any existing records to have valid transaction_id values
UPDATE transactions SET transaction_id = 'TXN_' || id::text WHERE transaction_id = '' OR transaction_id IS NULL;

-- Create index for performance on transaction_id lookups
CREATE INDEX IF NOT EXISTS idx_transactions_transaction_id ON transactions(transaction_id);

-- Create index for performance on mid lookups  
CREATE INDEX IF NOT EXISTS idx_transactions_mid ON transactions(mid) WHERE mid IS NOT NULL;