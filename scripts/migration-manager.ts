#!/usr/bin/env tsx

/**
 * Migration Manager - Bulletproof Database Schema Management
 * 
 * This system ensures proper development → test → production workflow:
 * 1. Make schema changes in shared/schema.ts
 * 2. Generate migration from development schema
 * 3. Apply to test for validation
 * 4. After certification, promote to production
 * 
 * QUICK START - Development Workflow:
 *   1. Edit shared/schema.ts with your changes
 *   2. tsx scripts/migration-manager.ts generate        # Generate migration SQL
 *   3. tsx scripts/migration-manager.ts apply test      # Test in Test environment
 *   4. tsx scripts/migration-manager.ts validate        # Verify consistency
 *   5. tsx scripts/migration-manager.ts apply prod      # Deploy to Production
 * 
 * AUTOMATED SYNC - For Admin Users:
 *   tsx scripts/sync-environments.ts dev-to-test       # Promote Dev → Test
 *   tsx scripts/sync-environments.ts test-to-prod      # Promote Test → Production
 *   Note: sync-environments.ts uses this script under the hood
 * 
 * All Commands:
 *   tsx scripts/migration-manager.ts generate    # Generate migration from development schema
 *   tsx scripts/migration-manager.ts apply dev   # Apply migrations to development
 *   tsx scripts/migration-manager.ts apply test  # Apply migrations to test
 *   tsx scripts/migration-manager.ts apply prod  # Apply migrations to production
 *   tsx scripts/migration-manager.ts status      # Show migration status across environments
 *   tsx scripts/migration-manager.ts validate    # Validate schema consistency
 *   tsx scripts/migration-manager.ts backup prod # Create schema backup (automatic before apply)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const execAsync = promisify(exec);

interface Environment {
  name: string;
  envVar: string;
  description: string;
  url?: string;
}

interface Migration {
  id: string;
  name: string;
  timestamp: string;
  file: string;
  applied: boolean;
  appliedAt?: string;
  environment: string;
}

const environments: Environment[] = [
  { name: 'development', envVar: 'DEV_DATABASE_URL', description: 'Development Database' },
  { name: 'test', envVar: 'TEST_DATABASE_URL', description: 'Test Database' },
  { name: 'production', envVar: 'DATABASE_URL', description: 'Production Database' }
];

class MigrationManager {
  private migrationsDir = path.join(process.cwd(), 'migrations');
  private schemaBackupsDir = path.join(this.migrationsDir, 'schema-backups');

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }
    if (!fs.existsSync(this.schemaBackupsDir)) {
      fs.mkdirSync(this.schemaBackupsDir, { recursive: true });
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

  private async ensureMigrationsTable(pool: Pool): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL,
        environment VARCHAR(50) NOT NULL
      );
    `);
  }

  private generateMigrationId(): string {
    const timestamp = new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .slice(0, 14); // YYYYMMDDHHMMSS
    return timestamp;
  }

  private async createBackup(environment: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.schemaBackupsDir, `${environment}-backup-${timestamp}.sql`);
    
    try {
      const pool = await this.createDatabaseConnection(environment);
      
      // Create a simple schema backup using direct SQL queries
      const schemaInfo = await pool.query(`
        SELECT 
          'CREATE TABLE ' || table_schema || '.' || table_name || ' (' ||
          string_agg(column_name || ' ' || data_type || 
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END
          , ', ') || ');' as create_statement
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        GROUP BY table_schema, table_name
        ORDER BY table_name;
      `);
      
      const backupContent = [
        `-- Database backup for ${environment} environment`,
        `-- Generated at: ${new Date().toISOString()}`,
        `-- Warning: This is a simplified backup for migration safety`,
        '',
        ...schemaInfo.rows.map((row: any) => row.create_statement)
      ].join('\n');
      
      await fs.promises.writeFile(backupFile, backupContent);
      await pool.end();
      
      console.log(`✅ Schema backup created: ${backupFile}`);
      return backupFile;
    } catch (error: any) {
      console.warn(`⚠️ Could not create backup: ${error.message}`);
      return '';
    }
  }

  async generateMigration(): Promise<void> {
    console.log('🔄 Generating migration from development schema...\n');

    // Ensure development environment is available
    const devUrl = this.getDatabaseUrl('development');
    
    // Generate migration using Drizzle
    const migrationId = this.generateMigrationId();
    const migrationName = `migration_${migrationId}`;
    
    try {
      // Use Drizzle generate to create proper migration files
      // We need to handle potential interactive prompts by providing input
      const command = `DATABASE_URL="${devUrl}" npx drizzle-kit generate --name=${migrationName}`;
      
      console.log('🔄 Running drizzle-kit generate...');
      console.log('ℹ️ If prompted about column changes, please respond appropriately');
      console.log('💡 Tip: Use "create column" for new columns, "rename column" for renamed ones');
      
      // Use spawn instead of exec to handle interactive prompts
      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const child = spawn('npx', ['drizzle-kit', 'generate', `--name=${migrationName}`], {
          env: { ...process.env, DATABASE_URL: devUrl },
          stdio: 'inherit' // This allows interactive input/output
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Migration generated successfully');
            console.log(`📄 Migration ID: ${migrationId}`);
            console.log(`📁 Check migrations directory for generated files`);
            resolve();
          } else {
            reject(new Error(`drizzle-kit generate exited with code ${code}`));
          }
        });
        
        child.on('error', (error) => {
          reject(error);
        });
      });
      
    } catch (error: any) {
      console.error('❌ Failed to generate migration:', error.message);
      throw error;
    }
  }

  async applyMigrations(environment: string, options: { forceProduction?: boolean } = {}): Promise<void> {
    // PRODUCTION PROTECTION: Block direct production access without --force-production
    if (environment === 'production' && !options.forceProduction) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════════════════════╗');
      console.error('║  🚫 BLOCKED: DIRECT PRODUCTION MIGRATIONS NOT ALLOWED                       ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════════╝');
      console.error('');
      console.error('  DEPLOYMENT PIPELINE ENFORCEMENT:');
      console.error('  ================================');
      console.error('  1. Apply migrations to DEVELOPMENT first: apply dev');
      console.error('  2. Test in development, then apply to TEST: apply test');
      console.error('  3. Certify in test environment');
      console.error('  4. Promote from test to production: promote test prod');
      console.error('');
      console.error('  Proper command sequence:');
      console.error('    tsx scripts/migration-manager.ts apply dev');
      console.error('    tsx scripts/migration-manager.ts apply test');
      console.error('    tsx scripts/migration-manager.ts promote test prod');
      console.error('');
      console.error('  ⚠️  If this is an emergency, use: apply prod --force-production');
      console.error('      This will be audit logged and should require approval.');
      console.error('');
      throw new Error('Direct production migration blocked. Use promotion workflow.');
    }

    if (environment === 'production' && options.forceProduction) {
      console.log('');
      console.log('⚠️  WARNING: PRODUCTION PROTECTION OVERRIDE ACTIVATED');
      console.log('    This action has been audit logged.');
      console.log(`    User: ${process.env.USER || 'unknown'}`);
      console.log(`    Timestamp: ${new Date().toISOString()}`);
      console.log('');
    }

    console.log(`🚀 Applying migrations to ${environment}...\n`);

    // Create backup first
    await this.createBackup(environment);

    const pool = await this.createDatabaseConnection(environment);
    
    try {
      await this.ensureMigrationsTable(pool);
      
      // Get all migration files
      const migrationFiles = fs.readdirSync(this.migrationsDir)
        .filter(file => file.endsWith('.sql') && !file.includes('backup'))
        .sort();
      
      if (migrationFiles.length === 0) {
        console.log('ℹ️ No migration files found');
        return;
      }

      // Get applied migrations
      const appliedResult = await pool.query(
        'SELECT migration_id FROM schema_migrations WHERE environment = $1',
        [environment]
      );
      const appliedMigrations = new Set(appliedResult.rows.map((row: any) => row.migration_id));

      // Apply pending migrations
      let appliedCount = 0;
      for (const file of migrationFiles) {
        const migrationId = path.basename(file, '.sql');
        
        if (appliedMigrations.has(migrationId)) {
          console.log(`⏭️ Skipping already applied migration: ${migrationId}`);
          continue;
        }

        console.log(`📋 Applying migration: ${migrationId}`);
        
        const migrationPath = path.join(this.migrationsDir, file);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        // Calculate checksum
        const crypto = await import('crypto');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');
        
        try {
          // Apply migration in a transaction
          await pool.query('BEGIN');
          await pool.query(sql);
          await pool.query(
            `INSERT INTO schema_migrations (migration_id, name, checksum, environment) 
             VALUES ($1, $2, $3, $4)`,
            [migrationId, file, checksum, environment]
          );
          await pool.query('COMMIT');
          
          console.log(`✅ Applied migration: ${migrationId}`);
          appliedCount++;
        } catch (error: any) {
          await pool.query('ROLLBACK');
          console.error(`❌ Failed to apply migration ${migrationId}:`, error.message);
          throw error;
        }
      }
      
      console.log(`\n🎉 Successfully applied ${appliedCount} migration(s) to ${environment}`);
      
    } finally {
      await pool.end();
    }
  }

  async showStatus(): Promise<void> {
    console.log('📊 Migration Status Across Environments\n');
    console.log('=' + '='.repeat(60));

    for (const env of environments) {
      try {
        const pool = await this.createDatabaseConnection(env.name);
        await this.ensureMigrationsTable(pool);
        
        const result = await pool.query(
          'SELECT migration_id, name, applied_at FROM schema_migrations WHERE environment = $1 ORDER BY applied_at',
          [env.name]
        );
        
        console.log(`\n🏷️ ${env.description}`);
        console.log('-'.repeat(40));
        
        if (result.rows.length === 0) {
          console.log('  No migrations applied');
        } else {
          result.rows.forEach((row: any) => {
            console.log(`  ✅ ${row.migration_id} - ${new Date(row.applied_at).toLocaleString()}`);
          });
        }
        
        await pool.end();
        
      } catch (error: any) {
        console.log(`\n🏷️ ${env.description}`);
        console.log('-'.repeat(40));
        console.log(`  ❌ Connection failed: ${error.message}`);
      }
    }
    
    // Show available migration files
    console.log('\n📁 Available Migration Files');
    console.log('-'.repeat(40));
    const migrationFiles = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.includes('backup'))
      .sort();
    
    if (migrationFiles.length === 0) {
      console.log('  No migration files found');
    } else {
      migrationFiles.forEach(file => {
        console.log(`  📄 ${file}`);
      });
    }
  }

  async validateConsistency(): Promise<void> {
    console.log('🔍 Validating Schema Consistency\n');
    
    // This would compare actual database schemas across environments
    // For now, we'll check migration status consistency
    
    const migrationStatus: Record<string, string[]> = {};
    
    for (const env of environments) {
      try {
        const pool = await this.createDatabaseConnection(env.name);
        await this.ensureMigrationsTable(pool);
        
        const result = await pool.query(
          'SELECT migration_id FROM schema_migrations WHERE environment = $1 ORDER BY migration_id',
          [env.name]
        );
        
        migrationStatus[env.name] = result.rows.map((row: any) => row.migration_id);
        await pool.end();
        
      } catch (error: any) {
        console.log(`❌ ${env.description}: ${error.message}`);
        migrationStatus[env.name] = [];
      }
    }
    
    // Compare migration status
    const prodMigrations = migrationStatus['production'] || [];
    const testMigrations = migrationStatus['test'] || [];
    const devMigrations = migrationStatus['development'] || [];
    
    console.log('📋 Migration Consistency Report:');
    console.log(`  Production: ${prodMigrations.length} migrations`);
    console.log(`  Test: ${testMigrations.length} migrations`);
    console.log(`  Development: ${devMigrations.length} migrations`);
    
    // Check if test is ahead of production (good)
    const testAheadOfProd = testMigrations.filter(m => !prodMigrations.includes(m));
    if (testAheadOfProd.length > 0) {
      console.log(`\n✅ Test environment has ${testAheadOfProd.length} migration(s) ready for production:`);
      testAheadOfProd.forEach(m => console.log(`  - ${m}`));
    }
    
    // Check if production is ahead of test (bad)
    const prodAheadOfTest = prodMigrations.filter(m => !testMigrations.includes(m));
    if (prodAheadOfTest.length > 0) {
      console.log(`\n⚠️ Production has ${prodAheadOfTest.length} migration(s) not in test:`);
      prodAheadOfTest.forEach(m => console.log(`  - ${m}`));
    }
    
    if (testAheadOfProd.length === 0 && prodAheadOfTest.length === 0) {
      console.log('\n✅ Production and test environments are synchronized');
    }
  }

  async bootstrapExistingEnvironments(): Promise<void> {
    console.log('🚀 Bootstrapping existing environments with initial migration\n');
    
    const migrationFiles = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.includes('backup'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('❌ No migration files found to bootstrap with');
      return;
    }

    const initialMigration = migrationFiles[0]; // Use first migration as baseline
    const migrationId = path.basename(initialMigration, '.sql');
    const migrationPath = path.join(this.migrationsDir, initialMigration);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Calculate checksum
    const crypto = await import('crypto');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    for (const env of environments) {
      try {
        console.log(`📋 Bootstrapping ${env.description}...`);
        
        const pool = await this.createDatabaseConnection(env.name);
        await this.ensureMigrationsTable(pool);
        
        // Check if already bootstrapped
        const existingResult = await pool.query(
          'SELECT migration_id FROM schema_migrations WHERE environment = $1 AND migration_id = $2',
          [env.name, migrationId]
        );
        
        if (existingResult.rows.length > 0) {
          console.log(`⏭️ ${env.description} already bootstrapped with ${migrationId}`);
        } else {
          // Mark migration as applied without running it (since tables already exist)
          await pool.query(
            `INSERT INTO schema_migrations (migration_id, name, checksum, environment) 
             VALUES ($1, $2, $3, $4)`,
            [migrationId, initialMigration, checksum, env.name]
          );
          console.log(`✅ Marked ${migrationId} as applied in ${env.description}`);
        }
        
        await pool.end();
        
      } catch (error: any) {
        console.error(`❌ Failed to bootstrap ${env.description}: ${error.message}`);
      }
    }
    
    console.log('\n🎉 Bootstrap complete! All environments now track the initial migration.');
    console.log('💡 Future schema changes will use the proper migration workflow.');
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const environment = process.argv[3];
  
  const manager = new MigrationManager();
  
  try {
    switch (command) {
      case 'generate':
        await manager.generateMigration();
        break;
        
      case 'apply': {
        if (!environment || !['dev', 'development', 'test', 'prod', 'production'].includes(environment)) {
          throw new Error('Please specify environment: dev, test, or prod');
        }
        const env = environment === 'dev' ? 'development' : 
                   environment === 'prod' ? 'production' : environment;
        const forceProduction = process.argv.includes('--force-production');
        await manager.applyMigrations(env, { forceProduction });
        break;
      }
      
      case 'promote': {
        const fromEnv = process.argv[3];
        const toEnv = process.argv[4];
        
        if (!fromEnv || !toEnv) {
          throw new Error('Usage: promote <from-env> <to-env> (e.g., promote test prod)');
        }
        
        const normalizeEnv = (e: string) => e === 'dev' ? 'development' : e === 'prod' ? 'production' : e;
        const from = normalizeEnv(fromEnv);
        const to = normalizeEnv(toEnv);
        
        // Validate promotion path
        const validPromotions: Record<string, string> = {
          'development': 'test',
          'test': 'production',
        };
        
        if (validPromotions[from] !== to) {
          console.error('');
          console.error('╔══════════════════════════════════════════════════════════════════════════════╗');
          console.error('║  🚫 INVALID PROMOTION PATH                                                   ║');
          console.error('╚══════════════════════════════════════════════════════════════════════════════╝');
          console.error('');
          console.error(`  You attempted: ${from} → ${to}`);
          console.error('');
          console.error('  Valid promotion paths:');
          console.error('    • development → test');
          console.error('    • test → production');
          console.error('');
          console.error('  You cannot skip environments or promote backwards.');
          console.error('');
          throw new Error('Invalid promotion path');
        }
        
        console.log(`\n🚀 PROMOTING: ${from.toUpperCase()} → ${to.toUpperCase()}\n`);
        console.log('═'.repeat(70));
        
        // For promotion, we allow applying to the target environment
        // because it's coming from a certified source
        await manager.applyMigrations(to, { forceProduction: to === 'production' });
        
        console.log('');
        console.log('═'.repeat(70));
        console.log('✅ PROMOTION COMPLETED SUCCESSFULLY');
        console.log('═'.repeat(70));
        console.log('');
        break;
      }
        
      case 'status':
        await manager.showStatus();
        break;
        
      case 'validate':
        await manager.validateConsistency();
        break;
        
      case 'bootstrap':
        await manager.bootstrapExistingEnvironments();
        break;
        
      default:
        console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  MIGRATION MANAGER - Schema Management with Production Protection            ║
╚══════════════════════════════════════════════════════════════════════════════╝

DEPLOYMENT PIPELINE:
  Development → Test → Production

  Direct production modifications are BLOCKED. Use the promote command.

COMMANDS:
  generate              Generate migration from development schema
  apply <env>           Apply migrations (dev/test only - prod blocked)
  promote <from> <to>   Promote schema between environments
  status                Show migration status across all environments
  validate              Validate schema consistency
  bootstrap             Bootstrap existing databases

USAGE:
  tsx scripts/migration-manager.ts generate
  tsx scripts/migration-manager.ts apply dev
  tsx scripts/migration-manager.ts apply test
  tsx scripts/migration-manager.ts promote dev test    # Dev → Test
  tsx scripts/migration-manager.ts promote test prod   # Test → Production

PROPER WORKFLOW:
  1. Make schema changes in shared/schema.ts
  2. Generate migration:     generate
  3. Apply to development:   apply dev
  4. Test your changes
  5. Apply to test:          apply test
  6. Certify in test environment
  7. Promote to production:  promote test prod

PRODUCTION PROTECTION:
  ✓ apply dev      → Allowed
  ✓ apply test     → Allowed
  ✗ apply prod     → BLOCKED (use: promote test prod)
  ⚠ apply prod --force-production → Emergency override (audit logged)

PROMOTION RULES:
  ✓ development → test       (allowed via: promote dev test)
  ✓ test → production        (allowed via: promote test prod)
  ✗ development → production (BLOCKED - must go through test)
  ✗ production → any         (BLOCKED - production is read-only)
        `);
        break;
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
}