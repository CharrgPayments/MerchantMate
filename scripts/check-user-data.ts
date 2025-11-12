import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();

async function checkUserData() {
  const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  
  try {
    const result = await pool.query(
      "SELECT id, email, username, first_name, last_name, role, status FROM users WHERE email = 'test.prospect@example.com'"
    );
    
    console.log('📊 User data from database:');
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await pool.end();
  }
}

checkUserData();
