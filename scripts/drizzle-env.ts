#!/usr/bin/env tsx
/**
 * Environment-Aware Drizzle Command Wrapper with Production Protection
 * 
 * CRITICAL: This is the ONLY approved way to run drizzle-kit commands.
 * 
 * DEPLOYMENT PIPELINE ENFORCEMENT:
 * ================================
 * 1. DEVELOPMENT: Schema changes (push/generate) can ONLY target development
 * 2. TEST: Receives promoted changes from development via migration-manager
 * 3. PRODUCTION: Receives promoted changes from test via migration-manager
 * 
 * Direct push/generate to production is BLOCKED by this script.
 * Use migration-manager.ts for controlled promotions.
 * 
 * Usage:
 *   tsx scripts/drizzle-env.ts --env development push
 *   tsx scripts/drizzle-env.ts --env development generate
 *   tsx scripts/drizzle-env.ts --env development studio
 * 
 * Read-only commands (studio, introspect) are allowed for all environments.
 */

import { spawn } from 'child_process';
import 'dotenv/config';

interface Options {
  environment: string;
  command: string;
  extraArgs: string[];
  forceProduction: boolean;
}

const MUTATING_COMMANDS = ['push', 'generate', 'migrate'];
const READONLY_COMMANDS = ['studio', 'introspect', 'check'];
const ALL_COMMANDS = [...MUTATING_COMMANDS, ...READONLY_COMMANDS];

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    environment: process.env.CORECRM_ENV || 'development',
    command: '',
    extraArgs: [],
    forceProduction: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--env' || arg === '-e') {
      options.environment = args[++i] || '';
    } else if (arg === '--force-production') {
      options.forceProduction = true;
    } else if (!options.command) {
      options.command = arg;
    } else {
      options.extraArgs.push(arg);
    }
    i++;
  }

  return options;
}

function showHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  ENVIRONMENT-AWARE DRIZZLE WRAPPER                                            ║
║  With Production Protection                                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

DEPLOYMENT PIPELINE:
  Development → Test → Production
  
  Schema changes (push/generate) can ONLY target DEVELOPMENT.
  Use migration-manager.ts to promote changes through the pipeline.

USAGE:
  tsx scripts/drizzle-env.ts --env <environment> <command> [args...]

ENVIRONMENTS:
  development    Uses DEV_DATABASE_URL     (schema changes allowed)
  test           Uses TEST_DATABASE_URL    (read-only, use promotion)
  production     Uses DATABASE_URL         (read-only, use promotion)

COMMANDS:
  Schema Changes (Development ONLY):
    push           Push schema changes to database
    generate       Generate migration files
    
  Read-Only (All Environments):
    studio         Open Drizzle Studio
    introspect     Introspect database schema
    check          Check schema status

OPTIONS:
  --env, -e           Target environment (default: development)
  --force-production  Override production protection (DANGEROUS - audit logged)
  --help, -h          Show this help message

EXAMPLES:
  # Push schema to development (RECOMMENDED)
  tsx scripts/drizzle-env.ts --env development push

  # Generate migrations from development
  tsx scripts/drizzle-env.ts --env development generate

  # Open Drizzle Studio for any environment (read-only)
  tsx scripts/drizzle-env.ts --env production studio

SCHEMA PROMOTION WORKFLOW:
  1. Make schema changes in shared/schema.ts
  2. Push to development: tsx scripts/drizzle-env.ts --env development push
  3. Test in development environment
  4. Promote to test: tsx scripts/migration-manager.ts promote --from development --to test
  5. Certify in test environment
  6. Promote to production: tsx scripts/migration-manager.ts promote --from test --to production
