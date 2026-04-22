import { pgTable, text, serial, integer, boolean, timestamp, decimal, varchar, jsonb, index, unique, real, numeric, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const merchants = pgTable("merchants", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).unique(),
  businessName: text("business_name").notNull(),
  businessType: text("business_type").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  agentId: integer("agent_id"),
  parentMerchantId: integer("parent_merchant_id"),
  processingFee: decimal("processing_fee", { precision: 5, scale: 2 }).default("2.50").notNull(),
  status: text("status").notNull().default("active"), // active, pending, suspended
  monthlyVolume: decimal("monthly_volume", { precision: 12, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  dbaName: text("dba_name"),
  legalName: text("legal_name"),
  ein: text("ein"),
  website: text("website"),
  industry: text("industry"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  companyId: integer("company_id").notNull(),
  notes: text("notes"),
});

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  mid: varchar("mid", { length: 50 }).unique(), // Merchant ID for tracking transactions to locations
  name: text("name").notNull(),
  type: text("type").notNull().default("store"), // store, warehouse, office, headquarters
  phone: text("phone"),
  email: text("email"),
  status: text("status").notNull().default("active"), // active, inactive, temporarily_closed
  operatingHours: jsonb("operating_hours"), // Store days/hours as JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),

  companyId: integer("company_id"),
});

export const addresses = pgTable("addresses", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("primary"), // primary, billing, shipping, mailing
  street1: text("street1").notNull(),
  street2: text("street2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("US"),
  // Geolocation fields for mapping
  latitude: real("latitude"), // GPS coordinates
  longitude: real("longitude"), // GPS coordinates
  geoAccuracy: real("geo_accuracy"), // Accuracy in meters
  geocodedAt: timestamp("geocoded_at"), // When geolocation was last updated
  timezone: text("timezone"), // e.g., "America/New_York"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  territory: text("territory"),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("5.00"),
  status: text("status").notNull().default("active"), // active, inactive
  parentAgentId: integer("parent_agent_id"),
  defaultCampaignId: integer("default_campaign_id"), // FK to campaigns.id (no .references — campaigns table defined later)
  createdAt: timestamp("created_at").defaultNow(),

  companyId: integer("company_id").notNull(),
});

// Hierarchy closure tables. depth=0 row is the self-row.
// Each (ancestor, descendant) pair is unique; depth is the number of edges between them.
// MVP cap: max depth from root = 5.
export const agentHierarchy = pgTable("agent_hierarchy", {
  ancestorId: integer("ancestor_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  descendantId: integer("descendant_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  depth: integer("depth").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ancestorId, t.descendantId] }),
  ancIdx: index("agent_hier_anc_idx").on(t.ancestorId),
  descIdx: index("agent_hier_desc_idx").on(t.descendantId),
}));

export const merchantHierarchy = pgTable("merchant_hierarchy", {
  ancestorId: integer("ancestor_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  descendantId: integer("descendant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  depth: integer("depth").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ancestorId, t.descendantId] }),
  ancIdx: index("merchant_hier_anc_idx").on(t.ancestorId),
  descIdx: index("merchant_hier_desc_idx").on(t.descendantId),
}));

export type AgentHierarchyRow = typeof agentHierarchy.$inferSelect;
export type MerchantHierarchyRow = typeof merchantHierarchy.$inferSelect;

export const merchantProspects = pgTable("merchant_prospects", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  status: text("status").notNull().default("pending"), // pending, contacted, in_progress, applied, approved, rejected
  validationToken: text("validation_token").unique(), // Token for email validation
  validatedAt: timestamp("validated_at"),
  applicationStartedAt: timestamp("application_started_at"),
  formData: text("form_data"), // JSON string of form data for resuming applications
  currentStep: integer("current_step").default(0), // Current step in the application form
  notes: text("notes"),
  // Prospect portal account
  portalPasswordHash: text("portal_password_hash"),
  portalSetupAt: timestamp("portal_setup_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  agentSignature: text("agent_signature"),
  agentSignatureType: text("agent_signature_type"),
  agentSignedAt: timestamp("agent_signed_at"),
  userId: varchar("user_id"),
  databaseEnv: text("database_env").default("development"),
});

// Prospect portal messaging (matches existing prospect_messages table)
export const prospectMessages = pgTable("prospect_messages", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  agentId: integer("agent_id"),
  senderId: varchar("sender_id").notNull(), // userId or prospect email
  senderType: text("sender_type").notNull(), // "prospect" | "agent"
  subject: text("subject").notNull().default(""),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProspectMessageSchema = createInsertSchema(prospectMessages).omit({ id: true, createdAt: true });
export type InsertProspectMessage = z.infer<typeof insertProspectMessageSchema>;
export type ProspectMessage = typeof prospectMessages.$inferSelect;

// Prospect file requests — includes inline file storage (base64) since object storage is not configured
export const prospectFileRequests = pgTable("prospect_file_requests", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  label: text("label").notNull(), // e.g. "Voided Check", "Driver's License"
  description: text("description"),
  required: boolean("required").notNull().default(true),
  status: text("status").notNull().default("pending"), // pending, uploaded, approved, rejected
  // Uploaded file (stored inline as base64 since object storage is not yet configured)
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileData: text("file_data"), // base64 encoded content
  uploadedBy: varchar("uploaded_by"), // prospect email
  createdAt: timestamp("created_at").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
});

export const insertProspectFileRequestSchema = createInsertSchema(prospectFileRequests).omit({ id: true, createdAt: true });
export type InsertProspectFileRequest = z.infer<typeof insertProspectFileRequestSchema>;
export type ProspectFileRequest = typeof prospectFileRequests.$inferSelect;

