#!/usr/bin/env tsx
/**
 * Environment-Aware Drizzle Command Wrapper
 * 
 * Runs drizzle-kit commands against the correct database based on CORECRM_ENV.
 * This wrapper sets DATABASE_URL to the appropriate environment URL before
 * executing drizzle-kit commands.
 * 
 * Usage:
 *   tsx scripts/drizzle-env.ts --env development push
 *   tsx scripts/drizzle-env.ts --env development generate
 *   tsx scripts/drizzle-env.ts --env test push
 *   CORECRM_ENV=development tsx scripts/drizzle-env.ts push
 * 
 * Commands:
 *   push       - Push schema changes to database
 *   generate   - Generate migration files
 *   studio     - Open Drizzle Studio
 *   introspect - Introspect database schema
 */

import { spawn } from 'child_process';
import 'dotenv/config';

interface Options {
  environment: string;
  command: string;
  extraArgs: string[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    environment: process.env.CORECRM_ENV || 'production',
    command: '',
    extraArgs: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--env' || arg === '-e') {
      options.environment = args[++i] || '';
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
Environment-Aware Drizzle Command Wrapper

Runs drizzle-kit commands against the correct database based on environment.

Usage:
  tsx scripts/drizzle-env.ts --env <environment> <command> [args...]
  CORECRM_ENV=<environment> tsx scripts/drizzle-env.ts <command> [args...]

Environments:
  development    Uses DEV_DATABASE_URL
  test           Uses TEST_DATABASE_URL
  production     Uses DATABASE_URL (default)

Commands:
  push           Push schema changes to database
  generate       Generate migration files
  studio         Open Drizzle Studio
  introspect     Introspect database schema

Options:
  --env, -e      Target environment (overrides CORECRM_ENV)
  --help, -h     Show this help message

Examples:
  # Push schema to development database
  tsx scripts/drizzle-env.ts --env development push

  # Generate migrations from development schema
  tsx scripts/drizzle-env.ts --env development generate

  # Push with force flag
  tsx scripts/drizzle-env.ts --env development push --force

  # Using environment variable
  CORECRM_ENV=development tsx scripts/drizzle-env.ts push
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

async function run(): Promise<void> {
  const options = parseArgs();

  if (!options.command) {
    console.error('❌ No command specified.');
    console.error('   Run with --help for usage information.');
    process.exit(1);
  }

  const validCommands = ['push', 'generate', 'studio', 'introspect', 'migrate', 'check'];
  if (!validCommands.includes(options.command)) {
    console.error(`❌ Invalid command: ${options.command}`);
    console.error(`   Valid commands: ${validCommands.join(', ')}`);
    process.exit(1);
  }

  // Safety check for production
  if (options.environment === 'production') {
    console.log('');
    console.log('⚠️  WARNING: You are targeting PRODUCTION database!');
    console.log('   Make sure this is intentional.');
    console.log('');
  }

  const databaseUrl = getDatabaseUrl(options.environment);
  const dbHost = databaseUrl.match(/@([^:\/]+)/)?.[1] || 'unknown';

  console.log('');
  console.log('======================================================================');
  console.log('  DRIZZLE ENVIRONMENT WRAPPER');
  console.log('======================================================================');
  console.log(`Environment:  ${options.environment.toUpperCase()}`);
  console.log(`Database:     ${dbHost}`);
  console.log(`Command:      drizzle-kit ${options.command} ${options.extraArgs.join(' ')}`);
  console.log('======================================================================');
  console.log('');

  // Build the command
  const drizzleArgs = [options.command, ...options.extraArgs];

  // Execute drizzle-kit with the correct DATABASE_URL
  const child = spawn('npx', ['drizzle-kit', ...drizzleArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl, // Override DATABASE_URL for drizzle-kit
    },
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('❌ Failed to execute drizzle-kit:', err.message);
    process.exit(1);
  });
}

run();
