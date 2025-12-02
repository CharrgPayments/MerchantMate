import type { StageHandler, StageHandlerContext, StageHandlerResult } from "./workflow-engine";
import type { MerchantProspect, ProspectOwner } from "@shared/schema";

export const mccScreeningHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const prospect = context.entityData as MerchantProspect;
  if (!prospect) {
    return {
      status: 'error',
      issues: [{
        issueCode: 'MISSING_PROSPECT',
        type: 'validation',
        severity: 'critical',
        title: 'Missing Prospect Data',
        description: 'Could not load prospect data for MCC screening',
      }],
    };
  }

  const mccCode = (prospect as any).mccCode;
  if (!mccCode) {
    return {
      status: 'pending_review',
      issues: [{
        issueCode: 'MCC_NOT_PROVIDED',
        type: 'validation',
        severity: 'medium',
        title: 'MCC Code Not Provided',
        description: 'Prospect does not have an MCC code assigned',
      }],
      tasks: [{
        taskCode: 'ASSIGN_MCC',
        title: 'Assign MCC Code',
        description: 'Review business type and assign the correct MCC code',
        priority: 'high',
        assignedRoles: ['underwriter', 'admin'],
      }],
    };
  }

  const mccPolicy = await context.storage.getMccPolicy(mccCode);
  
  if (!mccPolicy) {
    return {
      status: 'passed',
      notes: `MCC ${mccCode} - No specific policy found, default processing allowed`,
      metadata: { mccCode, policyStatus: 'allowed', policyFound: false },
    };
  }

  if (mccPolicy.category === 'prohibited') {
    return {
      status: 'failed',
      issues: [{
        issueCode: 'MCC_PROHIBITED',
        type: 'compliance',
        severity: 'critical',
        title: `Prohibited MCC: ${mccCode}`,
        description: mccPolicy.notes || `MCC ${mccCode} is prohibited`,
      }],
      metadata: { mccCode, policyStatus: 'prohibited', policy: mccPolicy },
    };
  }

  if (mccPolicy.category === 'restricted' || mccPolicy.category === 'review_required') {
    return {
      status: 'pending_review',
      issues: [{
        issueCode: 'MCC_RESTRICTED',
        type: 'compliance',
        severity: 'high',
        title: `Restricted MCC: ${mccCode}`,
        description: mccPolicy.notes || `MCC ${mccCode} requires additional review`,
      }],
      metadata: { mccCode, policyStatus: 'restricted', policy: mccPolicy },
    };
  }

  return {
    status: 'passed',
    notes: `MCC ${mccCode} - Allowed`,
    metadata: { mccCode, policyStatus: 'allowed', policy: mccPolicy },
  };
};

export const volumeThresholdHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const prospect = context.entityData as MerchantProspect;
  if (!prospect) {
    return {
      status: 'error',
      issues: [{
        issueCode: 'MISSING_PROSPECT',
        type: 'validation',
        severity: 'critical',
        title: 'Missing Prospect Data',
        description: 'Could not load prospect data for volume threshold check',
      }],
    };
  }

  const monthlyVolume = (prospect as any).estimatedMonthlyVolume || 0;
  const avgTicket = (prospect as any).averageTicketSize || 0;
  const highTicket = (prospect as any).highTicketAmount || 0;

  const issues: StageHandlerResult['issues'] = [];
  const metadata: Record<string, any> = {
    monthlyVolume,
    avgTicket,
    highTicket,
    thresholdChecks: [],
  };

  if (monthlyVolume > 500000) {
    issues.push({
      issueCode: 'HIGH_MONTHLY_VOLUME',
      type: 'risk',
      severity: 'high',
      title: 'High Monthly Volume',
      description: `Estimated monthly volume of $${monthlyVolume.toLocaleString()} exceeds $500,000 threshold`,
    });
    metadata.thresholdChecks.push({ check: 'monthly_volume', exceeded: true });
  } else {
    metadata.thresholdChecks.push({ check: 'monthly_volume', exceeded: false });
  }

  if (avgTicket > 5000) {
    issues.push({
      issueCode: 'HIGH_AVG_TICKET',
      type: 'risk',
      severity: avgTicket > 10000 ? 'high' : 'medium',
      title: 'High Average Ticket',
      description: `Average ticket of $${avgTicket.toLocaleString()} exceeds $5,000 threshold`,
    });
    metadata.thresholdChecks.push({ check: 'avg_ticket', exceeded: true });
  } else {
    metadata.thresholdChecks.push({ check: 'avg_ticket', exceeded: false });
  }

  if (highTicket > 25000) {
    issues.push({
      issueCode: 'HIGH_MAX_TICKET',
      type: 'risk',
      severity: 'high',
      title: 'Very High Maximum Ticket',
      description: `Maximum ticket of $${highTicket.toLocaleString()} exceeds $25,000 threshold`,
    });
    metadata.thresholdChecks.push({ check: 'high_ticket', exceeded: true });
  } else {
    metadata.thresholdChecks.push({ check: 'high_ticket', exceeded: false });
  }

  const hasHighSeverityIssues = issues.some(i => i.severity === 'high' || i.severity === 'critical');

  return {
    status: hasHighSeverityIssues ? 'pending_review' : 'passed',
    issues: issues.length > 0 ? issues : undefined,
    metadata,
    notes: issues.length > 0 
      ? `Volume check completed with ${issues.length} issue(s) flagged`
      : 'Volume thresholds within acceptable limits',
  };
};

