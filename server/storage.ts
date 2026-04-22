import { userPreferences, type UserPreference } from "@shared/schema";
import { merchants, agents, transactions, users, loginAttempts, twoFactorCodes, userDashboardPreferences, agentMerchants, locations, addresses, pdfForms, pdfFormFields, pdfFormSubmissions, merchantProspects, prospectOwners, prospectSignatures, feeGroups, feeItemGroups, feeItems, pricingTypes, pricingTypeFeeItems, campaigns, campaignFeeValues, campaignAssignments, campaignAssignmentRules, equipmentItems, campaignEquipment, apiKeys, apiRequestLogs, emailTemplates, emailActivity, emailTriggers, workflowDefinitions, workflowEnvironmentConfigs, externalEndpoints, type ExternalEndpoint, type InsertExternalEndpoint, type Merchant, type Agent, type Transaction, type User, type InsertMerchant, type InsertAgent, type InsertTransaction, type UpsertUser, type MerchantWithAgent, type TransactionWithMerchant, type LoginAttempt, type TwoFactorCode, type UserDashboardPreference, type InsertUserDashboardPreference, type AgentMerchant, type InsertAgentMerchant, type Location, type InsertLocation, type Address, type InsertAddress, type LocationWithAddresses, type MerchantWithLocations, type PdfForm, type InsertPdfForm, type PdfFormField, type InsertPdfFormField, type PdfFormSubmission, type InsertPdfFormSubmission, type PdfFormWithFields, type MerchantProspect, type InsertMerchantProspect, type MerchantProspectWithAgent, type ProspectOwner, type InsertProspectOwner, type ProspectSignature, type InsertProspectSignature, type FeeGroup, type InsertFeeGroup, type FeeItemGroup, type InsertFeeItemGroup, type FeeItem, type InsertFeeItem, type PricingType, type InsertPricingType, type PricingTypeFeeItem, type InsertPricingTypeFeeItem, type Campaign, type InsertCampaign, type CampaignFeeValue, type InsertCampaignFeeValue, type CampaignAssignment, type InsertCampaignAssignment, type CampaignAssignmentRule, type InsertCampaignAssignmentRule, type EquipmentItem, type InsertEquipmentItem, type CampaignEquipment, type InsertCampaignEquipment, type FeeGroupWithItems, type FeeItemGroupWithItems, type FeeGroupWithItemGroups, type PricingTypeWithFeeItems, type CampaignWithDetails, type ApiKey, type InsertApiKey, type ApiRequestLog, type InsertApiRequestLog, type EmailTemplate, type InsertEmailTemplate, type EmailActivity, type InsertEmailActivity, type EmailTrigger, type InsertEmailTrigger, type WorkflowDefinition, type InsertWorkflowDefinition, type WorkflowEnvironmentConfig, type InsertWorkflowEnvironmentConfig, type WorkflowDefinitionWithDetails } from "@shared/schema";
import { db } from "./db";
import { eq, or, and, gte, sql, desc, inArray, like, ilike, not, count, type SQL } from "drizzle-orm";
import { auditLogs, securityEvents } from "@shared/schema";

export interface IStorage {
  // Merchant operations
  getMerchant(id: number): Promise<Merchant | undefined>;
  getMerchantByEmail(email: string): Promise<Merchant | undefined>;
  getAllMerchants(): Promise<MerchantWithAgent[]>;
  createMerchant(merchant: InsertMerchant): Promise<Merchant>;
  createMerchantWithUser(merchantData: Omit<InsertMerchant, 'userId'>): Promise<{ merchant: Merchant; user: User; temporaryPassword: string }>;
  updateMerchant(id: number, merchant: Partial<InsertMerchant>): Promise<Merchant | undefined>;
  deleteMerchant(id: number): Promise<boolean>;
  searchMerchants(query: string): Promise<MerchantWithAgent[]>;
  getMerchantUser(merchantId: number): Promise<User | undefined>;

  // Agent operations
  getAgent(id: number): Promise<Agent | undefined>;
  getAgentByEmail(email: string): Promise<Agent | undefined>;
  getAllAgents(): Promise<Agent[]>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  createAgentWithUser(agentData: Omit<InsertAgent, 'userId'>): Promise<{ agent: Agent; user: User; temporaryPassword: string }>;
  updateAgent(id: number, agent: Partial<InsertAgent>): Promise<Agent | undefined>;
  deleteAgent(id: number): Promise<boolean>;
  searchAgents(query: string): Promise<Agent[]>;
  getAgentUser(agentId: number): Promise<User | undefined>;
  getAgentMerchants(agentId: number): Promise<MerchantWithAgent[]>;

  // Merchant Prospect operations
  getMerchantProspect(id: number): Promise<MerchantProspect | undefined>;
  getMerchantProspectByEmail(email: string): Promise<MerchantProspect | undefined>;
  getMerchantProspectByToken(token: string): Promise<MerchantProspect | undefined>;
  getAllMerchantProspects(): Promise<MerchantProspectWithAgent[]>;
  getProspectsByAgent(agentId: number): Promise<MerchantProspectWithAgent[]>;
  createMerchantProspect(prospect: InsertMerchantProspect): Promise<MerchantProspect>;
  updateMerchantProspect(id: number, updates: Partial<MerchantProspect>): Promise<MerchantProspect | undefined>;
  deleteMerchantProspect(id: number): Promise<boolean>;
  searchMerchantProspects(query: string): Promise<MerchantProspectWithAgent[]>;