`);
}

function getDatabaseUrl(environment: string): string {
  switch (environment) {
    case 'development':
      if (!process.env.DEV_DATABASE_URL) {
        console.error('❌ DEV_DATABASE_URL not set. Required when targeting development.');
        process.exit(1);
      }
      return process.env.DEV_DATABASE_URL;
    
    case 'test':
      if (!process.env.TEST_DATABASE_URL) {
        console.error('❌ TEST_DATABASE_URL not set. Required when targeting test.');
        process.exit(1);
      }
      return process.env.TEST_DATABASE_URL;
    
    case 'production':
      if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set.');
        process.exit(1);
      }
      return process.env.DATABASE_URL;
    
    default:
      console.error(`❌ Invalid environment: ${environment}`);
      console.error('   Valid environments: development, test, production');
      process.exit(1);
  }
}

function logAuditEvent(event: string, details: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    user: process.env.USER || 'unknown',
    ...details,
  };
  console.log(`\n📋 AUDIT LOG: ${JSON.stringify(logEntry)}\n`);
}

async function run(): Promise<void> {
  const options = parseArgs();

  if (!options.command) {
    console.error('❌ No command specified.');
    console.error('   Run with --help for usage information.');
    process.exit(1);
  }

  if (!ALL_COMMANDS.includes(options.command)) {
    console.error(`❌ Invalid command: ${options.command}`);
    console.error(`   Valid commands: ${ALL_COMMANDS.join(', ')}`);
    process.exit(1);
  }

  const isMutating = MUTATING_COMMANDS.includes(options.command);
  const isNonDevEnv = options.environment !== 'development';

  // CRITICAL: Block mutating commands on non-development environments
  if (isMutating && isNonDevEnv) {
    if (!options.forceProduction) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════════════════════╗');
      console.error('║  🚫 BLOCKED: SCHEMA CHANGES NOT ALLOWED ON NON-DEVELOPMENT ENVIRONMENTS     ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════════╝');
      console.error('');
      console.error(`  You attempted to run "${options.command}" on ${options.environment.toUpperCase()}.`);
      console.error('');
      console.error('  DEPLOYMENT PIPELINE ENFORCEMENT:');
      console.error('  ================================');
      console.error('  1. Schema changes can ONLY be made in DEVELOPMENT');
      console.error('  2. Use migration-manager.ts to promote changes:');
      console.error('');
      console.error('     # First, push to development:');
      console.error('     tsx scripts/drizzle-env.ts --env development push');
      console.error('');
      console.error('     # Then promote to test:');
      console.error('     tsx scripts/migration-manager.ts promote --from development --to test');
      console.error('');
      console.error('     # After certification, promote to production:');
      console.error('     tsx scripts/migration-manager.ts promote --from test --to production');
      console.error('');
      
      if (options.environment === 'production') {
        console.error('  ⚠️  If this is an emergency, use --force-production flag.');
        console.error('     This will be audit logged and should require approval.');
      }
      
      console.error('');
      process.exit(1);
    } else {
      // Force production override - audit log this
      logAuditEvent('PRODUCTION_SCHEMA_OVERRIDE', {
        command: options.command,
        environment: options.environment,
        args: options.extraArgs,
        warning: 'Direct production schema modification - bypassed pipeline',
      });
      
      console.log('');
      console.log('⚠️  WARNING: PRODUCTION PROTECTION OVERRIDE ACTIVATED');
      console.log('    This action has been audit logged.');
      console.log('    Proceeding with direct production modification...');
      console.log('');
    }
  }

  const databaseUrl = getDatabaseUrl(options.environment);
  const dbHost = databaseUrl.match(/@([^:\/]+)/)?.[1] || 'unknown';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  DRIZZLE ENVIRONMENT WRAPPER                                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(`  Environment:  ${options.environment.toUpperCase()}`);
  console.log(`  Database:     ${dbHost}`);
  console.log(`  Command:      drizzle-kit ${options.command} ${options.extraArgs.join(' ')}`);
  console.log(`  Type:         ${isMutating ? '⚡ MUTATING' : '👁  READ-ONLY'}`);
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Build the command
  const drizzleArgs = [options.command, ...options.extraArgs];

  // Execute drizzle-kit with the correct DATABASE_URL
  const child = spawn('npx', ['drizzle-kit', ...drizzleArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });

  child.on('close', (code) => {
    if (code === 0 && isMutating) {
      logAuditEvent('SCHEMA_CHANGE_COMPLETED', {
        command: options.command,
        environment: options.environment,
        status: 'success',
      });
    }
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('❌ Failed to execute drizzle-kit:', err.message);
    process.exit(1);
  });
}

run();
