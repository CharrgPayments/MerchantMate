#!/usr/bin/env tsx
/**
 * Migration Script: Email System to Generic Trigger/Action Catalog
 * 
 * This script migrates existing email templates and triggers to the new
 * generic trigger/action catalog system.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../shared/schema';
import { eq } from 'drizzle-orm';
import ws from 'ws';

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

const DEV_DB_URL = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!DEV_DB_URL) {
  console.error('❌ DEV_DATABASE_URL or DATABASE_URL environment variable not found');
  process.exit(1);
}

const devPool = new Pool({ connectionString: DEV_DB_URL });
const devDb = drizzle({ client: devPool, schema });

async function migrateEmailToCatalog() {
  console.log('🔄 Migrating Email System to Trigger/Action Catalog...\n');

  try {
    // 1. Migrate Email Templates to Action Templates
    console.log('📧 Migrating email templates to action templates...');
    
    const emailTemplates = await devDb.select().from(schema.emailTemplates);
    console.log(`Found ${emailTemplates.length} email templates`);

    for (const emailTemplate of emailTemplates) {
      // Check if already migrated
      const [existing] = await devDb
        .select()
        .from(schema.actionTemplates)
        .where(eq(schema.actionTemplates.name, `[Migrated] ${emailTemplate.name}`))
        .limit(1);

      if (existing) {
        console.log(`  ⏭️  Skipping ${emailTemplate.name} (already migrated)`);
        continue;
      }

      // Parse variables
      let variables = [];
      try {
        variables = typeof emailTemplate.variables === 'string' 
          ? JSON.parse(emailTemplate.variables as string)
          : emailTemplate.variables || [];
      } catch (e) {
        console.warn(`  ⚠️  Failed to parse variables for ${emailTemplate.name}`);
      }

      // Create action template
      await devDb.insert(schema.actionTemplates).values({
        name: `[Migrated] ${emailTemplate.name}`,
        description: emailTemplate.description || `Migrated from email template: ${emailTemplate.name}`,
        actionType: 'email',
        category: emailTemplate.category || 'general',
        config: {
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
          textContent: emailTemplate.textContent || undefined,
        },
        variables: variables,
        isActive: emailTemplate.isActive,
        version: 1,
      });

      console.log(`  ✅ Migrated: ${emailTemplate.name}`);
    }

    // 2. Migrate Email Triggers to Trigger Catalog
    console.log('\n🎯 Migrating email triggers to trigger catalog...');
    
    const emailTriggers = await devDb.select().from(schema.emailTriggers);
    console.log(`Found ${emailTriggers.length} email triggers`);

    for (const emailTrigger of emailTriggers) {
      // Check if trigger already exists in catalog
      const [existingTrigger] = await devDb
        .select()
        .from(schema.triggerCatalog)
        .where(eq(schema.triggerCatalog.triggerKey, emailTrigger.triggerEvent))
        .limit(1);
      
      let trigger = existingTrigger;

      // Create trigger if doesn't exist
      if (!trigger) {
        const [newTrigger] = await devDb.insert(schema.triggerCatalog).values({
          triggerKey: emailTrigger.triggerEvent,
          name: emailTrigger.name,
          description: emailTrigger.description || `Trigger event: ${emailTrigger.triggerEvent}`,
          category: determineTriggerCategory(emailTrigger.triggerEvent),
          contextSchema: null,
          isActive: emailTrigger.isActive,
        }).returning();
        
        trigger = newTrigger;
        console.log(`  ✅ Created trigger: ${trigger.name} (${trigger.triggerKey})`);
      } else {
        console.log(`  ⏭️  Trigger exists: ${trigger.name} (${trigger.triggerKey})`);
      }

      // Find the migrated action template
      const [emailTemplate] = emailTrigger.templateId
        ? await devDb
            .select()
            .from(schema.emailTemplates)
            .where(eq(schema.emailTemplates.id, emailTrigger.templateId))
            .limit(1)
        : [null];

      if (!emailTemplate) {
        console.log(`  ⚠️  No template found for trigger: ${emailTrigger.name}`);
        continue;
      }

      const [actionTemplate] = await devDb
        .select()
        .from(schema.actionTemplates)
        .where(eq(schema.actionTemplates.name, `[Migrated] ${emailTemplate.name}`))
        .limit(1);

      if (!actionTemplate) {
        console.log(`  ⚠️  No action template found for: ${emailTemplate.name}`);
        continue;
      }

      // Check if trigger-action relationship already exists
      const [existingTriggerAction] = await devDb
        .select()
        .from(schema.triggerActions)
        .where(eq(schema.triggerActions.triggerId, trigger.id))
        .limit(1);

      if (existingTriggerAction) {
        console.log(`  ⏭️  Trigger-action already linked: ${emailTrigger.name}`);
        continue;
      }

      // Create trigger-action relationship
      await devDb.insert(schema.triggerActions).values({
        triggerId: trigger.id,
        actionTemplateId: actionTemplate.id,
        sequenceOrder: 1,
        conditions: emailTrigger.conditions,
        requiresEmailPreference: true, // Email actions require email preference
        requiresSmsPreference: false,
        delaySeconds: 0,
        retryOnFailure: true,
        maxRetries: 3,
        isActive: emailTrigger.isActive,
      });

      console.log(`  ✅ Linked trigger to action: ${emailTrigger.name}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Email Templates migrated: ${emailTemplates.length}`);
    console.log(`  - Email Triggers migrated: ${emailTriggers.length}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await devPool.end();
  }
}

function determineTriggerCategory(triggerEvent: string): string {
  if (triggerEvent.includes('user') || triggerEvent.includes('password')) {
    return 'user';
  } else if (triggerEvent.includes('application')) {
    return 'application';
  } else if (triggerEvent.includes('merchant')) {
    return 'merchant';
  } else if (triggerEvent.includes('agent')) {
    return 'agent';
  } else {
    return 'system';
  }
}

// Run migration
migrateEmailToCatalog()
  .then(() => {
    console.log('\n🎉 Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
