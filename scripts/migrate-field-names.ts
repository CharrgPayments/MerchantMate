/**
 * Migration Script: Convert legacy field names to new period-delimited format
 * 
 * This script updates existing application templates to use the new naming convention:
 * - Old: owners_owner1_signature_owner.signerName
 * - New: owners.1.signature.signerName
 * 
 * Usage:
 *   CORECRM_ENV=development tsx scripts/migrate-field-names.ts [--dry-run] [--template-id <id>]
 * 
 * Options:
 *   --dry-run         Preview changes without applying them
 *   --template-id <id> Migrate only a specific template
 *   --rollback        Convert back to legacy format (for testing)
 */

import { Pool } from 'pg';
import { convertLegacyFieldName, convertToLegacyFieldName, FIELD_DELIMITER } from '../shared/fieldNaming';

const env = process.env.CORECRM_ENV || 'development';

// Get the appropriate database URL
function getDatabaseUrl(): string {
  const envVarName = `DATABASE_URL_${env.toUpperCase()}`;
  const url = process.env[envVarName] || process.env.DATABASE_URL;
  
  if (!url) {
    throw new Error(`No database URL found for environment: ${env}. Set ${envVarName} or DATABASE_URL.`);
  }
  
  return url;
}

interface FieldRecord {
  id: number;
  fieldName: string;
  templateId: number;
}

interface MigrationResult {
  templateId: number;
  templateName: string;
  fieldsProcessed: number;
  fieldsUpdated: number;
  changes: Array<{
    fieldId: number;
    oldName: string;
    newName: string;
  }>;
}

async function migrateFieldNames(options: {
  dryRun: boolean;
  templateId?: number;
  rollback: boolean;
}): Promise<MigrationResult[]> {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  const results: MigrationResult[] = [];
  
  try {
    console.log(`\n🔄 Field Name Migration - Environment: ${env}`);
    console.log(`   Mode: ${options.dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
    console.log(`   Direction: ${options.rollback ? 'Rollback to legacy format' : 'Convert to new format'}`);
    
    // Get templates to process
    let templateQuery = 'SELECT id, name FROM application_templates';
    const templateParams: any[] = [];
    
    if (options.templateId) {
      templateQuery += ' WHERE id = $1';
      templateParams.push(options.templateId);
    }
    
    const templatesResult = await pool.query(templateQuery, templateParams);
    const templates = templatesResult.rows;
    
    console.log(`\n📋 Found ${templates.length} template(s) to process\n`);
    
    for (const template of templates) {
      const result: MigrationResult = {
        templateId: template.id,
        templateName: template.name,
        fieldsProcessed: 0,
        fieldsUpdated: 0,
        changes: []
      };
      
      // Get all fields for this template
      const fieldsResult = await pool.query(
        'SELECT id, "fieldName" FROM pdf_form_fields WHERE "templateId" = $1',
        [template.id]
      );
      
      const fields: FieldRecord[] = fieldsResult.rows.map(row => ({
        id: row.id,
        fieldName: row.fieldName,
        templateId: template.id
      }));
      
      result.fieldsProcessed = fields.length;
      
      for (const field of fields) {
        const convertFn = options.rollback ? convertToLegacyFieldName : convertLegacyFieldName;
        const newName = convertFn(field.fieldName);
        
        // Only count as update if the name actually changed
        if (newName !== field.fieldName) {
          result.changes.push({
            fieldId: field.id,
            oldName: field.fieldName,
            newName: newName
          });
          
          if (!options.dryRun) {
            await pool.query(
              'UPDATE pdf_form_fields SET "fieldName" = $1 WHERE id = $2',
              [newName, field.id]
            );
          }
          
          result.fieldsUpdated++;
        }
      }
      
      results.push(result);
      
      // Print template summary
      console.log(`📝 Template: ${template.name} (ID: ${template.id})`);
      console.log(`   Fields: ${result.fieldsProcessed} total, ${result.fieldsUpdated} updated`);
      
      if (result.changes.length > 0) {
        console.log('   Changes:');
        for (const change of result.changes.slice(0, 10)) {
          console.log(`     ${change.oldName}`);
          console.log(`     → ${change.newName}`);
        }
        if (result.changes.length > 10) {
          console.log(`     ... and ${result.changes.length - 10} more changes`);
        }
      }
      console.log('');
    }
    
    // Print summary
    const totalFields = results.reduce((sum, r) => sum + r.fieldsProcessed, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.fieldsUpdated, 0);
    
    console.log('═'.repeat(60));
    console.log(`✅ Migration Complete`);
    console.log(`   Templates processed: ${results.length}`);
    console.log(`   Fields processed: ${totalFields}`);
    console.log(`   Fields updated: ${totalUpdated}`);
    
    if (options.dryRun) {
      console.log(`\n⚠️  DRY RUN - No changes were made to the database`);
      console.log(`   Run without --dry-run to apply changes`);
    }
    
    return results;
    
  } finally {
    await pool.end();
  }
}

// Also migrate saved application data
async function migrateApplicationData(options: {
  dryRun: boolean;
  templateId?: number;
  rollback: boolean;
}): Promise<void> {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  
  try {
    console.log(`\n🔄 Migrating saved application data...`);
    
    // Get applications to process
    let query = 'SELECT id, "formData" FROM prospect_applications';
    const params: any[] = [];
    
    if (options.templateId) {
      query += ' WHERE "templateId" = $1';
      params.push(options.templateId);
    }
    
    const applicationsResult = await pool.query(query, params);
    let updatedCount = 0;
    
    for (const app of applicationsResult.rows) {
      if (!app.formData || typeof app.formData !== 'object') continue;
      
      const oldData = app.formData as Record<string, any>;
      const newData: Record<string, any> = {};
      let hasChanges = false;
      
      for (const [key, value] of Object.entries(oldData)) {
        const convertFn = options.rollback ? convertToLegacyFieldName : convertLegacyFieldName;
        const newKey = convertFn(key);
        
        if (newKey !== key) {
          hasChanges = true;
        }
        
        newData[newKey] = value;
      }
      
      if (hasChanges) {
        if (!options.dryRun) {
          await pool.query(
            'UPDATE prospect_applications SET "formData" = $1 WHERE id = $2',
            [JSON.stringify(newData), app.id]
          );
        }
        updatedCount++;
      }
    }
    
    console.log(`   Applications updated: ${updatedCount}`);
    
  } finally {
    await pool.end();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rollback = args.includes('--rollback');
  
  let templateId: number | undefined;
  const templateIdIndex = args.indexOf('--template-id');
  if (templateIdIndex !== -1 && args[templateIdIndex + 1]) {
    templateId = parseInt(args[templateIdIndex + 1]);
    if (isNaN(templateId)) {
      console.error('Error: --template-id must be a number');
      process.exit(1);
    }
  }
  
  try {
    await migrateFieldNames({ dryRun, templateId, rollback });
    await migrateApplicationData({ dryRun, templateId, rollback });
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
