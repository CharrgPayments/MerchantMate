import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

interface ColumnInfo {
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface TableInfo {
  table_name: string;
  columns: Map<string, ColumnInfo>;
}

async function getSchemaInfo(dbUrl: string): Promise<Map<string, TableInfo>> {
  const sql = neon(dbUrl);
  
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  
  const result = new Map<string, TableInfo>();
  
  for (const table of tables) {
    const columns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = ${table.table_name}
      ORDER BY ordinal_position
    `;
    
    const columnMap = new Map<string, ColumnInfo>();
    for (const col of columns) {
      columnMap.set(col.column_name, {
        data_type: col.data_type,
        is_nullable: col.is_nullable,
        column_default: col.column_default
      });
    }
    
    result.set(table.table_name, {
      table_name: table.table_name,
      columns: columnMap
    });
  }
  
  return result;
}

async function compare() {
  console.log('Comparing Production vs Development Database Schemas...\n');
  
  const prodUrl = process.env.DATABASE_URL!;
  const devUrl = process.env.DEV_DATABASE_URL!;
  
  const [prodSchema, devSchema] = await Promise.all([
    getSchemaInfo(prodUrl),
    getSchemaInfo(devUrl)
  ]);
  
  console.log(`Production tables: ${prodSchema.size}`);
  console.log(`Development tables: ${devSchema.size}\n`);
  
  // Tables only in Production
  const prodOnly: string[] = [];
  for (const tableName of prodSchema.keys()) {
    if (!devSchema.has(tableName)) {
      prodOnly.push(tableName);
    }
  }
  
  // Tables only in Development
  const devOnly: string[] = [];
  for (const tableName of devSchema.keys()) {
    if (!prodSchema.has(tableName)) {
      devOnly.push(tableName);
    }
  }
  
  // Column differences
  const columnDiffs: { table: string; prodOnly: string[]; devOnly: string[] }[] = [];
  
  for (const [tableName, prodTable] of prodSchema) {
    const devTable = devSchema.get(tableName);
    if (!devTable) continue;
    
    const prodCols = new Set(prodTable.columns.keys());
    const devCols = new Set(devTable.columns.keys());
    
    const prodOnlyCols = [...prodCols].filter(c => !devCols.has(c));
    const devOnlyCols = [...devCols].filter(c => !prodCols.has(c));
    
    if (prodOnlyCols.length > 0 || devOnlyCols.length > 0) {
      columnDiffs.push({
        table: tableName,
        prodOnly: prodOnlyCols,
        devOnly: devOnlyCols
      });
    }
  }
  
  // Print results
  console.log('='.repeat(70));
  console.log('TABLES ONLY IN PRODUCTION (may need to add to development):');
  console.log('='.repeat(70));
  if (prodOnly.length === 0) {
    console.log('  None - All production tables exist in development');
  } else {
    prodOnly.forEach(t => console.log(`  - ${t}`));
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('TABLES ONLY IN DEVELOPMENT (new, not yet in production):');
  console.log('='.repeat(70));
  if (devOnly.length === 0) {
    console.log('  None - All development tables exist in production');
  } else {
    devOnly.forEach(t => console.log(`  - ${t}`));
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('COLUMN DIFFERENCES:');
  console.log('='.repeat(70));
  if (columnDiffs.length === 0) {
    console.log('  None - All columns match between environments');
  } else {
    for (const diff of columnDiffs) {
      console.log(`\n  Table: ${diff.table}`);
      if (diff.prodOnly.length > 0) {
        console.log(`    Production only: ${diff.prodOnly.join(', ')}`);
      }
      if (diff.devOnly.length > 0) {
        console.log(`    Development only: ${diff.devOnly.join(', ')}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  console.log('='.repeat(70));
  console.log(`  Tables only in Production: ${prodOnly.length}`);
  console.log(`  Tables only in Development: ${devOnly.length}`);
  console.log(`  Tables with column differences: ${columnDiffs.length}`);
  
  if (prodOnly.length > 0 || columnDiffs.some(d => d.prodOnly.length > 0)) {
    console.log('\n⚠️  WARNING: Production has structure not in Development!');
    console.log('   Review before pushing Development schema.');
  } else {
    console.log('\n✅ Safe to proceed: Development has all Production features.');
  }
}

compare().catch(console.error);
