#!/usr/bin/env tsx
/**
 * Test Data Cleanup Script
 * 
 * Cleans up prospect, application, and optionally agent/user test data from the specified environment.
 * 
 * Usage:
 *   CORECRM_ENV=development tsx scripts/cleanup-test-data.ts
 *   tsx scripts/cleanup-test-data.ts --env development
 *   tsx scripts/cleanup-test-data.ts --env development --keep-agent 63
 *   tsx scripts/cleanup-test-data.ts --env development --include-agents
 *   tsx scripts/cleanup-test-data.ts --env development --include-users
 * 
 * Environment Variables:
 *   CORECRM_ENV - Target environment (development, test, production)
 * 
 * Options:
 *   --env, -e <env>        Database environment (overrides CORECRM_ENV)
 *   --keep-agent <id>      Agent ID to preserve (can be used multiple times)
 *   --include-agents       Also delete test agents (excluding kept ones)
 *   --include-users        Also delete orphaned users with agent/prospect roles
 *   --dry-run              Preview what would be deleted without executing
 *   --help, -h             Show this help message
 */

import 'dotenv/config';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface CleanupOptions {
  environment: string;
  keepAgentIds: number[];
  includeAgents: boolean;
  includeUsers: boolean;
  dryRun: boolean;
}

const DATABASE_ENVIRONMENTS: Record<string, string | undefined> = {
  development: process.env.DEV_DATABASE_URL,
  test: process.env.TEST_DATABASE_URL,
  production: process.env.DATABASE_URL,
};

