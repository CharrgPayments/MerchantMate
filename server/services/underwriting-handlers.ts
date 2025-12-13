import type { StageHandler, StageHandlerContext, StageHandlerResult } from "./workflow-engine";
import type { MerchantProspect, ProspectOwner, StageApiConfig } from "@shared/schema";

// Helper function to safely parse JSON
function safeJsonParse<T>(value: unknown, defaultValue: T): T {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

// Helper to resolve a JSONPath-like expression against an object
function resolveJsonPath(obj: any, path: string): any {
  if (!path || !obj) return undefined;
  
  // Remove leading $. if present
  const cleanPath = path.startsWith('$.') ? path.substring(2) : path.startsWith('$') ? path.substring(1) : path;
  if (!cleanPath) return obj;
  
  const parts = cleanPath.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    
    // Handle array indexing like [0]
    const match = part.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      current = current[match[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(match[2], 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  
  return current;
}

// Helper to set a value at a JSONPath-like location in an object
function setJsonPath(obj: any, path: string, value: any): void {
  if (!path) return;
  
  const cleanPath = path.startsWith('$.') ? path.substring(2) : path.startsWith('$') ? path.substring(1) : path;
  const parts = cleanPath.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  
  current[parts[parts.length - 1]] = value;
}

// Build request body from entity data using request mapping
// Returns { body: any, isRawString: boolean } to handle template strings properly
function buildRequestBody(entityData: any, requestMapping: Record<string, string>, requestTemplate?: string): { body: any; isRawString: boolean } {
  if (requestTemplate) {
    // Use template with placeholder replacement
    let body = requestTemplate;
    for (const [targetField, sourcePath] of Object.entries(requestMapping)) {
      const value = resolveJsonPath(entityData, sourcePath);
      const placeholder = `{{${targetField}}}`;
      body = body.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), 
        value !== undefined ? String(value) : '');
    }
    try {
      // Try to parse as JSON
      return { body: JSON.parse(body), isRawString: false };
    } catch {
      // Keep as raw string for non-JSON templates (XML, form-urlencoded, etc.)
      return { body, isRawString: true };
    }
  }
  
  // Build object from mapping
  const result: any = {};
  for (const [targetField, sourcePath] of Object.entries(requestMapping)) {
    const value = resolveJsonPath(entityData, sourcePath);
    if (value !== undefined) {
      setJsonPath(result, targetField, value);
    }
  }
  return { body: result, isRawString: false };
}

// Parse response using response mapping
function parseResponse(response: any, responseMapping: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [resultField, sourcePath] of Object.entries(responseMapping)) {
    result[resultField] = resolveJsonPath(response, sourcePath);
  }
  return result;
}

interface RuleDefinition {
  condition: string;
  result: 'passed' | 'failed' | 'pending_review' | 'error';
  severity?: 'low' | 'medium' | 'high' | 'critical' | 'blocker';
  message?: string;
  issueCode?: string;
  issueType?: string;
}

// Evaluate a simple condition expression against parsed data
function evaluateCondition(condition: string, data: Record<string, any>): boolean {
  if (!condition || condition === 'true') return true;
  if (condition === 'false') return false;
  
  try {
    // Replace $.field references with actual values
    let evalExpr = condition;
    const pathMatches = condition.match(/\$\.[\w.[\]]+/g) || [];
    
    for (const pathExpr of pathMatches) {
      const value = resolveJsonPath(data, pathExpr);
      if (typeof value === 'string') {
        evalExpr = evalExpr.replace(pathExpr, `"${value.replace(/"/g, '\\"')}"`);
      } else if (value === null || value === undefined) {
        evalExpr = evalExpr.replace(pathExpr, 'null');
      } else if (typeof value === 'boolean') {
        evalExpr = evalExpr.replace(pathExpr, value.toString());
      } else if (typeof value === 'number') {
        evalExpr = evalExpr.replace(pathExpr, value.toString());
      } else {
        evalExpr = evalExpr.replace(pathExpr, JSON.stringify(value));
      }
    }
    
    // Safely evaluate the expression
    const safeEval = new Function('return ' + evalExpr);
    return Boolean(safeEval());
  } catch (e) {
    console.error('Failed to evaluate condition:', condition, e);
    return false;
  }
}

// Evaluate rules against parsed response data
function evaluateRules(parsedData: Record<string, any>, rules: RuleDefinition[]): {
  result: StageHandlerResult['status'];
  matchedRule?: RuleDefinition;
} {
  if (!rules || rules.length === 0) {
    return { result: 'passed' };
  }
  
  for (const rule of rules) {
    if (evaluateCondition(rule.condition, parsedData)) {
      return { result: rule.result, matchedRule: rule };
    }
  }
  
  // No rule matched, default to passed
  return { result: 'passed' };
}

// Get auth headers based on config
function getAuthHeaders(config: StageApiConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (!config.authType || config.authType === 'none') {
    return headers;
  }
  
  const secretValue = config.authSecretKey ? process.env[config.authSecretKey] : undefined;
  
  switch (config.authType) {
    case 'bearer':
      if (secretValue) {
        headers['Authorization'] = `Bearer ${secretValue}`;
      }
      break;
    case 'api_key':
      if (secretValue) {
        headers['X-API-Key'] = secretValue;
      }
      break;
    case 'basic':
      if (secretValue) {
        // Expect format: username:password
        const encoded = Buffer.from(secretValue).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      }
      break;
  }
  
  return headers;
}

// Make HTTP request with retry logic
async function makeApiRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: any,
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number,
  isRawBody: boolean = false
): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
  let lastError: string = '';
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      // Only set Content-Type to JSON if not already set and not a raw body
      const requestHeaders: Record<string, string> = { ...headers };
      if (!requestHeaders['Content-Type'] && !isRawBody) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };
      
      if (method !== 'GET' && method !== 'HEAD' && body) {
        // If raw body (from template), send as-is; otherwise JSON stringify
        fetchOptions.body = isRawBody ? body : JSON.stringify(body);
      }
      
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { rawResponse: responseText };
      }
      
      if (!response.ok) {
        if (attempt < maxRetries && response.status >= 500) {
          lastError = `HTTP ${response.status}: ${responseText}`;
          await new Promise(r => setTimeout(r, retryDelayMs));
          continue;
        }
        return { 
          success: false, 
          error: `HTTP ${response.status}: ${responseText}`,
          statusCode: response.status,
          data: responseData
        };
      }
      
      return { success: true, data: responseData, statusCode: response.status };
    } catch (e: any) {
      lastError = e.name === 'AbortError' ? 'Request timeout' : e.message;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
    }
  }
  
  return { success: false, error: lastError };
}

