#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { createHash } from 'crypto';

// Configure Neon for serverless
neonConfig.webSocketConstructor = ws;

interface Environment {
  name: string;
  envVar: string;
  description: string;
  url?: string;
}

interface LookupTableConfig {
  name: string;
  dependencies: string[];
  description: string;
  preserveIds?: boolean; // Whether to preserve original IDs or auto-generate new ones
}

interface DataSyncResult {
  table: string;
  action: 'exported' | 'imported' | 'cleared';
  rows: number;
  checksum: string;
}

const environments: Environment[] = [
  { name: 'development', envVar: 'DEV_DATABASE_URL', description: 'Development Database' },
  { name: 'test', envVar: 'TEST_DATABASE_URL', description: 'Test Database' },
  { name: 'production', envVar: 'DATABASE_URL', description: 'Production Database' }
];

// Define lookup tables in dependency order (tables with no dependencies first)
const lookupTables: LookupTableConfig[] = [
  // Independent tables first
  { 
    name: 'fee_groups', 
    dependencies: [], 
    description: 'Fee group categories (Discount Rates, Gateway VT, etc.)',
    preserveIds: true 
  },
  { 
    name: 'fee_item_groups', 
    dependencies: ['fee_groups'], 
    description: 'Fee item sub-categories within fee groups',
    preserveIds: true 
  },
  { 
    name: 'equipment_items', 
    dependencies: [], 
    description: 'Payment processing equipment catalog',
    preserveIds: true 
  },
  { 
    name: 'email_templates', 
    dependencies: [], 
    description: 'Pre-defined email templates',
    preserveIds: true 
  },
  // Dependent tables last
  { 
    name: 'email_triggers', 
    dependencies: ['email_templates'], 
    description: 'Automated email trigger configurations',
    preserveIds: true 
  },
  { 
    name: 'fee_items', 
    dependencies: ['fee_item_groups'], 
    description: 'Individual fee items within groups',
    preserveIds: true 
  },
  { 
    name: 'fee_group_fee_items', 
    dependencies: ['fee_groups', 'fee_items', 'fee_item_groups'], 
    description: 'Many-to-many relationship between fee groups and fee items',
    preserveIds: false 
  }
];

