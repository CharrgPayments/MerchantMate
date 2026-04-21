#!/bin/bash
set -e

npm install --no-audit --no-fund

# Run the schema-sync orchestrator in plan-only mode instead of
# `drizzle-kit push`. drizzle-kit prompts interactively for "data-loss"
# warnings on cosmetic type normalizations (serial vs integer,
# varchar(N) vs varchar, timestamp(6) vs timestamp), which hangs the
# post-merge hook because stdin is closed. The orchestrator normalizes
# these and surfaces only real drift. Real schema changes should be
# applied via the Schema Sync UI (Testing Utilities → Data Utilities).
echo "── Schema-sync plan (no DDL will execute) ─────────────────"
SYNC_PHASE=plan tsx scripts/runSchemaSync.ts || \
  echo "schema-sync plan reported issues — review and apply via the Schema Sync UI"
