#!/usr/bin/env tsx
/**
 * Bulletproof Database Deployment System
 * 
 * Uses Drizzle's native push command for 100% reliable schema sync
 * Then handles data separately
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

interface DeploymentOptions {
  targetEnv: 'test' | 'production';
  includeData?: boolean;
}

async function deploy(options: DeploymentOptions) {
  const { targetEnv, includeData = false } = options;
  
  console.log(`\n🚀 Bulletproof Deployment to ${targetEnv.toUpperCase()}\n`);
  console.log('=' .repeat(60));
  
  // Step 1: Get correct database URL
  const envVarMap = {
    test: 'TEST_DATABASE_URL',
    production: 'DATABASE_URL'
  };
  
  const dbUrlVar = envVarMap[targetEnv];
  const dbUrl = process.env[dbUrlVar];
  
  if (!dbUrl) {
    console.error(`❌ ${dbUrlVar} not configured`);
    process.exit(1);
  }
  
  console.log(`✅ Target: ${targetEnv.toUpperCase()} database`);
  console.log(`✅ Using: ${dbUrlVar}\n`);
  
  // Step 2: Schema sync using Drizzle's native push (100% reliable)
  console.log('📋 Step 1: Syncing Schema\n');
  console.log('   Using Drizzle Kit push (native, reliable)...\n');
  
  try {
    // Use Drizzle's push command with the target database
    const pushCommand = `DATABASE_URL="${dbUrl}" npm run db:push -- --force`;
    console.log(`   Command: ${pushCommand}\n`);
    
    execSync(pushCommand, {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: dbUrl }
    });
    
    console.log('\n✅ Schema sync completed successfully\n');
    
  } catch (error) {
    console.error('\n❌ Schema sync failed:', error);
    process.exit(1);
  }
  
  // Step 3: Data sync (optional)
  if (includeData) {
    console.log('📊 Step 2: Syncing Lookup Data\n');
    console.log('   Please use the UI Data Sync feature:');
    console.log('   1. Go to Testing Utilities → Data Utilities');
    console.log('   2. Export from development');
    console.log('   3. Import to ' + targetEnv);
    console.log('\n   Or run: tsx scripts/data-sync-manager.ts ...\n');
  }
  
  console.log('=' .repeat(60));
  console.log(`\n✅ ${targetEnv.toUpperCase()} deployment completed successfully!\n`);
}

// CLI
const targetEnv = process.argv[2] as 'test' | 'production';
const includeDataFlag = process.argv.includes('--with-data');

if (!targetEnv || !['test', 'production'].includes(targetEnv)) {
  console.log('Bulletproof Database Deployment');
  console.log('===============================\n');
  console.log('Usage:');
  console.log('  tsx scripts/bulletproof-deploy.ts <target> [--with-data]\n');
  console.log('Examples:');
  console.log('  tsx scripts/bulletproof-deploy.ts test');
  console.log('  tsx scripts/bulletproof-deploy.ts production\n');
  console.log('What it does:');
  console.log('  1. Uses Drizzle Kit push for 100% reliable schema sync');
  console.log('  2. Optionally guides you through data sync\n');
  process.exit(1);
}

deploy({ targetEnv, includeData: includeDataFlag });
