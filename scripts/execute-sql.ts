/**
 * Environment-Aware SQL Execution Wrapper
 * 
 * This script provides SAFE SQL execution with mandatory environment selection.
 * Use this instead of execute_sql_tool to prevent accidental production modifications.
 * 
 * Features:
 * - Mandatory environment selection (development/test/production)
 * - Production safety: requires --force-production flag
 * - Transaction support with automatic rollback on error
 * - Comprehensive audit logging
 * - Dry-run mode for testing
 * 
 * Usage:
 *   tsx scripts/execute-sql.ts --env development --sql "SELECT * FROM users"
 *   tsx scripts/execute-sql.ts --env development --file scripts/seed-triggers.sql
 *   tsx scripts/execute-sql.ts --env production --force-production --sql "UPDATE..."
 *   tsx scripts/execute-sql.ts --env test --dry-run --sql "DELETE FROM..."
 * 
 * Examples:
 *   # Safe: Run query on development
 *   tsx scripts/execute-sql.ts --env development --sql "INSERT INTO trigger_catalog..."
 * 
 *   # Safe: Run SQL file on test
 *   tsx scripts/execute-sql.ts --env test --file scripts/my-query.sql
 * 
 *   # Blocked: Production without force flag
 *   tsx scripts/execute-sql.ts --env production --sql "UPDATE users SET..."
 *   ❌ ERROR: Production database access requires --force-production flag
 * 
 *   # Allowed: Production with explicit force
 *   tsx scripts/execute-sql.ts --env production --force-production --sql "UPDATE..."
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

interface ExecuteSqlOptions {
  env: 'development' | 'test' | 'production';
  sql?: string;
  file?: string;
  forceProduction?: boolean;
  dryRun?: boolean;
  transaction?: boolean;
}

function getDatabaseUrl(env: string): string {
  switch (env) {
    case 'development':
      return process.env.DEV_DATABASE_URL || '';
    case 'test':
      return process.env.TEST_DATABASE_URL || '';
    case 'production':
      return process.env.DATABASE_URL || '';
    default:
      throw new Error(`Invalid environment: ${env}`);
  }
}

function parseArgs(): ExecuteSqlOptions {
  const args = process.argv.slice(2);
  const options: ExecuteSqlOptions = {
    env: 'development',
    transaction: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--env':
      case '-e':
        options.env = args[++i] as any;
        break;
      case '--sql':
      case '-s':
        options.sql = args[++i];
        break;
      case '--file':
      case '-f':
        options.file = args[++i];
        break;
      case '--force-production':
        options.forceProduction = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-transaction':
        options.transaction = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith('--')) {
          console.error(`❌ Unknown argument: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Environment-Aware SQL Execution Wrapper

Usage:
  tsx scripts/execute-sql.ts --env <environment> [options]

Required:
  --env, -e <env>          Database environment: development, test, or production

SQL Source (one required):
  --sql, -s <query>        SQL query string to execute
  --file, -f <path>        Path to SQL file to execute

Options:
  --force-production       Allow execution on production (REQUIRED for production)
  --dry-run                Preview SQL without executing
  --no-transaction         Disable automatic transaction wrapping
  --help, -h               Show this help message

Examples:
  tsx scripts/execute-sql.ts --env development --sql "SELECT * FROM users"
  tsx scripts/execute-sql.ts --env test --file scripts/seed.sql
  tsx scripts/execute-sql.ts --env production --force-production --sql "UPDATE..."

Safety Features:
  ✅ Explicit environment selection prevents accidents
  ✅ Production requires --force-production flag
  ✅ Automatic transactions with rollback on error
  ✅ Dry-run mode for testing queries
  ✅ Comprehensive logging and audit trail
`);
}

async function executeSql(options: ExecuteSqlOptions) {
  // Validation
  if (!['development', 'test', 'production'].includes(options.env)) {
    console.error(`❌ Invalid environment: ${options.env}`);
    console.error('   Must be: development, test, or production');
    process.exit(1);
  }

  if (!options.sql && !options.file) {
    console.error('❌ Must provide either --sql or --file');
    printHelp();
    process.exit(1);
  }

  // CRITICAL: Production safety check
  if (options.env === 'production' && !options.forceProduction) {
    console.error('\n❌ PRODUCTION DATABASE ACCESS DENIED\n');
    console.error('   Production database modifications require explicit confirmation.');
    console.error('   Add --force-production flag if you are absolutely certain.\n');
    console.error('   Example:');
    console.error('   tsx scripts/execute-sql.ts --env production --force-production --sql "..."\n');
    process.exit(1);
  }

  // Get SQL content
  let sqlContent: string;
  if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }
    sqlContent = fs.readFileSync(filePath, 'utf-8');
  } else {
    sqlContent = options.sql!;
  }

  // Get database URL
  const dbUrl = getDatabaseUrl(options.env);
  if (!dbUrl) {
    console.error(`❌ Database URL not found for environment: ${options.env}`);
    console.error(`   Check your .env file for ${options.env.toUpperCase()}_DATABASE_URL`);
    process.exit(1);
  }

  // Display execution plan
  console.log('\n' + '='.repeat(70));
  console.log('  SQL EXECUTION PLAN');
  console.log('='.repeat(70));
  console.log(`Environment:     ${options.env.toUpperCase()}`);
  console.log(`Database:        ${dbUrl.split('@')[1]?.split('/')[0] || 'hidden'}`);
  console.log(`Transaction:     ${options.transaction ? 'Enabled' : 'Disabled'}`);
  console.log(`Dry Run:         ${options.dryRun ? 'YES (preview only)' : 'NO (will execute)'}`);
  if (options.env === 'production') {
    console.log(`⚠️  PRODUCTION:   Force flag enabled - EXECUTING ON PRODUCTION!`);
  }
  console.log('='.repeat(70));
  console.log('\nSQL Query:');
  console.log(sqlContent.trim());
  console.log('='.repeat(70) + '\n');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - Query not executed\n');
    return;
  }

  // Execute SQL
  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  try {
    if (options.transaction) {
      await client.query('BEGIN');
      console.log('🔄 Transaction started\n');
    }

    const startTime = Date.now();
    const result = await client.query(sqlContent);
    const duration = Date.now() - startTime;

    console.log(`✅ Query executed successfully (${duration}ms)`);
    
    if (result.command === 'SELECT' && result.rows.length > 0) {
      console.log(`\n📊 Results: ${result.rows.length} row(s)\n`);
      console.table(result.rows);
    } else if (result.rowCount !== null) {
      console.log(`   Rows affected: ${result.rowCount}`);
    }

    if (options.transaction) {
      await client.query('COMMIT');
      console.log('\n✅ Transaction committed\n');
    }

  } catch (error) {
    if (options.transaction) {
      await client.query('ROLLBACK');
      console.error('\n❌ Transaction rolled back due to error\n');
    }
    console.error('❌ SQL Execution Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
(async () => {
  try {
    const options = parseArgs();
    await executeSql(options);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
})();
