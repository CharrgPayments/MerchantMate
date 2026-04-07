#!/usr/bin/env tsx
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface ColumnInfo {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  position: number;
}

interface DriftResult {
  hasDrift: boolean;
  missingInTest: ColumnInfo[];
  extraInTest: ColumnInfo[];
  totalTables: number;
  totalColumns: number;
}

async function getSchema(connectionString: string): Promise<Map<string, ColumnInfo[]>> {
  const pool = new Pool({ connectionString });
  
  try {
    const result = await pool.query(`
      SELECT 
        table_name as "tableName",
        column_name as "columnName",
        data_type as "dataType",
        is_nullable as "isNullable",
        column_default as "columnDefault",
        ordinal_position as "position"
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND table_name NOT IN ('drizzle_migrations', 'drizzle__migrations')
      ORDER BY table_name, ordinal_position
    `);

    const schemaMap = new Map<string, ColumnInfo[]>();
    
    for (const row of result.rows) {
      const tableName = row.tableName;
      if (!schemaMap.has(tableName)) {
        schemaMap.set(tableName, []);
      }
      schemaMap.get(tableName)!.push(row);
    }

    return schemaMap;
  } finally {
    await pool.end();
  }
}

function compareSchemas(dev: Map<string, ColumnInfo[]>, test: Map<string, ColumnInfo[]>): DriftResult {
  const missingInTest: ColumnInfo[] = [];
  const extraInTest: ColumnInfo[] = [];

  // Find columns in Dev but not in Test
  for (const [tableName, devColumns] of dev.entries()) {
    const testColumns = test.get(tableName);
    
    if (!testColumns) {
      // Entire table missing in Test
      missingInTest.push(...devColumns);
      continue;
    }

    const testColumnNames = new Set(testColumns.map(c => c.columnName));
    
    for (const devCol of devColumns) {
      if (!testColumnNames.has(devCol.columnName)) {
        missingInTest.push(devCol);
      }
    }
  }

  // Find columns in Test but not in Dev  
  for (const [tableName, testColumns] of test.entries()) {
    const devColumns = dev.get(tableName);
    
    if (!devColumns) {
      // Entire table extra in Test
      extraInTest.push(...testColumns);
      continue;
    }

    const devColumnNames = new Set(devColumns.map(c => c.columnName));
    
    for (const testCol of testColumns) {
      if (!devColumnNames.has(testCol.columnName)) {
        extraInTest.push(testCol);
      }
    }
  }

  const hasDrift = missingInTest.length > 0 || extraInTest.length > 0;
  
  let totalTables = 0;
  let totalColumns = 0;
  for (const cols of dev.values()) {
    totalTables++;
    totalColumns += cols.length;
  }

  return {
    hasDrift,
    missingInTest,
    extraInTest,
    totalTables,
    totalColumns,
  };
}

function displayReport(result: DriftResult) {
  console.log('\n' + '='.repeat(80));
  console.log('SCHEMA DRIFT DETECTION: Development → Test');
  console.log('='.repeat(80) + '\n');

  console.log(`📊 Total Tables: ${result.totalTables}`);
  console.log(`📊 Total Columns in Dev: ${result.totalColumns}\n`);

  if (!result.hasDrift) {
    console.log('✅ NO DRIFT DETECTED\n');
    console.log('Development and Test schemas are perfectly synchronized!\n');
    console.log('💡 NEXT STEPS:');
    console.log('─'.repeat(80));
    console.log('1. Sync lookup data: tsx scripts/sync-environments.ts dev-to-test');
    console.log('2. Run validation: tsx scripts/schema-drift-simple.ts');
    console.log('3. When ready, promote to Production\n');
    return;
  }

  console.log(`❌ DRIFT DETECTED\n`);
  console.log(`   • ${result.missingInTest.length} columns in Dev NOT in Test`);
  console.log(`   • ${result.extraInTest.length} columns in Test NOT in Dev\n`);

  if (result.missingInTest.length > 0) {
    console.log('📋 MISSING IN TEST (Need to add):');
    console.log('─'.repeat(80));
    
    const byTable = new Map<string, ColumnInfo[]>();
    for (const col of result.missingInTest) {
      if (!byTable.has(col.tableName)) {
        byTable.set(col.tableName, []);
      }
      byTable.get(col.tableName)!.push(col);
    }

    for (const [table, cols] of byTable) {
      console.log(`\n  ${table} (${cols.length} columns):`);
      for (const col of cols) {
        const nullable = col.isNullable === 'YES' ? 'NULL' : 'NOT NULL';
        const def = col.columnDefault ? ` DEFAULT ${col.columnDefault}` : '';
        console.log(`    • ${col.columnName} (${col.dataType} ${nullable}${def})`);
      }
    }
    console.log('');
  }

  if (result.extraInTest.length > 0) {
    console.log('📋 EXTRA IN TEST (Need to remove):');
    console.log('─'.repeat(80));
    
    const byTable = new Map<string, ColumnInfo[]>();
    for (const col of result.extraInTest) {
      if (!byTable.has(col.tableName)) {
        byTable.set(col.tableName, []);
      }
      byTable.get(col.tableName)!.push(col);
    }

    for (const [table, cols] of byTable) {
      console.log(`\n  ${table} (${cols.length} columns):`);
      for (const col of cols) {
        console.log(`    • ${col.columnName} (${col.dataType})`);
      }
    }
    console.log('');
  }

  console.log('💡 RECOMMENDED ACTIONS:');
  console.log('─'.repeat(80));
  console.log('1. Update shared/schema.ts to match Development');
  console.log('2. Run: npm run db:push (to apply schema changes)');
  console.log('3. Sync to Test: tsx scripts/sync-environments.ts dev-to-test');
  console.log('4. Verify: tsx scripts/schema-drift-simple.ts\n');
  console.log('='.repeat(80) + '\n');
}

async function main() {
  const devUrl = process.env.DEV_DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!devUrl || !testUrl) {
    console.error('❌ Missing environment variables:');
    if (!devUrl) console.error('   • DEV_DATABASE_URL');
    if (!testUrl) console.error('   • TEST_DATABASE_URL');
    process.exit(1);
  }

  console.log('🔍 Comparing Development and Test database schemas...\n');

  try {
    const devSchema = await getSchema(devUrl);
    const testSchema = await getSchema(testUrl);
    
    const result = compareSchemas(devSchema, testSchema);
    displayReport(result);
    
    process.exit(result.hasDrift ? 1 : 0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
