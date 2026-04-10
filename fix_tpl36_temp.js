const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DEV_DATABASE_URL);
async function run() {
  const [tpl] = await sql`SELECT config FROM action_templates WHERE id = 36`;
  const newConfig = {
    ...tpl.config,
    url: '{{$CHARRG_DEVELOPMENT_URL}}Merchant/GetAll?skip={skip}&take={take}',
    routeParams: [
      { name: 'skip', description: 'Records to skip (pagination offset)', defaultValue: '0' },
      { name: 'take', description: 'Records to return per page', defaultValue: '25' },
    ],
  };
  await sql`UPDATE action_templates SET config = ${JSON.stringify(newConfig)}::jsonb WHERE id = 36`;
  
  const [updated] = await sql`SELECT config FROM action_templates WHERE id = 36`;
  console.log('Stored URL:', updated.config.url);
  console.log('Route params:', JSON.stringify(updated.config.routeParams));
}
run().catch(e => console.error('ERROR:', e.message));