// Configurable API handler that reads config from database
export const configurableApiHandler: StageHandler = async (context: StageHandlerContext): Promise<StageHandlerResult> => {
  const { stage, storage, entityData, ticket } = context;
  
  // Get the API configuration for this stage
  const config = await storage.getStageApiConfig(stage.id);
  
  if (!config) {
    return {
      status: 'pending_review',
      issues: [{
        issueCode: 'API_CONFIG_NOT_FOUND',
        type: 'configuration',
        severity: 'low',
        title: 'API Configuration Not Found',
        description: `No API configuration defined for stage: ${stage.name}`,
      }],
      tasks: [{
        taskCode: 'CONFIGURE_API',
        title: 'Configure API Integration',
        description: `Set up API configuration for ${stage.name} in workflow settings`,
        priority: 'normal',
        assignedRoles: ['admin'],
      }],
      notes: 'Stage requires API configuration - manual review required',
    };
  }
  
  if (!config.isActive) {
    return {
      status: 'pending_review',
      notes: `API configuration for ${stage.name} is disabled`,
      metadata: { configId: config.id, reason: 'disabled' },
    };
  }
  
  // Fetch linked integration config if present
  let integrationConfig: any = null;
  if (config.integrationId) {
    integrationConfig = await storage.getApiIntegrationConfigById(config.integrationId);
  }
  
  // Test mode - return mock response
  if (config.testMode && config.mockResponse) {
    const mockData = safeJsonParse<any>(config.mockResponse, {});
    const responseMapping = safeJsonParse<Record<string, string>>(config.responseMapping, {});
    const rules = safeJsonParse<RuleDefinition[]>(config.rules, []);
    
    const parsedResponse = Object.keys(responseMapping).length > 0 
      ? parseResponse(mockData, responseMapping)
      : mockData;
    
    const { result, matchedRule } = evaluateRules(parsedResponse, rules);
    
    const handlerResult: StageHandlerResult = {
      status: result,
      metadata: {
        testMode: true,
        mockResponse: mockData,
        parsedResponse,
        matchedRule,
      },
      notes: matchedRule?.message || `Test mode: ${result}`,
    };
    
    if (result === 'failed' || result === 'pending_review') {
      handlerResult.issues = [{
        issueCode: matchedRule?.issueCode || `API_${result.toUpperCase()}`,
        type: matchedRule?.issueType || 'verification',
        severity: matchedRule?.severity || (result === 'failed' ? 'high' : 'medium'),
        title: matchedRule?.message || `API check returned ${result}`,
        description: `Test mode response evaluated to ${result}`,
      }];
    }
    
    return handlerResult;
  }
  
  // Compose the full endpoint URL from integration base URL + stage endpoint
  let fullEndpointUrl = config.endpointUrl || '';
  
  if (integrationConfig) {
    // Use sandbox URL in development/test, or if useSandbox is true
    const baseUrl = integrationConfig.useSandbox && integrationConfig.sandboxUrl 
      ? integrationConfig.sandboxUrl 
      : integrationConfig.baseUrl;
    
    if (baseUrl && fullEndpointUrl && !fullEndpointUrl.startsWith('http')) {
      // Endpoint is a path, append to base URL
      fullEndpointUrl = baseUrl.replace(/\/$/, '') + '/' + fullEndpointUrl.replace(/^\//, '');
    } else if (baseUrl && !fullEndpointUrl) {
      // No endpoint specified, use base URL
      fullEndpointUrl = baseUrl;
    }
  }
  
  if (!fullEndpointUrl) {
    return {
      status: 'error',
      issues: [{
        issueCode: 'MISSING_ENDPOINT',
        type: 'configuration',
        severity: 'critical',
        title: 'Missing API Endpoint',
        description: 'API configuration does not have an endpoint URL defined',
      }],
    };
  }
  
  const requestMapping = safeJsonParse<Record<string, string>>(config.requestMapping, {});
  const { body: requestBody, isRawString } = buildRequestBody(entityData, requestMapping, config.requestTemplate || undefined);
  
  // Merge headers: integration defaults < stage custom headers < auth headers
  const integrationHeaders = integrationConfig?.configuration?.headers || {};
  const customHeaders = safeJsonParse<Record<string, string>>(config.headers, {});
  const authHeaders = getAuthHeaders(config);
  const allHeaders = { ...integrationHeaders, ...customHeaders, ...authHeaders };
  
  const timeoutMs = (config.timeoutSeconds || 30) * 1000;
  const maxRetries = config.maxRetries || 3;
  const retryDelayMs = (config.retryDelaySeconds || 5) * 1000;
  
  // Make the API call
  const apiResult = await makeApiRequest(
    fullEndpointUrl,
    config.httpMethod || 'POST',
    allHeaders,
    requestBody,
    timeoutMs,
    maxRetries,
    retryDelayMs,
    isRawString
  );
  
  // Handle errors
  if (!apiResult.success) {
    const isTimeout = apiResult.error?.includes('timeout');
    const fallback = isTimeout 
      ? (config.fallbackOnTimeout || 'pending_review')
      : (config.fallbackOnError || 'pending_review');
    
    return {
      status: fallback as StageHandlerResult['status'],
      issues: [{
        issueCode: isTimeout ? 'API_TIMEOUT' : 'API_ERROR',
        type: 'verification',
        severity: fallback === 'failed' ? 'critical' : 'high',
        title: isTimeout ? 'API Request Timeout' : 'API Request Failed',
        description: apiResult.error || 'Unknown error',
      }],
      metadata: {
        error: apiResult.error,
        statusCode: apiResult.statusCode,
        endpoint: config.endpointUrl,
        fallbackApplied: fallback,
      },
      notes: `API call failed: ${apiResult.error}`,
    };
  }
  
  // Parse response
  const responseMapping = safeJsonParse<Record<string, string>>(config.responseMapping, {});
  const parsedResponse = Object.keys(responseMapping).length > 0
    ? parseResponse(apiResult.data, responseMapping)
    : apiResult.data;
  
  // Evaluate rules
  const rules = safeJsonParse<RuleDefinition[]>(config.rules, []);
  const { result, matchedRule } = evaluateRules(parsedResponse, rules);
  
  const handlerResult: StageHandlerResult = {
    status: result,
    metadata: {
      endpoint: config.endpointUrl,
      httpStatus: apiResult.statusCode,
      rawResponse: apiResult.data,
      parsedResponse,
      matchedRule,
    },
    notes: matchedRule?.message || `API check: ${result}`,
  };
  
  if (result === 'failed' || result === 'pending_review') {
    handlerResult.issues = [{
      issueCode: matchedRule?.issueCode || `API_${result.toUpperCase()}`,
      type: matchedRule?.issueType || 'verification',
      severity: matchedRule?.severity || (result === 'failed' ? 'high' : 'medium'),
      title: matchedRule?.message || `API check returned ${result}`,
      description: `Stage ${stage.name} API response evaluated to ${result}`,
      sourceData: parsedResponse,
    }];
  }
  
  return handlerResult;
};

// Create a configurable handler for a specific stage that falls back to placeholder behavior
export const createConfigurableHandler = (apiName: string): StageHandler => {
  return async (context: StageHandlerContext): Promise<StageHandlerResult> => {
    const { stage, storage } = context;
    
    // First check if there's a stage-specific API config
    const stageConfig = await storage.getStageApiConfig(stage.id);
    
    if (stageConfig && stageConfig.isActive) {
      // Use the configurable handler
      return configurableApiHandler(context);
    }
    
    // Fall back to checking the old API integration config
    const integrationKey = apiName.toLowerCase().replace(/\s+/g, '_');
    const config = await storage.getApiIntegrationConfig(integrationKey);
    
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

// Create handlers that use stage-specific configs when available, fall back to old placeholder behavior
export const ofacScreeningHandler = createConfigurableHandler('OFAC');
export const matchProScreeningHandler = createConfigurableHandler('MATCH Pro');
export const lexisNexisHandler = createConfigurableHandler('LexisNexis');
export const transUnionHandler = createConfigurableHandler('TransUnion');
export const openCorporatesHandler = createConfigurableHandler('OpenCorporates');
export const tinCheckHandler = createConfigurableHandler('TINCheck');
export const g2RiskHandler = createConfigurableHandler('G2 Risk');
export const googleKybHandler = createConfigurableHandler('Google KYB');

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
  // Core internal handlers
  engine.registerHandler('mcc_screening', mccScreeningHandler);
  engine.registerHandler('volume_threshold', volumeThresholdHandler);
  engine.registerHandler('internal_screening', internalScreeningHandler);
  engine.registerHandler('document_review', documentReviewHandler);
  
  // External API handlers (now configurable via stage_api_configs)
  engine.registerHandler('ofac_screening', ofacScreeningHandler);
  engine.registerHandler('match_pro', matchProScreeningHandler);
  engine.registerHandler('lexis_nexis', lexisNexisHandler);
  engine.registerHandler('trans_union', transUnionHandler);
  engine.registerHandler('open_corporates', openCorporatesHandler);
  engine.registerHandler('tin_check', tinCheckHandler);
  engine.registerHandler('g2_risk', g2RiskHandler);
  engine.registerHandler('google_kyb', googleKybHandler);
  
  // Generic configurable handler for custom API stages
  engine.registerHandler('configurable_api', configurableApiHandler);
  
  // Final review handler
  engine.registerHandler('final_review', finalReviewHandler);
}
