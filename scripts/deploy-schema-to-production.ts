#!/usr/bin/env tsx

/**
 * Schema Deployment Tool
 * 
 * Safely deploys schema changes between any two environments by:
 * 1. Comparing source and target schemas
 * 2. Generating ALTER TABLE statements for differences
 * 3. Optionally applying changes with safety checks
 * 
 * Usage:
 *   tsx scripts/deploy-schema-to-production.ts compare <source> <target>
 *   tsx scripts/deploy-schema-to-production.ts generate <source> <target>
 *   tsx scripts/deploy-schema-to-production.ts apply <target>
 * 
 * Environments: development, test, production
 * 
 * Examples:
 *   tsx scripts/deploy-schema-to-production.ts compare test production
 *   tsx scripts/deploy-schema-to-production.ts compare development test
 *   tsx scripts/deploy-schema-to-production.ts generate test production
 *   tsx scripts/deploy-schema-to-production.ts apply production
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

neonConfig.webSocketConstructor = ws;

type Environment = 'development' | 'test' | 'production';

interface ColumnDifference {
  table: string;
  column: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
}

class SchemaDeployer {
  private deploymentsDir = path.join(process.cwd(), 'deployments');

  constructor() {
    if (!fs.existsSync(this.deploymentsDir)) {
      fs.mkdirSync(this.deploymentsDir, { recursive: true });
    }
  }

  private getConnectionString(environment: Environment): string {
    const envMap = {
      development: process.env.DEV_DATABASE_URL,
      test: process.env.TEST_DATABASE_URL,
      production: process.env.DATABASE_URL
    };

    const url = envMap[environment];
    if (!url) {
      throw new Error(`${environment.toUpperCase()} database URL not configured`);
    }

    return url;
  }

  private async getSchemaColumns(environment: Environment) {
    const url = this.getConnectionString(environment);
    const pool = new Pool({ connectionString: url });

    try {
      const result = await pool.query(`
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        ORDER BY table_name, ordinal_position
      `);

      return result.rows;
    } finally {
      await pool.end();
    }
  }

  private findMissingColumns(sourceCols: any[], targetCols: any[]): ColumnDifference[] {
    const missing: ColumnDifference[] = [];

    for (const sourceCol of sourceCols) {
      const targetCol = targetCols.find(p => 
        p.table_name === sourceCol.table_name && 
        p.column_name === sourceCol.column_name
      );

      if (!targetCol) {
        missing.push({
          table: sourceCol.table_name,
          column: sourceCol.column_name,
          dataType: sourceCol.data_type,
          isNullable: sourceCol.is_nullable,
          columnDefault: sourceCol.column_default
        });
      }
    }

    return missing;
  }

  private generateAlterTableSQL(differences: ColumnDifference[]): string {
    const sqlByTable = new Map<string, string[]>();

    for (const diff of differences) {
      if (!sqlByTable.has(diff.table)) {
        sqlByTable.set(diff.table, []);
      }

      let columnDef = `ADD COLUMN IF NOT EXISTS ${diff.column} ${diff.dataType}`;
      
      if (diff.isNullable === 'NO') {
        columnDef += ' NOT NULL';
      }
      
      if (diff.columnDefault) {
        columnDef += ` DEFAULT ${diff.columnDefault}`;
      }

      sqlByTable.get(diff.table)!.push(columnDef);
    }

    const sqlStatements: string[] = [];

    for (const [table, columns] of sqlByTable) {
      sqlStatements.push(
        `-- Add missing columns to ${table}\nALTER TABLE ${table}\n  ${columns.join(',\n  ')};`
      );
    }

    return sqlStatements.join('\n\n');
  }

  async compareSchemas(source: Environment, target: Environment): Promise<void> {
    console.log(`🔍 Comparing ${source.toUpperCase()} → ${target.toUpperCase()} Schemas\n`);
    console.log('=' .repeat(60));

    const sourceCols = await this.getSchemaColumns(source);
    const targetCols = await this.getSchemaColumns(target);

    const missingInTarget = this.findMissingColumns(sourceCols, targetCols);
    const extraInTarget = this.findMissingColumns(targetCols, sourceCols);

    console.log(`\n${source} columns: ${sourceCols.length}`);
    console.log(`${target} columns: ${targetCols.length}`);
    console.log(`Missing in ${target}: ${missingInTarget.length}`);
    console.log(`Extra in ${target}: ${extraInTarget.length}\n`);

    if (missingInTarget.length > 0) {
      console.log(`❌ Columns in ${source.toUpperCase()} but NOT in ${target.toUpperCase()}:`);
      const byTable = new Map<string, number>();
      for (const diff of missingInTarget) {
        byTable.set(diff.table, (byTable.get(diff.table) || 0) + 1);
      }
      for (const [table, count] of byTable) {
        console.log(`  - ${table}: ${count} missing columns`);
      }
    }

    if (extraInTarget.length > 0) {
      console.log(`\n⚠️  Columns in ${target.toUpperCase()} but NOT in ${source.toUpperCase()}:`);
      const byTable = new Map<string, number>();
      for (const diff of extraInTarget) {
        byTable.set(diff.table, (byTable.get(diff.table) || 0) + 1);
      }
      for (const [table, count] of byTable) {
        console.log(`  - ${table}: ${count} extra columns`);
      }
    }

    if (missingInTarget.length === 0 && extraInTarget.length === 0) {
      console.log(`✅ ${source.toUpperCase()} and ${target.toUpperCase()} schemas are synchronized!`);
    } else {
      console.log(`\n💡 Run "generate ${source} ${target}" to create deployment SQL`);
    }
  }

  async generateDeploymentSQL(source: Environment, target: Environment): Promise<string> {
    console.log(`📝 Generating Deployment SQL: ${source.toUpperCase()} → ${target.toUpperCase()}\n`);

    const sourceCols = await this.getSchemaColumns(source);
    const targetCols = await this.getSchemaColumns(target);

    const missingInTarget = this.findMissingColumns(sourceCols, targetCols);

    if (missingInTarget.length === 0) {
      console.log(`✅ No schema differences found. ${target.toUpperCase()} is up to date!`);
      return '';
    }

    const sql = this.generateAlterTableSQL(missingInTarget);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `deploy-${source}-to-${target}-${timestamp}.sql`;
    const filepath = path.join(this.deploymentsDir, filename);

    const header = `-- Schema Deployment SQL
-- Generated: ${new Date().toISOString()}
-- Source: ${source.toUpperCase()} Database
-- Target: ${target.toUpperCase()} Database
-- Total Changes: ${missingInTarget.length} columns across ${new Set(missingInTarget.map(d => d.table)).size} tables
--
-- REVIEW THIS FILE CAREFULLY BEFORE APPLYING
-- ============================================================

`;

    fs.writeFileSync(filepath, header + sql);

    console.log(`✅ Deployment SQL generated: ${filename}`);
    console.log(`   Location: ${filepath}`);
    console.log(`   Changes: ${missingInTarget.length} columns`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review the SQL file: cat ${filepath}`);
    console.log(`  2. Apply to ${target}: tsx scripts/deploy-schema-to-production.ts apply ${target}`);

    return filepath;
  }

  async applyToEnvironment(target: Environment): Promise<void> {
    console.log(`🚀 Deploying Schema Changes to ${target.toUpperCase()}\n`);

    // Find most recent deployment file for this target
    const files = fs.readdirSync(this.deploymentsDir)
      .filter(f => f.includes(`-to-${target}-`) && f.endsWith('.sql'))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log(`❌ No deployment SQL file found for ${target}. Run "generate" command first.`);
      return;
    }

    const deploymentFile = files[0];
    const filepath = path.join(this.deploymentsDir, deploymentFile);
    const sql = fs.readFileSync(filepath, 'utf8');

    // Show preview
    console.log('📋 Deployment Preview:');
    console.log('=' .repeat(60));
    console.log(sql.split('\n').slice(0, 20).join('\n'));
    if (sql.split('\n').length > 20) {
      console.log('... (truncated)');
    }
    console.log('=' .repeat(60));

    // Extract just the SQL (remove comments)
    const cleanSQL = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');

    console.log(`\n⚠️  ${target.toUpperCase()} DEPLOYMENT`);
    console.log(`This will modify the ${target.toUpperCase()} database.`);
    console.log(`File: ${deploymentFile}\n`);

    // Execute using the safe wrapper via file (avoids command-line escaping issues)
    try {
      const forceFlag = target === 'production' ? ' --force-production' : '';
      
      // Write clean SQL to a temporary file to avoid command-line escaping issues
      const tempSqlFile = path.join(this.deploymentsDir, `temp-deploy-${target}.sql`);
      fs.writeFileSync(tempSqlFile, cleanSQL);
      
      const command = `tsx scripts/execute-sql.ts --env ${target}${forceFlag} --file "${tempSqlFile}"`;
      
      console.log('🔄 Executing via safe wrapper...\n');
      execSync(command, { stdio: 'inherit' });
      
      // Clean up temp file
      fs.unlinkSync(tempSqlFile);
      
      console.log(`\n✅ ${target.toUpperCase()} deployment completed successfully!`);
      
    } catch (error) {
      console.error('\n❌ Deployment failed:', error);
      throw error;
    }
  }
}

async function main() {
  const command = process.argv[2];
  const source = process.argv[3] as Environment;
  const target = process.argv[4] as Environment;
  
  const deployer = new SchemaDeployer();

  const validEnvs = ['development', 'test', 'production'];

  try {
    switch (command) {
      case 'compare':
        if (!source || !target) {
          console.log('❌ Usage: compare <source> <target>');
          console.log('   Example: compare test production');
          process.exit(1);
        }
        if (!validEnvs.includes(source) || !validEnvs.includes(target)) {
          console.log('❌ Invalid environment. Use: development, test, or production');
          process.exit(1);
        }
        await deployer.compareSchemas(source, target);
        break;

      case 'generate':
        if (!source || !target) {
          console.log('❌ Usage: generate <source> <target>');
          console.log('   Example: generate test production');
          process.exit(1);
        }
        if (!validEnvs.includes(source) || !validEnvs.includes(target)) {
          console.log('❌ Invalid environment. Use: development, test, or production');
          process.exit(1);
        }
        await deployer.generateDeploymentSQL(source, target);
        break;

      case 'apply':
        const targetEnv = source as Environment; // source is actually the target when only one arg
        if (!targetEnv) {
          console.log('❌ Usage: apply <target>');
          console.log('   Example: apply production');
          process.exit(1);
        }
        if (!validEnvs.includes(targetEnv)) {
          console.log('❌ Invalid environment. Use: development, test, or production');
          process.exit(1);
        }
        await deployer.applyToEnvironment(targetEnv);
        break;

      default:
        console.log('Schema Deployment Tool');
        console.log('=' .repeat(60));
        console.log('\nCommands:');
        console.log('  compare <source> <target>  - Compare two database schemas');
        console.log('  generate <source> <target> - Generate deployment SQL file');
        console.log('  apply <target>             - Apply most recent SQL to target');
        console.log('\nEnvironments: development, test, production');
        console.log('\nCommon Workflows:');
        console.log('\n  Development → Test:');
        console.log('    tsx scripts/deploy-schema-to-production.ts compare development test');
        console.log('    tsx scripts/deploy-schema-to-production.ts generate development test');
        console.log('    tsx scripts/deploy-schema-to-production.ts apply test');
        console.log('\n  Test → Production:');
        console.log('    tsx scripts/deploy-schema-to-production.ts compare test production');
        console.log('    tsx scripts/deploy-schema-to-production.ts generate test production');
        console.log('    tsx scripts/deploy-schema-to-production.ts apply production');
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { SchemaDeployer };
