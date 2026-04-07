import { pgTable, text, serial, integer, boolean, timestamp, decimal, varchar, jsonb, index, unique, uniqueIndex, real, numeric } from "drizzle-orm/pg-core";
import { sql, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Trigger Events - Single source of truth for all system trigger events
export const TRIGGER_EVENTS = [
  'user_registered',
  'agent_registered',
  'application_submitted',
  'password_reset_requested',
  'account_activated',
  'merchant_approved',
  'signature_requested',
  'prospect_created',
  'prospect_validation',
  'email_verification_requested',
  'two_factor_requested',
] as const;

export const triggerEventSchema = z.enum(TRIGGER_EVENTS);
export type TriggerEvent = z.infer<typeof triggerEventSchema>;

export const merchants = pgTable("merchants", {
  id: serial("id").primaryKey(),
  businessName: text("business_name"), // DBA or trade name
  businessType: text("business_type"), // LLC, Corporation, Sole Proprietor, etc.
  email: text("email"), // Business email
  phone: text("phone"), // Business phone
  agentId: integer("agent_id"),
  processingFee: decimal("processing_fee", { precision: 5, scale: 2 }).default("2.50").notNull(),
  status: text("status").notNull().default("active"), // active, pending, suspended
  monthlyVolume: decimal("monthly_volume", { precision: 12, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "restrict" }).unique(),
  dbaName: text("dba_name"), // Doing Business As name
  legalName: text("legal_name"), // Legal business name
  ein: text("ein"), // Employer Identification Number
  website: text("website"), // Business website URL
  industry: text("industry"), // Business industry/category
  updatedAt: timestamp("updated_at", { withTimezone: true }), // Last update timestamp
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Every merchant must have a company
  notes: text("notes"),
});

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => merchants.id, { onDelete: "cascade" }), // Made nullable for company locations
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }), // Support company locations
  mid: varchar("mid", { length: 50 }).unique(), // Merchant ID for tracking transactions to locations
  name: text("name").notNull(),
  type: text("type").notNull().default("store"), // store, warehouse, office, headquarters, company_office
  phone: text("phone"),
  email: text("email"),
  status: text("status").notNull().default("active"), // active, inactive, temporarily_closed
  operatingHours: jsonb("operating_hours"), // Store days/hours as JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const addresses = pgTable("addresses", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }), // Made nullable for company addresses
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

// Junction table for company-address relationships
export const companyAddresses = pgTable("company_addresses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  addressId: integer("address_id").notNull().references(() => addresses.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("primary"), // primary, billing, shipping, mailing
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // Ensure unique company-address-type combinations
  unique("unique_company_address_type").on(table.companyId, table.addressId, table.type),
  // Index for faster lookups
  index("company_addresses_company_idx").on(table.companyId),
  index("company_addresses_address_idx").on(table.addressId),
]);