export const internalScreeningHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const prospect = context.entityData as MerchantProspect;
  if (!prospect) {
    return {
      status: 'error',
      issues: [{
        issueCode: 'MISSING_PROSPECT',
        type: 'validation',
        severity: 'critical',
        title: 'Missing Prospect Data',
        description: 'Could not load prospect data for internal screening',
      }],
    };
  }

  const issues: StageHandlerResult['issues'] = [];
  const checks: Record<string, any> = {};

  const existingMerchant = await context.storage.getMerchantByEmail(prospect.email);
  if (existingMerchant) {
    issues.push({
      issueCode: 'DUPLICATE_EMAIL',
      type: 'verification',
      severity: 'medium',
      title: 'Duplicate Merchant Email',
      description: `Email ${prospect.email} already exists in merchant records`,
      affectedField: 'email',
    });
    checks.duplicateEmail = { found: true, merchantId: existingMerchant.id };
  } else {
    checks.duplicateEmail = { found: false };
  }

  const owners = await context.storage.getProspectOwners(prospect.id);
  if (owners.length === 0) {
    issues.push({
      issueCode: 'NO_OWNERS',
      type: 'validation',
      severity: 'high',
      title: 'No Owners Defined',
      description: 'Prospect has no owners/principals defined',
      affectedEntity: 'owners',
    });
    checks.owners = { count: 0, totalOwnership: 0 };
  } else {
    const totalOwnership = owners.reduce((sum, o) => sum + (Number(o.ownershipPercentage) || 0), 0);
    checks.owners = { count: owners.length, totalOwnership };
    
    if (totalOwnership < 51) {
      issues.push({
        issueCode: 'LOW_OWNERSHIP',
        type: 'validation',
        severity: 'medium',
        title: 'Insufficient Ownership Coverage',
        description: `Total ownership is ${totalOwnership}%, should be at least 51%`,
        affectedEntity: 'owners',
      });
    }
  }

  const requiredFields = ['businessName', 'email', 'phone'];
  const missingFields = requiredFields.filter(field => !prospect[field as keyof MerchantProspect]);
  
  if (missingFields.length > 0) {
    issues.push({
      issueCode: 'MISSING_REQUIRED_FIELDS',
      type: 'validation',
      severity: 'medium',
      title: 'Missing Required Fields',
      description: `Required fields missing: ${missingFields.join(', ')}`,
    });
    checks.requiredFields = { missing: missingFields };
  } else {
    checks.requiredFields = { complete: true };
  }

  const hasBlockingIssues = issues.some(i => i.severity === 'critical' || i.severity === 'high');

  return {
    status: hasBlockingIssues ? 'pending_review' : 'passed',
    issues: issues.length > 0 ? issues : undefined,
    metadata: { checks },
    notes: `Internal screening completed: ${issues.length} issue(s) found`,
  };
};

export const documentReviewHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const prospect = context.entityData as MerchantProspect;
  if (!prospect) {
    return {
      status: 'error',
      issues: [{
        issueCode: 'MISSING_PROSPECT',
        type: 'validation',
        severity: 'critical',
        title: 'Missing Prospect Data',
        description: 'Could not load prospect data for document review',
      }],
    };
  }

  const documents = await context.storage.getProspectDocuments(prospect.id);
  const issues: StageHandlerResult['issues'] = [];
  const tasks: StageHandlerResult['tasks'] = [];

  const requiredDocCategories = ['government_id', 'business_license'];
  const uploadedCategories = documents.map(d => d.category);
  
  for (const docCategory of requiredDocCategories) {
    if (!uploadedCategories.includes(docCategory)) {
      issues.push({
        issueCode: `MISSING_DOC_${docCategory.toUpperCase()}`,
        type: 'document',
        severity: 'medium',
        title: `Missing Document: ${docCategory.replace('_', ' ')}`,
        description: `Required document category '${docCategory}' has not been uploaded`,
        affectedField: 'documents',
      });
      tasks.push({
        taskCode: `REQUEST_DOC_${docCategory.toUpperCase()}`,
        title: `Request ${docCategory.replace('_', ' ')}`,
        description: `Contact applicant to obtain ${docCategory.replace('_', ' ')} document`,
        priority: 'high',
        assignedRoles: ['underwriter', 'support'],
      });
    }
  }

  if (documents.length === 0) {
    tasks.push({
      taskCode: 'UPLOAD_DOCS',
      title: 'Upload Required Documents',
      description: 'No documents have been uploaded yet. Request all required documents from applicant.',
      priority: 'high',
      assignedRoles: ['underwriter'],
    });
  }

  const metadata = {
    documentsUploaded: documents.length,
    documentCategories: uploadedCategories,
  };

  return {
    status: issues.length > 0 || tasks.length > 0 ? 'pending_review' : 'passed',
    issues: issues.length > 0 ? issues : undefined,
    tasks: tasks.length > 0 ? tasks : undefined,
    metadata,
    notes: `Documents: ${documents.length} uploaded`,
  };
};

