import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface ColumnInfo {
  table: string;
  column: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  ordinalPosition: number;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

interface DriftReport {
  hasDrift: boolean;
  missingInSchema: ColumnInfo[];
  extraInSchema: ColumnInfo[];
  columnOrderMismatches: Array<{
    table: string;
    issue: string;
  }>;
  summary: string;
}

class SchemaDriftDetector {
  private devPool: Pool;

  constructor() {
    const devUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;
    if (!devUrl) {
      throw new Error('DEV_DATABASE_URL not found in environment');
    }
    
    this.devPool = new Pool({
      connectionString: devUrl,
    });
  }

  async getDatabaseSchema(): Promise<Map<string, ColumnInfo[]>> {
    const query = `
      SELECT 
        table_name as "table",
        column_name as "column",
        data_type as "dataType",
        is_nullable as "isNullable",
        column_default as "columnDefault",
        ordinal_position as "ordinalPosition"
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND table_name NOT IN ('drizzle_migrations', 'drizzle__migrations')
      ORDER BY table_name, ordinal_position
    `;

    const result = await this.devPool.query(query);
    const schemaMap = new Map<string, ColumnInfo[]>();

    for (const row of result.rows) {
      const tableName = row.table;
      if (!schemaMap.has(tableName)) {
        schemaMap.set(tableName, []);
      }
      schemaMap.get(tableName)!.push(row);
    }

    return schemaMap;
  }

  async getSchemaFileDefinitions(): Promise<Map<string, string[]>> {
    // Import schema using the correct path with TypeScript extension
    const schema = await import('../shared/schema');
    
    const schemaMap = new Map<string, string[]>();
    
    // Extract table definitions from schema
    for (const [key, value] of Object.entries(schema)) {
      if (value && typeof value === 'object') {
        // Check for Drizzle table objects - they have a _ property with table config
        const tableObj = value as any;
        
        // Try multiple ways to detect Drizzle tables
        let tableName: string | undefined;
        let columns: string[] = [];
        
        // Method 1: Check for _.name (Drizzle ORM table property)
        if (tableObj._ && tableObj._.name) {
          tableName = tableObj._.name;
          // Get columns from the table's column definitions
          if (tableObj._ && typeof tableObj._ === 'object') {
            const tableConfig = tableObj._;
            if (tableConfig.columns) {
              columns = Object.keys(tableConfig.columns);
            }
          }
        }
        
        // Method 2: Check for getSQL method (indicates it's a Drizzle table)
        if (!tableName && typeof tableObj.getSQL === 'function' && tableObj[Symbol.for('drizzle:Name')]) {
          tableName = tableObj[Symbol.for('drizzle:Name')];
        }
        
        // Method 3: Look for columns using Symbol
        if (tableName && columns.length === 0) {
          const columnsSymbol = Symbol.for('drizzle:Columns');
          if (tableObj[columnsSymbol]) {
            columns = Object.keys(tableObj[columnsSymbol]);
          }
        }
        
        // Method 4: If still no columns, try to get them from direct properties
        if (tableName && columns.length === 0) {
          for (const [propKey, propValue] of Object.entries(tableObj)) {
            if (propValue && typeof propValue === 'object' && (propValue as any).name && (propValue as any).dataType) {
              columns.push((propValue as any).name);
            }
          }
        }
        
        if (tableName && columns.length > 0) {
          schemaMap.set(tableName, columns);
        }
      }
    }

    return schemaMap;
  }

  async detectDrift(): Promise<DriftReport> {
    console.log('🔍 Detecting schema drift between Development database and shared/schema.ts...\n');

    const dbSchema = await this.getDatabaseSchema();
    const fileSchema = await this.getSchemaFileDefinitions();

    const missingInSchema: ColumnInfo[] = [];
    const extraInSchema: ColumnInfo[] = [];
    const columnOrderMismatches: Array<{ table: string; issue: string }> = [];

    // Check for tables and columns in DB but not in schema file
    for (const [tableName, dbColumns] of dbSchema.entries()) {
      const fileColumns = fileSchema.get(tableName);

      if (!fileColumns) {
        // Table exists in DB but not in schema file
        console.log(`⚠️  Table "${tableName}" exists in database but not in schema.ts`);
        continue;
      }

      // Check for missing columns
      for (const dbCol of dbColumns) {
        const columnNameInFile = this.camelCaseToSnakeCase(dbCol.column);
        const columnExists = fileColumns.some(fc => 
          this.camelCaseToSnakeCase(fc) === dbCol.column
        );

        if (!columnExists) {
          missingInSchema.push(dbCol);
        }
      }
    }

    // Check for columns in schema file but not in DB
    for (const [tableName, fileColumns] of fileSchema.entries()) {
      const dbColumns = dbSchema.get(tableName);

      if (!dbColumns) {
        // Table exists in schema but not in DB
        console.log(`⚠️  Table "${tableName}" defined in schema.ts but not in database`);
        continue;
      }

      const dbColumnNames = dbColumns.map(c => c.column);

      for (const fileCol of fileColumns) {
        const snakeCase = this.camelCaseToSnakeCase(fileCol);
        if (!dbColumnNames.includes(snakeCase)) {
          extraInSchema.push({
            table: tableName,
            column: fileCol,
            dataType: 'unknown',
            isNullable: 'unknown',
            columnDefault: null,
            ordinalPosition: 0,
          });
        }
      }
    }

    const hasDrift = missingInSchema.length > 0 || extraInSchema.length > 0;

    let summary = '';
    if (!hasDrift) {
      summary = '✅ No drift detected - Development database matches shared/schema.ts';
    } else {
      summary = `❌ Drift detected:\n`;
      summary += `   • ${missingInSchema.length} columns in database NOT in schema.ts\n`;
      summary += `   • ${extraInSchema.length} columns in schema.ts NOT in database`;
    }

    return {
      hasDrift,
      missingInSchema,
      extraInSchema,
      columnOrderMismatches,
      summary,
    };
  }

  private camelCaseToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  displayReport(report: DriftReport): void {
    console.log('\n' + '='.repeat(70));
    console.log('SCHEMA DRIFT DETECTION REPORT');
    console.log('='.repeat(70) + '\n');

    console.log(report.summary + '\n');

    if (report.missingInSchema.length > 0) {
      console.log('📋 Columns in DATABASE but NOT in schema.ts:');
      console.log('-'.repeat(70));
      
      const byTable = new Map<string, ColumnInfo[]>();
      for (const col of report.missingInSchema) {
        if (!byTable.has(col.table)) {
          byTable.set(col.table, []);
        }
        byTable.get(col.table)!.push(col);
      }

      for (const [table, cols] of byTable) {
        console.log(`\n  ${table}:`);
        for (const col of cols) {
          console.log(`    • ${col.column} (${col.dataType})`);
        }
      }
      console.log('');
    }

    if (report.extraInSchema.length > 0) {
      console.log('📋 Columns in SCHEMA.TS but NOT in database:');
      console.log('-'.repeat(70));
      
      const byTable = new Map<string, ColumnInfo[]>();
      for (const col of report.extraInSchema) {
        if (!byTable.has(col.table)) {
          byTable.set(col.table, []);
        }
        byTable.get(col.table)!.push(col);
      }

      for (const [table, cols] of byTable) {
        console.log(`\n  ${table}:`);
        for (const col of cols) {
          console.log(`    • ${col.column}`);
        }
      }
      console.log('');
    }

    if (report.hasDrift) {
      console.log('💡 RECOMMENDED ACTIONS:');
      console.log('-'.repeat(70));
      
      if (report.missingInSchema.length > 0) {
        console.log('\n1. Update shared/schema.ts to include missing columns:');
        console.log('   → Run: npm run schema:sync-from-dev (coming soon)');
        console.log('   → Or manually add columns to schema.ts\n');
      }

      if (report.extraInSchema.length > 0) {
        console.log('2. Apply schema.ts to Development database:');
        console.log('   → Run: npm run db:push');
        console.log('   → This will add missing columns to Development\n');
      }

      console.log('3. After fixing, verify with:');
      console.log('   → Run: tsx scripts/schema-drift-detector.ts\n');
    } else {
      console.log('🎉 Your schema is clean! Development and schema.ts are in sync.\n');
      console.log('💡 NEXT STEPS:');
      console.log('-'.repeat(70));
      console.log('\n1. Sync to Test environment:');
      console.log('   → Run: tsx scripts/sync-environments.ts dev-to-test\n');
      console.log('2. Monitor for drift:');
      console.log('   → Check Database Utilities → Schema Health tab\n');
    }

    console.log('='.repeat(70) + '\n');
  }

  async cleanup(): Promise<void> {
    await this.devPool.end();
  }
}

// Main execution
async function main() {
  const detector = new SchemaDriftDetector();
  
  try {
    const report = await detector.detectDrift();
    detector.displayReport(report);
    
    // Exit with error code if drift detected
    process.exit(report.hasDrift ? 1 : 0);
  } catch (error) {
    console.error('❌ Error detecting drift:', error);
    process.exit(1);
  } finally {
    await detector.cleanup();
  }
}

main();