// Company-centric architecture: agents reference companies for email/phone
export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "restrict" }).unique(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  territory: text("territory"),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("5.00"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  agentSignature: text("agent_signature"), // Agent's signature data (canvas data URL or typed text)
  agentSignatureType: text("agent_signature_type"), // 'canvas' or 'typed'
  agentSignedAt: timestamp("agent_signed_at"), // When the agent signed
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  commissionRate: decimal("commission_rate", { precision: 5, scale: 4 }).default("0.025"), // Agent commission rate
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).default("0"), // Calculated commission
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow(), // Transaction processing date
  referenceNumber: text("reference_number"), // External reference number
  locationId: integer("location_id"), // Associated location
  transactionType: text("transaction_type").notNull().default("payment"), // payment, refund, chargeback
  processedAt: timestamp("processed_at", { withTimezone: true }), // When transaction was processed
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

export const insertCompanyAddressSchema = createInsertSchema(companyAddresses).omit({
  id: true,
  createdAt: true,
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

export type InsertCompanyAddress = z.infer<typeof insertCompanyAddressSchema>;
export type CompanyAddress = typeof companyAddresses.$inferSelect;

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

// Company relationship types
export type MerchantWithCompany = Merchant & {
  company?: Company;
  agent?: Agent;
};

export type AgentWithCompany = Agent & {
  company?: Company;
};

export type MerchantWithCompanyAndLocations = Merchant & {
  company?: Company;
  locations?: LocationWithAddresses[];
  agent?: Agent;
};

// User management tables
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique().notNull(),
  username: varchar("username").unique().notNull(),
  passwordHash: varchar("password_hash").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: varchar("phone"), // Optional phone number to avoid data loss on existing users
  profileImageUrl: varchar("profile_image_url"),
  communicationPreference: text("communication_preference").default("email"), // email, sms, or both
  roles: text("roles").array().notNull().default(sql`ARRAY['merchant']`), // Array of roles: merchant, agent, admin, corporate, super_admin
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Companies/Organizations table for business entity management
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Company name must be unique
  businessType: text("business_type"), // corporation, llc, partnership, sole_proprietorship, non_profit
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  taxId: varchar("tax_id"), // EIN or Tax ID number
  address: jsonb("address"), // Store address as JSON object
  industry: text("industry"),
  description: text("description"),
  logoUrl: text("logo_url"),
  status: text("status").notNull().default("active"), // active, inactive, suspended
  settings: jsonb("settings").default("{}"), // Company-specific settings
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Junction table for user-company relationships (many-to-many)
export const userCompanyAssociations = pgTable("user_company_associations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  companyRole: text("company_role").notNull(), // owner, admin, employee, contractor, etc.
  permissions: jsonb("permissions").default("{}"), // Role-specific permissions within the company
  title: text("title"), // Job title within the company
  department: text("department"),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false), // Is this the user's primary company?
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Ensure unique user-company combinations
  unique("unique_user_company").on(table.userId, table.companyId),
  // Index for faster lookups
  index("user_company_user_idx").on(table.userId),
  index("user_company_company_idx").on(table.companyId),
]);

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

// Password strength validation function
export const validatePasswordStrength = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push("Password must be at least 12 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

// Schema for user registration
export const registerUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  phone: z.string().min(10, "Phone number must be at least 10 digits").regex(/^\+?[\d\s\-\(\)]+$/, "Invalid phone number format"),
  communicationPreference: z.enum(["email", "sms", "both"]).default("email"),
  roles: z.array(z.enum(["merchant", "agent", "admin", "corporate", "super_admin"])).default(["merchant"]),
}).refine((data) => {
  const validation = validatePasswordStrength(data.password);
  return validation.valid;
}, {
  message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  path: ["password"],
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
  password: z.string().min(12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
}).refine((data) => {
  const validation = validatePasswordStrength(data.password);
  return validation.valid;
}, {
  message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  path: ["password"],
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
export type User = typeof users.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type TwoFactorCode = typeof twoFactorCodes.$inferSelect;

// Company and user-company association schemas
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserCompanyAssociationSchema = createInsertSchema(userCompanyAssociations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Company and association types
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type UserCompanyAssociation = typeof userCompanyAssociations.$inferSelect;
export type InsertUserCompanyAssociation = z.infer<typeof insertUserCompanyAssociationSchema>;

// Extended user types with company information
export type UserWithCompanies = User & {
  companies?: (UserCompanyAssociation & {
    company: Company;
  })[];
  primaryCompany?: Company;
};

export type CompanyWithUsers = Company & {
  users?: (UserCompanyAssociation & {
    user: User;
  })[];
};

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

// Prospect signatures table for storing digital signatures
export const prospectSignatures = pgTable("prospect_signatures", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: 'cascade' }),
  ownerId: integer("owner_id").notNull().references(() => prospectOwners.id, { onDelete: 'cascade' }),
  signatureToken: text("signature_token").notNull().unique(),
  signature: text("signature").notNull(),
  signatureType: text("signature_type").notNull(), // 'draw' or 'type'
  submittedAt: timestamp("submitted_at").defaultNow(),
});

// Generic signature captures table for all signature types (owner, agent, guarantor, witness, etc.)
export const signatureCaptures = pgTable("signature_captures", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => prospectApplications.id, { onDelete: 'cascade' }),
  prospectId: integer("prospect_id").references(() => merchantProspects.id, { onDelete: 'cascade' }),
  roleKey: text("role_key").notNull(), // e.g., 'owner1', 'owner2', 'agent', 'guarantor', 'witness'
  signerType: text("signer_type").notNull(), // 'owner', 'agent', 'guarantor', 'witness', 'acknowledgement'
  signerName: text("signer_name"),
  signerEmail: text("signer_email"),
  signature: text("signature"), // Base64 signature data (canvas or typed)
  signatureType: text("signature_type"), // 'canvas' or 'typed'
  initials: text("initials"), // Signer's initials
  dateSigned: timestamp("date_signed"),
  timestampSigned: timestamp("timestamp_signed"),
  timestampRequested: timestamp("timestamp_requested"),
  timestampExpires: timestamp("timestamp_expires"),
  requestToken: text("request_token").unique(),
  status: text("status").notNull().default("pending"), // 'pending', 'requested', 'signed', 'expired'
  notes: text("notes"),
  ownershipPercentage: decimal("ownership_percentage", { precision: 5, scale: 2 }), // For owner signatures
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  applicationIdIdx: index("signature_captures_application_id_idx").on(table.applicationId),
  prospectIdIdx: index("signature_captures_prospect_id_idx").on(table.prospectId),
  requestTokenIdx: index("signature_captures_request_token_idx").on(table.requestToken),
  statusIdx: index("signature_captures_status_idx").on(table.status),
}));

