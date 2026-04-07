import { merchants, agents, transactions, users, loginAttempts, twoFactorCodes, userDashboardPreferences, agentMerchants, locations, addresses, pdfForms, pdfFormFields, pdfFormSubmissions, merchantProspects, prospectOwners, prospectSignatures, feeGroups, feeItemGroups, feeItems, pricingTypes, pricingTypeFeeItems, campaigns, campaignFeeValues, campaignAssignments, equipmentItems, campaignEquipment, apiKeys, apiRequestLogs, emailTemplates, emailActivity, emailTriggers, type Merchant, type Agent, type Transaction, type User, type InsertMerchant, type InsertAgent, type InsertTransaction, type UpsertUser, type MerchantWithAgent, type TransactionWithMerchant, type LoginAttempt, type TwoFactorCode, type UserDashboardPreference, type InsertUserDashboardPreference, type AgentMerchant, type InsertAgentMerchant, type Location, type InsertLocation, type Address, type InsertAddress, type LocationWithAddresses, type MerchantWithLocations, type PdfForm, type InsertPdfForm, type PdfFormField, type InsertPdfFormField, type PdfFormSubmission, type InsertPdfFormSubmission, type PdfFormWithFields, type MerchantProspect, type InsertMerchantProspect, type MerchantProspectWithAgent, type ProspectOwner, type InsertProspectOwner, type ProspectSignature, type InsertProspectSignature, type FeeGroup, type InsertFeeGroup, type FeeItemGroup, type InsertFeeItemGroup, type FeeItem, type InsertFeeItem, type PricingType, type InsertPricingType, type PricingTypeFeeItem, type InsertPricingTypeFeeItem, type Campaign, type InsertCampaign, type CampaignFeeValue, type InsertCampaignFeeValue, type CampaignAssignment, type InsertCampaignAssignment, type EquipmentItem, type InsertEquipmentItem, type CampaignEquipment, type InsertCampaignEquipment, type FeeGroupWithItems, type FeeItemGroupWithItems, type FeeGroupWithItemGroups, type PricingTypeWithFeeItems, type CampaignWithDetails, type ApiKey, type InsertApiKey, type ApiRequestLog, type InsertApiRequestLog, type EmailTemplate, type InsertEmailTemplate, type EmailActivity, type InsertEmailActivity, type EmailTrigger, type InsertEmailTrigger } from "@shared/schema";
import { db } from "./db";
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
}

export class DatabaseStorage implements IStorage {
  // Fee Groups implementation
  async getAllFeeGroups(): Promise<FeeGroupWithItems[]> {
    const groups = await db.select().from(feeGroups).orderBy(feeGroups.displayOrder);
    const result: FeeGroupWithItems[] = [];
    
    for (const group of groups) {
      const groupItems = await db.select().from(feeItems)
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
    const [feeGroup] = await db.select().from(feeGroups).where(eq(feeGroups.id, id));
    return feeGroup || undefined;
  }

  async getFeeGroupWithItemGroups(id: number): Promise<FeeGroupWithItemGroups | undefined> {
    const [feeGroup] = await db.select().from(feeGroups).where(eq(feeGroups.id, id));
    if (!feeGroup) return undefined;

    const itemGroups = await db.select().from(feeItemGroups)
      .where(eq(feeItemGroups.feeGroupId, id))
      .orderBy(feeItemGroups.displayOrder);

    const feeItemGroupsWithItems: FeeItemGroupWithItems[] = [];
    for (const itemGroup of itemGroups) {
      const items = await db.select().from(feeItems)
        .where(eq(feeItems.feeItemGroupId, itemGroup.id))
        .orderBy(feeItems.displayOrder);
      
      feeItemGroupsWithItems.push({
        ...itemGroup,
        feeItems: items
      });
    }

    const directItems = await db.select().from(feeItems)
      .where(and(eq(feeItems.feeGroupId, id), sql`${feeItems.feeItemGroupId} IS NULL`))
      .orderBy(feeItems.displayOrder);

    return {
      ...feeGroup,
      feeItemGroups: feeItemGroupsWithItems,
      feeItems: directItems
    };
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

  async updatePricingType(id: number, updates: Partial<InsertPricingType>): Promise<PricingType | undefined> {
    const [updated] = await db.update(pricingTypes).set(updates).where(eq(pricingTypes.id, id)).returning();
    return updated || undefined;
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
    const [assignment] = await db.select().from(campaignAssignments).where(eq(campaignAssignments.prospectId, prospectId));
    return assignment || undefined;
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
    const prospects = await db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
    return prospects.filter(p => 
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
      p.email.toLowerCase().includes(query.toLowerCase())
    );
  }

  async getMerchantProspectsByAgent(agentId: number) {
    return await db.select().from(merchantProspects).where(eq(merchantProspects.agentId, agentId));
  }

  async searchMerchantProspects(query: string) {
    const prospects = await db.select().from(merchantProspects);
    return prospects.filter(p => 
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
      p.email.toLowerCase().includes(query.toLowerCase())
    );
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
    const [created] = await db.insert(prospectSignatures).values(signature).returning();
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

  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    const [created] = await db.insert(campaigns).values(campaign).returning();
    return created;
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
    const [user] = await db.select().from(users).where(eq(users.id, id));
    console.log('Storage.getUser - Found:', user ? `${user.username} (${user.id})` : 'null');
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByUsernameOrEmail(username: string, email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      or(eq(users.username, username), eq(users.email, email))
    );
    return user || undefined;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.passwordResetToken, token));
    return user || undefined;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
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
    return await db.select().from(users);
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
    const [totalAudits] = await db.execute(`SELECT COUNT(*) as count FROM audit_logs`);
    const [highRiskActions] = await db.execute(`SELECT COUNT(*) as count FROM audit_logs WHERE risk_level = 'high'`);
    const [securityEvents] = await db.execute(`SELECT COUNT(*) as count FROM security_events WHERE severity = 'critical'`);
    const [successfulLogins] = await db.execute(`SELECT COUNT(*) as count FROM login_attempts WHERE status = 'success'`);
    const [failedLogins] = await db.execute(`SELECT COUNT(*) as count FROM login_attempts WHERE status = 'failed'`);

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
    const totalSentResult = await db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'sent'`);
    const totalOpenedResult = await db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'opened'`);
    const totalClickedResult = await db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'clicked'`);
    const totalFailedResult = await db.execute(sql`SELECT COUNT(*) as count FROM email_activity WHERE status = 'failed'`);
    
    const totalSent = Number(totalSentResult.rows[0]?.count || 0);
    const totalOpened = Number(totalOpenedResult.rows[0]?.count || 0);
    const totalClicked = Number(totalClickedResult.rows[0]?.count || 0);
    const totalFailed = Number(totalFailedResult.rows[0]?.count || 0);
    
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

  async getCampaignFeeValues(campaignId: number): Promise<any[]> {
    return [];
  }

  async getCampaignEquipment(campaignId: number): Promise<any[]> {
    return [];
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

  async getAllAuditLogs(): Promise<any[]> {
    return [];
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
}

export const storage = new DatabaseStorage();
export default storage;
