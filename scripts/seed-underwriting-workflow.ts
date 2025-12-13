import { db } from '../server/db';
import { DatabaseStorage } from '../server/storage';

async function seedUnderwritingWorkflow() {
  const storage = new DatabaseStorage(db);
  
  console.log('Checking if workflow already exists...');
  
  const existing = await storage.getWorkflowDefinitionByCode('merchant_underwriting');
  if (existing) {
    console.log('Workflow definition already exists:', existing.id);
    console.log('Checking stages...');
    const stages = await storage.getWorkflowStages(existing.id);
    console.log(`Found ${stages.length} stages`);
    process.exit(0);
  }
  
  console.log('Creating workflow definition...');
  
  const definition = await storage.createWorkflowDefinition({
    code: 'merchant_underwriting',
    name: 'Merchant Application Underwriting',
    description: 'Automated underwriting workflow for merchant applications',
    version: '1.0',
    category: 'underwriting',
    entityType: 'prospect_application',
    initialStatus: 'submitted',
    finalStatuses: ['approved', 'rejected'],
    configuration: { autoAdvance: true, requiresApproval: true },
    isActive: true,
    createdBy: 'system',
  });
  
  console.log('Created workflow definition:', definition.id);
  
  const stageConfigs = [
    { code: 'mcc_screening', name: 'MCC Screening', orderIndex: 0, stageType: 'automated', handlerKey: 'mcc_screening', autoAdvance: true },
    { code: 'volume_threshold', name: 'Volume Threshold Check', orderIndex: 1, stageType: 'automated', handlerKey: 'volume_threshold', autoAdvance: true },
    { code: 'internal_screening', name: 'Internal Screening', orderIndex: 2, stageType: 'automated', handlerKey: 'internal_screening', autoAdvance: true },
    { code: 'document_review', name: 'Document Review', orderIndex: 3, stageType: 'manual', handlerKey: 'document_review', requiresReview: true, autoAdvance: false },
    { code: 'ofac_screening', name: 'OFAC Screening', orderIndex: 4, stageType: 'automated', handlerKey: 'ofac_screening', autoAdvance: true },
    { code: 'match_pro', name: 'MATCH Pro Check', orderIndex: 5, stageType: 'automated', handlerKey: 'match_pro', autoAdvance: true },
    { code: 'lexis_nexis', name: 'LexisNexis Check', orderIndex: 6, stageType: 'automated', handlerKey: 'lexis_nexis', autoAdvance: true },
    { code: 'trans_union', name: 'TransUnion Check', orderIndex: 7, stageType: 'automated', handlerKey: 'trans_union', autoAdvance: true },
    { code: 'open_corporates', name: 'OpenCorporates Check', orderIndex: 8, stageType: 'automated', handlerKey: 'open_corporates', autoAdvance: true },
    { code: 'tin_check', name: 'TIN Verification', orderIndex: 9, stageType: 'automated', handlerKey: 'tin_check', autoAdvance: true },
    { code: 'g2_risk', name: 'G2 Risk Assessment', orderIndex: 10, stageType: 'automated', handlerKey: 'g2_risk', autoAdvance: true },
    { code: 'google_kyb', name: 'Google KYB Check', orderIndex: 11, stageType: 'automated', handlerKey: 'google_kyb', autoAdvance: true },
    { code: 'final_review', name: 'Final Review', orderIndex: 12, stageType: 'manual', handlerKey: 'final_review', requiresReview: true, autoAdvance: false },
  ];
  
  console.log('Creating workflow stages...');
  
  for (const config of stageConfigs) {
    const stage = await storage.createWorkflowStage({
      workflowDefinitionId: definition.id,
      code: config.code,
      name: config.name,
      orderIndex: config.orderIndex,
      stageType: config.stageType,
      handlerKey: config.handlerKey,
      isRequired: true,
      requiresReview: config.requiresReview || false,
      autoAdvance: config.autoAdvance,
      isActive: true,
    });
    console.log(`  Created stage: ${stage.name} (${stage.id})`);
  }
  
  console.log('Workflow seeding complete!');
  process.exit(0);
}

seedUnderwritingWorkflow().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
