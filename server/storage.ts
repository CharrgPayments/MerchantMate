import { companies, merchants, agents, transactions, users, loginAttempts, twoFactorCodes, userDashboardPreferences, agentMerchants, locations, addresses, pdfForms, pdfFormFields, pdfFormSubmissions, merchantProspects, prospectOwners, prospectSignatures, signatureCaptures, feeGroups, feeItemGroups, feeItems, pricingTypes, pricingTypeFeeItems, campaigns, campaignFeeValues, campaignAssignments, equipmentItems, campaignEquipment, campaignApplicationTemplates, acquirerApplicationTemplates, apiKeys, apiRequestLogs, emailWrappers, emailTemplates, emailActivity, emailTriggers, actionTemplates, triggerCatalog, triggerActions, userAlerts, acquirers, type Merchant, type Agent, type Transaction, type User, type InsertMerchant, type InsertAgent, type InsertTransaction, type UpsertUser, type MerchantWithAgent, type TransactionWithMerchant, type LoginAttempt, type TwoFactorCode, type UserDashboardPreference, type InsertUserDashboardPreference, type AgentMerchant, type InsertAgentMerchant, type Location, type InsertLocation, type Address, type InsertAddress, type LocationWithAddresses, type MerchantWithLocations, type PdfForm, type InsertPdfForm, type PdfFormField, type InsertPdfFormField, type PdfFormSubmission, type InsertPdfFormSubmission, type PdfFormWithFields, type MerchantProspect, type InsertMerchantProspect, type MerchantProspectWithAgent, type ProspectOwner, type InsertProspectOwner, type ProspectSignature, type InsertProspectSignature, type SignatureCapture, type InsertSignatureCapture, type FeeGroup, type InsertFeeGroup, type FeeItemGroup, type InsertFeeItemGroup, type FeeItem, type InsertFeeItem, type PricingType, type InsertPricingType, type PricingTypeFeeItem, type InsertPricingTypeFeeItem, type Campaign, type InsertCampaign, type CampaignFeeValue, type InsertCampaignFeeValue, type CampaignAssignment, type InsertCampaignAssignment, type EquipmentItem, type InsertEquipmentItem, type CampaignEquipment, type InsertCampaignEquipment, type CampaignApplicationTemplate, type InsertCampaignApplicationTemplate, type AcquirerApplicationTemplate, type FeeGroupWithItems, type FeeItemGroupWithItems, type FeeGroupWithItemGroups, type PricingTypeWithFeeItems, type CampaignWithDetails, type ApiKey, type InsertApiKey, type ApiRequestLog, type InsertApiRequestLog, type EmailWrapper, type InsertEmailWrapper, type EmailTemplate, type InsertEmailTemplate, type EmailActivity, type InsertEmailActivity, type EmailTrigger, type InsertEmailTrigger, type ActionTemplate, type InsertActionTemplate, type TriggerCatalog, type InsertTriggerCatalog, type TriggerAction, type InsertTriggerAction, type UserAlert, type InsertUserAlert } from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, and, gte, sql, desc, inArray, like, ilike, not } from "drizzle-orm";

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

  // Signature Capture operations (generic signature system)
  createSignatureCapture(signature: InsertSignatureCapture): Promise<SignatureCapture>;
  getSignatureCapture(id: number): Promise<SignatureCapture | undefined>;
  getSignatureCaptureByToken(token: string): Promise<SignatureCapture | undefined>;
  getSignatureCapturesByApplication(applicationId: number): Promise<SignatureCapture[]>;
  getSignatureCapturesByProspect(prospectId: number): Promise<SignatureCapture[]>;
  updateSignatureCapture(id: number, updates: Partial<InsertSignatureCapture>): Promise<SignatureCapture | undefined>;
  getExpiredSignatureCaptures(): Promise<SignatureCapture[]>;
  getSignatureCapturesByStatus(status: string): Promise<SignatureCapture[]>;

  // Email Management operations
  getAllEmailWrappers(): Promise<EmailWrapper[]>;
  getEmailWrapper(id: number): Promise<EmailWrapper | undefined>;
  getEmailWrapperByName(name: string): Promise<EmailWrapper | undefined>;
  createEmailWrapper(wrapper: InsertEmailWrapper): Promise<EmailWrapper>;
  updateEmailWrapper(id: number, updates: Partial<InsertEmailWrapper>): Promise<EmailWrapper | undefined>;
  deleteEmailWrapper(id: number): Promise<boolean>;

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
    delivered: number;
    totalOpened: number;
    totalClicked: number;
    totalFailed: number;
    deliveryRate: number;
    openRate: number;
    clickRate: number;
  }>;
  updateEmailActivityByWebhook(recipientEmail: string, eventType: string, eventTimestamp: Date, dbClient?: any): Promise<void>;

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
  createCampaign(campaign: InsertCampaign, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[], templateIds?: number[]): Promise<Campaign>;
  updateCampaign(id: number, updates: Partial<InsertCampaign>, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[], templateIds?: number[]): Promise<Campaign | undefined>;
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

  // Campaign Application Template operations
  getCampaignTemplates(campaignId: number): Promise<(CampaignApplicationTemplate & { template: AcquirerApplicationTemplate })[]>;
  addTemplateToCampaign(campaignId: number, templateId: number, isPrimary?: boolean, displayOrder?: number): Promise<CampaignApplicationTemplate>;
  removeTemplateFromCampaign(campaignId: number, templateId: number): Promise<boolean>;
  updateCampaignTemplate(campaignId: number, templateId: number, updates: Partial<InsertCampaignApplicationTemplate>): Promise<CampaignApplicationTemplate | undefined>;

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
  
  // Action Template operations
  getAllActionTemplates(): Promise<ActionTemplate[]>;
  getActionTemplatesByType(actionType: string): Promise<ActionTemplate[]>;
  getActionTemplate(id: number): Promise<ActionTemplate | undefined>;
  createActionTemplate(template: InsertActionTemplate): Promise<ActionTemplate>;
  updateActionTemplate(id: number, updates: Partial<InsertActionTemplate>): Promise<ActionTemplate | undefined>;
  deleteActionTemplate(id: number): Promise<boolean>;
  getActionTemplateUsage(templateId: number): Promise<Array<{ triggerId: number; triggerName: string; triggerKey: string; isActive: boolean }>>;
  getAllActionTemplateUsage(): Promise<Record<number, Array<{ triggerId: number; triggerName: string; triggerKey: string; isActive: boolean }>>>;

  // User Alert operations
  getUserAlerts(userId: string, includeRead?: boolean): Promise<UserAlert[]>;
  getUnreadAlertCount(userId: string): Promise<number>;
  createUserAlert(alert: InsertUserAlert): Promise<UserAlert>;
  markAlertAsRead(alertId: number, userId: string): Promise<UserAlert | undefined>;
  markAllAlertsAsRead(userId: string): Promise<number>;
  deleteAlert(alertId: number, userId: string): Promise<boolean>;
  deleteAllReadAlerts(userId: string): Promise<number>;

  // Trigger Catalog operations
  getAllTriggerCatalog(): Promise<TriggerCatalog[]>;
  getTriggerCatalog(id: number): Promise<TriggerCatalog | undefined>;
  getTriggerCatalogByKey(triggerKey: string): Promise<TriggerCatalog | undefined>;
  createTriggerCatalog(trigger: InsertTriggerCatalog): Promise<TriggerCatalog>;
  updateTriggerCatalog(id: number, updates: Partial<InsertTriggerCatalog>): Promise<TriggerCatalog | undefined>;
  deleteTriggerCatalog(id: number): Promise<boolean>;

  // Trigger Actions operations
  getTriggerActions(triggerId: number): Promise<(TriggerAction & { actionTemplate: ActionTemplate })[]>;
  createTriggerAction(triggerAction: InsertTriggerAction): Promise<TriggerAction>;
  updateTriggerAction(id: number, updates: Partial<InsertTriggerAction>): Promise<TriggerAction | undefined>;
  deleteTriggerAction(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private db: typeof db;

  constructor(dbInstance: typeof db) {
    this.db = dbInstance;
  }

  // Fee Groups implementation
  async getAllFeeGroups(): Promise<FeeGroupWithItems[]> {
    const groups = await this.db.select().from(feeGroups).orderBy(feeGroups.displayOrder);
    const result: FeeGroupWithItems[] = [];
    
    for (const group of groups) {
      const groupItems = await this.db.select().from(feeItems)
        .where(eq(feeItems.feeGroupId, group.id))
        .orderBy(feeItems.displayOrder);
      
      result.push({
        ...group,
        feeItems: groupItems
      });
    }
    
    return result;
  }

  async getFeeGroup(id: number): Promise<FeeGroup | undefined> {
    const [feeGroup] = await this.db.select().from(feeGroups).where(eq(feeGroups.id, id));
    return feeGroup || undefined;
  }

  async getFeeGroupWithItemGroups(id: number): Promise<FeeGroupWithItemGroups | undefined> {
    const [feeGroup] = await this.db.select().from(feeGroups).where(eq(feeGroups.id, id));
    if (!feeGroup) return undefined;

    const itemGroups = await this.db.select().from(feeItemGroups)
      .where(eq(feeItemGroups.feeGroupId, id))
      .orderBy(feeItemGroups.displayOrder);

    const feeItemGroupsWithItems: FeeItemGroupWithItems[] = [];
    for (const itemGroup of itemGroups) {
      const items = await this.db.select().from(feeItems)
        .where(eq(feeItems.feeItemGroupId, itemGroup.id))
        .orderBy(feeItems.displayOrder);
      
      feeItemGroupsWithItems.push({
        ...itemGroup,
        feeItems: items
      });
    }

    const directItems = await this.db.select().from(feeItems)
      .where(and(eq(feeItems.feeGroupId, id), sql`${feeItems.feeItemGroupId} IS NULL`))
      .orderBy(feeItems.displayOrder);

    return {
      ...feeGroup,
      feeItemGroups: feeItemGroupsWithItems,
      feeItems: directItems
    };
  }

  async createFeeGroup(feeGroup: InsertFeeGroup): Promise<FeeGroup> {
    const [created] = await this.db.insert(feeGroups).values(feeGroup).returning();
    return created;
  }

  async updateFeeGroup(id: number, updates: Partial<InsertFeeGroup>): Promise<FeeGroup | undefined> {
    const [updated] = await this.db.update(feeGroups).set(updates).where(eq(feeGroups.id, id)).returning();
    return updated || undefined;
  }

  // Fee Item Groups implementation
  async getAllFeeItemGroups(): Promise<FeeItemGroup[]> {
    return await this.db.select().from(feeItemGroups).orderBy(feeItemGroups.displayOrder);
  }

  async getFeeItemGroup(id: number): Promise<FeeItemGroup | undefined> {
    const [feeItemGroup] = await this.db.select().from(feeItemGroups).where(eq(feeItemGroups.id, id));
    return feeItemGroup || undefined;
  }

  async getFeeItemGroupsByFeeGroup(feeGroupId: number): Promise<FeeItemGroup[]> {
    return await this.db.select().from(feeItemGroups)
      .where(eq(feeItemGroups.feeGroupId, feeGroupId))
      .orderBy(feeItemGroups.displayOrder);
  }

  async getFeeItemGroupWithItems(id: number): Promise<FeeItemGroupWithItems | undefined> {
    const [feeItemGroup] = await this.db.select().from(feeItemGroups).where(eq(feeItemGroups.id, id));
    if (!feeItemGroup) return undefined;

    const items = await this.db.select().from(feeItems)
      .where(eq(feeItems.feeItemGroupId, id))
      .orderBy(feeItems.displayOrder);

    return {
      ...feeItemGroup,
      feeItems: items
    };
  }

  async createFeeItemGroup(feeItemGroup: InsertFeeItemGroup): Promise<FeeItemGroup> {
    const [created] = await this.db.insert(feeItemGroups).values(feeItemGroup).returning();
    return created;
  }

  async updateFeeItemGroup(id: number, updates: Partial<InsertFeeItemGroup>): Promise<FeeItemGroup | undefined> {
    const [updated] = await this.db.update(feeItemGroups).set(updates).where(eq(feeItemGroups.id, id)).returning();
    return updated || undefined;
  }

  async deleteFeeItemGroup(id: number): Promise<boolean> {
    const result = await this.db.delete(feeItemGroups).where(eq(feeItemGroups.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Fee Items implementation
  async getAllFeeItems(): Promise<(FeeItem & { feeGroup: FeeGroup })[]> {
    const result = await this.db.select({
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
    const [feeItem] = await this.db.select().from(feeItems).where(eq(feeItems.id, id));
    return feeItem || undefined;
  }

  async getFeeItemsByGroup(feeGroupId: number): Promise<FeeItem[]> {
    return await this.db.select().from(feeItems).where(eq(feeItems.feeGroupId, feeGroupId)).orderBy(feeItems.displayOrder);
  }

  async createFeeItem(feeItem: InsertFeeItem): Promise<FeeItem> {
    const [created] = await this.db.insert(feeItems).values(feeItem).returning();
    return created;
  }

  async updateFeeItem(id: number, updates: Partial<InsertFeeItem>): Promise<FeeItem | undefined> {
    const [updated] = await this.db.update(feeItems).set(updates).where(eq(feeItems.id, id)).returning();
    return updated || undefined;
  }

  async searchFeeItems(query: string): Promise<FeeItem[]> {
    return await this.db.select().from(feeItems).where(
      or(
        ilike(feeItems.name, `%${query}%`),
        ilike(feeItems.description, `%${query}%`)
      )
    ).orderBy(feeItems.displayOrder);
  }

  // Pricing Types implementation
  async getAllPricingTypes(): Promise<PricingType[]> {
    return await this.db.select().from(pricingTypes).orderBy(pricingTypes.name);
  }

  async getPricingType(id: number): Promise<PricingType | undefined> {
    const [pricingType] = await this.db.select().from(pricingTypes).where(eq(pricingTypes.id, id));
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
    const [created] = await this.db.insert(pricingTypes).values(pricingType).returning();
    return created;
  }

  async updatePricingType(id: number, updates: Partial<InsertPricingType>): Promise<PricingType | undefined> {
    const [updated] = await this.db.update(pricingTypes).set(updates).where(eq(pricingTypes.id, id)).returning();
    return updated || undefined;
  }

  async addFeeItemToPricingType(pricingTypeId: number, feeItemId: number, isRequired: boolean = false): Promise<PricingTypeFeeItem> {
    const [created] = await this.db.insert(pricingTypeFeeItems).values({
      pricingTypeId,
      feeItemId,
      isRequired,
      displayOrder: 1,
    }).returning();
    return created;
  }

  async removeFeeItemFromPricingType(pricingTypeId: number, feeItemId: number): Promise<boolean> {
    const result = await this.db.delete(pricingTypeFeeItems)
      .where(and(
        eq(pricingTypeFeeItems.pricingTypeId, pricingTypeId),
        eq(pricingTypeFeeItems.feeItemId, feeItemId)
      ));
    return result.rowCount > 0;
  }

  async searchPricingTypes(query: string): Promise<PricingType[]> {
    return await this.db.select().from(pricingTypes).where(
      or(
        ilike(pricingTypes.name, `%${query}%`),
        ilike(pricingTypes.description, `%${query}%`)
      )
    ).orderBy(pricingTypes.name);
  }

  async deletePricingType(id: number): Promise<{ success: boolean; message: string }> {
    // First check if pricing type has any associated fee items
    const associatedFeeItems = await this.db.select()
      .from(pricingTypeFeeItems)
      .where(eq(pricingTypeFeeItems.pricingTypeId, id));

    if (associatedFeeItems.length > 0) {
      return {
        success: false,
        message: `Cannot delete pricing type. It has ${associatedFeeItems.length} associated fee item(s). Please remove all fee item associations first.`
      };
    }

    // Check if pricing type is used by any campaigns
    const campaignsUsingPricingType = await this.db.select()
      .from(campaigns)
      .where(eq(campaigns.pricingTypeId, id));

    if (campaignsUsingPricingType.length > 0) {
      return {
        success: false,
        message: `Cannot delete pricing type. It is being used by ${campaignsUsingPricingType.length} campaign(s).`
      };
    }

    // If no associations, delete the pricing type
    const result = await this.db.delete(pricingTypes)
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
        const existingPricingType = await this.db.select()
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
      const [updatedPricingType] = await this.db.update(pricingTypes)
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
      const deleteResult = await this.db.delete(pricingTypeFeeItems)
        .where(eq(pricingTypeFeeItems.pricingTypeId, id));
      console.log('Deleted associations count:', deleteResult.rowCount);

      // Then insert new associations
      if (updates.feeItemIds && updates.feeItemIds.length > 0) {
        console.log('Validating fee item IDs:', updates.feeItemIds);
        
        // Validate that all fee item IDs exist AND have valid fee groups
        const existingFeeItems = await this.db.select({ 
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
        const insertResult = await this.db.insert(pricingTypeFeeItems)
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
    const [campaign] = await this.db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign || undefined;
  }

  async getCampaignWithDetails(id: number): Promise<CampaignWithDetails | undefined> {
    const result = await db
      .select({
        campaign: campaigns,
        pricingType: pricingTypes,
        acquirer: acquirers,
      })
      .from(campaigns)
      .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
      .leftJoin(acquirers, eq(campaigns.acquirerId, acquirers.id))
      .where(eq(campaigns.id, id));

    if (result.length === 0) return undefined;

    const row = result[0];
    return {
      ...row.campaign,
      pricingType: row.pricingType || undefined,
      acquirer: row.acquirer?.displayName || row.acquirer?.name || row.campaign.acquirer || 'N/A',
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
    const result = await this.db.update(campaigns).set({ isActive: false }).where(eq(campaigns.id, id));
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
    const [existing] = await this.db.select().from(campaignFeeValues)
      .where(and(
        eq(campaignFeeValues.campaignId, campaignId),
        eq(campaignFeeValues.feeItemId, feeItemId)
      ));

    if (existing) {
      const [updated] = await this.db.update(campaignFeeValues)
        .set({ value, updatedAt: new Date() })
        .where(eq(campaignFeeValues.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await this.db.insert(campaignFeeValues).values({
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
    const [updated] = await this.db.update(campaignFeeValues)
      .set({ value, updatedAt: new Date() })
      .where(eq(campaignFeeValues.id, id))
      .returning();
    return updated || undefined;
  }

  // Campaign Assignments implementation
  async assignCampaignToProspect(campaignId: number, prospectId: number, assignedBy: string): Promise<CampaignAssignment> {
    const [created] = await this.db.insert(campaignAssignments).values({
      campaignId,
      prospectId,
      assignedBy,
    }).returning();
    return created;
  }

  async getCampaignAssignments(campaignId: number): Promise<CampaignAssignment[]> {
    return await this.db.select().from(campaignAssignments).where(eq(campaignAssignments.campaignId, campaignId));
  }

  async getProspectCampaignAssignment(prospectId: number): Promise<CampaignAssignment | undefined> {
    const [assignment] = await this.db.select().from(campaignAssignments).where(eq(campaignAssignments.prospectId, prospectId));
    return assignment || undefined;
  }

  // Equipment Items implementation
  async getAllEquipmentItems(): Promise<EquipmentItem[]> {
    return await this.db.select().from(equipmentItems).where(eq(equipmentItems.isActive, true)).orderBy(equipmentItems.name);
  }

  async getEquipmentItem(id: number): Promise<EquipmentItem | undefined> {
    const [item] = await this.db.select().from(equipmentItems).where(eq(equipmentItems.id, id));
    return item || undefined;
  }

  async createEquipmentItem(equipmentItem: InsertEquipmentItem): Promise<EquipmentItem> {
    const [created] = await this.db.insert(equipmentItems).values(equipmentItem).returning();
    return created;
  }

  async updateEquipmentItem(id: number, updates: Partial<InsertEquipmentItem>): Promise<EquipmentItem | undefined> {
    const [updated] = await this.db.update(equipmentItems).set({
      ...updates,
      updatedAt: new Date()
    }).where(eq(equipmentItems.id, id)).returning();
    return updated || undefined;
  }

  async deleteEquipmentItem(id: number): Promise<boolean> {
    const result = await this.db.update(equipmentItems).set({ isActive: false }).where(eq(equipmentItems.id, id));
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
    const [created] = await this.db.insert(campaignEquipment).values({
      campaignId,
      equipmentItemId,
      isRequired,
      displayOrder,
    }).returning();
    return created;
  }

  async removeEquipmentFromCampaign(campaignId: number, equipmentItemId: number): Promise<boolean> {
    const result = await this.db.delete(campaignEquipment)
      .where(and(
        eq(campaignEquipment.campaignId, campaignId),
        eq(campaignEquipment.equipmentItemId, equipmentItemId)
      ));
    return result.rowCount > 0;
  }

  async updateCampaignEquipment(campaignId: number, equipmentItemId: number, updates: Partial<InsertCampaignEquipment>): Promise<CampaignEquipment | undefined> {
    const [updated] = await this.db.update(campaignEquipment)
      .set(updates)
      .where(and(
        eq(campaignEquipment.campaignId, campaignId),
        eq(campaignEquipment.equipmentItemId, equipmentItemId)
      ))
      .returning();
    return updated || undefined;
  }

  // Campaign Application Template implementation
  async getCampaignTemplates(campaignId: number): Promise<(CampaignApplicationTemplate & { template: AcquirerApplicationTemplate })[]> {
    const result = await db
      .select({
        campaignTemplate: campaignApplicationTemplates,
        template: acquirerApplicationTemplates,
      })
      .from(campaignApplicationTemplates)
      .innerJoin(acquirerApplicationTemplates, eq(campaignApplicationTemplates.templateId, acquirerApplicationTemplates.id))
      .where(eq(campaignApplicationTemplates.campaignId, campaignId))
      .orderBy(campaignApplicationTemplates.displayOrder);

    return result.map(row => ({
      ...row.campaignTemplate,
      template: row.template,
    }));
  }

  async addTemplateToCampaign(campaignId: number, templateId: number, isPrimary: boolean = false, displayOrder: number = 0): Promise<CampaignApplicationTemplate> {
    const [created] = await this.db.insert(campaignApplicationTemplates).values({
      campaignId,
      templateId,
      isPrimary,
      displayOrder,
    }).returning();
    return created;
  }

  async removeTemplateFromCampaign(campaignId: number, templateId: number): Promise<boolean> {
    const result = await this.db.delete(campaignApplicationTemplates)
      .where(and(
        eq(campaignApplicationTemplates.campaignId, campaignId),
        eq(campaignApplicationTemplates.templateId, templateId)
      ));
    return result.rowCount > 0;
  }

  async updateCampaignTemplate(campaignId: number, templateId: number, updates: Partial<InsertCampaignApplicationTemplate>): Promise<CampaignApplicationTemplate | undefined> {
    const [updated] = await this.db.update(campaignApplicationTemplates)
      .set(updates)
      .where(and(
        eq(campaignApplicationTemplates.campaignId, campaignId),
        eq(campaignApplicationTemplates.templateId, templateId)
      ))
      .returning();
    return updated || undefined;
  }

  // Merchant operations
  async getMerchant(id: number): Promise<Merchant | undefined> {
    const [merchant] = await this.db.select().from(merchants).where(eq(merchants.id, id));
    return merchant || undefined;
  }

  async getMerchantByEmail(email: string): Promise<Merchant | undefined> {
    const [merchant] = await this.db.select().from(merchants).where(eq(merchants.email, email));
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
    const result = await this.db.delete(merchants).where(eq(merchants.id, id));
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
    return await this.db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
  }

  async getProspectSignaturesByProspect(prospectId: number): Promise<ProspectSignature[]> {
    return await this.db.select().from(prospectSignatures).where(eq(prospectSignatures.prospectId, prospectId));
  }

  async getProspectOwners(prospectId: number): Promise<ProspectOwner[]> {
    return await this.db.select().from(prospectOwners).where(eq(prospectOwners.prospectId, prospectId));
  }

  async getUserWidgetPreferences(userId: string): Promise<UserDashboardPreference[]> {
    return await this.db.select().from(userDashboardPreferences).where(eq(userDashboardPreferences.user_id, userId));
  }

  async createWidgetPreference(preference: InsertUserDashboardPreference): Promise<UserDashboardPreference> {
    const [created] = await this.db.insert(userDashboardPreferences).values(preference).returning();
    return created;
  }

  async updateWidgetPreference(id: number, updates: Partial<InsertUserDashboardPreference>): Promise<UserDashboardPreference | undefined> {
    const [updated] = await this.db.update(userDashboardPreferences).set(updates).where(eq(userDashboardPreferences.id, id)).returning();
    return updated || undefined;
  }

  async deleteWidgetPreference(id: number): Promise<boolean> {
    const result = await this.db.delete(userDashboardPreferences).where(eq(userDashboardPreferences.id, id));
    return result.rowCount > 0;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await this.db.insert(locations).values(location).returning();
    return created;
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await this.db.select().from(locations).where(eq(locations.id, id));
    return location || undefined;
  }

  async updateLocation(id: number, updates: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await this.db.update(locations).set(updates).where(eq(locations.id, id)).returning();
    return updated || undefined;
  }

  async deleteLocation(id: number): Promise<boolean> {
    const result = await this.db.delete(locations).where(eq(locations.id, id));
    return result.rowCount > 0;
  }

  async getAddressesByLocation(locationId: number): Promise<Address[]> {
    return await this.db.select().from(addresses).where(eq(addresses.locationId, locationId));
  }

  async createAddress(address: InsertAddress): Promise<Address> {
    const [created] = await this.db.insert(addresses).values(address).returning();
    return created;
  }

  async getAddress(id: number): Promise<Address | undefined> {
    const [address] = await this.db.select().from(addresses).where(eq(addresses.id, id));
    return address || undefined;
  }

  async updateAddress(id: number, updates: Partial<InsertAddress>): Promise<Address | undefined> {
    const [updated] = await this.db.update(addresses).set(updates).where(eq(addresses.id, id)).returning();
    return updated || undefined;
  }

  async deleteAddress(id: number): Promise<boolean> {
    const result = await this.db.delete(addresses).where(eq(addresses.id, id));
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
    const [created] = await this.db.insert(agentMerchants).values({
      agentId,
      merchantId,
      assignedBy,
    }).returning();
    return created;
  }

  async unassignAgentFromMerchant(agentId: number, merchantId: number): Promise<boolean> {
    const result = await this.db.delete(agentMerchants)
      .where(and(
        eq(agentMerchants.agentId, agentId),
        eq(agentMerchants.merchantId, merchantId)
      ));
    return result.rowCount > 0;
  }

  async searchMerchantProspectsByAgent(agentId: number, query: string) {
    const prospects = await this.db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
    return prospects.filter(p => 
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
      p.email.toLowerCase().includes(query.toLowerCase())
    );
  }

  async getMerchantProspectsByAgent(agentId: number) {
    return await this.db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
  }

  async searchMerchantProspects(query: string) {
    const prospects = await this.db.select().from(merchantProspects);
    return prospects.filter(p => 
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
      p.email.toLowerCase().includes(query.toLowerCase())
    );
  }

  async clearAllProspectData(): Promise<void> {
    await this.db.delete(prospectSignatures);
    await this.db.delete(prospectOwners);
    await this.db.delete(merchantProspects);
  }

  async updateProspectOwner(id: number, updates: Partial<ProspectOwner>): Promise<ProspectOwner | undefined> {
    const [updated] = await this.db.update(prospectOwners).set(updates).where(eq(prospectOwners.id, id)).returning();
    return updated || undefined;
  }

  async createProspectOwner(owner: InsertProspectOwner): Promise<ProspectOwner> {
    const [created] = await this.db.insert(prospectOwners).values(owner).returning();
    return created;
  }

  async getProspectOwnerBySignatureToken(token: string): Promise<ProspectOwner | undefined> {
    const [owner] = await this.db.select().from(prospectOwners).where(eq(prospectOwners.signatureToken, token));
    return owner || undefined;
  }

  async createProspectSignature(signature: InsertProspectSignature): Promise<ProspectSignature> {
    const [created] = await this.db.insert(prospectSignatures).values(signature).returning();
    return created;
  }

  async getProspectOwnerByEmailAndProspectId(email: string, prospectId: number): Promise<ProspectOwner | undefined> {
    const [owner] = await this.db.select().from(prospectOwners)
      .where(and(
        eq(prospectOwners.email, email),
        eq(prospectOwners.prospectId, prospectId)
      ));
    return owner || undefined;
  }

  async getProspectSignature(token: string): Promise<ProspectSignature | undefined> {
    const [signature] = await this.db.select().from(prospectSignatures).where(eq(prospectSignatures.signatureToken, token));
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

  // Signature Capture implementations
  async createSignatureCapture(signature: InsertSignatureCapture): Promise<SignatureCapture> {
    const [created] = await this.db.insert(signatureCaptures).values(signature).returning();
    return created;
  }

  async getSignatureCapture(id: number): Promise<SignatureCapture | undefined> {
    const [capture] = await this.db.select().from(signatureCaptures).where(eq(signatureCaptures.id, id));
    return capture || undefined;
  }

  async getSignatureCaptureByToken(token: string): Promise<SignatureCapture | undefined> {
    const [capture] = await this.db.select().from(signatureCaptures).where(eq(signatureCaptures.requestToken, token));
    return capture || undefined;
  }

  async getSignatureCapturesByApplication(applicationId: number): Promise<SignatureCapture[]> {
    return await this.db.select().from(signatureCaptures).where(eq(signatureCaptures.applicationId, applicationId));
  }

  async getSignatureCapturesByProspect(prospectId: number): Promise<SignatureCapture[]> {
    return await this.db.select().from(signatureCaptures).where(eq(signatureCaptures.prospectId, prospectId));
  }

  async updateSignatureCapture(id: number, updates: Partial<InsertSignatureCapture>): Promise<SignatureCapture | undefined> {
    const [updated] = await this.db.update(signatureCaptures).set(updates).where(eq(signatureCaptures.id, id)).returning();
    return updated || undefined;
  }

  async getExpiredSignatureCaptures(): Promise<SignatureCapture[]> {
    return await this.db.select().from(signatureCaptures)
      .where(and(
        eq(signatureCaptures.status, 'requested'),
        sql`${signatureCaptures.timestampExpires} < NOW()`
      ));
  }

  async getSignatureCapturesByStatus(status: string): Promise<SignatureCapture[]> {
    return await this.db.select().from(signatureCaptures).where(eq(signatureCaptures.status, status));
  }

  async getAgentByUserId(userId: string): Promise<Agent | undefined> {
    // CRITICAL PATTERN: User → user_company_associations → Company → Agent
    // This generic pattern works consistently for agents, merchants, and future roles
    const result = await pool.query(
      `SELECT a.* FROM agents a
       INNER JOIN user_company_associations uca ON uca.company_id = a.company_id
       WHERE uca.user_id = $1 AND uca.is_active = true
       ORDER BY uca.is_primary DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || undefined;
  }

  async createPdfForm(form: InsertPdfForm): Promise<PdfForm> {
    const [created] = await this.db.insert(pdfForms).values(form).returning();
    return created;
  }

  async createPdfFormField(field: InsertPdfFormField): Promise<PdfFormField> {
    const [created] = await this.db.insert(pdfFormFields).values(field).returning();
    return created;
  }

  async getPdfFormWithFields(id: number): Promise<PdfFormWithFields | undefined> {
    const [form] = await this.db.select().from(pdfForms).where(eq(pdfForms.id, id));
    if (!form) return undefined;

    const fields = await this.db.select().from(pdfFormFields).where(eq(pdfFormFields.formId, id));
    
    return {
      ...form,
      fields
    };
  }

  async updatePdfForm(id: number, updates: Partial<InsertPdfForm>): Promise<PdfForm | undefined> {
    const [updated] = await this.db.update(pdfForms).set(updates).where(eq(pdfForms.id, id)).returning();
    return updated || undefined;
  }

  generateSubmissionToken(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createPdfFormSubmission(submission: InsertPdfFormSubmission): Promise<PdfFormSubmission> {
    const [created] = await this.db.insert(pdfFormSubmissions).values(submission).returning();
    return created;
  }

  async getPdfFormSubmissions(formId: number): Promise<PdfFormSubmission[]> {
    return await this.db.select().from(pdfFormSubmissions).where(eq(pdfFormSubmissions.formId, formId));
  }

  async getPdfFormSubmissionByToken(token: string): Promise<PdfFormSubmission | undefined> {
    const [submission] = await this.db.select().from(pdfFormSubmissions).where(eq(pdfFormSubmissions.submissionToken, token));
    return submission || undefined;
  }

  async updatePdfFormSubmissionByToken(token: string, updates: Partial<InsertPdfFormSubmission>): Promise<PdfFormSubmission | undefined> {
    const [updated] = await this.db.update(pdfFormSubmissions).set(updates).where(eq(pdfFormSubmissions.submissionToken, token)).returning();
    return updated || undefined;
  }

  async createCampaign(campaign: InsertCampaign, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[], templateIds?: number[]): Promise<Campaign> {
    const [created] = await this.db.insert(campaigns).values(campaign).returning();
    
    // Associate equipment if provided
    if (equipmentIds && equipmentIds.length > 0) {
      for (const equipmentId of equipmentIds) {
        await this.addEquipmentToCampaign(created.id, equipmentId);
      }
    }
    
    // Associate templates if provided
    if (templateIds && templateIds.length > 0) {
      for (let i = 0; i < templateIds.length; i++) {
        const templateId = templateIds[i];
        const isPrimary = i === 0; // First template is primary
        await this.addTemplateToCampaign(created.id, templateId, isPrimary, i);
      }
    }
    
    return created;
  }

  async getPdfForm(id: number): Promise<PdfForm | undefined> {
    const [form] = await this.db.select().from(pdfForms).where(eq(pdfForms.id, id));
    return form || undefined;
  }

  async updateCampaign(id: number, updates: Partial<InsertCampaign>, feeValues?: InsertCampaignFeeValue[], equipmentIds?: number[], templateIds?: number[]): Promise<Campaign | undefined> {
    const [updated] = await this.db.update(campaigns).set(updates).where(eq(campaigns.id, id)).returning();
    
    if (!updated) return undefined;
    
    // Update equipment associations if provided
    if (equipmentIds !== undefined) {
      // Remove existing equipment
      await this.db.delete(campaignEquipment).where(eq(campaignEquipment.campaignId, id));
      // Add new equipment
      for (const equipmentId of equipmentIds) {
        await this.addEquipmentToCampaign(id, equipmentId);
      }
    }
    
    // Update template associations if provided
    if (templateIds !== undefined) {
      // Remove existing templates
      await this.db.delete(campaignApplicationTemplates).where(eq(campaignApplicationTemplates.campaignId, id));
      // Add new templates
      for (let i = 0; i < templateIds.length; i++) {
        const templateId = templateIds[i];
        const isPrimary = i === 0; // First template is primary
        await this.addTemplateToCampaign(id, templateId, isPrimary, i);
      }
    }
    
    return updated;
  }

  async getPricingTypeFeeItems(pricingTypeId: number) {
    return await this.getPricingTypeWithFeeItems(pricingTypeId);
  }

  // Agent operations
  async getAgent(id: number): Promise<Agent | undefined> {
    const [result] = await this.db.select({
      id: agents.id,
      userId: agents.userId,
      companyId: agents.companyId,
      firstName: agents.firstName,
      lastName: agents.lastName,
      territory: agents.territory,
      commissionRate: agents.commissionRate,
      status: agents.status,
      createdAt: agents.createdAt,
      // Include company information
      companyName: companies.name,
      companyEmail: companies.email,
      companyPhone: companies.phone,
      // Alias for backward compatibility
      email: companies.email,
      phone: companies.phone,
    })
    .from(agents)
    .leftJoin(companies, eq(agents.companyId, companies.id))
    .where(eq(agents.id, id));
    
    return result || undefined;
  }

  async getAllAgents(): Promise<Agent[]> {
    return await this.db.select({
      id: agents.id,
      userId: agents.userId,
      companyId: agents.companyId,
      firstName: agents.firstName,
      lastName: agents.lastName,
      territory: agents.territory,
      commissionRate: agents.commissionRate,
      status: agents.status,
      createdAt: agents.createdAt,
      // Include company information
      companyName: companies.name,
      companyEmail: companies.email,
      companyPhone: companies.phone,
      // Alias for backward compatibility
      email: companies.email,
      phone: companies.phone,
    })
    .from(agents)
    .leftJoin(companies, eq(agents.companyId, companies.id));
  }

  async createAgent(insertAgent: InsertAgent): Promise<Agent> {
    const [agent] = await db
      .insert(agents)
      .values(insertAgent)
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
    const result = await this.db.delete(agents).where(eq(agents.id, id));
    return (result.rowCount || 0) > 0;
  }

  async searchAgents(query: string): Promise<Agent[]> {
    // Join with companies and users to search by email/phone (company-centric architecture)
    const results = await db
      .select({ agent: agents, company: companies, user: users })
      .from(agents)
      .leftJoin(companies, eq(agents.companyId, companies.id))
      .leftJoin(users, eq(agents.userId, users.id));
    
    // Filter by name, company email, user email, or territory
    const queryLower = query.toLowerCase();
    return results
      .filter(row => {
        const agent = row.agent;
        const company = row.company;
        const user = row.user;
        
        return (
          `${agent.firstName} ${agent.lastName}`.toLowerCase().includes(queryLower) ||
          (company?.email && company.email.toLowerCase().includes(queryLower)) ||
          (user?.email && user.email.toLowerCase().includes(queryLower)) ||
          (agent.territory && agent.territory.toLowerCase().includes(queryLower))
        );
      })
      .map(row => row.agent);
  }

  // Transaction operations
  async getTransaction(id: number): Promise<Transaction | undefined> {
    const [transaction] = await this.db.select().from(transactions).where(eq(transactions.id, id));
    return transaction || undefined;
  }

  async getTransactionByTransactionId(transactionId: string): Promise<Transaction | undefined> {
    const [transaction] = await this.db.select().from(transactions).where(eq(transactions.transactionId, transactionId));
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
    return transaction;
  }

  async updateTransaction(id: number, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [transaction] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.id, id))
      .returning();
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
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    console.log('Storage.getUser - Found:', user ? `${user.username} (${user.id})` : 'null');
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByUsernameOrEmail(username: string, email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(
      or(eq(users.username, username), eq(users.email, email))
    );
    return user || undefined;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.passwordResetToken, token));
    return user || undefined;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user || undefined;
  }

  async createUser(userData: Partial<UpsertUser>): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData as UpsertUser)
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await this.db.select().from(users);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<UpsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
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
    const result = await this.db.delete(users).where(eq(users.id, id));
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
    if (user.roles.some(role => ['super_admin', 'admin'].includes(role))) {
      return this.getAllMerchants();
    }

    // Agent can see their assigned merchants
    // CRITICAL PATTERN: User → user_company_associations → Company → Agent
    if (user.roles.includes('agent')) {
      const agent = await this.getAgentByUserId(userId);
      if (agent) {
        return this.getMerchantsByAgent(agent.id);
      }
    }

    // Merchant can see only their own data
    // CRITICAL PATTERN: User → user_company_associations → Company → Merchant
    if (user.roles.includes('merchant')) {
      const result = await pool.query(
        `SELECT m.* FROM merchants m
         INNER JOIN user_company_associations uca ON uca.company_id = m.company_id
         WHERE uca.user_id = $1 AND uca.is_active = true
         ORDER BY uca.is_primary DESC
         LIMIT 1`,
        [userId]
      );
      if (result.rows[0]) {
        return [{ ...result.rows[0] }];
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
    await this.db.insert(loginAttempts).values({
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
    return await this.db.select().from(loginAttempts)
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
    await this.db.insert(twoFactorCodes).values(code);
  }

  async verify2FACode(userId: string, code: string): Promise<boolean> {
    const [result] = await this.db.select().from(twoFactorCodes)
      .where(and(
        eq(twoFactorCodes.userId, userId),
        eq(twoFactorCodes.code, code),
        gte(twoFactorCodes.expiresAt, new Date())
      ));
    
    if (result) {
      await this.db.delete(twoFactorCodes).where(eq(twoFactorCodes.id, result.id));
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
    const allTransactions = await this.db.select().from(transactions);
    const completedTransactions = allTransactions.filter(t => t.status === 'completed');
    const totalRevenue = completedTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const allMerchants = await this.db.select().from(merchants);
    const activeMerchants = allMerchants.filter(m => m.status === 'active').length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const transactionsToday = allTransactions.filter(t => 
      new Date(t.createdAt!).getTime() >= today.getTime()
    ).length;
    
    const allAgents = await this.db.select().from(agents);
    const activeAgents = allAgents.filter(a => a.status === 'active').length;

    return {
      totalRevenue: totalRevenue.toFixed(2),
      activeMerchants,
      transactionsToday,
      activeAgents
    };
  }

  async getTopMerchants(): Promise<(Merchant & { transactionCount: number; totalVolume: string })[]> {
    const allMerchants = await this.db.select().from(merchants);
    const allTransactions = await this.db.select().from(transactions);
    
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
    return await this.db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt));
  }

  async getSecurityEvents() {
    return await this.db.select().from(schema.securityEvents).orderBy(desc(schema.securityEvents.createdAt));
  }

  async getLoginAttempts() {
    return await this.db.select().from(schema.loginAttempts).orderBy(desc(schema.loginAttempts.attemptTime));
  }

  async getAuditStats() {
    const [totalAudits] = await this.db.execute(`SELECT COUNT(*) as count FROM audit_logs`);
    const [highRiskActions] = await this.db.execute(`SELECT COUNT(*) as count FROM audit_logs WHERE risk_level = 'high'`);
    const [securityEvents] = await this.db.execute(`SELECT COUNT(*) as count FROM security_events WHERE severity = 'critical'`);
    const [successfulLogins] = await this.db.execute(`SELECT COUNT(*) as count FROM login_attempts WHERE status = 'success'`);
    const [failedLogins] = await this.db.execute(`SELECT COUNT(*) as count FROM login_attempts WHERE status = 'failed'`);

    return {
      totalAuditLogs: totalAudits.rows[0]?.count || 0,
      highRiskActions: highRiskActions.rows[0]?.count || 0,
      securityEvents: securityEvents.rows[0]?.count || 0,
      successfulLogins: successfulLogins.rows[0]?.count || 0,
      failedLogins: failedLogins.rows[0]?.count || 0
    };
  }

  // PDF Forms methods (placeholder for missing functionality)
  async getAllPdfForms() {
    // Return empty array for now - this feature may not be implemented yet
    return [];
  }

  async getAllEmailWrappers() {
    return await this.db.select().from(emailWrappers);
  }

  async getEmailWrapper(id: number) {
    const [wrapper] = await this.db.select().from(emailWrappers).where(eq(emailWrappers.id, id));
    return wrapper;
  }

  async getEmailWrapperByName(name: string) {
    const [wrapper] = await this.db.select().from(emailWrappers).where(eq(emailWrappers.name, name));
    return wrapper;
  }

  async createEmailWrapper(wrapper: InsertEmailWrapper) {
    const [newWrapper] = await this.db.insert(emailWrappers).values(wrapper).returning();
    return newWrapper;
  }

  async updateEmailWrapper(id: number, updates: Partial<InsertEmailWrapper>) {
    const [updatedWrapper] = await this.db.update(emailWrappers)
      .set(updates)
      .where(eq(emailWrappers.id, id))
      .returning();
    return updatedWrapper;
  }

  async deleteEmailWrapper(id: number) {
    const deleted = await this.db.delete(emailWrappers).where(eq(emailWrappers.id, id));
    return deleted.rowCount > 0;
  }

  async getAllEmailTemplates() {
    return await this.db.select().from(emailTemplates);
  }

  async getEmailTemplate(id: number) {
    const [template] = await this.db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
    return template;
  }

  async getEmailTemplateByName(name: string) {
    const [template] = await this.db.select().from(emailTemplates).where(eq(emailTemplates.name, name));
    return template;
  }

  async createEmailTemplate(template: InsertEmailTemplate) {
    const [newTemplate] = await this.db.insert(emailTemplates).values(template).returning();
    return newTemplate;
  }

  async updateEmailTemplate(id: number, updates: Partial<InsertEmailTemplate>) {
    const [updatedTemplate] = await this.db.update(emailTemplates)
      .set(updates)
      .where(eq(emailTemplates.id, id))
      .returning();
    return updatedTemplate;
  }

  async deleteEmailTemplate(id: number) {
    const deleted = await this.db.delete(emailTemplates).where(eq(emailTemplates.id, id));
    return deleted.rowCount > 0;
  }

  async getAllEmailTriggers() {
    return await this.db.select().from(emailTriggers);
  }

  async getEmailTrigger(id: number) {
    const [trigger] = await this.db.select().from(emailTriggers).where(eq(emailTriggers.id, id));
    return trigger;
  }

  async createEmailTrigger(trigger: InsertEmailTrigger) {
    const [newTrigger] = await this.db.insert(emailTriggers).values(trigger).returning();
    return newTrigger;
  }

  async updateEmailTrigger(id: number, updates: Partial<InsertEmailTrigger>) {
    const [updatedTrigger] = await this.db.update(emailTriggers)
      .set(updates)
      .where(eq(emailTriggers.id, id))
      .returning();
    return updatedTrigger;
  }

  async deleteEmailTrigger(id: number) {
    const deleted = await this.db.delete(emailTriggers).where(eq(emailTriggers.id, id));
    return deleted.rowCount > 0;
  }

  async logEmailActivity(activity: InsertEmailActivity) {
    const [newActivity] = await this.db.insert(emailActivity).values(activity).returning();
    return newActivity;
  }

  async getEmailActivity(limit: number = 100, filters: { status?: string; templateId?: number; recipientEmail?: string } = {}) {
    let query = this.db.select().from(emailActivity);
    
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
    const totalSentResult = await this.db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status IN ('sent', 'opened', 'clicked')`);
    const deliveredResult = await this.db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status IN ('sent', 'opened', 'clicked')`);
    const totalOpenedResult = await this.db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'opened'`);
    const totalClickedResult = await this.db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'clicked'`);
    const totalFailedResult = await this.db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status IN ('failed', 'bounced')`);
    
    const totalSent = Number(totalSentResult.rows[0]?.count || 0);
    const delivered = Number(deliveredResult.rows[0]?.count || 0);
    const totalOpened = Number(totalOpenedResult.rows[0]?.count || 0);
    const totalClicked = Number(totalClickedResult.rows[0]?.count || 0);
    const totalFailed = Number(totalFailedResult.rows[0]?.count || 0);
    
    return {
      totalSent,
      delivered,
      totalOpened,
      totalClicked,
      totalFailed,
      deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0,
      openRate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0,
      clickRate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0
    };
  }

  async updateEmailActivityByWebhook(recipientEmail: string, eventType: string, eventTimestamp: Date, dbClient?: any) {
    const dbToUse = dbClient || db;
    
    const statusMapping: Record<string, string> = {
      'delivered': 'sent',
      'open': 'opened',
      'bounce': 'bounced',
      'dropped': 'failed',
      'deferred': 'sent'
    };

    const newStatus = statusMapping[eventType];
    
    if (!newStatus) {
      console.log(`Ignoring unsupported SendGrid event type: ${eventType}`);
      return;
    }

    console.log(`[Webhook] Searching for email activity with recipient: ${recipientEmail}`);
    
    const recentEmail = await dbToUse
      .select()
      .from(emailActivity)
      .where(eq(emailActivity.recipientEmail, recipientEmail))
      .orderBy(sql`sent_at DESC`)
      .limit(1);

    console.log(`[Webhook] Query returned ${recentEmail.length} results`);

    if (recentEmail.length === 0) {
      console.warn(`No email activity found for ${recipientEmail} to update with ${eventType} event`);
      return;
    }

    const updateData: any = { status: newStatus };

    if (eventType === 'open') {
      updateData.openedAt = eventTimestamp;
    }

    console.log(`[Webhook] Updating email ${recentEmail[0].id} with status: ${newStatus}`);

    await dbToUse
      .update(emailActivity)
      .set(updateData)
      .where(eq(emailActivity.id, recentEmail[0].id));

    console.log(`[Webhook] Successfully updated email ${recentEmail[0].id} for ${recipientEmail} to status: ${newStatus}`);
  }

  // Campaign operations - placeholder methods removed (using real implementations above)

  // Prospect operations 
  async getAllCampaigns(): Promise<Campaign[]> {
    return await this.db.select().from(campaigns).orderBy(campaigns.createdAt);
  }

  async createCampaign(campaign: InsertCampaign, feeValues: any[], equipmentIds: number[]): Promise<Campaign> {
    const [created] = await this.db.insert(campaigns).values(campaign).returning();
    return created;
  }

  async getCampaignFeeValues(campaignId: number): Promise<any[]> {
    return [];
  }

  async getCampaignEquipment(campaignId: number): Promise<any[]> {
    return [];
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    return await this.db.select().from(apiKeys).orderBy(apiKeys.createdAt);
  }

  async createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
    const [created] = await this.db.insert(apiKeys).values(apiKey).returning();
    return created;
  }

  async updateApiKey(id: number, updates: Partial<InsertApiKey>): Promise<ApiKey | undefined> {
    const [updated] = await this.db.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
    return updated || undefined;
  }

  async deleteApiKey(id: number): Promise<boolean> {
    const result = await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getApiUsageStats(): Promise<any> {
    return { totalRequests: 0, successfulRequests: 0, failedRequests: 0 };
  }

  async getApiRequestLogs(): Promise<ApiRequestLog[]> {
    return await this.db.select().from(apiRequestLogs).orderBy(desc(apiRequestLogs.createdAt)).limit(100);
  }

  async getAllAuditLogs(): Promise<any[]> {
    return [];
  }

  async getAllMerchantProspects() {
    // Use raw pool query to completely bypass Drizzle
    const result = await pool.query(`
      SELECT 
        mp.*,
        json_build_object(
          'id', a.id,
          'userId', a.user_id,
          'companyId', a.company_id,
          'firstName', a.first_name,
          'lastName', a.last_name,
          'territory', a.territory,
          'status', a.status,
          'commissionRate', a.commission_rate,
          'createdAt', a.created_at
        ) as agent
      FROM merchant_prospects mp
      LEFT JOIN agents a ON mp.agent_id = a.id
    `);

    return result.rows.map((row: any) => {
      // Map snake_case to camelCase for frontend compatibility
      return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        agentId: row.agent_id,
        status: row.status,
        validationToken: row.validation_token,
        validatedAt: row.validated_at,
        applicationStartedAt: row.application_started_at,
        formData: row.form_data,
        currentStep: row.current_step,
        agentSignature: row.agent_signature,
        agentSignatureType: row.agent_signature_type,
        agentSignedAt: row.agent_signed_at,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        agent: row.agent?.id ? row.agent : undefined,
      };
    });
  }

  async getMerchantProspect(id: number) {
    const [prospect] = await this.db.select().from(merchantProspects).where(eq(merchantProspects.id, id));
    return prospect;
  }

  async getMerchantProspectByEmail(email: string) {
    const [prospect] = await this.db.select().from(merchantProspects).where(eq(merchantProspects.email, email));
    return prospect;
  }

  async getMerchantProspectByToken(token: string) {
    const [prospect] = await this.db.select().from(merchantProspects).where(eq(merchantProspects.validationToken, token));
    return prospect;
  }

  async createMerchantProspect(prospect: any) {
    const fields: string[] = [];
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramCount = 1;

    const fieldMapping: { [key: string]: string } = {
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      agentId: 'agent_id',
      status: 'status',
      validationToken: 'validation_token',
      validatedAt: 'validated_at',
      applicationStartedAt: 'application_started_at',
      formData: 'form_data',
      currentStep: 'current_step',
      agentSignature: 'agent_signature',
      agentSignatureType: 'agent_signature_type',
      agentSignedAt: 'agent_signed_at',
      notes: 'notes'
    };

    for (const [camelKey, snakeKey] of Object.entries(fieldMapping)) {
      if (prospect[camelKey] !== undefined) {
        fields.push(snakeKey);
        values.push(prospect[camelKey]);
        placeholders.push(`$${paramCount++}`);
      }
    }

    const sql = `
      INSERT INTO merchant_prospects (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await pool.query(sql, values);
    const row = result.rows[0];
    
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      agentId: row.agent_id,
      status: row.status,
      validationToken: row.validation_token,
      validatedAt: row.validated_at,
      applicationStartedAt: row.application_started_at,
      formData: row.form_data,
      currentStep: row.current_step,
      agentSignature: row.agent_signature,
      agentSignatureType: row.agent_signature_type,
      agentSignedAt: row.agent_signed_at,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateMerchantProspect(id: number, updates: any) {
    const sets: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    const fieldMapping: { [key: string]: string } = {
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      agentId: 'agent_id',
      status: 'status',
      validationToken: 'validation_token',
      validatedAt: 'validated_at',
      applicationStartedAt: 'application_started_at',
      formData: 'form_data',
      currentStep: 'current_step',
      agentSignature: 'agent_signature',
      agentSignatureType: 'agent_signature_type',
      agentSignedAt: 'agent_signed_at',
      notes: 'notes',
      updatedAt: 'updated_at'
    };

    for (const [camelKey, snakeKey] of Object.entries(fieldMapping)) {
      if (updates[camelKey] !== undefined) {
        sets.push(`${snakeKey} = $${paramCount++}`);
        values.push(updates[camelKey]);
      }
    }

    if (sets.length === 0) {
      const result = await pool.query('SELECT * FROM merchant_prospects WHERE id = $1', [id]);
      const row = result.rows[0];
      if (!row) return null;
      
      return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        agentId: row.agent_id,
        status: row.status,
        validationToken: row.validation_token,
        validatedAt: row.validated_at,
        applicationStartedAt: row.application_started_at,
        formData: row.form_data,
        currentStep: row.current_step,
        agentSignature: row.agent_signature,
        agentSignatureType: row.agent_signature_type,
        agentSignedAt: row.agent_signed_at,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }

    values.push(id);
    const sql = `
      UPDATE merchant_prospects
      SET ${sets.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(sql, values);
    const row = result.rows[0];
    
    if (!row) return null;
    
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      agentId: row.agent_id,
      status: row.status,
      validationToken: row.validation_token,
      validatedAt: row.validated_at,
      applicationStartedAt: row.application_started_at,
      formData: row.form_data,
      currentStep: row.current_step,
      agentSignature: row.agent_signature,
      agentSignatureType: row.agent_signature_type,
      agentSignedAt: row.agent_signed_at,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async deleteMerchantProspect(id: number) {
    const deleted = await this.db.delete(merchantProspects).where(eq(merchantProspects.id, id));
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
      role: 'agent' as const,
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
      role: 'merchant' as const,
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

  // Action Template operations
  async getAllActionTemplates(): Promise<ActionTemplate[]> {
    return this.db.select().from(actionTemplates).orderBy(desc(actionTemplates.createdAt));
  }

  async getActionTemplatesByType(actionType: string): Promise<ActionTemplate[]> {
    return db
      .select()
      .from(actionTemplates)
      .where(eq(actionTemplates.actionType, actionType))
      .orderBy(desc(actionTemplates.createdAt));
  }

  async getActionTemplate(id: number): Promise<ActionTemplate | undefined> {
    const [template] = await this.db.select().from(actionTemplates).where(eq(actionTemplates.id, id));
    return template;
  }

  async createActionTemplate(template: InsertActionTemplate): Promise<ActionTemplate> {
    const [newTemplate] = await this.db.insert(actionTemplates).values(template).returning();
    return newTemplate;
  }

  async updateActionTemplate(id: number, updates: Partial<InsertActionTemplate>): Promise<ActionTemplate | undefined> {
    const [updatedTemplate] = await db
      .update(actionTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(actionTemplates.id, id))
      .returning();
    return updatedTemplate;
  }

  async deleteActionTemplate(id: number): Promise<boolean> {
    const result = await this.db.delete(actionTemplates).where(eq(actionTemplates.id, id)).returning();
    return result.length > 0;
  }

  async getActionTemplateUsage(templateId: number): Promise<Array<{ triggerId: number; triggerName: string; triggerKey: string; isActive: boolean }>> {
    const result = await db
      .select({
        triggerId: triggerCatalog.id,
        triggerName: triggerCatalog.name,
        triggerKey: triggerCatalog.triggerKey,
        isActive: triggerCatalog.isActive
      })
      .from(triggerActions)
      .innerJoin(triggerCatalog, eq(triggerActions.triggerId, triggerCatalog.id))
      .where(eq(triggerActions.actionTemplateId, templateId))
      .orderBy(triggerCatalog.name);
    
    return result;
  }

  async getAllActionTemplateUsage(): Promise<Record<number, Array<{ triggerId: number; triggerName: string; triggerKey: string; isActive: boolean }>>> {
    const result = await db
      .select({
        templateId: triggerActions.actionTemplateId,
        triggerId: triggerCatalog.id,
        triggerName: triggerCatalog.name,
        triggerKey: triggerCatalog.triggerKey,
        isActive: triggerCatalog.isActive
      })
      .from(triggerActions)
      .innerJoin(triggerCatalog, eq(triggerActions.triggerId, triggerCatalog.id));
    
    const usageMap: Record<number, Array<{ triggerId: number; triggerName: string; triggerKey: string; isActive: boolean }>> = {};
    
    for (const row of result) {
      if (!usageMap[row.templateId]) {
        usageMap[row.templateId] = [];
      }
      usageMap[row.templateId].push({
        triggerId: row.triggerId,
        triggerName: row.triggerName,
        triggerKey: row.triggerKey,
        isActive: row.isActive
      });
    }
    
    return usageMap;
  }

  // User Alert operations
  async getUserAlerts(userId: string, includeRead: boolean = false): Promise<UserAlert[]> {
    const conditions = includeRead 
      ? eq(userAlerts.userId, userId)
      : and(eq(userAlerts.userId, userId), eq(userAlerts.isRead, false));
    
    return db
      .select()
      .from(userAlerts)
      .where(conditions)
      .orderBy(desc(userAlerts.createdAt));
  }

  async getUnreadAlertCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userAlerts)
      .where(and(
        eq(userAlerts.userId, userId),
        eq(userAlerts.isRead, false)
      ));
    
    return result?.count || 0;
  }

  async createUserAlert(alert: InsertUserAlert): Promise<UserAlert> {
    const [newAlert] = await this.db.insert(userAlerts).values(alert).returning();
    return newAlert;
  }

  async markAlertAsRead(alertId: number, userId: string): Promise<UserAlert | undefined> {
    const [alert] = await db
      .update(userAlerts)
      .set({ 
        isRead: true,
        readAt: new Date()
      })
      .where(and(
        eq(userAlerts.id, alertId),
        eq(userAlerts.userId, userId)
      ))
      .returning();
    
    return alert;
  }

  async markAllAlertsAsRead(userId: string): Promise<number> {
    const result = await db
      .update(userAlerts)
      .set({ 
        isRead: true,
        readAt: new Date()
      })
      .where(and(
        eq(userAlerts.userId, userId),
        eq(userAlerts.isRead, false)
      ))
      .returning();
    
    return result.length;
  }

  async deleteAlert(alertId: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(userAlerts)
      .where(and(
        eq(userAlerts.id, alertId),
        eq(userAlerts.userId, userId)
      ))
      .returning();
    
    return result.length > 0;
  }

  async deleteAllReadAlerts(userId: string): Promise<number> {
    const result = await db
      .delete(userAlerts)
      .where(and(
        eq(userAlerts.userId, userId),
        eq(userAlerts.isRead, true)
      ))
      .returning();
    
    return result.length;
  }

  // Trigger Catalog operations
  async getAllTriggerCatalog(): Promise<TriggerCatalog[]> {
    return this.db.select().from(triggerCatalog).orderBy(triggerCatalog.triggerKey);
  }

  async getTriggerCatalog(id: number): Promise<TriggerCatalog | undefined> {
    const [trigger] = await this.db.select().from(triggerCatalog).where(eq(triggerCatalog.id, id));
    return trigger;
  }

  async getTriggerCatalogByKey(triggerKey: string): Promise<TriggerCatalog | undefined> {
    const [trigger] = await this.db.select().from(triggerCatalog).where(eq(triggerCatalog.triggerKey, triggerKey));
    return trigger;
  }

  async createTriggerCatalog(trigger: InsertTriggerCatalog): Promise<TriggerCatalog> {
    const [newTrigger] = await this.db.insert(triggerCatalog).values(trigger).returning();
    return newTrigger;
  }

  async updateTriggerCatalog(id: number, updates: Partial<InsertTriggerCatalog>): Promise<TriggerCatalog | undefined> {
    const [updatedTrigger] = await db
      .update(triggerCatalog)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(triggerCatalog.id, id))
      .returning();
    return updatedTrigger;
  }

  async deleteTriggerCatalog(id: number): Promise<boolean> {
    const result = await this.db.delete(triggerCatalog).where(eq(triggerCatalog.id, id)).returning();
    return result.length > 0;
  }

  // Trigger Actions operations
  async getTriggerActions(triggerId: number): Promise<(TriggerAction & { actionTemplate: ActionTemplate })[]> {
    const results = await db
      .select({
        triggerAction: triggerActions,
        actionTemplate: actionTemplates,
      })
      .from(triggerActions)
      .innerJoin(actionTemplates, eq(triggerActions.actionTemplateId, actionTemplates.id))
      .where(eq(triggerActions.triggerId, triggerId))
      .orderBy(triggerActions.sequenceOrder);

    return results.map(row => ({
      ...row.triggerAction,
      actionTemplate: row.actionTemplate,
    }));
  }

  async createTriggerAction(triggerAction: InsertTriggerAction): Promise<TriggerAction> {
    const [newAction] = await this.db.insert(triggerActions).values(triggerAction).returning();
    return newAction;
  }

  async updateTriggerAction(id: number, updates: Partial<InsertTriggerAction>): Promise<TriggerAction | undefined> {
    const [updatedAction] = await this.db
      .update(triggerActions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(triggerActions.id, id))
      .returning();
    return updatedAction;
  }

  async deleteTriggerAction(id: number): Promise<boolean> {
    const result = await this.db.delete(triggerActions).where(eq(triggerActions.id, id)).returning();
    return result.length > 0;
  }
}

// Factory function to create storage with a specific database instance
export function createStorage(dbInstance: typeof db): DatabaseStorage {
  return new DatabaseStorage(dbInstance);
}

// Helper to create storage for a request (used by routes)
// This will be enhanced in dbMiddleware
export function createStorageForRequest(dbInstance: typeof db): DatabaseStorage {
  return createStorage(dbInstance);
}

// Backward-compatible singleton using static db connection
// Routes should migrate to using createStorageForRequest with dynamic DB
export const storage = new DatabaseStorage(db);
export default storage;