export const externalApiPlaceholderHandler = (apiName: string): StageHandler => {
  return async (context: StageHandlerContext): Promise<StageHandlerResult> => {
    const integrationKey = apiName.toLowerCase().replace(/\s+/g, '_');
    const config = await context.storage.getApiIntegrationConfig(integrationKey);
    
    if (!config || !config.isActive) {
      return {
        status: 'pending_review',
        issues: [{
          issueCode: `API_NOT_CONFIGURED_${integrationKey.toUpperCase()}`,
          type: 'verification',
          severity: 'low',
          title: `${apiName} Not Configured`,
          description: `External API integration for ${apiName} is not enabled or configured`,
        }],
        tasks: [{
          taskCode: `MANUAL_CHECK_${integrationKey.toUpperCase()}`,
          title: `Manual ${apiName} Check`,
          description: `Perform manual ${apiName} verification since API is not configured`,
          priority: 'normal',
          assignedRoles: ['underwriter'],
        }],
        notes: `${apiName} integration not available - manual review required`,
      };
    }

    return {
      status: 'pending_review',
      notes: `${apiName} check - API integration placeholder (implement actual API call)`,
      metadata: {
        apiName,
        configId: config.id,
        status: 'placeholder',
      },
    };
  };
};

export const ofacScreeningHandler = externalApiPlaceholderHandler('OFAC');
export const matchProScreeningHandler = externalApiPlaceholderHandler('MATCH Pro');
export const lexisNexisHandler = externalApiPlaceholderHandler('LexisNexis');
export const transUnionHandler = externalApiPlaceholderHandler('TransUnion');
export const openCorporatesHandler = externalApiPlaceholderHandler('OpenCorporates');
export const tinCheckHandler = externalApiPlaceholderHandler('TINCheck');
export const g2RiskHandler = externalApiPlaceholderHandler('G2 Risk');
export const googleKybHandler = externalApiPlaceholderHandler('Google KYB');

export const finalReviewHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const ticketStages = await context.storage.getWorkflowTicketStages(context.ticket.id);
  const allIssues = await context.storage.getWorkflowIssues(context.ticket.id);
  
  const failedStages = ticketStages.filter(ts => ts.status === 'failed');
  const pendingStages = ticketStages.filter(ts => ts.status === 'pending' || ts.status === 'blocked');
  const openIssues = allIssues.filter(i => i.status === 'open');

  const summary = {
    totalStages: ticketStages.length,
    passedStages: ticketStages.filter(ts => ts.status === 'completed').length,
    failedStages: failedStages.length,
    pendingStages: pendingStages.length,
    totalIssues: allIssues.length,
    openIssues: openIssues.length,
    resolvedIssues: allIssues.filter(i => i.status === 'resolved').length,
    overriddenIssues: allIssues.filter(i => i.status === 'overridden').length,
  };

  if (openIssues.length > 0) {
    return {
      status: 'pending_review',
      issues: [{
        issueCode: 'UNRESOLVED_ISSUES',
        type: 'compliance',
        severity: 'high',
        title: 'Unresolved Issues',
        description: `${openIssues.length} issue(s) still require resolution`,
      }],
      metadata: summary,
      tasks: [{
        taskCode: 'FINAL_DECISION',
        title: 'Final Underwriting Decision',
        description: 'Review all stages and make final approval/rejection decision',
        priority: 'high',
        assignedRoles: ['senior_underwriter', 'admin'],
      }],
      notes: `Final review: ${openIssues.length} unresolved issues require attention`,
    };
  }

  if (failedStages.length > 0) {
    return {
      status: 'failed',
      metadata: summary,
      notes: `Application rejected: ${failedStages.length} stage(s) failed`,
    };
  }

  return {
    status: 'passed',
    metadata: summary,
    notes: 'All stages passed - application approved',
  };
};

export function registerUnderwritingHandlers(engine: { registerHandler: (key: string, handler: StageHandler) => void }): void {
  engine.registerHandler('mcc_screening', mccScreeningHandler);
  engine.registerHandler('volume_threshold', volumeThresholdHandler);
  engine.registerHandler('internal_screening', internalScreeningHandler);
  engine.registerHandler('document_review', documentReviewHandler);
  engine.registerHandler('ofac_screening', ofacScreeningHandler);
  engine.registerHandler('match_pro', matchProScreeningHandler);
  engine.registerHandler('lexis_nexis', lexisNexisHandler);
  engine.registerHandler('trans_union', transUnionHandler);
  engine.registerHandler('open_corporates', openCorporatesHandler);
  engine.registerHandler('tin_check', tinCheckHandler);
  engine.registerHandler('g2_risk', g2RiskHandler);
  engine.registerHandler('google_kyb', googleKybHandler);
  engine.registerHandler('final_review', finalReviewHandler);
}
