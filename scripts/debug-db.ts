import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

async function debug() {
  console.log('DEV_DATABASE_URL:', process.env.DEV_DATABASE_URL?.substring(0, 50) + '...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');
  
  const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  
  try {
    const result = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%user%' ORDER BY tablename");
    console.log('\nTables matching "user":', result.rows);
  } finally {
    await pool.end();
  }
}

debug();
