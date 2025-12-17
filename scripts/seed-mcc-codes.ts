import { Pool } from 'pg';
import { MCC_CODES } from '../shared/mccCodes';

async function seedMccCodes() {
  const databaseUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ No database URL found. Set DEV_DATABASE_URL or DATABASE_URL');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🔄 Seeding MCC codes to lookup table...');
    
    await pool.query('BEGIN');

    let inserted = 0;
    let skipped = 0;

    for (const mcc of MCC_CODES) {
      const result = await pool.query(
        `INSERT INTO mcc_codes (code, description, category, risk_level, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (code) DO NOTHING
         RETURNING id`,
        [mcc.code, mcc.description, mcc.category, mcc.riskLevel]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }

    await pool.query('COMMIT');

    console.log(`✅ MCC codes seeding complete:`);
    console.log(`   - Inserted: ${inserted}`);
    console.log(`   - Skipped (already exist): ${skipped}`);
    console.log(`   - Total processed: ${MCC_CODES.length}`);

    // Show summary by category
    const categoryResult = await pool.query(`
      SELECT category, COUNT(*) as count 
      FROM mcc_codes 
      GROUP BY category 
      ORDER BY count DESC
    `);
    
    console.log('\n📊 MCC codes by category:');
    for (const row of categoryResult.rows) {
      console.log(`   ${row.category}: ${row.count}`);
    }

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error seeding MCC codes:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedMccCodes();
