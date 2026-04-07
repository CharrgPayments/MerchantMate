import bcrypt from 'bcrypt';
import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

async function resetPassword() {
  const password = 'admin123';
  const hash = await bcrypt.hash(password, 10);
  
  const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  
  try {
    // First check if user exists
    const checkResult = await pool.query(
      "SELECT id, username, email FROM users WHERE username = $1",
      ['admin']
    );
    
    if (checkResult.rows.length === 0) {
      console.log('❌ No user found with username "admin"');
      return;
    }
    
    console.log('Found user:', checkResult.rows[0]);
    
    // Update password
    const updateResult = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username",
      [hash, 'admin']
    );
    
    console.log('\n✅ Password reset successfully!');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('   Environment: development');
    console.log('   User ID:', updateResult.rows[0].id);
  } finally {
    await pool.end();
  }
}

resetPassword().catch(console.error);