  // Transaction operations
  getTransaction(id: number): Promise<Transaction | undefined>;
  getTransactionByTransactionId(transactionId: string): Promise<Transaction | undefined>;
  getAllTransactions(): Promise<TransactionWithMerchant[]>;
  getTransactionsByMerchant(merchantId: number): Promise<TransactionWithMerchant[]>;
  getTransactionsByMID(mid: string): Promise<TransactionWithMerchant[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction | undefined>;
  searchTransactions(query: string): Promise<TransactionWithMerchant[]>;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByUsernameOrEmail(username: string, email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  getUserByEmailVerificationToken(token: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: Partial<UpsertUser>): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<UpsertUser>): Promise<User | undefined>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserRoles(id: string, roles: string[]): Promise<User | undefined>;
  updateUserStatus(id: string, status: string): Promise<User | undefined>;
  updateUserPermissions(id: string, permissions: Record<string, boolean>): Promise<User | undefined>;
  resetUserPassword(id: string): Promise<{ user: User; temporaryPassword: string }>;
  setPasswordResetToken(id: string, token: string, expiresAt: Date): Promise<User | undefined>;
  clearPasswordResetToken(id: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  
  // Role-based data access
  getMerchantsForUser(userId: string): Promise<MerchantWithAgent[]>;

  // Authentication operations
  createLoginAttempt(attempt: {
    username?: string | null;
    email?: string | null;
    ipAddress: string;
    userAgent: string;
    success: boolean;
    failureReason?: string;
  }): Promise<void>;
  getRecentLoginAttempts(usernameOrEmail: string, ip: string, timeWindow: number): Promise<any[]>;
  create2FACode(code: {
    userId: string;
    code: string;
    type: string;
    expiresAt: Date;
  }): Promise<void>;
  verify2FACode(userId: string, code: string): Promise<boolean>;

  // Analytics
  getDashboardMetrics(): Promise<{
    totalRevenue: string;
    activeMerchants: number;
    transactionsToday: number;
    activeAgents: number;
  }>;
  getTopMerchants(): Promise<(Merchant & { transactionCount: number; totalVolume: string })[]>;
  getRecentTransactions(limit?: number): Promise<TransactionWithMerchant[]>;

  // PDF Form operations
  getPdfForm(id: number): Promise<PdfForm | undefined>;
  getPdfFormWithFields(id: number): Promise<PdfFormWithFields | undefined>;
  getAllPdfForms(userId?: string): Promise<PdfForm[]>;
  createPdfForm(form: InsertPdfForm): Promise<PdfForm>;
  updatePdfForm(id: number, updates: Partial<InsertPdfForm>): Promise<PdfForm | undefined>;
  deletePdfForm(id: number): Promise<boolean>;
  
  // PDF Form Field operations
  createPdfFormField(field: InsertPdfFormField): Promise<PdfFormField>;
  updatePdfFormField(id: number, updates: Partial<InsertPdfFormField>): Promise<PdfFormField | undefined>;
  deletePdfFormField(id: number): Promise<boolean>;
  getPdfFormFields(formId: number): Promise<PdfFormField[]>;
  
  // PDF Form Submission operations
  createPdfFormSubmission(submission: InsertPdfFormSubmission): Promise<PdfFormSubmission>;
  getPdfFormSubmissions(formId: number): Promise<PdfFormSubmission[]>;
  getPdfFormSubmission(id: number): Promise<PdfFormSubmission | undefined>;
  getPdfFormSubmissionByToken(token: string): Promise<PdfFormSubmission | undefined>;
  updatePdfFormSubmissionByToken(token: string, updates: Partial<InsertPdfFormSubmission>): Promise<PdfFormSubmission | undefined>;
  generateSubmissionToken(): string; // Non-async method

  // Prospect Owner operations
  createProspectOwner(owner: InsertProspectOwner): Promise<ProspectOwner>;
  getProspectOwners(prospectId: number): Promise<ProspectOwner[]>;
  getProspectOwnerByToken(token: string): Promise<ProspectOwner | undefined>;
  updateProspectOwner(id: number, updates: Partial<ProspectOwner>): Promise<ProspectOwner | undefined>;
  deleteProspectOwners(prospectId: number): Promise<boolean>;

  // Prospect Signature operations
  createProspectSignature(signature: InsertProspectSignature): Promise<ProspectSignature>;
  getProspectSignature(token: string): Promise<ProspectSignature | undefined>;
  getProspectSignaturesByOwnerEmail(email: string): Promise<ProspectSignature[]>;
  getProspectSignaturesByProspect(prospectId: number): Promise<ProspectSignature[]>;
  getProspectOwnerBySignatureToken(token: string): Promise<ProspectOwner | undefined>;
  getProspectOwnerByEmailAndProspectId(email: string, prospectId: number): Promise<ProspectOwner | undefined>;

  // Email Management operations
  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(id: number): Promise<EmailTemplate | undefined>;
  getEmailTemplateByName(name: string): Promise<EmailTemplate | undefined>;
  createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;
  updateEmailTemplate(id: number, updates: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined>;
  deleteEmailTemplate(id: number): Promise<boolean>;
  
  getAllEmailTriggers(): Promise<EmailTrigger[]>;
  getEmailTrigger(id: number): Promise<EmailTrigger | undefined>;
  createEmailTrigger(trigger: InsertEmailTrigger): Promise<EmailTrigger>;
  updateEmailTrigger(id: number, updates: Partial<InsertEmailTrigger>): Promise<EmailTrigger | undefined>;
  deleteEmailTrigger(id: number): Promise<boolean>;
  
  logEmailActivity(activity: InsertEmailActivity): Promise<EmailActivity>;
  getEmailActivity(limit?: number, filters?: { status?: string; templateId?: number; recipientEmail?: string }): Promise<EmailActivity[]>;
  getEmailActivityStats(): Promise<{
    totalSent: number;
    totalOpened: number;
    totalClicked: number;
    totalFailed: number;
    openRate: number;
    clickRate: number;
  }>;

  // Admin operations
  clearAllProspectData(): Promise<void>;
  
  // Campaign operations
  getAllCampaigns(): Promise<Campaign[]>;
  createCampaign(campaign: InsertCampaign, feeValues: any[], equipmentIds: number[]): Promise<Campaign>;
  getCampaignFeeValues(campaignId: number): Promise<any[]>;
  getCampaignEquipment(campaignId: number): Promise<any[]>;
  
  // API Key operations
  getAllApiKeys(): Promise<ApiKey[]>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  updateApiKey(id: number, updates: Partial<InsertApiKey>): Promise<ApiKey | undefined>;
  deleteApiKey(id: number): Promise<boolean>;
  getApiUsageStats(): Promise<any>;
  getApiRequestLogs(): Promise<ApiRequestLog[]>;
  
  // Security & Audit operations
  getAuditLogs(limit?: number): Promise<any[]>;
  getAllAuditLogs(): Promise<any[]>;
  getSecurityEvents(limit?: number): Promise<any[]>;
  getSecurityMetrics(): Promise<{
    totalLoginAttempts: number;
    successfulLogins: number;
    failedLogins: number;
    uniqueIPs: number;
    recentFailedAttempts: number;
  }>;
  
  // Testing utilities
  resetTestingData(options?: {
    prospects?: boolean;
    campaigns?: boolean;
    equipment?: boolean;
    signatures?: boolean;
    formData?: boolean;
  }): Promise<{
    cleared: string[];
    counts: Record<string, number>;
  }>;

  // Agent-Merchant associations
  getAgentMerchants(agentId: number): Promise<MerchantWithAgent[]>;
  getMerchantAgents(merchantId: number): Promise<Agent[]>;
  assignAgentToMerchant(agentId: number, merchantId: number, assignedBy: string): Promise<AgentMerchant>;
  unassignAgentFromMerchant(agentId: number, merchantId: number): Promise<boolean>;
  getMerchantsForUser(userId: string): Promise<MerchantWithAgent[]>;
  getTransactionsForUser(userId: string): Promise<TransactionWithMerchant[]>;

  // Location operations
  getLocation(id: number): Promise<Location | undefined>;
  getLocationsByMerchant(merchantId: number): Promise<LocationWithAddresses[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, updates: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: number): Promise<boolean>;

  // Address operations
  getAddress(id: number): Promise<Address | undefined>;
  getAddressesByLocation(locationId: number): Promise<Address[]>;
  createAddress(address: InsertAddress): Promise<Address>;
  updateAddress(id: number, updates: Partial<InsertAddress>): Promise<Address | undefined>;
  deleteAddress(id: number): Promise<boolean>;

  // Widget preferences
  getUserWidgetPreferences(userId: string): Promise<UserDashboardPreference[]>;
  createWidgetPreference(preference: InsertUserDashboardPreference): Promise<UserDashboardPreference>;
  updateWidgetPreference(id: number, updates: Partial<InsertUserDashboardPreference>): Promise<UserDashboardPreference | undefined>;
  deleteWidgetPreference(id: number): Promise<boolean>;

  // Generic per-user key/value preferences
  getUserPreference(userId: string, key: string): Promise<unknown | undefined>;
  setUserPreference(userId: string, key: string, value: unknown): Promise<void>;
  deleteUserPreference(userId: string, key: string): Promise<boolean>;

  // Location revenue metrics
  getLocationRevenue(locationId: number): Promise<{
    totalRevenue: string;
    last24Hours: string;
    monthToDate: string;
    yearToDate: string;
  }>;
  
  // Bulk location revenue for multiple locations
  getMultipleLocationRevenue(locationIds: number[]): Promise<Record<number, {
    totalRevenue: string;
    last24Hours: string;
    monthToDate: string;
    yearToDate: string;
  }>>;

  // Dashboard analytics methods
  getDashboardRevenue(timeRange: string): Promise<{
    current: string;
    daily: string;
    weekly: string;
    monthly: string;
    change?: number;
  }>;
  getTopLocations(limit: number, sortBy: string): Promise<any[]>;
  getRecentActivity(): Promise<any[]>;
  getAssignedMerchants(limit: number): Promise<any[]>;
  getSystemOverview(): Promise<{
    uptime: string;
    activeUsers: number;
    alerts?: any[];
  }>;

  // Merchant Prospect operations
  getMerchantProspect(id: number): Promise<MerchantProspect | undefined>;
  getMerchantProspectByEmail(email: string): Promise<MerchantProspect | undefined>;
  getMerchantProspectByToken(token: string): Promise<MerchantProspect | undefined>;
  getAllMerchantProspects(): Promise<MerchantProspectWithAgent[]>;
  getProspectsByAgent(agentId: number): Promise<MerchantProspectWithAgent[]>;
  createMerchantProspect(prospect: InsertMerchantProspect): Promise<MerchantProspect>;
  updateMerchantProspect(id: number, updates: Partial<MerchantProspect>): Promise<MerchantProspect | undefined>;
  deleteMerchantProspect(id: number): Promise<boolean>;
  searchMerchantProspects(query: string): Promise<MerchantProspectWithAgent[]>;

  // Campaign Management operations
  // Fee Groups
  getAllFeeGroups(): Promise<FeeGroupWithItems[]>;
  getFeeGroup(id: number): Promise<FeeGroup | undefined>;
  getFeeGroupWithItemGroups(id: number): Promise<FeeGroupWithItemGroups | undefined>;
  createFeeGroup(feeGroup: InsertFeeGroup): Promise<FeeGroup>;
  updateFeeGroup(id: number, updates: Partial<InsertFeeGroup>): Promise<FeeGroup | undefined>;
  
  // Fee Item Groups
  getAllFeeItemGroups(): Promise<FeeItemGroup[]>;
  getFeeItemGroup(id: number): Promise<FeeItemGroup | undefined>;
  getFeeItemGroupsByFeeGroup(feeGroupId: number): Promise<FeeItemGroup[]>;
  getFeeItemGroupWithItems(id: number): Promise<FeeItemGroupWithItems | undefined>;
  createFeeItemGroup(feeItemGroup: InsertFeeItemGroup): Promise<FeeItemGroup>;
  updateFeeItemGroup(id: number, updates: Partial<InsertFeeItemGroup>): Promise<FeeItemGroup | undefined>;
  deleteFeeItemGroup(id: number): Promise<boolean>;
  
  // Fee Items
  getAllFeeItems(): Promise<FeeItem[]>;
  getFeeItem(id: number): Promise<FeeItem | undefined>;
  getFeeItemsByGroup(feeGroupId: number): Promise<FeeItem[]>;
  createFeeItem(feeItem: InsertFeeItem): Promise<FeeItem>;
  updateFeeItem(id: number, updates: Partial<InsertFeeItem>): Promise<FeeItem | undefined>;
  searchFeeItems(query: string): Promise<FeeItem[]>;
  
  // Pricing Types
  getAllPricingTypes(): Promise<PricingType[]>;
  getPricingType(id: number): Promise<PricingType | undefined>;
  getPricingTypeWithFeeItems(id: number): Promise<PricingTypeWithFeeItems | undefined>;
  createPricingType(pricingType: InsertPricingType): Promise<PricingType>;
  updatePricingType(id: number, updates: Partial<InsertPricingType>): Promise<PricingType | undefined>;
  addFeeItemToPricingType(pricingTypeId: number, feeItemId: number, isRequired?: boolean): Promise<PricingTypeFeeItem>;
  removeFeeItemFromPricingType(pricingTypeId: number, feeItemId: number): Promise<boolean>;
  searchPricingTypes(query: string): Promise<PricingType[]>;
  
  // Campaigns
  getAllCampaigns(): Promise<CampaignWithDetails[]>;
  getCampaign(id: number): Promise<Campaign | undefined>;
  getCampaignWithDetails(id: number): Promise<CampaignWithDetails | undefined>;
  getCampaignsByAcquirer(acquirer: string): Promise<CampaignWithDetails[]>;
  createCampaign(campaign: InsertCampaign, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[]): Promise<Campaign>;
  updateCampaign(id: number, updates: Partial<InsertCampaign>, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[]): Promise<Campaign | undefined>;
  deactivateCampaign(id: number): Promise<boolean>;
  searchCampaigns(query: string): Promise<CampaignWithDetails[]>;
  
  // Campaign Fee Values
  setCampaignFeeValue(campaignId: number, feeItemId: number, value: string): Promise<CampaignFeeValue>;
  getCampaignFeeValues(campaignId: number): Promise<CampaignFeeValue[]>;
  updateCampaignFeeValue(id: number, value: string): Promise<CampaignFeeValue | undefined>;
  
  // Campaign Assignments
  assignCampaignToProspect(campaignId: number, prospectId: number, assignedBy: string): Promise<CampaignAssignment>;
  getCampaignAssignments(campaignId: number): Promise<CampaignAssignment[]>;
  getProspectCampaignAssignment(prospectId: number): Promise<CampaignAssignment | undefined>;
  swapCampaignForProspect(prospectId: number, campaignId: number, assignedBy: string): Promise<CampaignAssignment>;
  getProspectsForCampaign(campaignId: number): Promise<MerchantProspect[]>;

  // Campaign Assignment Rules
  getCampaignAssignmentRules(): Promise<CampaignAssignmentRule[]>;
  createCampaignAssignmentRule(rule: InsertCampaignAssignmentRule): Promise<CampaignAssignmentRule>;
  updateCampaignAssignmentRule(id: number, updates: Partial<InsertCampaignAssignmentRule>): Promise<CampaignAssignmentRule | undefined>;
  deleteCampaignAssignmentRule(id: number): Promise<boolean>;
  findCampaignByRule(ctx: { mcc?: string | null; acquirerId?: number | null; agentId?: number | null }): Promise<number | undefined>;

  // Equipment Items
  getAllEquipmentItems(): Promise<EquipmentItem[]>;
  getEquipmentItem(id: number): Promise<EquipmentItem | undefined>;
  createEquipmentItem(equipmentItem: InsertEquipmentItem): Promise<EquipmentItem>;
  updateEquipmentItem(id: number, updates: Partial<InsertEquipmentItem>): Promise<EquipmentItem | undefined>;
  deleteEquipmentItem(id: number): Promise<boolean>;

  // Campaign Equipment
  getCampaignEquipment(campaignId: number): Promise<(CampaignEquipment & { equipmentItem: EquipmentItem })[]>;
  addEquipmentToCampaign(campaignId: number, equipmentItemId: number, isRequired?: boolean, displayOrder?: number): Promise<CampaignEquipment>;
  removeEquipmentFromCampaign(campaignId: number, equipmentItemId: number): Promise<boolean>;
  updateCampaignEquipment(campaignId: number, equipmentItemId: number, updates: Partial<InsertCampaignEquipment>): Promise<CampaignEquipment | undefined>;

  // API Key operations
  getAllApiKeys(): Promise<ApiKey[]>;
  getApiKey(id: number): Promise<ApiKey | undefined>;
  getApiKeyByKeyId(keyId: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  updateApiKey(id: number, updates: Partial<InsertApiKey>): Promise<ApiKey | undefined>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  deleteApiKey(id: number): Promise<boolean>;
  
  // API Request Log operations
  createApiRequestLog(log: InsertApiRequestLog): Promise<ApiRequestLog>;
  getApiRequestLogs(apiKeyId?: number, limit?: number): Promise<ApiRequestLog[]>;
  getApiUsageStats(apiKeyId: number, timeRange: string): Promise<{
    totalRequests: number;
    successfulRequests: number;
    errorRequests: number;
    averageResponseTime: number;
  }>;

  // Workflow Definitions
  getAllWorkflowDefinitions(): Promise<WorkflowDefinition[]>;
  getWorkflowDefinition(id: number): Promise<WorkflowDefinitionWithDetails | undefined>;
  createWorkflowDefinition(data: InsertWorkflowDefinition): Promise<WorkflowDefinition>;
  updateWorkflowDefinition(id: number, data: Partial<InsertWorkflowDefinition>): Promise<WorkflowDefinition | undefined>;
  deleteWorkflowDefinition(id: number): Promise<boolean>;
  // Workflow Environment Configs
  getWorkflowEnvironmentConfigs(workflowId: number): Promise<WorkflowEnvironmentConfig[]>;
  upsertWorkflowEnvironmentConfig(workflowId: number, environment: string, config: any): Promise<WorkflowEnvironmentConfig>;
  deleteWorkflowEnvironmentConfig(workflowId: number, environment: string): Promise<void>;

  // External Endpoints Registry (transport-only)
  listExternalEndpoints(filters?: { search?: string; isActive?: boolean }): Promise<ExternalEndpoint[]>;
  getExternalEndpoint(id: number): Promise<ExternalEndpoint | undefined>;
  getExternalEndpointByName(name: string): Promise<ExternalEndpoint | undefined>;
  createExternalEndpoint(data: InsertExternalEndpoint): Promise<ExternalEndpoint>;
  updateExternalEndpoint(id: number, data: Partial<InsertExternalEndpoint>): Promise<ExternalEndpoint | undefined>;
  deleteExternalEndpoint(id: number): Promise<boolean>;
}

// Extended user input type that accepts legacy `role` string alongside new `roles` array
type UserInputWithLegacyRole = Partial<UpsertUser> & { role?: string };

// Normalize a legacy `role` string to a `roles` array, returning a clean UpsertUser-shaped object
function normalizeLegacyRole(input: UserInputWithLegacyRole): Partial<UpsertUser> {
  const { role, ...rest } = input;
  if (role !== undefined && rest.roles === undefined) {
    return { ...rest, roles: [role] };
  }
  return rest as Partial<UpsertUser>;
}

// Row shapes returned by the raw `jsonb_agg` queries used in the fee-group
// read paths below. Drizzle has no first-class builder for nested JSON
// aggregation, so we type the resulting row shape explicitly here so the
// mapper code stays type-checked end-to-end (no `as any`).
type FeeGroupRow = {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  author: string;
  created_at: string | Date;
  updated_at: string | Date;
};
type FeeItemRow = {
  id: number;
  name: string;
  description: string | null;
  value_type: string;
  default_value: string | null;
  additional_info: string | null;
  display_order: number;
  is_active: boolean;
  author: string;
  created_at: string | Date;
  updated_at: string | Date;
  fee_group_id: number | null;
  fee_item_group_id: number | null;
};
type FeeGroupRowWithItems = FeeGroupRow & { fee_items: FeeItemRow[] };
type FeeItemGroupRowWithItems = {
  id: number;
  fee_group_id: number;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  author: string;
  created_at: string | Date;
  updated_at: string | Date;
  fee_items: FeeItemRow[];
};
type FeeGroupWithItemGroupsRow = FeeGroupRow & {
  fee_item_groups: FeeItemGroupRowWithItems[];
  direct_items: FeeItemRow[];
};

// db.execute() may return either `{ rows: T[] }` (pg) or a plain `T[]`
// (neon-http). This helper narrows both shapes to a typed row array
// without leaking `any` into call sites.
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export class DatabaseStorage implements IStorage {
  // Add backward-compat `role` field from `roles` array
  private withRole<T extends { roles?: string[] | null }>(user: T): T & { role?: string } {
    return { ...user, role: user.roles?.[0] ?? "merchant" };
  }
  private withRoles<T extends { roles?: string[] | null }>(userList: T[]): (T & { role?: string })[] {
    return userList.map(u => this.withRole(u));
  }

  // Fee Groups implementation
  async getAllFeeGroups(): Promise<FeeGroupWithItems[]> {
    // Single grouped round-trip: LEFT JOIN fee_items onto fee_groups and
    // aggregate the items into a JSON array per group. Items appear in
    // each group's array ordered by display_order. Empty groups still
    // come back with an empty array (COALESCE on the aggregate).
    // db-tier-allow: PostgreSQL `jsonb_agg` correlated subquery — Drizzle
    // has no first-class builder for nested JSON aggregation.
    const result = await db.execute<FeeGroupRowWithItems>(sql`
      SELECT
        fg.*,
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(fi.*) ORDER BY fi.display_order)
            FROM ${feeItems} fi
            WHERE fi.fee_group_id = fg.id
          ),
          '[]'::jsonb
        ) AS fee_items
      FROM ${feeGroups} fg
      ORDER BY fg.display_order
    `);

    const list = extractRows<FeeGroupRowWithItems>(result);
    return list.map((r) => {
      const { fee_items, ...rest } = r;
      const group = this.snakeToCamelFeeGroup(rest);
      const items = fee_items.map((it) => this.snakeToCamelFeeItem(it));
      return { ...group, feeItems: items };
    });
  }

  // Map a snake_cased DB row into a camelCased FeeGroup-shaped object.
  private snakeToCamelFeeGroup(row: FeeGroupRow): FeeGroup {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      displayOrder: row.display_order,
      isActive: row.is_active,
      author: row.author,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // Map a snake_cased DB row into a camelCased FeeItem-shaped object.
  private snakeToCamelFeeItem(row: FeeItemRow): FeeItem {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      valueType: row.value_type,
      defaultValue: row.default_value,
      additionalInfo: row.additional_info,
      displayOrder: row.display_order,
      isActive: row.is_active,
      author: row.author,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      feeGroupId: row.fee_group_id ?? null,
      feeItemGroupId: row.fee_item_group_id ?? null,
    };
  }

  async getFeeGroup(id: number): Promise<FeeGroup | undefined> {
    const [feeGroup] = await db.select().from(feeGroups).where(eq(feeGroups.id, id));
    return feeGroup || undefined;
  }

  async getFeeGroupWithItemGroups(id: number): Promise<FeeGroupWithItemGroups | undefined> {
    // Single grouped round-trip: pull the fee group with two pre-aggregated
    // JSON arrays — one for nested item groups (each carrying its own items),
    // and one for direct items (fee_group_id = id, no item-group association).
    // Preserves prior semantics where item-group items are matched purely
    // by fee_item_group_id (independent of fee_group_id).
    // db-tier-allow: PostgreSQL nested `jsonb_agg` + `jsonb_build_object`
    // — Drizzle has no first-class builder for this shape of nested JSON
    // aggregation; using it here collapses three round-trips into one.
    const rows = await db.execute(sql`
      SELECT
        fg.*,
        COALESCE(
          (
            SELECT jsonb_agg(grp ORDER BY (grp->>'display_order')::int)
            FROM (
              SELECT to_jsonb(fig.*) || jsonb_build_object(
                'fee_items',
                COALESCE(
                  (
                    SELECT jsonb_agg(to_jsonb(fi.*) ORDER BY fi.display_order)
                    FROM ${feeItems} fi
                    WHERE fi.fee_item_group_id = fig.id
                  ),
                  '[]'::jsonb
                )
              ) AS grp
              FROM ${feeItemGroups} fig
              WHERE fig.fee_group_id = fg.id
            ) sub
          ),
          '[]'::jsonb
        ) AS fee_item_groups,
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(fi.*) ORDER BY fi.display_order)
            FROM ${feeItems} fi
            WHERE fi.fee_group_id = fg.id AND fi.fee_item_group_id IS NULL
          ),
          '[]'::jsonb
        ) AS direct_items
      FROM ${feeGroups} fg
      WHERE fg.id = ${id}
      LIMIT 1
    `);

    const list = extractRows<FeeGroupWithItemGroupsRow>(rows);
    const r = list[0];
    if (!r) return undefined;

    const { fee_item_groups, direct_items, ...rest } = r;
    const group = this.snakeToCamelFeeGroup(rest);
    const feeItemGroupsWithItems: FeeItemGroupWithItems[] = fee_item_groups.map((g) => {
      const items = g.fee_items.map((it) => this.snakeToCamelFeeItem(it));
      return {
        id: g.id,
        feeGroupId: g.fee_group_id,
        name: g.name,
        description: g.description,
        displayOrder: g.display_order,
        isActive: g.is_active,
        author: g.author,
        createdAt: new Date(g.created_at),
        updatedAt: new Date(g.updated_at),
        feeItems: items,
      };
    });
    const directItems = direct_items.map((it) => this.snakeToCamelFeeItem(it));
    return { ...group, feeItemGroups: feeItemGroupsWithItems, feeItems: directItems };
  }

  async createFeeGroup(feeGroup: InsertFeeGroup): Promise<FeeGroup> {
    const [created] = await db.insert(feeGroups).values(feeGroup).returning();
    return created;
  }

  async updateFeeGroup(id: number, updates: Partial<InsertFeeGroup>): Promise<FeeGroup | undefined> {
    const [updated] = await db.update(feeGroups).set(updates).where(eq(feeGroups.id, id)).returning();
    return updated || undefined;
  }

  // Fee Item Groups implementation
  async getAllFeeItemGroups(): Promise<FeeItemGroup[]> {
    return await db.select().from(feeItemGroups).orderBy(feeItemGroups.displayOrder);
  }

  async getFeeItemGroup(id: number): Promise<FeeItemGroup | undefined> {
    const [feeItemGroup] = await db.select().from(feeItemGroups).where(eq(feeItemGroups.id, id));
    return feeItemGroup || undefined;
  }

  async getFeeItemGroupsByFeeGroup(feeGroupId: number): Promise<FeeItemGroup[]> {
    return await db.select().from(feeItemGroups)
      .where(eq(feeItemGroups.feeGroupId, feeGroupId))
      .orderBy(feeItemGroups.displayOrder);
  }

  async getFeeItemGroupWithItems(id: number): Promise<FeeItemGroupWithItems | undefined> {
    const [feeItemGroup] = await db.select().from(feeItemGroups).where(eq(feeItemGroups.id, id));
    if (!feeItemGroup) return undefined;

    const items = await db.select().from(feeItems)
      .where(eq(feeItems.feeItemGroupId, id))
      .orderBy(feeItems.displayOrder);

    return {
      ...feeItemGroup,
      feeItems: items
    };
  }

  async createFeeItemGroup(feeItemGroup: InsertFeeItemGroup): Promise<FeeItemGroup> {
    const [created] = await db.insert(feeItemGroups).values(feeItemGroup).returning();
    return created;
  }

  async updateFeeItemGroup(id: number, updates: Partial<InsertFeeItemGroup>): Promise<FeeItemGroup | undefined> {
    const [updated] = await db.update(feeItemGroups).set(updates).where(eq(feeItemGroups.id, id)).returning();
    return updated || undefined;
  }

  async deleteFeeItemGroup(id: number): Promise<boolean> {
    const result = await db.delete(feeItemGroups).where(eq(feeItemGroups.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Fee Items implementation
  async getAllFeeItems(): Promise<(FeeItem & { feeGroup: FeeGroup })[]> {
    const result = await db.select({
      feeItem: feeItems,
      feeGroup: feeGroups
    }).from(feeItems)
    .leftJoin(feeGroups, eq(feeItems.feeGroupId, feeGroups.id))
    .orderBy(feeItems.displayOrder);

    return result.map(row => ({
      ...row.feeItem,
      feeGroup: row.feeGroup!
    }));
  }

  async getFeeItem(id: number): Promise<FeeItem | undefined> {
    const [feeItem] = await db.select().from(feeItems).where(eq(feeItems.id, id));
    return feeItem || undefined;
  }

  async getFeeItemsByGroup(feeGroupId: number): Promise<FeeItem[]> {
    return await db.select().from(feeItems).where(eq(feeItems.feeGroupId, feeGroupId)).orderBy(feeItems.displayOrder);
  }

  async createFeeItem(feeItem: InsertFeeItem): Promise<FeeItem> {
    const [created] = await db.insert(feeItems).values(feeItem).returning();
    return created;
  }

  async updateFeeItem(id: number, updates: Partial<InsertFeeItem>): Promise<FeeItem | undefined> {
    const [updated] = await db.update(feeItems).set(updates).where(eq(feeItems.id, id)).returning();
    return updated || undefined;
  }

  async searchFeeItems(query: string): Promise<FeeItem[]> {
    return await db.select().from(feeItems).where(
      or(
        ilike(feeItems.name, `%${query}%`),
        ilike(feeItems.description, `%${query}%`)
      )
    ).orderBy(feeItems.displayOrder);
  }

  // Pricing Types implementation
  async getAllPricingTypes(): Promise<PricingType[]> {
    return await db.select().from(pricingTypes).orderBy(pricingTypes.name);
  }

  async getPricingType(id: number): Promise<PricingType | undefined> {
    const [pricingType] = await db.select().from(pricingTypes).where(eq(pricingTypes.id, id));
    return pricingType || undefined;
  }

  async getPricingTypeWithFeeItems(id: number): Promise<PricingTypeWithFeeItems | undefined> {
    console.log('Fetching pricing type with fee items for ID:', id);
    
    const result = await db
      .select({
        pricingType: pricingTypes,
        pricingTypeFeeItem: pricingTypeFeeItems,
        feeItem: feeItems,
        feeGroup: feeGroups,
      })
      .from(pricingTypes)
      .leftJoin(pricingTypeFeeItems, eq(pricingTypes.id, pricingTypeFeeItems.pricingTypeId))
      .leftJoin(feeItems, eq(pricingTypeFeeItems.feeItemId, feeItems.id))
      .leftJoin(feeGroups, eq(feeItems.feeGroupId, feeGroups.id))
      .where(eq(pricingTypes.id, id));

    console.log('Raw query result:', result);

    if (result.length === 0) return undefined;

    const pricingType = result[0].pricingType;
    const associatedFeeItems = result
      .filter(row => row.feeItem)
      .map(row => ({
        ...row.pricingTypeFeeItem!,
        feeItem: {
          ...row.feeItem!,
          feeGroup: row.feeGroup!,
        },
      }));

    console.log('Filtered fee items:', associatedFeeItems);

    const resultToReturn = {
      ...pricingType,
      feeItems: associatedFeeItems,
    };
    
    console.log('Final result:', resultToReturn);
    
    return resultToReturn;
  }

  async createPricingType(pricingType: InsertPricingType): Promise<PricingType> {
    const [created] = await db.insert(pricingTypes).values(pricingType).returning();
    return created;
  }

  async addFeeItemToPricingType(pricingTypeId: number, feeItemId: number, isRequired: boolean = false): Promise<PricingTypeFeeItem> {
    const [created] = await db.insert(pricingTypeFeeItems).values({
      pricingTypeId,
      feeItemId,
      isRequired,
      displayOrder: 1,
    }).returning();
    return created;
  }

  async removeFeeItemFromPricingType(pricingTypeId: number, feeItemId: number): Promise<boolean> {
    const result = await db.delete(pricingTypeFeeItems)
      .where(and(
        eq(pricingTypeFeeItems.pricingTypeId, pricingTypeId),
        eq(pricingTypeFeeItems.feeItemId, feeItemId)
      ));
    return result.rowCount > 0;
  }

  async searchPricingTypes(query: string): Promise<PricingType[]> {
    return await db.select().from(pricingTypes).where(
      or(
        ilike(pricingTypes.name, `%${query}%`),
        ilike(pricingTypes.description, `%${query}%`)
      )
    ).orderBy(pricingTypes.name);
  }

  async deletePricingType(id: number): Promise<{ success: boolean; message: string }> {
    // First check if pricing type has any associated fee items
    const associatedFeeItems = await db.select()
      .from(pricingTypeFeeItems)
      .where(eq(pricingTypeFeeItems.pricingTypeId, id));

    if (associatedFeeItems.length > 0) {
      return {
        success: false,
        message: `Cannot delete pricing type. It has ${associatedFeeItems.length} associated fee item(s). Please remove all fee item associations first.`
      };
    }

    // Check if pricing type is used by any campaigns
    const campaignsUsingPricingType = await db.select()
      .from(campaigns)
      .where(eq(campaigns.pricingTypeId, id));

    if (campaignsUsingPricingType.length > 0) {
      return {
        success: false,
        message: `Cannot delete pricing type. It is being used by ${campaignsUsingPricingType.length} campaign(s).`
      };
    }

    // If no associations, delete the pricing type
    const result = await db.delete(pricingTypes)
      .where(eq(pricingTypes.id, id));

    if (result.rowCount && result.rowCount > 0) {
      return {
        success: true,
        message: 'Pricing type deleted successfully.'
      };
    } else {
      return {
        success: false,
        message: 'Pricing type not found.'
      };
    }
  }

  async updatePricingType(id: number, updates: { name: string; description?: string | null; feeItemIds: number[] }): Promise<{ success: boolean; message?: string; pricingType?: PricingType }> {
    try {
      console.log('Storage.updatePricingType called with:', { id, updates });
      
      // Check if name already exists for another pricing type
      if (updates.name) {
        console.log('Checking for existing pricing type with name:', updates.name);
        const existingPricingType = await db.select()
          .from(pricingTypes)
          .where(and(
            eq(pricingTypes.name, updates.name),
            not(eq(pricingTypes.id, id))
          ));

        console.log('Found existing pricing types:', existingPricingType);

        if (existingPricingType.length > 0) {
          return {
            success: false,
            message: 'A pricing type with this name already exists.'
          };
        }
      }

      // Update the pricing type
      console.log('Updating pricing type in database...');
      const [updatedPricingType] = await db.update(pricingTypes)
        .set({
          name: updates.name,
          description: updates.description,
          updatedAt: new Date()
        })
        .where(eq(pricingTypes.id, id))
        .returning();

      console.log('Updated pricing type:', updatedPricingType);

      if (!updatedPricingType) {
        console.log('No pricing type was updated - not found');
        return {
          success: false,
          message: 'Pricing type not found.'
        };
      }

      // Update fee item associations
      console.log('Deleting existing fee item associations...');
      const deleteResult = await db.delete(pricingTypeFeeItems)
        .where(eq(pricingTypeFeeItems.pricingTypeId, id));
      console.log('Deleted associations count:', deleteResult.rowCount);

      // Then insert new associations
      if (updates.feeItemIds && updates.feeItemIds.length > 0) {
        console.log('Validating fee item IDs:', updates.feeItemIds);
        
        // Validate that all fee item IDs exist AND have valid fee groups
        const existingFeeItems = await db.select({ 
          id: feeItems.id,
          feeGroupId: feeItems.feeGroupId,
          feeGroupName: feeGroups.name
        })
          .from(feeItems)
          .leftJoin(feeGroups, eq(feeItems.feeGroupId, feeGroups.id))
          .where(inArray(feeItems.id, updates.feeItemIds));
        
        console.log('Raw existing fee items from query:', existingFeeItems);
        
        // Only include fee items that have valid fee groups
        const validFeeItems = existingFeeItems.filter(item => item.feeGroupName);
        const existingFeeItemIds = validFeeItems.map(item => item.id);
        const invalidFeeItemIds = updates.feeItemIds.filter(id => !existingFeeItemIds.includes(id));
        
        console.log('Valid fee items (with fee groups):', validFeeItems);
        console.log('Existing fee item IDs:', existingFeeItemIds);
        console.log('Invalid fee item IDs:', invalidFeeItemIds);
        
        if (invalidFeeItemIds.length > 0) {
          return {
            success: false,
            message: `The following fee items do not exist: ${invalidFeeItemIds.join(', ')}`
          };
        }
        
        console.log('Inserting new fee item associations:', existingFeeItemIds);
        const insertResult = await db.insert(pricingTypeFeeItems)
          .values(existingFeeItemIds.map(feeItemId => ({
            pricingTypeId: id,
            feeItemId
          })));
        console.log('Inserted associations count:', insertResult.rowCount);
      } else {
        console.log('No fee item associations to insert');
      }

      console.log('Pricing type update completed successfully');
      return {
        success: true,
        pricingType: updatedPricingType
      };
    } catch (error) {
      console.error('Error updating pricing type:', error);
      return {
        success: false,
        message: 'Failed to update pricing type.'
      };
    }
  }

  // Campaigns implementation (removed duplicate - using the simpler one above)

  async getCampaign(id: number): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign || undefined;
  }

  async getCampaignWithDetails(id: number): Promise<CampaignWithDetails | undefined> {
    const result = await db
      .select({
        campaign: campaigns,
        pricingType: pricingTypes,
      })
      .from(campaigns)
      .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
      .where(eq(campaigns.id, id));

    if (result.length === 0) return undefined;

    const row = result[0];
    return {
      ...row.campaign,
      pricingType: row.pricingType || undefined,
      feeValues: [],
      createdByUser: undefined,
    };
  }

  async getCampaignsByAcquirer(acquirer: string): Promise<CampaignWithDetails[]> {
    const result = await db
      .select({
        campaign: campaigns,
        pricingType: pricingTypes,
        createdByUser: users,
      })
      .from(campaigns)
      .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
      .leftJoin(users, eq(campaigns.createdBy, users.id))
      .where(eq(campaigns.acquirer, acquirer))
      .orderBy(desc(campaigns.createdAt));

    return result.map(row => ({
      ...row.campaign,
      pricingType: row.pricingType!,
      createdByUser: row.createdByUser || undefined,
    }));
  }





  async deactivateCampaign(id: number): Promise<boolean> {
    const result = await db.update(campaigns).set({ isActive: false }).where(eq(campaigns.id, id));
    return result.rowCount > 0;
  }

  async searchCampaigns(query: string): Promise<CampaignWithDetails[]> {
    const result = await db
      .select({
        campaign: campaigns,
        pricingType: pricingTypes,
        createdByUser: users,
      })
      .from(campaigns)
      .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
      .leftJoin(users, eq(campaigns.createdBy, users.id))
      .where(
        or(
          ilike(campaigns.name, `%${query}%`),
          ilike(campaigns.description, `%${query}%`)
        )
      )
      .orderBy(desc(campaigns.createdAt));

    return result.map(row => ({
      ...row.campaign,
      pricingType: row.pricingType!,
      createdByUser: row.createdByUser || undefined,
    }));
  }

  // Campaign Fee Values implementation
  async setCampaignFeeValue(campaignId: number, feeItemId: number, value: string): Promise<CampaignFeeValue> {
    const [existing] = await db.select().from(campaignFeeValues)
      .where(and(
        eq(campaignFeeValues.campaignId, campaignId),
        eq(campaignFeeValues.feeItemId, feeItemId)
      ));

    if (existing) {
      const [updated] = await db.update(campaignFeeValues)
        .set({ value, updatedAt: new Date() })
        .where(eq(campaignFeeValues.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(campaignFeeValues).values({
        campaignId,
        feeItemId,
        value,
        valueType: 'percentage',
      }).returning();
      return created;
    }
  }

  async getCampaignFeeValues(campaignId: number): Promise<CampaignFeeValue[]> {
    const result = await db
      .select({
        feeValue: campaignFeeValues,
        feeItem: feeItems,
        feeGroup: feeGroups,
      })
      .from(campaignFeeValues)
      .leftJoin(feeItems, eq(campaignFeeValues.feeItemId, feeItems.id))
      .leftJoin(feeGroups, eq(feeItems.feeGroupId, feeGroups.id))
      .where(eq(campaignFeeValues.campaignId, campaignId));

    return result.map(row => ({
      ...row.feeValue,
      feeItem: row.feeItem ? {
        ...row.feeItem,
        feeGroup: row.feeGroup || undefined,
      } : undefined,
    }));
  }

  async updateCampaignFeeValue(id: number, value: string): Promise<CampaignFeeValue | undefined> {
    const [updated] = await db.update(campaignFeeValues)
      .set({ value, updatedAt: new Date() })
      .where(eq(campaignFeeValues.id, id))
      .returning();
    return updated || undefined;
  }

  // Campaign Assignments implementation
  async assignCampaignToProspect(campaignId: number, prospectId: number, assignedBy: string): Promise<CampaignAssignment> {
    const [created] = await db.insert(campaignAssignments).values({
      campaignId,
      prospectId,
      assignedBy,
    }).returning();
    return created;
  }

  async getCampaignAssignments(campaignId: number): Promise<CampaignAssignment[]> {
    return await db.select().from(campaignAssignments).where(eq(campaignAssignments.campaignId, campaignId));
  }

  async getProspectCampaignAssignment(prospectId: number): Promise<CampaignAssignment | undefined> {
    const [assignment] = await db
      .select()
      .from(campaignAssignments)
      .where(and(eq(campaignAssignments.prospectId, prospectId), eq(campaignAssignments.isActive, true)))
      .orderBy(desc(campaignAssignments.assignedAt))
      .limit(1);
    return assignment || undefined;
  }

  async swapCampaignForProspect(prospectId: number, campaignId: number, assignedBy: string): Promise<CampaignAssignment> {
    // Deactivate prior active assignment(s) — keeps history.
    await db
      .update(campaignAssignments)
      .set({ isActive: false })
      .where(and(eq(campaignAssignments.prospectId, prospectId), eq(campaignAssignments.isActive, true)));
    const [created] = await db
      .insert(campaignAssignments)
      .values({ campaignId, prospectId, assignedBy, isActive: true })
      .returning();
    return created;
  }

  async getProspectsForCampaign(campaignId: number): Promise<MerchantProspect[]> {
    const rows = await db
      .select({ p: merchantProspects })
      .from(campaignAssignments)
      .innerJoin(merchantProspects, eq(merchantProspects.id, campaignAssignments.prospectId))
      .where(and(eq(campaignAssignments.campaignId, campaignId), eq(campaignAssignments.isActive, true)));
    return rows.map(r => r.p);
  }

  // Campaign Assignment Rules
  async getCampaignAssignmentRules(): Promise<CampaignAssignmentRule[]> {
    return await db.select().from(campaignAssignmentRules).orderBy(campaignAssignmentRules.priority, campaignAssignmentRules.id);
  }
  async createCampaignAssignmentRule(rule: InsertCampaignAssignmentRule): Promise<CampaignAssignmentRule> {
    const [r] = await db.insert(campaignAssignmentRules).values(rule).returning();
    return r;
  }
  async updateCampaignAssignmentRule(id: number, updates: Partial<InsertCampaignAssignmentRule>): Promise<CampaignAssignmentRule | undefined> {
    const [r] = await db.update(campaignAssignmentRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(campaignAssignmentRules.id, id))
      .returning();
    return r || undefined;
  }
  async deleteCampaignAssignmentRule(id: number): Promise<boolean> {
    const res = await db.delete(campaignAssignmentRules).where(eq(campaignAssignmentRules.id, id));
    return (res.rowCount ?? 0) > 0;
  }
  async findCampaignByRule(ctx: { mcc?: string | null; acquirerId?: number | null; agentId?: number | null }): Promise<number | undefined> {
    const rules = await db.select().from(campaignAssignmentRules)
      .where(eq(campaignAssignmentRules.isActive, true))
      .orderBy(campaignAssignmentRules.priority, campaignAssignmentRules.id);
    const matches = (rule: CampaignAssignmentRule, key: 'mcc' | 'acquirerId' | 'agentId', value: any) =>
      rule[key] == null || rule[key] === value;
    const matched = rules
      .filter(r =>
        matches(r, 'mcc', ctx.mcc ?? null) &&
        matches(r, 'acquirerId', ctx.acquirerId ?? null) &&
        matches(r, 'agentId', ctx.agentId ?? null)
      )
      .map(r => ({
        r,
        // specificity: count of non-null criteria that exactly matched
        specificity:
          (r.mcc != null && r.mcc === (ctx.mcc ?? null) ? 1 : 0) +
          (r.acquirerId != null && r.acquirerId === (ctx.acquirerId ?? null) ? 1 : 0) +
          (r.agentId != null && r.agentId === (ctx.agentId ?? null) ? 1 : 0),
      }))
      .sort((a, b) => (b.specificity - a.specificity) || (a.r.priority - b.r.priority) || (a.r.id - b.r.id));
    return matched[0]?.r.campaignId;
  }

  // Equipment Items implementation
  async getAllEquipmentItems(): Promise<EquipmentItem[]> {
    return await db.select().from(equipmentItems).where(eq(equipmentItems.isActive, true)).orderBy(equipmentItems.name);
  }

  async getEquipmentItem(id: number): Promise<EquipmentItem | undefined> {
    const [item] = await db.select().from(equipmentItems).where(eq(equipmentItems.id, id));
    return item || undefined;
  }

  async createEquipmentItem(equipmentItem: InsertEquipmentItem): Promise<EquipmentItem> {
    const [created] = await db.insert(equipmentItems).values(equipmentItem).returning();
    return created;
  }

  async updateEquipmentItem(id: number, updates: Partial<InsertEquipmentItem>): Promise<EquipmentItem | undefined> {
    const [updated] = await db.update(equipmentItems).set({
      ...updates,
      updatedAt: new Date()
    }).where(eq(equipmentItems.id, id)).returning();
    return updated || undefined;
  }

  async deleteEquipmentItem(id: number): Promise<boolean> {
    const result = await db.update(equipmentItems).set({ isActive: false }).where(eq(equipmentItems.id, id));
    return result.rowCount > 0;
  }

  // Campaign Equipment implementation
  async getCampaignEquipment(campaignId: number): Promise<(CampaignEquipment & { equipmentItem: EquipmentItem })[]> {
    const result = await db
      .select({
        campaignEquipment: campaignEquipment,
        equipmentItem: equipmentItems,
      })
      .from(campaignEquipment)
      .innerJoin(equipmentItems, eq(campaignEquipment.equipmentItemId, equipmentItems.id))
      .where(eq(campaignEquipment.campaignId, campaignId))
      .orderBy(campaignEquipment.displayOrder);

    return result.map(row => ({
      ...row.campaignEquipment,
      equipmentItem: row.equipmentItem,
    }));
  }

  async addEquipmentToCampaign(campaignId: number, equipmentItemId: number, isRequired: boolean = false, displayOrder: number = 0): Promise<CampaignEquipment> {
    const [created] = await db.insert(campaignEquipment).values({
      campaignId,
      equipmentItemId,
      isRequired,
      displayOrder,
    }).returning();
    return created;
  }

  async removeEquipmentFromCampaign(campaignId: number, equipmentItemId: number): Promise<boolean> {
    const result = await db.delete(campaignEquipment)
      .where(and(
        eq(campaignEquipment.campaignId, campaignId),
        eq(campaignEquipment.equipmentItemId, equipmentItemId)
      ));
    return result.rowCount > 0;
  }

  async updateCampaignEquipment(campaignId: number, equipmentItemId: number, updates: Partial<InsertCampaignEquipment>): Promise<CampaignEquipment | undefined> {
    const [updated] = await db.update(campaignEquipment)
      .set(updates)
      .where(and(
        eq(campaignEquipment.campaignId, campaignId),
        eq(campaignEquipment.equipmentItemId, equipmentItemId)
      ))
      .returning();
    return updated || undefined;
  }

  // Merchant operations
  async getMerchant(id: number): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, id));
    return merchant || undefined;
  }

  async getMerchantByEmail(email: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.email, email));
    return merchant || undefined;
  }

  async getAllMerchants(): Promise<MerchantWithAgent[]> {
    const result = await db
      .select({
        merchant: merchants,
        agent: agents,
      })
      .from(merchants)
      .leftJoin(agents, eq(merchants.agentId, agents.id));

    return result.map(row => ({
      ...row.merchant,
      agent: row.agent || undefined,
    }));
  }

  async createMerchant(insertMerchant: InsertMerchant): Promise<Merchant> {
    const [merchant] = await db
      .insert(merchants)
      .values(insertMerchant)
      .returning();
    return merchant;
  }

  async updateMerchant(id: number, updates: Partial<InsertMerchant>): Promise<Merchant | undefined> {
    const [merchant] = await db
      .update(merchants)
      .set(updates)
      .where(eq(merchants.id, id))
      .returning();
    return merchant || undefined;
  }

  async deleteMerchant(id: number): Promise<boolean> {
    // Get the merchant to find the associated user ID
    const merchant = await this.getMerchant(id);
    if (!merchant) return false;

    // Delete the merchant record (this will also delete the associated user due to cascade)
    const result = await db.delete(merchants).where(eq(merchants.id, id));
    return (result.rowCount || 0) > 0;
  }

  async searchMerchants(query: string): Promise<MerchantWithAgent[]> {
    const result = await db
      .select({
        merchant: merchants,
        agent: agents,
      })
      .from(merchants)
      .leftJoin(agents, eq(merchants.agentId, agents.id));

    return result
      .map(row => ({
        ...row.merchant,
        agent: row.agent || undefined,
      }))
      .filter(merchant => 
        merchant.businessName.toLowerCase().includes(query.toLowerCase()) ||
        merchant.email.toLowerCase().includes(query.toLowerCase()) ||
        merchant.businessType.toLowerCase().includes(query.toLowerCase())
      );
  }

  // Missing methods implementation
  async getLocationRevenue(locationId: number) {
    return {
      totalRevenue: "0.00",
      last24Hours: "0.00", 
      monthToDate: "0.00",
      yearToDate: "0.00"
    };
  }

  async getLocationsByMerchant(merchantId: number): Promise<LocationWithAddresses[]> {
    const result = await db
      .select({
        location: locations,
        address: addresses,
      })
      .from(locations)
      .leftJoin(addresses, eq(locations.id, addresses.locationId))
      .where(eq(locations.merchantId, merchantId));

    const locationsMap = new Map<number, LocationWithAddresses>();
    
    for (const row of result) {
      if (!locationsMap.has(row.location.id)) {
        locationsMap.set(row.location.id, {
          ...row.location,
          addresses: []
        });
      }
      
      if (row.address) {
        locationsMap.get(row.location.id)!.addresses.push(row.address);
      }
    }
    
    return Array.from(locationsMap.values());
  }

  async getDashboardRevenue(timeRange: string = 'monthly') {
    return {
      totalRevenue: "0.00",
      thisMonth: "0.00",
      lastMonth: "0.00"
    };
  }

  async getTopLocations() {
    return [];
  }

  async getRecentActivity() {
    return [];
  }

  async getAssignedMerchants(agentId: number) {
    return await this.getAgentMerchants(agentId);
  }

  async getSystemOverview() {
    return {
      totalMerchants: 0,
      totalAgents: 0,
      totalRevenue: "0.00"
    };
  }

  async getProspectsByAgent(agentId: number) {
    return await db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
  }

  async getProspectSignaturesByProspect(prospectId: number): Promise<ProspectSignature[]> {
    return await db.select().from(prospectSignatures).where(eq(prospectSignatures.prospectId, prospectId));
  }

  async getProspectOwners(prospectId: number): Promise<ProspectOwner[]> {
    return await db.select().from(prospectOwners).where(eq(prospectOwners.prospectId, prospectId));
  }

  async getUserWidgetPreferences(userId: string): Promise<UserDashboardPreference[]> {
    return await db.select().from(userDashboardPreferences).where(eq(userDashboardPreferences.user_id, userId));
  }

  async createWidgetPreference(preference: InsertUserDashboardPreference): Promise<UserDashboardPreference> {
    const [created] = await db.insert(userDashboardPreferences).values(preference).returning();
    return created;
  }

  async updateWidgetPreference(id: number, updates: Partial<InsertUserDashboardPreference>): Promise<UserDashboardPreference | undefined> {
    const [updated] = await db.update(userDashboardPreferences).set(updates).where(eq(userDashboardPreferences.id, id)).returning();
    return updated || undefined;
  }

  async deleteWidgetPreference(id: number): Promise<boolean> {
    const result = await db.delete(userDashboardPreferences).where(eq(userDashboardPreferences.id, id));
    return result.rowCount > 0;
  }

  // Generic per-user key/value preferences (e.g. underwriting queue filters/sort).
  // The `user_preferences` table is declared in shared/schema.ts and provisioned
  // by the standard schema push — no runtime DDL shim required.
  async getUserPreference(userId: string, key: string): Promise<unknown | undefined> {
    const [row] = await db
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)));
    return row ? (row as UserPreference).value : undefined;
  }

