#!/usr/bin/env tsx

/**
 * Seed MCC Policies from shared/mccCodes.ts
 * 
 * This script populates the mcc_policies table with the MCC codes
 * defined in the shared mccCodes.ts file.
 * 
 * Usage:
 *   tsx scripts/seed-mcc-policies.ts [environment]
 * 
 * Environments: development (default), test, production
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { MCC_CODES } from '../shared/mccCodes';

neonConfig.webSocketConstructor = ws;

type Environment = 'development' | 'test' | 'production';

function getDatabaseUrl(env: Environment): string | null {
  switch (env) {
    case 'production':
      return process.env.DATABASE_URL || null;
    case 'test':
      return process.env.TEST_DATABASE_URL || null;
    case 'development':
    default:
      return process.env.DEV_DATABASE_URL || null;
  }
}

function mapRiskLevelToCategory(riskLevel: 'low' | 'medium' | 'high'): string {
  switch (riskLevel) {
    case 'low':
      return 'auto_approved';
    case 'medium':
      return 'review_required';
    case 'high':
      return 'restricted';
    default:
      return 'review_required';
  }
}

async function seedMCCPolicies(env: Environment): Promise<void> {
  const databaseUrl = getDatabaseUrl(env);
  
  if (!databaseUrl) {
    console.error(`❌ Database URL not configured for environment: ${env}`);
    process.exit(1);
  }

  console.log(`\n🌱 Seeding MCC Policies to ${env.toUpperCase()} database`);
  console.log('='.repeat(60));
  console.log(`📊 Total MCC codes to insert: ${MCC_CODES.length}`);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const client = await pool.connect();

    // Check current count
    const countResult = await client.query('SELECT COUNT(*) as count FROM mcc_policies');
    const existingCount = parseInt(countResult.rows[0].count, 10);
    
    if (existingCount > 0) {
      console.log(`\n⚠️  Warning: Table already has ${existingCount} rows`);
      console.log('    Skipping duplicates based on mcc_code...\n');
    }

    let inserted = 0;
    let skipped = 0;

    for (const mcc of MCC_CODES) {
      const category = mapRiskLevelToCategory(mcc.riskLevel);
      
      try {
        // Check if this MCC already exists (with null acquirer_id)
        const existing = await client.query(
          'SELECT id FROM mcc_policies WHERE mcc_code = $1 AND acquirer_id IS NULL',
          [mcc.code]
        );
        
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
        
        await client.query(`
          INSERT INTO mcc_policies (mcc_code, description, category, risk_level, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, true, NOW(), NOW())
        `, [mcc.code, mcc.description, category, mcc.riskLevel]);
        
        inserted++;
      } catch (error: any) {
        if (error.code === '23505') { // Unique violation
          skipped++;
        } else {
          console.error(`  ❌ Error inserting MCC ${mcc.code}: ${error.message}`);
        }
      }
    }

    client.release();

    console.log('\n' + '='.repeat(60));
    console.log('📊 SEED SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Inserted: ${inserted} MCC policies`);
    if (skipped > 0) {
      console.log(`⏭️  Skipped (duplicates): ${skipped}`);
    }
    
    // Verify final count
    const finalCount = await pool.query('SELECT COUNT(*) as count FROM mcc_policies');
    console.log(`📈 Total in table: ${finalCount.rows[0].count} MCC policies`);

  } catch (error: any) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Main execution
const args = process.argv.slice(2);
const targetEnv = (args[0] || 'development') as Environment;

if (!['development', 'test', 'production'].includes(targetEnv)) {
  console.error('❌ Invalid environment. Use: development, test, or production');
  process.exit(1);
}

if (targetEnv === 'production') {
  console.error('\n🚫 PRODUCTION SEEDING BLOCKED');
  console.error('   For safety, MCC policies should be managed through the admin UI in production.');
  console.error('   If this is intentional, modify this script to allow production seeding.');
  process.exit(1);
}

seedMCCPolicies(targetEnv);