export const insertProspectOwnerSchema = createInsertSchema(prospectOwners);

export const insertProspectSignatureSchema = createInsertSchema(prospectSignatures);

export const insertSignatureCaptureSchema = createInsertSchema(signatureCaptures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProspectOwner = z.infer<typeof insertProspectOwnerSchema>;
export type ProspectOwner = typeof prospectOwners.$inferSelect;
export type InsertProspectSignature = z.infer<typeof insertProspectSignatureSchema>;
export type ProspectSignature = typeof prospectSignatures.$inferSelect;
export type InsertSignatureCapture = z.infer<typeof insertSignatureCaptureSchema>;
export type SignatureCapture = typeof signatureCaptures.$inferSelect;

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
  pdfFieldId: text("pdf_field_id"), // Immutable PDF field identifier (XFA/AcroForm name) for field binding
  createdAt: timestamp("created_at").defaultNow()
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
  feeItemGroupId: integer("fee_item_group_id").references(() => feeItemGroups.id, { onDelete: "cascade" }), // Optional grouping
  name: text("name").notNull().unique(), // e.g., "Visa", "MasterCard", "American Express"
  description: text("description"),
  valueType: text("value_type").notNull(), // "percentage", "fixed", "basis_points", "numeric"
  defaultValue: text("default_value"), // Default value for this fee item
  additionalInfo: text("additional_info"), // Info shown when clicking "i" icon
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  author: text("author").notNull().default("System"), // System or user who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  model: text("model"), // Additional model information
  price: decimal("price", { precision: 10, scale: 2 }), // Equipment price
  status: text("status").default("available"), // Equipment availability status
});

