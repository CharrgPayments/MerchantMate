#!/usr/bin/env tsx
/**
 * Complete Email System Seeding Script
 * Seeds email templates, triggers, and sample activity data for Core CRM
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../shared/schema';
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

// Email templates data
const emailTemplatesData = [
  {
    name: 'Welcome Email',
    description: 'Welcome message for new merchants',
    subject: 'Welcome to Core CRM',
    htmlContent: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Welcome to Core CRM</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;"><h1>Welcome to Core CRM</h1></div><div style="padding: 30px 20px; background-color: #f9f9f9;"><h2>Welcome {{firstName}} {{lastName}}!</h2><p>Thank you for joining Core CRM. We\'re excited to help you grow your business.</p></div></body></html>',
    textContent: 'Welcome {{firstName}} {{lastName}}! Thank you for joining Core CRM.',
    category: 'welcome',
    variables: '["businessName", "firstName", "lastName"]'
  },
  {
    name: 'Application Received',
    description: 'Confirmation that application was received',
    subject: 'Application Received',
    htmlContent: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Application Received</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;"><h1>Application Received</h1></div><div style="padding: 30px 20px; background-color: #f9f9f9;"><h2>Thank you {{firstName}} {{lastName}},</h2><p>Your application has been received and is being processed.</p><p>We will review your application and contact you within 2-3 business days.</p></div></body></html>',
    textContent: 'Thank you {{firstName}} {{lastName}}, your application has been received and is being processed.',
    category: 'application',
    variables: '["firstName", "lastName", "applicationId"]'
  },
  {
    name: 'Email Verification',
    description: 'Template for verifying merchant email addresses',
    subject: 'Please verify your email address',
    htmlContent: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Email Verification</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;"><h1>Email Verification Required</h1></div><div style="padding: 30px 20px; background-color: #f9f9f9;"><h2>Hello {{firstName}} {{lastName}},</h2><p>Please verify your email address by clicking the button below:</p><p style="text-align: center;"><a href="{{verificationUrl}}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">Verify Email</a></p><p>This verification link will expire in 24 hours.</p></div></body></html>',
    textContent: 'Hello {{firstName}} {{lastName}}, Please verify your email address by visiting: {{verificationUrl}}',
    category: 'authentication',
    variables: '["firstName", "lastName", "verificationUrl"]'
  },
  {
    name: 'Password Reset',
    description: 'Template for password reset requests',
    subject: 'Reset your password',
    htmlContent: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Password Reset</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background-color: #dc2626; color: white; padding: 20px; text-align: center;"><h1>Password Reset Request</h1></div><div style="padding: 30px 20px; background-color: #f9f9f9;"><h2>Hello {{firstName}},</h2><p>You requested a password reset for your Core CRM account.</p><p style="text-align: center;"><a href="{{resetUrl}}" style="display: inline-block; background-color: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">Reset Password</a></p><p>This reset link will expire in 1 hour.</p></div></body></html>',
    textContent: 'Hello {{firstName}}, You requested a password reset. Visit: {{resetUrl}}',
    category: 'authentication',
    variables: '["firstName", "resetUrl"]'
  },
  {
    name: 'Account Activated',
    description: 'Template for successful account activation',
    subject: 'Your merchant account is now active',
    htmlContent: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Account Activated</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background-color: #16a34a; color: white; padding: 20px; text-align: center;"><h1>Account Activated!</h1></div><div style="padding: 30px 20px; background-color: #f9f9f9;"><h2>Congratulations {{businessName}}!</h2><p>Your merchant processing account has been successfully activated.</p><ul><li>Merchant ID: {{merchantId}}</li><li>Processing Rate: {{processingRate}}%</li><li>Account Manager: {{agentName}}</li></ul><p style="text-align: center;"><a href="{{dashboardUrl}}" style="display: inline-block; background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">Access Dashboard</a></p></div></body></html>',
    textContent: 'Congratulations {{businessName}}! Your merchant account is now active.',
    category: 'approval',
    variables: '["businessName", "merchantId", "processingRate", "agentName", "dashboardUrl"]'
  }
];

// Email triggers data
const emailTriggersData = [
  {
    name: 'Welcome New User',
    description: 'Automatically send welcome email when a new user registers',
    templateId: 1,
    triggerEvent: 'user_registered',
    isActive: true,
    conditions: '{"user_type": ["merchant", "agent"]}'
  },
  {
    name: 'Application Received Confirmation',
    description: 'Send confirmation when merchant application is received',
    templateId: 2,
    triggerEvent: 'application_submitted',
    isActive: true,
    conditions: '{"application_type": "merchant"}'
  },
  {
    name: 'Email Verification Request',
    description: 'Send email verification when user signs up',
    templateId: 3,
    triggerEvent: 'user_registered',
    isActive: true,
    conditions: '{"email_verified": false}'
  },
  {
    name: 'Password Reset Request',
    description: 'Send password reset email when user requests it',
    templateId: 4,
    triggerEvent: 'password_reset_requested',
    isActive: true,
    conditions: '{}'
  },
  {
    name: 'Account Activation Notice',
    description: 'Send notification when merchant account is activated',
    templateId: 5,
    triggerEvent: 'account_activated',
    isActive: true,
    conditions: '{"account_type": "merchant"}'
  }
];

async function seedEmailSystem() {
  console.log('📧 Seeding Complete Email System...');
  console.log(`Development DB: ${DEV_DB_URL.split('@')[1].split('/')[0]}`);
  
  try {
    // 1. Create email tables
    console.log('\n🏗️  Creating email system tables...');
    
    await devDb.execute(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        text_content TEXT,
        variables JSONB,
        category VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await devDb.execute(`
      CREATE TABLE IF NOT EXISTS email_activity (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES email_templates(id),
        template_name VARCHAR(100) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        recipient_name VARCHAR(255),
        subject TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        trigger_source VARCHAR(100),
        triggered_by VARCHAR(255),
        metadata JSONB,
        sent_at TIMESTAMP DEFAULT NOW(),
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP
      )
    `);
    
    await devDb.execute(`
      CREATE TABLE IF NOT EXISTS email_triggers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        template_id INTEGER REFERENCES email_templates(id),
        trigger_event VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        conditions JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create indexes
    await devDb.execute(`
      CREATE INDEX IF NOT EXISTS email_activity_template_id_idx ON email_activity (template_id);
      CREATE INDEX IF NOT EXISTS email_activity_recipient_email_idx ON email_activity (recipient_email);
      CREATE INDEX IF NOT EXISTS email_activity_status_idx ON email_activity (status);
      CREATE INDEX IF NOT EXISTS email_activity_sent_at_idx ON email_activity (sent_at);
    `);
    
    console.log('✅ Tables created');
    
    // 2. Clear existing data
    console.log('\n🧹 Clearing existing email data...');
    await devDb.execute('DELETE FROM email_activity');
    await devDb.execute('DELETE FROM email_triggers');
    await devDb.execute('DELETE FROM email_templates');
    console.log('✅ Cleared existing data');
    
    // 3. Seed email templates
    console.log('\n📄 Seeding email templates...');
    for (const template of emailTemplatesData) {
      await devDb.insert(schema.emailTemplates).values({
        name: template.name,
        description: template.description,
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent,
        variables: template.variables ? JSON.parse(template.variables) : null,
        category: template.category,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`  ✅ ${template.name}`);
    }
    
    // 4. Seed email triggers
    console.log('\n⚡ Seeding email triggers...');
    for (const trigger of emailTriggersData) {
      await devDb.insert(schema.emailTriggers).values({
        name: trigger.name,
        description: trigger.description,
        templateId: trigger.templateId,
        triggerEvent: trigger.triggerEvent,
        isActive: trigger.isActive,
        conditions: JSON.parse(trigger.conditions),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`  ✅ ${trigger.name}`);
    }
    
    // 5. Add sample email activity
    console.log('\n📊 Adding sample email activity...');
    const sampleActivity = [
      {
        templateId: 1,
        templateName: 'Welcome Email',
        recipientEmail: 'john.doe@example.com',
        recipientName: 'John Doe',
        subject: 'Welcome to Core CRM',
        status: 'sent',
        triggerSource: 'api',
        triggeredBy: 'system',
        metadata: JSON.stringify({ user_type: 'merchant', signup_date: '2025-08-14' })
      },
      {
        templateId: 2,
        templateName: 'Application Received',
        recipientEmail: 'jane.smith@business.com',
        recipientName: 'Jane Smith',
        subject: 'Application Received',
        status: 'opened',
        triggerSource: 'api',
        triggeredBy: 'system',
        metadata: JSON.stringify({ application_id: 'APP-2025-001', business_name: 'Smith Enterprises' })
      }
    ];
    
    for (const activity of sampleActivity) {
      await devDb.insert(schema.emailActivity).values({
        templateId: activity.templateId,
        templateName: activity.templateName,
        recipientEmail: activity.recipientEmail,
        recipientName: activity.recipientName,
        subject: activity.subject,
        status: activity.status,
        triggerSource: activity.triggerSource,
        triggeredBy: activity.triggeredBy,
        metadata: JSON.parse(activity.metadata),
        sentAt: new Date()
      });
      console.log(`  ✅ ${activity.recipientEmail}`);
    }
    
    // 6. Verification
    console.log('\n🔍 Verifying email system...');
    const templateCount = await devDb.select().from(schema.emailTemplates);
    const triggerCount = await devDb.select().from(schema.emailTriggers);
    const activityCount = await devDb.select().from(schema.emailActivity);
    
    console.log(`✅ Email Templates: ${templateCount.length}`);
    console.log(`✅ Email Triggers: ${triggerCount.length}`);
    console.log(`✅ Email Activity Records: ${activityCount.length}`);
    
    console.log('\n✅ Complete email system seeded successfully!');
    
  } catch (error) {
    console.error(`\n❌ Email system seeding failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await devPool.end();
  }
}

// Run the seeding
seedEmailSystem();