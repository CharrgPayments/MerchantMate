const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });

async function checkRecords() {
  const client = await pool.connect();
  try {
    console.log('=== DEVELOPMENT DATABASE RECORDS ===\n');
    
    const companies = await client.query("SELECT id, name FROM companies WHERE name LIKE '%Test%' ORDER BY id DESC LIMIT 5");
    console.log('Companies with "Test" in name:');
    companies.rows.forEach(r => console.log(`  ID ${r.id}: ${r.name}`));
    
    const agents = await client.query("SELECT id, first_name, last_name, company_id FROM agents ORDER BY id DESC LIMIT 5");
    console.log('\nRecent agents:');
    agents.rows.forEach(r => console.log(`  ID ${r.id}: ${r.first_name} ${r.last_name} (Company: ${r.company_id})`));
    
    const locations = await client.query("SELECT id, name, company_id FROM locations ORDER BY id DESC LIMIT 5");
    console.log('\nRecent locations:');
    locations.rows.forEach(r => console.log(`  ID ${r.id}: ${r.name} (Company: ${r.company_id})`));
  } finally {
    client.release();
    await pool.end();
  }
}

checkRecords().catch(console.error);
