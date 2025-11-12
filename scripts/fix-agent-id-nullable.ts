#!/usr/bin/env tsx
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function fixAgentIdNullable() {
  const devUrl = process.env.DEV_DATABASE_URL;

  if (!devUrl) {
    console.error('❌ DEV_DATABASE_URL not set');
    process.exit(1);
  }

  console.log('🔧 Making agent_id nullable in development database...');

  const pool = new Pool({ connectionString: devUrl });
  
  try {
    await pool.query(`
      ALTER TABLE merchant_prospects 
      ALTER COLUMN agent_id DROP NOT NULL
    `);
    
    console.log('✅ agent_id is now nullable in development database');
  } catch (error: any) {
    if (error.message?.includes('column "agent_id" of relation "merchant_prospects" does not exist')) {
      console.log('⚠️  agent_id column does not exist or is already nullable');
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

fixAgentIdNullable().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
