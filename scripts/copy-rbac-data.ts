import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema';
import { eq } from 'drizzle-orm';

async function copyRbacData() {
  console.log('🔄 Starting RBAC data copy from production to dev/test...\n');

  const productionUrl = process.env.DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!productionUrl) {
    throw new Error('DATABASE_URL (production) not set');
  }

  // Create production connection
  const prodPool = new Pool({ connectionString: productionUrl });
  const prodDb = drizzle(prodPool, { schema });

  // Get production data
  console.log('📖 Reading RBAC data from production...');
  const resources = await prodDb.select().from(schema.rbacResources);
  const permissions = await prodDb.select().from(schema.rolePermissions);
  
  console.log(`   Found ${resources.length} resources`);
  console.log(`   Found ${permissions.length} permissions\n`);

  // Copy to development database
  if (devUrl) {
    console.log('📝 Copying to DEVELOPMENT database...');
    const devPool = new Pool({ connectionString: devUrl });
    const devDb = drizzle(devPool, { schema });

    try {
      // Clear existing data
      await devDb.delete(schema.rolePermissions);
      await devDb.delete(schema.rbacResources);
      console.log('   Cleared existing data');

      // Insert resources
      if (resources.length > 0) {
        for (const resource of resources) {
          await devDb.insert(schema.rbacResources).values(resource).onConflictDoNothing();
        }
        console.log(`   Inserted ${resources.length} resources`);
      }

      // Insert permissions
      if (permissions.length > 0) {
        for (const permission of permissions) {
          await devDb.insert(schema.rolePermissions).values(permission).onConflictDoNothing();
        }
        console.log(`   Inserted ${permissions.length} permissions`);
      }

      console.log('   ✅ Development database updated!\n');
    } catch (error) {
      console.error('   ❌ Error copying to development:', error);
    } finally {
      await devPool.end();
    }
  } else {
    console.log('⚠️  DEV_DATABASE_URL not set, skipping development database\n');
  }

  // Copy to test database
  if (testUrl) {
    console.log('📝 Copying to TEST database...');
    const testPool = new Pool({ connectionString: testUrl });
    const testDb = drizzle(testPool, { schema });

    try {
      // Clear existing data
      await testDb.delete(schema.rolePermissions);
      await testDb.delete(schema.rbacResources);
      console.log('   Cleared existing data');

      // Insert resources
      if (resources.length > 0) {
        for (const resource of resources) {
          await testDb.insert(schema.rbacResources).values(resource).onConflictDoNothing();
        }
        console.log(`   Inserted ${resources.length} resources`);
      }

      // Insert permissions
      if (permissions.length > 0) {
        for (const permission of permissions) {
          await testDb.insert(schema.rolePermissions).values(permission).onConflictDoNothing();
        }
        console.log(`   Inserted ${permissions.length} permissions`);
      }

      console.log('   ✅ Test database updated!\n');
    } catch (error) {
      console.error('   ❌ Error copying to test:', error);
    } finally {
      await testPool.end();
    }
  } else {
    console.log('⚠️  TEST_DATABASE_URL not set, skipping test database\n');
  }

  await prodPool.end();
  console.log('🎉 RBAC data copy complete!');
}

copyRbacData().catch(console.error);
