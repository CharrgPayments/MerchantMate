-- Production Deployment SQL
-- Generated: 2025-10-06T22:15:14.929Z
-- Source: Test Database
-- Target: Production Database
-- Total Changes: 4 columns across 1 tables
--
-- REVIEW THIS FILE CAREFULLY BEFORE APPLYING TO PRODUCTION
-- ============================================================

-- Add missing columns to merchants
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;