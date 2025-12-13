import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema';

async function copyEquipmentData() {
  console.log('🔄 Starting equipment data copy from production to dev/test...\n');

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
  console.log('📖 Reading equipment data from production...');
  const equipmentItems = await prodDb.select().from(schema.equipmentItems);
  const campaignEquipment = await prodDb.select().from(schema.campaignEquipment);
  
  console.log(`   Found ${equipmentItems.length} equipment items`);
  console.log(`   Found ${campaignEquipment.length} campaign equipment links\n`);

  // Copy to development database
  if (devUrl) {
    console.log('📝 Copying to DEVELOPMENT database...');
    const devPool = new Pool({ connectionString: devUrl });
    const devDb = drizzle(devPool, { schema });

    try {
      // Clear existing data (campaign_equipment first due to FK constraint)
      await devDb.delete(schema.campaignEquipment);
      await devDb.delete(schema.equipmentItems);
      console.log('   Cleared existing data');

      // Insert equipment items
      if (equipmentItems.length > 0) {
        for (const item of equipmentItems) {
          await devDb.insert(schema.equipmentItems).values(item).onConflictDoNothing();
        }
        console.log(`   Inserted ${equipmentItems.length} equipment items`);
      }

      // Insert campaign equipment links
      if (campaignEquipment.length > 0) {
        for (const link of campaignEquipment) {
          await devDb.insert(schema.campaignEquipment).values(link).onConflictDoNothing();
        }
        console.log(`   Inserted ${campaignEquipment.length} campaign equipment links`);
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
      // Clear existing data (campaign_equipment first due to FK constraint)
      await testDb.delete(schema.campaignEquipment);
      await testDb.delete(schema.equipmentItems);
      console.log('   Cleared existing data');

      // Insert equipment items
      if (equipmentItems.length > 0) {
        for (const item of equipmentItems) {
          await testDb.insert(schema.equipmentItems).values(item).onConflictDoNothing();
        }
        console.log(`   Inserted ${equipmentItems.length} equipment items`);
      }

      // Insert campaign equipment links
      if (campaignEquipment.length > 0) {
        for (const link of campaignEquipment) {
          await testDb.insert(schema.campaignEquipment).values(link).onConflictDoNothing();
        }
        console.log(`   Inserted ${campaignEquipment.length} campaign equipment links`);
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
  console.log('🎉 Equipment data copy complete!');
}

copyEquipmentData().catch(console.error);
