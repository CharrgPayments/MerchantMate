#!/usr/bin/env tsx
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

interface ColumnInfo {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  position: number;
}

interface SchemaInfo {
  columns: ColumnInfo[];
  primaryKey: string | null;
}

async function getSchema(connectionString: string): Promise<Map<string, SchemaInfo>> {
  const pool = new Pool({ connectionString });
  
  try {
    // Get columns
    const columnsResult = await pool.query(`
      SELECT 
        table_name as "tableName",
        column_name as "columnName",
        data_type as "dataType",
        is_nullable as "isNullable",
        column_default as "columnDefault",
        ordinal_position as "position"
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND table_name NOT IN ('drizzle_migrations', 'drizzle__migrations', 'schema_migrations')
      ORDER BY table_name, ordinal_position
    `);

    // Get primary keys
    const pkResult = await pool.query(`
      SELECT
        tc.table_name as "tableName",
        kcu.column_name as "columnName"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name NOT IN ('drizzle_migrations', 'drizzle__migrations', 'schema_migrations')
    `);

    const schemaMap = new Map<string, SchemaInfo>();
    const pkMap = new Map<string, string>();
    
    // Map primary keys
    for (const row of pkResult.rows) {
      pkMap.set(row.tableName, row.columnName);
    }
    
    // Map columns
    for (const row of columnsResult.rows) {
      if (!schemaMap.has(row.tableName)) {
        schemaMap.set(row.tableName, {
          columns: [],
          primaryKey: pkMap.get(row.tableName) || null
        });
      }
      schemaMap.get(row.tableName)!.columns.push(row);
    }

    return schemaMap;
  } finally {
    await pool.end();
  }
}

function generateSyncSQL(
  source: Map<string, SchemaInfo>, 
  target: Map<string, SchemaInfo>,
  sourceEnv: string,
  targetEnv: string
): string[] {
  const sqlStatements: string[] = [];

  // Add missing columns and tables (in Source but not in Target)
  for (const [tableName, sourceInfo] of source.entries()) {
    const targetInfo = target.get(tableName);
    
    if (!targetInfo) {
      // Table exists in source but not in target - need to create it
      console.log(`⚠️  Table ${tableName} exists in ${sourceEnv} but not in ${targetEnv} - creating table`);
      
      // First, create any sequences needed for serial columns
      for (const col of sourceInfo.columns) {
        if (col.columnDefault?.includes('nextval')) {
          const seqMatch = col.columnDefault.match(/'([^']+)'/);
          if (seqMatch) {
            const seqName = seqMatch[1];
            sqlStatements.push(`CREATE SEQUENCE IF NOT EXISTS ${seqName};`);
          }
        }
      }
      
      // Generate CREATE TABLE statement with PRIMARY KEY
      const columnDefs = sourceInfo.columns.map(col => {
        const nullable = col.isNullable === 'YES' ? '' : ' NOT NULL';
        const defaultVal = col.columnDefault ? ` DEFAULT ${col.columnDefault}` : '';
        return `  ${col.columnName} ${col.dataType.toUpperCase()}${nullable}${defaultVal}`;
      }).join(',\n');
      
      // Add PRIMARY KEY constraint if it exists
      const pkConstraint = sourceInfo.primaryKey 
        ? `,\n  PRIMARY KEY (${sourceInfo.primaryKey})`
        : '';
      
      sqlStatements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n${columnDefs}${pkConstraint}\n);`);
      continue;
    }

    const targetColumnNames = new Set(targetInfo.columns.map(c => c.columnName));
    
    for (const sourceCol of sourceInfo.columns) {
      if (!targetColumnNames.has(sourceCol.columnName)) {
        const nullable = sourceCol.isNullable === 'YES' ? '' : ' NOT NULL';
        const defaultVal = sourceCol.columnDefault ? ` DEFAULT ${sourceCol.columnDefault}` : '';
        
        sqlStatements.push(
          `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${sourceCol.columnName} ${sourceCol.dataType.toUpperCase()}${nullable}${defaultVal};`
        );
      }
    }
  }

  // Remove extra columns (in Target but not in Source)
  for (const [tableName, targetInfo] of target.entries()) {
    const sourceInfo = source.get(tableName);
    
    if (!sourceInfo) {
      console.log(`⚠️  Table ${tableName} exists in ${targetEnv} but not in ${sourceEnv} - will be dropped`);
      sqlStatements.push(`DROP TABLE IF EXISTS ${tableName};`);
      continue;
    }

    const sourceColumnNames = new Set(sourceInfo.columns.map(c => c.columnName));
    
    for (const targetCol of targetInfo.columns) {
      if (!sourceColumnNames.has(targetCol.columnName)) {
        sqlStatements.push(
          `ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${targetCol.columnName};`
        );
      }
    }
  }

  return sqlStatements;
}

async function main() {
  // Get source and target environments from command line args
  const sourceEnv = process.argv[2] || 'development';
  const targetEnv = process.argv[3] || 'test';
  
  // Map environment names to database URL environment variables
  const envUrlMap: Record<string, string> = {
    'development': process.env.DEV_DATABASE_URL || '',
    'test': process.env.TEST_DATABASE_URL || '',
    'production': process.env.DATABASE_URL || ''
  };

  const sourceUrl = envUrlMap[sourceEnv];
  const targetUrl = envUrlMap[targetEnv];

  if (!sourceUrl || !targetUrl) {
    console.error(`❌ Missing environment variables for ${sourceEnv} or ${targetEnv}`);
    process.exit(1);
  }

  console.log(`🔍 Analyzing schema differences: ${sourceEnv} → ${targetEnv}\n`);

  const sourceSchema = await getSchema(sourceUrl);
  const targetSchema = await getSchema(targetUrl);
  
  const syncSQL = generateSyncSQL(sourceSchema, targetSchema, sourceEnv, targetEnv);

  if (syncSQL.length === 0) {
    console.log('✅ No synchronization needed - schemas match!\n');
    return;
  }

  console.log(`📝 Generated ${syncSQL.length} SQL statements to sync ${targetEnv} with ${sourceEnv}\n`);

  // Create migrations directory if it doesn't exist
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `schema-fix-${sourceEnv}-to-${targetEnv}-${timestamp}.sql`;
  const filepath = join(process.cwd(), 'migrations', filename);

  // Write to file
  const sqlContent = [
    `-- Schema Synchronization: ${sourceEnv} → ${targetEnv}`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total statements: ${syncSQL.length}`,
    ``,
    `BEGIN;`,
    ``,
    ...syncSQL,
    ``,
    `COMMIT;`,
    ``,
    `-- Verification query:`,
    `-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;`,
  ].join('\n');

  try {
    writeFileSync(filepath, sqlContent);
    console.log(`✅ Sync SQL written to: ${filepath}`);
    console.log(`Generated migration file: ${filepath}\n`);
  } catch (error) {
    console.log('📋 Sync SQL statements:\n');
    console.log(sqlContent);
  }

  console.log('💡 TO APPLY THIS SYNC:');
  console.log('─'.repeat(80));
  console.log(`1. Review the SQL file: ${filename}`);
  console.log(`2. Apply to ${targetEnv}: psql "$${targetEnv.toUpperCase()}_DATABASE_URL" < migrations/${filename}`);
  console.log(`3. Verify: tsx scripts/schema-drift-simple.ts ${sourceEnv} ${targetEnv}\n`);
}

main().catch(console.error);
