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
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE username = 'admin'",
      [hash]
    );
    console.log('✅ Password reset successfully for admin user');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('   Environment: development');
  } finally {
    await pool.end();
  }
}

resetPassword();