// Acquirers table - payment processors that require different application forms
export const acquirers = pgTable("acquirers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // "Wells Fargo", "Merrick Bank", "Esquire Bank"
  displayName: text("display_name").notNull(), // User-friendly display name
  code: text("code").notNull().unique(), // Short code for internal use: "WF", "MB", "EB"
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Acquirer Application Templates - store dynamic form configurations for each acquirer
export const acquirerApplicationTemplates = pgTable("acquirer_application_templates", {
  id: serial("id").primaryKey(),
  acquirerId: integer("acquirer_id").notNull().references(() => acquirers.id, { onDelete: "cascade" }),
  templateName: text("template_name").notNull(), // "Standard Application", "Expedited Application"
  version: text("version").notNull().default("1.0"), // Template versioning
  isActive: boolean("is_active").notNull().default(true),
  fieldConfiguration: jsonb("field_configuration").notNull(), // JSON defining form fields, validation, sections
  pdfMappingConfiguration: jsonb("pdf_mapping_configuration"), // JSON mapping form fields to PDF positions
  requiredFields: text("required_fields").array().notNull().default(sql`ARRAY[]::text[]`), // Array of required field names
  conditionalFields: jsonb("conditional_fields"), // JSON defining field visibility conditions
  addressGroups: jsonb("address_groups").default(sql`'[]'::jsonb`), // JSON defining address field groups: [{ type: 'business'|'mailing'|'shipping', sectionName: string, fieldMappings: { street1: 'merchant_businessAddress', street2: 'merchant_businessAddress2', city: 'merchant_businessCity', state: 'merchant_businessState', postalCode: 'merchant_businessZipCode', country: 'merchant_businessCountry' } }]
  signatureGroups: jsonb("signature_groups").default(sql`'[]'::jsonb`), // JSON defining signature field groups: [{ roleKey: 'owner1', displayLabel: 'Owner #1', signerType: 'owner', isRequired: true, orderPriority: 1, sectionName: string, fieldMappings: { signerName: 'merchantInfo_signature_owner1.signerName', signature: 'merchantInfo_signature_owner1.signature', initials: 'merchantInfo_signature_owner1.initials', email: 'merchantInfo_signature_owner1.email', dateSigned: 'merchantInfo_signature_owner1.dateSigned' }, pdfMappings: { signature: { page: 3, x: 100, y: 200, width: 200, height: 50 }, printedName: {...}, initials: {...}, email: {...}, dateSigned: {...} } }]
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueAcquirerTemplate: unique().on(table.acquirerId, table.templateName, table.version),
}));

// Prospect Applications - store acquirer-specific application data
export const prospectApplications = pgTable("prospect_applications", {
  id: serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => merchantProspects.id, { onDelete: "cascade" }),
  acquirerId: integer("acquirer_id").notNull().references(() => acquirers.id),
  templateId: integer("template_id").notNull().references(() => acquirerApplicationTemplates.id),
  templateVersion: text("template_version").notNull(), // Track which template version was used
  status: text("status").notNull().default("draft"), // draft, in_progress, submitted, approved, rejected
  applicationData: jsonb("application_data").notNull().default('{}'), // Dynamic form data based on template
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  generatedPdfPath: text("generated_pdf_path"), // Path to generated application PDF
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueProspectAcquirer: unique().on(table.prospectId, table.acquirerId),
}));

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

// Campaign Application Templates junction table - links campaigns to multiple application templates
export const campaignApplicationTemplates = pgTable("campaign_application_templates", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  templateId: integer("template_id").notNull().references(() => acquirerApplicationTemplates.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false), // Mark one template as primary for initial applications
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCampaignTemplate: unique().on(table.campaignId, table.templateId),
}));