function loadEnvironmentUrls(): void {
  const envPath = path.join(process.cwd(), 'DATABASE_ENVIRONMENTS.md');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const devMatch = content.match(/DEV_DATABASE_URL[=:]\s*["']?([^"'\s\n]+)/);
    const testMatch = content.match(/TEST_DATABASE_URL[=:]\s*["']?([^"'\s\n]+)/);
    
    if (devMatch && !DATABASE_ENVIRONMENTS.development) {
      DATABASE_ENVIRONMENTS.development = devMatch[1];
    }
    if (testMatch && !DATABASE_ENVIRONMENTS.test) {
      DATABASE_ENVIRONMENTS.test = testMatch[1];
    }
  }
}

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    environment: process.env.CORECRM_ENV || '',
    keepAgentIds: [],
    includeAgents: false,
    includeUsers: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
    
    if (arg === '--env' || arg === '-e') {
      options.environment = args[++i] || '';
    } else if (arg === '--keep-agent') {
      const id = parseInt(args[++i], 10);
      if (!isNaN(id)) {
        options.keepAgentIds.push(id);
      }
    } else if (arg === '--include-agents') {
      options.includeAgents = true;
    } else if (arg === '--include-users') {
      options.includeUsers = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Test Data Cleanup Script

Cleans up prospect, application, and optionally agent/user test data.

Usage:
  CORECRM_ENV=development tsx scripts/cleanup-test-data.ts
  tsx scripts/cleanup-test-data.ts --env development
  tsx scripts/cleanup-test-data.ts --env development --keep-agent 63
  tsx scripts/cleanup-test-data.ts --env development --include-agents --keep-agent 63
  tsx scripts/cleanup-test-data.ts --env development --include-users

Environment Variables:
  CORECRM_ENV              Target environment (development, test, production)

Options:
  --env, -e <env>          Database environment (overrides CORECRM_ENV)
  --keep-agent <id>        Agent ID to preserve (can be used multiple times)
  --include-agents         Also delete test agents (excluding kept ones)
  --include-users          Also delete orphaned users with agent/prospect roles
  --dry-run                Preview what would be deleted without executing
  --help, -h               Show this help message

Examples:
  # Clean prospects/applications only in development
  CORECRM_ENV=development tsx scripts/cleanup-test-data.ts

  # Clean all test data including agents, keeping agent 63
  tsx scripts/cleanup-test-data.ts --env development --include-agents --keep-agent 63

  # Clean all test data including orphaned agent/prospect users
  tsx scripts/cleanup-test-data.ts --env development --include-users

  # Preview what would be deleted
  tsx scripts/cleanup-test-data.ts --env development --dry-run
`);
}

async function getTableCounts(pool: Pool, includeUsers: boolean = false): Promise<Record<string, number>> {
  const tables = [
    'merchant_prospects',
    'prospect_applications', 
    'prospect_documents',
    'prospect_notifications',
    'prospect_owners',
    'prospect_signatures',
    'agents',
  ];
  
  if (includeUsers) {
    tables.push('users (agent/prospect roles)');
  }

  const counts: Record<string, number> = {};
  
  for (const table of tables) {
    try {
      if (table === 'users (agent/prospect roles)') {
        const result = await pool.query(
          `SELECT COUNT(*) as count FROM users WHERE 'agent' = ANY(roles) OR 'prospect' = ANY(roles)`
        );
        counts[table] = parseInt(result.rows[0].count, 10);
      } else {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = parseInt(result.rows[0].count, 10);
      }
    } catch (err) {
      counts[table] = -1;
    }
  }

  return counts;
}

async function cleanup(options: CleanupOptions): Promise<void> {
  loadEnvironmentUrls();

  if (!options.environment) {
    console.error('❌ No environment specified.');
    console.error('   Use --env <environment> or set CORECRM_ENV environment variable.');
    console.error('   Valid environments: development, test, production');
    process.exit(1);
  }

  const validEnvs = ['development', 'test', 'production'];
  if (!validEnvs.includes(options.environment)) {
    console.error(`❌ Invalid environment: ${options.environment}`);
    console.error(`   Valid environments: ${validEnvs.join(', ')}`);
    process.exit(1);
  }

  if (options.environment === 'production') {
    console.error('❌ Production cleanup is not allowed via this script.');
    console.error('   Use manual SQL with appropriate safeguards.');
    process.exit(1);
  }

  const databaseUrl = DATABASE_ENVIRONMENTS[options.environment];
  if (!databaseUrl) {
    console.error(`❌ No database URL configured for environment: ${options.environment}`);
    console.error('   Check DATABASE_ENVIRONMENTS.md or environment variables.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  console.log('');
  console.log('======================================================================');
  console.log('  TEST DATA CLEANUP');
  console.log('======================================================================');
  console.log(`Environment:     ${options.environment.toUpperCase()}`);
  console.log(`Include Agents:  ${options.includeAgents ? 'Yes' : 'No'}`);
  console.log(`Include Users:   ${options.includeUsers ? 'Yes (agent/prospect roles)' : 'No'}`);
  console.log(`Keep Agent IDs:  ${options.keepAgentIds.length > 0 ? options.keepAgentIds.join(', ') : 'None specified'}`);
  console.log(`Dry Run:         ${options.dryRun ? 'YES (no changes will be made)' : 'No'}`);
  console.log('======================================================================');
  console.log('');

  try {
    console.log('📊 Current data counts:');
    const beforeCounts = await getTableCounts(pool, options.includeUsers);
    for (const [table, count] of Object.entries(beforeCounts)) {
      if (count >= 0) {
        console.log(`   ${table}: ${count}`);
      }
    }
    console.log('');

    if (options.dryRun) {
      console.log('🔍 DRY RUN - The following would be deleted:');
      console.log('   - All prospect_signatures');
      console.log('   - All prospect_owners');
      console.log('   - All prospect_documents');
      console.log('   - All prospect_notifications');
      console.log('   - All prospect_applications');
      console.log('   - All merchant_prospects');
      if (options.includeAgents) {
        const keepClause = options.keepAgentIds.length > 0 
          ? ` (except IDs: ${options.keepAgentIds.join(', ')})` 
          : '';
        console.log(`   - All agents${keepClause}`);
      }
      if (options.includeUsers) {
        console.log('   - All users with agent/prospect roles');
      }
      console.log('');
      console.log('✅ Dry run complete. No changes made.');
    } else {
      console.log('🔄 Starting cleanup transaction...');
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        console.log('   Deleting prospect_signatures...');
        await client.query('DELETE FROM prospect_signatures');

        console.log('   Deleting prospect_owners...');
        await client.query('DELETE FROM prospect_owners');

        console.log('   Deleting prospect_documents...');
        await client.query('DELETE FROM prospect_documents');

        console.log('   Deleting prospect_notifications...');
        await client.query('DELETE FROM prospect_notifications');

        console.log('   Deleting prospect_applications...');
        await client.query('DELETE FROM prospect_applications');

        console.log('   Deleting merchant_prospects...');
        await client.query('DELETE FROM merchant_prospects');

        if (options.includeAgents) {
          if (options.keepAgentIds.length > 0) {
            console.log(`   Deleting agents (keeping IDs: ${options.keepAgentIds.join(', ')})...`);
            await client.query(
              'DELETE FROM agents WHERE id != ALL($1::int[])',
              [options.keepAgentIds]
            );
          } else {
            console.log('   Deleting all agents...');
            await client.query('DELETE FROM agents');
          }
        }

        if (options.includeUsers) {
          console.log('   Deleting users with agent/prospect roles...');
          const result = await client.query(
            `DELETE FROM users WHERE 'agent' = ANY(roles) OR 'prospect' = ANY(roles)`
          );
          console.log(`   Deleted ${result.rowCount} user(s)`);
        }

        await client.query('COMMIT');
        console.log('');
        console.log('✅ Transaction committed successfully!');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      console.log('');
      console.log('📊 After cleanup:');
      const afterCounts = await getTableCounts(pool, options.includeUsers);
      for (const [table, count] of Object.entries(afterCounts)) {
        if (count >= 0) {
          console.log(`   ${table}: ${count}`);
        }
      }
    }

  } catch (err) {
    console.error('❌ Error during cleanup:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log('');
  console.log('======================================================================');
  console.log('  CLEANUP COMPLETE');
  console.log('======================================================================');
}

cleanup(parseArgs());
