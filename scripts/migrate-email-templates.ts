import { db } from '../server/db';
import { emailTemplates, actionTemplates } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Migration Script: Email Templates → Action Templates
 * 
 * Migrates existing emailTemplates records to actionTemplates with type 'email'
 * Preserves all configuration including wrapper settings and variables
 */

interface EmailTemplate {
  id: number;
  name: string;
  description: string | null;
  subject: string;
  htmlContent: string;
  textContent: string | null;
  variables: any;
  category: string;
  isActive: boolean;
  useWrapper: boolean;
  wrapperType: string | null;
  headerGradient: string | null;
  headerSubtitle: string | null;
  ctaButtonText: string | null;
  ctaButtonUrl: string | null;
  ctaButtonColor: string | null;
  customFooter: string | null;
}

async function migrateEmailTemplates() {
  console.log('🔄 Starting Email Templates Migration...\n');
  
  try {
    // 1. Fetch all email templates
    const oldTemplates = await db.select().from(emailTemplates) as EmailTemplate[];
    console.log(`📧 Found ${oldTemplates.length} email templates to migrate\n`);
    
    if (oldTemplates.length === 0) {
      console.log('✅ No templates to migrate. Migration complete!');
      return;
    }
    
    // 2. Check for existing action templates with same names
    const existingActionTemplates = await db.select().from(actionTemplates);
    const existingNames = new Set(existingActionTemplates.map(t => t.name));
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    // 3. Migrate each template
    for (const template of oldTemplates) {
      // Skip if already exists in action_templates
      if (existingNames.has(template.name)) {
        console.log(`⏭️  Skipping "${template.name}" - already exists in action_templates`);
        skippedCount++;
        continue;
      }
      
      // Transform to action template format
      const config: any = {
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent || undefined,
        // Preserve wrapper configuration
        useWrapper: template.useWrapper,
        wrapperType: template.wrapperType || 'notification',
      };
      
      // Include wrapper customization if present
      if (template.headerGradient) config.headerGradient = template.headerGradient;
      if (template.headerSubtitle) config.headerSubtitle = template.headerSubtitle;
      if (template.ctaButtonText) config.ctaButtonText = template.ctaButtonText;
      if (template.ctaButtonUrl) config.ctaButtonUrl = template.ctaButtonUrl;
      if (template.ctaButtonColor) config.ctaButtonColor = template.ctaButtonColor;
      if (template.customFooter) config.customFooter = template.customFooter;
      
      // Create action template
      const [newActionTemplate] = await db.insert(actionTemplates).values({
        name: template.name,
        description: template.description || `Migrated from email template (ID: ${template.id})`,
        actionType: 'email',
        category: template.category,
        config: config,
        variables: template.variables || {},
        isActive: template.isActive,
        version: 1,
      }).returning();
      
      console.log(`✅ Migrated: "${template.name}" → action_templates.id=${newActionTemplate.id}`);
      migratedCount++;
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migratedCount} templates`);
    console.log(`   ⏭️  Skipped: ${skippedCount} templates (already exist)`);
    console.log(`   📧 Total: ${oldTemplates.length} templates processed\n`);
    
    if (migratedCount > 0) {
      console.log('⚠️  Next Steps:');
      console.log('   1. Verify migrated templates in /action-templates page');
      console.log('   2. Update Email Management UI to use action templates directly');
      console.log('   3. Once verified, old email_templates table can be deprecated\n');
    }
    
    console.log('✅ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateEmailTemplates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