// Campaigns table - pricing plans that can be assigned to merchant applications
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Campaign name (not required to be unique)
  description: text("description"),
  pricingTypeId: integer("pricing_type_id").references(() => pricingTypes.id),
  acquirerId: integer("acquirer_id").notNull().references(() => acquirers.id), // Reference to acquirers table
  acquirer: text("acquirer"), // Deprecated - kept for backward compatibility, use acquirerId instead
  currency: text("currency").notNull().default("USD"),
  equipment: text("equipment"), // Deprecated - use campaignEquipment junction table instead
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // If this is a default campaign
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Campaign Fee Values table - stores the actual fee values for each campaign
export const campaignFeeValues = pgTable("campaign_fee_values", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  feeItemId: integer("fee_item_id").notNull().references(() => feeItems.id, { onDelete: "cascade" }), // Backward compatibility
  feeGroupFeeItemId: integer("fee_group_fee_item_id").references(() => feeGroupFeeItems.id, { onDelete: "cascade" }), // New relationship structure
  value: text("value").notNull(), // The actual fee value (amount, percentage, or placeholder text)
  valueType: text("value_type").notNull().default("percentage"), // Type of value: 'percentage', 'amount', 'placeholder'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCampaignFeeItem: unique().on(table.campaignId, table.feeItemId), // Use original unique constraint
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

export const insertCampaignApplicationTemplateSchema = createInsertSchema(campaignApplicationTemplates).omit({
  id: true,
  createdAt: true,
});

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

// Equipment management types
export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type InsertEquipmentItem = z.infer<typeof insertEquipmentItemSchema>;
export type CampaignEquipment = typeof campaignEquipment.$inferSelect;
export type InsertCampaignEquipment = z.infer<typeof insertCampaignEquipmentSchema>;

export type CampaignApplicationTemplate = typeof campaignApplicationTemplates.$inferSelect;
export type InsertCampaignApplicationTemplate = z.infer<typeof insertCampaignApplicationTemplateSchema>;

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

// Acquirer management types
export type Acquirer = typeof acquirers.$inferSelect;
export type InsertAcquirer = z.infer<typeof insertAcquirerSchema>;
export type AcquirerApplicationTemplate = typeof acquirerApplicationTemplates.$inferSelect;
export type InsertAcquirerApplicationTemplate = z.infer<typeof insertAcquirerApplicationTemplateSchema>;
export type ProspectApplication = typeof prospectApplications.$inferSelect;
export type InsertProspectApplication = z.infer<typeof insertProspectApplicationSchema>;

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
  
  // Extended audit fields
  resourceType: text("resource_type"), // Type classification for the resource
  details: jsonb("details"), // Additional structured details
  timestamp: timestamp("timestamp").defaultNow(), // Alternative timestamp field
  severity: text("severity").default("info"), // info, warning, error, critical
  category: text("category"), // Categorization for filtering
  outcome: text("outcome"), // success, failure, partial
  errorMessage: text("error_message"), // Error details if applicable
  requestId: varchar("request_id"), // Unique request identifier
  correlationId: varchar("correlation_id"), // For tracking related requests
  metadata: jsonb("metadata"), // Additional flexible metadata
  geolocation: jsonb("geolocation"), // Geographic information
  deviceInfo: jsonb("device_info"), // Device details
  retentionPolicy: text("retention_policy"), // Data retention classification
  encryptionKeyId: varchar("encryption_key_id"), // Reference to encryption key
  updatedAt: timestamp("updated_at").defaultNow(), // Last update timestamp
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

// Email Wrappers - Reusable email wrapper templates
export const emailWrappers = pgTable('email_wrappers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  type: varchar('type', { length: 50 }).notNull(), // welcome, security, agentNotification, notification, custom
  headerGradient: text('header_gradient'), // CSS gradient for header
  headerSubtitle: text('header_subtitle'), // Optional subtitle for header
  ctaButtonText: text('cta_button_text'), // Call-to-action button text
  ctaButtonUrl: text('cta_button_url'), // Call-to-action button URL (can use template variables)
  ctaButtonColor: text('cta_button_color'), // Call-to-action button color (default: #3b82f6)
  customFooter: text('custom_footer'), // Custom footer HTML
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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
  // Email Wrapper Configuration (kept for backward compatibility)
  useWrapper: boolean('use_wrapper').default(true), // Whether to apply email wrapper
  wrapperType: varchar('wrapper_type', { length: 50 }).default('notification'), // welcome, security, agentNotification, notification, custom
  // wrapperId: integer('wrapper_id'), // Temporarily removed to debug issue
  headerGradient: text('header_gradient'), // Custom gradient if wrapperType is 'custom'
  headerSubtitle: text('header_subtitle'), // Optional subtitle for header
  ctaButtonText: text('cta_button_text'), // Call-to-action button text
  ctaButtonUrl: text('cta_button_url'), // Call-to-action button URL
  ctaButtonColor: text('cta_button_color'), // Call-to-action button color (default: #3b82f6)
  customFooter: text('custom_footer'), // Custom footer HTML
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
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
export const insertEmailWrapperSchema = createInsertSchema(emailWrappers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates);
export const insertEmailActivitySchema = createInsertSchema(emailActivity);
export const insertEmailTriggerSchema = createInsertSchema(emailTriggers).extend({
  triggerEvent: triggerEventSchema, // Enforce valid trigger events
});

export type EmailWrapper = typeof emailWrappers.$inferSelect;
export type InsertEmailWrapper = z.infer<typeof insertEmailWrapperSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailActivity = typeof emailActivity.$inferSelect;
export type InsertEmailActivity = z.infer<typeof insertEmailActivitySchema>;
export type EmailTrigger = typeof emailTriggers.$inferSelect;
export type InsertEmailTrigger = z.infer<typeof insertEmailTriggerSchema>;

// Generic Trigger/Action Catalog System
// Trigger Catalog - Central registry of all system events that can trigger actions
export const triggerCatalog = pgTable('trigger_catalog', {
  id: serial('id').primaryKey(),
  triggerKey: varchar('trigger_key', { length: 100 }).notNull().unique(), // user_registered, application_submitted, etc.
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull(), // user, application, merchant, agent, system
  contextSchema: jsonb('context_schema'), // JSON schema defining expected context data
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Action Templates - Generic templates for all action types (email, sms, webhook, notification)
export const actionTemplates = pgTable('action_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  actionType: varchar('action_type', { length: 50 }).notNull(), // email, sms, webhook, notification, slack, teams
  category: varchar('category', { length: 50 }).notNull(), // authentication, application, notification, alert
  config: jsonb('config').notNull(), // Type-specific configuration (subject, body, url, headers, etc.)
  variables: jsonb('variables'), // Available variables for template
  isActive: boolean('is_active').default(true),
  version: integer('version').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  actionTypeIdx: index("action_templates_action_type_idx").on(table.actionType),
  categoryIdx: index("action_templates_category_idx").on(table.category),
  nameIdx: index("action_templates_name_idx").on(table.name),
}));

// Trigger Actions - Junction table linking triggers to actions with execution rules
export const triggerActions = pgTable('trigger_actions', {
  id: serial('id').primaryKey(),
  triggerId: integer('trigger_id').references(() => triggerCatalog.id, { onDelete: 'cascade' }).notNull(),
  actionTemplateId: integer('action_template_id').references(() => actionTemplates.id, { onDelete: 'cascade' }).notNull(),
  sequenceOrder: integer('sequence_order').default(1), // Execution order for chained actions
  conditions: jsonb('conditions'), // Conditional logic for action execution
  requiresEmailPreference: boolean('requires_email_preference').default(false), // Check user.communicationPreference includes 'email'
  requiresSmsPreference: boolean('requires_sms_preference').default(false), // Check user.communicationPreference includes 'sms'
  delaySeconds: integer('delay_seconds').default(0), // Delay before execution
  retryOnFailure: boolean('retry_on_failure').default(true),
  maxRetries: integer('max_retries').default(3),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  triggerIdIdx: index("trigger_actions_trigger_id_idx").on(table.triggerId),
  actionTemplateIdIdx: index("trigger_actions_action_template_id_idx").on(table.actionTemplateId),
  sequenceOrderIdx: index("trigger_actions_sequence_order_idx").on(table.sequenceOrder),
  triggerSequenceUniqueIdx: uniqueIndex("trigger_actions_trigger_sequence_idx").on(table.triggerId, table.sequenceOrder).where(sql`is_active = true`),
}));

// Action Activity - Audit log for all action executions
export const actionActivity = pgTable('action_activity', {
  id: serial('id').primaryKey(),
  triggerActionId: integer('trigger_action_id').references(() => triggerActions.id),
  triggerId: integer('trigger_id').references(() => triggerCatalog.id),
  actionTemplateId: integer('action_template_id').references(() => actionTemplates.id),
  actionType: varchar('action_type', { length: 50 }).notNull(),
  recipient: varchar('recipient', { length: 255 }).notNull(), // Email, phone, webhook URL, user ID
  recipientName: varchar('recipient_name', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull(), // pending, sent, failed, delivered, bounced, opened, clicked
  statusMessage: text('status_message'),
  triggerSource: varchar('trigger_source', { length: 100 }), // api, manual, scheduled, workflow
  triggeredBy: varchar('triggered_by', { length: 255 }), // User ID or system
  contextData: jsonb('context_data'), // Context data passed to the action
  responseData: jsonb('response_data'), // Response from action execution (API response, delivery receipt, etc.)
  executedAt: timestamp('executed_at').defaultNow(),
  deliveredAt: timestamp('delivered_at'),
  failedAt: timestamp('failed_at'),
  retryCount: integer('retry_count').default(0),
}, (table) => ({
  triggerActionIdIdx: index("action_activity_trigger_action_id_idx").on(table.triggerActionId),
  actionTypeIdx: index("action_activity_action_type_idx").on(table.actionType),
  recipientIdx: index("action_activity_recipient_idx").on(table.recipient),
  statusIdx: index("action_activity_status_idx").on(table.status),
  executedAtIdx: index("action_activity_executed_at_idx").on(table.executedAt),
}));

// User Alerts - In-app notifications/alerts for users
export const userAlerts = pgTable('user_alerts', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('info'), // info, success, warning, error
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at'),
  actionUrl: text('action_url'), // Optional URL to related resource
  actionActivityId: integer('action_activity_id').references(() => actionActivity.id, { onDelete: 'cascade' }), // Link to trigger action that created this alert
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_alerts_user_id_idx").on(table.userId),
  isReadIdx: index("user_alerts_is_read_idx").on(table.isRead),
  createdAtIdx: index("user_alerts_created_at_idx").on(table.createdAt),
  userReadIdx: index("user_alerts_user_read_idx").on(table.userId, table.isRead),
}));

