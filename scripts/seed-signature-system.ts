#!/usr/bin/env tsx
/**
 * Signature System Seeding Script
 * Seeds trigger catalog entries, action templates, and trigger actions for signature workflows
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../shared/schema';
import ws from 'ws';
import { eq } from 'drizzle-orm';

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

const DEV_DB_URL = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!DEV_DB_URL) {
  console.error('❌ DEV_DATABASE_URL or DATABASE_URL environment variable not found');
  process.exit(1);
}

const devPool = new Pool({ connectionString: DEV_DB_URL });
const devDb = drizzle({ client: devPool, schema });

// Trigger catalog entries for signature events
const signatureTriggers = [
  {
    triggerKey: 'signature_requested',
    name: 'Signature Requested',
    description: 'Triggered when a signature is requested from an owner/guarantor',
    category: 'application',
    contextSchema: {
      type: 'object',
      properties: {
        ownerName: { type: 'string' },
        ownerEmail: { type: 'string' },
        companyName: { type: 'string' },
        ownershipPercentage: { type: 'string' },
        signatureToken: { type: 'string' },
        requesterName: { type: 'string' },
        agentName: { type: 'string' }
      },
      required: ['ownerEmail', 'signatureToken']
    },
    isActive: true
  },
  {
    triggerKey: 'signature_captured',
    name: 'Signature Captured',
    description: 'Triggered when a signature is successfully captured',
    category: 'application',
    contextSchema: {
      type: 'object',
      properties: {
        ownerName: { type: 'string' },
        ownerEmail: { type: 'string' },
        companyName: { type: 'string' },
        roleKey: { type: 'string' },
        signatureType: { type: 'string' },
        agentName: { type: 'string' }
      },
      required: ['ownerEmail', 'roleKey']
    },
    isActive: true
  },
  {
    triggerKey: 'signature_expired',
    name: 'Signature Expired',
    description: 'Triggered when a signature request expires (7 days)',
    category: 'application',
    contextSchema: {
      type: 'object',
      properties: {
        ownerName: { type: 'string' },
        ownerEmail: { type: 'string' },
        companyName: { type: 'string' },
        roleKey: { type: 'string' },
        originalRequestDate: { type: 'string' },
        agentName: { type: 'string' }
      },
      required: ['ownerEmail', 'roleKey']
    },
    isActive: true
  }
];

// Action templates for signature emails
const signatureActionTemplates = [
  {
    name: 'Signature Request Email',
    description: 'Email sent to request signature from owner/guarantor',
    actionType: 'email',
    category: 'application',
    config: {
      subject: 'Signature Required - {{companyName}}',
      htmlContent: `
        <h2>Signature Required</h2>
        <p>Dear {{ownerName}},</p>
        <p>Your digital signature is required for the <strong>{{companyName}}</strong> merchant application.</p>
        
        <div style="background-color: #e0f2fe; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
          <p style="margin: 0;"><strong>Application Details:</strong></p>
          <ul style="margin: 10px 0; padding-left: 20px;">
            <li>Company: {{companyName}}</li>
            <li>Ownership: {{ownershipPercentage}}</li>
            <li>Requested by: {{requesterName}}</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{signatureUrl}}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Provide Signature
          </a>
        </div>
        
        <p><strong>Important:</strong> This signature request was initiated by {{requesterName}}. If you have questions, contact your agent {{agentName}}.</p>
        
        <p><strong>Security Note:</strong> This link is personalized and secure. It will expire in 7 days for your protection.</p>
      `,
      textContent: `
Signature Required

Dear {{ownerName}},

Your digital signature is required for the {{companyName}} merchant application.

Application Details:
- Company: {{companyName}}
- Ownership: {{ownershipPercentage}}
- Requested by: {{requesterName}}

Click here to sign: {{signatureUrl}}

Important: This signature request was initiated by {{requesterName}}. If you have questions, contact your agent {{agentName}}.

Security Note: This link is personalized and secure. It will expire in 7 days for your protection.
      `,
      useWrapper: true,
      wrapperType: 'default',
      headerGradient: 'blue'
    },
    variables: {
      ownerName: 'Signer name',
      ownerEmail: 'Signer email',
      companyName: 'Company name',
      ownershipPercentage: 'Ownership percentage',
      signatureUrl: 'URL to signature capture page',
      signatureToken: 'Secure signature token',
      requesterName: 'Name of person requesting signature',
      agentName: 'Agent handling application'
    },
    isActive: true,
    version: 1
  },
  {
    name: 'Signature Captured Confirmation',
    description: 'Email sent to owner confirming their signature was captured',
    actionType: 'email',
    category: 'application',
    config: {
      subject: 'Signature Received - {{companyName}}',
      htmlContent: `
        <h2>Signature Received</h2>
        <p>Dear {{ownerName}},</p>
        <p>Thank you for providing your digital signature for <strong>{{companyName}}</strong>.</p>
        
        <div style="background-color: #f0f9ff; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
          <p style="margin: 0;"><strong>Signature Details:</strong></p>
          <ul style="margin: 10px 0; padding-left: 20px;">
            <li>Role: {{roleKey}}</li>
            <li>Signature Type: {{signatureType}}</li>
            <li>Date Signed: {{dateSigned}}</li>
          </ul>
        </div>
        
        <p>Your application is now being processed by your agent {{agentName}}. You will receive updates as your application progresses.</p>
        
        <p>If you did not authorize this signature, please contact us immediately.</p>
      `,
      textContent: `
Signature Received

Dear {{ownerName}},

Thank you for providing your digital signature for {{companyName}}.

Signature Details:
- Role: {{roleKey}}
- Signature Type: {{signatureType}}
- Date Signed: {{dateSigned}}

Your application is now being processed by your agent {{agentName}}. You will receive updates as your application progresses.

If you did not authorize this signature, please contact us immediately.
      `,
      useWrapper: true,
      wrapperType: 'success',
      headerGradient: 'green'
    },
    variables: {
      ownerName: 'Signer name',
      ownerEmail: 'Signer email',
      companyName: 'Company name',
      roleKey: 'Signature role',
      signatureType: 'Type of signature (canvas/typed)',
      dateSigned: 'Date signature was captured',
      agentName: 'Agent handling application'
    },
    isActive: true,
    version: 1
  },
  {
    name: 'Signature Expiration Reminder - 3 Days',
    description: 'Reminder sent 3 days before signature request expires',
    actionType: 'email',
    category: 'application',
    config: {
      subject: 'Reminder: Signature Required - {{companyName}}',
      htmlContent: `
        <h2>Signature Required</h2>
        <p>Dear {{ownerName}},</p>
        <p>This is a friendly reminder that your signature is still required for the <strong>{{companyName}}</strong> merchant application.</p>
        
        <div style="background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
          <p style="margin: 0;"><strong>⏰ Time Sensitive:</strong></p>
          <p style="margin: 10px 0 0 0;">Your signature link will expire in <strong>3 days</strong>. Please sign as soon as possible to avoid delays.</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{signatureUrl}}" style="display: inline-block; background-color: #f59e0b; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Sign Now
          </a>
        </div>
        
        <p>Your application cannot be processed until all signatures are received.</p>
        
        <p><small>If you have questions, contact your agent {{agentName}}.</small></p>
      `,
      textContent: `
Signature Required

Dear {{ownerName}},

This is a friendly reminder that your signature is still required for the {{companyName}} merchant application.

⏰ Time Sensitive:
Your signature link will expire in 3 days. Please sign as soon as possible to avoid delays.

Sign Now: {{signatureUrl}}

Your application cannot be processed until all signatures are received.

If you have questions, contact your agent {{agentName}}.
      `,
      useWrapper: true,
      wrapperType: 'reminder',
      headerGradient: 'orange'
    },
    variables: {
      ownerName: 'Signer name',
      ownerEmail: 'Signer email',
      companyName: 'Company name',
      signatureUrl: 'URL to signature capture page',
      agentName: 'Agent handling application'
    },
    isActive: true,
    version: 1
  },
  {
    name: 'Signature Expiration Reminder - 1 Day',
    description: 'Final reminder sent 1 day before signature request expires',
    actionType: 'email',
    category: 'application',
    config: {
      subject: 'URGENT: Signature Required Today - {{companyName}}',
      htmlContent: `
        <h2>Final Reminder: Signature Required</h2>
        <p>Dear {{ownerName}},</p>
        <p><strong>URGENT:</strong> Your signature link for <strong>{{companyName}}</strong> will expire in less than 24 hours.</p>
        
        <div style="background-color: #fee2e2; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0;">
          <p style="margin: 0; color: #991b1b;"><strong>⚠️ Action Required:</strong></p>
          <p style="margin: 10px 0 0 0; color: #991b1b;">Your signature link expires tomorrow. After expiration, a new link must be generated, delaying your application.</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{signatureUrl}}" style="display: inline-block; background-color: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Sign Immediately
          </a>
        </div>
        
        <p>Please complete your signature now to keep your application on track.</p>
        
        <p><small>Contact your agent {{agentName}} if you need assistance.</small></p>
      `,
      textContent: `
Final Reminder: Signature Required

Dear {{ownerName}},

URGENT: Your signature link for {{companyName}} will expire in less than 24 hours.

⚠️ Action Required:
Your signature link expires tomorrow. After expiration, a new link must be generated, delaying your application.

Sign Immediately: {{signatureUrl}}

Please complete your signature now to keep your application on track.

Contact your agent {{agentName}} if you need assistance.
      `,
      useWrapper: true,
      wrapperType: 'alert',
      headerGradient: 'red'
    },
    variables: {
      ownerName: 'Signer name',
      ownerEmail: 'Signer email',
      companyName: 'Company name',
      signatureUrl: 'URL to signature capture page',
      agentName: 'Agent handling application'
    },
    isActive: true,
    version: 1
  },
  {
    name: 'Signature Expired Notification',
    description: 'Notification sent when signature request has expired',
    actionType: 'email',
    category: 'application',
    config: {
      subject: 'Signature Link Expired - {{companyName}}',
      htmlContent: `
        <h2>Signature Link Expired</h2>
        <p>Dear {{ownerName}},</p>
        <p>Your signature link for <strong>{{companyName}}</strong> has expired after 7 days.</p>
        
        <div style="background-color: #fee2e2; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0;">
          <p style="margin: 0; color: #991b1b;"><strong>What This Means:</strong></p>
          <p style="margin: 10px 0 0 0; color: #991b1b;">For security reasons, signature links expire after 7 days. Your agent {{agentName}} will send you a new signature request.</p>
        </div>
        
        <p><strong>Next Steps:</strong></p>
        <ol>
          <li>Watch for a new signature request email from your agent</li>
          <li>Complete the signature within 7 days to avoid further delays</li>
          <li>Contact {{agentName}} if you have questions</li>
        </ol>
        
        <p>We apologize for any inconvenience. This expiration policy helps protect your information.</p>
      `,
      textContent: `
Signature Link Expired

Dear {{ownerName}},

Your signature link for {{companyName}} has expired after 7 days.

What This Means:
For security reasons, signature links expire after 7 days. Your agent {{agentName}} will send you a new signature request.

Next Steps:
1. Watch for a new signature request email from your agent
2. Complete the signature within 7 days to avoid further delays
3. Contact {{agentName}} if you have questions

We apologize for any inconvenience. This expiration policy helps protect your information.
      `,
      useWrapper: true,
      wrapperType: 'alert',
      headerGradient: 'red'
    },
    variables: {
      ownerName: 'Signer name',
      ownerEmail: 'Signer email',
      companyName: 'Company name',
      originalRequestDate: 'When signature was originally requested',
      agentName: 'Agent handling application'
    },
    isActive: true,
    version: 1
  }
];

async function seedSignatureSystem() {
  console.log('✍️  Seeding Signature Trigger/Action System...');
  console.log(`Development DB: ${DEV_DB_URL!.split('@')[1].split('/')[0]}`);
  
  try {
    // 1. Seed trigger catalog entries
    console.log('\n⚡ Seeding signature triggers...');
    const createdTriggers: { [key: string]: number } = {};
    
    for (const trigger of signatureTriggers) {
      // Check if trigger already exists
      const existing = await devDb.query.triggerCatalog.findFirst({
        where: eq(schema.triggerCatalog.triggerKey, trigger.triggerKey)
      });
      
      if (existing) {
        console.log(`  ⏭️  ${trigger.name} (already exists)`);
        createdTriggers[trigger.triggerKey] = existing.id;
      } else {
        const [created] = await devDb.insert(schema.triggerCatalog).values({
          ...trigger,
          createdAt: new Date(),
          updatedAt: new Date()
        }).returning();
        createdTriggers[trigger.triggerKey] = created.id;
        console.log(`  ✅ ${trigger.name}`);
      }
    }
    
    // 2. Seed action templates
    console.log('\n📧 Seeding signature action templates...');
    const createdTemplates: number[] = [];
    
    for (const template of signatureActionTemplates) {
      // Check if template already exists
      const existing = await devDb.query.actionTemplates.findFirst({
        where: eq(schema.actionTemplates.name, template.name)
      });
      
      if (existing) {
        console.log(`  ⏭️  ${template.name} (already exists)`);
        createdTemplates.push(existing.id);
      } else {
        const [created] = await devDb.insert(schema.actionTemplates).values({
          ...template,
          createdAt: new Date(),
          updatedAt: new Date()
        }).returning();
        createdTemplates.push(created.id);
        console.log(`  ✅ ${template.name}`);
      }
    }
    
    // 3. Link triggers to actions via trigger_actions
    console.log('\n🔗 Linking triggers to actions...');
    
    // Helper function to link trigger to action template
    async function linkTriggerToAction(
      triggerKey: string,
      templateName: string,
      sequenceOrder: number = 1
    ) {
      const triggerId = createdTriggers[triggerKey];
      const template = await devDb.query.actionTemplates.findFirst({
        where: eq(schema.actionTemplates.name, templateName)
      });
      
      if (!triggerId || !template) {
        console.log(`  ⚠️  Could not link ${triggerKey} → ${templateName} (trigger or template not found)`);
        return;
      }
      
      // Check if this exact trigger-action link already exists
      const existing = await devDb.query.triggerActions.findFirst({
        where: (ta, { and, eq }) => and(
          eq(ta.triggerId, triggerId),
          eq(ta.actionTemplateId, template.id)
        )
      });
      
      if (existing) {
        console.log(`  ⏭️  ${triggerKey} → ${templateName} (already linked)`);
        return;
      }
      
      // Check if there's already a different action at this sequence order
      const conflicting = await devDb.query.triggerActions.findFirst({
        where: (ta, { and, eq }) => and(
          eq(ta.triggerId, triggerId),
          eq(ta.sequenceOrder, sequenceOrder),
          eq(ta.isActive, true)
        )
      });
      
      if (conflicting) {
        console.log(`  ⚠️  ${triggerKey} already has an action at sequence ${sequenceOrder}, skipping`);
        return;
      }
      
      // Safe to insert
      await devDb.insert(schema.triggerActions).values({
        triggerId,
        actionTemplateId: template.id,
        sequenceOrder,
        conditions: null,
        requiresEmailPreference: false,
        requiresSmsPreference: false,
        delaySeconds: 0,
        retryOnFailure: true,
        maxRetries: 3,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`  ✅ ${triggerKey} → ${templateName}`);
    }
    
    // Link triggers to actions
    await linkTriggerToAction('signature_requested', 'Signature Request Email');
    await linkTriggerToAction('signature_captured', 'Signature Captured Confirmation');
    await linkTriggerToAction('signature_expired', 'Signature Expired Notification');
    
    // Note: Reminder emails (3 days, 1 day) are not triggered by events
    // They will be sent by a scheduled job checking signature expiration dates
    
    // 4. Verification
    console.log('\n🔍 Verifying signature system...');
    const triggerCount = await devDb.query.triggerCatalog.findMany({
      where: (tc, { like }) => like(tc.triggerKey, 'signature_%')
    });
    const templateCount = await devDb.query.actionTemplates.findMany({
      where: (at, { and, eq, like }) => and(
        eq(at.actionType, 'email'),
        like(at.name, '%Signature%')
      )
    });
    
    console.log(`✅ Signature Triggers: ${triggerCount.length}`);
    console.log(`✅ Signature Action Templates: ${templateCount.length}`);
    
    console.log('\n✅ Signature trigger/action system seeded successfully!');
    console.log('\n📝 Notes:');
    console.log('  - Reminder emails (3 days, 1 day) require a scheduled job');
    console.log('  - These templates are available for manual trigger or automation');
    console.log('  - All signature triggers are now linked to email actions');
    
  } catch (error: any) {
    console.error(`\n❌ Signature system seeding failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await devPool.end();
  }
}

// Run the seeding
seedSignatureSystem();
