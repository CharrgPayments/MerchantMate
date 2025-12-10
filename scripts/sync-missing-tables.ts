import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function syncMissingTables() {
  const prodPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const devPool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  
  try {
    const missingTables = [
      'workflow_definitions',  // Must be first - others reference it
      'workflow_stages',
      'workflow_tickets',
      'workflow_ticket_stages',
      'workflow_issues',
      'workflow_tasks',
      'workflow_notes',
      'workflow_artifacts',
      'workflow_transitions',
      'workflow_assignments',
      'mcc_policies', 
      'volume_thresholds',
      'api_integration_configs',
    ];
    
    console.log('Syncing missing tables from Production to Development...\n');
    
    for (const tableName of missingTables) {
      // Get column definitions from production
      const colResult = await prodPool.query(`
        SELECT 
          column_name, 
          data_type,
          udt_name,
          character_maximum_length,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      
      if (colResult.rows.length === 0) {
        console.log(`  ⊘ Table ${tableName} not found in production`);
        continue;
      }
      
      // Build CREATE TABLE statement with proper SERIAL handling
      const columns = colResult.rows.map(col => {
        let type = col.data_type;
        let defaultVal = col.column_default;
        
        // Convert integer with nextval to SERIAL
        if (type === 'integer' && defaultVal && defaultVal.includes('nextval')) {
          type = 'SERIAL';
          defaultVal = null; // SERIAL handles its own default
        } else if (type === 'ARRAY') {
          type = col.udt_name.replace(/^_/, '') + '[]';
        } else if (type === 'USER-DEFINED') {
          type = col.udt_name;
        } else if (col.character_maximum_length) {
          type += `(${col.character_maximum_length})`;
        }
        
        let def = `"${col.column_name}" ${type}`;
        if (col.is_nullable === 'NO' && type !== 'SERIAL') def += ' NOT NULL';
        if (defaultVal) def += ` DEFAULT ${defaultVal}`;
        return def;
      }).join(', ');
      
      // Get primary key
      const pkResult = await prodPool.query(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [tableName]);
      
      let pkConstraint = '';
      if (pkResult.rows.length > 0) {
        const pkCols = pkResult.rows.map(r => `"${r.attname}"`).join(', ');
        pkConstraint = `, PRIMARY KEY (${pkCols})`;
      }
      
      const createStmt = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns}${pkConstraint})`;
      
      console.log(`Creating table: ${tableName}`);
      try {
        await devPool.query(createStmt);
        console.log(`  ✓ Created ${tableName}`);
      } catch (err: any) {
        if (err.message?.includes('already exists')) {
          console.log(`  ⊘ Table ${tableName} already exists`);
        } else {
          console.log(`  ✗ Error: ${err.message}`);
        }
      }
    }
    
    // Create indexes
    console.log('\nCreating indexes...');
    const indexResult = await prodPool.query(`
      SELECT indexdef 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename = ANY($1)
      AND indexname NOT LIKE '%_pkey'
    `, [missingTables]);
    
    for (const row of indexResult.rows) {
      try {
        // Add IF NOT EXISTS to CREATE INDEX
        const indexDef = row.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS');
        await devPool.query(indexDef);
        console.log(`  ✓ Created index`);
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.log(`  ✗ Index error: ${err.message}`);
        }
      }
    }
    
    console.log('\nDone! Verifying...');
    
    // Verify
    const verifyResult = await devPool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [missingTables]);
    
    console.log(`Tables now in Development: ${verifyResult.rows.length}/${missingTables.length}`);
    
  } finally {
    await prodPool.end();
    await devPool.end();
  }
}

syncMissingTables().catch(console.error);
