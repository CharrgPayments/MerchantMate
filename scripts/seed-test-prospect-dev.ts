#!/usr/bin/env tsx
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../shared/schema.js';
import bcrypt from 'bcrypt';
import ws from 'ws';
import { eq } from 'drizzle-orm';

neonConfig.webSocketConstructor = ws;

async function seedTestProspect() {
  const devUrl = process.env.DEV_DATABASE_URL;

  if (!devUrl) {
    console.error('❌ DEV_DATABASE_URL not set');
    process.exit(1);
  }

  console.log('🌱 Seeding test prospect in development database...');

  const pool = new Pool({ connectionString: devUrl });
  const db = drizzle({ client: pool, schema });

  // Check if user already exists
  const existingUsers = await db.select().from(schema.users).where(eq(schema.users.email, 'test.prospect@example.com')).limit(1);
  
  let user;
  if (existingUsers.length > 0) {
    user = existingUsers[0];
    console.log('✅ Found existing test user:', user.id, user.email);
  } else {
    // Create test password hash
    const passwordHash = await bcrypt.hash('TestPassword123!', 10);

    // Create test user
    const [newUser] = await db.insert(schema.users).values({
      id: crypto.randomUUID(),
      email: 'test.prospect@example.com',
      username: 'test.prospect@example.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'Prospect',
      phone: '555-123-4567',
      roles: ['prospect'],
      status: 'active',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    
    user = newUser;
    console.log('✅ Created new test user:', user.id, user.email);
  }

  // Create test prospect
  const [prospect] = await db.insert(schema.merchantProspects).values({
    firstName: 'Test',
    lastName: 'Prospect',
    email: 'test.prospect@example.com',
    userId: user.id,
    status: 'application_submitted',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();

  console.log('✅ Created test prospect:', prospect.id);

  // Get admin user for notifications
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@corecrm.com')).limit(1);

  if (admin) {
    // Create test notifications
    await db.insert(schema.prospectNotifications).values([
      {
        prospectId: prospect.id,
        subject: 'Welcome to CoreCRM',
        message: 'Thank you for submitting your application. We will review it and get back to you soon.',
        type: 'info',
        isRead: false,
        createdBy: admin.id,
        createdAt: new Date()
      },
      {
        prospectId: prospect.id,
        subject: 'Document Request',
        message: 'Please upload your business license and tax identification documents.',
        type: 'action_required',
        isRead: false,
        createdBy: admin.id,
        createdAt: new Date()
      },
      {
        prospectId: prospect.id,
        subject: 'Application Update',
        message: 'Your application is currently under review by our underwriting team.',
        type: 'info',
        isRead: true,
        createdBy: admin.id,
        createdAt: new Date()
      }
    ]);
    
    console.log('✅ Created 3 test notifications');
  }

  await pool.end();
  console.log('✅ Test prospect seeding complete!');
  console.log('\n📋 Test Credentials:');
  console.log('   Email: test.prospect@example.com');
  console.log('   Password: TestPassword123!');
}

seedTestProspect().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
