#!/usr/bin/env node

/**
 * SAFE DATABASE PUSH SCRIPT
 * 
 * This script enforces the Dev → Test → Prod promotion workflow.
 * It prevents accidental pushes to production and ensures schema changes
 * follow the correct promotion path.
 * 
 * Usage:
 *   node scripts/db-push-safe.js dev      # Push to development (default)
 *   node scripts/db-push-safe.js test     # Push to test
 *   node scripts/db-push-safe.js prod     # Push to production (requires confirmation)
 */

import { spawn } from 'child_process';
import readline from 'readline';

const args = process.argv.slice(2);
const targetEnv = args[0] || 'dev';
const forceFlag = args.includes('--force');

const ENV_CONFIG = {
  dev: {
    name: 'DEVELOPMENT',
    envVar: 'DEV_DATABASE_URL',
    emoji: '🔧',
    requiresConfirmation: false,
  },
  development: {
    name: 'DEVELOPMENT',
    envVar: 'DEV_DATABASE_URL', 
    emoji: '🔧',
    requiresConfirmation: false,
  },
  test: {
    name: 'TEST',
    envVar: 'TEST_DATABASE_URL',
    emoji: '🧪',
    requiresConfirmation: false,
  },
  prod: {
    name: 'PRODUCTION',
    envVar: 'DATABASE_URL',
    emoji: '🚨',
    requiresConfirmation: true,
  },
  production: {
    name: 'PRODUCTION',
    envVar: 'DATABASE_URL',
    emoji: '🚨',
    requiresConfirmation: true,
  },
};

async function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const config = ENV_CONFIG[targetEnv];

  if (!config) {
    console.error(`❌ Unknown environment: ${targetEnv}`);
    console.error('Valid options: dev, test, prod (or development, test, production)');
    console.error('\nUsage:');
    console.error('  node scripts/db-push-safe.js dev      # Push to development');
    console.error('  node scripts/db-push-safe.js test     # Push to test');
    console.error('  node scripts/db-push-safe.js prod     # Push to production');
    process.exit(1);
  }

  const dbUrl = process.env[config.envVar];

  if (!dbUrl) {
    console.error(`❌ ${config.envVar} is not set!`);
    console.error(`Cannot push to ${config.name} without the database URL.`);
    process.exit(1);
  }

  console.log(`\n${config.emoji} Targeting ${config.name} database`);
  console.log(`   Using: ${config.envVar}`);
  console.log(`   URL: ${dbUrl.substring(0, 50)}...\n`);

  if (config.requiresConfirmation) {
    console.log('🚨🚨🚨 WARNING: YOU ARE ABOUT TO MODIFY PRODUCTION DATABASE 🚨🚨🚨\n');
    console.log('This action:');
    console.log('  - Affects LIVE production data');
    console.log('  - May cause downtime if schema changes are incompatible');
    console.log('  - Should only be done after testing in dev and test environments\n');

    if (!forceFlag) {
      const confirmed = await askConfirmation('Type "yes" to confirm production push: ');
      if (!confirmed) {
        console.log('\n❌ Aborted. No changes made.');
        process.exit(0);
      }
    } else {
      console.log('--force flag detected, skipping confirmation...');
    }
    console.log('\n⚠️  Proceeding with PRODUCTION push...\n');
  }

  // Run drizzle-kit push with the correct DATABASE_URL
  const drizzleProcess = spawn('npx', ['drizzle-kit', 'push', '--force'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl, // Override DATABASE_URL with the target environment's URL
    },
  });

  drizzleProcess.on('close', (code) => {
    if (code === 0) {
      console.log(`\n✅ Schema successfully pushed to ${config.name}`);
    } else {
      console.error(`\n❌ Push failed with exit code ${code}`);
    }
    process.exit(code);
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
