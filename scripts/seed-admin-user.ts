import { Pool, neonConfig } from '@neondatabase/serverless';
import bcrypt from 'bcrypt';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function seedAdminUser(databaseUrl: string, environment: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  
  try {
    // Check if admin user exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE username = 'admin'"
    );
    
    if (existingUser.rows.length > 0) {
      console.log(`✅ Admin user already exists in ${environment} database`);
      return;
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await pool.query(`
      INSERT INTO users (
        id, email, username, password_hash, first_name, last_name, 
        role, status, email_verified, created_at, updated_at
      ) VALUES (
        'admin-prod-001', 'admin@corecrm.com', 'admin', $1, 
        'System', 'Administrator', 'super_admin', 'active', 
        true, NOW(), NOW()
      )
    `, [hashedPassword]);
    
    console.log(`✅ Created admin user in ${environment} database`);
    
  } catch (error) {
    console.error(`❌ Error seeding ${environment} database:`, error);
  } finally {
    await pool.end();
  }
}

async function main() {
  const env = process.argv[2] || 'all';
  
  if (env === 'all' || env === 'production') {
    await seedAdminUser(process.env.DATABASE_URL!, 'production');
  }
  
  if (env === 'all' || env === 'test') {
    await seedAdminUser(process.env.TEST_DATABASE_URL!, 'test');
  }
  
  if (env === 'all' || env === 'development') {
    await seedAdminUser(process.env.DEV_DATABASE_URL!, 'development');
  }
}

main().catch(console.error);