// Trigger/Action Catalog Zod schemas and types
export const insertTriggerCatalogSchema = createInsertSchema(triggerCatalog);
export const insertActionTemplateSchema = createInsertSchema(actionTemplates);
export const insertTriggerActionSchema = createInsertSchema(triggerActions);
export const insertActionActivitySchema = createInsertSchema(actionActivity);
export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({ id: true, createdAt: true });

export type TriggerCatalog = typeof triggerCatalog.$inferSelect;
export type InsertTriggerCatalog = z.infer<typeof insertTriggerCatalogSchema>;
export type ActionTemplate = typeof actionTemplates.$inferSelect;
export type InsertActionTemplate = z.infer<typeof insertActionTemplateSchema>;
export type TriggerAction = typeof triggerActions.$inferSelect;
export type InsertTriggerAction = z.infer<typeof insertTriggerActionSchema>;
export type ActionActivity = typeof actionActivity.$inferSelect;
export type InsertActionActivity = z.infer<typeof insertActionActivitySchema>;
export type UserAlert = typeof userAlerts.$inferSelect;
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;

// Action Configuration Types (for type-safe config field)
export const emailActionConfigSchema = z.object({
  subject: z.string(),
  htmlContent: z.string(),
  textContent: z.string().optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().optional(),
  replyTo: z.string().email().optional(),
});

export const smsActionConfigSchema = z.object({
  message: z.string().max(1600), // SMS character limit
  from: z.string().optional(), // Sender ID or phone number
});

export const webhookActionConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api_key']),
    credentials: z.record(z.string()).optional(),
  }).optional(),
});

export const notificationActionConfigSchema = z.object({
  message: z.string(),
  type: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  actionUrl: z.string().optional(),
});

export const slackActionConfigSchema = z.object({
  channel: z.string(),
  message: z.string(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
  blocks: z.any().optional(), // Slack Block Kit JSON
});

export type EmailActionConfig = z.infer<typeof emailActionConfigSchema>;
export type SmsActionConfig = z.infer<typeof smsActionConfigSchema>;
export type WebhookActionConfig = z.infer<typeof webhookActionConfigSchema>;
export type NotificationActionConfig = z.infer<typeof notificationActionConfigSchema>;
export type SlackActionConfig = z.infer<typeof slackActionConfigSchema>;

// Export Drizzle utilities
export { sql, eq };