// Magic links for password-free portal access (single-use, 24h expiry)
export const portalMagicLinks = pgTable("portal_magic_links", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortalMagicLink = typeof portalMagicLinks.$inferSelect;

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  merchantId: integer("merchant_id").notNull(),
  mid: varchar("mid", { length: 50 }), // Merchant location ID for tracking transactions to specific locations
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // visa, mastercard, amex, apple_pay, google_pay
  status: text("status").notNull(), // completed, pending, failed, refunded
  processingFee: decimal("processing_fee", { precision: 12, scale: 2 }),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),

  commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).default("0.025"),
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).default("0"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow(),
  referenceNumber: text("reference_number"),
  locationId: integer("location_id"),
  transactionType: text("transaction_type").notNull().default("payment"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// Junction table for agent-merchant associations
export const agentMerchants = pgTable("agent_merchants", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  merchantId: integer("merchant_id").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  assignedBy: text("assigned_by"), // user ID who made the assignment
});

// API Keys for external integrations
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Human-readable name for the API key
  keyId: text("key_id").notNull().unique(), // Public key identifier (e.g., ak_12345...)
  keySecret: text("key_secret").notNull(), // Hashed secret key
  organizationName: text("organization_name"), // Organization using this API key
  contactEmail: text("contact_email").notNull(),
  permissions: jsonb("permissions").notNull().default('[]'), // Array of permission strings
  rateLimit: integer("rate_limit").default(1000), // Requests per hour
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// API Request Logs for monitoring and analytics
export const apiRequestLogs = pgTable("api_request_logs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").references(() => apiKeys.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code").notNull(),
  responseTime: integer("response_time"), // in milliseconds
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  requestSize: integer("request_size"), // in bytes
  responseSize: integer("response_size"), // in bytes
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  apiKeyIdIdx: index("api_key_id_idx").on(table.apiKeyId),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export const insertMerchantSchema = createInsertSchema(merchants).omit({
  id: true,
  createdAt: true,
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export const insertAgentMerchantSchema = createInsertSchema(agentMerchants).omit({
  id: true,
  assignedAt: true,
});

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
});

export const insertAddressSchema = createInsertSchema(addresses).omit({
  id: true,
  createdAt: true,
  geocodedAt: true,
});

export type InsertMerchant = z.infer<typeof insertMerchantSchema>;
export type Merchant = typeof merchants.$inferSelect;

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

export type InsertAgentMerchant = z.infer<typeof insertAgentMerchantSchema>;
export type AgentMerchant = typeof agentMerchants.$inferSelect;

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

export type InsertAddress = z.infer<typeof insertAddressSchema>;
export type Address = typeof addresses.$inferSelect;

// Extended types for API responses
export type MerchantWithAgent = Merchant & {
  agent?: Agent;
};

export type TransactionWithMerchant = Transaction & {
  merchant?: Merchant;
};

export type LocationWithAddresses = Location & {
  addresses: Address[];
};

export type MerchantWithLocations = Merchant & {
  locations?: LocationWithAddresses[];
  agent?: Agent;
};

// Role definitions (managed centrally; system roles cannot be modified/deleted)
export const roleDefinitions = pgTable("role_definitions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 50 }).default("secondary"),
  isSystem: boolean("is_system").default(false),
  permissions: text("permissions").array().default(sql`ARRAY[]::text[]`),
  capabilities: text("capabilities").array().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type RoleDefinition = typeof roleDefinitions.$inferSelect;
export type InsertRoleDefinition = typeof roleDefinitions.$inferInsert;

// Role × Action scope grants (runtime overrides over DEFAULT_ACTION_GRANTS in
// shared/permissions.ts). NULL/missing row = use file-defined default.
export const roleActionGrants = pgTable("role_action_grants", {
  roleCode: varchar("role_code", { length: 50 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  scope: varchar("scope", { length: 20 }).notNull(), // 'own' | 'downline' | 'all' | 'none'
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by"),
}, (t) => ({
  pk: primaryKey({ columns: [t.roleCode, t.action] }),
}));
export type RoleActionGrant = typeof roleActionGrants.$inferSelect;

export const roleActionAudit = pgTable("role_action_audit", {
  id: serial("id").primaryKey(),
  roleCode: varchar("role_code", { length: 50 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  prevScope: varchar("prev_scope", { length: 20 }),
  newScope: varchar("new_scope", { length: 20 }),
  changedBy: varchar("changed_by"),
  changedAt: timestamp("changed_at").defaultNow(),
});
export type RoleActionAudit = typeof roleActionAudit.$inferSelect;

// User management tables
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique().notNull(),
  username: varchar("username").unique().notNull(),
  passwordHash: varchar("password_hash").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  roles: text("roles").array().notNull().default(["merchant"]), // merchant, agent, admin, corporate, super_admin
  status: text("status").notNull().default("active"), // active, suspended, inactive
  permissions: jsonb("permissions").default("{}"),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: varchar("last_login_ip"),
  timezone: varchar("timezone").default("UTC"), // User's preferred timezone e.g., "America/New_York"
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: varchar("two_factor_secret"),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: varchar("email_verification_token"),
  phone: varchar("phone"),
  communicationPreference: varchar("communication_preference").default("email"), // email, sms, both
  mustChangePassword: boolean("must_change_password").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Login attempts table for security tracking
export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  username: varchar("username"),
  email: varchar("email"),
  ipAddress: varchar("ip_address").notNull(),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  failureReason: varchar("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Two-factor authentication codes table
export const twoFactorCodes = pgTable("two_factor_codes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 6 }).notNull(),
  type: varchar("type").notNull(), // 'login', 'ip_change', 'password_reset'
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Schema for user registration
export const registerUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  role: z.string().default("merchant"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Schema for user login
export const loginUserSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email required"),
  password: z.string().min(1, "Password required"),
  twoFactorCode: z.string().optional(),
  timezone: z.string().optional(), // User's detected timezone
});

// Schema for password reset request
export const passwordResetRequestSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email required"),
});

// Schema for password reset
export const passwordResetSchema = z.object({
  token: z.string().min(1, "Reset token required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Schema for 2FA verification
export const twoFactorVerifySchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
  type: z.enum(["login", "ip_change", "password_reset"]),
});

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export type RegisterUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export type PasswordReset = z.infer<typeof passwordResetSchema>;
export type TwoFactorVerify = z.infer<typeof twoFactorVerifySchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect & { role?: string };
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type TwoFactorCode = typeof twoFactorCodes.$inferSelect;

// Widget preferences table
export const userDashboardPreferences = pgTable("user_dashboard_preferences", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  user_id: text("user_id").notNull(),
  widget_id: text("widget_id").notNull(),
  position: integer("position").notNull().default(0),
  size: text("size").notNull().default("medium"), // small, medium, large
  is_visible: boolean("is_visible").notNull().default(true),
  configuration: jsonb("configuration").default({}),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserDashboardPreferenceSchema = createInsertSchema(userDashboardPreferences);

export type InsertUserDashboardPreference = z.infer<typeof insertUserDashboardPreferenceSchema>;
export type UserDashboardPreference = typeof userDashboardPreferences.$inferSelect;

// Generic per-user key/value preferences (e.g. underwriting queue filters/sort).
// Uses a composite primary key so each (userId, key) pair is unique.
export const userPreferences = pgTable("user_preferences", {
  userId: varchar("user_id").notNull(),
  key: varchar("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.key] })]);

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

// User alerts / notification table
export const userAlerts = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  message: text("message").notNull(),
  type: varchar("type").notNull().default("info"), // info, warning, error, success
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  actionUrl: text("action_url"),
  actionActivityId: integer("action_activity_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({ id: true, createdAt: true });
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;
export type UserAlert = typeof userAlerts.$inferSelect;

// Prospect owners table for business ownership information
export const prospectOwners = pgTable("prospect_owners", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  ownershipPercentage: decimal("ownership_percentage", { precision: 5, scale: 2 }).notNull(),
  signatureToken: text("signature_token"),
  emailSent: boolean("email_sent").default(false),
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Prospect signatures table for storing digital signatures.
// Epic F (compliance): records IP, user-agent and a SHA-256 hash of the signed
// payload so we have a tamper-evident e-signature trail per SOC2.
export const prospectSignatures = pgTable("prospect_signatures", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  ownerId: integer("owner_id").notNull().references(() => prospectOwners.id, { onDelete: 'cascade' }),
  signatureToken: text("signature_token").notNull().unique(),
  signature: text("signature").notNull(),
  signatureType: text("signature_type").notNull(), // 'draw' or 'type'
  // Compliance trail (nullable for backward compatibility with rows captured
  // before this epic). New writes should always populate these.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  documentHash: text("document_hash"), // sha256 of normalized payload that was signed
  // Stable, immutable evidence URL for legal defense. Format:
  //   /api/prospects/:prospectId/signature-trail#owner=<ownerId>
  // Persisted at signing time so it survives later route refactors and can
  // be quoted verbatim in audit exports / e-sign certificates.
  recordLink: text("record_link"),
  submittedAt: timestamp("submitted_at").defaultNow(),
});

export const insertProspectOwnerSchema = createInsertSchema(prospectOwners);

export const insertProspectSignatureSchema = createInsertSchema(prospectSignatures);

export type InsertProspectOwner = z.infer<typeof insertProspectOwnerSchema>;
export type ProspectOwner = typeof prospectOwners.$inferSelect;
export type InsertProspectSignature = z.infer<typeof insertProspectSignatureSchema>;
export type ProspectSignature = typeof prospectSignatures.$inferSelect;

// API Key schemas
export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
});

export const insertApiRequestLogSchema = createInsertSchema(apiRequestLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiRequestLog = z.infer<typeof insertApiRequestLogSchema>;
export type ApiRequestLog = typeof apiRequestLogs.$inferSelect;

// PDF Form schemas
export const pdfForms = pgTable("pdf_forms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  status: text("status").default("active"), // active, inactive
  uploadedBy: text("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Navigation configuration
  showInNavigation: boolean("show_in_navigation").default(false),
  navigationTitle: text("navigation_title"), // Custom title for navigation
  allowedRoles: text("allowed_roles").array().default(['admin']), // Roles that can access this form
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const pdfFormFields = pgTable("pdf_form_fields", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull().references(() => pdfForms.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  fieldType: text("field_type").notNull(), // text, number, date, select, checkbox, textarea
  fieldLabel: text("field_label").notNull(),
  isRequired: boolean("is_required").default(false),
  options: text("options").array(), // for select/radio fields
  defaultValue: text("default_value"),
  validation: text("validation"), // JSON string for validation rules
  position: integer("position").notNull(), // field order
  section: text("section"), // section grouping for fields
  createdAt: timestamp("created_at").defaultNow(),

  pdfFieldId: text("pdf_field_id"),
});

export const pdfFormSubmissions = pgTable("pdf_form_submissions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull().references(() => pdfForms.id, { onDelete: "cascade" }),
  submittedBy: text("submitted_by").references(() => users.id, { onDelete: "cascade" }), // Make nullable for public submissions
  submissionToken: text("submission_token").notNull().unique(), // Unique token for public access
  applicantEmail: text("applicant_email"), // Email of the applicant for public submissions
  data: text("data").notNull(), // JSON string of form data
  status: text("status").default("draft"), // draft, submitted, under_review, approved, rejected
  isPublic: boolean("is_public").default(false), // Whether this is a public submission
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

// Drizzle schemas for PDF forms
export const insertPdfFormSchema = createInsertSchema(pdfForms).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertPdfFormFieldSchema = createInsertSchema(pdfFormFields).omit({
  id: true,
  createdAt: true
});

export const insertPdfFormSubmissionSchema = createInsertSchema(pdfFormSubmissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Types for PDF forms
export type PdfForm = typeof pdfForms.$inferSelect;
export type InsertPdfForm = z.infer<typeof insertPdfFormSchema>;
export type PdfFormField = typeof pdfFormFields.$inferSelect;
export type InsertPdfFormField = z.infer<typeof insertPdfFormFieldSchema>;
export type PdfFormSubmission = typeof pdfFormSubmissions.$inferSelect;
export type InsertPdfFormSubmission = z.infer<typeof insertPdfFormSubmissionSchema>;

export type PdfFormWithFields = PdfForm & {
  fields: PdfFormField[];
};

// Merchant Prospect schemas
export const insertMerchantProspectSchema = createInsertSchema(merchantProspects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  validationToken: true,
  validatedAt: true,
  applicationStartedAt: true,
  formData: true,
  currentStep: true,
});

// Merchant Prospect types
export type MerchantProspect = typeof merchantProspects.$inferSelect;
export type InsertMerchantProspect = z.infer<typeof insertMerchantProspectSchema>;

// Business Ownership table for tracking ownership percentages and signatures
export const businessOwnership = pgTable("business_ownership", {
  id: serial("id").primaryKey(),
  formSubmissionId: integer("form_submission_id").references(() => pdfFormSubmissions.id, { onDelete: "cascade" }),
  prospectId: integer("prospect_id").references(() => merchantProspects.id, { onDelete: "cascade" }),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  ownershipPercentage: decimal("ownership_percentage", { precision: 5, scale: 2 }).notNull(),
  requiresSignature: boolean("requires_signature").notNull().default(false), // true if > 25%
  signatureImagePath: text("signature_image_path"), // path to uploaded signature file
  digitalSignature: text("digital_signature"), // base64 encoded digital signature
  signatureType: text("signature_type"), // 'upload' or 'digital'
  signedAt: timestamp("signed_at"),
  signatureToken: text("signature_token").unique(), // token for email signature requests
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBusinessOwnershipSchema = createInsertSchema(businessOwnership).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BusinessOwnership = typeof businessOwnership.$inferSelect;
export type InsertBusinessOwnership = z.infer<typeof insertBusinessOwnershipSchema>;

// Extended types for prospect responses
export type MerchantProspectWithAgent = MerchantProspect & {
  agent?: Agent;
};

// Campaign Management Tables

// Fee Groups table - defines categories of fees (Discount Rates, Gateway VT, etc.)
export const feeGroups = pgTable("fee_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g., "Discount Rates", "Gateway VT", "Wireless Fees"
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  author: text("author").notNull().default("System"), // System or user who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Fee Item Groups table - intermediate grouping within fee groups (e.g., "Qualified", "Mid-Qualified", "Non-Qualified")
export const feeItemGroups = pgTable("fee_item_groups", {
  id: serial("id").primaryKey(),
  feeGroupId: integer("fee_group_id").notNull().references(() => feeGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Qualified", "Mid-Qualified", "Non-Qualified"
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  author: text("author").notNull().default("System"), // System or user who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueFeeItemGroupPerFeeGroup: unique().on(table.feeGroupId, table.name),
}));

// Fee Items table - individual fees (now standalone, can belong to multiple fee groups)
export const feeItems = pgTable("fee_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // e.g., "Visa", "MasterCard", "American Express"
  description: text("description"),
  valueType: text("value_type").notNull(), // "amount", "percentage", "placeholder"
  defaultValue: text("default_value"), // Default value for this fee item
  additionalInfo: text("additional_info"), // Info shown when clicking "i" icon
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  author: text("author").notNull().default("System"), // System or user who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  feeItemGroupId: integer("fee_item_group_id"),
});

// Fee Group Fee Items junction table - many-to-many relationship between fee groups and fee items
export const feeGroupFeeItems = pgTable("fee_group_fee_items", {
  id: serial("id").primaryKey(),
  feeGroupId: integer("fee_group_id").notNull().references(() => feeGroups.id, { onDelete: "cascade" }),
  feeItemId: integer("fee_item_id").notNull().references(() => feeItems.id, { onDelete: "cascade" }),
  feeItemGroupId: integer("fee_item_group_id").references(() => feeItemGroups.id, { onDelete: "cascade" }), // Optional grouping within the fee group
  displayOrder: integer("display_order").notNull().default(0),
  isRequired: boolean("is_required").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueFeeGroupFeeItem: unique().on(table.feeGroupId, table.feeItemId),
}));

// Pricing Types table - defines which fee items are included in a pricing structure
export const pricingTypes = pgTable("pricing_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // e.g., "Interchange +", "Flat Rate", "Dual"
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  author: text("author").notNull().default("System"), // System or user who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Pricing Type Fee Items junction table - maps which fee items belong to each pricing type
export const pricingTypeFeeItems = pgTable("pricing_type_fee_items", {
  id: serial("id").primaryKey(),
  pricingTypeId: integer("pricing_type_id").notNull().references(() => pricingTypes.id, { onDelete: "cascade" }),
  feeItemId: integer("fee_item_id").notNull().references(() => feeItems.id, { onDelete: "cascade" }),
  isRequired: boolean("is_required").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  feeGroupId: integer("fee_group_id"),
}, (table) => ({
  uniquePricingTypeFeeItem: unique().on(table.pricingTypeId, table.feeItemId),
}));

// Equipment Items table - stores available equipment with images
export const equipmentItems = pgTable("equipment_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"), // URL to equipment image
  imageData: text("image_data"), // Base64 encoded image data as fallback
  category: text("category"), // e.g., "Terminal", "Reader", "POS System"
  manufacturer: text("manufacturer"), // Equipment manufacturer
  modelNumber: text("model_number"), // Equipment model number
  specifications: jsonb("specifications").default("{}"), // Equipment specifications as JSON
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  model: text("model"),
  price: numeric("price", { precision: 10, scale: 2 }),
  status: text("status").default("available"),
});

// Campaign Equipment junction table - links campaigns to multiple equipment items
export const campaignEquipment = pgTable("campaign_equipment", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  equipmentItemId: integer("equipment_item_id").notNull().references(() => equipmentItems.id, { onDelete: "cascade" }),
  isRequired: boolean("is_required").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCampaignEquipment: unique().on(table.campaignId, table.equipmentItemId),
}));

// Campaigns table - pricing plans that can be assigned to merchant applications
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Campaign name (not required to be unique)
  description: text("description"),
  pricingTypeId: integer("pricing_type_id").references(() => pricingTypes.id),
  acquirer: text("acquirer").notNull(), // "Esquire", "Merrick", etc.
  currency: text("currency").notNull().default("USD"),
  equipment: text("equipment"), // Deprecated - use campaignEquipment junction table instead
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // If this is a default campaign
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  acquirerId: integer("acquirer_id").notNull(),
});

// Campaign Fee Values table - stores the actual fee values for each campaign
export const campaignFeeValues = pgTable("campaign_fee_values", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  feeItemId: integer("fee_item_id").notNull().references(() => feeItems.id, { onDelete: "cascade" }),
  value: text("value").notNull(), // The actual fee value (amount, percentage, or placeholder text)
  valueType: text("value_type").notNull().default("percentage"), // Type of value: 'percentage', 'amount', 'placeholder'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  feeGroupFeeItemId: integer("fee_group_fee_item_id"),
}, (table) => ({
  uniqueCampaignFeeItem: unique().on(table.campaignId, table.feeItemId),
}));

// Campaign Assignment table - links campaigns to merchant applications/prospects
export const campaignAssignments = pgTable("campaign_assignments", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id),
  prospectId: integer("prospect_id").references(() => merchantProspects.id, { onDelete: "cascade" }),
  applicationId: integer("application_id"), // Future reference to applications table
  assignedBy: varchar("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

// Campaign auto-assignment rules. Any of mcc/acquirerId/agentId may be null (wildcard).
// Lower priority value = higher precedence. Most-specific match wins; ties broken by priority then id.
export const campaignAssignmentRules = pgTable("campaign_assignment_rules", {
  id: serial("id").primaryKey(),
  mcc: text("mcc"), // null = any MCC
  acquirerId: integer("acquirer_id").references(() => acquirers.id, { onDelete: "set null" }),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCampaignAssignmentRuleSchema = createInsertSchema(campaignAssignmentRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCampaignAssignmentRule = z.infer<typeof insertCampaignAssignmentRuleSchema>;
export type CampaignAssignmentRule = typeof campaignAssignmentRules.$inferSelect;

// Insert schemas for campaign management
export const insertFeeGroupSchema = createInsertSchema(feeGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFeeItemGroupSchema = createInsertSchema(feeItemGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFeeItemSchema = createInsertSchema(feeItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFeeGroupFeeItemSchema = createInsertSchema(feeGroupFeeItems).omit({
  id: true,
  createdAt: true,
});

export const insertPricingTypeSchema = createInsertSchema(pricingTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPricingTypeFeeItemSchema = createInsertSchema(pricingTypeFeeItems).omit({
  id: true,
  createdAt: true,
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignFeeValueSchema = createInsertSchema(campaignFeeValues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignAssignmentSchema = createInsertSchema(campaignAssignments).omit({
  id: true,
  assignedAt: true,
});

export const insertEquipmentItemSchema = createInsertSchema(equipmentItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignEquipmentSchema = createInsertSchema(campaignEquipment).omit({
  id: true,
  createdAt: true,
});

// Equipment management types
export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type InsertEquipmentItem = z.infer<typeof insertEquipmentItemSchema>;
export type CampaignEquipment = typeof campaignEquipment.$inferSelect;
export type InsertCampaignEquipment = z.infer<typeof insertCampaignEquipmentSchema>;

// Campaign management types
export type FeeGroup = typeof feeGroups.$inferSelect;
export type InsertFeeGroup = z.infer<typeof insertFeeGroupSchema>;
export type FeeItemGroup = typeof feeItemGroups.$inferSelect;
export type InsertFeeItemGroup = z.infer<typeof insertFeeItemGroupSchema>;
export type FeeItem = typeof feeItems.$inferSelect;
export type InsertFeeItem = z.infer<typeof insertFeeItemSchema>;
export type FeeGroupFeeItem = typeof feeGroupFeeItems.$inferSelect;
export type InsertFeeGroupFeeItem = z.infer<typeof insertFeeGroupFeeItemSchema>;
export type PricingType = typeof pricingTypes.$inferSelect;
export type InsertPricingType = z.infer<typeof insertPricingTypeSchema>;
export type PricingTypeFeeItem = typeof pricingTypeFeeItems.$inferSelect;
export type InsertPricingTypeFeeItem = z.infer<typeof insertPricingTypeFeeItemSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type CampaignFeeValue = typeof campaignFeeValues.$inferSelect;
export type InsertCampaignFeeValue = z.infer<typeof insertCampaignFeeValueSchema>;
export type CampaignAssignment = typeof campaignAssignments.$inferSelect;
export type InsertCampaignAssignment = z.infer<typeof insertCampaignAssignmentSchema>;

// Extended types for campaign management with hierarchical structure
export type FeeItemWithGroup = FeeItem & {
  feeItemGroup?: FeeItemGroup;
  feeGroup: FeeGroup;
};

export type FeeItemGroupWithItems = FeeItemGroup & {
  feeItems: FeeItem[];
};

export type FeeGroupWithItemGroups = FeeGroup & {
  feeItemGroups: FeeItemGroupWithItems[];
  feeItems: FeeItem[]; // Direct items without groups
};

export type FeeGroupWithItems = FeeGroup & {
  feeItems: FeeItem[];
};

export type PricingTypeWithFeeItems = PricingType & {
  feeItems: (FeeItem & { isRequired: boolean; displayOrder: number })[];
};

export type CampaignWithDetails = Campaign & {
  pricingType: PricingType;
  feeValues: (CampaignFeeValue & { feeItem: FeeItemWithGroup })[];
  createdByUser?: User;
};

// Acquirers table - payment processors that require different application forms
export const acquirers = pgTable("acquirers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  code: text("code").notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Acquirer Application Templates - store dynamic form configurations for each acquirer
export const acquirerApplicationTemplates = pgTable("acquirer_application_templates", {
  id: serial("id").primaryKey(),
  acquirerId: integer("acquirer_id").notNull().references(() => acquirers.id, { onDelete: "cascade" }),
  templateName: text("template_name").notNull(),
  version: text("version").notNull().default("1.0"),
  isActive: boolean("is_active").notNull().default(true),
  fieldConfiguration: jsonb("field_configuration").notNull(),
  pdfMappingConfiguration: jsonb("pdf_mapping_configuration"),
  originalPdfBase64: text("original_pdf_base64"),
  originalPdfFilename: text("original_pdf_filename"),
  requiredFields: text("required_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  conditionalFields: jsonb("conditional_fields"),
  addressGroups: jsonb("address_groups").default(sql`'[]'::jsonb`),
  signatureGroups: jsonb("signature_groups").default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  sourcePdfPath: text("source_pdf_path"),
  disclosureGroups: jsonb("disclosure_groups").default(sql`'[]'::jsonb`),
}, (table) => ({
  uniqueAcquirerTemplate: unique("acq_app_tmpl_acq_name_ver_uniq").on(table.acquirerId, table.templateName, table.version),
}));

// Prospect Applications - store acquirer-specific application data
export const prospectApplications = pgTable("prospect_applications", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: "cascade" }),
  acquirerId: integer("acquirer_id").notNull().references(() => acquirers.id),
  templateId: integer("template_id").notNull().references(() => acquirerApplicationTemplates.id),
  templateVersion: text("template_version").notNull(),
  status: text("status").notNull().default("draft"),
  // Epic B — underwriting state machine. Sub-status only meaningful when status = 'in_review'.
  subStatus: text("sub_status"),
  underwritingType: text("underwriting_type").notNull().default("new_app"), // new_app | change_request
  riskScore: integer("risk_score"),
  riskTier: text("risk_tier"), // low | medium | high
  // Per-phase weighted score breakdown so the review UI can show derivation.
  // Shape: { components: Array<{ key, weight, status, rawScore, weightedScore }>, totalWeight, weightedSum }
  riskScoreBreakdown: jsonb("risk_score_breakdown"),
  assignedReviewerId: varchar("assigned_reviewer_id"),
  // Epic B — pathway controls which phases run and which scoring model applies.
  pathway: text("pathway").notNull().default("traditional"), // traditional | payfac
  slaDeadline: timestamp("sla_deadline"), // payfac final-review SLA
  pipelineHaltedAtPhase: text("pipeline_halted_at_phase"), // checkpoint that halted last run
  applicationData: jsonb("application_data").notNull().default('{}'),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  generatedPdfPath: text("generated_pdf_path"),
  // Epic F retention: marker set by complianceJobs.archiveExpiredApplications
  // when a snapshot is moved to archived_applications. While the source row is
  // preserved (so onDelete: cascade FKs don't drop audit/UW evidence), every
  // active write path MUST treat archivedAt != null as read-only. Helper:
  // server/lib/archiveGuard.assertNotArchived().
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueProspectAcquirer: unique().on(table.prospectId, table.acquirerId),
}));

// ─── Epic B — Underwriting Engine ────────────────────────────────────────────
// underwriting_runs is one full pipeline pass against an application. Multiple
// runs can exist per application (re-runs after info supplied, etc).
export const underwritingRuns = pgTable("underwriting_runs", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  startedBy: varchar("started_by"),
  status: text("status").notNull().default("running"), // running | completed | failed
  currentPhase: text("current_phase"),
  totalPhases: integer("total_phases").notNull().default(10),
  riskScore: integer("risk_score"),
  riskTier: text("risk_tier"),
  // Per-phase weighted score breakdown for this run.
  riskScoreBreakdown: jsonb("risk_score_breakdown"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const underwritingPhaseResults = pgTable("underwriting_phase_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => underwritingRuns.id, { onDelete: "cascade" }),
  phaseKey: text("phase_key").notNull(),
  phaseOrder: integer("phase_order").notNull(),
  status: text("status").notNull(), // pass | warn | fail | skipped | error
  score: integer("score").notNull().default(0),
  findings: jsonb("findings").default('[]'),
  endpointId: integer("endpoint_id").references((): any => externalEndpoints.id, { onDelete: "set null" }),
  externalRequest: jsonb("external_request"),
  externalResponse: jsonb("external_response"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const underwritingIssues = pgTable("underwriting_issues", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  runId: integer("run_id").references(() => underwritingRuns.id, { onDelete: "set null" }),
  phaseKey: text("phase_key"),
  severity: text("severity").notNull().default("warning"), // info | warning | error | critical
  code: text("code").notNull(),
  message: text("message").notNull(),
  fieldPath: text("field_path"),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved | waived
  resolvedBy: varchar("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const underwritingTasks = pgTable("underwriting_tasks", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  assignedToUserId: varchar("assigned_to_user_id"),
  assignedRole: text("assigned_role"),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: timestamp("due_at"),
  status: text("status").notNull().default("open"), // open | in_progress | done | cancelled
  createdBy: varchar("created_by"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const underwritingNotes = pgTable("underwriting_notes", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id"),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("internal"), // internal | external
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const underwritingFiles = pgTable("underwriting_files", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storedPath: text("stored_path").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  category: text("category"), // e.g. bank_statement, license, voided_check
  description: text("description"),
  uploadedBy: varchar("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const underwritingStatusHistory = pgTable("underwriting_status_history", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  fromSubStatus: text("from_sub_status"),
  toSubStatus: text("to_sub_status"),
  changedBy: varchar("changed_by"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUnderwritingRunSchema = createInsertSchema(underwritingRuns).omit({ id: true, startedAt: true });
export const insertUnderwritingPhaseResultSchema = createInsertSchema(underwritingPhaseResults).omit({ id: true, startedAt: true });
export const insertUnderwritingIssueSchema = createInsertSchema(underwritingIssues).omit({ id: true, createdAt: true });
export const insertUnderwritingTaskSchema = createInsertSchema(underwritingTasks).omit({ id: true, createdAt: true });
export const insertUnderwritingNoteSchema = createInsertSchema(underwritingNotes).omit({ id: true, createdAt: true });
export const insertUnderwritingStatusHistorySchema = createInsertSchema(underwritingStatusHistory).omit({ id: true, createdAt: true });

export type UnderwritingRun = typeof underwritingRuns.$inferSelect;
export type InsertUnderwritingRun = z.infer<typeof insertUnderwritingRunSchema>;
export type UnderwritingPhaseResult = typeof underwritingPhaseResults.$inferSelect;
export type InsertUnderwritingPhaseResult = z.infer<typeof insertUnderwritingPhaseResultSchema>;
export type UnderwritingIssue = typeof underwritingIssues.$inferSelect;
export type InsertUnderwritingIssue = z.infer<typeof insertUnderwritingIssueSchema>;
export type UnderwritingTask = typeof underwritingTasks.$inferSelect;
export type InsertUnderwritingTask = z.infer<typeof insertUnderwritingTaskSchema>;
export type UnderwritingNote = typeof underwritingNotes.$inferSelect;
export type InsertUnderwritingNote = z.infer<typeof insertUnderwritingNoteSchema>;
export type UnderwritingStatusHistoryEntry = typeof underwritingStatusHistory.$inferSelect;
export type InsertUnderwritingStatusHistory = z.infer<typeof insertUnderwritingStatusHistorySchema>;

// Campaign Application Templates junction table
export const campaignApplicationTemplates = pgTable("campaign_application_templates", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  templateId: integer("template_id").notNull().references(() => acquirerApplicationTemplates.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCampaignTemplate: unique().on(table.campaignId, table.templateId),
}));

// Acquirer management insert schemas
export const insertAcquirerSchema = createInsertSchema(acquirers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcquirerApplicationTemplateSchema = createInsertSchema(acquirerApplicationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProspectApplicationSchema = createInsertSchema(prospectApplications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignApplicationTemplateSchema = createInsertSchema(campaignApplicationTemplates).omit({
  id: true,
  createdAt: true,
});

// Acquirer management types
export type Acquirer = typeof acquirers.$inferSelect;
export type InsertAcquirer = z.infer<typeof insertAcquirerSchema>;
export type AcquirerApplicationTemplate = typeof acquirerApplicationTemplates.$inferSelect;
export type InsertAcquirerApplicationTemplate = z.infer<typeof insertAcquirerApplicationTemplateSchema>;
export type ProspectApplication = typeof prospectApplications.$inferSelect;
export type InsertProspectApplication = z.infer<typeof insertProspectApplicationSchema>;
export type CampaignApplicationTemplate = typeof campaignApplicationTemplates.$inferSelect;
export type InsertCampaignApplicationTemplate = z.infer<typeof insertCampaignApplicationTemplateSchema>;

// Extended types for acquirer management
export type AcquirerWithTemplates = Acquirer & {
  templates: AcquirerApplicationTemplate[];
};

export type CampaignWithAcquirer = Campaign & {
  acquirer: Acquirer;
};

export type ProspectApplicationWithDetails = ProspectApplication & {
  prospect: MerchantProspect;
  acquirer: Acquirer;
  template: AcquirerApplicationTemplate;
};

// SOC2 Compliance - Comprehensive Audit Trail System
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }), // Can be null for system actions
  userEmail: text("user_email"), // Cached for performance and retention
  sessionId: text("session_id"), // Session identifier
  ipAddress: text("ip_address").notNull(), // Client IP address
  userAgent: text("user_agent"), // Browser/client information
  
  // Action details
  action: text("action").notNull(), // create, read, update, delete, login, logout, etc.
  resource: text("resource").notNull(), // prospects, campaigns, users, etc.
  resourceId: text("resource_id"), // ID of affected resource
  
  // Request details
  method: text("method"), // GET, POST, PUT, DELETE
  endpoint: text("endpoint"), // API endpoint called
  requestParams: jsonb("request_params"), // Query parameters
  requestBody: jsonb("request_body"), // Request payload (sanitized)
  
  // Response details
  statusCode: integer("status_code"), // HTTP response code
  responseTime: integer("response_time"), // Response time in milliseconds
  
  // Change tracking
  oldValues: jsonb("old_values"), // Previous state (for updates/deletes)
  newValues: jsonb("new_values"), // New state (for creates/updates)
  
  // Risk and compliance
  riskLevel: text("risk_level").notNull().default("low"), // low, medium, high, critical
  complianceFlags: jsonb("compliance_flags"), // SOC2, GDPR, PCI flags
  dataClassification: text("data_classification"), // public, internal, confidential, restricted
  
  // Metadata
  environment: text("environment").default("production"), // production, test, dev
  applicationVersion: text("application_version"), // App version for audit trail
  tags: jsonb("tags"), // Additional searchable tags
  notes: text("notes"), // Human-readable description
  
  createdAt: timestamp("created_at").defaultNow().notNull(),

  resourceType: text("resource_type"),
  details: jsonb("details"),
  timestamp: timestamp("timestamp").defaultNow(),
  severity: text("severity").default("info"),
  category: text("category"),
  outcome: text("outcome"),
  errorMessage: text("error_message"),
  requestId: varchar("request_id"),
  correlationId: varchar("correlation_id"),
  metadata: jsonb("metadata"),
  geolocation: jsonb("geolocation"),
  deviceInfo: jsonb("device_info"),
  retentionPolicy: text("retention_policy"),
  encryptionKeyId: varchar("encryption_key_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("audit_logs_user_id_idx").on(table.userId),
  actionIdx: index("audit_logs_action_idx").on(table.action),
  resourceIdx: index("audit_logs_resource_idx").on(table.resource),
  ipAddressIdx: index("audit_logs_ip_address_idx").on(table.ipAddress),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
  riskLevelIdx: index("audit_logs_risk_level_idx").on(table.riskLevel),
  environmentIdx: index("audit_logs_environment_idx").on(table.environment),
}));

// Security Events - High-risk actions requiring special attention
export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  auditLogId: integer("audit_log_id").references(() => auditLogs.id),
  
  eventType: text("event_type").notNull(), // failed_login, data_breach, permission_escalation, etc.
  severity: text("severity").notNull(), // info, warning, error, critical
  alertStatus: text("alert_status").default("new"), // new, investigating, resolved, false_positive
  
  // Detection details
  detectionMethod: text("detection_method"), // automatic, manual, external
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  detectedBy: text("detected_by"), // system, user_id, external_system
  
  // Investigation
  assignedTo: varchar("assigned_to", { length: 255 }), // Security team member
  investigationNotes: text("investigation_notes"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 255 }),
  
  // Additional context
  affectedUsers: jsonb("affected_users"), // Array of affected user IDs
  affectedResources: jsonb("affected_resources"), // Array of affected resources
  mitigationActions: jsonb("mitigation_actions"), // Actions taken to resolve
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index("security_events_event_type_idx").on(table.eventType),
  severityIdx: index("security_events_severity_idx").on(table.severity),
  alertStatusIdx: index("security_events_alert_status_idx").on(table.alertStatus),
  detectedAtIdx: index("security_events_detected_at_idx").on(table.detectedAt),
}));

// Data Access Logs - Track sensitive data access
export const dataAccessLogs = pgTable("data_access_logs", {
  id: serial("id").primaryKey(),
  auditLogId: integer("audit_log_id").references(() => auditLogs.id),
  
  userId: varchar("user_id", { length: 255 }).notNull(),
  dataType: text("data_type").notNull(), // pii, financial, auth, etc.
  tableName: text("table_name").notNull(),
  recordId: text("record_id"),
  fieldAccessed: text("field_accessed"), // Specific field if applicable
  
  accessType: text("access_type").notNull(), // read, write, delete, export
  accessReason: text("access_reason"), // business_need, support, audit, etc.
  dataVolume: integer("data_volume"), // Number of records accessed
  
  // Compliance tracking
  lawfulBasis: text("lawful_basis"), // GDPR lawful basis
  retentionPeriod: integer("retention_period"), // Days to retain access log
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("data_access_logs_user_id_idx").on(table.userId),
  dataTypeIdx: index("data_access_logs_data_type_idx").on(table.dataType),
  tableNameIdx: index("data_access_logs_table_name_idx").on(table.tableName),
  accessTypeIdx: index("data_access_logs_access_type_idx").on(table.accessType),
  createdAtIdx: index("data_access_logs_created_at_idx").on(table.createdAt),
}));

// Zod schemas and TypeScript types for audit system
export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const insertSecurityEventSchema = createInsertSchema(securityEvents);
export const insertDataAccessLogSchema = createInsertSchema(dataAccessLogs);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type DataAccessLog = typeof dataAccessLogs.$inferSelect;
export type InsertDataAccessLog = z.infer<typeof insertDataAccessLogSchema>;

// Extended types for audit dashboard
export type AuditLogWithSecurityEvent = AuditLog & {
  securityEvent?: SecurityEvent;
};

export type SecurityEventWithAuditLog = SecurityEvent & {
  auditLog?: AuditLog;
};

// Email Management Tables
export const emailTemplates = pgTable('email_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  subject: text('subject').notNull(),
  htmlContent: text('html_content').notNull(),
  textContent: text('text_content'),
  variables: jsonb('variables'), // JSON array of available variables
  category: varchar('category', { length: 50 }).notNull(), // prospect, authentication, notification, etc.
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  useWrapper: boolean('use_wrapper').default(true),
  wrapperType: varchar('wrapper_type', { length: 50 }).default('notification'),
  headerGradient: text('header_gradient'),
  headerSubtitle: text('header_subtitle'),
  ctaButtonText: text('cta_button_text'),
  ctaButtonUrl: text('cta_button_url'),
  ctaButtonColor: text('cta_button_color'),
  customFooter: text('custom_footer'),
});

export const emailActivity = pgTable('email_activity', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => emailTemplates.id),
  templateName: varchar('template_name', { length: 100 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  recipientName: varchar('recipient_name', { length: 255 }),
  subject: text('subject').notNull(),
  status: varchar('status', { length: 20 }).notNull(), // sent, failed, bounced, opened, clicked
  errorMessage: text('error_message'),
  triggerSource: varchar('trigger_source', { length: 100 }), // api endpoint, manual, scheduled
  triggeredBy: varchar('triggered_by', { length: 255 }), // user ID or system
  metadata: jsonb('metadata'), // Additional context data
  sentAt: timestamp('sent_at').defaultNow(),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
}, (table) => ({
  templateIdIdx: index("email_activity_template_id_idx").on(table.templateId),
  recipientEmailIdx: index("email_activity_recipient_email_idx").on(table.recipientEmail),
  statusIdx: index("email_activity_status_idx").on(table.status),
  sentAtIdx: index("email_activity_sent_at_idx").on(table.sentAt),
}));

export const emailTriggers = pgTable('email_triggers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  templateId: integer('template_id').references(() => emailTemplates.id),
  triggerEvent: varchar('trigger_event', { length: 100 }).notNull(), // prospect_created, signature_requested, etc.
  isActive: boolean('is_active').default(true),
  conditions: jsonb('conditions'), // Conditions for triggering
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Email Management Zod schemas and types
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates);
export const insertEmailActivitySchema = createInsertSchema(emailActivity);
export const insertEmailTriggerSchema = createInsertSchema(emailTriggers);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailActivity = typeof emailActivity.$inferSelect;
export type InsertEmailActivity = z.infer<typeof insertEmailActivitySchema>;
export type EmailTrigger = typeof emailTriggers.$inferSelect;
export type InsertEmailTrigger = z.infer<typeof insertEmailTriggerSchema>;

// ─── Workflow Definitions ─────────────────────────────────────────────────────

// Core workflow automation templates
export const workflowDefinitions = pgTable("workflow_definitions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  trigger: varchar("trigger", { length: 50 }).notNull().default("manual"), // manual, webhook, schedule, event
  triggerConfig: jsonb("trigger_config").default("{}"),
  steps: jsonb("steps").default("[]"), // array of step definitions
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft, active, inactive
  isEnabled: boolean("is_enabled").notNull().default(true),
  allowedRoles: text("allowed_roles").array().default(['admin']),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),

  code: varchar("code", { length: 50 }).notNull(),
  version: text("version").notNull().default("1.0"),
  category: text("category").notNull(),
  entityType: text("entity_type").notNull(),
  initialStatus: text("initial_status").notNull().default("submitted"),
  finalStatuses: text("final_statuses").array().notNull().default(sql`ARRAY['approved'::text, 'declined'::text, 'withdrawn'::text]`),
  configuration: jsonb("configuration").default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
});

// Per-environment configuration overrides for workflows
export const workflowEnvironmentConfigs = pgTable("workflow_environment_configs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => workflowDefinitions.id, { onDelete: "cascade" }),
  environment: varchar("environment", { length: 20 }).notNull(), // production, development, test
  config: jsonb("config").default("{}"), // environment-specific config overrides
  baseUrl: text("base_url"),
  bearerToken: text("bearer_token"),
  additionalHeaders: jsonb("additional_headers"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Workflow Zod schemas and types
export const insertWorkflowDefinitionSchema = createInsertSchema(workflowDefinitions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkflowEnvironmentConfigSchema = createInsertSchema(workflowEnvironmentConfigs).omit({ id: true, createdAt: true, updatedAt: true });

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type InsertWorkflowDefinition = z.infer<typeof insertWorkflowDefinitionSchema>;
export type WorkflowEnvironmentConfig = typeof workflowEnvironmentConfigs.$inferSelect;
export type InsertWorkflowEnvironmentConfig = z.infer<typeof insertWorkflowEnvironmentConfigSchema>;

export type WorkflowDefinitionWithDetails = WorkflowDefinition & {
  environmentConfigs?: WorkflowEnvironmentConfig[];
};

// ─── MCC Codes & Policies ─────────────────────────────────────────────────────

export const mccCodes = pgTable("mcc_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 4 }).notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const mccPolicies = pgTable("mcc_policies", {
  id: serial("id").primaryKey(),
  mccCodeId: integer("mcc_code_id").notNull().references(() => mccCodes.id, { onDelete: "cascade" }),
  acquirerId: integer("acquirer_id").references(() => acquirers.id),
  policyType: text("policy_type").notNull(),
  riskLevelOverride: text("risk_level_override"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMccCodeSchema = createInsertSchema(mccCodes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMccPolicySchema = createInsertSchema(mccPolicies).omit({ id: true, createdAt: true, updatedAt: true });

export type MccCode = typeof mccCodes.$inferSelect;
export type InsertMccCode = z.infer<typeof insertMccCodeSchema>;
export type MccPolicy = typeof mccPolicies.$inferSelect;
export type InsertMccPolicy = z.infer<typeof insertMccPolicySchema>;

// ─── Disclosure Library ───────────────────────────────────────────────────────

export const disclosureDefinitions = pgTable("disclosure_definitions", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"),
  companyId: integer("company_id"),
  isActive: boolean("is_active").notNull().default(true),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  requiresInitials: boolean("requires_initials").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const disclosureVersions = pgTable("disclosure_versions", {
  id: serial("id").primaryKey(),
  definitionId: integer("definition_id").notNull().references(() => disclosureDefinitions.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash"),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  requiresInitials: boolean("requires_initials").notNull().default(false),
  effectiveDate: timestamp("effective_date"),
  retiredDate: timestamp("retired_date"),
  isCurrentVersion: boolean("is_current_version").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  metadata: jsonb("metadata"),
});

export const insertDisclosureDefinitionSchema = createInsertSchema(disclosureDefinitions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDisclosureVersionSchema = createInsertSchema(disclosureVersions).omit({ id: true, createdAt: true });

export type DisclosureDefinition = typeof disclosureDefinitions.$inferSelect;
export type InsertDisclosureDefinition = z.infer<typeof insertDisclosureDefinitionSchema>;
export type DisclosureVersion = typeof disclosureVersions.$inferSelect;
export type InsertDisclosureVersion = z.infer<typeof insertDisclosureVersionSchema>;

export type DisclosureDefinitionWithVersions = DisclosureDefinition & {
  versions?: DisclosureVersion[];
  currentVersion?: DisclosureVersion | null;
};

// ─── Action Templates & Trigger System ────────────────────────────────────────

export const actionTemplates = pgTable("action_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  description: text("description"),
  actionType: varchar("action_type").notNull(),
  category: varchar("category").notNull(),
  config: jsonb("config").notNull(),
  variables: jsonb("variables"),
  isActive: boolean("is_active").default(true),
  version: integer("version").default(1),
  // Optional FK into the External Endpoints Registry. For webhook templates,
  // when set, the runtime loads url/method/headers/auth from the registry row
  // and the `config` field only carries body/variables/isDataSource etc.
  endpointId: integer("endpoint_id").references((): any => externalEndpoints.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const triggerCatalog = pgTable("trigger_catalog", {
  id: serial("id").primaryKey(),
  triggerKey: varchar("trigger_key").notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  category: varchar("category").notNull(),
  contextSchema: jsonb("context_schema"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const triggerActions = pgTable("trigger_actions", {
  id: serial("id").primaryKey(),
  triggerId: integer("trigger_id").notNull().references(() => triggerCatalog.id),
  actionTemplateId: integer("action_template_id").notNull().references(() => actionTemplates.id),
  sequenceOrder: integer("sequence_order").default(1),
  conditions: jsonb("conditions"),
  requiresEmailPreference: boolean("requires_email_preference").default(false),
  requiresSmsPreference: boolean("requires_sms_preference").default(false),
  delaySeconds: integer("delay_seconds").default(0),
  retryOnFailure: boolean("retry_on_failure").default(true),
  maxRetries: integer("max_retries").default(3),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const actionActivity = pgTable("action_activity", {
  id: serial("id").primaryKey(),
  triggerActionId: integer("trigger_action_id"),
  triggerId: integer("trigger_id"),
  actionTemplateId: integer("action_template_id"),
  actionType: varchar("action_type").notNull(),
  recipient: varchar("recipient").notNull(),
  recipientName: varchar("recipient_name"),
  status: varchar("status").notNull(),
  statusMessage: text("status_message"),
  triggerSource: varchar("trigger_source"),
  triggeredBy: varchar("triggered_by"),
  contextData: jsonb("context_data"),
  responseData: jsonb("response_data"),
  executedAt: timestamp("executed_at").defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  failedAt: timestamp("failed_at"),
  retryCount: integer("retry_count").default(0),
});

// ============================================================================
// Epic E — Commission Ledger & Residuals
// ============================================================================

// Per-edge override percentage. When a transaction earned by `childAgentId`
// flows up to `parentAgentId`, this row's `percent` decides the parent's slice.
// If no row exists, the engine falls back to commission_settings.defaultOverridePct.
export const agentOverrides = pgTable("agent_overrides", {
  id: serial("id").primaryKey(),
  parentAgentId: integer("parent_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  childAgentId: integer("child_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  percent: decimal("percent", { precision: 5, scale: 2 }).notNull(), // e.g. 0.50 = 0.5%
  notes: text("notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqEdge: unique("agent_overrides_edge_uq").on(t.parentAgentId, t.childAgentId),
  parentIdx: index("agent_overrides_parent_idx").on(t.parentAgentId),
  childIdx: index("agent_overrides_child_idx").on(t.childAgentId),
}));

// One row per beneficiary per transaction. `depth` = 0 means the merchant's
// own (direct) agent; depth>=1 means upline override slice. Status flow:
//   pending -> payable -> paid (or reversed at any point).
export const commissionEvents = pgTable("commission_events", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  merchantId: integer("merchant_id").notNull(),
  sourceAgentId: integer("source_agent_id"), // the merchant's primary agent
  beneficiaryAgentId: integer("beneficiary_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  depth: integer("depth").notNull(), // 0 = direct, 1+ = upline override
  basisAmount: decimal("basis_amount", { precision: 14, scale: 2 }).notNull(), // amount used for the calculation
  ratePct: decimal("rate_pct", { precision: 6, scale: 3 }).notNull(),          // commission rate % applied
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),            // basis * rate / 100
  status: text("status").notNull().default("pending"), // pending | payable | paid | reversed
  payoutId: integer("payout_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  txIdx: index("commission_events_tx_idx").on(t.transactionId),
  benIdx: index("commission_events_beneficiary_idx").on(t.beneficiaryAgentId),
  statusIdx: index("commission_events_status_idx").on(t.status),
  payoutIdx: index("commission_events_payout_idx").on(t.payoutId),
}));

// Payout batch header. Aggregates payable events for one agent over a period.
export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  grossAmount: decimal("gross_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  adjustments: decimal("adjustments", { precision: 14, scale: 2 }).notNull().default("0"),
  netAmount: decimal("net_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  method: text("method").notNull().default("ach"), // ach | check | manual | wire
  reference: text("reference"),
  status: text("status").notNull().default("draft"), // draft | processing | paid | void
  notes: text("notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
}, (t) => ({
  agentIdx: index("payouts_agent_idx").on(t.agentId),
  statusIdx: index("payouts_status_idx").on(t.status),
}));

// Singleton-ish settings. Keep keyed so we can grow without schema changes.
export const commissionSettings = pgTable("commission_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAgentOverrideSchema = createInsertSchema(agentOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCommissionEventSchema = createInsertSchema(commissionEvents).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPayoutSchema = createInsertSchema(payouts).omit({ id: true, createdAt: true, paidAt: true, grossAmount: true, netAmount: true });
export const insertCommissionSettingSchema = createInsertSchema(commissionSettings).omit({ id: true, updatedAt: true });

export type AgentOverride = typeof agentOverrides.$inferSelect;
export type InsertAgentOverride = z.infer<typeof insertAgentOverrideSchema>;
export type CommissionEvent = typeof commissionEvents.$inferSelect;
export type InsertCommissionEvent = z.infer<typeof insertCommissionEventSchema>;
export type Payout = typeof payouts.$inferSelect;
export type InsertPayout = z.infer<typeof insertPayoutSchema>;
export type CommissionSetting = typeof commissionSettings.$inferSelect;

export const COMMISSION_EVENT_STATUSES = ["pending", "payable", "paid", "reversed"] as const;
export const PAYOUT_STATUSES = ["draft", "processing", "paid", "void"] as const;
export const PAYOUT_METHODS = ["ach", "check", "manual", "wire"] as const;
export const COMMISSION_SETTING_KEYS = {
  DEFAULT_OVERRIDE_PCT: "default_override_pct",
  COMMISSION_BASIS: "commission_basis", // "amount" | "processing_fee"
} as const;

export const insertActionTemplateSchema = createInsertSchema(actionTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTriggerCatalogSchema = createInsertSchema(triggerCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTriggerActionSchema = createInsertSchema(triggerActions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertActionActivitySchema = createInsertSchema(actionActivity).omit({ id: true, executedAt: true });

export type ActionTemplate = typeof actionTemplates.$inferSelect;
export type InsertActionTemplate = z.infer<typeof insertActionTemplateSchema>;
export type TriggerCatalog = typeof triggerCatalog.$inferSelect;
export type InsertTriggerCatalog = z.infer<typeof insertTriggerCatalogSchema>;
export type TriggerAction = typeof triggerActions.$inferSelect;
export type InsertTriggerAction = z.infer<typeof insertTriggerActionSchema>;
export type ActionActivityRecord = typeof actionActivity.$inferSelect;

// ─── Epic F — Compliance, SLAs & Operations Polish ──────────────────────────

// SLA breach ledger. The compliance ticker writes one row when an open
// application crosses its slaDeadline. Subsequent ticks for the same
// application+slaDeadline are deduped on the unique (applicationId, deadlineAt).
export const slaBreaches = pgTable("sla_breaches", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => prospectApplications.id, { onDelete: "cascade" }),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: "cascade" }),
  pathway: text("pathway").notNull(), // traditional | payfac
  status: text("status").notNull(),   // application status at breach time
  deadlineAt: timestamp("deadline_at").notNull(),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  hoursOverdue: integer("hours_overdue").notNull(),
  acknowledged: boolean("acknowledged").default(false).notNull(),
  acknowledgedBy: varchar("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  notes: text("notes"),
}, (table) => ({
  uniqueAppDeadline: unique("sla_breaches_app_deadline_unique").on(table.applicationId, table.deadlineAt),
  applicationIdx: index("sla_breaches_application_idx").on(table.applicationId),
  detectedAtIdx: index("sla_breaches_detected_at_idx").on(table.detectedAt),
}));

export const insertSlaBreachSchema = createInsertSchema(slaBreaches).omit({ id: true, detectedAt: true });
export type SlaBreach = typeof slaBreaches.$inferSelect;
export type InsertSlaBreach = z.infer<typeof insertSlaBreachSchema>;

// Retention archive — declined/withdrawn applications older than the retention
// window are moved here by the nightly archive job. We snapshot the row as
// JSON so the schema can evolve independently.
export const archivedApplications = pgTable("archived_applications", {
  id: serial("id").primaryKey(),
  originalApplicationId: integer("original_application_id").notNull(),
  prospectId: integer("prospect_id"),
  finalStatus: text("final_status").notNull(),
  applicationSnapshot: jsonb("application_snapshot").notNull(),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
  archivedReason: text("archived_reason").notNull(), // e.g. retention_policy_90d
}, (table) => ({
  originalIdIdx: index("archived_applications_original_id_idx").on(table.originalApplicationId),
  archivedAtIdx: index("archived_applications_archived_at_idx").on(table.archivedAt),
}));

export const insertArchivedApplicationSchema = createInsertSchema(archivedApplications).omit({ id: true, archivedAt: true });
export type ArchivedApplication = typeof archivedApplications.$inferSelect;
export type InsertArchivedApplication = z.infer<typeof insertArchivedApplicationSchema>;

// Scheduled reports. A configurable cadence + template definition; a hourly
// runner picks rows whose nextRunAt <= now() and dispatches via emailService.
export const scheduledReports = pgTable("scheduled_reports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  template: text("template").notNull(), // sla_summary | underwriting_pipeline | commission_payouts
  cadence: text("cadence").notNull(),   // daily | weekly | monthly
  recipients: text("recipients").array().notNull(), // email addresses
  enabled: boolean("enabled").default(true).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at").notNull(),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  enabledIdx: index("scheduled_reports_enabled_idx").on(table.enabled),
  nextRunAtIdx: index("scheduled_reports_next_run_at_idx").on(table.nextRunAt),
}));

export const insertScheduledReportSchema = createInsertSchema(scheduledReports).omit({
  id: true, createdAt: true, updatedAt: true, lastRunAt: true,
});
export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = z.infer<typeof insertScheduledReportSchema>;

export const scheduledReportRuns = pgTable("scheduled_report_runs", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => scheduledReports.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // success | failed
  rowCount: integer("row_count").default(0).notNull(),
  errorMessage: text("error_message"),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
}, (table) => ({
  reportIdx: index("scheduled_report_runs_report_idx").on(table.reportId),
  ranAtIdx: index("scheduled_report_runs_ran_at_idx").on(table.ranAt),
}));

export type ScheduledReportRun = typeof scheduledReportRuns.$inferSelect;

// Schema drift alerts — daily ticker compares production schema to dev/test
// using the existing schema-compare utility and inserts a row per detected
// difference set. Resolution flag flips when a super-admin acknowledges.
export const schemaDriftAlerts = pgTable("schema_drift_alerts", {
  id: serial("id").primaryKey(),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  baseEnvironment: text("base_environment").notNull(),    // production
  targetEnvironment: text("target_environment").notNull(), // development | test
  differenceCount: integer("difference_count").notNull(),
  differences: jsonb("differences").notNull(),
  acknowledged: boolean("acknowledged").default(false).notNull(),
  acknowledgedBy: varchar("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
}, (table) => ({
  detectedAtIdx: index("schema_drift_alerts_detected_at_idx").on(table.detectedAt),
  acknowledgedIdx: index("schema_drift_alerts_acknowledged_idx").on(table.acknowledged),
}));

export type SchemaDriftAlert = typeof schemaDriftAlerts.$inferSelect;

// ============================================================
// Tables previously defined directly in databases via raw SQL.
// Reverse-engineered from live schema so shared/schema.ts is
// the single source of truth for all data structures.
// ============================================================

export const apiIntegrationConfigs = pgTable("api_integration_configs", {
  id: serial("id").primaryKey(),
  integrationKey: varchar("integration_key", { length: 50 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  baseUrl: text("base_url"),
  sandboxUrl: text("sandbox_url"),
  configuration: jsonb("configuration").default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  useSandbox: boolean("use_sandbox").notNull().default(true),
  rateLimit: integer("rate_limit"),
  rateLimitWindow: integer("rate_limit_window").default(60),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessType: text("business_type"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  taxId: varchar("tax_id"),
  address: jsonb("address"),
  industry: text("industry"),
  description: text("description"),
  logoUrl: text("logo_url"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  settings: jsonb("settings").default(sql`'{}'::jsonb`),
});

export const companyAddresses = pgTable("company_addresses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  addressId: integer("address_id").notNull(),
  type: text("type").notNull().default("primary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const disclosureAcknowledgments = pgTable("disclosure_acknowledgments", {
  id: serial("id").primaryKey(),
  disclosureContentId: integer("disclosure_content_id").notNull(),
  disclosureVersion: text("disclosure_version").notNull(),
  prospectApplicationId: integer("prospect_application_id"),
  prospectId: integer("prospect_id"),
  scrollStartedAt: timestamp("scroll_started_at"),
  scrollCompletedAt: timestamp("scroll_completed_at"),
  scrollDurationMs: integer("scroll_duration_ms"),
  scrollPercentage: integer("scroll_percentage").default(0),
  signatureData: text("signature_data"),
  signerName: text("signer_name"),
  signerEmail: text("signer_email"),
  signedAt: timestamp("signed_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("pending"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const disclosureContents = pgTable("disclosure_contents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  version: text("version").notNull().default("1.0"),
  isActive: boolean("is_active").notNull().default(true),
  requiresSignature: boolean("requires_signature").notNull().default(true),
  companyId: integer("company_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const disclosureSignatures = pgTable("disclosure_signatures", {
  id: serial("id").primaryKey(),
  disclosureVersionId: integer("disclosure_version_id").notNull(),
  prospectId: integer("prospect_id"),
  userId: varchar("user_id"),
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email"),
  signerTitle: text("signer_title"),
  signatureType: text("signature_type").notNull(),
  signatureData: text("signature_data"),
  signatureStoragePath: text("signature_storage_path"),
  scrollStartedAt: timestamp("scroll_started_at"),
  scrollCompletedAt: timestamp("scroll_completed_at"),
  scrollDurationMs: integer("scroll_duration_ms"),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  contentHashAtSigning: text("content_hash_at_signing"),
  isRevoked: boolean("is_revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at"),
  revokedBy: varchar("revoked_by"),
  revokedReason: text("revoked_reason"),
  applicationId: integer("application_id"),
  templateId: integer("template_id"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailWrappers = pgTable("email_wrappers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(),
  headerGradient: text("header_gradient"),
  headerSubtitle: text("header_subtitle"),
  ctaButtonText: text("cta_button_text"),
  ctaButtonUrl: text("cta_button_url"),
  ctaButtonColor: text("cta_button_color"),
  customFooter: text("custom_footer"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const passwordHistory = pgTable("password_history", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  passwordHash: varchar("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const permissionAuditLog = pgTable("permission_audit_log", {
  id: serial("id").primaryKey(),
  actorUserId: varchar("actor_user_id").notNull(),
  roleKey: text("role_key").notNull(),
  resourceId: integer("resource_id").notNull(),
  action: text("action").notNull(),
  changeType: text("change_type").notNull(),
  previousValue: boolean("previous_value"),
  newValue: boolean("new_value").notNull(),
  notes: text("notes"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const prospectDocuments = pgTable("prospect_documents", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull(),
  fileName: text("file_name").notNull(),
  originalFileName: text("original_file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storageKey: text("storage_key").notNull(),
  category: text("category").notNull().default("general"),
  uploadedBy: varchar("uploaded_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const prospectNotifications = pgTable("prospect_notifications", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdBy: varchar("created_by").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rbacResources = pgTable("rbac_resources", {
  id: serial("id").primaryKey(),
  resourceKey: text("resource_key").notNull(),
  resourceType: text("resource_type").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  category: text("category"),
  parentResourceKey: text("parent_resource_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
});

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleKey: text("role_key").notNull(),
  resourceId: integer("resource_id").notNull(),
  action: text("action").notNull().default("view"),
  isGranted: boolean("is_granted").notNull().default(true),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  grantedBy: varchar("granted_by"),
  notes: text("notes"),
});

export const schemaMigrations = pgTable("schema_migrations", {
  id: serial("id").primaryKey(),
  migrationId: varchar("migration_id", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  appliedAt: timestamp("applied_at").defaultNow(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  environment: varchar("environment", { length: 50 }).notNull(),
});

export const signatureCaptures = pgTable("signature_captures", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id"),
  prospectId: integer("prospect_id"),
  roleKey: text("role_key").notNull(),
  signerType: text("signer_type").notNull(),
  signerName: text("signer_name"),
  signerEmail: text("signer_email"),
  signature: text("signature"),
  signatureType: text("signature_type"),
  initials: text("initials"),
  dateSigned: timestamp("date_signed"),
  timestampSigned: timestamp("timestamp_signed"),
  timestampRequested: timestamp("timestamp_requested"),
  timestampExpires: timestamp("timestamp_expires"),
  requestToken: text("request_token"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  ownershipPercentage: numeric("ownership_percentage", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const signatureDisclosureLinks = pgTable("signature_disclosure_links", {
  id: serial("id").primaryKey(),
  signatureCaptureId: integer("signature_capture_id").notNull(),
  disclosureFieldName: text("disclosure_field_name").notNull(),
  disclosureDefinitionId: integer("disclosure_definition_id"),
  disclosureVersionId: integer("disclosure_version_id"),
  isRequired: boolean("is_required").notNull().default(true),
  signerRole: text("signer_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const signatureRequests = pgTable("signature_requests", {
  id: serial("id").primaryKey(),
  signatureCaptureId: integer("signature_capture_id").notNull(),
  applicationId: integer("application_id"),
  requestToken: text("request_token").notNull(),
  signerEmail: text("signer_email").notNull(),
  signerName: text("signer_name").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  signedAt: timestamp("signed_at"),
  cancelledAt: timestamp("cancelled_at"),
  reminderCount: integer("reminder_count").notNull().default(0),
  lastReminderAt: timestamp("last_reminder_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by"),
});

export const stageApiConfigs = pgTable("stage_api_configs", {
  id: serial("id").primaryKey(),
  stageId: integer("stage_id").notNull(),
  integrationId: integer("integration_id"),
  // FK to the shared external_endpoints registry. Transport
  // (url/method/headers/auth) is loaded from the registry row.
  endpointId: integer("endpoint_id").references((): any => externalEndpoints.id, { onDelete: "set null" }),
  requestMapping: jsonb("request_mapping").default(sql`'{}'::jsonb`),
  requestTemplate: text("request_template"),
  responseMapping: jsonb("response_mapping").default(sql`'{}'::jsonb`),
  rules: jsonb("rules").default(sql`'[]'::jsonb`),
  timeoutSeconds: integer("timeout_seconds").default(30),
  maxRetries: integer("max_retries").default(3),
  retryDelaySeconds: integer("retry_delay_seconds").default(5),
  fallbackOnError: text("fallback_on_error").default("pending_review"),
  fallbackOnTimeout: text("fallback_on_timeout").default("pending_review"),
  isActive: boolean("is_active").notNull().default(true),
  testMode: boolean("test_mode").notNull().default(false),
  mockResponse: jsonb("mock_response"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userCompanyAssociations = pgTable("user_company_associations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  companyId: integer("company_id").notNull(),
  companyRole: text("company_role").notNull(),
  permissions: jsonb("permissions").default(sql`'{}'::jsonb`),
  title: text("title"),
  department: text("department"),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const volumeThresholds = pgTable("volume_thresholds", {
  id: serial("id").primaryKey(),
  acquirerId: integer("acquirer_id").notNull(),
  name: text("name").notNull(),
  maxMonthlyVolume: numeric("max_monthly_volume", { precision: 12, scale: 2 }),
  minCardPresentPercent: numeric("min_card_present_percent", { precision: 5, scale: 2 }),
  maxHighTicket: numeric("max_high_ticket", { precision: 10, scale: 2 }),
  requiresApprovedMcc: boolean("requires_approved_mcc").notNull().default(false),
  riskTier: text("risk_tier"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowArtifacts = pgTable("workflow_artifacts", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  ticketStageId: integer("ticket_stage_id"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  filePath: text("file_path"),
  artifactType: text("artifact_type").notNull(),
  category: text("category"),
  description: text("description"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("active"),
  uploadedBy: varchar("uploaded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowAssignments = pgTable("workflow_assignments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  assignedToId: varchar("assigned_to_id").notNull(),
  assignedById: varchar("assigned_by_id"),
  assignmentType: text("assignment_type").notNull().default("primary"),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
});

export const workflowIssues = pgTable("workflow_issues", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  ticketStageId: integer("ticket_stage_id"),
  issueCode: varchar("issue_code", { length: 50 }).notNull(),
  issueType: text("issue_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  title: text("title").notNull(),
  description: text("description"),
  affectedField: text("affected_field"),
  affectedEntity: text("affected_entity"),
  affectedEntityId: text("affected_entity_id"),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
  overrideReason: text("override_reason"),
  overriddenAt: timestamp("overridden_at"),
  overriddenBy: varchar("overridden_by"),
  scoreImpact: integer("score_impact"),
  sourceData: jsonb("source_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowNotes = pgTable("workflow_notes", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  ticketStageId: integer("ticket_stage_id"),
  content: text("content").notNull(),
  noteType: text("note_type").notNull().default("general"),
  isInternal: boolean("is_internal").notNull().default(true),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowStages = pgTable("workflow_stages", {
  id: serial("id").primaryKey(),
  workflowDefinitionId: integer("workflow_definition_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  orderIndex: integer("order_index").notNull(),
  stageType: text("stage_type").notNull().default("automated"),
  handlerKey: text("handler_key"),
  isRequired: boolean("is_required").notNull().default(true),
  requiresReview: boolean("requires_review").notNull().default(false),
  autoAdvance: boolean("auto_advance").notNull().default(true),
  issueBlocksSeverity: text("issue_blocks_severity"),
  timeoutMinutes: integer("timeout_minutes"),
  retryConfig: jsonb("retry_config"),
  configuration: jsonb("configuration").default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowTasks = pgTable("workflow_tasks", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  issueId: integer("issue_id"),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull().default("action"),
  assignedToId: varchar("assigned_to_id"),
  assignedToRole: text("assigned_to_role"),
  assignedAt: timestamp("assigned_at"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by"),
  completionNotes: text("completion_notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowTicketStages = pgTable("workflow_ticket_stages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  stageId: integer("stage_id").notNull(),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionCount: integer("execution_count").notNull().default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  lastExecutedBy: varchar("last_executed_by"),
  handlerResponse: jsonb("handler_response"),
  errorMessage: text("error_message"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by"),
  reviewNotes: text("review_notes"),
  reviewDecision: text("review_decision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowTickets = pgTable("workflow_tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number", { length: 50 }).notNull(),
  workflowDefinitionId: integer("workflow_definition_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  status: text("status").notNull().default("submitted"),
  subStatus: text("sub_status"),
  currentStageId: integer("current_stage_id"),
  priority: text("priority").notNull().default("normal"),
  riskLevel: text("risk_level"),
  riskScore: integer("risk_score"),
  assignedToId: varchar("assigned_to_id"),
  assignedAt: timestamp("assigned_at"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  dueAt: timestamp("due_at"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  lastReviewedBy: varchar("last_reviewed_by"),
  reviewCount: integer("review_count").notNull().default(0),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// External Endpoints Registry — transport-only catalogue of outbound HTTP calls
// shared by workflow stages and Communications webhooks. Body templates,
// response mapping, and stage/trigger bindings live with the consumer, NOT here.
export const externalEndpoints = pgTable("external_endpoints", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  url: varchar("url", { length: 2048 }).notNull(),
  method: varchar("method", { length: 10 }).notNull().default("POST"),
  headers: jsonb("headers").default(sql`'{}'::jsonb`),
  authType: varchar("auth_type", { length: 20 }).notNull().default("none"),
  authConfig: jsonb("auth_config").default(sql`'{}'::jsonb`),
  timeoutSeconds: integer("timeout_seconds").notNull().default(30),
  maxRetries: integer("max_retries").notNull().default(0),
  retryDelaySeconds: integer("retry_delay_seconds").notNull().default(5),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertExternalEndpointSchema = createInsertSchema(externalEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ExternalEndpoint = typeof externalEndpoints.$inferSelect;
export type InsertExternalEndpoint = z.infer<typeof insertExternalEndpointSchema>;

export const workflowTransitions = pgTable("workflow_transitions", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  transitionType: text("transition_type").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  fromStageId: integer("from_stage_id"),
  toStageId: integer("to_stage_id"),
  reason: text("reason"),
  notes: text("notes"),
  triggeredBy: varchar("triggered_by"),
  triggeredBySystem: boolean("triggered_by_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

