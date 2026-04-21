import { generatePlan, isPlanCertified, listCertifications, planSha } from "../server/schemaSync";
async function main() {
  const certs = listCertifications();
  console.log(`Existing certifications: ${certs.length}`);
  for (const c of certs.slice(-5)) console.log(` -`, JSON.stringify(c).slice(0,200));
  const plan = await generatePlan("production");
  const sha = planSha(plan);
  console.log(`\nProd plan SHA: ${sha}`);
  console.log(`Cert status:`, isPlanCertified(plan));
}
main().catch(e=>{console.error(e);process.exit(1)});
