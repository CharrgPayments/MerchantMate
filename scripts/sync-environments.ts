#!/usr/bin/env tsx

/**
 * Environment Synchronization Tool
 * 
 * Simple command-line tool for non-technical users to safely sync environments.
 * Always follows the Dev → Test → Production pipeline.
 * 
 * PREREQUISITE - Generate Migrations First:
 *   Before running sync, ensure you've generated migrations in development:
 *   1. Make changes to shared/schema.ts
 *   2. tsx scripts/migration-manager.ts generate
 *   3. Review generated SQL in migrations/ directory
 *   4. NOW run this sync script
 * 
 * Features:
 *   - Schema migration using migration-manager.ts (applies pending migrations)
 *   - Lookup data export/import (pricing types, fee groups, campaigns, etc.)
 *   - Safety confirmations for production deployments
 *   - Automatic backup creation before migration apply
 * 
 * Usage:
 *   tsx scripts/sync-environments.ts dev-to-test    # Sync Development to Test
 *   tsx scripts/sync-environments.ts test-to-prod   # Sync Test to Production
 *   tsx scripts/sync-environments.ts status         # Check sync status
 * 
 * Full Workflow Example:
 *   1. tsx scripts/migration-manager.ts generate    # Generate migration from schema changes
 *   2. tsx scripts/sync-environments.ts dev-to-test # Apply to test + sync data
 *   3. tsx scripts/migration-manager.ts validate    # Verify consistency
 *   4. tsx scripts/sync-environments.ts test-to-prod # Apply to production + sync data
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';

const execAsync = promisify(exec);

interface SyncStep {
  name: string;
  command: string;
  description: string;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

class EnvironmentSync {
  async showStatus() {
    console.log('\n📊 Checking Environment Sync Status...\n');
    
    try {
      // Check migration status
      console.log('=== Schema Migration Status ===\n');
      const { stdout: migrationStatus } = await execAsync('tsx scripts/migration-manager.ts status');
      console.log(migrationStatus);
      
      console.log('\n=== Lookup Data Status ===\n');
      const { stdout: dataStatus } = await execAsync('tsx scripts/data-sync-manager.ts status');
      console.log(dataStatus);
      
    } catch (error: any) {
      console.error('❌ Error checking status:', error.message);
    }
  }

  async syncDevToTest() {
    console.log('\n🔄 SYNC: Development → Test\n');
    console.log('This will:');
    console.log('  1. Apply pending migrations to Test database');
    console.log('  2. Export lookup data from Dev');
    console.log('  3. Import lookup data into Test');
    console.log('\n⚠️  WARNING: This will overwrite Test data with Dev data!\n');
    console.log('💡 Note: Generate migrations first with: tsx scripts/migration-manager.ts generate\n');
    
    if (!AUTO_CONFIRM) {
      const confirm = await ask('Do you want to continue? (yes/no): ');
      
      if (confirm.toLowerCase() !== 'yes') {
        console.log('❌ Sync cancelled.');
        return;
      }
    } else {
      console.log('✅ Auto-confirmed: Proceeding with sync...');
    }
    
    // Apply pending migrations to test database
    console.log('\n[1/3] Applying pending migrations to Test database...');
    try {
      const { stdout, stderr } = await execAsync('tsx scripts/migration-manager.ts apply test');
      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes('warn')) console.error('⚠️  Warnings:', stderr);
      console.log('✅ Migrations applied to Test');
    } catch (error: any) {
      console.error('❌ Error applying migrations to Test:', error.message);
      if (error.stdout) console.log(error.stdout);
      if (error.stderr) console.error(error.stderr);
      
      if (AUTO_CONFIRM) {
        console.log('⚠️  Error occurred in auto-confirm mode - aborting sync for safety');
        throw error;
      } else {
        const continueAnyway = await ask('\nContinue with remaining steps? (yes/no): ');
        if (continueAnyway.toLowerCase() !== 'yes') {
          console.log('❌ Sync aborted.');
          throw error;
        }
      }
    }
    
    const steps: SyncStep[] = [
      {
        name: 'Export Lookup Data from Dev',
        command: 'tsx scripts/data-sync-manager.ts export development',
        description: 'Exporting lookup data from Development...'
      }
    ];
    
    await this.executeSteps(steps);
    
    // Get the latest DEVELOPMENT export and import it
    console.log('\n[3/3] Importing lookup data into Test...');
    try {
      const { stdout: listOutput } = await execAsync('tsx scripts/data-sync-manager.ts list');
      const allExports = listOutput.trim().split('\n').filter(line => line.includes('-'));
      
      // Filter to only get DEVELOPMENT exports
      const devExports = allExports.filter(line => line.trim().startsWith('development-'));
      
      if (devExports.length === 0) {
        console.error('❌ No development exports found after export step');
        return;
      }
      
      const latestDevExport = devExports[devExports.length - 1].trim();
      console.log(`Using latest development export: ${latestDevExport}`);
      
      const { stdout: importOutput } = await execAsync(`tsx scripts/data-sync-manager.ts import test "${latestDevExport}" --clear-first`);
      console.log(importOutput);
      console.log('✅ Import Lookup Data to Test completed');
      
    } catch (error: any) {
      console.error('❌ Error importing lookup data:', error.message);
      if (error.stdout) console.log(error.stdout);
      if (error.stderr) console.error(error.stderr);
    }
    
    console.log('\n✅ Development → Test sync complete!\n');
  }

  async syncTestToProd() {
    console.log('\n🔄 SYNC: Test → Production\n');
    console.log('This will:');
    console.log('  1. Apply pending migrations to Production database');
    console.log('  2. Export lookup data from Test');
    console.log('  3. Import lookup data into Production');
    console.log('\n🚨 CRITICAL WARNING: This affects PRODUCTION data!\n');
    console.log('💡 Note: Ensure migrations are tested in Test environment first\n');
    
    if (!AUTO_CONFIRM) {
      const confirm1 = await ask('Are you ABSOLUTELY SURE you want to sync to Production? (yes/no): ');
      
      if (confirm1.toLowerCase() !== 'yes') {
        console.log('❌ Sync cancelled.');
        return;
      }
      
      const confirm2 = await ask('Type "SYNC TO PRODUCTION" to confirm: ');
      
      if (confirm2 !== 'SYNC TO PRODUCTION') {
        console.log('❌ Sync cancelled. Confirmation text did not match.');
        return;
      }
    } else {
      console.log('✅ Auto-confirmed: Proceeding with PRODUCTION sync...');
    }
    
    // Apply pending migrations to production database
    console.log('\n[1/3] Applying pending migrations to Production database...');
    try {
      const { stdout, stderr } = await execAsync('tsx scripts/migration-manager.ts apply prod');
      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes('warn')) console.error('⚠️  Warnings:', stderr);
      console.log('✅ Migrations applied to Production');
    } catch (error: any) {
      console.error('❌ Error applying migrations to Production:', error.message);
      if (error.stdout) console.log(error.stdout);
      if (error.stderr) console.error(error.stderr);
      
      if (AUTO_CONFIRM) {
        console.log('⚠️  Error occurred in auto-confirm mode - aborting sync for safety');
        throw error;
      } else {
        const continueAnyway = await ask('\nContinue with remaining steps? (yes/no): ');
        if (continueAnyway.toLowerCase() !== 'yes') {
          console.log('❌ Sync aborted.');
          throw error;
        }
      }
    }
    
    const steps: SyncStep[] = [
      {
        name: 'Export Lookup Data from Test',
        command: 'tsx scripts/data-sync-manager.ts export test',
        description: 'Exporting lookup data from Test...'
      }
    ];
    
    await this.executeSteps(steps);
    
    // Get the latest TEST export and import it
    console.log('\n[3/3] Importing lookup data into Production...');
    try {
      const { stdout: listOutput } = await execAsync('tsx scripts/data-sync-manager.ts list');
      const allExports = listOutput.trim().split('\n').filter(line => line.includes('-'));
      
      // Filter to only get TEST exports
      const testExports = allExports.filter(line => line.trim().startsWith('test-'));
      
      if (testExports.length === 0) {
        console.error('❌ No test exports found after export step');
        return;
      }
      
      const latestTestExport = testExports[testExports.length - 1].trim();
      console.log(`Using latest test export: ${latestTestExport}`);
      
      const { stdout: importOutput } = await execAsync(`tsx scripts/data-sync-manager.ts import production "${latestTestExport}" --clear-first`);
      console.log(importOutput);
      console.log('✅ Import Lookup Data to Production completed');
      
    } catch (error: any) {
      console.error('❌ Error importing lookup data:', error.message);
      if (error.stdout) console.log(error.stdout);
      if (error.stderr) console.error(error.stderr);
    }
    
    console.log('\n✅ Test → Production sync complete!\n');
    console.log('⚠️  Remember to verify Production application immediately!\n');
  }

  private async executeSteps(steps: SyncStep[]) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`\n[${i + 1}/${steps.length}] ${step.description}`);
      
      try {
        const { stdout, stderr } = await execAsync(step.command);
        
        if (stdout) {
          console.log(stdout);
        }
        
        if (stderr && !stderr.includes('warn')) {
          console.error('⚠️  Warnings:', stderr);
        }
        
        console.log(`✅ ${step.name} completed`);
        
      } catch (error: any) {
        console.error(`\n❌ Error in step: ${step.name}`);
        console.error(error.message);
        
        if (error.stdout) console.log(error.stdout);
        if (error.stderr) console.error(error.stderr);
        
        if (!AUTO_CONFIRM) {
          const continueAnyway = await ask('\nContinue with remaining steps? (yes/no): ');
          
          if (continueAnyway.toLowerCase() !== 'yes') {
            console.log('❌ Sync aborted.');
            throw error;
          }
        } else {
          console.log('⚠️  Error occurred in auto-confirm mode - aborting sync for safety');
          throw error;
        }
      }
    }
  }
}

// Global flag for auto-confirmation (used when called from API)
let AUTO_CONFIRM = false;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Check for auto-confirm flag
  if (args.includes('--auto-confirm') || args.includes('-y')) {
    AUTO_CONFIRM = true;
    console.log('🤖 Running in auto-confirm mode (no prompts)');
  }
  
  const sync = new EnvironmentSync();
  
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Environment Synchronization Tool          ║');
  console.log('║   Dev → Test → Production Pipeline          ║');
  console.log('╚══════════════════════════════════════════════╝');
  
  try {
    switch (command) {
      case 'dev-to-test':
        await sync.syncDevToTest();
        break;
        
      case 'test-to-prod':
        await sync.syncTestToProd();
        break;
        
      case 'status':
        await sync.showStatus();
        break;
        
      default:
        console.log('\n📖 Usage:');
        console.log('  tsx scripts/sync-environments.ts dev-to-test [--auto-confirm]    # Sync Dev → Test');
        console.log('  tsx scripts/sync-environments.ts test-to-prod [--auto-confirm]   # Sync Test → Prod');
        console.log('  tsx scripts/sync-environments.ts status                          # Check status');
        console.log('\n💡 Always follow the pipeline: Dev → Test → Production');
        console.log('   Use --auto-confirm to skip confirmation prompts (for API use)\n');
    }
  } catch (error: any) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
