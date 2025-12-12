-- Schema Synchronization: development → test
-- Generated: 2025-12-12T18:53:06.535Z
-- Total statements: 2

BEGIN;

DROP TABLE IF EXISTS disclosure_acknowledgments;
DROP TABLE IF EXISTS disclosure_contents;

COMMIT;

-- Verification query:
-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;