  async setUserPreference(userId: string, key: string, value: unknown): Promise<void> {
    await db
      .insert(userPreferences)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value, updatedAt: new Date() },
      });
  }

  async deleteUserPreference(userId: string, key: string): Promise<boolean> {
    const result = await db
      .delete(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)));
    return (result.rowCount ?? 0) > 0;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(locations).values(location).returning();
    return created;
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location || undefined;
  }

  async updateLocation(id: number, updates: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(updates).where(eq(locations.id, id)).returning();
    return updated || undefined;
  }

  async deleteLocation(id: number): Promise<boolean> {
    const result = await db.delete(locations).where(eq(locations.id, id));
    return result.rowCount > 0;
  }

  async getAddressesByLocation(locationId: number): Promise<Address[]> {
    return await db.select().from(addresses).where(eq(addresses.locationId, locationId));
  }

  async createAddress(address: InsertAddress): Promise<Address> {
    const [created] = await db.insert(addresses).values(address).returning();
    return created;
  }

  async getAddress(id: number): Promise<Address | undefined> {
    const [address] = await db.select().from(addresses).where(eq(addresses.id, id));
    return address || undefined;
  }

  async updateAddress(id: number, updates: Partial<InsertAddress>): Promise<Address | undefined> {
    const [updated] = await db.update(addresses).set(updates).where(eq(addresses.id, id)).returning();
    return updated || undefined;
  }

  async deleteAddress(id: number): Promise<boolean> {
    const result = await db.delete(addresses).where(eq(addresses.id, id));
    return result.rowCount > 0;
  }

  async getTransactionsForUser(userId: string): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(eq(merchants.userId, userId));

    return result.map(row => ({
      ...row.transaction,
      merchant: row.merchant || undefined,
    }));
  }

  async assignAgentToMerchant(agentId: number, merchantId: number, assignedBy: string): Promise<AgentMerchant> {
    const [created] = await db.insert(agentMerchants).values({
      agentId,
      merchantId,
      assignedBy,
    }).returning();
    return created;
  }

  async unassignAgentFromMerchant(agentId: number, merchantId: number): Promise<boolean> {
    const result = await db.delete(agentMerchants)
      .where(and(
        eq(agentMerchants.agentId, agentId),
        eq(agentMerchants.merchantId, merchantId)
      ));
    return result.rowCount > 0;
  }

  async searchMerchantProspectsByAgent(agentId: number, query: string) {
    // SQL-side filter via ilike. Previously read the full agent's prospect
    // list and filtered in JS — replaced to keep memory bounded.
    const q = `%${query}%`;
    const searchExpr = or(
      ilike(merchantProspects.firstName, q),
      ilike(merchantProspects.lastName, q),
      ilike(merchantProspects.email, q),
    );
    const where = searchExpr
      ? and(eq(merchantProspects.agentId, agentId), searchExpr)
      : eq(merchantProspects.agentId, agentId);
    return await db.select().from(merchantProspects).where(where);
  }

  async getMerchantProspectsByAgent(agentId: number) {
    return await db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
  }

  async searchMerchantProspects(query: string) {
    // SQL-side filter via ilike. Previously read the full prospects table and
    // filtered in JS — replaced to keep memory bounded and to push selectivity
    // to the database. For paginated callers, prefer getMerchantProspectsPaged.
    const q = `%${query}%`;
    const where = or(
      ilike(merchantProspects.firstName, q),
      ilike(merchantProspects.lastName, q),
      ilike(merchantProspects.email, q),
    );
    return await db.select().from(merchantProspects).where(where);
  }

  async clearAllProspectData(): Promise<void> {
    await db.delete(prospectSignatures);
    await db.delete(prospectOwners);
    await db.delete(merchantProspects);
  }

  async updateProspectOwner(id: number, updates: Partial<ProspectOwner>): Promise<ProspectOwner | undefined> {
    const [updated] = await db.update(prospectOwners).set(updates).where(eq(prospectOwners.id, id)).returning();
    return updated || undefined;
  }

  async createProspectOwner(owner: InsertProspectOwner): Promise<ProspectOwner> {
    const [created] = await db.insert(prospectOwners).values(owner).returning();
    return created;
  }

  async getProspectOwnerBySignatureToken(token: string): Promise<ProspectOwner | undefined> {
    const [owner] = await db.select().from(prospectOwners).where(eq(prospectOwners.signatureToken, token));
    return owner || undefined;
  }

  async createProspectSignature(signature: InsertProspectSignature): Promise<ProspectSignature> {
    // Stamp the canonical, immutable evidence URL at signing time so it can
    // be quoted verbatim in legal exports without depending on later route
    // refactors.
    const withRecordLink: InsertProspectSignature = {
      ...signature,
      recordLink:
        signature.recordLink ??
        `/api/prospects/${signature.prospectId}/signature-trail#owner=${signature.ownerId}`,
    };
    const [created] = await db.insert(prospectSignatures).values(withRecordLink).returning();
    return created;
  }

  async getProspectOwnerByEmailAndProspectId(email: string, prospectId: number): Promise<ProspectOwner | undefined> {
    const [owner] = await db.select().from(prospectOwners)
      .where(and(
        eq(prospectOwners.email, email),
        eq(prospectOwners.prospectId, prospectId)
      ));
    return owner || undefined;
  }

  async getProspectSignature(token: string): Promise<ProspectSignature | undefined> {
    const [signature] = await db.select().from(prospectSignatures).where(eq(prospectSignatures.signatureToken, token));
    return signature || undefined;
  }

  async getProspectSignaturesByOwnerEmail(email: string): Promise<ProspectSignature[]> {
    const result = await db
      .select({
        signature: prospectSignatures,
        owner: prospectOwners,
      })
      .from(prospectSignatures)
      .leftJoin(prospectOwners, eq(prospectSignatures.prospectOwnerId, prospectOwners.id))
      .where(eq(prospectOwners.email, email));

    return result.map(row => row.signature);
  }

  async getAgentByUserId(userId: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.userId, userId));
    return agent || undefined;
  }

  async createPdfForm(form: InsertPdfForm): Promise<PdfForm> {
    const [created] = await db.insert(pdfForms).values(form).returning();
    return created;
  }

  async createPdfFormField(field: InsertPdfFormField): Promise<PdfFormField> {
    const [created] = await db.insert(pdfFormFields).values(field).returning();
    return created;
  }

  async getPdfFormWithFields(id: number): Promise<PdfFormWithFields | undefined> {
    const [form] = await db.select().from(pdfForms).where(eq(pdfForms.id, id));
    if (!form) return undefined;

    const fields = await db.select().from(pdfFormFields).where(eq(pdfFormFields.formId, id));
    
    return {
      ...form,
      fields
    };
  }

  async updatePdfForm(id: number, updates: Partial<InsertPdfForm>): Promise<PdfForm | undefined> {
    const [updated] = await db.update(pdfForms).set(updates).where(eq(pdfForms.id, id)).returning();
    return updated || undefined;
  }

  generateSubmissionToken(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createPdfFormSubmission(submission: InsertPdfFormSubmission): Promise<PdfFormSubmission> {
    const [created] = await db.insert(pdfFormSubmissions).values(submission).returning();
    return created;
  }

  async getPdfFormSubmissions(formId: number): Promise<PdfFormSubmission[]> {
    return await db.select().from(pdfFormSubmissions).where(eq(pdfFormSubmissions.formId, formId));
  }

  async getPdfFormSubmissionByToken(token: string): Promise<PdfFormSubmission | undefined> {
    const [submission] = await db.select().from(pdfFormSubmissions).where(eq(pdfFormSubmissions.submissionToken, token));
    return submission || undefined;
  }

  async updatePdfFormSubmissionByToken(token: string, updates: Partial<InsertPdfFormSubmission>): Promise<PdfFormSubmission | undefined> {
    const [updated] = await db.update(pdfFormSubmissions).set(updates).where(eq(pdfFormSubmissions.submissionToken, token)).returning();
    return updated || undefined;
  }

  async getPdfForm(id: number): Promise<PdfForm | undefined> {
    const [form] = await db.select().from(pdfForms).where(eq(pdfForms.id, id));
    return form || undefined;
  }

  async updateCampaign(id: number, updates: Partial<InsertCampaign>): Promise<Campaign | undefined> {
    const [updated] = await db.update(campaigns).set(updates).where(eq(campaigns.id, id)).returning();
    return updated || undefined;
  }

  async getPricingTypeFeeItems(pricingTypeId: number) {
    return await this.getPricingTypeWithFeeItems(pricingTypeId);
  }

  // Agent operations
  async getAgent(id: number): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent || undefined;
  }

  async getAgentByEmail(email: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.email, email));
    return agent || undefined;
  }

  async getAllAgents(): Promise<Agent[]> {
    return await db.select().from(agents);
  }

  async createAgent(insertAgent: InsertAgent): Promise<Agent> {
    const { id, ...agentData } = insertAgent;
    const [agent] = await db
      .insert(agents)
      .values(agentData)
      .returning();
    return agent;
  }

  async updateAgent(id: number, updates: Partial<InsertAgent>): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, id))
      .returning();
    return agent || undefined;
  }

  async deleteAgent(id: number): Promise<boolean> {
    // Get the agent to find the associated user ID
    const agent = await this.getAgent(id);
    if (!agent) return false;

    // Delete the agent record (this will also delete the associated user due to cascade)
    const result = await db.delete(agents).where(eq(agents.id, id));
    return (result.rowCount || 0) > 0;
  }

  async searchAgents(query: string): Promise<Agent[]> {
    const allAgents = await db.select().from(agents);
    
    return allAgents.filter(agent =>
      `${agent.firstName} ${agent.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
      agent.email.toLowerCase().includes(query.toLowerCase()) ||
      (agent.territory && agent.territory.toLowerCase().includes(query.toLowerCase()))
    );
  }

  // Transaction operations
  async getTransaction(id: number): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id));
    return transaction || undefined;
  }

  async getTransactionByTransactionId(transactionId: string): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.transactionId, transactionId));
    return transaction || undefined;
  }

  async getAllTransactions(): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .orderBy(desc(transactions.createdAt));

    return result.map(row => ({
      ...row.transaction,
      merchant: row.merchant || undefined,
    }));
  }

  async getTransactionsByMerchant(merchantId: number): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(eq(transactions.merchantId, merchantId));

    return result.map(row => ({
      ...row.transaction,
      merchant: row.merchant || undefined,
    }));
  }

  async getTransactionsByMID(mid: string): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(eq(transactions.mid, mid));

    return result.map(row => ({
      ...row.transaction,
      merchant: row.merchant || undefined,
    }));
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values(insertTransaction)
      .returning();
    // Auto-calc commission ledger entries for completed txs. We log loudly on
    // failure so the issue is visible; the recalcAll backfill endpoint
    // (POST /api/commissions/recalculate-all) safely retries any tx whose
    // ledger rows are missing — that's the explicit retry mechanism.
    if (transaction.status === "completed") {
      try {
        const { calculateCommissionsForTransaction } = await import("./commissions");
        await calculateCommissionsForTransaction(db, transaction.id);
      } catch (err) {
        console.error(
          `[commissions] AUTO-CALC FAILED for transaction ${transaction.id} ` +
          `— retry via POST /api/commissions/recalculate-all`,
          err,
        );
      }
    }
    return transaction;
  }

  async updateTransaction(id: number, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    // Capture prior status so we can detect a transition into "completed".
    const [prior] = await db.select({ status: transactions.status })
      .from(transactions).where(eq(transactions.id, id));

    const [transaction] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.id, id))
      .returning();

    // If the transaction just transitioned into "completed", trigger the
    // commission engine. Idempotency in calculateCommissionsForTransaction
    // ensures we never duplicate ledger rows for a tx that already had them.
    if (transaction && transaction.status === "completed" && prior?.status !== "completed") {
      try {
        const { calculateCommissionsForTransaction } = await import("./commissions");
        await calculateCommissionsForTransaction(db, transaction.id);
      } catch (err) {
        console.error(
          `[commissions] AUTO-CALC FAILED on status→completed for tx ${transaction.id} ` +
          `— retry via POST /api/commissions/recalculate-all`,
          err,
        );
      }
    }
    return transaction || undefined;
  }

  async searchTransactions(query: string): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id));

    return result
      .map(row => ({
        ...row.transaction,
        merchant: row.merchant || undefined,
      }))
      .filter(transaction =>
        transaction.transactionId.toLowerCase().includes(query.toLowerCase()) ||
        (transaction.merchant?.businessName && transaction.merchant.businessName.toLowerCase().includes(query.toLowerCase())) ||
        transaction.paymentMethod.toLowerCase().includes(query.toLowerCase())
      );
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    console.log('Storage.getUser - Looking for user with ID:', id);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    console.log('Storage.getUser - Found:', user ? `${user.username} (${user.id})` : 'null');
    return user ? this.withRole(user) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ? this.withRole(user) : undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user ? this.withRole(user) : undefined;
  }

  async getUserByUsernameOrEmail(username: string, email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      or(eq(users.username, username), eq(users.email, email))
    );
    return user ? this.withRole(user) : undefined;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.passwordResetToken, token));
    return user ? this.withRole(user) : undefined;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user ? this.withRole(user) : undefined;
  }

  async createUser(userData: UserInputWithLegacyRole): Promise<User> {
    const normalized = normalizeLegacyRole(userData);
    const [user] = await db
      .insert(users)
      .values(normalized as UpsertUser)
      .returning();
    return this.withRole(user);
  }

  async getAllUsers(): Promise<User[]> {
    const userList = await db.select().from(users);
    return this.withRoles(userList);
  }

  async upsertUser(userData: UpsertUser & { role?: string }): Promise<User> {
    const normalized = normalizeLegacyRole(userData);
    const [user] = await db
      .insert(users)
      .values(normalized as UpsertUser)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...normalized,
          updatedAt: new Date(),
        },
      })
      .returning();
    return this.withRole(user);
  }

  async updateUser(id: string, updates: UserInputWithLegacyRole): Promise<User | undefined> {
    const normalized = normalizeLegacyRole(updates);
    const [user] = await db
      .update(users)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ? this.withRole(user) : undefined;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    return this.updateUserRoles(id, [role]);
  }

  async updateUserRoles(id: string, roles: string[]): Promise<User | undefined> {
    const cleaned = Array.from(new Set(roles.filter((r) => typeof r === 'string' && r.length > 0)));
    if (cleaned.length === 0) return undefined;
    const [user] = await db
      .update(users)
      .set({ roles: cleaned, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ? this.withRole(user) : undefined;
  }

  async updateUserStatus(id: string, status: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateUserPermissions(id: string, permissions: Record<string, boolean>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ permissions, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount || 0) > 0;
  }

  async resetUserPassword(id: string): Promise<{ user: User; temporaryPassword: string }> {
    // Generate a secure temporary password
    const temporaryPassword = await this.generateTemporaryPassword();
    
    // Hash the temporary password
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    
    // Set password reset token for forced password change
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Update user with new password and reset token
    const user = await this.updateUser(id, {
      passwordHash,
      passwordResetToken: resetToken,
      passwordResetExpires: expiresAt,
      updatedAt: new Date()
    });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return { user, temporaryPassword };
  }

  async setPasswordResetToken(id: string, token: string, expiresAt: Date): Promise<User | undefined> {
    return await this.updateUser(id, {
      passwordResetToken: token,
      passwordResetExpires: expiresAt,
      updatedAt: new Date()
    });
  }

  async clearPasswordResetToken(id: string): Promise<User | undefined> {
    return await this.updateUser(id, {
      passwordResetToken: null,
      passwordResetExpires: null,
      updatedAt: new Date()
    });
  }

  async getMerchantsForUser(userId: string): Promise<MerchantWithAgent[]> {
    const user = await this.getUser(userId);
    if (!user) return [];

    // Super admin and admin can see all merchants
    if (['super_admin', 'admin'].includes(user.role)) {
      return this.getAllMerchants();
    }

    // Agent can see their assigned merchants
    if (user.role === 'agent') {
      const agent = await db.select().from(agents).where(eq(agents.userId, userId)).limit(1);
      if (agent[0]) {
        return this.getMerchantsByAgent(agent[0].id);
      }
    }

    // Merchant can see only their own data
    if (user.role === 'merchant') {
      const merchant = await db.select().from(merchants).where(eq(merchants.userId, userId)).limit(1);
      if (merchant[0]) {
        return [{ ...merchant[0] }];
      }
    }

    return [];
  }

  async getMerchantsByAgent(agentId: number): Promise<MerchantWithAgent[]> {
    const result = await db
      .select({
        merchant: merchants,
        agent: agents,
      })
      .from(merchants)
      .leftJoin(agents, eq(merchants.agentId, agents.id))
      .where(eq(merchants.agentId, agentId));

    return result.map(row => ({
      ...row.merchant,
      agent: row.agent || undefined,
    }));
  }

  // Authentication operations
  async createLoginAttempt(attempt: {
    username?: string | null;
    email?: string | null;
    ipAddress: string;
    userAgent: string;
    success: boolean;
    failureReason?: string;
  }): Promise<void> {
    await db.insert(loginAttempts).values({
      username: attempt.username,
      email: attempt.email,
      ipAddress: attempt.ipAddress,
      userAgent: attempt.userAgent,
      success: attempt.success,
      failureReason: attempt.failureReason || null,
    });
  }

  async getRecentLoginAttempts(usernameOrEmail: string, ip: string, timeWindow: number): Promise<any[]> {
    const timeThreshold = new Date(Date.now() - timeWindow);
    return await db.select().from(loginAttempts)
      .where(and(
        or(
          eq(loginAttempts.username, usernameOrEmail),
          eq(loginAttempts.email, usernameOrEmail)
        ),
        eq(loginAttempts.ipAddress, ip),
        gte(loginAttempts.createdAt, timeThreshold)
      ));
  }

  async create2FACode(code: {
    userId: string;
    code: string;
    type: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(twoFactorCodes).values(code);
  }

  async verify2FACode(userId: string, code: string): Promise<boolean> {
    const [result] = await db.select().from(twoFactorCodes)
      .where(and(
        eq(twoFactorCodes.userId, userId),
        eq(twoFactorCodes.code, code),
        gte(twoFactorCodes.expiresAt, new Date())
      ));
    
    if (result) {
      await db.delete(twoFactorCodes).where(eq(twoFactorCodes.id, result.id));
      return true;
    }
    return false;
  }

  // Analytics methods
  async getDashboardMetrics(): Promise<{
    totalRevenue: string;
    activeMerchants: number;
    transactionsToday: number;
    activeAgents: number;
  }> {
    const allTransactions = await db.select().from(transactions);
    const completedTransactions = allTransactions.filter(t => t.status === 'completed');
    const totalRevenue = completedTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const allMerchants = await db.select().from(merchants);
    const activeMerchants = allMerchants.filter(m => m.status === 'active').length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const transactionsToday = allTransactions.filter(t => 
      new Date(t.createdAt!).getTime() >= today.getTime()
    ).length;
    
    const allAgents = await db.select().from(agents);
    const activeAgents = allAgents.filter(a => a.status === 'active').length;

    return {
      totalRevenue: totalRevenue.toFixed(2),
      activeMerchants,
      transactionsToday,
      activeAgents
    };
  }

  async getTopMerchants(): Promise<(Merchant & { transactionCount: number; totalVolume: string })[]> {
    const allMerchants = await db.select().from(merchants);
    const allTransactions = await db.select().from(transactions);
    
    return allMerchants.map(merchant => {
      const merchantTransactions = allTransactions.filter(t => t.merchantId === merchant.id && t.status === 'completed');
      const transactionCount = merchantTransactions.length;
      const totalVolume = merchantTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
      
      return {
        ...merchant,
        transactionCount,
        totalVolume: totalVolume.toFixed(2)
      };
    }).sort((a, b) => parseFloat(b.totalVolume) - parseFloat(a.totalVolume)).slice(0, 5);
  }

  async getRecentTransactions(limit: number = 10): Promise<TransactionWithMerchant[]> {
    const result = await db
      .select({
        transaction: transactions,
        merchant: merchants,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .orderBy(desc(transactions.createdAt))
      .limit(limit);

    return result.map(row => ({
      ...row.transaction,
      merchant: row.merchant || undefined,
    }));
  }

  // Security & Audit Methods
  async getAllAuditLogs() {
    return await db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt));
  }

  async getSecurityEvents() {
    return await db.select().from(schema.securityEvents).orderBy(desc(schema.securityEvents.createdAt));
  }

  async getLoginAttempts() {
    return await db.select().from(schema.loginAttempts).orderBy(desc(schema.loginAttempts.attemptTime));
  }

  async getAuditStats() {
    // Typed Drizzle counts. The Proxy `db` resolves to the per-request env
    // via runWithDb, so this stays environment-isolated.
    const [totalAudits] = await db.select({ count: count() }).from(auditLogs);
    const [highRiskActions] = await db.select({ count: count() }).from(auditLogs).where(eq(auditLogs.riskLevel, "high"));
    const [criticalSecurityEvents] = await db.select({ count: count() }).from(securityEvents).where(eq(securityEvents.severity, "critical"));
    const [successfulLogins] = await db.select({ count: count() }).from(loginAttempts).where(eq(loginAttempts.success, true));
    const [failedLogins] = await db.select({ count: count() }).from(loginAttempts).where(eq(loginAttempts.success, false));

    return {
      totalAuditLogs: Number(totalAudits?.count ?? 0),
      highRiskActions: Number(highRiskActions?.count ?? 0),
      securityEvents: Number(criticalSecurityEvents?.count ?? 0),
      successfulLogins: Number(successfulLogins?.count ?? 0),
      failedLogins: Number(failedLogins?.count ?? 0),
    };
  }

  // PDF Forms methods (placeholder for missing functionality)
  async getAllPdfForms() {
    // Return empty array for now - this feature may not be implemented yet
    return [];
  }

  async getAllEmailTemplates() {
    return await db.select().from(emailTemplates);
  }

  async getEmailTemplate(id: number) {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
    return template;
  }

  async getEmailTemplateByName(name: string) {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, name));
    return template;
  }

  async createEmailTemplate(template: InsertEmailTemplate) {
    const [newTemplate] = await db.insert(emailTemplates).values(template).returning();
    return newTemplate;
  }

  async updateEmailTemplate(id: number, updates: Partial<InsertEmailTemplate>) {
    const [updatedTemplate] = await db.update(emailTemplates)
      .set(updates)
      .where(eq(emailTemplates.id, id))
      .returning();
    return updatedTemplate;
  }

  async deleteEmailTemplate(id: number) {
    const deleted = await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
    return deleted.rowCount > 0;
  }

  async getAllEmailTriggers() {
    return await db.select().from(emailTriggers);
  }

  async getEmailTrigger(id: number) {
    const [trigger] = await db.select().from(emailTriggers).where(eq(emailTriggers.id, id));
    return trigger;
  }

  async createEmailTrigger(trigger: InsertEmailTrigger) {
    const [newTrigger] = await db.insert(emailTriggers).values(trigger).returning();
    return newTrigger;
  }

  async updateEmailTrigger(id: number, updates: Partial<InsertEmailTrigger>) {
    const [updatedTrigger] = await db.update(emailTriggers)
      .set(updates)
      .where(eq(emailTriggers.id, id))
      .returning();
    return updatedTrigger;
  }

  async deleteEmailTrigger(id: number) {
    const deleted = await db.delete(emailTriggers).where(eq(emailTriggers.id, id));
    return deleted.rowCount > 0;
  }

  async logEmailActivity(activity: InsertEmailActivity) {
    const [newActivity] = await db.insert(emailActivity).values(activity).returning();
    return newActivity;
  }

  async getEmailActivity(limit: number = 100, filters: { status?: string; templateId?: number; recipientEmail?: string } = {}) {
    let query = db.select().from(emailActivity);
    
    const conditions = [];
    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(emailActivity.status, filters.status));
    }
    if (filters.templateId && filters.templateId !== 0) {
      conditions.push(eq(emailActivity.templateId, filters.templateId));
    }
    if (filters.recipientEmail) {
      conditions.push(ilike(emailActivity.recipientEmail, `%${filters.recipientEmail}%`));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    return await query.orderBy(sql`sent_at DESC`).limit(limit);
  }

  async getEmailActivityStats() {
    // Typed Drizzle counts via the env-isolated Proxy.
    const [sentRow] = await db.select({ count: count() }).from(emailActivity).where(eq(emailActivity.status, "sent"));
    const [openedRow] = await db.select({ count: count() }).from(emailActivity).where(eq(emailActivity.status, "opened"));
    const [clickedRow] = await db.select({ count: count() }).from(emailActivity).where(eq(emailActivity.status, "clicked"));
    const [failedRow] = await db.select({ count: count() }).from(emailActivity).where(eq(emailActivity.status, "failed"));

    const totalSent = Number(sentRow?.count ?? 0);
    const totalOpened = Number(openedRow?.count ?? 0);
    const totalClicked = Number(clickedRow?.count ?? 0);
    const totalFailed = Number(failedRow?.count ?? 0);
    
    return {
      totalSent,
      totalOpened,
      totalClicked,
      totalFailed,
      openRate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0,
      clickRate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0
    };
  }

  // Campaign operations - placeholder methods removed (using real implementations above)

  // Prospect operations 
  async getAllCampaigns(): Promise<Campaign[]> {
    return await db.select().from(campaigns).orderBy(campaigns.createdAt);
  }

  async createCampaign(campaign: InsertCampaign, feeValues: any[], equipmentIds: number[]): Promise<Campaign> {
    const [created] = await db.insert(campaigns).values(campaign).returning();
    return created;
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    return await db.select().from(apiKeys).orderBy(apiKeys.createdAt);
  }

  async createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
    const [created] = await db.insert(apiKeys).values(apiKey).returning();
    return created;
  }

  async updateApiKey(id: number, updates: Partial<InsertApiKey>): Promise<ApiKey | undefined> {
    const [updated] = await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
    return updated || undefined;
  }

  async deleteApiKey(id: number): Promise<boolean> {
    const result = await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getApiUsageStats(): Promise<any> {
    return { totalRequests: 0, successfulRequests: 0, failedRequests: 0 };
  }

  async getApiRequestLogs(): Promise<ApiRequestLog[]> {
    return await db.select().from(apiRequestLogs).orderBy(desc(apiRequestLogs.createdAt)).limit(100);
  }

  async getAllMerchantProspects() {
    return await db.select().from(merchantProspects);
  }

  async getMerchantProspect(id: number) {
    const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.id, id));
    return prospect;
  }

  async getMerchantProspectByEmail(email: string) {
    const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.email, email));
    return prospect;
  }

  async getMerchantProspectByToken(token: string) {
    const [prospect] = await db.select().from(merchantProspects).where(eq(merchantProspects.validationToken, token));
    return prospect;
  }

  async createMerchantProspect(prospect: any) {
    const [newProspect] = await db.insert(merchantProspects).values(prospect).returning();
    return newProspect;
  }

  async updateMerchantProspect(id: number, updates: any) {
    const [updatedProspect] = await db.update(merchantProspects)
      .set(updates)
      .where(eq(merchantProspects.id, id))
      .returning();
    return updatedProspect;
  }

  async deleteMerchantProspect(id: number) {
    const deleted = await db.delete(merchantProspects).where(eq(merchantProspects.id, id));
    return (deleted.rowCount || 0) > 0;
  }
  // Helper methods for user account creation
  private async generateUsername(firstName: string, lastName: string, email: string): Promise<string> {
    // Try email prefix first
    const emailPrefix = email.split('@')[0];
    let candidateUsername = emailPrefix;
    
    // Check if email prefix is available
    const existingByEmail = await this.getUserByUsername(candidateUsername);
    if (!existingByEmail) {
      return candidateUsername;
    }
    
    // Try first.last format
    candidateUsername = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
    const existingByName = await this.getUserByUsername(candidateUsername);
    if (!existingByName) {
      return candidateUsername;
    }
    
    // Add numbers until we find an available username
    let counter = 1;
    while (true) {
      const numberedUsername = `${candidateUsername}${counter}`;
      const existing = await this.getUserByUsername(numberedUsername);
      if (!existing) {
        return numberedUsername;
      }
      counter++;
    }
  }

  private async generateTemporaryPassword(): Promise<string> {
    // Generate a secure temporary password
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async createAgentWithUser(agentData: Omit<InsertAgent, 'userId'>): Promise<{ agent: Agent; user: User; temporaryPassword: string }> {
    // Generate username and temporary password
    const username = await this.generateUsername(agentData.firstName, agentData.lastName, agentData.email);
    const temporaryPassword = await this.generateTemporaryPassword();
    
    // Hash the temporary password
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    
    // Create user account first
    const userData = {
      id: crypto.randomUUID(),
      email: agentData.email,
      username,
      passwordHash,
      firstName: agentData.firstName,
      lastName: agentData.lastName,
      roles: ['agent'],
      status: 'active' as const,
      emailVerified: true, // Auto-verify for system-created accounts
    };
    
    const user = await this.createUser(userData);
    
    // Create agent linked to user
    const agent = await this.createAgent({
      ...agentData,
      userId: user.id
    });
    
    return { agent, user, temporaryPassword };
  }

  async createMerchantWithUser(merchantData: Omit<InsertMerchant, 'userId'>): Promise<{ merchant: Merchant; user: User; temporaryPassword: string }> {
    // Extract contact person name from business name or use a default
    const firstName = 'Merchant';
    const lastName = 'User';
    
    // Generate username and temporary password
    const username = await this.generateUsername(firstName, lastName, merchantData.email);
    const temporaryPassword = await this.generateTemporaryPassword();
    
    // Hash the temporary password
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    
    // Create user account first
    const userData = {
      id: crypto.randomUUID(),
      email: merchantData.email,
      username,
      passwordHash,
      firstName,
      lastName,
      roles: ['merchant'],
      status: 'active' as const,
      emailVerified: true, // Auto-verify for system-created accounts
    };
    
    const user = await this.createUser(userData);
    
    // Create merchant linked to user
    const merchant = await this.createMerchant({
      ...merchantData,
      userId: user.id
    });
    
    return { merchant, user, temporaryPassword };
  }

  // Methods to get user info for agents and merchants
  async getAgentUser(agentId: number): Promise<User | undefined> {
    const agent = await this.getAgent(agentId);
    if (!agent?.userId) return undefined;
    return this.getUser(agent.userId);
  }



  async getMerchantUser(merchantId: number): Promise<User | undefined> {
    const merchant = await this.getMerchant(merchantId);
    if (!merchant?.userId) return undefined;
    return this.getUser(merchant.userId);
  }

  async getAgentMerchants(agentId: number): Promise<MerchantWithAgent[]> {
    return this.getMerchantsByAgent(agentId);
  }

  // ─── Workflow Definitions ───────────────────────────────────────────────────

  async getAllWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
    return db.select().from(workflowDefinitions).orderBy(desc(workflowDefinitions.createdAt));
  }

  async getWorkflowDefinition(id: number): Promise<WorkflowDefinitionWithDetails | undefined> {
    const [wf] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!wf) return undefined;
    const environmentConfigs = await db.select().from(workflowEnvironmentConfigs).where(eq(workflowEnvironmentConfigs.workflowId, id));
    return { ...wf, environmentConfigs };
  }

  async createWorkflowDefinition(data: InsertWorkflowDefinition): Promise<WorkflowDefinition> {
    const [wf] = await db.insert(workflowDefinitions).values({ ...data, updatedAt: new Date() }).returning();
    return wf;
  }

  async updateWorkflowDefinition(id: number, data: Partial<InsertWorkflowDefinition>): Promise<WorkflowDefinition | undefined> {
    const [wf] = await db.update(workflowDefinitions).set({ ...data, updatedAt: new Date() }).where(eq(workflowDefinitions.id, id)).returning();
    return wf || undefined;
  }

  async deleteWorkflowDefinition(id: number): Promise<boolean> {
    const result = await db.delete(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getWorkflowEnvironmentConfigs(workflowId: number): Promise<WorkflowEnvironmentConfig[]> {
    return db.select().from(workflowEnvironmentConfigs).where(eq(workflowEnvironmentConfigs.workflowId, workflowId));
  }

  async upsertWorkflowEnvironmentConfig(workflowId: number, environment: string, config: any): Promise<WorkflowEnvironmentConfig> {
    const existing = await db.select().from(workflowEnvironmentConfigs)
      .where(and(eq(workflowEnvironmentConfigs.workflowId, workflowId), eq(workflowEnvironmentConfigs.environment, environment)));
    if (existing.length > 0) {
      const [updated] = await db.update(workflowEnvironmentConfigs)
        .set({ config, updatedAt: new Date() })
        .where(eq(workflowEnvironmentConfigs.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(workflowEnvironmentConfigs).values({ workflowId, environment, config }).returning();
    return created;
  }

  async deleteWorkflowEnvironmentConfig(workflowId: number, environment: string): Promise<void> {
    await db.delete(workflowEnvironmentConfigs).where(
      and(
        eq(workflowEnvironmentConfigs.workflowId, workflowId),
        eq(workflowEnvironmentConfigs.environment, environment)
      )
    );
  }

  // ─── External Endpoints Registry ────────────────────────────────────────────

  async listExternalEndpoints(filters?: { search?: string; isActive?: boolean }): Promise<ExternalEndpoint[]> {
    const conds: any[] = [];
    if (filters?.search) {
      const term = `%${filters.search}%`;
      conds.push(or(ilike(externalEndpoints.name, term), ilike(externalEndpoints.url, term)));
    }
    if (typeof filters?.isActive === 'boolean') {
      conds.push(eq(externalEndpoints.isActive, filters.isActive));
    }
    const q = db.select().from(externalEndpoints);
    const rows = conds.length ? await q.where(and(...conds)).orderBy(externalEndpoints.name) : await q.orderBy(externalEndpoints.name);
    return rows;
  }

  async getExternalEndpoint(id: number): Promise<ExternalEndpoint | undefined> {
    const [row] = await db.select().from(externalEndpoints).where(eq(externalEndpoints.id, id));
    return row || undefined;
  }

  async getExternalEndpointByName(name: string): Promise<ExternalEndpoint | undefined> {
    const [row] = await db.select().from(externalEndpoints).where(eq(externalEndpoints.name, name));
    return row || undefined;
  }

  async createExternalEndpoint(data: InsertExternalEndpoint): Promise<ExternalEndpoint> {
    const [row] = await db.insert(externalEndpoints).values({ ...data, updatedAt: new Date() }).returning();
    return row;
  }

  async updateExternalEndpoint(id: number, data: Partial<InsertExternalEndpoint>): Promise<ExternalEndpoint | undefined> {
    const [row] = await db.update(externalEndpoints)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(externalEndpoints.id, id))
      .returning();
    return row || undefined;
  }

  async deleteExternalEndpoint(id: number): Promise<boolean> {
    const result = await db.delete(externalEndpoints).where(eq(externalEndpoints.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Paginated list helpers ────────────────────────────────────────────────
  // These return { items, total } using SQL-side LIMIT/OFFSET + COUNT(*) so we
  // never load entire tables into memory. Filters (search/status) are pushed
  // into SQL via Drizzle (`ilike` / `eq`) instead of being applied in JS.

  // ──────────────────────────────────────────────────────────────────────
  // Per-request DB ENVIRONMENT ISOLATION:
  // The `db` import (server/db.ts) is an AsyncLocalStorage-backed proxy.
  // When a request is wrapped by `dbEnvironmentMiddleware` (which calls
  // `runWithDb(req.dynamicDB, next)` on every request), every `db.*` call
  // inside the request handler (and any awaited descendants — including
  // these storage methods) resolves to that request's environment-scoped
  // Drizzle client. This is the same pattern used by the other 191 `db.*`
  // call sites in this file. Do NOT replace `db` here with a global import
  // outside of `runWithDb`; doing so would silently bypass env isolation.
  // ──────────────────────────────────────────────────────────────────────
  async getMerchantsPaged(opts: {
    offset: number; limit: number; search?: string; status?: string;
  }): Promise<{ items: MerchantWithAgent[]; total: number }> {
    const conds: SQL[] = [];
    if (opts.search) {
      const q = `%${opts.search}%`;
      const searchExpr = or(
        ilike(merchants.businessName, q),
        ilike(merchants.email, q),
        ilike(merchants.businessType, q),
      );
      if (searchExpr) conds.push(searchExpr);
    }
    if (opts.status && opts.status !== "all") conds.push(eq(merchants.status, opts.status));
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({ merchant: merchants, agent: agents })
      .from(merchants)
      .leftJoin(agents, eq(merchants.agentId, agents.id))
      .where(where)
      .orderBy(desc(merchants.id))
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(merchants)
      .where(where);

    return {
      items: rows.map(r => ({ ...r.merchant, agent: r.agent || undefined })),
      total: Number(total ?? 0),
    };
  }

  async getMerchantsForUserPaged(userId: string, opts: {
    offset: number; limit: number; search?: string; status?: string;
  }): Promise<{ items: MerchantWithAgent[]; total: number }> {
    const user = await this.getUser(userId);
    if (!user) return { items: [], total: 0 };
    const role = user.role ?? "";
    if (["super_admin", "admin", "corporate"].includes(role)) {
      return this.getMerchantsPaged(opts);
    }
    if (role === "agent") {
      const [agentRow] = await db.select().from(agents).where(eq(agents.userId, userId)).limit(1);
      if (!agentRow) return { items: [], total: 0 };
      const conds: SQL[] = [eq(merchants.agentId, agentRow.id)];
      if (opts.search) {
        const q = `%${opts.search}%`;
        const searchExpr = or(ilike(merchants.businessName, q), ilike(merchants.email, q));
        if (searchExpr) conds.push(searchExpr);
      }
      if (opts.status && opts.status !== "all") conds.push(eq(merchants.status, opts.status));
      const where = and(...conds);
      const rows = await db
        .select({ merchant: merchants, agent: agents })
        .from(merchants)
        .leftJoin(agents, eq(merchants.agentId, agents.id))
        .where(where)
        .orderBy(desc(merchants.id))
        .limit(opts.limit).offset(opts.offset);
      const [{ value: total }] = await db.select({ value: count() }).from(merchants).where(where);
      return {
        items: rows.map(r => ({ ...r.merchant, agent: r.agent || undefined })),
        total: Number(total ?? 0),
      };
    }
    if (role === "merchant") {
      const [m] = await db.select().from(merchants).where(eq(merchants.userId, userId)).limit(1);
      return m ? { items: [{ ...m }], total: 1 } : { items: [], total: 0 };
    }
    return { items: [], total: 0 };
  }

  async getAgentsPaged(opts: {
    offset: number; limit: number; search?: string; status?: string;
  }): Promise<{ items: Agent[]; total: number }> {
    const conds: SQL[] = [];
    if (opts.search) {
      const q = `%${opts.search}%`;
      const searchExpr = or(
        ilike(agents.firstName, q),
        ilike(agents.lastName, q),
        ilike(agents.email, q),
      );
      if (searchExpr) conds.push(searchExpr);
    }
    if (opts.status && opts.status !== "all") conds.push(eq(agents.status, opts.status));
    const where = conds.length ? and(...conds) : undefined;

    const items = await db.select().from(agents)
      .where(where)
      .orderBy(desc(agents.id))
      .limit(opts.limit).offset(opts.offset);
    const [{ value: total }] = await db.select({ value: count() }).from(agents).where(where);
    return { items, total: Number(total ?? 0) };
  }

  async getTransactionsPaged(opts: {
    offset: number; limit: number; search?: string; status?: string;
    merchantIds?: number[];
  }): Promise<{ items: TransactionWithMerchant[]; total: number }> {
    const conds: SQL[] = [];
    if (opts.search) {
      const q = `%${opts.search}%`;
      const searchExpr = or(
        ilike(transactions.transactionId, q),
        ilike(transactions.paymentMethod, q),
        ilike(transactions.mid, q),
        ilike(merchants.businessName, q),
      );
      if (searchExpr) conds.push(searchExpr);
    }
    if (opts.status && opts.status !== "all") conds.push(eq(transactions.status, opts.status));
    if (opts.merchantIds) {
      if (opts.merchantIds.length === 0) return { items: [], total: 0 };
      conds.push(inArray(transactions.merchantId, opts.merchantIds));
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({ transaction: transactions, merchant: merchants })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(opts.limit).offset(opts.offset);
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .where(where);
    return {
      items: rows.map(r => ({ ...r.transaction, merchant: r.merchant || undefined })),
      total: Number(total ?? 0),
    };
  }

  async getTransactionsForUserPaged(userId: string, opts: {
    offset: number; limit: number; search?: string; status?: string;
  }): Promise<{ items: TransactionWithMerchant[]; total: number }> {
    const user = await this.getUser(userId);
    if (!user) return { items: [], total: 0 };
    const role = user.role ?? "";
    if (["super_admin", "admin", "corporate"].includes(role)) {
      return this.getTransactionsPaged(opts);
    }
    if (role === "agent") {
      const [agentRow] = await db.select().from(agents).where(eq(agents.userId, userId)).limit(1);
      if (!agentRow) return { items: [], total: 0 };
      const merchantRows = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.agentId, agentRow.id));
      return this.getTransactionsPaged({ ...opts, merchantIds: merchantRows.map(m => m.id) });
    }
    if (role === "merchant") {
      const [m] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.userId, userId)).limit(1);
      if (!m) return { items: [], total: 0 };
      return this.getTransactionsPaged({ ...opts, merchantIds: [m.id] });
    }
    return { items: [], total: 0 };
  }

  async getUsersPaged(opts: {
    offset: number; limit: number; search?: string;
  }): Promise<{ items: User[]; total: number }> {
    const conds: SQL[] = [];
    if (opts.search) {
      const q = `%${opts.search}%`;
      const searchExpr = or(
        ilike(users.username, q),
        ilike(users.email, q),
        ilike(users.firstName, q),
        ilike(users.lastName, q),
      );
      if (searchExpr) conds.push(searchExpr);
    }
    const where = conds.length ? and(...conds) : undefined;
    const items = await db.select().from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(opts.limit).offset(opts.offset);
    const [{ value: total }] = await db.select({ value: count() }).from(users).where(where);
    return { items: this.withRoles(items), total: Number(total ?? 0) };
  }

  async getMerchantProspectsPaged(opts: {
    offset: number; limit: number; search?: string; status?: string; agentId?: number;
  }): Promise<{ items: MerchantProspect[]; total: number }> {
    const conds: SQL[] = [];
    if (opts.agentId !== undefined) conds.push(eq(merchantProspects.agentId, opts.agentId));
    if (opts.search) {
      const q = `%${opts.search}%`;
      const searchExpr = or(
        ilike(merchantProspects.firstName, q),
        ilike(merchantProspects.lastName, q),
        ilike(merchantProspects.email, q),
      );
      if (searchExpr) conds.push(searchExpr);
    }
    if (opts.status && opts.status !== "all") conds.push(eq(merchantProspects.status, opts.status));
    const where = conds.length ? and(...conds) : undefined;
    const items = await db.select().from(merchantProspects)
      .where(where)
      .orderBy(desc(merchantProspects.createdAt))
      .limit(opts.limit).offset(opts.offset);
    const [{ value: total }] = await db.select({ value: count() }).from(merchantProspects).where(where);
    return { items, total: Number(total ?? 0) };
  }
}

export const storage = new DatabaseStorage();
export default storage;