class DataSyncManager {
  private dataSyncDir = path.join(process.cwd(), '..', 'data-sync');
  private exportDir = path.join(this.dataSyncDir, 'exports');

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataSyncDir)) {
      fs.mkdirSync(this.dataSyncDir, { recursive: true });
    }
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  private getDatabaseUrl(environment: string): string {
    const env = environments.find(e => e.name === environment);
    if (!env) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    
    const url = process.env[env.envVar];
    if (!url) {
      throw new Error(`${env.envVar} environment variable not set`);
    }
    
    return url;
  }

  private async createDatabaseConnection(environment: string): Promise<Pool> {
    const url = this.getDatabaseUrl(environment);
    return new Pool({ connectionString: url });
  }

  private generateChecksum(data: any[]): string {
    const dataString = JSON.stringify(data, null, 0);
    return createHash('md5').update(dataString).digest('hex');
  }

  async exportLookupData(sourceEnvironment: string, tables?: string[]): Promise<string> {
    console.log(`🔄 Exporting lookup data from ${sourceEnvironment}...`);
    
    const pool = await this.createDatabaseConnection(sourceEnvironment);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportName = `${sourceEnvironment}-${timestamp}`;
    const exportPath = path.join(this.exportDir, `${exportName}.json`);
    
    const exportData: { [tableName: string]: { data: any[], checksum: string, count: number } } = {};
    const results: DataSyncResult[] = [];
    
    try {
      const tablesToExport = tables ? 
        lookupTables.filter(t => tables.includes(t.name)) : 
        lookupTables;

      for (const tableConfig of tablesToExport) {
        console.log(`  📊 Exporting ${tableConfig.name}...`);
        
        // Get all data from the table
        const result = await pool.query(`SELECT * FROM ${tableConfig.name} ORDER BY id`);
        const data = result.rows;
        const checksum = this.generateChecksum(data);
        
        exportData[tableConfig.name] = {
          data,
          checksum,
          count: data.length
        };
        
        results.push({
          table: tableConfig.name,
          action: 'exported',
          rows: data.length,
          checksum
        });
        
        console.log(`     ✅ ${data.length} rows exported`);
      }
      
      // Write export file
      const exportMetadata = {
        sourceEnvironment,
        exportedAt: new Date().toISOString(),
        tables: exportData,
        totalTables: Object.keys(exportData).length,
        totalRows: Object.values(exportData).reduce((sum, table) => sum + table.count, 0)
      };
      
      fs.writeFileSync(exportPath, JSON.stringify(exportMetadata, null, 2));
      
      console.log(`\n✅ Export completed: ${exportName}.json`);
      console.log(`   📁 Location: ${exportPath}`);
      console.log(`   📊 Tables: ${Object.keys(exportData).length}`);
      console.log(`   📝 Total rows: ${exportMetadata.totalRows}`);
      
      return exportName;
      
    } finally {
      await pool.end();
    }
  }

  async importLookupData(targetEnvironment: string, exportName: string, options: {
    dryRun?: boolean,
    clearFirst?: boolean,
    tables?: string[]
  } = {}): Promise<DataSyncResult[]> {
    
    console.log(`🔄 Importing lookup data to ${targetEnvironment}...`);
    if (options.dryRun) {
      console.log(`   🧪 DRY RUN MODE - No actual changes will be made`);
    }
    
    const exportPath = path.join(this.exportDir, `${exportName}.json`);
    if (!fs.existsSync(exportPath)) {
      throw new Error(`Export file not found: ${exportName}.json`);
    }
    
    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    const pool = await this.createDatabaseConnection(targetEnvironment);
    const results: DataSyncResult[] = [];
    
    try {
      const tablesToImport = options.tables ? 
        lookupTables.filter(t => options.tables!.includes(t.name) && exportData.tables[t.name]) : 
        lookupTables.filter(t => exportData.tables[t.name]);

      // Start transaction for data integrity
      if (!options.dryRun) {
        await pool.query('BEGIN');
      }
      
      // Clear existing data if requested (in reverse dependency order)
      if (options.clearFirst && !options.dryRun) {
        console.log(`  🗑️ Clearing existing data (reverse dependency order)...`);
        const reverseTables = [...tablesToImport].reverse();
        for (const tableConfig of reverseTables) {
          await pool.query(`DELETE FROM ${tableConfig.name}`);
          console.log(`     ✅ Cleared ${tableConfig.name}`);
        }
      }
      
      for (const tableConfig of tablesToImport) {
        const tableData = exportData.tables[tableConfig.name];
        if (!tableData) {
          console.log(`  ⚠️ Skipping ${tableConfig.name} - no data in export`);
          continue;
        }
        
        console.log(`  📊 Importing ${tableConfig.name} (${tableData.count} rows)...`);
        
        if (!options.dryRun) {
          
          // Import data
          for (const row of tableData.data) {
            // Build column-value pairs for explicit INSERT
            const entries = Object.entries(row);
            const columns = entries.map(([key]) => key);
            const values = entries.map(([, value]) => {
              // Handle JSON/JSONB columns - convert objects/arrays to JSON strings
              if (value !== null && typeof value === 'object') {
                return JSON.stringify(value);
              }
              return value;
            });
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
            
            if (tableConfig.preserveIds) {
              // Insert with original IDs using ON CONFLICT for upsert
              const updateSet = columns
                .filter(col => col !== 'id')
                .map(col => `"${col}" = EXCLUDED."${col}"`)
                .join(', ');
              
              const insertQuery = `
                INSERT INTO ${tableConfig.name} (${columns.map(c => `"${c}"`).join(', ')}) 
                VALUES (${placeholders})
                ON CONFLICT (id) DO UPDATE SET ${updateSet}
              `;
              await pool.query(insertQuery, values);
            } else {
              // Insert without ID, let database auto-generate
              const columnsWithoutId = columns.filter(col => col !== 'id');
              const valuesWithoutId = values.filter((_, i) => columns[i] !== 'id');
              const placeholdersWithoutId = valuesWithoutId.map((_, i) => `$${i + 1}`).join(', ');
              
              const insertQuery = `
                INSERT INTO ${tableConfig.name} (${columnsWithoutId.join(', ')}) 
                VALUES (${placeholdersWithoutId})
              `;
              await pool.query(insertQuery, valuesWithoutId);
            }
          }
        }
        
        results.push({
          table: tableConfig.name,
          action: 'imported',
          rows: tableData.count,
          checksum: tableData.checksum
        });
        
        console.log(`     ✅ ${tableData.count} rows ${options.dryRun ? 'would be' : ''} imported`);
      }
      
      if (!options.dryRun) {
        await pool.query('COMMIT');
        console.log(`\n✅ Import to ${targetEnvironment} completed successfully`);
      } else {
        console.log(`\n✅ Dry run completed - would import ${results.length} tables`);
      }
      
      return results;
      
    } catch (error) {
      if (!options.dryRun) {
        await pool.query('ROLLBACK');
      }
      throw error;
    } finally {
      await pool.end();
    }
  }

  async listExports(): Promise<string[]> {
    if (!fs.existsSync(this.exportDir)) {
      return [];
    }
    
    return fs.readdirSync(this.exportDir)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort()
      .reverse(); // Most recent first
  }

  async showExportInfo(exportName: string): Promise<void> {
    const exportPath = path.join(this.exportDir, `${exportName}.json`);
    if (!fs.existsSync(exportPath)) {
      throw new Error(`Export file not found: ${exportName}.json`);
    }
    
    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    
    console.log(`📋 Export Information: ${exportName}`);
    console.log(`   🔗 Source: ${exportData.sourceEnvironment}`);
    console.log(`   📅 Created: ${new Date(exportData.exportedAt).toLocaleString()}`);
    console.log(`   📊 Tables: ${exportData.totalTables}`);
    console.log(`   📝 Total rows: ${exportData.totalRows}`);
    console.log(`\n   📋 Table Details:`);
    
    for (const [tableName, tableData] of Object.entries(exportData.tables) as [string, any][]) {
      console.log(`      ✅ ${tableName}: ${tableData.count} rows (${tableData.checksum.substring(0, 8)}...)`);
    }
  }

  async compareLookupData(env1: string, env2: string): Promise<void> {
    console.log(`🔍 Comparing lookup data: ${env1} vs ${env2}`);
    console.log(`${'='.repeat(50)}`);
    
    const pool1 = await this.createDatabaseConnection(env1);
    const pool2 = await this.createDatabaseConnection(env2);
    
    try {
      for (const tableConfig of lookupTables) {
        console.log(`\n📋 ${tableConfig.name}:`);
        
        const result1 = await pool1.query(`SELECT COUNT(*) as count FROM ${tableConfig.name}`);
        const result2 = await pool2.query(`SELECT COUNT(*) as count FROM ${tableConfig.name}`);
        
        const count1 = parseInt(result1.rows[0].count);
        const count2 = parseInt(result2.rows[0].count);
        
        if (count1 === count2) {
          console.log(`   ✅ ${count1} rows in both environments`);
        } else {
          console.log(`   ❌ ${env1}: ${count1} rows | ${env2}: ${count2} rows (diff: ${Math.abs(count1 - count2)})`);
        }
      }
      
    } finally {
      await pool1.end();
      await pool2.end();
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const dataSyncManager = new DataSyncManager();
  
  try {
    switch (command) {
      case 'export':
        {
          const sourceEnv = args[1];
          const tables = args.slice(2);
          if (!sourceEnv) {
            console.log('Usage: tsx data-sync-manager.ts export <environment> [table1] [table2] ...');
            console.log('Available environments: development, test, production');
            process.exit(1);
          }
          await dataSyncManager.exportLookupData(sourceEnv, tables.length > 0 ? tables : undefined);
        }
        break;
        
      case 'import':
        {
          const targetEnv = args[1];
          const exportName = args[2];
          const options: any = {};
          
          if (args.includes('--dry-run')) options.dryRun = true;
          if (args.includes('--clear-first')) options.clearFirst = true;
          
          if (!targetEnv || !exportName) {
            console.log('Usage: tsx data-sync-manager.ts import <environment> <export-name> [--dry-run] [--clear-first]');
            console.log('\nAvailable exports:');
            const exports = await dataSyncManager.listExports();
            exports.slice(0, 5).forEach(exp => console.log(`  ${exp}`));
            process.exit(1);
          }
          
          await dataSyncManager.importLookupData(targetEnv, exportName, options);
        }
        break;
        
      case 'list':
        {
          const exports = await dataSyncManager.listExports();
          console.log('📁 Available exports:');
          if (exports.length === 0) {
            console.log('   No exports found');
          } else {
            exports.forEach(exp => console.log(`   ${exp}`));
          }
        }
        break;
        
      case 'info':
        {
          const exportName = args[1];
          if (!exportName) {
            console.log('Usage: tsx data-sync-manager.ts info <export-name>');
            process.exit(1);
          }
          await dataSyncManager.showExportInfo(exportName);
        }
        break;
        
      case 'compare':
        {
          const env1 = args[1];
          const env2 = args[2];
          if (!env1 || !env2) {
            console.log('Usage: tsx data-sync-manager.ts compare <environment1> <environment2>');
            console.log('Available environments: development, test, production');
            process.exit(1);
          }
          await dataSyncManager.compareLookupData(env1, env2);
        }
        break;
        
      default:
        console.log('🔄 Data Sync Manager for CoreCRM Lookup Tables');
        console.log('===============================================');
        console.log('\nCommands:');
        console.log('  export <env> [tables...]     Export lookup data from environment');
        console.log('  import <env> <export-name>   Import lookup data to environment');
        console.log('    --dry-run                  Preview changes without applying');
        console.log('    --clear-first              Clear existing data before import');
        console.log('  list                         List available exports');
        console.log('  info <export-name>           Show export details');
        console.log('  compare <env1> <env2>        Compare lookup data between environments');
        console.log('\nExamples:');
        console.log('  tsx data-sync-manager.ts export development');
        console.log('  tsx data-sync-manager.ts import test development-2025-09-26 --dry-run');
        console.log('  tsx data-sync-manager.ts compare development production');
        break;
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run main function when script is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

export { DataSyncManager, lookupTables };