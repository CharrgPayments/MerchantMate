import { db } from '../server/db';
import { DatabaseStorage } from '../server/storage';

async function seedTestWorkflowTicket() {
  const storage = new DatabaseStorage(db);
  
  console.log('Getting workflow definition...');
  
  const definition = await storage.getWorkflowDefinitionByCode('merchant_underwriting');
  if (!definition) {
    console.error('Workflow definition not found. Run seed-underwriting-workflow.ts first.');
    process.exit(1);
  }
  
  console.log('Found workflow definition:', definition.id);
  
  const stages = await storage.getWorkflowStages(definition.id);
  console.log(`Found ${stages.length} stages`);
  
  if (stages.length === 0) {
    console.error('No stages found for workflow definition');
    process.exit(1);
  }
  
  console.log('Creating test workflow ticket...');
  
  const firstStage = stages.find(s => s.orderIndex === 0);
  
  const ticketNumber = `UW-${Date.now().toString().slice(-8)}`;
  
  const ticket = await storage.createWorkflowTicket({
    workflowDefinitionId: definition.id,
    ticketNumber,
    entityType: 'prospect_application',
    entityId: 1,
    status: 'pending',
    currentStageId: firstStage?.id || null,
    priority: 'normal',
    metadata: {
      businessName: 'Test Business LLC',
      applicationId: 1,
      submittedAt: new Date().toISOString(),
    },
    createdBy: 'system',
  });
  
  console.log('Created workflow ticket:', ticket.id);
  console.log('Ticket status:', ticket.status);
  console.log('Current stage ID:', ticket.currentStageId);
  
  console.log('\nTest ticket created successfully!');
  console.log('You can now test the workflow dashboard at /workflow');
  process.exit(0);
}

seedTestWorkflowTicket().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
