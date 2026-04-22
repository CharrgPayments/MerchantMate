import type { Express, Request, Request as ExpressRequest, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuthRoutes } from "./authRoutes";
import { insertMerchantSchema, insertAgentSchema, insertTransactionSchema, insertLocationSchema, insertAddressSchema, insertPdfFormSchema, insertApiKeySchema, insertAcquirerSchema, insertAcquirerApplicationTemplateSchema, insertUserSchema, insertMerchantProspectSchema, insertUserDashboardPreferenceSchema } from "@shared/schema";
import { authenticateApiKey, requireApiPermission, logApiRequest, generateApiKey } from "./apiAuth";
import { setupAuth, isAuthenticated, requireRole, requirePermission, requirePerm } from "./replitAuth";
import { markSchema } from "./routeCatalogue";
import { auditService } from "./auditService";
import { z } from "zod";
import session from "express-session";

const updateWidgetPreferenceSchema = insertUserDashboardPreferenceSchema
  .omit({ created_at: true, updated_at: true })
  .partial();

const widgetCreateBodySchema = z.object({
  widgetId: z.string().min(1).optional(),
  widget_id: z.string().min(1).optional(),
  position: z.number().int().optional(),
  size: z.string().optional(),
  isVisible: z.boolean().optional(),
  is_visible: z.boolean().optional(),
  configuration: z.record(z.any()).optional(),
}).refine((d) => !!(d.widgetId || d.widget_id), {
  message: "widgetId is required",
  path: ["widgetId"],
});

const updateSubmissionByTokenSchema = z.object({
  data: z.union([z.string(), z.record(z.any()), z.array(z.any())]),
  status: z.string().min(1).optional(),
});
import connectPg from "connect-pg-simple";
import multer from "multer";
import { pdfFormParser } from "./pdfParser";
import { emailService } from "./emailService";
import { createAlert, createAlertForRoles } from "./alertService";
import { v4 as uuidv4 } from "uuid";
import { dbEnvironmentMiddleware, adminDbMiddleware, getRequestDB, type RequestWithDB } from "./dbMiddleware";
import { rateLimit } from "./rateLimits";
import { parsePaginationOrSend, makePage } from "./lib/pagination";
import { redactSensitive } from "./auditRedaction";
import { registerUnderwritingRoutes } from "./underwriting/routes";
import { registerCommissionsRoutes } from "./routes/commissions";
import { registerSchemaSyncRoutes } from "./routes/schemaSync";
import { registerExternalEndpointsRoutes } from "./routes/externalEndpoints";
import { calculateCommissionsForTransaction } from "./commissions";
import { getDynamicDatabase } from "./db";
import { users, agents, merchants, agentMerchants, merchantProspects, actionTemplates, triggerCatalog, triggerActions, actionActivity, agentHierarchy, merchantHierarchy, underwritingStatusHistory, prospectApplications as prospectAppsTable, roleDefinitions, transactions, locations as locationsTable, pdfFormFields, roleActionAudit, type CampaignWithDetails, type CampaignEquipment, type EquipmentItem, type InsertFeeGroup, type InsertFeeItemGroup } from "@shared/schema";
import { runUnderwritingPipeline } from "./underwriting/orchestrator";
import { notifyTransition } from "./underwriting/notifications";
import { initAgentClosure, initMerchantClosure, setAgentParent, setMerchantParent, getAgentDescendantIds, getMerchantDescendantIds, isAgentDescendantOf, detachAgentForDelete, detachMerchantForDelete, HierarchyError, MAX_HIERARCHY_DEPTH } from "./hierarchyService";
import crypto from "crypto";
import { eq, or, ilike, sql, inArray, desc, and } from "drizzle-orm";

// Helper functions for user account creation
async function generateUsername(firstName: string, lastName: string, email: string, dynamicDB: any): Promise<string> {
  // Try email-based username first
  const emailUsername = email.split('@')[0].toLowerCase();
  // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
  const existingUser = await dynamicDB.select().from(users).where(eq(users.username, emailUsername)).limit(1);
  
  if (existingUser.length === 0) {
    return emailUsername;
  }
  
  // Try first initial + last name
  const firstInitialLastname = `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}`;
  // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
  const existingUser2 = await dynamicDB.select().from(users).where(eq(users.username, firstInitialLastname)).limit(1);
  
  if (existingUser2.length === 0) {
    return firstInitialLastname;
  }
  
  // Add number suffix
  let counter = 1;
  let username = `${firstInitialLastname}${counter}`;
  while (true) {
    // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
    const existing = await dynamicDB.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length === 0) {
      return username;
    }
    counter++;
    username = `${firstInitialLastname}${counter}`;
  }
}

function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Function to reset testing data using dynamic database connection
async function resetTestingDataWithDB(db: any, options: Record<string, boolean>) {
  const result: any = { cleared: [], counts: {} };
  
  try {
    // Import schema tables
    const schema = await import('@shared/schema');
    
    if (options.signatures) {
      // Clear signatures
      const deletedSignatures = await db.delete(schema.prospectSignatures);
      result.cleared.push('signatures');
      result.counts.signatures = deletedSignatures.length || 0;
    }
    
    if (options.prospects) {
      // Clear prospects (this will cascade to owners due to foreign key constraints)
      const deletedOwners = await db.delete(schema.prospectOwners);
      const deletedProspects = await db.delete(schema.merchantProspects);
      result.cleared.push('prospects', 'owners');
      result.counts.prospects = deletedProspects.length || 0;
      result.counts.owners = deletedOwners.length || 0;
    }
    
    if (options.campaigns) {
      // Clear campaign assignments
      const deletedAssignments = await db.delete(schema.campaignAssignments);
      result.cleared.push('campaign_assignments');
      result.counts.campaign_assignments = deletedAssignments.length || 0;
    }
    
    if (options.equipment) {
      // Clear equipment assignments
      const deletedEquipment = await db.delete(schema.campaignEquipment);
      result.cleared.push('campaign_equipment');
      result.counts.campaign_equipment = deletedEquipment.length || 0;
    }
    
    if (options.formData) {
      // Reset form data by updating prospect status back to 'pending'
      const { eq } = await import('drizzle-orm');
      const updatedProspects = await db.update(schema.merchantProspects)
        .set({ 
          status: 'pending',
          applicationStartedAt: null,
          completedAt: null 
        })
        .where(eq(schema.merchantProspects.status, 'in_progress'));
      
      result.cleared.push('form_data');
      result.counts.form_data_reset = updatedProspects.length || 0;
    }
    
    return result;
  } catch (error) {
    console.error('Error in resetTestingDataWithDB:', error);
    throw error;
  }
}

// Helper function to get default widgets for a user role
function getDefaultWidgetsForRole(role: string) {
  const baseWidgets = [
    { id: "quick_stats", size: "medium", position: 0, configuration: {} },
    { id: "recent_activity", size: "large", position: 1, configuration: {} }
  ];

  switch (role) {
    case "super_admin":
    case "admin":
      return [
        ...baseWidgets,
        { id: "system_overview", size: "large", position: 2, configuration: {} },
        { id: "user_management", size: "medium", position: 3, configuration: {} },
        { id: "financial_summary", size: "medium", position: 4, configuration: {} }
      ];
    case "corporate":
      return [
        ...baseWidgets,
        { id: "revenue_overview", size: "large", position: 2, configuration: {} },
        { id: "performance_metrics", size: "medium", position: 3, configuration: {} }
      ];
    case "agent":
      return [
        ...baseWidgets,
        { id: "assigned_merchants", size: "medium", position: 2, configuration: {} },
        { id: "pipeline_overview", size: "medium", position: 3, configuration: {} }
      ];
    case "merchant":
      return [
        ...baseWidgets,
        { id: "revenue_overview", size: "large", position: 2, configuration: {} },
        { id: "location_performance", size: "medium", position: 3, configuration: {} }
      ];
    default:
      return baseWidgets;
  }
}

// Shared placeholder resolver — see server/lib/resolveSecrets.ts
import { resolveSecrets } from "./lib/resolveSecrets";
import { resolveTemplateTransport, finalizeTransport } from "./lib/endpointTransport";
import {
  messageBodySchema as sharedMessageBodySchema,
  fileRequestBodySchema as sharedFileRequestBodySchema,
  portalUploadBodySchema as sharedPortalUploadBodySchema,
  signatureRequestBodySchema as sharedSignatureRequestBodySchema,
  signatureSubmitBodySchema as sharedSignatureSubmitBodySchema,
  inlineSignatureBodySchema as sharedInlineSignatureBodySchema,
  campaignCreateBodySchema as sharedCampaignCreateBodySchema,
  campaignUpdateBodySchema as sharedCampaignUpdateBodySchema,
} from "./lib/validators";

export async function registerRoutes(app: Express): Promise<Server> {
  // Multer configuration for PDF uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'));
      }
    }
  });

  // Session setup for authentication using PostgreSQL store
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 7 * 24 * 60 * 60, // 1 week in seconds
    tableName: "sessions",
  });
  
  app.use(session({
    secret: process.env.SESSION_SECRET || 'corecrm-session-secret-key',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      sameSite: 'lax'
    },
    name: 'connect.sid'
  }));

  // Apply database environment middleware globally so audit service has access
  app.use(dbEnvironmentMiddleware);

  // Enhanced CRUD audit logging middleware
  app.use(async (req: RequestWithDB, res, next) => {
    const userId = req.session?.userId;
    const originalSend = res.send;
    let requestBody: any = null;
    let responseBody: any = null;
    
    // Capture request body for mutation operations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      requestBody = req.body;
    }

    // Override res.send to capture response data
    res.send = function(data) {
      responseBody = data;
      return originalSend.call(this, data);
    };

    // Continue processing
    next();

    // Log detailed CRUD operations after response
    res.on('finish', async () => {
      if (req.path.startsWith('/api/') && userId) {
        try {
          const auditServiceModule = await import('./auditService');
          const dbModule = await import('./db');
          const auditServiceInstance = new auditServiceModule.AuditService(req.dynamicDB || dbModule.db);
          
          // Extract resource and ID from URL path
          const pathParts = req.path.split('/');
          const resource = pathParts[2]; // e.g., 'merchants', 'agents', 'fee-groups'
          const resourceId = pathParts[3]; // e.g., '123'
          
          // Parse response to get created/updated data
          let parsedResponse: any = null;
          try {
            if (typeof responseBody === 'string') {
              parsedResponse = JSON.parse(responseBody);
            } else {
              parsedResponse = responseBody;
            }
          } catch (e) {
            parsedResponse = responseBody;
          }

          // Redact sensitive fields (passwords, tokens, 2FA secrets, API keys)
          // before any audit row is persisted.
          const safeRequest = redactSensitive(requestBody);
          const safeResponse = redactSensitive(parsedResponse);

          // Log CRUD operations with detailed data
          if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 300) {
            // CREATE operation
            await auditServiceInstance.logAction(
              'create',
              resource,
              {
                userId,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || undefined,
                method: req.method,
                endpoint: req.path,
                requestBody: safeRequest,
                environment: req.dbEnv || 'production'
              },
              {
                resourceId: parsedResponse?.id ? String(parsedResponse.id) : 'unknown',
                newValues: safeResponse,
                riskLevel: 'medium',
                dataClassification: resource.includes('user') || resource.includes('agent') ? 'restricted' : 'internal',
                notes: `Created ${resource} record${parsedResponse?.id ? ` (ID: ${parsedResponse.id})` : ''}`
              }
            );
          } else if (req.method === 'PUT' && res.statusCode >= 200 && res.statusCode < 300) {
            // UPDATE operation
            await auditServiceInstance.logAction(
              'update',
              resource,
              {
                userId,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || undefined,
                method: req.method,
                endpoint: req.path,
                requestBody: safeRequest,
                environment: req.dbEnv || 'production'
              },
              {
                resourceId: resourceId ? String(resourceId) : undefined,
                newValues: safeResponse,
                riskLevel: 'medium',
                dataClassification: resource.includes('user') || resource.includes('agent') ? 'restricted' : 'internal',
                notes: `Updated ${resource} record${resourceId ? ` (ID: ${resourceId})` : ''}`
              }
            );
          } else if (req.method === 'PATCH' && res.statusCode >= 200 && res.statusCode < 300) {
            // PARTIAL UPDATE operation
            await auditServiceInstance.logAction(
              'update',
              resource,
              {
                userId,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || undefined,
                method: req.method,
                endpoint: req.path,
                requestBody: safeRequest,
                environment: req.dbEnv || 'production'
              },
              {
                resourceId: resourceId ? String(resourceId) : undefined,
                newValues: safeResponse,
                riskLevel: 'medium',
                dataClassification: resource.includes('user') || resource.includes('agent') ? 'restricted' : 'internal',
                notes: `Partially updated ${resource} record${resourceId ? ` (ID: ${resourceId})` : ''}`
              }
            );
          } else if (req.method === 'DELETE' && res.statusCode >= 200 && res.statusCode < 300) {
            // DELETE operation
            await auditServiceInstance.logAction(
              'delete',
              resource,
              {
                userId,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || undefined,
                method: req.method,
                endpoint: req.path,
                environment: req.dbEnv || 'production'
              },
              {
                resourceId: resourceId ? String(resourceId) : undefined,
                riskLevel: 'high',
                dataClassification: resource.includes('user') || resource.includes('agent') ? 'restricted' : 'internal',
                notes: `Deleted ${resource} record${resourceId ? ` (ID: ${resourceId})` : ''}`
              }
            );
          }
        } catch (error) {
          console.error('CRUD audit logging error:', error);
        }
      }
    });
  });

  // Apply audit middleware to track all system activities for SOC2 compliance
  app.use(auditService.auditMiddleware());

  // Address autocomplete endpoint using Google Places API
  // Allow either an authenticated session OR a valid prospect token (prospect portal)
  const requireAuthOrProspectToken = async (req: any, res: Response, next: any) => {
    // Accept any of: session-based login, Passport `req.user`/isAuthenticated(),
    // or a valid prospect token (header or body).
    if (req.session?.userId) return next();
    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) return next();
    if (req.user) return next();
    const token =
      (req.headers['x-prospect-token'] as string | undefined) ||
      (req.body && typeof req.body === 'object' ? req.body.prospectToken : undefined);
    if (token && typeof token === 'string') {
      try {
        const prospect = await storage.getMerchantProspectByToken(token);
        if (prospect) return next();
      } catch (e) {
        // fall through to 401
      }
    }
    return res.status(401).json({ message: 'Authentication required' });
  };

  const googleApiLimiter = rateLimit({
    scope: 'google-address',
    windowMs: 60_000,
    max: 30,
    message: 'Too many address lookups. Please slow down.',
  });

  app.post('/api/address-autocomplete', googleApiLimiter, requireAuthOrProspectToken, async (req, res) => {
    try {
      const { input } = req.body;
      
      if (!input || typeof input !== 'string' || input.length < 4) {
        return res.json({ suggestions: [] });
      }
      
      const googleApiKey = process.env.GOOGLE_API_KEY;
      if (!googleApiKey) {
        return res.status(500).json({ error: 'Google API key not configured' });
      }
      
      // Call Google Places Autocomplete API with US bias
      const autocompleteUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:us&key=${googleApiKey}`;
      
      const response = await fetch(autocompleteUrl);
      const data = await response.json();
      
      if (data.status === 'OK' && data.predictions) {
        res.json({
          suggestions: data.predictions.map((prediction: any) => ({
            description: prediction.description,
            place_id: prediction.place_id,
            structured_formatting: prediction.structured_formatting
          }))
        });
      } else {
        res.json({ suggestions: [] });
      }
    } catch (error) {
      console.error('Address autocomplete error:', error);
      res.json({ suggestions: [] });
    }
  });

  // Address validation endpoint using Google Maps API
  app.post('/api/validate-address', googleApiLimiter, requireAuthOrProspectToken, async (req, res) => {
    try {
      const { address, placeId } = req.body;
      
      if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Address is required' });
      }
      
      const googleApiKey = process.env.GOOGLE_API_KEY;
      if (!googleApiKey) {
        return res.status(500).json({ error: 'Google API key not configured' });
      }
      
      let geocodeUrl;
      
      // If we have a place_id, use it for more accurate results
      if (placeId) {
        geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${placeId}&key=${googleApiKey}`;
      } else {
        // Fallback to address geocoding
        geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`;
      }
      
      const response = await fetch(geocodeUrl);
      const data = await response.json();
      
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const result = data.results[0];
        const components = result.address_components;
        
        // Extract address components
        let city = '';
        let state = '';
        let zipCode = '';
        let streetNumber = '';
        let streetName = '';
        
        components.forEach((component: any) => {
          const types = component.types;
          if (types.includes('street_number')) {
            streetNumber = component.long_name;
          } else if (types.includes('route')) {
            streetName = component.long_name;
          } else if (types.includes('locality')) {
            city = component.long_name;
          } else if (types.includes('administrative_area_level_1')) {
            state = component.long_name;
          } else if (types.includes('postal_code')) {
            zipCode = component.long_name;
          }
        });
        
        // Construct street address (number + street name only)
        const streetAddress = [streetNumber, streetName].filter(Boolean).join(' ');
        
        res.json({
          isValid: true,
          formattedAddress: result.formatted_address,
          streetAddress: streetAddress || result.formatted_address.split(',')[0].trim(), // fallback to first part
          city,
          state,
          zipCode,
          latitude: result.geometry.location.lat,
          longitude: result.geometry.location.lng
        });
      } else {
        res.json({
          isValid: false,
          error: data.status === 'ZERO_RESULTS' ? 'Address not found' : 'Invalid address'
        });
      }
    } catch (error) {
      console.error('Address validation error:', error);
      res.status(500).json({ error: 'Address validation failed' });
    }
  });

  // Location revenue metrics endpoint (placed early to avoid auth middleware)
  app.get("/api/locations/:locationId/revenue", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { locationId } = req.params;
      console.log('Revenue endpoint - fetching revenue for location:', locationId);
      const dynamicDB = getRequestDB(req);
      const revenue = await storage.getLocationRevenue(parseInt(locationId));
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching location revenue:", error);
      res.status(500).json({ message: "Failed to fetch location revenue" });
    }
  });

  // Merchant MTD revenue endpoint (placed early to avoid auth middleware)
  app.get("/api/merchants/:merchantId/mtd-revenue", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { merchantId } = req.params;
      console.log('MTD Revenue endpoint - fetching MTD revenue for merchant:', merchantId);
      
      const dynamicDB = getRequestDB(req);
      const merchantIdNum = parseInt(merchantId);
      // Single aggregate over month-to-date transactions for this merchant.
      // Replaces the previous N-locations × per-location-revenue stub loop.
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [agg] = await dynamicDB
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)::text` })
        .from(transactions)
        .where(
          and(
            eq(transactions.merchantId, merchantIdNum),
            sql`${transactions.transactionDate} >= ${monthStart.toISOString()}`,
          ),
        );

      const totalMTD = parseFloat(agg?.total ?? "0");
      res.json({ mtdRevenue: totalMTD.toFixed(2) });
    } catch (error) {
      console.error("Error fetching merchant MTD revenue:", error);
      res.status(500).json({ message: "Failed to fetch merchant MTD revenue" });
    }
  });

  // Dashboard API endpoints (placed early to avoid auth middleware for development)
  app.get("/api/dashboard/metrics", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const dynamicDB = getRequestDB(req);
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/dashboard/revenue", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const revenue = await storage.getDashboardRevenue();
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching dashboard revenue:", error);
      res.status(500).json({ message: "Failed to fetch dashboard revenue" });
    }
  });

  app.get("/api/dashboard/top-locations", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "5"));
      const sortBy = String(req.query.sortBy || "revenue");
      const locations = await storage.getTopLocations(limit, sortBy);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching top locations:", error);
      res.status(500).json({ message: "Failed to fetch top locations" });
    }
  });

  app.get("/api/dashboard/recent-activity", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const activities = await storage.getRecentActivity();
      res.json(activities);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  app.get("/api/dashboard/assigned-merchants", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "10"));
      const merchants = await storage.getAssignedMerchants(limit);
      res.json(merchants);
    } catch (error) {
      console.error("Error fetching assigned merchants:", error);
      res.status(500).json({ message: "Failed to fetch assigned merchants" });
    }
  });

  app.get("/api/dashboard/system-overview", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const systemData = await storage.getSystemOverview();
      res.json(systemData);
    } catch (error) {
      console.error("Error fetching system overview:", error);
      res.status(500).json({ message: "Failed to fetch system overview" });
    }
  });

  // Agent dashboard endpoints
  // Resolve the set of agent IDs in scope for an agent dashboard request.
  // scope=me → just the agent; downline → agent + all descendants;
  // all → only honored for admin/corporate/super_admin (falls back to downline otherwise).
  type AgentScope = "me" | "downline" | "all";
  function parseScope(raw: unknown): AgentScope {
    if (raw === "me" || raw === "downline" || raw === "all") return raw;
    return "me";
  }
  async function resolveAgentScope(
    db: ReturnType<typeof getRequestDB>,
    agentId: number,
    user: { roles?: string[] | null },
    scope: AgentScope,
  ): Promise<number[]> {
    if (scope === "all") {
      const isPrivileged = (user.roles ?? []).some((r) => ["admin", "corporate", "super_admin"].includes(r));
      if (isPrivileged) {
        const all = await db.select({ id: agents.id }).from(agents);
        return all.map((a) => a.id);
      }
      scope = "downline";
    }
    if (scope === "downline") return getAgentDescendantIds(db, agentId);
    return [agentId];
  }

  app.get("/api/agent/dashboard/stats", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const dynamicDB = getRequestDB(req);

      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const [user] = await dynamicDB.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      let [agent] = await dynamicDB.select().from(agents).where(eq(agents.userId, userId));
      if (!agent && user.email) {
        [agent] = await dynamicDB.select().from(agents).where(eq(agents.email, user.email));
      }
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      const scope = parseScope(req.query.scope);
      const scopedAgentIds = await resolveAgentScope(dynamicDB, agent.id, user, scope);
      const prospects = scopedAgentIds.length === 0
        ? []
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        : await dynamicDB.select().from(merchantProspects).where(inArray(merchantProspects.agentId, scopedAgentIds));
      console.log('Found prospects:', prospects.length);
      
      // Calculate statistics
      const totalApplications = prospects.length;
      const pendingApplications = prospects.filter(p => p.status === 'pending').length;
      const contactedApplications = prospects.filter(p => p.status === 'contacted').length;
      const inProgressApplications = prospects.filter(p => p.status === 'in_progress').length;
      const appliedApplications = prospects.filter(p => p.status === 'applied').length;
      const approvedApplications = prospects.filter(p => p.status === 'approved').length;
      const rejectedApplications = prospects.filter(p => p.status === 'rejected').length;
      
      const completedApplications = appliedApplications + approvedApplications + rejectedApplications;
      const conversionRate = totalApplications > 0 ? (approvedApplications / totalApplications) * 100 : 0;

      res.json({
        totalApplications,
        pendingApplications,
        contactedApplications,
        inProgressApplications,
        appliedApplications,
        approvedApplications,
        rejectedApplications,
        completedApplications,
        conversionRate,
        averageProcessingTime: 7 // days - can be calculated from actual data
      });
    } catch (error) {
      console.error("Error fetching agent dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  app.get("/api/agent/applications", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const dynamicDB = getRequestDB(req);

      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const [user] = await dynamicDB.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      let [agent] = await dynamicDB.select().from(agents).where(eq(agents.userId, userId));
      if (!agent && user.email) {
        [agent] = await dynamicDB.select().from(agents).where(eq(agents.email, user.email));
      }
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      const scope = parseScope(req.query.scope);
      const scopedAgentIds = await resolveAgentScope(dynamicDB, agent.id, user, scope);
      const prospects = scopedAgentIds.length === 0
        ? []
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        : await dynamicDB.select().from(merchantProspects).where(inArray(merchantProspects.agentId, scopedAgentIds));
      
      // Transform prospects to application format
      const applications = await Promise.all(prospects.map(async prospect => {
        // Extract form data if available
        let formData: any = {};
        try {
          formData = prospect.formData ? JSON.parse(prospect.formData) : {};
        } catch (e) {
          formData = {};
        }

        // Get database signatures for this prospect with owner information
        const dbSignatures = await storage.getProspectSignaturesByProspect(prospect.id);
        const prospectOwners = await storage.getProspectOwners(prospect.id);

        // Calculate completion percentage based on actual form data completeness
        let completionPercentage = 0;
        if (prospect.status === 'submitted' || prospect.status === 'applied' || prospect.status === 'approved' || prospect.status === 'rejected') {
          completionPercentage = 100;
        } else {
          // Calculate based on form sections completed
          let sectionsCompleted = 0;
          const totalSections = 4; // Merchant Info, Business Type, Ownership, Transaction Info
          
          // Check Merchant Information section
          const merchantInfoComplete = formData.companyName && formData.companyEmail && formData.address && formData.city && formData.state;
          if (merchantInfoComplete) {
            sectionsCompleted++;
          }
          
          // Check Business Type section  
          const businessTypeComplete = formData.businessType && formData.yearsInBusiness && formData.federalTaxId;
          if (businessTypeComplete) {
            sectionsCompleted++;
          }
          
          // Check Business Ownership section
          if (formData.owners && formData.owners.length > 0) {
            const totalOwnership = formData.owners.reduce((sum: number, owner: any) => sum + parseFloat(owner.percentage || 0), 0);
            const requiredSignatures = formData.owners.filter((owner: any) => parseFloat(owner.percentage || 0) >= 25);
            
            // Check actual database signatures, not form data signatures
            const completedSignatures = requiredSignatures.filter((owner: any) => {
              // Find the database owner record to get the correct ID
              const dbOwner = prospectOwners.find(po => po.email === owner.email);
              if (!dbOwner) return false;
              
              // Check if there's a signature for this owner
              return dbSignatures.some((sig: any) => sig.ownerId === dbOwner.id);
            });
            
            if (Math.abs(totalOwnership - 100) < 0.01 && completedSignatures.length === requiredSignatures.length) {
              sectionsCompleted++;
            }
          }
          
          // Check Transaction Information section
          const transactionInfoComplete = formData.monthlyVolume && formData.averageTicket && formData.processingMethod;
          if (transactionInfoComplete) {
            sectionsCompleted++;
          }
          
          completionPercentage = Math.round((sectionsCompleted / totalSections) * 100);
          
          // Minimum percentage based on status
          if (prospect.status === 'contacted' && completionPercentage < 10) {
            completionPercentage = 10;
          } else if (prospect.status === 'in_progress' && completionPercentage < 25) {
            completionPercentage = 25;
          }
        }

        // Calculate signature status for monitoring using actual database signatures
        const owners = formData.owners || [];
        const requiredSignatures = owners.filter((owner: any) => parseFloat(owner.percentage || 0) >= 25);
        
        console.log(`\n--- Signature Status Debug for Prospect ${prospect.id} ---`);
        console.log(`Form data owners:`, owners.map((o: any) => ({ email: o.email, percentage: o.percentage })));
        console.log(`Required signatures (>=25%):`, requiredSignatures.map((o: any) => ({ email: o.email, percentage: o.percentage })));
        console.log(`Database owners:`, prospectOwners.map(po => ({ id: po.id, email: po.email })));
        console.log(`Database signatures:`, dbSignatures.map(sig => ({ ownerId: sig.ownerId, token: sig.signatureToken })));
        
        const completedSignatures = requiredSignatures.filter((owner: any) => {
          // Find the database owner record to get the correct ID
          const dbOwner = prospectOwners.find(po => po.email === owner.email);
          if (!dbOwner) {
            console.log(`No database owner found for email: ${owner.email}`);
            return false;
          }
          
          // Check if there's a signature for this owner
          const hasSignature = dbSignatures.some((sig: any) => sig.ownerId === dbOwner.id);
          console.log(`Owner ${owner.email} (ID: ${dbOwner.id}) has signature: ${hasSignature}`);
          return hasSignature;
        });
        
        console.log(`Completed signatures count: ${completedSignatures.length}/${requiredSignatures.length}`);
        console.log(`--- End Signature Debug ---\n`);
        
        const signatureStatus = {
          required: requiredSignatures.length,
          completed: completedSignatures.length,
          pending: requiredSignatures.length - completedSignatures.length,
          isComplete: requiredSignatures.length > 0 && completedSignatures.length === requiredSignatures.length,
          needsAttention: requiredSignatures.length > 0 && completedSignatures.length < requiredSignatures.length
        };

        return {
          id: prospect.id,
          prospectName: `${prospect.firstName} ${prospect.lastName}`,
          companyName: formData.companyName || 'Not specified',
          email: prospect.email,
          phone: formData.companyPhone || 'Not provided',
          status: prospect.status,
          createdAt: prospect.createdAt,
          lastUpdated: prospect.updatedAt || prospect.createdAt,
          completionPercentage,
          assignedAgent: 'Unassigned', // Fix: removed invalid property access
          signatureStatus
        };
      }));

      // Sort by most recent first
      applications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Disable caching for fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json(applications);
    } catch (error) {
      console.error("Error fetching agent applications:", error);
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });



  // Widget preference endpoints (before auth middleware for development)
  app.get("/api/user/:userId/widgets", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { userId } = req.params;
      const widgets = await storage.getUserWidgetPreferences(userId);
      res.json(widgets);
    } catch (error) {
      console.error("Error fetching user widgets:", error);
      res.status(500).json({ message: "Failed to fetch user widgets" });
    }
  });

  app.post("/api/user/:userId/widgets", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { userId } = req.params;
      const parsed = widgetCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const body = parsed.data;
      const widgetData = {
        user_id: userId,
        widget_id: (body.widgetId || body.widget_id)!,
        position: body.position,
        size: body.size,
        is_visible: body.isVisible ?? body.is_visible,
        configuration: body.configuration,
      };
      const widget = await storage.createWidgetPreference(widgetData);
      res.json(widget);
    } catch (error) {
      console.error("Error creating widget preference:", error);
      res.status(500).json({ message: "Failed to create widget preference" });
    }
  });

  app.put("/api/widgets/:widgetId", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { widgetId } = req.params;
      const parsed = updateWidgetPreferenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const widget = await storage.updateWidgetPreference(parseInt(widgetId), parsed.data);
      if (!widget) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json(widget);
    } catch (error) {
      console.error("Error updating widget preference:", error);
      res.status(500).json({ message: "Failed to update widget preference" });
    }
  });

  app.delete("/api/widgets/:widgetId", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { widgetId } = req.params;
      const success = await storage.deleteWidgetPreference(parseInt(widgetId));
      if (!success) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json({ message: "Widget deleted successfully" });
    } catch (error) {
      console.error("Error deleting widget preference:", error);
      res.status(500).json({ message: "Failed to delete widget preference" });
    }
  });



  // Setup authentication routes AFTER session middleware
  setupAuthRoutes(app);



  // Database environment switching endpoint (before auth middleware)
  app.post("/api/database-environment", async (req: any, res) => {
    try {
      const { environment } = req.body;
      
      if (!environment || !['test', 'development', 'dev', 'production'].includes(environment)) {
        return res.status(400).json({ 
          message: "Invalid environment. Must be one of: test, development, dev, production" 
        });
      }
      
      // Store the database environment preference in session
      req.session.dbEnv = environment;
      
      console.log(`Database environment set to: ${environment} for session ${req.sessionID}`);
      
      res.json({ 
        message: `Database environment set to ${environment}`,
        environment: environment
      });
    } catch (error) {
      console.error("Error setting database environment:", error);
      res.status(500).json({ message: "Failed to set database environment" });
    }
  });

  // Get current database environment
  app.get("/api/database-environment", async (req: any, res) => {
    try {
      const currentEnv = req.session?.dbEnv || 'production';
      res.json({ 
        environment: currentEnv,
        availableEnvironments: ['test', 'development', 'dev', 'production']
      });
    } catch (error) {
      console.error("Error getting database environment:", error);
      res.status(500).json({ message: "Failed to get database environment" });
    }
  });

  // Use production auth setup for all environments
  await setupAuth(app);

  app.get('/api/auth/user', isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Effective per-action scopes for the current user, computed from
  // DEFAULT_ACTION_GRANTS merged with runtime DB overrides. Consumed by the
  // client `usePermissions` hook so every UI gate (sidebar, route guards,
  // widgets) reflects matrix changes without a redeploy.
  app.get('/api/auth/permissions', isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub;
      if (!userId) return res.status(401).json({ scopes: {} });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ scopes: {} });
      const { getOverrides } = await import("./permissionRegistry");
      const { ACTIONS, getActionScope } = await import("@shared/permissions");
      const env = req.dbEnv ?? 'production';
      const overrides = await getOverrides(env, getRequestDB(req));
      const scopes: Record<string, string> = {};
      for (const action of Object.values(ACTIONS)) {
        const s = getActionScope(user, action, overrides);
        if (s !== null) scopes[action] = s;
      }
      res.json({ scopes });
    } catch (error) {
      console.error("Error computing permissions:", error);
      res.status(500).json({ scopes: {} });
    }
  });

;



  // User management routes (admin and super admin only) - Development bypass
  app.get("/api/users", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      // Paginates SQL-side (default pageSize=50, hard cap=500). Always
      // returns the `{ items, total, page, pageSize }` envelope; legacy
      // callers that expect a bare array are handled transparently by the
      // default React Query fetcher (see client/src/lib/queryClient.ts).
      const p = parsePaginationOrSend(req, res);
      if (!p) return;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const result = await storage.getUsersPaged({ ...p, search });
      res.json(makePage(result.items, result.total, p));
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id/role", isAuthenticated, dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        role: z.string().min(1).optional(),
        roles: z.array(z.string().min(1)).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
      }
      const body = parsed.data;

      // Multi-role assignment: prefer `roles[]` from the body, fall back to a
      // single `role` for legacy callers. Each role must exist in the live
      // role_definitions table (system or custom) for the active environment.
      const requested: string[] = Array.isArray(body.roles)
        ? body.roles
        : (typeof body.role === 'string' ? [body.role] : []);
      if (requested.length === 0) {
        return res.status(400).json({ message: "Provide `roles[]` or `role`" });
      }

      const dbForRoles = getRequestDB(req);
      // Typed Drizzle SELECT through the per-request DynamicDB.
      const knownRoles = await dbForRoles.select({ code: roleDefinitions.code }).from(roleDefinitions);
      const validCodes = knownRoles.map((r) => r.code);
      const invalid = requested.filter((r) => !validCodes.includes(r));
      if (invalid.length > 0) {
        return res.status(400).json({ message: "Invalid role(s)", invalid, validCodes });
      }

      const user = await storage.updateUserRoles(id, requested);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.patch("/api/users/:id/status", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const parsed = z.object({
        status: z.enum(['active', 'suspended', 'inactive']),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status", errors: parsed.error.flatten() });
      }
      const { status } = parsed.data;

      const user = await storage.updateUserStatus(id, status);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Delete user account
  app.delete("/api/users/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const success = await storage.deleteUser(id);
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ message: "User account deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user account" });
    }
  });

  // Update user account information
  app.patch("/api/users/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const userId = req.params.id;

      // Validate the partial-user payload via Zod. Sensitive fields
      // (passwordHash, reset tokens, id, createdAt) are deliberately omitted
      // from the schema so callers cannot set them via this endpoint.
      const updateUserSchema = z.object({
        email: z.string().email(),
        username: z.string().min(1),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        profileImageUrl: z.string().nullable(),
        roles: z.array(z.string()),
        status: z.enum(['active', 'suspended', 'inactive']),
        permissions: z.unknown(),
        timezone: z.string().nullable(),
        twoFactorEnabled: z.boolean(),
        emailVerified: z.boolean(),
        phone: z.string().nullable(),
        communicationPreference: z.enum(['email', 'sms', 'both']).nullable(),
        mustChangePassword: z.boolean(),
      }).partial();
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user payload", errors: parsed.error.flatten() });
      }
      const updates: Record<string, unknown> = { ...parsed.data };

      console.log('Update user endpoint - User ID:', userId);
      console.log('Update user endpoint - Database environment:', req.dbEnv);

      const dynamicDB = getRequestDB(req);

      // If a roles[] update is being attempted, validate every code against
      // the live role_definitions catalog (same check as PATCH /:id/role) so
      // non-catalog roles can't sneak in via the generic edit form.
      if (Array.isArray(updates.roles)) {
        // Typed Drizzle SELECT through the per-request DynamicDB.
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        const known = await dynamicDB.select({ code: roleDefinitions.code }).from(roleDefinitions);
        const validCodes = known.map((r) => r.code);
        const invalid = (updates.roles as string[]).filter((r) => !validCodes.includes(r));
        if (invalid.length > 0) {
          return res.status(400).json({ message: "Invalid role(s)", invalid, validCodes });
        }
      }

      const schema = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // Update user in the specific database environment
      const [updatedUser] = await dynamicDB
        .update(schema.users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.users.id, userId))
        .returning();
      
      if (!updatedUser) {
        console.log('Update user endpoint - User not found:', userId);
        return res.status(404).json({ message: "User not found" });
      }
      
      console.log('Update user endpoint - Successfully updated user:', updatedUser.id);
      
      // Remove sensitive data from response
      const { passwordHash, passwordResetToken, passwordResetExpires, twoFactorSecret, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Reset user password (admin only)
  app.post("/api/users/:id/reset-password", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const userId = req.params.id;
      
      console.log('Reset password endpoint - User ID:', userId);
      console.log('Reset password endpoint - Database environment:', req.dbEnv);
      
      // Use dynamic database connection if available
      const dynamicDB = getRequestDB(req);
      const schema = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // Check if user exists in the specific database environment
      const users = await dynamicDB
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      
      const user = users[0];
      if (!user) {
        console.log('Reset password endpoint - User not found:', userId);
        return res.status(404).json({ message: "User not found" });
      }
      
      // Generate a secure temporary password
      const temporaryPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
      
      // Hash the temporary password
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      
      // Set password reset token for forced password change
      const crypto = await import('crypto');
      const resetToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Update user with new password and reset token
      const [updatedUser] = await dynamicDB
        .update(schema.users)
        .set({
          passwordHash,
          passwordResetToken: resetToken,
          passwordResetExpires: expiresAt,
          updatedAt: new Date()
        })
        .where(eq(schema.users.id, userId))
        .returning();
      
      if (!updatedUser) {
        return res.status(404).json({ message: "Failed to update user password" });
      }
      
      // Send temporary password email
      const { authService } = await import("./auth");
      await authService.sendEmail(
        updatedUser.email,
        "CoreCRM Account Password Reset",
        `
        <h2>Password Reset - CoreCRM Account</h2>
        <p>Dear ${updatedUser.firstName || updatedUser.username},</p>
        <p>Your account password has been reset by an administrator.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Temporary Login Credentials</h3>
          <p><strong>Username:</strong> ${updatedUser.username}</p>
          <p><strong>Temporary Password:</strong> <span style="background-color: #e9ecef; padding: 4px 8px; font-family: monospace; font-size: 14px;">${temporaryPassword}</span></p>
        </div>
        
        <p><strong>Important:</strong> You will be required to change this password immediately upon your next login for security purposes.</p>
        
        <p><a href="${process.env.APP_URL || "http://localhost:5000"}/login" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Login to Change Password</a></p>
        
        <p>If you have any questions, please contact your administrator.</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">This is an automated message from CoreCRM. Please do not reply to this email.</p>
        `
      );
      
      console.log('Reset password endpoint - Successfully reset password for user:', updatedUser.id);
      
      res.json({
        message: "Password reset successfully. Temporary password has been emailed to the user.",
        temporaryPassword // Only return this to admin
      });
    } catch (error) {
      console.error("Error resetting user password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Agent password reset
  app.post("/api/agents/:id/reset-password", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const agent = await storage.getAgent(parseInt(id));
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get the user account for this agent
      const user = await storage.getAgentUser(parseInt(id));
      if (!user) {
        return res.status(404).json({ message: "User account not found for agent" });
      }

      // Generate new temporary password
      const temporaryPassword = Math.random().toString(36).slice(-12);
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      // Update user password
      await storage.updateUser(user.id, { passwordHash });

      res.json({
        username: user.username,
        temporaryPassword,
        message: "Password reset successfully"
      });
    } catch (error) {
      console.error("Error resetting agent password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Merchant password reset
  app.post("/api/merchants/:id/reset-password", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const merchant = await storage.getMerchant(parseInt(id));
      
      if (!merchant) {
        return res.status(404).json({ message: "Merchant not found" });
      }

      // Get the user account for this merchant
      const user = await storage.getMerchantUser(parseInt(id));
      if (!user) {
        return res.status(404).json({ message: "User account not found for merchant" });
      }

      // Generate new temporary password
      const temporaryPassword = Math.random().toString(36).slice(-12);
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      // Update user password
      await storage.updateUser(user.id, { passwordHash });

      res.json({
        username: user.username,
        temporaryPassword,
        message: "Password reset successfully"
      });
    } catch (error) {
      console.error("Error resetting merchant password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Merchant routes with role-based access
  app.get("/api/merchants", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const p = parsePaginationOrSend(req, res);
      if (!p) return;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const result = await storage.getMerchantsForUserPaged(userId, { ...p, search, status });
      res.json(makePage(result.items, result.total, p));
    } catch (error) {
      console.error("Error fetching merchants:", error);
      res.status(500).json({ message: "Failed to fetch merchants" });
    }
  });

  // Location routes with role-based access
  app.get("/api/merchants/:merchantId/locations", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { merchantId } = req.params;
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      // For merchant users, only allow access to their own merchant data
      if (user?.role === 'merchant') {
        // For now, we'll allow merchant users to access merchant ID 1
        // TODO: Implement proper merchant-user association
        if (parseInt(merchantId) !== 1) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const locations = await storage.getLocationsByMerchant(parseInt(merchantId));
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/merchants/:merchantId/locations", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { merchantId } = req.params;
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      // For merchant users, only allow access to their own merchant data
      if (user?.role === 'merchant') {
        if (parseInt(merchantId) !== 1) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const parsed = insertLocationSchema.safeParse({
        ...req.body,
        merchantId: parseInt(merchantId)
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid location payload", errors: parsed.error.flatten() });
      }

      const location = await storage.createLocation(parsed.data);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });



  app.put("/api/locations/:locationId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { locationId } = req.params;
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await storage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const parsed = insertLocationSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid location payload", errors: parsed.error.flatten() });
      }
      const updatedLocation = await storage.updateLocation(parseInt(locationId), parsed.data);
      
      if (!updatedLocation) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      res.json(updatedLocation);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:locationId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { locationId } = req.params;
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await storage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const success = await storage.deleteLocation(parseInt(locationId));
      if (!success) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  // Address routes with role-based access and geolocation support
  app.get("/api/locations/:locationId/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await storage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const addresses = await storage.getAddressesByLocation(parseInt(locationId));
      res.json(addresses);
    } catch (error) {
      console.error("Error fetching addresses:", error);
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  app.post("/api/locations/:locationId/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await storage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const parsed = insertAddressSchema.safeParse({
        ...req.body,
        locationId: parseInt(locationId)
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid address payload", errors: parsed.error.flatten() });
      }

      const address = await storage.createAddress(parsed.data);
      res.json(address);
    } catch (error) {
      console.error("Error creating address:", error);
      res.status(500).json({ message: "Failed to create address" });
    }
  });

  app.put("/api/addresses/:addressId", isAuthenticated, async (req: any, res) => {
    try {
      const { addressId } = req.params;
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Get address and location to check merchant ownership
      const address = await storage.getAddress(parseInt(addressId));
      if (!address) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      const location = await storage.getLocation(address.locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const parsed = insertAddressSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid address payload", errors: parsed.error.flatten() });
      }
      const updatedAddress = await storage.updateAddress(parseInt(addressId), parsed.data);
      
      if (!updatedAddress) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error updating address:", error);
      res.status(500).json({ message: "Failed to update address" });
    }
  });

  app.delete("/api/addresses/:addressId", isAuthenticated, async (req: any, res) => {
    try {
      const { addressId } = req.params;
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Get address and location to check merchant ownership
      const address = await storage.getAddress(parseInt(addressId));
      if (!address) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      const location = await storage.getLocation(address.locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const success = await storage.deleteAddress(parseInt(addressId));
      if (!success) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting address:", error);
      res.status(500).json({ message: "Failed to delete address" });
    }
  });

  // Transaction routes with role-based access
  app.get("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const p = parsePaginationOrSend(req, res);
      if (!p) return;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const result = await storage.getTransactionsForUserPaged(userId, { ...p, search, status });
      res.json(makePage(result.items, result.total, p));
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Get transactions by MID (location-specific transactions)
  app.get("/api/transactions/mid/:mid", isAuthenticated, async (req: any, res) => {
    try {
      const { mid } = req.params;
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Get location by MID to check access permissions
      const locations = await storage.getLocationsByMerchant(0); // Get all locations first
      const location = locations.find(loc => loc.mid === mid);
      
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const transactions = await storage.getTransactionsByMID(mid);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions by MID:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Agent-merchant assignment routes (admin only)
  app.post("/api/agents/:agentId/merchants/:merchantId", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const { agentId, merchantId } = req.params;
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const dynamicDB = getRequestDB(req);
      console.log(`Agent assignment endpoint - Database environment: ${req.dbEnv}`);

      const assignment = await storage.assignAgentToMerchant(
        parseInt(agentId),
        parseInt(merchantId),
        userId
      );

      res.json(assignment);
    } catch (error) {
      console.error("Error assigning agent to merchant:", error);
      res.status(500).json({ message: "Failed to assign agent to merchant" });
    }
  });

  app.delete("/api/agents/:agentId/merchants/:merchantId", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const { agentId, merchantId } = req.params;
      const dynamicDB = getRequestDB(req);
      console.log(`Agent unassignment endpoint - Database environment: ${req.dbEnv}`);

      const success = await storage.unassignAgentFromMerchant(
        parseInt(agentId),
        parseInt(merchantId)
      );

      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ message: "Assignment not found" });
      }
    } catch (error) {
      console.error("Error unassigning agent from merchant:", error);
      res.status(500).json({ message: "Failed to unassign agent from merchant" });
    }
  });

  // Get merchants for a specific agent
  app.get("/api/agents/:agentId/merchants", dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const { agentId } = req.params;
      const dynamicDB = getRequestDB(req);
      console.log(`Agent merchants endpoint - Database environment: ${req.dbEnv}`);
      
      // Use dynamic database to get agent merchants  
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const agentMerchantRecords = await dynamicDB.select({
        merchant: merchants,
        agent: agents
      }).from(agentMerchants)
        .innerJoin(merchants, eq(agentMerchants.merchantId, merchants.id))
        .innerJoin(agents, eq(agentMerchants.agentId, agents.id))
        .where(eq(agentMerchants.agentId, parseInt(agentId)));

      const merchantList = agentMerchantRecords.map(record => ({
        ...record.merchant,
        agent: record.agent
      }));
      
      console.log(`Found ${merchantList.length} merchants for agent ${agentId} in ${req.dbEnv} database`);
      res.json(merchantList);
    } catch (error) {
      console.error("Error fetching agent merchants:", error);
      res.status(500).json({ message: "Failed to fetch agent merchants" });
    }
  });

  // Merchant Prospect routes
  app.get("/api/prospects", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const p = parsePaginationOrSend(req, res);
      if (!p) return;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;

      const dynamicDB = getRequestDB(req);
      const role = user.role ?? "";
      let agentId: number | undefined;
      if (role === 'agent') {
        // Resolve the agent record by userId, falling back to email — preserves
        // the prior behaviour where legacy agent rows lack userId but match by email.
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        let [agent] = await dynamicDB.select().from(agents).where(eq(agents.userId, userId));
        if (!agent && user.email) {
          [agent] = await dynamicDB.select().from(agents).where(eq(agents.email, user.email));
        }
        if (!agent) return res.status(403).json({ message: "Agent not found" });
        agentId = agent.id;
      } else if (!['admin', 'corporate', 'super_admin'].includes(role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const result = await storage.getMerchantProspectsPaged({ ...p, search, status, agentId });
      res.json(makePage(result.items, result.total, p));
    } catch (error) {
      console.error("Error fetching prospects:", error);
      res.status(500).json({ message: "Failed to fetch prospects" });
    }
  });

  app.post("/api/prospects", isAuthenticated, markSchema('insertMerchantProspectSchema'), async (req, res) => {
    try {
      const { insertMerchantProspectSchema } = await import("@shared/schema");
      const { emailService } = await import("./emailService");
      
      // Check user role authorization
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      if (!['agent', 'admin', 'corporate', 'super_admin'].includes(user.role || '')) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      // Extract campaignId from request body for campaign assignment
      const { campaignId: explicitCampaignId, mcc, acquirerId, ...prospectData } = req.body;

      const result = insertMerchantProspectSchema.safeParse(prospectData);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid prospect data", errors: result.error.errors });
      }

      // Resolve campaign via fallback chain: explicit → agent default → rules engine
      let resolvedCampaignId: number | undefined =
        explicitCampaignId && explicitCampaignId !== 0 ? Number(explicitCampaignId) : undefined;
      let campaignSource: 'explicit' | 'agent_default' | 'rule' | 'none' = resolvedCampaignId ? 'explicit' : 'none';

      if (!resolvedCampaignId && result.data.agentId) {
        const agent = await storage.getAgent(result.data.agentId);
        if (agent?.defaultCampaignId) {
          resolvedCampaignId = agent.defaultCampaignId;
          campaignSource = 'agent_default';
        }
      }
      if (!resolvedCampaignId) {
        const ruleMatch = await storage.findCampaignByRule({
          mcc: mcc ?? null,
          acquirerId: acquirerId ?? null,
          agentId: result.data.agentId ?? null,
        });
        if (ruleMatch) {
          resolvedCampaignId = ruleMatch;
          campaignSource = 'rule';
        }
      }
      if (!resolvedCampaignId) {
        return res.status(400).json({ message: "Campaign assignment is required (no default or matching rule found)" });
      }

      const prospect = await storage.createMerchantProspect(result.data);
      
      // Create campaign assignment
      await storage.assignCampaignToProspect(resolvedCampaignId, prospect.id, userId);
      console.log(`Prospect ${prospect.id} assigned to campaign ${resolvedCampaignId} via ${campaignSource}`);
      
      // Fetch agent information for email
      const agent = await storage.getAgent(prospect.agentId);
      
      // Send validation email if agent information is available
      if (agent && prospect.validationToken) {
        const emailSent = await emailService.sendProspectValidationEmail({
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          email: prospect.email,
          validationToken: prospect.validationToken,
          agentName: `${agent.firstName} ${agent.lastName}`,
        });
        
        if (emailSent) {
          console.log(`Validation email sent to prospect: ${prospect.email}`);
        } else {
          console.warn(`Failed to send validation email to prospect: ${prospect.email}`);
        }
      }
      
      res.status(201).json(prospect);
    } catch (error) {
      console.error("Error creating prospect:", error);
      res.status(500).json({ message: "Failed to create prospect" });
    }
  });

  app.put("/api/prospects/:id", requirePerm('agent:read'), async (req, res) => {
    try {
      const { id } = req.params;
      const prospectId = parseInt(id);

      const parsed = insertMerchantProspectSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid prospect payload", errors: parsed.error.flatten() });
      }
      const updates = parsed.data;

      // If email is being updated, check if it already exists for a different prospect
      if (updates.email) {
        const existingProspect = await storage.getMerchantProspectByEmail(updates.email);
        if (existingProspect && existingProspect.id !== prospectId) {
          return res.status(400).json({
            message: "A prospect with this email already exists"
          });
        }
      }

      const prospect = await storage.updateMerchantProspect(prospectId, updates);
      
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }
      
      res.json(prospect);
    } catch (error) {
      console.error("Error updating prospect:", error);
      
      // Handle specific database constraint errors
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') { // Unique constraint violation
          return res.status(400).json({ 
            message: "A prospect with this email already exists" 
          });
        }
      }
      
      res.status(500).json({ message: "Failed to update prospect" });
    }
  });

  app.post("/api/prospects/:id/resend-invitation", requirePerm('agent:read'), async (req, res) => {
    try {
      const { id } = req.params;
      const { emailService } = await import("./emailService");
      
      // Get prospect details
      const prospect = await storage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Send validation email
      if (prospect.validationToken) {
        const emailSent = await emailService.sendProspectValidationEmail({
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          email: prospect.email,
          validationToken: prospect.validationToken,
          agentName: `${agent.firstName} ${agent.lastName}`,
        });
        
        if (emailSent) {
          console.log(`Validation email resent to prospect: ${prospect.email}`);
          res.json({ success: true, message: "Invitation email sent successfully" });
        } else {
          res.status(500).json({ message: "Failed to send invitation email" });
        }
      } else {
        res.status(400).json({ message: "No validation token found for this prospect" });
      }
    } catch (error) {
      console.error("Error resending invitation:", error);
      res.status(500).json({ message: "Failed to resend invitation" });
    }
  });

  app.delete("/api/prospects/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check user role authorization
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      if (!['agent', 'admin', 'corporate', 'super_admin'].includes(user.role || '')) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      const success = await storage.deleteMerchantProspect(parseInt(id));
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ message: "Prospect not found" });
      }
    } catch (error) {
      console.error("Error deleting prospect:", error);
      res.status(500).json({ message: "Failed to delete prospect" });
    }
  });

  // Get individual prospect for application view
  app.get("/api/prospects/view/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      console.log('Fetching prospect ID:', id);
      
      const userId = req.user.claims.sub;
      console.log('User ID from session:', userId);
      
      // Get user data
      const user = await storage.getUser(userId);
      if (!user) {
        console.log('User not found for ID:', userId);
        return res.status(404).json({ message: "User not found" });
      }
      console.log('Found user:', user.email, 'role:', user.role);

      // Get prospect data
      const prospect = await storage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        console.log('Prospect not found for ID:', id);
        return res.status(404).json({ message: "Prospect not found" });
      }
      console.log('Found prospect:', prospect.firstName, prospect.lastName, 'agentId:', prospect.agentId);

      // For agents, check if this prospect is assigned to them
      if (user.role === 'agent') {
        let agent = await storage.getAgentByEmail(user.email);
        
        // If no agent found by email, use fallback for development/testing
        if (!agent && userId === 'user_agent_1') {
          // For development, fallback to agent ID 2 (Mike Chen)
          agent = await storage.getAgent(2);
          console.log('Using fallback agent for prospect view:', agent?.firstName, agent?.lastName);
        }
        
        console.log('Found agent:', agent?.id, agent?.firstName, agent?.lastName);
        if (!agent || prospect.agentId !== agent.id) {
          console.log('Access denied - agent ID mismatch:', agent?.id, 'vs prospect agentId:', prospect.agentId);
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // Get assigned agent details
      let assignedAgent = 'Unassigned';
      if (prospect.agentId) {
        const agent = await storage.getAgent(prospect.agentId);
        if (agent) {
          assignedAgent = `${agent.firstName} ${agent.lastName}`;
        }
      }

      console.log('Returning prospect data with assigned agent:', assignedAgent);
      // Look up the latest application for this prospect (Epic F: activity feed scoping)
      let applicationId: number | null = null;
      try {
        const dynamicDB = getRequestDB(req);
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        const apps = await dynamicDB.select({ id: prospectAppsTable.id })
          .from(prospectAppsTable)
          .where(eq(prospectAppsTable.prospectId, prospect.id))
          .orderBy(desc(prospectAppsTable.id))
          .limit(1);
        applicationId = apps[0]?.id ?? null;
      } catch (e) {
        console.warn('Could not load applicationId for prospect', prospect.id, e);
      }
      // Return prospect with agent info
      res.json({
        ...prospect,
        assignedAgent,
        applicationId,
      });
    } catch (error: any) {
      console.error("Error fetching prospect:", error);
      res.status(500).json({ message: "Failed to fetch prospect", error: error?.message });
    }
  });

  // Prospect validation route (public, no auth required)
  app.post("/api/prospects/validate", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const prospect = await storage.getMerchantProspectByEmail(email);
      
      if (!prospect) {
        return res.status(404).json({ message: "No invitation found for this email address. Please check that you entered the correct email address that received the invitation." });
      }

      // Verify the prospect has a validation token (was actually invited)
      if (!prospect.validationToken) {
        return res.status(400).json({ message: "This prospect was not properly invited. Please contact your agent." });
      }

      // Check if already validated
      if (prospect.validatedAt) {
        // Allow re-access if already validated
        return res.json({
          success: true,
          prospect: {
            id: prospect.id,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            email: prospect.email,
            agentId: prospect.agentId,
            validationToken: prospect.validationToken
          }
        });
      }

      // Update validation timestamp for first-time validation
      await storage.updateMerchantProspect(prospect.id, {
        validatedAt: new Date(),
        status: 'contacted'
      });

      res.json({
        success: true,
        prospect: {
          id: prospect.id,
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          email: prospect.email,
          agentId: prospect.agentId,
          validationToken: prospect.validationToken
        }
      });
    } catch (error) {
      console.error("Error validating prospect:", error);
      res.status(500).json({ message: "Failed to validate prospect" });
    }
  });

  // Validate prospect by token (public, no auth required) — rate-limited to
  // discourage token-guessing.
  const prospectTokenLimiter = rateLimit({
    scope: 'prospect:validate-token',
    windowMs: 60_000,
    max: 10,
    keyExtractor: (req) => (req.body && typeof req.body === 'object' ? req.body.token : undefined),
    message: 'Too many token validation attempts. Please try again later.',
  });
  app.post("/api/prospects/validate-token", prospectTokenLimiter, async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ message: "Token is required" });
      }

      const prospect = await storage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Invalid or expired token" });
      }

      // Update validation timestamp if not already validated
      if (!prospect.validatedAt) {
        await storage.updateMerchantProspect(prospect.id, {
          validatedAt: new Date(),
          status: 'contacted'
        });
      }

      res.json({
        success: true,
        prospect: {
          id: prospect.id,
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          email: prospect.email,
          agentId: prospect.agentId,
          validationToken: prospect.validationToken
        }
      });
    } catch (error) {
      console.error("Error validating prospect by token:", error);
      res.status(500).json({ message: "Failed to validate prospect" });
    }
  });

  // Get prospect by token (for starting application)
  app.get("/api/prospects/token/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const prospect = await storage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Invalid or expired token" });
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);

      // Get campaign assignment for this prospect
      const campaignAssignment = await storage.getProspectCampaignAssignment(prospect.id);
      let campaign: CampaignWithDetails | undefined = undefined;
      let campaignEquipment: (CampaignEquipment & { equipmentItem: EquipmentItem })[] = [];

      if (campaignAssignment) {
        // Get campaign details
        campaign = await storage.getCampaignWithDetails(campaignAssignment.campaignId);
        
        // Get equipment associated with this campaign using the correct method
        campaignEquipment = await storage.getCampaignEquipment(campaignAssignment.campaignId);
      }

      res.json({
        prospect,
        agent,
        campaign,
        campaignEquipment
      });
    } catch (error) {
      console.error("Error fetching prospect by token:", error);
      res.status(500).json({ message: "Failed to fetch prospect" });
    }
  });

  // Public API endpoint for application status lookup by token (no auth required)
  app.get("/api/prospects/status/:token", async (req: any, res) => {
    try {
      const { token } = req.params;
      if (!token) return res.status(400).json({ message: "Token is required" });

      const prospect = await storage.getMerchantProspectByToken(token);
      if (!prospect) return res.status(404).json({ message: "Application not found" });

      // Check if a filled PDF was generated for this prospect
      let hasGeneratedPdf = false;
      try {
        const { prospectApplications } = await import("@shared/schema");
        const { eq, and, isNotNull } = await import("drizzle-orm");
        const db = getRequestDB(req);
        const apps = await db.select({ generatedPdfPath: prospectApplications.generatedPdfPath })
          .from(prospectApplications)
          .where(and(eq(prospectApplications.prospectId, prospect.id), isNotNull(prospectApplications.generatedPdfPath)))
          .limit(1);
        hasGeneratedPdf = apps.length > 0 && !!apps[0].generatedPdfPath;
      } catch { /* ignore */ }

      res.json({
        id: prospect.id,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        status: prospect.status,
        createdAt: prospect.createdAt,
        updatedAt: prospect.updatedAt,
        validatedAt: prospect.validatedAt,
        applicationStartedAt: prospect.applicationStartedAt,
        formData: prospect.formData,
        portalSetupAt: prospect.portalSetupAt ?? null,
        hasGeneratedPdf,
      });
    } catch (error) {
      console.error("Error fetching prospect status:", error);
      res.status(500).json({ message: "Failed to fetch application status" });
    }
  });

  // Clear all prospect applications (Super Admin only)
  app.delete("/api/admin/clear-prospects", requirePerm('system:superadmin'), async (req, res) => {
    try {
      // Get current counts for reporting
      const allProspects = await storage.getAllMerchantProspects();
      const prospectCount = allProspects.length;

      // Clear all prospect data using storage methods
      await storage.clearAllProspectData();

      console.log(`Super Admin cleared prospect data: ${prospectCount} prospects and related data`);

      res.json({
        success: true,
        message: "All prospect applications cleared successfully",
        deleted: {
          prospects: prospectCount,
          message: "All related owners and signatures also cleared"
        }
      });
    } catch (error) {
      console.error("Error clearing prospect applications:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to clear prospect applications" 
      });
    }
  });

  // Database environment status (authenticated users can check their current environment)
  app.get("/api/admin/db-environment", isAuthenticated, dbEnvironmentMiddleware, (req: RequestWithDB, res) => {
    const dbEnv = req.dbEnv || 'production';
    const isUsingCustomDB = !!req.dbEnv;
    
    console.log('DB Environment API - req.dbEnv:', req.dbEnv, 'query:', req.query);
    
    res.json({
      success: true,
      environment: dbEnv,
      isUsingCustomDB,
      message: isUsingCustomDB 
        ? `Using ${dbEnv} database environment`
        : 'Using default production database'
    });
  });

  // Update database environment in session (authenticated users can switch environments)
  app.post("/api/admin/db-environment", isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const { environment } = req.body;
      
      // Validate environment
      const validEnvironments = ['production', 'development', 'dev', 'test'];
      if (!environment || !validEnvironments.includes(environment)) {
        return res.status(400).json({
          success: false,
          message: `Invalid environment. Must be one of: ${validEnvironments.join(', ')}`
        });
      }
      
      console.log(`DB Environment Switch - User ${req.userId} switching to ${environment} database`);
      
      // Store the new database environment before destroying session
      const newEnvironment = environment;
      
      // Clear user authentication data but preserve database environment setting
      delete req.session.userId;
      delete req.session.user;
      delete req.session.passport;
      
      // Set the new database environment for the next login
      req.session.dbEnv = newEnvironment;
      
      console.log(`Session cleared and database environment set to ${newEnvironment}`);
      
      // Return response indicating successful switch but requiring re-login
      res.json({
        success: true,
        environment: newEnvironment,
        requiresLogin: true,
        message: `Switched to ${newEnvironment} database environment. Please log in again.`
      });
    } catch (error) {
      console.error('Error switching database environment:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to switch database environment'
      });
    }
  });

  // Database connection diagnostics (Super Admin only)
  app.get("/api/admin/db-diagnostics", requirePerm('system:superadmin'), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const dbEnv = req.dbEnv || 'production';
      
      // Import getDatabaseUrl function from db.ts
      const getDatabaseUrl = (environment?: string): string => {
        switch (environment) {
          case 'test':
            return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
          case 'development':
          case 'dev':
            return process.env.DEV_DATABASE_URL || process.env.DATABASE_URL!;
          case 'production':
          default:
            return process.env.DATABASE_URL!;
        }
      };
      
      // Mask database URLs for security
      const maskUrl = (url: string): string => {
        if (!url) return 'NOT_SET';
        const urlParts = url.split('@');
        if (urlParts.length < 2) return url.substring(0, 20) + '...';
        const hostPart = urlParts[1];
        return `postgresql://***:***@${hostPart}`;
      };
      
      // Test actual database connections by counting users
      const dynamicDB = getRequestDB(req);
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const users = await dynamicDB.select().from((await import('@shared/schema')).users);
      
      res.json({
        success: true,
        environment: dbEnv,
        requestedEnv: req.query.db || 'default',
        databaseUrls: {
          production: maskUrl(process.env.DATABASE_URL || ''),
          test: maskUrl(process.env.TEST_DATABASE_URL || ''),
          development: maskUrl(process.env.DEV_DATABASE_URL || '')
        },
        currentConnection: {
          environment: dbEnv,
          url: maskUrl(getDatabaseUrl(dbEnv)),
          userCount: users.length,
          users: users.map((u: any) => ({ id: u.id, username: u.username, email: u.email }))
        }
      });
    } catch (error) {
      console.error("Error getting database diagnostics:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to get database diagnostics", 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Schema comparison between environments
  app.get("/api/admin/schema-compare", requirePerm('system:superadmin'), async (req, res) => {
    try {
      const { getDynamicDatabase } = await import("./db");
      
      // Get schema information from each environment
      const getSchemaInfo = async (environment: string) => {
        try {
          const db = getDynamicDatabase(environment);
          
          // db-tier-allow: information_schema introspection for the
          // Schema Compare diagnostic UI — Drizzle has no first-class
          // builder for system catalogue reads.
          const tablesResult = await db.execute(`
            SELECT 
              table_name,
              column_name,
              data_type,
              is_nullable,
              column_default,
              ordinal_position
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            ORDER BY table_name, ordinal_position
          `);
          
          // db-tier-allow: pg_catalog index introspection for the
          // Schema Compare diagnostic UI — system catalogue read only.
          const indexesResult = await db.execute(`
            SELECT 
              t.relname as table_name,
              i.relname as index_name,
              array_agg(a.attname ORDER BY c.ordinality) as columns,
              ix.indisunique as is_unique,
              ix.indisprimary as is_primary
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN unnest(ix.indkey) WITH ORDINALITY AS c(colnum, ordinality) ON true
            JOIN pg_attribute a ON t.oid = a.attrelid AND a.attnum = c.colnum
            WHERE t.relkind = 'r' 
              AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary
            ORDER BY t.relname, i.relname
          `);
          
          return {
            environment,
            tables: tablesResult.rows || [],
            indexes: indexesResult.rows || [],
            available: true,
            error: null
          };
        } catch (error) {
          return {
            environment,
            tables: [],
            indexes: [],
            available: false,
            error: error instanceof Error ? error.message : 'Connection failed'
          };
        }
      };
      
      // Get schema info from all environments
      const [prodSchema, devSchema, testSchema] = await Promise.all([
        getSchemaInfo('production'),
        getSchemaInfo('development'), 
        getSchemaInfo('test')
      ]);
      
      // Compare schemas and find differences
      const findSchemaDifferences = (schema1: any, schema2: any) => {
        const differences: {
          missingTables: any[];
          extraTables: any[];
          columnDifferences: any[];
          indexDifferences: any[];
        } = {
          missingTables: [],
          extraTables: [],
          columnDifferences: [],
          indexDifferences: []
        };
        
        // Get unique table names from both schemas
        const schema1Tables = new Set(schema1.tables.map((t: any) => t.table_name));
        const schema2Tables = new Set(schema2.tables.map((t: any) => t.table_name));
        
        // Find missing and extra tables
        for (const table of Array.from(schema1Tables)) {
          if (!schema2Tables.has(table)) {
            differences.missingTables.push(table);
          }
        }
        
        for (const table of Array.from(schema2Tables)) {
          if (!schema1Tables.has(table)) {
            differences.extraTables.push(table);
          }
        }
        
        // Find column differences for common tables
        for (const table of Array.from(schema1Tables)) {
          if (schema2Tables.has(table)) {
            const schema1Cols = schema1.tables.filter((t: any) => t.table_name === table);
            const schema2Cols = schema2.tables.filter((t: any) => t.table_name === table);
            
            const schema1ColNames = new Set(schema1Cols.map((c: any) => c.column_name));
            const schema2ColNames = new Set(schema2Cols.map((c: any) => c.column_name));
            
            for (const col of Array.from(schema1ColNames)) {
              if (!schema2ColNames.has(col)) {
                differences.columnDifferences.push({
                  table: table,
                  column: col,
                  type: 'missing_in_target',
                  details: schema1Cols.find((c: any) => c.column_name === col)
                });
              }
            }
            
            for (const col of Array.from(schema2ColNames)) {
              if (!schema1ColNames.has(col)) {
                differences.columnDifferences.push({
                  table: table,
                  column: col,
                  type: 'extra_in_target',
                  details: schema2Cols.find((c: any) => c.column_name === col)
                });
              }
            }
          }
        }
        
        return differences;
      };
      
      // Generate comparison reports
      const comparisons = {
        'prod-vs-dev': devSchema.available ? findSchemaDifferences(prodSchema, devSchema) : null,
        'prod-vs-test': testSchema.available ? findSchemaDifferences(prodSchema, testSchema) : null,
        'dev-vs-test': (devSchema.available && testSchema.available) ? findSchemaDifferences(devSchema, testSchema) : null
      };
      
      res.json({
        success: true,
        schemas: {
          production: prodSchema,
          development: devSchema,
          test: testSchema
        },
        comparisons,
        summary: {
          totalEnvironments: [prodSchema, devSchema, testSchema].filter(s => s.available).length,
          availableEnvironments: [prodSchema, devSchema, testSchema]
            .filter(s => s.available)
            .map(s => s.environment),
          unavailableEnvironments: [prodSchema, devSchema, testSchema]
            .filter(s => !s.available)
            .map(s => s.environment)
        }
      });
      
    } catch (error) {
      console.error("Error comparing schemas:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to compare database schemas", 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Migration management endpoint (NEW - BULLETPROOF APPROACH)
  app.post("/api/admin/migration", isAuthenticated, requirePerm('system:superadmin'), async (req, res) => {
    try {
      const { action, environment } = req.body;

      console.log(`🔧 Migration action: ${action} ${environment || ''}`);
      
      // Import migration manager functionality
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let command = '';
      let result = {};
      
      switch (action) {
        case 'generate':
          command = 'tsx scripts/migration-manager.ts generate';
          break;
        case 'apply':
          if (!environment || !['development', 'test', 'production'].includes(environment)) {
            return res.status(400).json({
              success: false,
              message: 'Environment required: development, test, or production'
            });
          }
          const env = environment === 'production' ? 'prod' : environment === 'development' ? 'dev' : 'test';
          command = `tsx scripts/migration-manager.ts apply ${env}`;
          break;
        case 'status':
          command = 'tsx scripts/migration-manager.ts status';
          break;
        case 'validate':
          command = 'tsx scripts/migration-manager.ts validate';
          break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid action. Use: generate, apply, status, or validate'
          });
      }
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        env: process.env
      });
      
      result = {
        success: true,
        action,
        environment,
        output: stdout,
        warnings: stderr || null,
        message: `Migration ${action} completed successfully`
      };

      res.json(result);
      
    } catch (error: any) {
      console.error("Migration error:", error);
      res.status(500).json({
        success: false,
        message: `Migration ${req.body.action || 'operation'} failed`,
        error: error.message,
        stderr: error.stderr || null
      });
    }
  });

  // Cross-environment data/schema sync. Writes an explicit, high-severity
  // audit row capturing source env, target env, sync type, tables touched,
  // row counts, and the acting user — independent of the generic CRUD audit
  // middleware. The actual sync execution is delegated to the existing
  // schema-sync engine; this endpoint is the auditable entry point.
  app.post("/api/admin/db-sync", isAuthenticated, requirePerm('system:superadmin'), async (req, res) => {
    const actingUserId: string | null =
      req.session?.userId || req.user?.claims?.sub || null;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    try {
      const body = req.body || {};
      const fromEnvironment = String(body.fromEnvironment || '').trim();
      const toEnvironment = String(body.toEnvironment || '').trim();
      const syncType = String(body.syncType || '').trim() || 'schema';
      const tables: string[] = Array.isArray(body.tables) ? body.tables.map(String) : [];
      const rowCountsInput: Record<string, number> | null =
        body.rowCounts && typeof body.rowCounts === 'object' ? body.rowCounts : null;

      const validEnvs = ['production', 'development', 'test'];
      if (!validEnvs.includes(fromEnvironment) || !validEnvs.includes(toEnvironment)) {
        return res.status(400).json({
          success: false,
          message: 'fromEnvironment and toEnvironment must be one of: production, development, test',
        });
      }
      if (fromEnvironment === toEnvironment) {
        return res.status(400).json({
          success: false,
          message: 'Source and target environments must differ',
        });
      }

      // Compute row counts per table from the source DB if the caller did not
      // pre-supply them, so the audit row always carries concrete numbers.
      const computedRowCounts: Record<string, number> = { ...(rowCountsInput || {}) };
      if (tables.length > 0 && !rowCountsInput) {
        try {
          const { getDynamicDatabase } = await import('./db');
          const sourceDB: any = getDynamicDatabase(fromEnvironment);
          for (const tbl of tables) {
            try {
              // db-tier-allow: read-only COUNT(*) for audit row counts on
              // operator-supplied table names; not a CRUD path.
              const result: any = await sourceDB.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM "${tbl.replace(/"/g, '""')}"`));
              const rows = result?.rows || result || [];
              const c = rows[0]?.c ?? rows[0]?.count ?? 0;
              computedRowCounts[tbl] = Number(c) || 0;
            } catch {
              computedRowCounts[tbl] = -1; // unknown / unreadable
            }
          }
        } catch (countErr) {
          console.warn('db-sync: failed to compute row counts', countErr);
        }
      }

      // Write the explicit, high-severity audit entry. This is independent of
      // the generic CRUD audit middleware row.
      const { AuditService } = await import('./auditService');
      const dbModule = await import('./db');
      const auditDB = req.dynamicDB || dbModule.db;
      const explicitAudit = new AuditService(auditDB);
      const auditId = await explicitAudit.logAction(
        'cross_env_sync',
        'database',
        {
          userId: actingUserId ?? undefined,
          ipAddress: ip,
          userAgent: req.get('User-Agent') || undefined,
          method: req.method,
          endpoint: req.path,
          environment: toEnvironment,
        },
        {
          riskLevel: 'high',
          dataClassification: 'restricted',
          tags: {
            fromEnvironment,
            toEnvironment,
            syncType,
            tables,
            rowCounts: computedRowCounts,
          },
          notes: `Cross-env sync: ${syncType} from ${fromEnvironment} -> ${toEnvironment} on ${tables.length} table(s) by user ${actingUserId || 'unknown'}`,
        }
      );

      return res.json({
        success: true,
        auditId,
        fromEnvironment,
        toEnvironment,
        syncType,
        tables,
        rowCounts: computedRowCounts,
        userId: actingUserId,
      });
    } catch (error: any) {
      console.error('db-sync error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to record db-sync audit entry',
        error: error?.message,
      });
    }
  });

  // Schema synchronization endpoint [DEPRECATED]
  app.post("/api/admin/schema-sync", requirePerm('system:superadmin'), async (req, res) => {
    // Add deprecation warning
    console.warn("🚨 DEPRECATED: /api/admin/schema-sync endpoint used. Recommend migrating to /api/admin/migration");
    
    res.json({
      success: false,
      deprecated: true,
      message: "This endpoint is deprecated. Use the new migration workflow instead.",
      recommendation: {
        newEndpoint: "/api/admin/migration",
        workflow: [
          "POST /api/admin/migration with { action: 'generate' }",
          "POST /api/admin/migration with { action: 'apply', environment: 'development' }",
          "POST /api/admin/migration with { action: 'apply', environment: 'test' }",
          "POST /api/admin/migration with { action: 'apply', environment: 'production' }"
        ],
        documentation: "See MIGRATION_WORKFLOW.md for complete guide"
      }
    });
    return;
    try {
      const { fromEnvironment, toEnvironment, syncType, tables, createCheckpoint = true } = req.body;
      
      // Validate environments
      const validEnvironments = ['production', 'development', 'test'];
      if (!validEnvironments.includes(fromEnvironment) || !validEnvironments.includes(toEnvironment)) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid environment specified" 
        });
      }
      
      if (fromEnvironment === toEnvironment) {
        return res.status(400).json({ 
          success: false, 
          message: "Source and target environments cannot be the same" 
        });
      }
      
      const { getDynamicDatabase } = await import("./db");
      const sourceDB = getDynamicDatabase(fromEnvironment);
      const targetDB = getDynamicDatabase(toEnvironment);
      
      const results: {
        success: boolean;
        fromEnvironment: any;
        toEnvironment: any;
        syncType: any;
        operations: any[];
        errors: any[];
        checkpointCreated: boolean;
        interactivePrompt: any;
      } = {
        success: true,
        fromEnvironment,
        toEnvironment,
        syncType,
        operations: [],
        errors: [],
        checkpointCreated: false,
        interactivePrompt: null
      };

      // Create checkpoint before destructive operations (especially for production)
      if (createCheckpoint && (toEnvironment === 'production' || syncType === 'drizzle-push')) {
        try {
          console.log(`📸 Creating checkpoint before syncing to ${toEnvironment}...`);
          // Note: In a real system, this would create an actual database checkpoint
          // For now, we'll simulate the checkpoint creation
          results.checkpointCreated = true;
          results.operations.push({
            type: 'checkpoint',
            target: toEnvironment,
            timestamp: new Date().toISOString(),
            success: true
          });
          console.log(`✅ Checkpoint created for ${toEnvironment}`);
        } catch (error) {
          console.warn(`⚠️ Failed to create checkpoint:`, error);
          results.errors.push({
            operation: 'checkpoint',
            error: 'Failed to create checkpoint - proceeding without backup',
            environment: toEnvironment
          });
        }
      }
      
      if (syncType === 'drizzle-push') {
        // Use Drizzle push to sync schema
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          
          // Get the appropriate database URL for target environment
          const getDatabaseUrl = (environment: string): string => {
            switch (environment) {
              case 'test':
                return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
              case 'development':
                return process.env.DEV_DATABASE_URL || process.env.DATABASE_URL!;
              case 'production':
              default:
                return process.env.DATABASE_URL!;
            }
          };
          
          const targetDbUrl = getDatabaseUrl(toEnvironment);
          
          console.log(`🔄 Syncing schema to ${toEnvironment} using Drizzle push...`);
          
          const command = `DATABASE_URL="${targetDbUrl}" npx drizzle-kit push --force`;
          
          const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: targetDbUrl
            },
            timeout: 30000 // 30 second timeout
          });
          
          results.operations.push({
            type: 'drizzle-push',
            target: toEnvironment,
            stdout: stdout,
            stderr: stderr,
            success: true
          });
          
          console.log(`✅ Schema synchronized to ${toEnvironment}`);
          
        } catch (error: any) {
          console.error(`❌ Failed to sync to ${toEnvironment}:`, error);
          
          let errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
          
          // Check for interactive prompts that need user input
          if (errorMessage.includes('Is') && errorMessage.includes('column') && errorMessage.includes('created or renamed')) {
            // Extract the interactive prompt details
            const promptMatch = errorMessage.match(/Is (.+?) column in (.+?) table created or renamed from another column\?/);
            const optionsMatch = errorMessage.match(/❯ \+ (.+?)\s+create column/);
            
            if (promptMatch && optionsMatch) {
              // Get the appropriate database URL for target environment
              const getDatabaseUrl = (environment: string): string => {
                switch (environment) {
                  case 'test':
                    return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
                  case 'development':
                    return process.env.DEV_DATABASE_URL || process.env.DATABASE_URL!;
                  case 'production':
                  default:
                    return process.env.DATABASE_URL!;
                }
              };
              
              results.interactivePrompt = {
                question: promptMatch![0],
                column: promptMatch![1],
                table: promptMatch![2],
                options: [
                  { type: 'create', label: `+ ${promptMatch![1]} create column`, recommended: false },
                  { type: 'rename', label: 'Rename from existing column', recommended: true }
                ],
                command: `DATABASE_URL="${getDatabaseUrl(toEnvironment)}" npx drizzle-kit push`
              };
            }
            
            errorMessage = 'Interactive prompt detected: Drizzle requires manual confirmation for column changes. This typically happens when:\n' +
              '• A column appears to be renamed\n' +
              '• Schema changes might cause data loss\n' +
              '• Manual intervention is needed to preserve data\n\n' +
              'Use the interactive prompt dialog to resolve this safely.';
          }
          
          results.errors.push({
            environment: toEnvironment,
            error: errorMessage,
            operation: 'drizzle-push'
          });
        }
        
      } else if (syncType === 'selective' && tables && Array.isArray(tables)) {
        // Selective table sync (copy structure only, not data)
        for (const tableName of tables) {
          // Allow-list: only permit safe identifier characters to prevent SQL injection
          if (typeof tableName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
            results.errors.push({
              table: String(tableName),
              error: 'Invalid table name',
              operation: 'table-sync'
            });
            continue;
          }
          try {
            // Get the CREATE TABLE statement from source (parameterized)
            // db-tier-allow: schema-sync admin endpoint reads information_schema for cross-env DDL replication
            const createTableResult = await sourceDB.execute(sql`
              SELECT 
                'CREATE TABLE ' || quote_ident(table_name) || ' (' ||
                array_to_string(
                  array_agg(
                    quote_ident(column_name) || ' ' || 
                    data_type ||
                    CASE 
                      WHEN character_maximum_length IS NOT NULL 
                      THEN '(' || character_maximum_length || ')'
                      ELSE ''
                    END ||
                    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
                    CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END
                    ORDER BY ordinal_position
                  ), ', '
                ) || ');' as create_statement
              FROM information_schema.columns 
              WHERE table_schema = 'public' AND table_name = ${tableName}
              GROUP BY table_name
            `);
            
            const rows = (createTableResult as unknown as { rows?: Array<{ create_statement: string }> }).rows ?? [];
            if (rows.length > 0) {
              const createStatement = rows[0].create_statement;
              
              // Drop table if exists and recreate. tableName is allow-list validated above.
              // db-tier-allow: schema-sync admin endpoint replicates DDL across environments
              await targetDB.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(tableName)} CASCADE`);
              // db-tier-allow: createStatement is generated by source DB from information_schema, not user input
              await targetDB.execute(sql.raw(createStatement));
              
              results.operations.push({
                type: 'table-sync',
                table: tableName,
                operation: 'created',
                success: true
              });
            }
            
          } catch (error: any) {
            results.errors.push({
              table: tableName,
              error: error instanceof Error ? error.message : 'Unknown error',
              operation: 'table-sync'
            });
          }
        }
      }
      
      res.json(results);
      
    } catch (error: any) {
      console.error("Error syncing schemas:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to sync database schemas", 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Comprehensive testing data reset utility (Super Admin only)
  app.post("/api/admin/reset-testing-data", requirePerm('system:superadmin'), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const options = req.body || {};
      
      // Validate options
      const validOptions = ['prospects', 'campaigns', 'equipment', 'signatures', 'formData'];
      const invalidOptions = Object.keys(options).filter(key => !validOptions.includes(key));
      
      if (invalidOptions.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid options: ${invalidOptions.join(', ')}. Valid options: ${validOptions.join(', ')}`
        });
      }

      // Use dynamic database connection instead of storage
      const dynamicDB = getRequestDB(req);
      const result = await resetTestingDataWithDB(dynamicDB, options);

      console.log(`Super Admin reset testing data:`, {
        options,
        result
      });

      res.json({
        success: true,
        message: "Testing data reset completed",
        ...result
      });
    } catch (error) {
      console.error("Error resetting testing data:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to reset testing data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update prospect status to "in progress" when they start filling out the form
  app.post("/api/prospects/:id/start-application", async (req, res) => {
    try {
      const { id } = req.params;
      const prospectId = parseInt(id);
      
      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Only update if status is 'contacted' (validated email)
      if (prospect.status === 'contacted') {
        const updatedProspect = await storage.updateMerchantProspect(prospectId, {
          status: 'in_progress',
          applicationStartedAt: new Date(),
        });
        res.json(updatedProspect);
      } else {
        res.json(prospect); // Return existing prospect if already in progress or further along
      }
    } catch (error) {
      console.error("Error updating prospect status:", error);
      res.status(500).json({ message: "Failed to update prospect status" });
    }
  });

  // Clear address data from cached form data
  app.post("/api/prospects/:id/clear-address-data", async (req, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = await storage.getMerchantProspect(prospectId);
      
      if (!prospect || !prospect.formData) {
        return res.json({ success: true, message: "No cached data to clear" });
      }

      // Parse existing form data and remove address fields
      const existingFormData = typeof prospect.formData === 'string' 
        ? JSON.parse(prospect.formData) 
        : prospect.formData;
      
      // Remove address-related fields
      delete existingFormData.address;
      delete existingFormData.city;
      delete existingFormData.state;
      delete existingFormData.zipCode;
      
      // Save cleaned form data back
      await storage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(existingFormData)
      });

      res.json({ success: true, message: "Address data cleared" });
    } catch (error) {
      console.error("Error clearing address data:", error);
      res.status(500).json({ message: "Failed to clear address data" });
    }
  });

  // Save form data for prospects
  app.post("/api/prospects/:id/save-form-data", async (req, res) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        formData: z.record(z.any()),
        currentStep: z.union([z.number().int(), z.string()]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid form data payload", errors: parsed.error.flatten() });
      }
      const { formData, currentStep } = parsed.data;
      const prospectId = parseInt(id);

      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Save the form data and current step
      await storage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(formData),
        currentStep: currentStep
      });

      console.log(`Form data saved for prospect ${prospectId}, step ${currentStep}`);
      res.json({ success: true, message: "Form data saved successfully" });
    } catch (error) {
      console.error("Error saving prospect form data:", error);
      res.status(500).json({ message: "Failed to save form data" });
    }
  });

  // Download application PDF for prospects  
  app.get("/api/prospects/:id/download-pdf", async (req, res) => {
    console.log(`PDF Download - Route hit for prospect ${req.params.id}`);
    
    try {
      const { id } = req.params;
      const prospectId = parseInt(id);

      if (isNaN(prospectId)) {
        console.log(`PDF Download - Invalid prospect ID: ${id}`);
        return res.status(400).json({ message: "Invalid prospect ID" });
      }

      console.log(`PDF Download - Looking up prospect ID: ${prospectId}`);

      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) {
        console.log(`PDF Download - Prospect ${prospectId} not found`);
        return res.status(404).json({ message: "Prospect not found" });
      }

      console.log(`PDF Download - Found prospect: ${prospect.firstName} ${prospect.lastName}, status: ${prospect.status}`);

      // Allow PDF download for submitted applications
      if (prospect.status !== 'submitted' && prospect.status !== 'applied') {
        console.log(`PDF Download - Invalid status: ${prospect.status}`);
        return res.status(400).json({ message: "PDF only available for submitted applications" });
      }

      // Parse form data
      let formData: any = {};
      if (prospect.formData) {
        try {
          formData = JSON.parse(prospect.formData);
          console.log(`PDF Download - Form data parsed successfully, company: ${formData.companyName}`);
        } catch (error) {
          console.error('PDF Download - Error parsing form data:', error);
          return res.status(400).json({ message: "Invalid form data" });
        }
      } else {
        console.log(`PDF Download - No form data available`);
        return res.status(400).json({ message: "No form data available" });
      }

      // Try to serve the pre-generated filled PDF first
      try {
        const { prospectApplications } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { getDynamicDatabase } = await import('./db');
        const devDb = getDynamicDatabase('development');
        const [prospectApp] = await devDb.select().from(prospectApplications)
          .where(eq(prospectApplications.prospectId, prospectId)).limit(1);

        if (prospectApp?.generatedPdfPath) {
          const fs = await import('fs');
          const pathMod = await import('path');
          const fullPath = pathMod.default.join(process.cwd(), prospectApp.generatedPdfPath);
          if (fs.existsSync(fullPath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${prospect.firstName}_${prospect.lastName}_Application.pdf"`);
            const fileStream = fs.createReadStream(fullPath);
            return fileStream.pipe(res);
          }
        }
      } catch (filledPdfError) {
        console.error('Filled PDF lookup failed, falling back to generated:', filledPdfError);
      }

      // Fall back to generating a fresh PDF
      try {
        const { pdfGenerator } = await import('./pdfGenerator');
        const pdfBuffer = await pdfGenerator.generateApplicationPDF(prospect, formData);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${prospect.firstName}_${prospect.lastName}_Application_${new Date().toLocaleDateString().replace(/\//g, '_')}.pdf"`);
        res.send(pdfBuffer);
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        res.status(500).json({ message: "Failed to generate PDF" });
      }
    } catch (error) {
      console.error("Error downloading prospect PDF:", error);
      res.status(500).json({ message: "Failed to download PDF" });
    }
  });

  // Submit complete application for prospects
  app.post("/api/prospects/:id/submit-application", async (req, res) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        formData: z.record(z.any()),
        status: z.string().optional(),
        deepLinkCampaignId: z.union([z.number(), z.string()]).nullable().optional(),
        deepLinkAgentId: z.union([z.number(), z.string()]).nullable().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid submit-application payload", errors: parsed.error.flatten() });
      }
      const { formData, status, deepLinkCampaignId, deepLinkAgentId } = parsed.data;
      const prospectId = parseInt(id);

      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Epic D — ?agentId= and ?campaignId= are CONTEXT HINTS only on this
      // public endpoint. We never mutate prospect.agentId from URL input, and
      // we never override an existing different campaign assignment from URL
      // input either (both would enable IDOR-style tampering by guessing
      // prospect IDs). Deep-link values are honored only when:
      //   - prospect has no active assignment yet (initial assignment), OR
      //   - the value matches what's already assigned (idempotent).
      // Anything stronger (cross-session deep-link binding) requires a signed
      // invite token, which is out of scope for Epic D.
      const dlCampaignId =
        deepLinkCampaignId && Number(deepLinkCampaignId) > 0 ? Number(deepLinkCampaignId) : null;
      try {
        const sessionUserId = (req.session as { userId?: string } | undefined)?.userId;
        const existing = await storage.getProspectCampaignAssignment(prospectId);

        if (dlCampaignId && existing && existing.campaignId !== dlCampaignId) {
          // Refuse to silently swap a campaign that was set by an authenticated
          // user. The merchant must contact the agent/admin to change pricing.
          return res.status(409).json({
            message: 'Prospect already has a different campaign assigned; deep-link campaign ignored',
            existingCampaignId: existing.campaignId,
            deepLinkCampaignId: dlCampaignId,
          });
        }

        if (!existing) {
          // Resolution chain (most specific → least specific):
          //   1. deepLinkCampaignId  2. agent.defaultCampaignId  3. rules engine
          const effectiveAgentId =
            prospect.agentId ?? (deepLinkAgentId ? Number(deepLinkAgentId) : null);
          let resolved: number | undefined;
          if (dlCampaignId) {
            const camp = await storage.getCampaign(dlCampaignId);
            if (!camp || camp.isActive === false) {
              return res.status(400).json({
                message: 'Deep-link campaign is invalid or inactive',
                campaignId: dlCampaignId,
              });
            }
            resolved = dlCampaignId;
          }
          if (!resolved && effectiveAgentId) {
            const ag = await storage.getAgent(effectiveAgentId);
            if (ag?.defaultCampaignId) resolved = ag.defaultCampaignId;
          }
          if (!resolved) {
            const ruleMatch = await storage.findCampaignByRule({
              mcc: formData?.mcc ?? formData?.mccCode ?? null,
              acquirerId: formData?.acquirerId ? Number(formData.acquirerId) : null,
              agentId: effectiveAgentId ?? null,
            });
            if (ruleMatch) resolved = ruleMatch;
          }
          if (resolved) {
            await storage.swapCampaignForProspect(prospectId, resolved, sessionUserId || 'system');
          }
        }
      } catch (assignErr) {
        // Deep-link supplied → fail fast so pricing is never silently dropped.
        if (dlCampaignId) {
          console.error('[Epic D] deep-link campaign assignment failed:', assignErr);
          return res.status(500).json({ message: 'Failed to apply deep-link campaign' });
        }
        console.warn('[Epic D] submission-time auto-assign skipped:', assignErr);
      }

      // Comprehensive validation before submission
      const validationErrors: string[] = [];
      const missingSignatures: any[] = [];

      // Required field validation
      const requiredFields = [
        { field: 'companyName', label: 'Company Name' },
        { field: 'companyEmail', label: 'Company Email' },
        { field: 'companyPhone', label: 'Company Phone' },
        { field: 'address', label: 'Business Address' },
        { field: 'city', label: 'City' },
        { field: 'state', label: 'State' },
        { field: 'zipCode', label: 'ZIP Code' },
        { field: 'federalTaxId', label: 'Federal Tax ID' },
        { field: 'businessType', label: 'Business Type' },
        { field: 'yearsInBusiness', label: 'Years in Business' },
        { field: 'businessDescription', label: 'Business Description' },
        { field: 'productsServices', label: 'Products/Services' },
        { field: 'processingMethod', label: 'Processing Method' },
        { field: 'monthlyVolume', label: 'Monthly Volume' },
        { field: 'averageTicket', label: 'Average Ticket' },
        { field: 'highestTicket', label: 'Highest Ticket' }
      ];

      // Check for missing required fields
      for (const { field, label } of requiredFields) {
        if (!formData || !formData[field] || formData[field] === '') {
          validationErrors.push(`${label} is required`);
        }
      }

      // Validate business ownership totals 100%
      if (formData && formData.owners && Array.isArray(formData.owners)) {
        const totalOwnership = formData.owners.reduce((sum: number, owner: any) => {
          return sum + (parseFloat(owner.percentage) || 0);
        }, 0);

        if (Math.abs(totalOwnership - 100) > 0.01) {
          validationErrors.push(`Total ownership must equal 100% (currently ${totalOwnership}%)`);
        }

        // Check for required signatures
        const ownersRequiringSignatures = formData.owners.filter((owner: any) => {
          const percentage = parseFloat(owner.percentage) || 0;
          return percentage >= 25;
        });

        const ownersWithoutSignatures = ownersRequiringSignatures.filter((owner: any) => {
          return !owner.signature || owner.signature === null || owner.signature === '';
        });

        if (ownersWithoutSignatures.length > 0) {
          missingSignatures.push(...ownersWithoutSignatures.map((owner: any) => ({
            name: owner.name,
            email: owner.email,
            percentage: owner.percentage
          })));
          validationErrors.push(`Signatures required for owners with 25% or more ownership`);
        }
      } else {
        validationErrors.push('At least one business owner is required');
      }

      // Return validation errors if any exist
      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          message: `Application incomplete. Please complete the following:\n${validationErrors.map(err => `• ${err}`).join('\n')}`,
          validationErrors,
          missingSignatures: missingSignatures.length > 0 ? missingSignatures : undefined
        });
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Update prospect with final form data and status
      const updatedProspect = await storage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(formData),
        status: 'submitted'
      });

      // Generate PDF document
      let pdfBuffer: Buffer | undefined;
      let generatedPdfPath: string | undefined;
      let submittedAppId: number | undefined;
      try {
        const { pdfGenerator } = await import('./pdfGenerator');
        const fs = await import('fs');
        const path = await import('path');

        // Check if prospect has an acquirer template-based application with original PDF
        let filledFromTemplate = false;
        try {
          const { prospectApplications, acquirerApplicationTemplates } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const { getDynamicDatabase } = await import('./db');
          const devDb = getDynamicDatabase('development');
          if (devDb) {
            const [prospectApp] = await devDb.select().from(prospectApplications)
              .where(eq(prospectApplications.prospectId, prospectId)).limit(1);
            if (prospectApp) {
              submittedAppId = prospectApp.id;
              const [template] = await devDb.select().from(acquirerApplicationTemplates)
                .where(eq(acquirerApplicationTemplates.id, prospectApp.templateId)).limit(1);
              if (template?.originalPdfBase64) {
                console.log(`Generating filled PDF from template "${template.templateName}" for prospect ${prospectId}`);
                // Epic D — inject the prospect's active campaign fee values
                // so the initial submission already reflects deep-link pricing.
                const campaignFees = await loadCampaignFeesForProspect(prospectId, devDb);
                const mergedSubmit = {
                  ...formData,
                  ...(prospectApp.applicationData as Record<string, any> || {}),
                  ...campaignFees,
                };
                pdfBuffer = await pdfGenerator.generateFilledPDF(
                  template.originalPdfBase64,
                  mergedSubmit,
                  template.fieldConfiguration,
                  Array.isArray(template.pdfMappingConfiguration) ? template.pdfMappingConfiguration as unknown[] : []
                );
                filledFromTemplate = true;

                // Save filled PDF to disk
                const uploadsDir = path.default.join(process.cwd(), 'uploads', 'generated-pdfs');
                if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                const safeCompany = (formData.companyName || 'application').replace(/[^a-zA-Z0-9_-]/g, '_');
                const fileName = `${safeCompany}_${prospectId}_${Date.now()}.pdf`;
                const filePath = path.default.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, pdfBuffer);
                generatedPdfPath = `uploads/generated-pdfs/${fileName}`;

                // Update prospect_applications record with the generated PDF path
                await devDb.update(prospectApplications).set({
                  generatedPdfPath,
                  status: 'SUB',
                  submittedAt: new Date(),
                  applicationData: { ...formData, ...(prospectApp.applicationData as Record<string, any> || {}) },
                  updatedAt: new Date()
                }).where(eq(prospectApplications.id, prospectApp.id));

                console.log(`Filled PDF saved to ${generatedPdfPath}`);
              }
            }
          }
        } catch (templateError) {
          console.error('Template-based PDF generation failed, falling back to standard:', templateError);
        }

        if (!filledFromTemplate) {
          pdfBuffer = await pdfGenerator.generateApplicationPDF(updatedProspect, formData as Parameters<typeof pdfGenerator.generateApplicationPDF>[1]);
        }
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
      }

      // Auto-advance the application SUB → CUW and kick off the underwriting
      // pipeline. Idempotent — only advances when the app isn't already in CUW.
      // Uses the same DB env as the rest of the submit flow (session-scoped
      // when present, otherwise development) so writes stay consistent across
      // PDF/template/auto-trigger blocks.
      try {
        const submitEnv = (req.session as { dbEnv?: string } | undefined)?.dbEnv || 'development';
        const submitDb = getDynamicDatabase(submitEnv);
        let appRow = submittedAppId
          ? (await submitDb.select().from(prospectAppsTable).where(eq(prospectAppsTable.id, submittedAppId)).limit(1))[0]
          : undefined;
        if (!appRow) {
          [appRow] = await submitDb.select().from(prospectAppsTable)
            .where(eq(prospectAppsTable.prospectId, prospectId))
            .orderBy(desc(prospectAppsTable.updatedAt))
            .limit(1);
        }
        if (appRow && appRow.status !== 'CUW') {
          if (appRow.status !== 'SUB') {
            await submitDb.update(prospectAppsTable)
              .set({ status: 'SUB', submittedAt: new Date(), updatedAt: new Date() })
              .where(eq(prospectAppsTable.id, appRow.id));
            await submitDb.insert(underwritingStatusHistory).values({
              applicationId: appRow.id,
              fromStatus: appRow.status, toStatus: 'SUB',
              fromSubStatus: appRow.subStatus, toSubStatus: null,
              changedBy: null, reason: 'Application submitted',
            });
          }
          await submitDb.update(prospectAppsTable)
            .set({ status: 'CUW', updatedAt: new Date() })
            .where(eq(prospectAppsTable.id, appRow.id));
          await submitDb.insert(underwritingStatusHistory).values({
            applicationId: appRow.id,
            fromStatus: 'SUB', toStatus: 'CUW',
            changedBy: null, reason: 'Auto-advanced on submission',
          });
          await notifyTransition(submitDb, appRow.id, 'CUW', {
            fromStatus: 'SUB', reason: 'Auto-advanced on submission',
          }).catch(e => console.error('underwriting notif:', e));
          const appId = appRow.id;
          setImmediate(() => {
            runUnderwritingPipeline({ db: submitDb, applicationId: appId, startedBy: null })
              .catch(e => console.error('underwriting pipeline:', e));
          });
        }
      } catch (autoErr) {
        console.error('Auto-start underwriting failed:', autoErr);
      }

      // Send notification emails
      try {
        const submissionDate = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        await emailService.sendApplicationSubmissionNotification({
          companyName: formData.companyName || 'Unknown Company',
          applicantName: `${prospect.firstName} ${prospect.lastName}`,
          applicantEmail: prospect.email,
          agentName: `${agent.firstName} ${agent.lastName}`,
          agentEmail: agent.email,
          submissionDate,
          applicationToken: prospect.validationToken || 'unknown'
        }, pdfBuffer);
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
      }

      console.log(`Application submitted for prospect ${prospectId}${generatedPdfPath ? ` (PDF: ${generatedPdfPath})` : ''}`);

      // Drop in-app notifications for the assigned agent (so they see it in
      // the bell instantly) and broadcast to the underwriting queue so any
      // available reviewer can pick the new SUB application up.
      const prospectLabel = `${prospect.firstName} ${prospect.lastName}`.trim() || prospect.email;
      const companyLabel = formData.companyName || prospectLabel;
      if (agent.userId) {
        await createAlert({
          userId: agent.userId,
          type: "success",
          message: `Application submitted by ${prospectLabel} (${companyLabel})`,
          actionUrl: `/prospects/${prospectId}`,
        });
      }
      await createAlertForRoles(
        ["underwriter", "senior_underwriter", "super_admin"],
        `New application in queue: ${companyLabel}`,
        { type: "info", actionUrl: `/prospects/${prospectId}` },
      );

      res.json({ 
        success: true, 
        message: "Application submitted successfully",
        prospect: updatedProspect,
        statusUrl: `/application-status/${prospect.validationToken}`,
        generatedPdfPath: generatedPdfPath || undefined
      });
    } catch (error) {
      console.error("Error submitting prospect application:", error);
      res.status(500).json({ message: "Failed to submit application" });
    }
  });

  // Application status lookup
  app.get("/api/application-status/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const prospect = await storage.getMerchantProspectByToken(token);
      if (!prospect) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);

      // Check for generated PDF in prospect_applications
      let hasGeneratedPdf = false;
      try {
        const { prospectApplications } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { getDynamicDatabase } = await import('./db');
        const devDb = getDynamicDatabase('development');
        const [prospectApp] = await devDb.select().from(prospectApplications)
          .where(eq(prospectApplications.prospectId, prospect.id)).limit(1);
        if (prospectApp?.generatedPdfPath) {
          hasGeneratedPdf = true;
        }
      } catch { /* noop: dev-DB lookup is best-effort enrichment, leave hasGeneratedPdf=false on error */ }
      
      const response = {
        ...prospect,
        hasGeneratedPdf,
        agent: agent ? {
          firstName: agent.firstName,
          lastName: agent.lastName,
          email: agent.email
        } : null
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching application status:", error);
      res.status(500).json({ message: "Failed to fetch application status" });
    }
  });

  // Download generated filled PDF by prospect token
  app.get("/api/prospects/download-filled-pdf/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const prospect = await storage.getMerchantProspectByToken(token);
      if (!prospect) {
        return res.status(404).json({ message: "Application not found" });
      }

      if (prospect.status !== 'submitted' && prospect.status !== 'applied' && prospect.status !== 'approved') {
        return res.status(400).json({ message: "PDF only available for submitted applications" });
      }

      const { prospectApplications } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { getDynamicDatabase } = await import('./db');
      const devDb = getDynamicDatabase('development');
      const [prospectApp] = await devDb.select().from(prospectApplications)
        .where(eq(prospectApplications.prospectId, prospect.id)).limit(1);

      if (!prospectApp?.generatedPdfPath) {
        return res.status(404).json({ message: "No generated PDF available. The application may not have been processed with a template." });
      }

      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.default.join(process.cwd(), prospectApp.generatedPdfPath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ message: "Generated PDF file not found on disk" });
      }

      const safeCompany = (`${prospect.firstName}_${prospect.lastName}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeCompany}_Application.pdf"`);
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading filled PDF:", error);
      res.status(500).json({ message: "Failed to download PDF" });
    }
  });

  // Send signature request email
  app.post("/api/signature-request", async (req, res) => {
    try {
      const parsed = sharedSignatureRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid signature request payload",
          errors: parsed.error.flatten(),
        });
      }
      const {
        ownerName,
        ownerEmail,
        companyName,
        ownershipPercentage,
        requesterName,
        agentName,
        prospectId,
      } = parsed.data;

      // Generate unique signature token
      const signatureToken = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create or update prospect owner in database
      const existingOwners = await storage.getProspectOwners(prospectId);
      const existingOwner = existingOwners.find(owner => owner.email === ownerEmail);

      if (existingOwner) {
        // Update existing owner with signature token
        await storage.updateProspectOwner(existingOwner.id, {
          signatureToken,
          emailSent: true,
          emailSentAt: new Date()
        });
      } else {
        // Create new prospect owner
        await storage.createProspectOwner({
          prospectId,
          name: ownerName,
          email: ownerEmail,
          ownershipPercentage: ownershipPercentage.toString(),
          signatureToken,
          emailSent: true,
          emailSentAt: new Date()
        });
      }

      const success = await emailService.sendSignatureRequestEmail({
        ownerName,
        ownerEmail,
        companyName,
        ownershipPercentage: String(ownershipPercentage),
        signatureToken,
        requesterName: requesterName || "",
        agentName: agentName || ""
      });

      if (success) {
        // Mirror the email with an in-app alert for the requester so they
        // get a confirmation in the bell that the signature request went out.
        const requesterUserId = (req.session as { userId?: string } | undefined)?.userId
          || (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub;
        if (requesterUserId) {
          await createAlert({
            userId: requesterUserId,
            type: "info",
            message: `Signature request sent to ${ownerName} (${ownerEmail}) for ${companyName}`,
          });
        }
        res.json({ 
          success: true, 
          message: `Signature request sent to ${ownerEmail}`,
          signatureToken 
        });
      } else {
        console.log(`Signature request email failed for ${ownerEmail}, but continuing workflow`);
        res.json({ 
          success: true, 
          message: `Signature request prepared for ${ownerEmail} (email delivery pending)`,
          signatureToken,
          emailFailed: true
        });
      }
    } catch (error) {
      console.error("Error sending signature request:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to process signature request" 
      });
    }
  });

  // Submit signature (public endpoint)
  app.post("/api/signature-submit", async (req, res) => {
    try {
      const parsed = sharedSignatureSubmitBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid signature payload",
          errors: parsed.error.flatten(),
        });
      }
      const { signatureToken, signature, signatureType } = parsed.data;

      // Find the prospect owner by signature token
      const owner = await storage.getProspectOwnerBySignatureToken(signatureToken);
      if (!owner) {
        return res.status(404).json({ 
          success: false, 
          message: "Invalid signature token" 
        });
      }

      // Create the signature record in database. Epic F: capture IP, user-agent
      // and a SHA-256 hash of the **document being signed** — i.e. a canonical
      // serialization of the prospect's form data + owner identity at the
      // moment of signing. This anchors the signature to the actual content,
      // not just the click-to-sign payload, satisfying e-sign evidentiary req.
      const { createHash } = await import("node:crypto");
      const signedProspect = await storage.getMerchantProspect(owner.prospectId);
      const canonicalDoc = JSON.stringify({
        prospectId: owner.prospectId,
        ownerId: owner.id,
        ownerName: owner.name,
        ownerEmail: owner.email,
        ownershipPercentage: owner.ownershipPercentage,
        formData: signedProspect?.formData ?? null,
        signedAt: new Date().toISOString().slice(0, 10),
      });
      const documentHash = createHash("sha256").update(canonicalDoc).digest("hex");
      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        || req.socket?.remoteAddress || req.ip || "unknown";
      const userAgent = (req.headers["user-agent"] as string) || null;
      await storage.createProspectSignature({
        prospectId: owner.prospectId,
        ownerId: owner.id,
        signatureToken,
        signature,
        signatureType: signatureType || 'type',
        ipAddress,
        userAgent,
        documentHash,
      });

      console.log(`Signature submitted for token: ${signatureToken}`);
      console.log(`Signature type: ${signatureType}`);
      console.log(`Owner email: ${owner.email}`);

      res.json({ 
        success: true, 
        message: "Signature submitted successfully" 
      });
    } catch (error) {
      console.error("Error submitting signature:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to submit signature" 
      });
    }
  });

  // Save inline signature (for signatures created within the application)
  app.post("/api/prospects/:id/save-inline-signature", async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = sharedInlineSignatureBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid inline signature payload",
          errors: parsed.error.flatten(),
        });
      }
      const { ownerEmail, ownerName, signature, signatureType, ownershipPercentage } = parsed.data;
      const prospectId = parseInt(id);

      // First, ensure the prospect owner exists in the database
      let owner = await storage.getProspectOwnerByEmailAndProspectId(ownerEmail, prospectId);
      
      if (!owner) {
        // Create the owner record if it doesn't exist
        const ownerData = {
          prospectId,
          name: ownerName,
          email: ownerEmail,
          ownershipPercentage: String(ownershipPercentage || '0')
        };
        
        owner = await storage.createProspectOwner(ownerData);
      }

      // Generate a signature token for the inline signature
      const signatureToken = `inline_sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create the signature record in database. Epic F: capture IP, user-agent
      // and a SHA-256 hash of the **document being signed** (canonical
      // serialization of prospect form data + owner identity).
      const { createHash } = await import("node:crypto");
      const signedProspect = await storage.getMerchantProspect(prospectId);
      const canonicalDoc = JSON.stringify({
        prospectId,
        ownerId: owner.id,
        ownerName: owner.name,
        ownerEmail: owner.email,
        ownershipPercentage: owner.ownershipPercentage,
        formData: signedProspect?.formData ?? null,
        signedAt: new Date().toISOString().slice(0, 10),
      });
      const documentHash = createHash("sha256").update(canonicalDoc).digest("hex");
      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        || req.socket?.remoteAddress || req.ip || "unknown";
      const userAgent = (req.headers["user-agent"] as string) || null;
      await storage.createProspectSignature({
        prospectId,
        ownerId: owner.id,
        signatureToken,
        signature,
        signatureType,
        ipAddress,
        userAgent,
        documentHash,
      });

      console.log(`Inline signature saved for owner: ${ownerName} (${ownerEmail})`);
      console.log(`Signature type: ${signatureType}`);

      res.json({ 
        success: true, 
        message: "Inline signature saved successfully",
        signatureToken
      });
    } catch (error) {
      console.error("Error saving inline signature:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to save inline signature" 
      });
    }
  });

  // Get application context by signature token (for signature request page)
  app.get("/api/signature-request/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      // Find the prospect owner by signature token
      const owner = await storage.getProspectOwnerBySignatureToken(token);
      if (!owner) {
        return res.status(404).json({ 
          success: false, 
          message: "Invalid signature token" 
        });
      }

      // Get prospect details
      const prospect = await storage.getMerchantProspect(owner.prospectId);
      if (!prospect) {
        return res.status(404).json({ 
          success: false, 
          message: "Application not found" 
        });
      }

      // Parse form data to get company name
      let formData: any = {};
      if (prospect.formData) {
        try {
          formData = JSON.parse(prospect.formData);
        } catch (e) {
          console.error('Error parsing form data:', e);
          formData = {};
        }
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);

      res.json({ 
        success: true, 
        applicationContext: {
          companyName: formData.companyName || `${prospect.firstName} ${prospect.lastName}`,
          applicantName: `${prospect.firstName} ${prospect.lastName}`,
          applicantEmail: prospect.email,
          agentName: agent ? `${agent.firstName} ${agent.lastName}` : 'Unknown Agent',
          agentEmail: agent ? agent.email : '',
          ownerName: owner.name,
          ownerEmail: owner.email,
          ownershipPercentage: owner.ownershipPercentage,
          applicationId: prospect.id,
          status: prospect.status
        }
      });
    } catch (error) {
      console.error("Error fetching signature request context:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to fetch application context" 
      });
    }
  });

  // Get signature by token (for retrieving submitted signatures)
  app.get("/api/signature/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const signature = await storage.getProspectSignature(token);
      
      if (!signature) {
        return res.status(404).json({ 
          success: false, 
          message: "Signature not found" 
        });
      }
      
      res.json({ 
        success: true, 
        signature: {
          signature: signature.signature,
          signatureType: signature.signatureType,
          submittedAt: signature.submittedAt,
          token: signature.signatureToken
        }
      });
    } catch (error) {
      console.error("Error retrieving signature:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to retrieve signature" 
      });
    }
  });

  // Get prospect owners with their signatures
  app.get("/api/prospects/:prospectId/owners-with-signatures", async (req, res) => {
    try {
      const { prospectId } = req.params;
      const owners = await storage.getProspectOwners(parseInt(prospectId));
      const signatures = await storage.getProspectSignaturesByProspect(parseInt(prospectId));
      
      // Merge owners with their signatures
      const ownersWithSignatures = owners.map(owner => {
        const signature = signatures.find(sig => sig.ownerId === owner.id);
        return {
          name: owner.name,
          email: owner.email,
          percentage: owner.ownershipPercentage.replace('%', ''), // Remove % sign for form input
          signature: signature?.signature || null,
          signatureType: signature?.signatureType || null,
          submittedAt: signature?.submittedAt || null,
          signatureToken: owner.signatureToken,
          emailSent: owner.emailSent,
          emailSentAt: owner.emailSentAt
        };
      });
      
      res.json({ success: true, owners: ownersWithSignatures });
    } catch (error) {
      console.error("Error fetching owners with signatures:", error);
      res.status(500).json({ success: false, message: "Failed to fetch owners with signatures" });
    }
  });

  // Get signature status for a prospect (for application view)
  app.get("/api/prospects/:prospectId/signature-status", async (req, res) => {
    try {
      const { prospectId } = req.params;
      const prospect = await storage.getMerchantProspect(parseInt(prospectId));
      
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Get form data and database signatures
      let formData: any = {};
      try {
        formData = prospect.formData ? JSON.parse(prospect.formData) : {};
      } catch (e) {
        formData = {};
      }

      const dbSignatures = await storage.getProspectSignaturesByProspect(parseInt(prospectId));
      const prospectOwners = await storage.getProspectOwners(parseInt(prospectId));

      // Calculate signature status using database signatures
      const owners = formData.owners || [];
      const requiredSignatures = owners.filter((owner: any) => parseFloat(owner.percentage || 0) >= 25);
      const completedSignatures = requiredSignatures.filter((owner: any) => {
        const dbOwner = prospectOwners.find(po => po.email === owner.email);
        if (!dbOwner) return false;
        return dbSignatures.some((sig: any) => sig.ownerId === dbOwner.id);
      });

      const signatureStatus = {
        required: requiredSignatures.length,
        completed: completedSignatures.length,
        pending: requiredSignatures.length - completedSignatures.length,
        isComplete: requiredSignatures.length > 0 && completedSignatures.length === requiredSignatures.length,
        needsAttention: requiredSignatures.length > 0 && completedSignatures.length < requiredSignatures.length,
        // Include owner-level details for application view, with e-sign cert
        // evidence (Epic F): IP, user-agent, document hash, timestamp.
        ownerStatus: requiredSignatures.map((owner: any) => {
          const dbOwner = prospectOwners.find(po => po.email === owner.email);
          const sig = dbOwner ? dbSignatures.find((s: any) => s.ownerId === dbOwner.id) : null;
          return {
            name: owner.name,
            email: owner.email,
            percentage: owner.percentage,
            hasSignature: !!sig,
            cert: sig ? {
              signedAt: sig.submittedAt,
              ipAddress: sig.ipAddress ?? null,
              userAgent: sig.userAgent ?? null,
              documentHash: sig.documentHash ?? null,
              signatureType: sig.signatureType,
              recordLink: sig.recordLink ?? `/api/prospects/${prospectId}/signature-trail#owner=${dbOwner?.id ?? ''}`,
            } : null,
          };
        })
      };

      res.json(signatureStatus);
    } catch (error) {
      console.error("Error fetching signature status:", error);
      res.status(500).json({ message: "Failed to fetch signature status" });
    }
  });

  // Search signatures by email (database-backed)
  app.get("/api/signatures/by-email/:email", async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      
      const signatures = await storage.getProspectSignaturesByOwnerEmail(email);
      
      if (signatures.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "No signatures found for this email" 
        });
      }
      
      // Return the most recent signature
      const latestSignature = signatures[signatures.length - 1];

      res.json({ 
        success: true, 
        signature: {
          signature: latestSignature.signature,
          signatureType: latestSignature.signatureType,
          submittedAt: latestSignature.submittedAt,
          token: latestSignature.signatureToken
        }
      });
    } catch (error) {
      console.error("Error searching signatures by email:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to search signature" 
      });
    }
  });

  // Admin-only routes for merchants
  app.get("/api/merchants/all", requirePerm('admin:read'), async (req, res) => {
    try {
      const { search } = req.query;
      
      if (search) {
        const merchants = await storage.searchMerchants(search as string);
        res.json(merchants);
      } else {
        const merchants = await storage.getAllMerchants();
        res.json(merchants);
      }
    } catch (error) {
      console.error("Error fetching all merchants:", error);
      res.status(500).json({ message: "Failed to fetch all merchants" });
    }
  });

  app.post("/api/merchants", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    const dynamicDB = getRequestDB(req);
    try {
      // Remove userId from validation since it's auto-generated
      const { userId, ...merchantData } = req.body;
      const validation = insertMerchantSchema.omit({ userId: true }).safeParse(merchantData);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid merchant data", errors: validation.error.errors });
      }

      // Validate parent ID format up front (structured 400 instead of throwing later)
      const requestedParent = validation.data.parentMerchantId ?? null;
      if (requestedParent !== null && !Number.isInteger(requestedParent)) {
        return res.status(400).json({ message: "parentMerchantId must be an integer", code: "INVALID_PARENT_ID" });
      }

      // Single transaction: create user + merchant + closure self-row + apply parent.
      const result = await dynamicDB.transaction(async (tx) => {
        const firstName = "Merchant";
        const lastName = "User";
        const username = await generateUsername(firstName, lastName, validation.data.email, tx);
        const temporaryPassword = generateTemporaryPassword();
        const bcrypt = await import("bcrypt");
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        const [user] = await tx.insert(users).values({
          id: crypto.randomUUID(),
          email: validation.data.email,
          username,
          passwordHash,
          firstName,
          lastName,
          roles: ["merchant"],
          status: "active" as const,
          emailVerified: true,
        }).returning();

        const [merchant] = await tx.insert(merchants).values({
          ...validation.data,
          userId: user.id,
        }).returning();

        await tx.insert(merchantHierarchy).values({ ancestorId: merchant.id, descendantId: merchant.id, depth: 0 }).onConflictDoNothing();

        if (requestedParent !== null) {
          await setMerchantParent(tx, merchant.id, requestedParent);
        }
        const [persisted] = await tx.select().from(merchants).where(eq(merchants.id, merchant.id));

        return { merchant: persisted, user, temporaryPassword };
      });

      res.status(201).json({
        merchant: result.merchant,
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.user.roles?.[0] ?? null,
          temporaryPassword: result.temporaryPassword,
        },
      });
    } catch (error) {
      if (error instanceof HierarchyError) {
        return res.status(400).json({ message: error.message, code: error.code });
      }
      console.error("Error creating merchant:", error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("unique constraint")) {
        res.status(409).json({ message: "Email address already exists" });
      } else {
        res.status(500).json({ message: "Failed to create merchant" });
      }
    }
  });

  // Current agent info (for logged-in agents)
  app.get("/api/current-agent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      console.log("Current Agent API - UserId:", userId);
      
      const agent = await storage.getAgentByUserId(userId);
      if (!agent) {
        console.log("Agent not found for userId:", userId);
        return res.status(404).json({ message: "Agent not found" });
      }

      console.log("Found agent:", agent.id, agent.firstName, agent.lastName);
      res.json(agent);
    } catch (error) {
      console.error("Error fetching current agent:", error);
      res.status(500).json({ message: "Failed to fetch current agent" });
    }
  });

  // Agent routes (admin only)
  app.get("/api/agents", dbEnvironmentMiddleware, requirePerm('agent:read'), async (req: RequestWithDB, res) => {
    try {
      const p = parsePaginationOrSend(req, res);
      if (!p) return;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const result = await storage.getAgentsPaged({ ...p, search, status });
      res.json(makePage(result.items, result.total, p));
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ message: "Failed to fetch agents" });
    }
  });

  app.post("/api/agents", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    const dynamicDB = getRequestDB(req);
    console.log(`Creating agent - Database environment: ${req.dbEnv}`);
    
    // Use database transaction to ensure ACID compliance
    try {
      const result = await dynamicDB.transaction(async (tx) => {
        // Remove userId from validation since it's auto-generated
        const { userId, ...agentData } = req.body;
        const validationResult = insertAgentSchema.omit({ userId: true }).safeParse(agentData);
        if (!validationResult.success) {
          throw new Error(`Invalid agent data: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
        }

        // Create user account first within transaction
        const username = await generateUsername(validationResult.data.firstName, validationResult.data.lastName, validationResult.data.email, tx);
        const temporaryPassword = generateTemporaryPassword();
        
        // Hash the temporary password
        const bcrypt = await import('bcrypt');
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);
        
        // Create user account within transaction
        const userData = {
          id: crypto.randomUUID(),
          email: validationResult.data.email,
          username,
          passwordHash,
          firstName: validationResult.data.firstName,
          lastName: validationResult.data.lastName,
          roles: ['agent'],
          status: 'active' as const,
          emailVerified: true,
        };
        
        const [user] = await tx.insert(users).values(userData).returning();
        
        // Create agent linked to user within transaction
        const [agent] = await tx.insert(agents).values({
          ...validationResult.data,
          userId: user.id
        }).returning();

        // Self-row in closure (depth 0)
        await tx.insert(agentHierarchy).values({ ancestorId: agent.id, descendantId: agent.id, depth: 0 }).onConflictDoNothing();

        // Apply parent INSIDE the transaction so any HierarchyError rolls everything back.
        const rawParent: unknown = req.body?.parentAgentId;
        if (rawParent !== null && rawParent !== undefined && rawParent !== "") {
          const parentId = typeof rawParent === "number" ? rawParent : parseInt(String(rawParent));
          if (!Number.isInteger(parentId)) {
            throw new HierarchyError("PARENT_MISSING", "parentAgentId must be an integer");
          }
          await setAgentParent(tx, agent.id, parentId);
        }
        const [persisted] = await tx.select().from(agents).where(eq(agents.id, agent.id));

        return {
          agent: persisted,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.roles?.[0] ?? null,
            temporaryPassword // Include for admin to share with agent
          }
        };
      });
      
      console.log(`Agent created in ${req.dbEnv} database:`, result.agent.firstName, result.agent.lastName);
      res.status(201).json(result);
      
    } catch (error: any) {
      console.error("Error creating agent:", error);

      if (error instanceof HierarchyError) {
        return res.status(400).json({ message: error.message, code: error.code });
      }

      // Handle specific error types properly
      if (error.message?.includes('Invalid agent data')) {
        res.status(400).json({ message: error.message });
      } else if (error.message?.includes('unique constraint')) {
        res.status(409).json({ message: "Email address already exists" });
      } else if (error.message?.includes('column') && error.message?.includes('does not exist')) {
        res.status(500).json({ message: "Database schema error. Please ensure the database schema is up to date." });
      } else {
        res.status(500).json({ message: "Failed to create agent" });
      }
    }
  });

  // Parse a parent-change request from a body. Returns:
  //   { changed: false } when the field is absent
  //   { changed: true, value: number | null } when it is present and valid (null/empty → null)
  //   { error: { message, code } } when present but malformed
  type ParentChange =
    | { changed: false; error?: undefined }
    | { changed: true; value: number | null; error?: undefined }
    | { changed?: undefined; error: { message: string; code: string } };
  function parseParentChange(body: Record<string, unknown>, key: string): ParentChange {
    if (!(key in body)) return { changed: false };
    const raw = body[key];
    if (raw === null || raw === undefined || raw === "") return { changed: true, value: null };
    const parsed = typeof raw === "number" ? raw : parseInt(String(raw));
    if (!Number.isInteger(parsed)) {
      return { error: { message: `${key} must be an integer or null`, code: "INVALID_PARENT_ID" } };
    }
    return { changed: true, value: parsed };
  }

  // Update agent (general fields + optional parentAgentId change) — atomic
  app.put("/api/agents/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    const ALLOWED_AGENT_FIELDS = ["firstName", "lastName", "email", "phone", "territory", "commissionRate", "status", "defaultCampaignId"] as const;
    type AgentUpdate = Partial<Pick<typeof agents.$inferInsert, typeof ALLOWED_AGENT_FIELDS[number]>>;
    try {
      const id = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const allowed: AgentUpdate = {};
      for (const k of ALLOWED_AGENT_FIELDS) {
        if (k in body) (allowed as Record<string, unknown>)[k] = body[k];
      }
      // Epic D — coerce defaultCampaignId to number | null (UI may send '', 'null', or numeric string)
      if ("defaultCampaignId" in allowed) {
        const v = (allowed as Record<string, unknown>).defaultCampaignId;
        if (v === '' || v === null || v === 'null' || v === undefined) {
          (allowed as Record<string, unknown>).defaultCampaignId = null;
        } else {
          const n = Number(v);
          (allowed as Record<string, unknown>).defaultCampaignId = Number.isFinite(n) ? n : null;
        }
      }
      const agentUpdateSchema = insertAgentSchema
        .pick(Object.fromEntries(ALLOWED_AGENT_FIELDS.map(k => [k, true])) as Record<typeof ALLOWED_AGENT_FIELDS[number], true>)
        .partial();
      const parsed = agentUpdateSchema.safeParse(allowed);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid agent payload", errors: parsed.error.flatten() });
      }
      Object.assign(allowed, parsed.data);
      const parentChange = parseParentChange(body, "parentAgentId");
      if (parentChange.error) return res.status(400).json(parentChange.error);

      const updated = await dynamicDB.transaction(async (tx) => {
        if (Object.keys(allowed).length > 0) {
          await tx.update(agents).set(allowed).where(eq(agents.id, id));
        }
        if (parentChange.changed) {
          await setAgentParent(tx, id, parentChange.value);
        }
        const [row] = await tx.select().from(agents).where(eq(agents.id, id));
        return row;
      });

      if (!updated) return res.status(404).json({ message: "Agent not found" });
      res.json(updated);
    } catch (e) {
      if (e instanceof HierarchyError) return res.status(400).json({ message: e.message, code: e.code });
      console.error("Error updating agent:", e);
      res.status(500).json({ message: "Failed to update agent" });
    }
  });

  // Update merchant (general fields + optional parentMerchantId change) — atomic
  app.put("/api/merchants/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    const ALLOWED_MERCHANT_FIELDS = ["businessName", "businessType", "email", "phone", "agentId", "processingFee", "status", "monthlyVolume"] as const;
    type MerchantUpdate = Partial<Pick<typeof merchants.$inferInsert, typeof ALLOWED_MERCHANT_FIELDS[number]>>;
    try {
      const id = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const allowed: MerchantUpdate = {};
      for (const k of ALLOWED_MERCHANT_FIELDS) {
        if (k in body) (allowed as Record<string, unknown>)[k] = body[k];
      }
      const merchantUpdateSchema = insertMerchantSchema
        .pick(Object.fromEntries(ALLOWED_MERCHANT_FIELDS.map(k => [k, true])) as Record<typeof ALLOWED_MERCHANT_FIELDS[number], true>)
        .partial();
      const parsed = merchantUpdateSchema.safeParse(allowed);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid merchant payload", errors: parsed.error.flatten() });
      }
      Object.assign(allowed, parsed.data);
      const parentChange = parseParentChange(body, "parentMerchantId");
      if (parentChange.error) return res.status(400).json(parentChange.error);

      const updated = await dynamicDB.transaction(async (tx) => {
        if (Object.keys(allowed).length > 0) {
          await tx.update(merchants).set(allowed).where(eq(merchants.id, id));
        }
        if (parentChange.changed) {
          await setMerchantParent(tx, id, parentChange.value);
        }
        const [row] = await tx.select().from(merchants).where(eq(merchants.id, id));
        return row;
      });

      if (!updated) return res.status(404).json({ message: "Merchant not found" });
      res.json(updated);
    } catch (e) {
      if (e instanceof HierarchyError) return res.status(400).json({ message: e.message, code: e.code });
      console.error("Error updating merchant:", e);
      res.status(500).json({ message: "Failed to update merchant" });
    }
  });

  // Delete merchant — keeps closure tables consistent (reattach children
  // to the deleted merchant's parent, drop closure rows for this node).
  app.delete("/api/merchants/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const merchantId = parseInt(req.params.id);
      if (!Number.isInteger(merchantId)) {
        return res.status(400).json({ message: "Invalid merchant id" });
      }
      const dynamicDB = getRequestDB(req);
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const [existingMerchant] = await dynamicDB.select().from(merchants).where(eq(merchants.id, merchantId));
      if (!existingMerchant) {
        return res.status(404).json({ message: "Merchant not found" });
      }
      const result = await dynamicDB.transaction(async (tx) => {
        await detachMerchantForDelete(tx, merchantId);
        const merchantDeleteResult = await tx.delete(merchants).where(eq(merchants.id, merchantId));
        if (existingMerchant.userId) {
          await tx.delete(users).where(eq(users.id, existingMerchant.userId));
        }
        return merchantDeleteResult.rowCount || 0;
      });
      if (result > 0) {
        res.json({ success: true, message: "Merchant deleted successfully" });
      } else {
        res.status(404).json({ message: "Merchant not found" });
      }
    } catch (error) {
      console.error("Error deleting merchant:", error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("violates foreign key constraint")) {
        return res.status(409).json({ message: "Cannot delete merchant: still has related data" });
      }
      res.status(500).json({ message: "Failed to delete merchant" });
    }
  });

  // ---- Hierarchy: tree + descendants ----
  // Generic DFS-flatten that preserves the input row type and adds a `depth` field.
  function flattenHierarchy<T extends { id: number }>(
    rows: T[],
    getParentId: (row: T) => number | null,
    sortKey: (row: T) => string,
  ): (T & { depth: number })[] {
    const byParent = new Map<number | null, T[]>();
    for (const row of rows) {
      const p = getParentId(row) ?? null;
      const bucket = byParent.get(p);
      if (bucket) bucket.push(row);
      else byParent.set(p, [row]);
    }
    const out: (T & { depth: number })[] = [];
    const walk = (parent: number | null, depth: number) => {
      const children = (byParent.get(parent) ?? []).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      for (const c of children) {
        out.push({ ...c, depth });
        if (depth < MAX_HIERARCHY_DEPTH) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  app.get("/api/agents/hierarchy/tree", dbEnvironmentMiddleware, requirePerm('agent:read'), async (req: RequestWithDB, res) => {
    try {
      const dynamicDB = getRequestDB(req);
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const all = await dynamicDB.select().from(agents);
      res.json(flattenHierarchy(all, (a) => a.parentAgentId, (a) => `${a.lastName}${a.firstName}`));
    } catch (e) {
      console.error("Error building agent hierarchy:", e);
      res.status(500).json({ message: "Failed to load agent hierarchy" });
    }
  });

  app.get("/api/merchants/hierarchy/tree", dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const dynamicDB = getRequestDB(req);
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const all = await dynamicDB.select().from(merchants);
      res.json(flattenHierarchy(all, (m) => m.parentMerchantId, (m) => m.businessName));
    } catch (e) {
      console.error("Error building merchant hierarchy:", e);
      res.status(500).json({ message: "Failed to load merchant hierarchy" });
    }
  });

  app.get("/api/agents/:id/descendants", dbEnvironmentMiddleware, requirePerm('agent:read'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Invalid agent id" });
      }
      const dynamicDB = getRequestDB(req);

      // Authz: a non-admin agent can only view a subtree rooted at themselves
      // or one of their own descendants — never sibling/parent subtrees.
      const userId = req.session?.userId;
      const [caller] = userId
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        ? await dynamicDB.select({ id: users.id, roles: users.roles }).from(users).where(eq(users.id, userId))
        : [];
      const callerRole = caller?.roles?.[0];
      const isAdminLike = callerRole === 'admin' || callerRole === 'super_admin' || callerRole === 'corporate';
      if (!isAdminLike) {
        const [callerAgent] = userId
          // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
          ? await dynamicDB.select({ id: agents.id }).from(agents).where(eq(agents.userId, userId))
          : [];
        if (!callerAgent || !(await isAgentDescendantOf(dynamicDB, callerAgent.id, id))) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      const ids = await getAgentDescendantIds(dynamicDB, id);
      res.json({ agentId: id, descendantIds: ids, count: ids.length });
    } catch (e) {
      console.error("Error fetching agent descendants:", e);
      res.status(500).json({ message: "Failed to load descendants" });
    }
  });

  app.get("/api/merchants/:id/descendants", dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      const ids = await getMerchantDescendantIds(dynamicDB, id);
      res.json({ merchantId: id, descendantIds: ids, count: ids.length });
    } catch (e) {
      console.error("Error fetching merchant descendants:", e);
      res.status(500).json({ message: "Failed to load descendants" });
    }
  });

  // Delete agent
  app.delete("/api/agents/:id", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      
      console.log(`Deleting agent ${agentId} - Database environment: ${req.dbEnv}`);
      
      // First check if agent exists
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const [existingAgent] = await dynamicDB.select().from(agents).where(eq(agents.id, agentId));
      if (!existingAgent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      // Use database transaction to ensure ACID compliance
      const result = await dynamicDB.transaction(async (tx) => {
        // Hierarchy first: reattach direct children to the deleted agent's
        // parent and remove all closure rows referencing this node, so
        // descendant queries stay correct after deletion.
        await detachAgentForDelete(tx, agentId);

        // Delete agent record
        const agentDeleteResult = await tx.delete(agents).where(eq(agents.id, agentId));
        
        // Delete associated user account if it exists
        if (existingAgent.userId) {
          await tx.delete(users).where(eq(users.id, existingAgent.userId));
          console.log(`Deleted user account for agent ${agentId}: ${existingAgent.userId}`);
        }
        
        return agentDeleteResult.rowCount || 0;
      });
      
      if (result > 0) {
        console.log(`Successfully deleted agent ${agentId} in ${req.dbEnv} database`);
        res.json({ success: true, message: "Agent deleted successfully" });
      } else {
        res.status(404).json({ message: "Agent not found" });
      }
    } catch (error: any) {
      console.error("Error deleting agent:", error);
      if (error?.message?.includes('violates foreign key constraint')) {
        res.status(409).json({ 
          message: "Cannot delete agent: agent is still assigned to merchants or has related data" 
        });
      } else {
        res.status(500).json({ message: "Failed to delete agent" });
      }
    }
  });

  // Agent and Merchant User Management
  app.get("/api/agents/:id/user", dbEnvironmentMiddleware, requirePerm('admin:read'), async (req: RequestWithDB, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      console.log(`Agent user endpoint - Database environment: ${req.dbEnv}`);
      
      const user = await storage.getAgentUser(agentId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found for this agent" });
      }
      
      // Don't send password hash
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching agent user:", error);
      res.status(500).json({ message: "Failed to fetch agent user" });
    }
  });

  app.get("/api/merchants/:id/user", requirePerm('admin:read'), async (req, res) => {
    try {
      const merchantId = parseInt(req.params.id);
      const user = await storage.getMerchantUser(merchantId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found for this merchant" });
      }
      
      // Don't send password hash
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching merchant user:", error);
      res.status(500).json({ message: "Failed to fetch merchant user" });
    }
  });

  // Reset password for agent/merchant user accounts
  app.post("/api/agents/:id/reset-password", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const user = await storage.getAgentUser(agentId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found for this agent" });
      }
      
      // Generate new temporary password
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let newPassword = '';
      for (let i = 0; i < 12; i++) {
        newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Hash and update password
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      await storage.updateUser(user.id, { passwordHash });
      
      res.json({
        success: true,
        username: user.username,
        temporaryPassword: newPassword,
        message: "Password reset successfully"
      });
    } catch (error) {
      console.error("Error resetting agent password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.post("/api/merchants/:id/reset-password", isAuthenticated, dbEnvironmentMiddleware, requirePerm('admin:read'), async (req, res) => {
    try {
      const merchantId = parseInt(req.params.id);
      const user = await storage.getMerchantUser(merchantId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found for this merchant" });
      }
      
      // Generate new temporary password
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let newPassword = '';
      for (let i = 0; i < 12; i++) {
        newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Hash and update password
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      await storage.updateUser(user.id, { passwordHash });
      
      res.json({
        success: true,
        username: user.username,
        temporaryPassword: newPassword,
        message: "Password reset successfully"
      });
    } catch (error) {
      console.error("Error resetting merchant password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Transaction routes (admin only for all operations)
  app.get("/api/transactions/all", requirePerm('admin:read'), async (req, res) => {
    try {
      const { search } = req.query;
      
      if (search) {
        const transactions = await storage.searchTransactions(search as string);
        res.json(transactions);
      } else {
        const transactions = await storage.getAllTransactions();
        res.json(transactions);
      }
    } catch (error) {
      console.error("Error fetching all transactions:", error);
      res.status(500).json({ message: "Failed to fetch all transactions" });
    }
  });

  app.post("/api/transactions", requirePerm('admin:read'), markSchema('insertTransactionSchema'), async (req, res) => {
    try {
      const result = insertTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid transaction data", errors: result.error.errors });
      }

      const transaction = await storage.createTransaction(result.data);
      res.status(201).json(transaction);
    } catch (error) {
      console.error("Error creating transaction:", error);
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Analytics routes
  app.get("/api/analytics/dashboard", isAuthenticated, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/analytics/top-merchants", isAuthenticated, async (req, res) => {
    try {
      const topMerchants = await storage.getTopMerchants();
      res.json(topMerchants);
    } catch (error) {
      console.error("Error fetching top merchants:", error);
      res.status(500).json({ message: "Failed to fetch top merchants" });
    }
  });

  app.get("/api/analytics/recent-transactions", isAuthenticated, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const recentTransactions = await storage.getRecentTransactions(limit);
      res.json(recentTransactions);
    } catch (error) {
      console.error("Error fetching recent transactions:", error);
      res.status(500).json({ message: "Failed to fetch recent transactions" });
    }
  });

  // Widget preferences routes
  // Per-user key/value preferences (e.g. underwriting queue filters & sort).
  // Allows reviewer settings to follow them across browsers/devices.
  const PREFS_KEY_PATTERN = /^[a-zA-Z0-9_:.-]{1,128}$/;
  const getPrefsUserId = (req: any): string | null => {
    return req.userId
      || req.user?.id
      || req.user?.claims?.sub
      || req.session?.userId
      || null;
  };

  app.get("/api/user/prefs/:key", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getPrefsUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthenticated" });
      const key = req.params.key;
      if (!PREFS_KEY_PATTERN.test(key)) {
        return res.status(400).json({ message: "Invalid preference key" });
      }
      const value = await storage.getUserPreference(userId, key);
      if (value === undefined) return res.status(404).json({ message: "Not found" });
      res.json({ key, value });
    } catch (error) {
      console.error("Error fetching user preference:", error);
      res.status(500).json({ message: "Failed to fetch preference" });
    }
  });

  app.put("/api/user/prefs/:key", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getPrefsUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthenticated" });
      const key = req.params.key;
      if (!PREFS_KEY_PATTERN.test(key)) {
        return res.status(400).json({ message: "Invalid preference key" });
      }
      const prefsBodySchema = z.object({ value: z.unknown() });
      const parsed = prefsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Body must include a 'value' field", errors: parsed.error.flatten() });
      }
      // Cap stored value to a reasonable size to avoid abuse.
      const serialized = JSON.stringify(parsed.data.value);
      if (serialized.length > 32_000) {
        return res.status(413).json({ message: "Preference value too large" });
      }
      await storage.setUserPreference(userId, key, parsed.data.value);
      res.json({ key, value: parsed.data.value });
    } catch (error) {
      console.error("Error saving user preference:", error);
      res.status(500).json({ message: "Failed to save preference" });
    }
  });

  app.delete("/api/user/prefs/:key", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getPrefsUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthenticated" });
      const key = req.params.key;
      if (!PREFS_KEY_PATTERN.test(key)) {
        return res.status(400).json({ message: "Invalid preference key" });
      }
      const removed = await storage.deleteUserPreference(userId, key);
      res.json({ removed });
    } catch (error) {
      console.error("Error deleting user preference:", error);
      res.status(500).json({ message: "Failed to delete preference" });
    }
  });

  app.get("/api/user/widgets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const preferences = await storage.getUserWidgetPreferences(userId);
      res.json(preferences);
    } catch (error) {
      console.error("Error fetching widget preferences:", error);
      res.status(500).json({ message: "Failed to fetch widget preferences" });
    }
  });

  app.post("/api/user/widgets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parsed = widgetCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const body = parsed.data;
      const widgetData = {
        user_id: userId,
        widget_id: (body.widgetId || body.widget_id)!,
        position: body.position,
        size: body.size,
        is_visible: body.isVisible ?? body.is_visible,
        configuration: body.configuration,
      };

      const preference = await storage.createWidgetPreference(widgetData);
      res.status(201).json(preference);
    } catch (error) {
      console.error("Error creating widget preference:", error);
      res.status(500).json({ message: "Failed to create widget preference" });
    }
  });

  app.patch("/api/user/widgets/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateWidgetPreferenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const preference = await storage.updateWidgetPreference(id, parsed.data);
      if (!preference) {
        return res.status(404).json({ message: "Widget preference not found" });
      }

      res.json(preference);
    } catch (error) {
      console.error("Error updating widget preference:", error);
      res.status(500).json({ message: "Failed to update widget preference" });
    }
  });

  app.delete("/api/user/widgets/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteWidgetPreference(id);
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ message: "Widget preference not found" });
      }
    } catch (error) {
      console.error("Error deleting widget preference:", error);
      res.status(500).json({ message: "Failed to delete widget preference" });
    }
  });

  // Dashboard widget endpoints
  app.get('/api/dashboard/widgets', isAuthenticated, async (req: any, res) => {
    try {
      let userId = req.userId;
      console.log(`Main routes - Fetching widgets for userId: ${userId}`);
      
      if (!userId) {
        // Try fallback from session or dev auth
        const fallbackUserId = req.session?.userId || 'admin-prod-001';
        console.log(`Main routes - Using fallback userId for GET: ${fallbackUserId}`);
        userId = fallbackUserId;
      }
      
      const widgets = await storage.getUserWidgetPreferences(userId);
      console.log(`Main routes - Found ${widgets.length} widgets`);
      res.json(widgets);
    } catch (error) {
      console.error("Error fetching dashboard widgets:", error);
      res.status(500).json({ message: "Failed to fetch dashboard widgets" });
    }
  });

  app.post('/api/dashboard/widgets', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      console.log(`Main routes - Creating widget for userId: ${userId}, full req properties:`, Object.keys(req));
      console.log(`Main routes - req.user:`, req.user);
      console.log(`Main routes - req.session:`, req.session);

      const parsed = widgetCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const body = parsed.data;
      const widgetIdValue = body.widgetId || body.widget_id!;
      const isVisibleValue = body.isVisible ?? body.is_visible ?? true;

      if (!userId) {
        // Try fallback from session or dev auth
        const fallbackUserId = req.session?.userId || 'admin-prod-001';
        console.log(`Main routes - Using fallback userId: ${fallbackUserId}`);
        const finalUserId = fallbackUserId;
        
        const widgetData = {
          user_id: finalUserId,
          widget_id: widgetIdValue,
          position: body.position ?? 0,
          size: body.size ?? 'medium',
          is_visible: isVisibleValue,
          configuration: body.configuration ?? {}
        };

        console.log(`Main routes - Widget data with fallback:`, widgetData);
        const widget = await storage.createWidgetPreference(widgetData);
        return res.json(widget);
      }

      const widgetData = {
        user_id: userId,
        widget_id: widgetIdValue,
        position: body.position ?? 0,
        size: body.size ?? 'medium',
        is_visible: isVisibleValue,
        configuration: body.configuration ?? {}
      };
      
      console.log(`Main routes - Widget data:`, widgetData);
      const widget = await storage.createWidgetPreference(widgetData);
      res.json(widget);
    } catch (error) {
      console.error("Error creating dashboard widget:", error);
      res.status(500).json({ message: "Failed to create dashboard widget" });
    }
  });

  app.put('/api/dashboard/widgets/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateWidgetPreferenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid widget payload", errors: parsed.error.flatten() });
      }
      const widget = await storage.updateWidgetPreference(id, parsed.data);
      if (!widget) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json(widget);
    } catch (error) {
      console.error("Error updating dashboard widget:", error);
      res.status(500).json({ message: "Failed to update dashboard widget" });
    }
  });

  app.delete('/api/dashboard/widgets/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteWidgetPreference(id);
      if (!success) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting dashboard widget:", error);
      res.status(500).json({ message: "Failed to delete dashboard widget" });
    }
  });

  app.post('/api/dashboard/initialize', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create default widgets based on user role
      const defaultWidgets = getDefaultWidgetsForRole(user.role || 'merchant');
      
      for (const widget of defaultWidgets) {
        await storage.createWidgetPreference({
          user_id: userId,
          widget_id: widget.id,
          size: widget.size,
          position: widget.position,
          is_visible: true,
          configuration: widget.configuration || {}
        });
      }

      res.json({ success: true, message: "Dashboard initialized with default widgets" });
    } catch (error) {
      console.error("Error initializing dashboard:", error);
      res.status(500).json({ message: "Failed to initialize dashboard" });
    }
  });

  // Dashboard analytics endpoints
  app.get('/api/dashboard/metrics', isAuthenticated, async (req: any, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get('/api/dashboard/revenue', isAuthenticated, async (req: any, res) => {
    try {
      const timeRange = req.query.timeRange as string || 'daily';
      const revenue = await storage.getDashboardRevenue(timeRange);
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching dashboard revenue:", error);
      res.status(500).json({ message: "Failed to fetch dashboard revenue" });
    }
  });

  app.get('/api/dashboard/top-locations', isAuthenticated, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sortBy = req.query.sortBy as string || 'revenue';
      const locations = await storage.getTopLocations(limit, sortBy);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching top locations:", error);
      res.status(500).json({ message: "Failed to fetch top locations" });
    }
  });

  app.get('/api/dashboard/recent-activity', isAuthenticated, async (req: any, res) => {
    try {
      const activity = await storage.getRecentActivity();
      res.json(activity);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  app.get('/api/dashboard/assigned-merchants', isAuthenticated, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const merchants = await storage.getAssignedMerchants(limit);
      res.json(merchants);
    } catch (error) {
      console.error("Error fetching assigned merchants:", error);
      res.status(500).json({ message: "Failed to fetch assigned merchants" });
    }
  });

  app.get('/api/dashboard/system-overview', isAuthenticated, async (req: any, res) => {
    try {
      const overview = await storage.getSystemOverview();
      res.json(overview);
    } catch (error) {
      console.error("Error fetching system overview:", error);
      res.status(500).json({ message: "Failed to fetch system overview" });
    }
  });

  // Security endpoints - admin only
  app.get("/api/security/login-attempts", isAuthenticated, requirePerm("admin:manage"), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { loginAttempts } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
      console.log(`Login attempts endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const attempts = await dynamicDB.select().from(loginAttempts)
        .orderBy(desc(loginAttempts.createdAt))
        .limit(100);
      
      res.json(attempts);
    } catch (error) {
      console.error("Failed to fetch login attempts:", error);
      res.status(500).json({ message: "Failed to fetch login attempts" });
    }
  });

  // Comprehensive Audit Logs API - SOC2 Compliance
  app.get("/api/security/audit-logs", isAuthenticated, requirePerm("admin:manage"), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Audit logs endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { auditLogs } = await import("@shared/schema");
      const { desc, and, like, eq, gte, lte, sql } = await import("drizzle-orm");
      
      const {
        search,
        action,
        resource,
        riskLevel,
        userId,
        startDate,
        endDate,
        limit = 50,
        offset = 0
      } = req.query;

      let conditions = [];
      
      // Search across multiple fields
      if (search) {
        conditions.push(
          sql`(${auditLogs.userEmail} ILIKE ${`%${search}%`} OR 
               ${auditLogs.userId} ILIKE ${`%${search}%`} OR 
               ${auditLogs.action} ILIKE ${`%${search}%`} OR 
               ${auditLogs.resource} ILIKE ${`%${search}%`} OR 
               ${auditLogs.ipAddress} ILIKE ${`%${search}%`} OR 
               ${auditLogs.notes} ILIKE ${`%${search}%`})`
        );
      }
      
      // Filter by specific fields
      if (action) conditions.push(eq(auditLogs.action, action as string));
      if (resource) conditions.push(eq(auditLogs.resource, resource as string));
      if (riskLevel) conditions.push(eq(auditLogs.riskLevel, riskLevel as string));
      if (userId) conditions.push(eq(auditLogs.userId, userId as string));
      
      // Date range filtering
      if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate as string)));
      if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate as string)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const logs = await dynamicDB.select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(Number(limit))
        .offset(Number(offset));
      
      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // Security Events API
  app.get("/api/security/events", isAuthenticated, requirePerm("admin:manage"), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Security events endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { securityEvents } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const events = await dynamicDB.select()
        .from(securityEvents)
        .orderBy(desc(securityEvents.detectedAt))
        .limit(100);
      
      res.json(events);
    } catch (error) {
      console.error("Failed to fetch security events:", error);
      res.status(500).json({ message: "Failed to fetch security events" });
    }
  });

  // Audit Metrics API
  app.get("/api/security/audit-metrics", isAuthenticated, requirePerm("admin:manage"), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Audit metrics endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { auditLogs, securityEvents } = await import("@shared/schema");
      const { count, gte, eq, and } = await import("drizzle-orm");
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Get total audit logs
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const totalLogs = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(gte(auditLogs.createdAt, thirtyDaysAgo));
      
      // Get high risk actions
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const highRiskActions = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(and(
          gte(auditLogs.createdAt, thirtyDaysAgo),
          eq(auditLogs.riskLevel, 'high')
        ));
      
      // Get critical risk actions
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const criticalRiskActions = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(and(
          gte(auditLogs.createdAt, thirtyDaysAgo),
          eq(auditLogs.riskLevel, 'critical')
        ));
      
      // Get security events count
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const totalSecurityEvents = await dynamicDB.select({ count: count() }).from(securityEvents)
        .where(gte(securityEvents.createdAt, thirtyDaysAgo));
      
      res.json({
        totalLogs: totalLogs[0]?.count || 0,
        highRiskActions: (highRiskActions[0]?.count || 0) + (criticalRiskActions[0]?.count || 0),
        securityEvents: totalSecurityEvents[0]?.count || 0,
      });
    } catch (error) {
      console.error("Failed to fetch audit metrics:", error);
      res.status(500).json({ message: "Failed to fetch audit metrics" });
    }
  });

  // Audit Log Export API
  app.get("/api/security/audit-logs/export", isAuthenticated, requirePerm("admin:manage"), adminDbMiddleware, async (req: RequestWithDB, res) => {
    try {
      const db = getRequestDB(req);
      const { auditLogs } = await import("@shared/schema");
      const { desc, and, like, eq, gte, lte, sql } = await import("drizzle-orm");
      
      const {
        search,
        action,
        resource,
        riskLevel,
        userId,
        startDate,
        endDate
      } = req.query;

      let conditions = [];
      
      // Apply same filters as the main endpoint
      if (search) {
        conditions.push(
          sql`(${auditLogs.userEmail} ILIKE ${`%${search}%`} OR 
               ${auditLogs.userId} ILIKE ${`%${search}%`} OR 
               ${auditLogs.action} ILIKE ${`%${search}%`} OR 
               ${auditLogs.resource} ILIKE ${`%${search}%`} OR 
               ${auditLogs.ipAddress} ILIKE ${`%${search}%`})`
        );
      }
      
      if (action) conditions.push(eq(auditLogs.action, action as string));
      if (resource) conditions.push(eq(auditLogs.resource, resource as string));
      if (riskLevel) conditions.push(eq(auditLogs.riskLevel, riskLevel as string));
      if (userId) conditions.push(eq(auditLogs.userId, userId as string));
      if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate as string)));
      if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate as string)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      const logs = await db.select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(10000); // Maximum export limit
      
      // Generate CSV
      const headers = [
        'ID', 'User ID', 'User Email', 'Action', 'Resource', 'Resource ID',
        'IP Address', 'Risk Level', 'Status Code', 'Method', 'Endpoint',
        'Environment', 'Timestamp', 'Notes'
      ];
      
      const csvContent = [
        headers.join(','),
        ...logs.map(log => [
          log.id,
          log.userId || '',
          log.userEmail || '',
          log.action,
          log.resource,
          log.resourceId || '',
          log.ipAddress,
          log.riskLevel,
          log.statusCode || '',
          log.method || '',
          log.endpoint || '',
          log.environment || '',
          log.createdAt,
          (log.notes || '').replace(/,/g, ';')
        ].join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
      res.send(csvContent);
    } catch (error) {
      console.error("Failed to export audit logs:", error);
      res.status(500).json({ message: "Failed to export audit logs" });
    }
  });

  app.get("/api/security/metrics", isAuthenticated, requirePerm("admin:manage"), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Security metrics endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { loginAttempts } = await import("@shared/schema");
      const { count, gte, and, eq } = await import("drizzle-orm");
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Get total attempts in last 30 days
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const totalAttempts = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(gte(loginAttempts.createdAt, thirtyDaysAgo));

      // Get successful logins in last 30 days
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const successfulLogins = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(and(
          gte(loginAttempts.createdAt, thirtyDaysAgo),
          eq(loginAttempts.success, true)
        ));

      // Get failed logins in last 30 days
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const failedLogins = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(and(
          gte(loginAttempts.createdAt, thirtyDaysAgo),
          eq(loginAttempts.success, false)
        ));

      // Get unique IPs in last 30 days
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const uniqueIPs = await dynamicDB.selectDistinct({ ipAddress: loginAttempts.ipAddress })
        .from(loginAttempts)
        .where(gte(loginAttempts.createdAt, thirtyDaysAgo));

      // Get recent failed attempts (last 24 hours)
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      const recentFailedAttempts = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(and(
          gte(loginAttempts.createdAt, twentyFourHoursAgo),
          eq(loginAttempts.success, false)
        ));

      res.json({
        totalLoginAttempts: totalAttempts[0]?.count || 0,
        successfulLogins: successfulLogins[0]?.count || 0,
        failedLogins: failedLogins[0]?.count || 0,
        uniqueIPs: uniqueIPs.length || 0,
        recentFailedAttempts: recentFailedAttempts[0]?.count || 0
      });
    } catch (error) {
      console.error("Failed to fetch security metrics:", error);
      res.status(500).json({ message: "Failed to fetch security metrics" });
    }
  });

  // PDF Form Upload and Processing Routes (admin only)
  app.post("/api/pdf-forms/upload", isAuthenticated, requirePerm('admin:manage'), upload.single('pdf'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No PDF file uploaded" });
      }

      const { originalname } = req.file;
      const buffer = req.file.buffer;
      
      // Parse the PDF to extract form structure
      const parseResult = await pdfFormParser.parsePDF(buffer);
      
      // Create the PDF form record
      const formData = {
        name: originalname.replace('.pdf', ''),
        fileName: originalname,
        fileSize: buffer.length,
        uploadedBy: req.user.id,
        description: `Merchant Application Form - ${originalname}`
      };

      const pdfForm = await storage.createPdfForm(formData);
      
      // Create form fields from parsed data — single batch insert instead of
      // one round trip per field (typical PDFs have 100+ fields).
      const fieldData = pdfFormParser.convertToDbFields(parseResult.sections, pdfForm.id);
      if (fieldData.length > 0) {
        const dynamicDB = getRequestDB(req as RequestWithDB);
        // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
        await dynamicDB.insert(pdfFormFields).values(fieldData);
      }
      
      // Return the complete form with fields
      const formWithFields = await storage.getPdfFormWithFields(pdfForm.id);
      
      res.status(201).json({
        form: formWithFields,
        sections: parseResult.sections,
        totalFields: parseResult.totalFields
      });
    } catch (error: any) {
      console.error("Error uploading PDF form:", error);
      res.status(500).json({ message: "Failed to process PDF form", error: error?.message || 'Unknown error' });
    }
  });

  // Get all PDF forms (admin only)
  app.get("/api/pdf-forms", isAuthenticated, requirePerm('admin:manage'), async (req: any, res) => {
    try {
      const forms = await storage.getAllPdfForms();
      res.json(forms);
    } catch (error) {
      console.error("Error fetching PDF forms:", error);
      res.status(500).json({ message: "Failed to fetch PDF forms" });
    }
  });

  // Get specific PDF form with fields (admin only)
  app.get("/api/pdf-forms/:id", isAuthenticated, requirePerm('admin:manage'), async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const form = await storage.getPdfFormWithFields(formId);
      
      if (!form) {
        return res.status(404).json({ message: "PDF form not found" });
      }
      
      res.json(form);
    } catch (error) {
      console.error("Error fetching PDF form:", error);
      res.status(500).json({ message: "Failed to fetch PDF form" });
    }
  });

  // Get specific PDF form with fields (wizard endpoint)
  app.get("/api/pdf-forms/:id/with-fields", isAuthenticated, async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const form = await storage.getPdfFormWithFields(formId);
      
      if (!form) {
        return res.status(404).json({ message: "PDF form not found" });
      }
      
      res.json(form);
    } catch (error) {
      console.error("Error fetching PDF form with fields:", error);
      res.status(500).json({ message: "Failed to fetch PDF form with fields" });
    }
  });

  // Update PDF form metadata (admin only)
  app.patch("/api/pdf-forms/:id", isAuthenticated, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const formId = parseInt(req.params.id);
      const parsed = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        showInNavigation: z.boolean().optional(),
        navigationTitle: z.string().optional(),
        allowedRoles: z.array(z.string()).optional(),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid PDF form payload", errors: parsed.error.flatten() });
      }
      const updateData = parsed.data;
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No update data provided" });
      }

      const updatedForm = await storage.updatePdfForm(formId, updateData);
      
      if (!updatedForm) {
        return res.status(404).json({ message: "PDF form not found" });
      }
      
      res.json(updatedForm);
    } catch (error) {
      console.error("Error updating PDF form:", error);
      res.status(500).json({ message: "Failed to update PDF form" });
    }
  });

  // Handle form submissions (auto-save and final submit)
  app.post("/api/pdf-forms/:id/submissions", isAuthenticated, async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const bodySchema = z.object({
        data: z.union([z.string(), z.record(z.any())]).optional(),
        status: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid form submission payload", errors: parsed.error.flatten() });
      }
      const { data, status = 'draft' } = parsed.data;

      const submissionData = {
        formId,
        submittedBy: req.user?.id || null,
        data: typeof data === 'string' ? data : JSON.stringify(data ?? {}),
        status,
        submissionToken: storage.generateSubmissionToken(),
        isPublic: false
      };
      
      const submission = await storage.createPdfFormSubmission(submissionData);
      res.status(201).json(submission);
    } catch (error) {
      console.error("Error creating form submission:", error);
      res.status(500).json({ message: "Failed to save form submission" });
    }
  });

  // Submit PDF form data (auto-save functionality)
  app.post("/api/pdf-forms/:id/submit", isAuthenticated, async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const bodySchema = z.object({
        formData: z.union([z.string(), z.record(z.any())]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid form submission payload", errors: parsed.error.flatten() });
      }
      const { formData } = parsed.data;

      const submissionData = {
        formId,
        submittedBy: req.user?.id || null,
        data: typeof formData === 'string' ? formData : JSON.stringify(formData ?? {}),
        submissionToken: storage.generateSubmissionToken(),
        status: 'submitted',
        isPublic: false
      };
      
      const submission = await storage.createPdfFormSubmission(submissionData);
      res.status(201).json(submission);
    } catch (error) {
      console.error("Error submitting PDF form:", error);
      res.status(500).json({ message: "Failed to submit PDF form" });
    }
  });

  // Get form submissions
  app.get("/api/pdf-forms/:id/submissions", isAuthenticated, async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const submissions = await storage.getPdfFormSubmissions(formId);
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching form submissions:", error);
      res.status(500).json({ message: "Failed to fetch form submissions" });
    }
  });

  // Create a new public form submission and return the unique token
  app.post("/api/pdf-forms/:id/create-submission", async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const bodySchema = z.object({
        applicantEmail: z.string().email().optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid submission payload", errors: parsed.error.flatten() });
      }
      const { applicantEmail } = parsed.data;

      // Create a new submission with unique token for public access
      const submissionData = {
        formId,
        submittedBy: null, // Public submission, no authenticated user
        applicantEmail,
        data: JSON.stringify({}), // Empty initial data
        status: 'draft',
        isPublic: true,
        submissionToken: storage.generateSubmissionToken()
      };
      
      const submission = await storage.createPdfFormSubmission(submissionData);
      res.status(201).json({ 
        submissionToken: submission.submissionToken,
        submissionId: submission.id 
      });
    } catch (error) {
      console.error("Error creating public form submission:", error);
      res.status(500).json({ message: "Failed to create form submission" });
    }
  });

  // Get public form submission by token (no authentication required)
  app.get("/api/submissions/:token", async (req: any, res) => {
    try {
      const { token } = req.params;
      const submission = await storage.getPdfFormSubmissionByToken(token);
      
      if (!submission) {
        return res.status(404).json({ message: "Form submission not found" });
      }
      
      // Also get the form details
      const form = await storage.getPdfForm(submission.formId);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      res.json({
        submission,
        form
      });
    } catch (error) {
      console.error("Error fetching public form submission:", error);
      res.status(500).json({ message: "Failed to fetch form submission" });
    }
  });

  // Update public form submission by token (no authentication required)
  app.put("/api/submissions/:token", async (req: any, res) => {
    try {
      const { token } = req.params;
      const parsed = updateSubmissionByTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid submission payload", errors: parsed.error.flatten() });
      }
      const { data, status = 'draft' } = parsed.data;

      const updateData = {
        data: typeof data === 'string' ? data : JSON.stringify(data),
        status,
        updatedAt: new Date()
      };
      
      const submission = await storage.updatePdfFormSubmissionByToken(token, updateData);
      
      if (!submission) {
        return res.status(404).json({ message: "Form submission not found" });
      }
      
      res.json(submission);
    } catch (error) {
      console.error("Error updating public form submission:", error);
      res.status(500).json({ message: "Failed to update form submission" });
    }
  });

  // Send email with submission link
  app.post("/api/pdf-forms/:id/send-submission-link", isAuthenticated, async (req: any, res) => {
    try {
      const formId = parseInt(req.params.id);
      const bodySchema = z.object({
        applicantEmail: z.string().email(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid submission link payload", errors: parsed.error.flatten() });
      }
      const { applicantEmail } = parsed.data;
      
      // Get form details
      const form = await storage.getPdfForm(formId);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      // Create new submission
      const submissionData = {
        formId,
        submittedBy: null,
        applicantEmail,
        data: JSON.stringify({}),
        status: 'draft',
        isPublic: true,
        submissionToken: storage.generateSubmissionToken()
      };
      
      const submission = await storage.createPdfFormSubmission(submissionData);
      
      // Generate the submission URL
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? `https://${process.env.REPLIT_DOMAIN || 'localhost:5000'}` 
        : 'http://localhost:5000';
      const submissionUrl = `${baseUrl}/form/${submission.submissionToken}`;
      
      // Send email (using placeholder for now - will implement with SendGrid)
      console.log(`Email would be sent to: ${applicantEmail}`);
      console.log(`Subject: Complete your ${form.name}`);
      console.log(`Link: ${submissionUrl}`);
      
      res.json({ 
        success: true, 
        submissionToken: submission.submissionToken,
        submissionUrl,
        message: `Submission link created for ${applicantEmail}` 
      });
    } catch (error) {
      console.error("Error sending submission link:", error);
      res.status(500).json({ message: "Failed to send submission link" });
    }
  });



  // Campaign Management API endpoints

  // Fee Groups endpoints
  app.get('/api/fee-groups', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      console.log(`Fetching fee groups - Database environment: ${req.dbEnv}`);
      // Use the dynamic database connection instead of the default storage
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }
      
      // Import the schema tables
      const { feeGroups, feeItems, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get all fee groups first
      const groups = await dbToUse.select().from(feeGroups).orderBy(feeGroups.displayOrder);
      
      // For each group, fetch its associated fee items through the junction table
      const result = await Promise.all(groups.map(async (group) => {
        const items = await dbToUse
          .select({ 
            id: feeItems.id,
            name: feeItems.name,
            description: feeItems.description,
            valueType: feeItems.valueType,
            defaultValue: feeItems.defaultValue,
            additionalInfo: feeItems.additionalInfo,
            displayOrder: feeItems.displayOrder,
            isActive: feeItems.isActive,
            author: feeItems.author,
            createdAt: feeItems.createdAt,
            updatedAt: feeItems.updatedAt
          })
          .from(feeItems)
          .innerJoin(feeGroupFeeItems, eq(feeItems.id, feeGroupFeeItems.feeItemId))
          .where(eq(feeGroupFeeItems.feeGroupId, group.id))
          .orderBy(feeGroupFeeItems.displayOrder);
        return { ...group, feeItems: items };
      }));
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching fee groups:", error);
      res.status(500).json({ message: "Failed to fetch fee groups" });
    }
  });

  app.get('/api/fee-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      console.log(`Fetching fee group ${req.params.id} - Database environment: ${req.dbEnv}`);
      const id = parseInt(req.params.id);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }
      
      const { feeGroups, feeItems, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [feeGroup] = await dbToUse.select().from(feeGroups).where(eq(feeGroups.id, id));
      
      if (!feeGroup) {
        return res.status(404).json({ message: "Fee group not found" });
      }
      
      // Get associated fee items through the junction table
      const items = await dbToUse
        .select({ 
          id: feeItems.id,
          name: feeItems.name,
          description: feeItems.description,
          valueType: feeItems.valueType,
          defaultValue: feeItems.defaultValue,
          additionalInfo: feeItems.additionalInfo,
          displayOrder: feeItems.displayOrder,
          isActive: feeItems.isActive,
          author: feeItems.author,
          createdAt: feeItems.createdAt,
          updatedAt: feeItems.updatedAt
        })
        .from(feeItems)
        .innerJoin(feeGroupFeeItems, eq(feeItems.id, feeGroupFeeItems.feeItemId))
        .where(eq(feeGroupFeeItems.feeGroupId, id))
        .orderBy(feeGroupFeeItems.displayOrder);
      const result = { ...feeGroup, feeItems: items };
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching fee group:", error);
      res.status(500).json({ message: "Failed to fetch fee group" });
    }
  });

  app.post('/api/fee-groups', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const bodySchema = z.object({
        name: z.string().min(1, "Fee group name is required"),
        description: z.string().nullable().optional(),
        displayOrder: z.union([z.number(), z.string()]).optional(),
        feeItemIds: z.array(z.number().int().positive()).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid fee group payload", errors: parsed.error.flatten() });
      }
      const { name, description, displayOrder, feeItemIds } = parsed.data;

      const feeGroupData: InsertFeeGroup = {
        name: String(name),
        description: description ? String(description) : null,
        displayOrder: Number(displayOrder) || 0,
        author: String(req.user?.email || 'System')
      };

      console.log(`Creating fee group - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }
      
      const { feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const [feeGroup] = await dbToUse.insert(feeGroups).values(feeGroupData).returning();

      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      if (feeItemIds && feeItemIds.length > 0) {
        await dbToUse.insert(feeGroupFeeItems).values(
          feeItemIds.map((feeItemId, idx) => ({
            feeGroupId: feeGroup.id,
            feeItemId,
            displayOrder: idx,
          }))
        );
      }

      res.status(201).json(feeGroup);
    } catch (error: any) {
      console.error("Error creating fee group:", error);
      
      // Handle duplicate name constraint violation
      if (error.code === '23505' && error.constraint === 'fee_groups_name_key') {
        return res.status(400).json({ 
          message: "A fee group with this name already exists. Please choose a different name." 
        });
      }
      
      res.status(500).json({ message: "Failed to create fee group" });
    }
  });

  // Update fee group
  app.put('/api/fee-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertFeeGroupSchema } = await import("@shared/schema");
      const updateBodySchema = insertFeeGroupSchema.partial().extend({
        feeItemIds: z.array(z.number().int().positive()).optional(),
      });
      const parsed = updateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid fee group payload", errors: parsed.error.flatten() });
      }
      const id = parseInt(req.params.id);
      const { name, description, displayOrder, feeItemIds } = parsed.data;
      console.log(`Updating fee group ${id} - Database environment: ${req.dbEnv}`);

      if (!name) {
        return res.status(400).json({ message: "Fee group name is required" });
      }

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }

      const updateData = {
        name,
        description: description || null,
        displayOrder: displayOrder || 0,
        author: String(req.user?.email || 'System'),
        updatedAt: new Date()
      };

      const { feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const [updatedFeeGroup] = await dbToUse.update(feeGroups)
        .set(updateData)
        .where(eq(feeGroups.id, id))
        .returning();
      
      if (!updatedFeeGroup) {
        return res.status(404).json({ message: "Fee group not found" });
      }

      // If caller provided a fee-item membership list, replace it wholesale.
      // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
      if (feeItemIds !== undefined) {
        await dbToUse.delete(feeGroupFeeItems).where(eq(feeGroupFeeItems.feeGroupId, id));
        if (feeItemIds.length > 0) {
          await dbToUse.insert(feeGroupFeeItems).values(
            feeItemIds.map((feeItemId, idx) => ({
              feeGroupId: id,
              feeItemId,
              displayOrder: idx,
            }))
          );
        }
      }

      res.json(updatedFeeGroup);
    } catch (error: any) {
      console.error("Error updating fee group:", error);
      
      // Handle duplicate name constraint violation
      if (error.code === '23505' && error.constraint === 'fee_groups_name_key') {
        return res.status(400).json({ 
          message: "A fee group with this name already exists. Please choose a different name." 
        });
      }
      
      res.status(500).json({ message: "Failed to update fee group" });
    }
  });

  // Delete fee group - with validation to prevent deletion if fee items are associated
  app.delete('/api/fee-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log(`Deleting fee group ${id} - Database environment: ${req.dbEnv}`);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid fee group ID" });
      }

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }

      const { feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // First check if fee group exists
      const existingFeeGroup = await dbToUse.select().from(feeGroups).where(eq(feeGroups.id, id));
      if (existingFeeGroup.length === 0) {
        return res.status(404).json({ message: "Fee group not found" });
      }
      
      // Check if there are any fee items associated with this fee group
      const associatedFeeItems = await dbToUse.select()
        .from(feeGroupFeeItems)
        .where(eq(feeGroupFeeItems.feeGroupId, id));
      
      if (associatedFeeItems.length > 0) {
        return res.status(400).json({ 
          message: `Cannot delete fee group "${existingFeeGroup[0].name}" because it has ${associatedFeeItems.length} associated fee item(s). Please remove all fee items from this group first.` 
        });
      }
      
      // Safe to delete - no associated fee items
      const [deletedFeeGroup] = await dbToUse.delete(feeGroups)
        .where(eq(feeGroups.id, id))
        .returning();
      
      if (!deletedFeeGroup) {
        return res.status(404).json({ message: "Fee group not found" });
      }
      
      console.log(`Successfully deleted fee group: ${deletedFeeGroup.name}`);
      res.json({ message: `Fee group "${deletedFeeGroup.name}" has been successfully deleted.`, deletedFeeGroup });
    } catch (error: any) {
      console.error("Error deleting fee group:", error);
      res.status(500).json({ message: "Failed to delete fee group" });
    }
  });

  // Fee Item Groups endpoints
  app.get('/api/fee-item-groups', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const feeGroupId = req.query.feeGroupId;
      
      if (feeGroupId) {
        const feeItemGroups = await storage.getFeeItemGroupsByFeeGroup(parseInt(String(feeGroupId)));
        res.json(feeItemGroups);
      } else {
        const feeItemGroups = await storage.getAllFeeItemGroups();
        res.json(feeItemGroups);
      }
    } catch (error) {
      console.error("Error fetching fee item groups:", error);
      res.status(500).json({ message: "Failed to fetch fee item groups" });
    }
  });

  app.get('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const feeItemGroup = await storage.getFeeItemGroupWithItems(id);
      
      if (!feeItemGroup) {
        return res.status(404).json({ message: "Fee item group not found" });
      }
      
      res.json(feeItemGroup);
    } catch (error) {
      console.error("Error fetching fee item group:", error);
      res.status(500).json({ message: "Failed to fetch fee item group" });
    }
  });

  app.post('/api/fee-item-groups', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const bodySchema = z.object({
        feeGroupId: z.union([z.number(), z.string()]),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        displayOrder: z.union([z.number(), z.string()]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid fee item group payload", errors: parsed.error.flatten() });
      }
      const { feeGroupId, name, description, displayOrder } = parsed.data;

      const feeItemGroupData: InsertFeeItemGroup = {
        feeGroupId: Number(feeGroupId),
        name: String(name),
        description: description ? String(description) : null,
        displayOrder: Number(displayOrder) || 0,
        author: String(req.user?.email || 'System')
      };

      const feeItemGroup = await storage.createFeeItemGroup(feeItemGroupData);
      res.status(201).json(feeItemGroup);
    } catch (error) {
      console.error("Error creating fee item group:", error);
      res.status(500).json({ message: "Failed to create fee item group" });
    }
  });

  app.put('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertFeeItemGroupSchema } = await import("@shared/schema");
      const parsed = insertFeeItemGroupSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid fee item group payload", errors: parsed.error.flatten() });
      }
      const id = parseInt(req.params.id);
      const { name, description, displayOrder } = parsed.data;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
      
      const feeItemGroup = await storage.updateFeeItemGroup(id, updateData);
      
      if (!feeItemGroup) {
        return res.status(404).json({ message: "Fee item group not found" });
      }
      
      res.json(feeItemGroup);
    } catch (error) {
      console.error("Error updating fee item group:", error);
      res.status(500).json({ message: "Failed to update fee item group" });
    }
  });

  app.delete('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteFeeItemGroup(id);
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ message: "Fee item group not found" });
      }
    } catch (error) {
      console.error("Error deleting fee item group:", error);
      res.status(500).json({ message: "Failed to delete fee item group" });
    }
  });

  // Campaign Management API endpoints
  
  // Campaigns
  app.get('/api/campaigns', dbEnvironmentMiddleware, requirePerm('agent:read'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching campaigns - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { campaigns, pricingTypes } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Fetch campaigns with pricingType joined
      const rows = await dbToUse.select({
        id: campaigns.id,
        name: campaigns.name,
        description: campaigns.description,
        acquirer: campaigns.acquirer,
        pricingTypeId: campaigns.pricingTypeId,
        currency: campaigns.currency,
        isActive: campaigns.isActive,
        isDefault: campaigns.isDefault,
        createdBy: campaigns.createdBy,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        pricingTypeName: pricingTypes.name,
      })
      .from(campaigns)
      .leftJoin(pricingTypes, eqOp(campaigns.pricingTypeId, pricingTypes.id));

      const result = rows.map(row => ({
        ...row,
        pricingType: row.pricingTypeId
          ? { id: row.pricingTypeId, name: row.pricingTypeName || 'Unknown' }
          : null,
      }));
      
      console.log(`Found ${result.length} campaigns in ${req.dbEnv} database`);
      res.json(result);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  app.post('/api/campaigns', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const parsed = sharedCampaignCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid campaign payload", details: parsed.error.flatten() });
      }
      const { feeValues, equipmentIds, templateId, ...campaignDataRaw } = parsed.data;
      const dbToUse = getRequestDB(req);
      const session = req.session;
      const userId = session?.userId;

      // Strip caller-supplied createdBy; server is the source of truth for actor identity.
      const { createdBy: _ignoredCreatedBy, ...campaignData } = campaignDataRaw;

      const { campaigns: campaignsTable, campaignApplicationTemplates: catTable } = await import('@shared/schema');

      // Insert the campaign row
      const [created] = await dbToUse
        .insert(campaignsTable)
        .values({ ...campaignData, createdBy: userId ?? null })
        .returning();

      // Insert fee values
      if (feeValues && Object.keys(feeValues).length > 0) {
        const { campaignFeeValues } = await import('@shared/schema');
        const feeValueRows = Object.entries(feeValues).map(([feeItemId, value]) => ({
          campaignId: created.id,
          feeItemId: parseInt(feeItemId),
          value: String(value),
          valueType: 'percentage' as const,
        }));
        await dbToUse.insert(campaignFeeValues).values(feeValueRows).onConflictDoNothing();
      }

      // Insert equipment associations
      if (equipmentIds && equipmentIds.length > 0) {
        const { campaignEquipment } = await import('@shared/schema');
        const equipRows = (equipmentIds as number[]).map((eqId: number, idx: number) => ({
          campaignId: created.id,
          equipmentItemId: eqId,
          isRequired: false,
          displayOrder: idx,
        }));
        await dbToUse.insert(campaignEquipment).values(equipRows).onConflictDoNothing();
      }

      // Insert application template association
      if (templateId) {
        await dbToUse
          .insert(catTable)
          .values({ campaignId: created.id, templateId: parseInt(String(templateId)), isPrimary: true, displayOrder: 0 })
          .onConflictDoNothing();
      }

      res.status(201).json(created);
    } catch (error) {
      console.error('Error creating campaign:', error);
      res.status(500).json({ error: 'Failed to create campaign' });
    }
  });

  // Epic D — public-safe campaign prefill (used by ?campaignId= deep link on /merchant-application)
  // Returns minimal, non-sensitive fields needed to render a campaign banner on the public MPA page.
  app.get('/api/public/campaigns/:id/prefill', dbEnvironmentMiddleware, async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
      const dbToUse = getRequestDB(req);
      const {
        campaigns: campaignsTable,
        pricingTypes: pricingTypesTable,
        campaignEquipment: campaignEquipmentTable,
        equipmentItems,
      } = await import('@shared/schema');
      const { eq: eqOp, and: andOp } = await import('drizzle-orm');

      const rows = await dbToUse
        .select({
          id: campaignsTable.id,
          name: campaignsTable.name,
          acquirer: campaignsTable.acquirer,
          currency: campaignsTable.currency,
          isActive: campaignsTable.isActive,
          pricingTypeName: pricingTypesTable.name,
        })
        .from(campaignsTable)
        .leftJoin(pricingTypesTable, eqOp(campaignsTable.pricingTypeId, pricingTypesTable.id))
        .where(andOp(eqOp(campaignsTable.id, id), eqOp(campaignsTable.isActive, true)));

      if (!rows.length) return res.status(404).json({ error: 'Campaign not found or inactive' });

      const equip = await dbToUse
        .select({ id: equipmentItems.id, name: equipmentItems.name, isRequired: campaignEquipmentTable.isRequired })
        .from(campaignEquipmentTable)
        .innerJoin(equipmentItems, eqOp(campaignEquipmentTable.equipmentItemId, equipmentItems.id))
        .where(eqOp(campaignEquipmentTable.campaignId, id));

      res.json({
        id: rows[0].id,
        name: rows[0].name,
        acquirer: rows[0].acquirer,
        currency: rows[0].currency,
        pricingType: rows[0].pricingTypeName || null,
        equipment: equip,
      });
    } catch (err) {
      console.error('public campaign prefill error:', err);
      res.status(500).json({ error: 'Failed to load campaign' });
    }
  });

  app.get('/api/campaigns/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const dbToUse = getRequestDB(req);
      const {
        campaigns: campaignsTable,
        pricingTypes: pricingTypesTable,
        campaignFeeValues,
        feeItems,
        feeGroups,
        campaignEquipment: campaignEquipmentTable,
        equipmentItems,
      } = await import('@shared/schema');
      const { eq: eqOp } = await import('drizzle-orm');

      // 1. Campaign row (flat column selects — avoids SQL gen issues with nested table selects)
      const campaignRows = await dbToUse
        .select({
          id: campaignsTable.id,
          name: campaignsTable.name,
          description: campaignsTable.description,
          acquirer: campaignsTable.acquirer,
          pricingTypeId: campaignsTable.pricingTypeId,
          currency: campaignsTable.currency,
          isActive: campaignsTable.isActive,
          isDefault: campaignsTable.isDefault,
          createdBy: campaignsTable.createdBy,
          createdAt: campaignsTable.createdAt,
          updatedAt: campaignsTable.updatedAt,
          pricingTypeName: pricingTypesTable.name,
        })
        .from(campaignsTable)
        .leftJoin(pricingTypesTable, eqOp(campaignsTable.pricingTypeId, pricingTypesTable.id))
        .where(eqOp(campaignsTable.id, id));

      if (!campaignRows.length) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const row = campaignRows[0];
      const campaign = {
        id: row.id,
        name: row.name,
        description: row.description,
        acquirer: row.acquirer,
        pricingTypeId: row.pricingTypeId,
        currency: row.currency,
        isActive: row.isActive,
        isDefault: row.isDefault,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        pricingType: row.pricingTypeId ? { id: row.pricingTypeId, name: row.pricingTypeName || 'Unknown' } : null,
      };

      // 2. Fee values with flat selects (join only to feeItems — feeGroupId is not on feeItems directly)
      const feeValueRows = await dbToUse
        .select({
          fvId: campaignFeeValues.id,
          fvCampaignId: campaignFeeValues.campaignId,
          fvFeeItemId: campaignFeeValues.feeItemId,
          fvValue: campaignFeeValues.value,
          fvValueType: campaignFeeValues.valueType,
          fvCreatedAt: campaignFeeValues.createdAt,
          fvUpdatedAt: campaignFeeValues.updatedAt,
          fiId: feeItems.id,
          fiName: feeItems.name,
          fiValueType: feeItems.valueType,
          fiDisplayOrder: feeItems.displayOrder,
        })
        .from(campaignFeeValues)
        .leftJoin(feeItems, eqOp(campaignFeeValues.feeItemId, feeItems.id))
        .where(eqOp(campaignFeeValues.campaignId, id));

      const feeValues = feeValueRows.map(r => ({
        id: r.fvId,
        campaignId: r.fvCampaignId,
        feeItemId: r.fvFeeItemId,
        value: r.fvValue,
        valueType: r.fvValueType,
        createdAt: r.fvCreatedAt,
        updatedAt: r.fvUpdatedAt,
        feeItem: r.fiId ? {
          id: r.fiId,
          name: r.fiName,
          valueType: r.fiValueType,
          displayOrder: r.fiDisplayOrder,
        } : undefined,
      }));

      // 3. Equipment with flat selects
      const equipmentRows = await dbToUse
        .select({
          ceId: campaignEquipmentTable.id,
          ceCampaignId: campaignEquipmentTable.campaignId,
          ceEquipmentItemId: campaignEquipmentTable.equipmentItemId,
          ceIsRequired: campaignEquipmentTable.isRequired,
          ceDisplayOrder: campaignEquipmentTable.displayOrder,
          eiId: equipmentItems.id,
          eiName: equipmentItems.name,
          eiDescription: equipmentItems.description,
          eiCategory: equipmentItems.category,
          eiManufacturer: equipmentItems.manufacturer,
        })
        .from(campaignEquipmentTable)
        .innerJoin(equipmentItems, eqOp(campaignEquipmentTable.equipmentItemId, equipmentItems.id))
        .where(eqOp(campaignEquipmentTable.campaignId, id));

      const equipment = equipmentRows.map(r => ({
        id: r.ceId,
        campaignId: r.ceCampaignId,
        equipmentItemId: r.ceEquipmentItemId,
        isRequired: r.ceIsRequired,
        displayOrder: r.ceDisplayOrder,
        equipmentItem: {
          id: r.eiId,
          name: r.eiName,
          description: r.eiDescription,
          category: r.eiCategory,
          manufacturer: r.eiManufacturer,
        },
      }));

      // 4. Associated application templates (campaignApplicationTemplates → acquirerApplicationTemplates → acquirers)
      const {
        campaignApplicationTemplates: campaignAppTemplatesTable,
        acquirerApplicationTemplates: acquirerAppTemplatesTable,
        acquirers: acquirersTable,
      } = await import('@shared/schema');

      const templateRows = await dbToUse
        .select({
          catId: campaignAppTemplatesTable.id,
          catIsPrimary: campaignAppTemplatesTable.isPrimary,
          catDisplayOrder: campaignAppTemplatesTable.displayOrder,
          aatId: acquirerAppTemplatesTable.id,
          aatTemplateName: acquirerAppTemplatesTable.templateName,
          aatVersion: acquirerAppTemplatesTable.version,
          aatIsActive: acquirerAppTemplatesTable.isActive,
          acqId: acquirersTable.id,
          acqName: acquirersTable.name,
          acqDisplayName: acquirersTable.displayName,
          acqCode: acquirersTable.code,
        })
        .from(campaignAppTemplatesTable)
        .leftJoin(acquirerAppTemplatesTable, eqOp(campaignAppTemplatesTable.templateId, acquirerAppTemplatesTable.id))
        .leftJoin(acquirersTable, eqOp(acquirerAppTemplatesTable.acquirerId, acquirersTable.id))
        .where(eqOp(campaignAppTemplatesTable.campaignId, id));

      const applicationTemplates = templateRows.map(r => ({
        id: r.catId,
        isPrimary: r.catIsPrimary,
        displayOrder: r.catDisplayOrder,
        template: r.aatId ? {
          id: r.aatId,
          templateName: r.aatTemplateName,
          version: r.aatVersion,
          isActive: r.aatIsActive,
        } : null,
        acquirer: r.acqId ? {
          id: r.acqId,
          name: r.acqName,
          displayName: r.acqDisplayName,
          code: r.acqCode,
        } : null,
      }));

      // 5. Application status counts via campaignAssignments → prospectApplications
      const {
        campaignAssignments: campaignAssignmentsTable,
        prospectApplications: prospectApplicationsTable,
      } = await import('@shared/schema');

      const assignmentRows = await dbToUse
        .select({
          caProspectId: campaignAssignmentsTable.prospectId,
          caIsActive: campaignAssignmentsTable.isActive,
        })
        .from(campaignAssignmentsTable)
        .where(eqOp(campaignAssignmentsTable.campaignId, id));

      const totalAssigned = assignmentRows.length;
      const activeAssigned = assignmentRows.filter(r => r.caIsActive).length;

      const prospectIds = assignmentRows
        .filter(r => r.caProspectId !== null)
        .map(r => r.caProspectId as number);

      let applicationStats: Record<string, number> = {};
      let totalApplications = 0;

      if (prospectIds.length > 0) {
        const { inArray } = await import('drizzle-orm');
        const appRows = await dbToUse
          .select({
            paStatus: prospectApplicationsTable.status,
            paProspectId: prospectApplicationsTable.prospectId,
          })
          .from(prospectApplicationsTable)
          .where(inArray(prospectApplicationsTable.prospectId, prospectIds));

        totalApplications = appRows.length;
        for (const row of appRows) {
          applicationStats[row.paStatus] = (applicationStats[row.paStatus] || 0) + 1;
        }
      }

      res.json({
        ...campaign,
        feeValues,
        equipment,
        applicationTemplates,
        applicationStats: {
          totalAssigned,
          activeAssigned,
          totalApplications,
          byStatus: applicationStats,
        },
      });
    } catch (error) {
      console.error('Error fetching campaign:', error);
      res.status(500).json({ error: 'Failed to fetch campaign' });
    }
  });

  // Prospects assigned to a given campaign. Backs the "Prospects" card on
  // the campaign detail page. Joins through campaign_assignments so we
  // surface every prospect rule-matched (or manually assigned) to the
  // campaign, regardless of whether they've actually submitted an app yet.
  app.get('/api/campaigns/:id/prospects', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid campaign id' });
      const dbToUse = getRequestDB(req);
      const { campaignAssignments, merchantProspects: prospectsTable, agents: agentsTable } = await import('@shared/schema');
      const { eq: eqOp, desc: descOp, and: andOp } = await import('drizzle-orm');

      const rows = await dbToUse
        .select({
          assignmentId: campaignAssignments.id,
          assignedAt: campaignAssignments.assignedAt,
          isActive: campaignAssignments.isActive,
          prospectId: prospectsTable.id,
          firstName: prospectsTable.firstName,
          lastName: prospectsTable.lastName,
          email: prospectsTable.email,
          status: prospectsTable.status,
          createdAt: prospectsTable.createdAt,
          agentId: prospectsTable.agentId,
          agentFirstName: agentsTable.firstName,
          agentLastName: agentsTable.lastName,
          agentEmail: agentsTable.email,
        })
        .from(campaignAssignments)
        .innerJoin(prospectsTable, eqOp(prospectsTable.id, campaignAssignments.prospectId))
        .leftJoin(agentsTable, eqOp(agentsTable.id, prospectsTable.agentId))
        .where(eqOp(campaignAssignments.campaignId, id))
        .orderBy(descOp(campaignAssignments.assignedAt));

      res.json({ prospects: rows });
    } catch (error) {
      console.error('Error fetching campaign prospects:', error);
      res.status(500).json({ error: 'Failed to fetch campaign prospects' });
    }
  });

  app.post('/api/campaigns/:id/deactivate', requirePerm('admin:manage'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const campaign = await storage.deactivateCampaign(id);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      res.json(campaign);
    } catch (error) {
      console.error('Error deactivating campaign:', error);
      res.status(500).json({ error: 'Failed to deactivate campaign' });
    }
  });

  app.put('/api/campaigns/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const parsed = sharedCampaignUpdateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid campaign payload", details: parsed.error.flatten() });
      }
      const id = parseInt(req.params.id);
      const { feeValues, equipmentIds, pricingTypeIds, templateId, selectedEquipment, ...campaignData } = parsed.data;
      const dbToUse = getRequestDB(req);
      const session = req.session;
      const userId = session?.userId;

      // Handle pricing type ID properly
      const pricingTypeId = Array.isArray(pricingTypeIds) && pricingTypeIds.length > 0
        ? pricingTypeIds[0]
        : campaignData.pricingTypeId;

      const { campaigns: campaignsTable, campaignApplicationTemplates: catTable, campaignFeeValues, campaignEquipment } = await import('@shared/schema');
      const { eq: eqOp } = await import('drizzle-orm');

      // Update campaign row
      const [updated] = await dbToUse
        .update(campaignsTable)
        .set({ ...campaignData, pricingTypeId, updatedAt: new Date() })
        .where(eqOp(campaignsTable.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Campaign not found' });

      // Upsert fee values if provided
      if (feeValues && Object.keys(feeValues).length > 0) {
        await dbToUse.delete(campaignFeeValues).where(eqOp(campaignFeeValues.campaignId, id));
        const feeValueRows = Object.entries(feeValues).map(([feeItemId, value]) => ({
          campaignId: id,
          feeItemId: parseInt(feeItemId),
          value: String(value),
          valueType: 'percentage' as const,
        }));
        await dbToUse.insert(campaignFeeValues).values(feeValueRows).onConflictDoNothing();
      }

      // Upsert equipment if provided
      const equipIds: number[] = selectedEquipment ?? equipmentIds ?? [];
      if (equipIds.length >= 0) {
        await dbToUse.delete(campaignEquipment).where(eqOp(campaignEquipment.campaignId, id));
        if (equipIds.length > 0) {
          const equipRows = equipIds.map((eqId: number, idx: number) => ({
            campaignId: id,
            equipmentItemId: eqId,
            isRequired: false,
            displayOrder: idx,
          }));
          await dbToUse.insert(campaignEquipment).values(equipRows).onConflictDoNothing();
        }
      }

      // Upsert application template association
      if (templateId !== undefined) {
        await dbToUse.delete(catTable).where(eqOp(catTable.campaignId, id));
        if (templateId) {
          await dbToUse
            .insert(catTable)
            .values({ campaignId: id, templateId: parseInt(String(templateId)), isPrimary: true, displayOrder: 0 })
            .onConflictDoNothing();
        }
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating campaign:', error);
      res.status(500).json({ error: 'Failed to update campaign' });
    }
  });

  // ===== Campaign Assignment Rules (Epic D) =====
  app.get('/api/campaign-rules', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (_req: RequestWithDB, res: Response) => {
    try {
      const rules = await storage.getCampaignAssignmentRules();
      res.json(rules);
    } catch (e) {
      console.error('Error listing campaign rules:', e);
      res.status(500).json({ message: 'Failed to list campaign rules' });
    }
  });

  app.post('/api/campaign-rules', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertCampaignAssignmentRuleSchema } = await import('@shared/schema');
      const userId = req.session?.userId;
      const parsed = insertCampaignAssignmentRuleSchema.safeParse({ ...req.body, createdBy: userId });
      if (!parsed.success) return res.status(400).json({ message: 'Invalid rule', errors: parsed.error.errors });
      const created = await storage.createCampaignAssignmentRule(parsed.data);
      res.status(201).json(created);
    } catch (e) {
      console.error('Error creating campaign rule:', e);
      res.status(500).json({ message: 'Failed to create rule' });
    }
  });

  app.patch('/api/campaign-rules/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { insertCampaignAssignmentRuleSchema } = await import('@shared/schema');
      // Validate partial payload against the insert schema; omit createdBy so
      // PATCH can't reassign authorship.
      const parsed = insertCampaignAssignmentRuleSchema
        .omit({ createdBy: true })
        .partial()
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid rule update', errors: parsed.error.errors });
      }
      const updated = await storage.updateCampaignAssignmentRule(id, parsed.data);
      if (!updated) return res.status(404).json({ message: 'Rule not found' });
      res.json(updated);
    } catch (e) {
      console.error('Error updating campaign rule:', e);
      res.status(500).json({ message: 'Failed to update rule' });
    }
  });

  app.delete('/api/campaign-rules/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const ok = await storage.deleteCampaignAssignmentRule(id);
      if (!ok) return res.status(404).json({ message: 'Rule not found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('Error deleting campaign rule:', e);
      res.status(500).json({ message: 'Failed to delete rule' });
    }
  });

  // Epic D — load currently-active campaign fee values for a prospect, keyed
  // by `fee_<feeItemId>` and the slugified fee name so PDF templates can
  // reference either. Returns an empty object when there's no assignment.
  async function loadCampaignFeesForProspect(
    prospectId: number,
    db: ReturnType<typeof getRequestDB>,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const { campaignAssignments, campaignFeeValues, feeItems } = await import('@shared/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      const [active] = await db
        .select()
        .from(campaignAssignments)
        .where(and(
          eq(campaignAssignments.prospectId, prospectId),
          eq(campaignAssignments.isActive, true),
        ))
        .orderBy(desc(campaignAssignments.assignedAt))
        .limit(1);
      if (!active?.campaignId) return out;
      const rows = await db
        .select({
          feeItemId: campaignFeeValues.feeItemId,
          value: campaignFeeValues.value,
          feeName: feeItems.name,
        })
        .from(campaignFeeValues)
        .leftJoin(feeItems, eq(campaignFeeValues.feeItemId, feeItems.id))
        .where(eq(campaignFeeValues.campaignId, active.campaignId));
      for (const r of rows) {
        out[`fee_${r.feeItemId}`] = r.value;
        if (r.feeName) {
          const key = String(r.feeName).trim().toLowerCase().replace(/\s+/g, '_');
          out[key] = r.value;
        }
      }
      out.campaignId = String(active.campaignId);
    } catch (e) {
      console.warn('[Epic D] loadCampaignFeesForProspect failed:', e);
    }
    return out;
  }

  // Regenerate the filled MPA PDF for a single prospect using its existing
  // prospect_application + acquirer template, with current campaign pricing.
  async function regenerateProspectPdf(
    prospectId: number,
    db: ReturnType<typeof getRequestDB>,
  ): Promise<{ ok: boolean; pdfPath?: string; error?: string }> {
    try {
      const { pdfGenerator } = await import('./pdfGenerator');
      const fs = await import('fs');
      const path = await import('path');
      const { prospectApplications, acquirerApplicationTemplates, merchantProspects, campaignAssignments, campaignFeeValues, feeItems } =
        await import('@shared/schema');
      const { eq, and, desc } = await import('drizzle-orm');

      const [prospect] = await db
        .select()
        .from(merchantProspects)
        .where(eq(merchantProspects.id, prospectId))
        .limit(1);
      if (!prospect) return { ok: false, error: 'Prospect not found' };

      const [prospectApp] = await db
        .select()
        .from(prospectApplications)
        .where(eq(prospectApplications.prospectId, prospectId))
        .limit(1);
      if (!prospectApp) return { ok: false, error: 'No prospect application to regenerate' };

      const [template] = await db
        .select()
        .from(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.id, prospectApp.templateId))
        .limit(1);
      if (!template?.originalPdfBase64) {
        return { ok: false, error: 'Template missing original PDF' };
      }

      let formData: Record<string, any> = {};
      if (prospect.formData) {
        try {
          formData = typeof prospect.formData === 'string'
            ? JSON.parse(prospect.formData)
            : prospect.formData;
        } catch {
          formData = {};
        }
      }
      // Inject the prospect's currently-active campaign fee values so re-pricing wins.
      const campaignFees = await loadCampaignFeesForProspect(prospectId, db);
      const merged = {
        ...formData,
        ...(prospectApp.applicationData as Record<string, any> || {}),
        ...campaignFees,
      };

      const pdfBuffer = await pdfGenerator.generateFilledPDF(
        template.originalPdfBase64,
        merged,
        template.fieldConfiguration,
        Array.isArray(template.pdfMappingConfiguration)
          ? template.pdfMappingConfiguration as unknown[]
          : [],
      );

      const uploadsDir = path.default.join(process.cwd(), 'uploads', 'generated-pdfs');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const safeCompany = String(merged.companyName || 'application').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeCompany}_${prospectId}_${Date.now()}.pdf`;
      const filePath = path.default.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, pdfBuffer);
      const generatedPdfPath = `uploads/generated-pdfs/${fileName}`;

      // Preserve previous PDF in a sibling history manifest so audit can find
      // every version of this prospect's generated MPA across re-pricings.
      try {
        const prevPath = prospectApp.generatedPdfPath;
        if (prevPath) {
          const histPath = path.default.join(uploadsDir, `${prospectId}.history.json`);
          let history: Array<{ path: string; supersededAt: string; replacedBy: string }> = [];
          if (fs.existsSync(histPath)) {
            try { history = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch { history = []; }
          }
          history.push({
            path: prevPath,
            supersededAt: new Date().toISOString(),
            replacedBy: generatedPdfPath,
          });
          fs.writeFileSync(histPath, JSON.stringify(history, null, 2));
        }
      } catch (histErr) {
        console.warn('[Epic D] regen: failed to record PDF history (non-fatal):', histErr);
      }

      await db
        .update(prospectApplications)
        .set({ generatedPdfPath, updatedAt: new Date() })
        .where(eq(prospectApplications.id, prospectApp.id));

      return { ok: true, pdfPath: generatedPdfPath };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  // Epic D — set/swap a prospect's campaign assignment.
  // This is a privileged write that affects pricing on a generated MPA, so it
  // requires admin:manage. In-handler ownership check additionally restricts
  // non-admin callers to prospects they own (their agent record).
  app.post('/api/prospects/:id/set-campaign', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const prospectId = parseInt(req.params.id);
      const setCampaignSchema = z.object({
        campaignId: z.coerce.number().int().positive(),
        regenerate: z.boolean().optional(),
      });
      const parsed = setCampaignSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid set-campaign payload', errors: parsed.error.flatten() });
      }
      const { campaignId, regenerate } = parsed.data;

      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) return res.status(404).json({ message: 'Prospect not found' });

      // Ownership check: anyone holding admin:manage at scope 'all' (admin /
      // super_admin) bypasses; otherwise the caller must own the prospect via
      // their agent record.
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const scope = req.permScope as 'own' | 'downline' | 'all' | undefined;
      if (scope !== 'all') {
        const callerAgent = userId ? await storage.getAgentByUserId(userId).catch(() => null) : null;
        if (!callerAgent || callerAgent.id !== prospect.agentId) {
          return res.status(403).json({ message: 'Not authorized to modify this prospect' });
        }
      }

      const assignment = await storage.swapCampaignForProspect(prospectId, Number(campaignId), userId);
      let regenerated: { ok: boolean; pdfPath?: string; error?: string } | null = null;
      if (regenerate) {
        regenerated = await regenerateProspectPdf(prospectId, getRequestDB(req));
        if (!regenerated.ok) console.error('PDF regeneration failed:', regenerated.error);
      }
      res.json({ assignment, regenerated });
    } catch (e) {
      console.error('Error setting campaign for prospect:', e);
      res.status(500).json({ message: 'Failed to set campaign' });
    }
  });

  // ===== Affected applications for a campaign =====
  app.get('/api/campaigns/:id/affected-applications', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const campaignId = parseInt(req.params.id);
      const prospects = await storage.getProspectsForCampaign(campaignId);
      // Return as both `prospects` (back-compat) and `applications` (current UI)
      res.json({ count: prospects.length, prospects, applications: prospects });
    } catch (e) {
      console.error('Error listing affected applications:', e);
      res.status(500).json({ message: 'Failed to list affected applications' });
    }
  });

  // ===== Bulk-regenerate PDFs for all prospects on a campaign =====
  app.post('/api/campaigns/:id/regenerate-pdfs', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const campaignId = parseInt(req.params.id);
      const prospects = await storage.getProspectsForCampaign(campaignId);
      const dbToUse = getRequestDB(req);
      const results: Array<{ prospectId: number; ok: boolean; pdfPath?: string; error?: string }> = [];
      for (const p of prospects) {
        const r = await regenerateProspectPdf(p.id, dbToUse);
        results.push({ prospectId: p.id, ...r });
      }
      const succeeded = results.filter(r => r.ok).length;
      res.json({ total: results.length, succeeded, failed: results.length - succeeded, results });
    } catch (e) {
      console.error('Error regenerating PDFs:', e);
      res.status(500).json({ message: 'Failed to regenerate PDFs' });
    }
  });

  // Pricing Types
  app.get('/api/pricing-types', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching pricing types - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems } = await import("@shared/schema");
      const { eq, sql } = await import("drizzle-orm");
      
      // Get all pricing types from the selected database environment
      console.log(`Querying pricing types from ${req.dbEnv} database...`);
      const allPricingTypes = await dbToUse.select().from(pricingTypes);
      console.log(`Raw pricing types query result:`, allPricingTypes);
      
      // Add fee items count to each pricing type
      const pricingTypesWithFeeItems = await Promise.all(
        allPricingTypes.map(async (pricingType) => {
          try {
            // Count fee items for this pricing type in the current database environment
            const feeItemsCount = await dbToUse.select({ count: sql`count(*)` })
              .from(pricingTypeFeeItems)
              .where(eq(pricingTypeFeeItems.pricingTypeId, pricingType.id));
            
            return {
              ...pricingType,
              feeItems: [],
              feeItemsCount: Number(feeItemsCount[0]?.count || 0)
            };
          } catch (error) {
            console.error(`Error fetching fee items count for pricing type ${pricingType.id}:`, error);
            return {
              ...pricingType,
              feeItems: [],
              feeItemsCount: 0
            };
          }
        })
      );
      
      console.log(`Found ${allPricingTypes.length} pricing types in ${req.dbEnv} database`);
      console.log(`Final response being sent:`, pricingTypesWithFeeItems);
      res.json(pricingTypesWithFeeItems);
    } catch (error) {
      console.error('Error fetching pricing types:', error);
      res.status(500).json({ error: 'Failed to fetch pricing types' });
    }
  });

  app.get('/api/pricing-types/:id/fee-items', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching fee items for pricing type ${req.params.id} - Database environment: ${req.dbEnv}`);
      
      const id = parseInt(req.params.id);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the pricing type and its fee items from the selected database environment
      const result = await dbToUse.select({
        pricingType: pricingTypes,
        pricingTypeFeeItem: pricingTypeFeeItems,
        feeItem: feeItems,
        feeGroup: feeGroups
      }).from(pricingTypes)
      .leftJoin(pricingTypeFeeItems, eq(pricingTypes.id, pricingTypeFeeItems.pricingTypeId))
      .leftJoin(feeItems, eq(pricingTypeFeeItems.feeItemId, feeItems.id))
      .leftJoin(feeGroupFeeItems, eq(pricingTypeFeeItems.feeItemId, feeGroupFeeItems.feeItemId))
      .leftJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
      .where(eq(pricingTypes.id, id));
      
      if (result.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      const pricingType = result[0].pricingType;
      const feeItemsWithGroups = result
        .filter(row => row.feeItem && row.feeGroup)
        .map(row => ({
          ...row.pricingTypeFeeItem,
          feeItem: {
            ...row.feeItem,
            feeGroup: row.feeGroup
          }
        }));
      
      const response = {
        ...pricingType,
        feeItems: feeItemsWithGroups
      };
      
      console.log(`Found pricing type with ${feeItemsWithGroups.length} fee items in ${req.dbEnv} database`);
      res.json(response);
    } catch (error) {
      console.error('Error fetching pricing type fee items:', error);
      res.status(500).json({ error: 'Failed to fetch fee items' });
    }
  });

  // Get fee items organized by fee group for a specific pricing type (for campaign creation)
  app.get('/api/pricing-types/:id/fee-groups', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching fee items by fee group for pricing type ${req.params.id} - Database environment: ${req.dbEnv}`);
      
      const id = parseInt(req.params.id);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, asc } = await import("drizzle-orm");
      
      // First verify the pricing type exists
      const pricingTypeResult = await dbToUse.select().from(pricingTypes).where(eq(pricingTypes.id, id));
      if (pricingTypeResult.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      // Get fee items with their fee groups for this pricing type
      const result = await dbToUse.select({
        feeGroup: feeGroups,
        feeItem: feeItems,
        pricingTypeFeeItem: pricingTypeFeeItems
      }).from(pricingTypeFeeItems)
      .innerJoin(feeItems, eq(pricingTypeFeeItems.feeItemId, feeItems.id))
      .innerJoin(feeGroupFeeItems, eq(feeItems.id, feeGroupFeeItems.feeItemId))
      .innerJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
      .where(eq(pricingTypeFeeItems.pricingTypeId, id))
      .orderBy(asc(feeGroups.displayOrder), asc(feeItems.displayOrder));
      
      // Group fee items by fee group
      const feeGroupsMap = new Map();
      
      result.forEach(row => {
        if (!feeGroupsMap.has(row.feeGroup.id)) {
          feeGroupsMap.set(row.feeGroup.id, {
            ...row.feeGroup,
            feeItems: []
          });
        }
        
        feeGroupsMap.get(row.feeGroup.id).feeItems.push({
          ...row.feeItem,
          pricingTypeFeeItem: row.pricingTypeFeeItem
        });
      });
      
      const feeGroupsWithItems = Array.from(feeGroupsMap.values());
      
      const response = {
        pricingType: pricingTypeResult[0],
        feeGroups: feeGroupsWithItems
      };
      
      console.log(`Found ${feeGroupsWithItems.length} fee groups with items for pricing type ${id} in ${req.dbEnv} database`);
      res.json(response);
    } catch (error) {
      console.error('Error fetching pricing type fee groups:', error);
      res.status(500).json({ error: 'Failed to fetch fee groups' });
    }
  });

  app.post('/api/pricing-types', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating pricing type - Database environment: ${req.dbEnv}`);

      const bodySchema = z.object({
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        feeGroupIds: z.array(z.coerce.number()).optional(),
        feeItemIds: z.array(z.coerce.number()).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid pricing type payload", details: parsed.error.flatten() });
      }
      const { name, description, feeGroupIds = [], feeItemIds } = parsed.data;
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, inArray } = await import("drizzle-orm");
      
      // Create the pricing type first
      const [pricingType] = await dbToUse.insert(pricingTypes).values({
        name,
        description,
        isActive: true,
        author: 'System'
      }).returning();
      
      console.log('Created pricing type:', pricingType);
      
      // Determine the final fee item set: explicit feeItemIds takes precedence; otherwise expand fee groups
      let finalFeeItemIds: number[] = [];
      if (feeItemIds && Array.isArray(feeItemIds) && feeItemIds.length > 0) {
        finalFeeItemIds = Array.from(new Set(feeItemIds));
        console.log('Adding explicit fee items to pricing type:', finalFeeItemIds);
      } else if (feeGroupIds && Array.isArray(feeGroupIds) && feeGroupIds.length > 0) {
        console.log('Expanding fee groups for pricing type:', feeGroupIds);
        const feeItemsFromGroups = await dbToUse
          .select({ feeItemId: feeGroupFeeItems.feeItemId })
          .from(feeGroupFeeItems)
          .where(inArray(feeGroupFeeItems.feeGroupId, feeGroupIds));
        finalFeeItemIds = Array.from(new Set(feeItemsFromGroups.map(r => r.feeItemId)));
      }

      if (finalFeeItemIds.length > 0) {
        await dbToUse.insert(pricingTypeFeeItems).values(
          finalFeeItemIds.map((feeItemId, index) => ({
            pricingTypeId: pricingType.id,
            feeItemId,
            isRequired: false,
            displayOrder: index + 1,
          }))
        );
        console.log(`Added ${finalFeeItemIds.length} fee items to pricing type`);
      }

      console.log(`Pricing type created successfully in ${req.dbEnv} database`);
      res.status(201).json(pricingType);
    } catch (error) {
      console.error('Error creating pricing type:', error);
      res.status(500).json({ error: 'Failed to create pricing type' });
    }
  });

  app.delete('/api/pricing-types/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid pricing type ID' });
      }
      
      const result = await storage.deletePricingType(id);
      
      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      console.error('Error deleting pricing type:', error);
      res.status(500).json({ error: 'Failed to delete pricing type' });
    }
  });

  app.put('/api/pricing-types/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid pricing type ID' });
      }

      const pricingTypeBodySchema = z.object({
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        feeGroupIds: z.array(z.coerce.number()).optional(),
        feeItemIds: z.array(z.coerce.number()).optional(),
      });
      const parsed = pricingTypeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid pricing type payload', details: parsed.error.flatten() });
      }
      const { name, description, feeGroupIds, feeItemIds } = parsed.data;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      
      console.log(`Updating pricing type ${id} - Database environment: ${req.dbEnv}`);
      console.log('Updating pricing type with data:', {
        id,
        name: name.trim(),
        description: description?.trim() || null,
        feeGroupIds: feeGroupIds || []
      });
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, inArray } = await import("drizzle-orm");
      
      // First check if pricing type exists in this database environment
      const existingPricingType = await dbToUse.select()
        .from(pricingTypes)
        .where(eq(pricingTypes.id, id));
      
      console.log('Existing pricing type in database:', existingPricingType);
      
      if (existingPricingType.length === 0) {
        console.log(`Pricing type ${id} not found in ${req.dbEnv} database`);
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      // Update the pricing type
      const [updatedPricingType] = await dbToUse.update(pricingTypes)
        .set({
          name: name.trim(),
          description: description?.trim() || null,
          updatedAt: new Date()
        })
        .where(eq(pricingTypes.id, id))
        .returning();

      if (!updatedPricingType) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }

      // Only rewrite fee item associations if the client sent feeItemIds or feeGroupIds
      const willUpdateAssociations = Array.isArray(feeItemIds) || Array.isArray(feeGroupIds);
      if (willUpdateAssociations) {
        console.log('Deleting existing fee item associations...');
        await dbToUse.delete(pricingTypeFeeItems)
          .where(eq(pricingTypeFeeItems.pricingTypeId, id));

        let finalFeeItemIds: number[] = [];
        if (feeItemIds && feeItemIds.length > 0) {
          finalFeeItemIds = Array.from(new Set(feeItemIds));
          console.log('Setting explicit fee items on pricing type:', finalFeeItemIds);
        } else if (feeGroupIds && feeGroupIds.length > 0) {
          console.log('Expanding fee groups for pricing type:', feeGroupIds);
          const feeItemsFromGroups = await dbToUse
            .select({ feeItemId: feeGroupFeeItems.feeItemId })
            .from(feeGroupFeeItems)
            .where(inArray(feeGroupFeeItems.feeGroupId, feeGroupIds));
          finalFeeItemIds = Array.from(new Set(feeItemsFromGroups.map(r => r.feeItemId)));
        }

        if (finalFeeItemIds.length > 0) {
          await dbToUse.insert(pricingTypeFeeItems).values(
            finalFeeItemIds.map((feeItemId, index) => ({
              pricingTypeId: id,
              feeItemId,
              isRequired: false,
              displayOrder: index + 1,
            }))
          );
          console.log(`Added ${finalFeeItemIds.length} fee items to pricing type`);
        }
      }
      
      console.log('Pricing type update completed successfully');
      res.json(updatedPricingType);
    } catch (error) {
      console.error('Error updating pricing type:', error);
      res.status(500).json({ error: 'Failed to update pricing type' });
    }
  });

  // Duplicate fee groups endpoints removed - using the correct ones with dbEnvironmentMiddleware

  // Fee Items API endpoints
  app.get('/api/fee-items', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching fee items - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { feeItems } = await import("@shared/schema");
      
      // Get all fee items (now standalone - no direct fee group relationship)
      const result = await dbToUse.select().from(feeItems).orderBy(feeItems.displayOrder);

      res.json(result);
    } catch (error) {
      console.error("Error fetching fee items:", error);
      res.status(500).json({ error: "Failed to fetch fee items" });
    }
  });

  app.post('/api/fee-items', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating fee item - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { feeItems, insertFeeItemSchema } = await import("@shared/schema");
      const parsed = insertFeeItemSchema.safeParse({
        ...req.body,
        author: req.user?.email || 'System',
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid fee item payload", details: parsed.error.flatten() });
      }

      const [feeItem] = await dbToUse.insert(feeItems).values(parsed.data).returning();
      res.status(201).json(feeItem);
    } catch (error: any) {
      console.error("Error creating fee item:", error);
      
      // Handle foreign key constraint violation
      if (error.code === '23503' && error.constraint === 'fee_items_fee_group_id_fkey') {
        return res.status(400).json({ 
          error: "Fee group not found. Please select a valid fee group." 
        });
      }
      
      res.status(500).json({ error: "Failed to create fee item" });
    }
  });

  app.put('/api/fee-items/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { feeItems, insertFeeItemSchema } = await import("@shared/schema");
      const parsed = insertFeeItemSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid fee item payload", details: parsed.error.flatten() });
      }
      const id = parseInt(req.params.id);
      console.log(`Updating fee item ${id} - Database environment: ${req.dbEnv}`);

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }

      const { eq } = await import("drizzle-orm");

      const updateData = {
        ...parsed.data,
        updatedAt: new Date(),
      };
      
      const [updatedFeeItem] = await dbToUse
        .update(feeItems)
        .set(updateData)
        .where(eq(feeItems.id, id))
        .returning();
      
      if (!updatedFeeItem) {
        return res.status(404).json({ error: "Fee item not found" });
      }
      
      res.json(updatedFeeItem);
    } catch (error: any) {
      console.error("Error updating fee item:", error);
      
      // Handle foreign key constraint violation
      if (error.code === '23503' && error.constraint === 'fee_items_fee_group_id_fkey') {
        return res.status(400).json({ 
          error: "Fee group not found. Please select a valid fee group." 
        });
      }
      
      res.status(500).json({ error: "Failed to update fee item" });
    }
  });

  // Delete fee item - with validation to prevent deletion if associated with fee groups
  app.delete('/api/fee-items/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      console.log(`Deleting fee item ${id} - Database environment: ${req.dbEnv}`);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid fee item ID" });
      }

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }

      const { feeItems, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // First check if fee item exists
      const existingFeeItem = await dbToUse.select().from(feeItems).where(eq(feeItems.id, id));
      if (existingFeeItem.length === 0) {
        return res.status(404).json({ error: "Fee item not found" });
      }
      
      // Check if this fee item is associated with any fee groups
      const associatedFeeGroups = await dbToUse.select()
        .from(feeGroupFeeItems)
        .where(eq(feeGroupFeeItems.feeItemId, id));
      
      if (associatedFeeGroups.length > 0) {
        return res.status(400).json({ 
          error: `Cannot delete fee item "${existingFeeItem[0].name}" because it is associated with ${associatedFeeGroups.length} fee group(s). Please remove this fee item from all fee groups first.` 
        });
      }
      
      // Safe to delete - not associated with any fee groups
      const [deletedFeeItem] = await dbToUse.delete(feeItems)
        .where(eq(feeItems.id, id))
        .returning();
      
      if (!deletedFeeItem) {
        return res.status(404).json({ error: "Fee item not found" });
      }
      
      console.log(`Successfully deleted fee item: ${deletedFeeItem.name}`);
      res.json({ message: `Fee item "${deletedFeeItem.name}" has been successfully deleted.`, deletedFeeItem });
    } catch (error: any) {
      console.error("Error deleting fee item:", error);
      res.status(500).json({ error: "Failed to delete fee item" });
    }
  });

  // Enhanced Pricing Types with fee item relationships
  app.get('/api/pricing-types-detailed', isAuthenticated, async (req: any, res) => {
    try {
      const pricingTypesDetailed = [
        {
          id: 1,
          name: "Interchange +",
          description: "Interchange plus pricing structure with transparent fees",
          isActive: true,
          feeItems: [
            { id: 1, feeItemId: 1, isRequired: true, displayOrder: 1 },
            { id: 2, feeItemId: 4, isRequired: false, displayOrder: 2 },
            { id: 3, feeItemId: 5, isRequired: false, displayOrder: 3 }
          ]
        },
        {
          id: 2,
          name: "Flat Rate",
          description: "Simple flat rate pricing for all transactions",
          isActive: true,
          feeItems: [
            { id: 4, feeItemId: 1, isRequired: true, displayOrder: 1 },
            { id: 5, feeItemId: 4, isRequired: false, displayOrder: 2 }
          ]
        },
        {
          id: 3,
          name: "Tiered",
          description: "Tiered pricing structure based on transaction types",
          isActive: true,
          feeItems: [
            { id: 6, feeItemId: 1, isRequired: true, displayOrder: 1 },
            { id: 7, feeItemId: 2, isRequired: true, displayOrder: 2 },
            { id: 8, feeItemId: 3, isRequired: true, displayOrder: 3 },
            { id: 9, feeItemId: 4, isRequired: false, displayOrder: 4 }
          ]
        }
      ];
      res.json(pricingTypesDetailed);
    } catch (error) {
      console.error("Error fetching detailed pricing types:", error);
      res.status(500).json({ message: "Failed to fetch detailed pricing types" });
    }
  });


  // ===================
  // CAMPAIGN MANAGEMENT API ENDPOINTS
  // ===================

  // Duplicate fee groups endpoints removed - using the correct ones with database isolation

  // Duplicate fee items GET endpoint removed - using the correct one with database isolation

  // Duplicate fee item POST endpoint removed - using the correct one with database isolation

  // Campaigns endpoints
  app.get("/api/campaigns", requirePerm('admin:manage'), async (req: Request, res: Response) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.post("/api/campaigns", requirePerm('admin:manage'), async (req: Request, res: Response) => {
    try {
      const { insertCampaignSchema } = await import('@shared/schema');
      const campaignBodySchema = insertCampaignSchema.extend({
        equipmentIds: z.array(z.number()).optional(),
        feeValues: z.any().optional(),
      });
      const parsed = campaignBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid campaign payload", details: parsed.error.flatten() });
      }
      const { equipmentIds = [], feeValues = [], createdBy: _ignoredCreatedBy, ...campaignData } = parsed.data;
      const sessionUserId = (req as any).session?.userId ?? null;
      const campaign = await storage.createCampaign({ ...campaignData, createdBy: sessionUserId }, feeValues, equipmentIds);
      res.status(201).json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  app.post("/api/campaigns/:id/deactivate", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      res.json({ success: true, message: "Campaign deactivated successfully" });
    } catch (error) {
      console.error("Error deactivating campaign:", error);
      res.status(500).json({ message: "Failed to deactivate campaign" });
    }
  });

  app.get("/api/campaigns/:id/equipment", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const equipment = await storage.getCampaignEquipment(id);
      res.json(equipment);
    } catch (error) {
      console.error("Error fetching campaign equipment:", error);
      res.status(500).json({ message: "Failed to fetch campaign equipment" });
    }
  });

  // Equipment Items API
  app.get("/api/equipment-items", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      console.log(`Fetching equipment items - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { equipmentItems } = await import("@shared/schema");
      const allEquipmentItems = await dbToUse.select().from(equipmentItems);
      
      console.log(`Found ${allEquipmentItems.length} equipment items in ${req.dbEnv} database`);
      res.json(allEquipmentItems);
    } catch (error) {
      console.error('Error fetching equipment items:', error);
      res.status(500).json({ message: 'Failed to fetch equipment items' });
    }
  });

  app.post("/api/equipment-items", dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertEquipmentItemSchema'), async (req: RequestWithDB, res) => {
    try {
      const { insertEquipmentItemSchema } = await import("@shared/schema");
      const parsed = insertEquipmentItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid equipment item payload", errors: parsed.error.flatten() });
      }
      const equipmentItem = await storage.createEquipmentItem(parsed.data);
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error creating equipment item:', error);
      res.status(500).json({ message: 'Failed to create equipment item' });
    }
  });

  app.put("/api/equipment-items/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertEquipmentItemSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const parsed = insertEquipmentItemSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid equipment item payload', errors: parsed.error.flatten() });
      }
      const equipmentItem = await storage.updateEquipmentItem(id, parsed.data);
      
      if (!equipmentItem) {
        return res.status(404).json({ message: 'Equipment item not found' });
      }
      
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error updating equipment item:', error);
      res.status(500).json({ message: 'Failed to update equipment item' });
    }
  });

  app.delete("/api/equipment-items/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEquipmentItem(id);
      
      if (!success) {
        return res.status(404).json({ message: 'Equipment item not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting equipment item:', error);
      res.status(500).json({ message: 'Failed to delete equipment item' });
    }
  });

  // ============================================================================
  // API KEY MANAGEMENT ROUTES - Admin Only
  // ============================================================================

  // Get all API keys
  app.get("/api/admin/api-keys", requirePerm('admin:manage'), async (req, res) => {
    try {
      const apiKeys = await storage.getAllApiKeys();
      // Don't send the secret in the response
      const safeApiKeys = apiKeys.map(key => ({
        ...key,
        keySecret: undefined,
      }));
      res.json(safeApiKeys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  // Create new API key
  app.post("/api/admin/api-keys", requirePerm('admin:manage'), markSchema('insertApiKeySchema'), async (req: any, res) => {
    try {
      const result = insertApiKeySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid API key data", 
          errors: result.error.errors 
        });
      }

      // Generate key pair
      const { keyId, keySecret, fullKey } = await generateApiKey();

      // Hash the secret for storage
      const bcrypt = await import("bcrypt");
      const hashedSecret = await bcrypt.hash(keySecret, 12);

      // Create API key record
      const apiKeyData = {
        ...result.data,
        keyId,
        keySecret: hashedSecret,
        createdBy: req.user?.claims?.sub || req.session?.userId || 'admin-demo-123',
      };

      const apiKey = await storage.createApiKey(apiKeyData);

      // Return the full key only once
      res.status(201).json({
        ...apiKey,
        keySecret: undefined, // Don't include hashed secret
        fullKey, // Only returned on creation
      });
    } catch (error: any) {
      console.error("Error creating API key:", error);
      if (error?.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "API key name already exists" });
      }
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // Update API key
  app.patch("/api/admin/api-keys/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = z.object({
        name: z.string().min(1).optional(),
        organizationName: z.string().optional(),
        contactEmail: z.string().email().optional(),
        permissions: z.array(z.string()).optional(),
        rateLimit: z.number().int().nonnegative().optional(),
        isActive: z.boolean().optional(),
        expiresAt: z.union([z.string(), z.null()]).optional(),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid API key payload", errors: parsed.error.flatten() });
      }
      const body = parsed.data;

      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.organizationName !== undefined) updateData.organizationName = body.organizationName;
      if (body.contactEmail !== undefined) updateData.contactEmail = body.contactEmail;
      if (body.permissions !== undefined) updateData.permissions = body.permissions;
      if (body.rateLimit !== undefined) updateData.rateLimit = body.rateLimit;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
      if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

      const apiKey = await storage.updateApiKey(id, updateData);
      if (!apiKey) {
        return res.status(404).json({ message: "API key not found" });
      }

      // Don't send the secret
      res.json({
        ...apiKey,
        keySecret: undefined,
      });
    } catch (error) {
      console.error("Error updating API key:", error);
      res.status(500).json({ message: "Failed to update API key" });
    }
  });

  // Delete API key
  app.delete("/api/admin/api-keys/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteApiKey(id);
      
      if (!success) {
        return res.status(404).json({ message: "API key not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting API key:", error);
      res.status(500).json({ message: "Failed to delete API key" });
    }
  });

  // Get API usage statistics
  app.get("/api/admin/api-keys/:id/usage", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const timeRange = req.query.timeRange as string || '24h';
      
      const stats = await storage.getApiUsageStats(id, timeRange);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching API usage stats:", error);
      res.status(500).json({ message: "Failed to fetch API usage statistics" });
    }
  });

  // Get API request logs
  app.get("/api/admin/api-logs", requirePerm('admin:manage'), async (req, res) => {
    try {
      const apiKeyId = req.query.apiKeyId ? parseInt(req.query.apiKeyId as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      
      const logs = await storage.getApiRequestLogs(apiKeyId, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching API logs:", error);
      res.status(500).json({ message: "Failed to fetch API logs" });
    }
  });

  // ============================================================================
  // PUBLIC API ENDPOINTS - Authenticated via API Keys
  // ============================================================================

  // Apply API authentication middleware to all /api/v1 routes
  app.use('/api/v1', logApiRequest, authenticateApiKey);

  // Import and mount testing routes
  const testingRoutes = await import('./routes/testing');
  app.use('/api/testing', testingRoutes.default);

  // Public merchants API
  app.get('/api/v1/merchants', requireApiPermission('merchants:read'), async (req: any, res) => {
    try {
      const merchants = await storage.getAllMerchants();
      res.json(merchants);
    } catch (error) {
      console.error('Error fetching merchants via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch merchants' 
      });
    }
  });

  app.get('/api/v1/merchants/:id', requireApiPermission('merchants:read'), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const merchant = await storage.getMerchant(id);
      
      if (!merchant) {
        return res.status(404).json({ 
          error: 'Not found',
          message: 'Merchant not found' 
        });
      }
      
      res.json(merchant);
    } catch (error) {
      console.error('Error fetching merchant via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch merchant' 
      });
    }
  });

  app.post('/api/v1/merchants', requireApiPermission('merchants:write'), markSchema('insertMerchantSchema'), async (req: any, res) => {
    try {
      const result = insertMerchantSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: 'Validation error',
          message: 'Invalid merchant data',
          details: result.error.errors 
        });
      }

      const merchant = await storage.createMerchant(result.data);
      res.status(201).json(merchant);
    } catch (error) {
      console.error('Error creating merchant via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to create merchant' 
      });
    }
  });

  // Public agents API
  app.get('/api/v1/agents', requireApiPermission('agents:read'), async (req: any, res) => {
    try {
      const agents = await storage.getAllAgents();
      res.json(agents);
    } catch (error) {
      console.error('Error fetching agents via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch agents' 
      });
    }
  });

  app.get('/api/v1/agents/:id', requireApiPermission('agents:read'), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const agent = await storage.getAgent(id);
      
      if (!agent) {
        return res.status(404).json({ 
          error: 'Not found',
          message: 'Agent not found' 
        });
      }
      
      res.json(agent);
    } catch (error) {
      console.error('Error fetching agent via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch agent' 
      });
    }
  });

  // Public transactions API
  app.get('/api/v1/transactions', requireApiPermission('transactions:read'), async (req: any, res) => {
    try {
      const transactions = await storage.getAllTransactions();
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch transactions' 
      });
    }
  });

  app.post('/api/v1/transactions', requireApiPermission('transactions:write'), markSchema('insertTransactionSchema'), async (req: any, res) => {
    try {
      const result = insertTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: 'Validation error',
          message: 'Invalid transaction data',
          details: result.error.errors 
        });
      }

      const transaction = await storage.createTransaction(result.data);
      res.status(201).json(transaction);
    } catch (error) {
      console.error('Error creating transaction via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to create transaction' 
      });
    }
  });

  // ============================================================================
  // EMAIL MANAGEMENT API ENDPOINTS - Admin Only
  // ============================================================================

  // Get all email templates
  app.get("/api/admin/email-templates", requirePerm('admin:manage'), async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // Public endpoint for email templates (development bypass)
  app.get("/api/email-templates", async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // Get single email template
  app.get("/api/admin/email-templates/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await storage.getEmailTemplate(id);
      
      if (!template) {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error fetching email template:", error);
      res.status(500).json({ message: "Failed to fetch email template" });
    }
  });

  // Create email template
  app.post("/api/admin/email-templates", requirePerm('admin:manage'), markSchema('insertEmailTemplateSchema'), async (req, res) => {
    try {
      const { insertEmailTemplateSchema } = await import("@shared/schema");
      const result = insertEmailTemplateSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email template data", 
          errors: result.error.errors 
        });
      }

      const template = await storage.createEmailTemplate(result.data);
      res.status(201).json(template);
    } catch (error: any) {
      console.error("Error creating email template:", error);
      if (error?.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "Email template name already exists" });
      }
      res.status(500).json({ message: "Failed to create email template" });
    }
  });

  // Update email template
  app.put("/api/admin/email-templates/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const { insertEmailTemplateSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const result = insertEmailTemplateSchema.partial().safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email template data", 
          errors: result.error.errors 
        });
      }

      const template = await storage.updateEmailTemplate(id, result.data);
      
      if (!template) {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error updating email template:", error);
      res.status(500).json({ message: "Failed to update email template" });
    }
  });

  // Delete email template
  app.delete("/api/admin/email-templates/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEmailTemplate(id);
      
      if (!success) {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting email template:", error);
      res.status(500).json({ message: "Failed to delete email template" });
    }
  });

  // Get all email triggers
  app.get("/api/admin/email-triggers", requirePerm('admin:manage'), async (req, res) => {
    try {
      const triggers = await storage.getAllEmailTriggers();
      res.json(triggers);
    } catch (error) {
      console.error("Error fetching email triggers:", error);
      res.status(500).json({ message: "Failed to fetch email triggers" });
    }
  });

  // Create email trigger
  app.post("/api/admin/email-triggers", requirePerm('admin:manage'), markSchema('insertEmailTriggerSchema'), async (req, res) => {
    try {
      const { insertEmailTriggerSchema } = await import("@shared/schema");
      const result = insertEmailTriggerSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email trigger data", 
          errors: result.error.errors 
        });
      }

      const trigger = await storage.createEmailTrigger(result.data);
      res.status(201).json(trigger);
    } catch (error) {
      console.error("Error creating email trigger:", error);
      res.status(500).json({ message: "Failed to create email trigger" });
    }
  });

  // Update email trigger
  app.put("/api/admin/email-triggers/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const { insertEmailTriggerSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const result = insertEmailTriggerSchema.partial().safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email trigger data", 
          errors: result.error.errors 
        });
      }

      const trigger = await storage.updateEmailTrigger(id, result.data);
      
      if (!trigger) {
        return res.status(404).json({ message: "Email trigger not found" });
      }
      
      res.json(trigger);
    } catch (error) {
      console.error("Error updating email trigger:", error);
      res.status(500).json({ message: "Failed to update email trigger" });
    }
  });

  // Delete email trigger
  app.delete("/api/admin/email-triggers/:id", requirePerm('admin:manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEmailTrigger(id);
      
      if (!success) {
        return res.status(404).json({ message: "Email trigger not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting email trigger:", error);
      res.status(500).json({ message: "Failed to delete email trigger" });
    }
  });

  // Get email activity
  app.get("/api/admin/email-activity", requirePerm('admin:manage'), async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const filters: any = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.templateId) filters.templateId = parseInt(req.query.templateId as string);
      if (req.query.recipientEmail) filters.recipientEmail = req.query.recipientEmail as string;
      
      const activity = await storage.getEmailActivity(limit, filters);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching email activity:", error);
      res.status(500).json({ message: "Failed to fetch email activity" });
    }
  });

  // Public endpoint for email activity (development bypass)
  app.get("/api/email-activity", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const filters: any = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.templateId) filters.templateId = parseInt(req.query.templateId as string);
      if (req.query.recipientEmail) filters.recipientEmail = req.query.recipientEmail as string;
      
      const activity = await storage.getEmailActivity(limit, filters);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching email activity:", error);
      res.status(500).json({ message: "Failed to fetch email activity" });
    }
  });

  // Get email activity statistics
  app.get("/api/admin/email-stats", requirePerm('admin:manage'), async (req, res) => {
    try {
      const stats = await storage.getEmailActivityStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching email statistics:", error);
      res.status(500).json({ message: "Failed to fetch email statistics" });
    }
  });

  // ============================================================================
  // DASHBOARD API ENDPOINTS
  // ============================================================================

  // Import and use dashboard routes
  const { dashboardRouter } = await import("./routes/dashboard");
  app.use("/api/dashboard", dashboardRouter);

  // Epic F — Compliance, SLAs & Operations Polish endpoints. Mounted at /api
  // so individual routes can use any path (audit/entity, applications/sla,
  // admin/scheduled-reports, admin/schema-drift-alerts, …).
  const complianceRouter = (await import("./routes/compliance")).default;
  app.use("/api", complianceRouter);

  // ============================================================================
  // SECURITY & COMPLIANCE API ENDPOINTS 
  // ============================================================================

  // Get audit logs
  app.get("/api/audit-logs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const auditLogs = await storage.getAuditLogs(limit);
      res.json(auditLogs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });


  // ============================================================================
  // WORKFLOW DEFINITIONS API ENDPOINTS
  // ============================================================================

  // List all workflow definitions (raw SQL to match actual DB schema)
  app.get("/api/admin/workflows", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT wd.id, wd.code, wd.name, wd.description, wd.category, wd.entity_type,
               wd.is_active, wd.created_at, wd.updated_at,
               COUNT(DISTINCT ws.id)::int AS stage_count,
               COUNT(DISTINCT wt.id)::int AS ticket_count
        FROM workflow_definitions wd
        LEFT JOIN workflow_stages ws ON ws.workflow_definition_id = wd.id
        LEFT JOIN workflow_tickets wt ON wt.workflow_definition_id = wd.id
        GROUP BY wd.id
        ORDER BY wd.name
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching workflows:", error);
      res.status(500).json({ message: "Failed to fetch workflows" });
    }
  });

  // Get a single workflow definition with endpoints and environment configs
  app.get("/api/admin/workflows/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const wfResult = await dynamicDB.execute(sqlTag`
        SELECT id, code, name, description, category, entity_type, initial_status,
               final_statuses, configuration, is_active, created_by, created_at, updated_at
        FROM workflow_definitions WHERE id = ${id}
      `);
      const workflow = (wfResult.rows ?? wfResult)[0];
      if (!workflow) return res.status(404).json({ message: "Workflow not found" });
      const envResult = await dynamicDB.execute(sqlTag`SELECT * FROM workflow_environment_configs WHERE workflow_id = ${id}`);
      res.json({ ...workflow, environmentConfigs: envResult.rows ?? envResult });
      return;
    } catch (error) {
      console.error("Error fetching workflow:", error);
      res.status(500).json({ message: "Failed to fetch workflow" });
      return;
    }
  });

  // Create a workflow definition
  app.post("/api/admin/workflows", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const currentUser = req.currentUser;
      const workflowDefSchema = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        version: z.union([z.string(), z.number()]).optional(),
        category: z.string().min(1),
        entity_type: z.string().min(1),
        initial_status: z.string().optional(),
        final_statuses: z.array(z.string()).optional(),
        configuration: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      });
      const parsed = workflowDefSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid workflow payload", errors: parsed.error.flatten() });
      }
      const { code, name, description, version = "1.0", category, entity_type,
              initial_status = "submitted", final_statuses = ["approved","rejected"],
              configuration = {}, is_active = true } = parsed.data;
      const result = await dynamicDB.execute(sqlTag`
        INSERT INTO workflow_definitions
          (code, name, description, version, category, entity_type, initial_status,
           final_statuses, configuration, is_active, created_by, created_at, updated_at)
        VALUES (
          ${code}, ${name}, ${description ?? null}, ${version}, ${category}, ${entity_type},
          ${initial_status}, ${final_statuses}, ${JSON.stringify(configuration)},
          ${is_active}, ${currentUser?.id ?? 'system'}, NOW(), NOW()
        )
        RETURNING *
      `);
      res.status(201).json((result.rows ?? result)[0]);
    } catch (error) {
      console.error("Error creating workflow:", error);
      res.status(500).json({ message: "Failed to create workflow" });
    }
  });

  // Update a workflow definition
  app.put("/api/admin/workflows/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const workflowDefSchema = z.object({
        code: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        version: z.union([z.string(), z.number()]).optional(),
        category: z.string().nullable().optional(),
        entity_type: z.string().nullable().optional(),
        initial_status: z.string().nullable().optional(),
        final_statuses: z.array(z.string()).optional(),
        configuration: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      });
      const parsed = workflowDefSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid workflow payload", errors: parsed.error.flatten() });
      }
      const { code, name, description, version, category, entity_type,
              initial_status, final_statuses, configuration, is_active } = parsed.data;
      const result = await dynamicDB.execute(sqlTag`
        UPDATE workflow_definitions SET
          code = COALESCE(${code ?? null}, code),
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          version = COALESCE(${version ?? null}, version),
          category = COALESCE(${category ?? null}, category),
          entity_type = COALESCE(${entity_type ?? null}, entity_type),
          initial_status = COALESCE(${initial_status ?? null}, initial_status),
          final_statuses = COALESCE(${final_statuses ?? null}, final_statuses),
          configuration = COALESCE(${configuration ? JSON.stringify(configuration) : null}::jsonb, configuration),
          is_active = COALESCE(${is_active ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Workflow not found" });
      res.json(rows[0]);
    } catch (error) {
      console.error("Error updating workflow:", error);
      res.status(500).json({ message: "Failed to update workflow" });
    }
  });

  // Delete a workflow definition
  app.delete("/api/admin/workflows/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      await dynamicDB.execute(sqlTag`DELETE FROM workflow_stages WHERE workflow_definition_id = ${id}`);
      const result = await dynamicDB.execute(sqlTag`DELETE FROM workflow_definitions WHERE id = ${id} RETURNING id`);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Workflow not found" });
      res.json({ message: "Workflow deleted successfully" });
    } catch (error) {
      console.error("Error deleting workflow:", error);
      res.status(500).json({ message: "Failed to delete workflow" });
    }
  });

  // Toggle workflow active/inactive
  app.patch("/api/admin/workflows/:id/toggle", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const parsed = z.object({}).strict().safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid toggle payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const result = await dynamicDB.execute(sqlTag`
        UPDATE workflow_definitions SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = ${id} RETURNING *
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Workflow not found" });
      res.json(rows[0]);
    } catch (error) {
      console.error("Error toggling workflow:", error);
      res.status(500).json({ message: "Failed to toggle workflow" });
    }
  });

  // Workflow environment configs (raw SQL — actual schema: id,workflow_id,environment,config jsonb,is_active)
  app.get("/api/admin/workflows/:id/env-configs", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT id, workflow_id, environment, config, is_active, created_at
        FROM workflow_environment_configs WHERE workflow_id = ${parseInt(req.params.id)} ORDER BY environment
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch environment configs" });
    }
  });

  app.put("/api/admin/workflows/:id/env-configs/:env", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const envConfigBodySchema = z.object({
        config: z.record(z.any()),
        is_active: z.boolean().optional(),
      }).strict();
      const parsed = envConfigBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid env config payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const workflowId = parseInt(req.params.id);
      const environment = req.params.env;
      const { config, is_active = true } = parsed.data;
      const configJson = JSON.stringify(config);
      // Check if exists first
      const existing = await dynamicDB.execute(sqlTag`
        SELECT id FROM workflow_environment_configs WHERE workflow_id = ${workflowId} AND environment = ${environment}
      `);
      const existingRows = existing.rows ?? existing;
      let result;
      if (existingRows.length > 0) {
        result = await dynamicDB.execute(sqlTag`
          UPDATE workflow_environment_configs
          SET config = ${configJson}::jsonb, is_active = ${is_active}, updated_at = NOW()
          WHERE workflow_id = ${workflowId} AND environment = ${environment}
          RETURNING *
        `);
      } else {
        result = await dynamicDB.execute(sqlTag`
          INSERT INTO workflow_environment_configs (workflow_id, environment, config, is_active, created_at, updated_at)
          VALUES (${workflowId}, ${environment}, ${configJson}::jsonb, ${is_active}, NOW(), NOW())
          RETURNING *
        `);
      }
      res.json((result.rows ?? result)[0]);
    } catch (error) {
      console.error("Error upserting env config:", error);
      res.status(500).json({ message: "Failed to save environment config" });
    }
  });

  app.delete("/api/admin/workflows/:id/env-configs/:env", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      await dynamicDB.execute(sqlTag`
        DELETE FROM workflow_environment_configs WHERE workflow_id = ${parseInt(req.params.id)} AND environment = ${req.params.env}
      `);
      res.json({ message: "Environment config deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete environment config" });
    }
  });

  // ─── Workflow Stages ─────────────────────────────────────────────────────
  app.get("/api/admin/workflows/:id/stages", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const result = await dynamicDB.execute(sqlTag`
        SELECT ws.id, ws.workflow_definition_id, ws.code, ws.name, ws.description, ws.order_index,
               ws.stage_type, ws.handler_key, ws.is_required, ws.requires_review, ws.auto_advance,
               ws.issue_blocks_severity, ws.timeout_minutes, ws.is_active, ws.created_at,
               sac.id AS api_config_id, sac.endpoint_id,
               ee.url AS endpoint_url, ee.method AS http_method, ee.name AS endpoint_name,
               sac.request_mapping, sac.response_mapping,
               sac.timeout_seconds, sac.max_retries, sac.retry_delay_seconds,
               sac.test_mode, sac.is_active AS api_config_active
        FROM workflow_stages ws
        LEFT JOIN stage_api_configs sac ON sac.stage_id = ws.id AND sac.is_active = true
        LEFT JOIN external_endpoints ee ON ee.id = sac.endpoint_id
        WHERE ws.workflow_definition_id = ${id}
        ORDER BY ws.order_index
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching workflow stages:", error);
      res.status(500).json({ message: "Failed to fetch workflow stages" });
    }
  });

  // Get stage API config
  app.get("/api/admin/workflows/:id/stages/:stageId/api-config", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const stageId = parseInt(req.params.stageId);
      // Task #43: legacy workflow_endpoints retired — the shared registry
      // (external_endpoints) is the only source of transport for stages.
      const result = await dynamicDB.execute(sqlTag`
        SELECT sac.*,
               ee.name AS endpoint_name,
               ee.url  AS endpoint_url,
               ee.method AS http_method,
               ee.auth_type AS endpoint_auth_type
        FROM stage_api_configs sac
        LEFT JOIN external_endpoints ee ON ee.id = sac.endpoint_id
        WHERE sac.stage_id = ${stageId}
        ORDER BY sac.id LIMIT 1
      `);
      const rows = result.rows ?? result;
      res.json(rows[0] ?? null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stage API config" });
    }
  });

  // Upsert stage API config (link endpoint to stage)
  app.put("/api/admin/workflows/:id/stages/:stageId/api-config", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const stageApiCfgSchema = z.object({
        integration_id: z.union([z.string(), z.number()]).nullable().optional(),
        endpoint_id: z.union([z.string(), z.number()]).nullable().optional(),
        request_mapping: z.record(z.any()).nullable().optional(),
        response_mapping: z.record(z.any()).nullable().optional(),
        timeout_seconds: z.number().nullable().optional(),
        max_retries: z.number().optional(),
        retry_delay_seconds: z.number().optional(),
        fallback_on_error: z.any().nullable().optional(),
        fallback_on_timeout: z.any().nullable().optional(),
        test_mode: z.boolean().optional(),
        mock_response: z.record(z.any()).nullable().optional(),
        is_active: z.boolean().optional(),
      });
      const parsed = stageApiCfgSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stage API config payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const stageId = parseInt(req.params.stageId);
      const currentUser = req.currentUser;
      const {
        integration_id, endpoint_id,
        request_mapping, response_mapping,
        timeout_seconds, max_retries = 3, retry_delay_seconds = 5,
        fallback_on_error, fallback_on_timeout,
        test_mode = false, mock_response, is_active = true,
      } = parsed.data;
      // Check if exists
      const existing = await dynamicDB.execute(sqlTag`SELECT id FROM stage_api_configs WHERE stage_id = ${stageId} LIMIT 1`);
      const existingRows = existing.rows ?? existing;
      let result;
      if (existingRows.length > 0) {
        result = await dynamicDB.execute(sqlTag`
          UPDATE stage_api_configs SET
            integration_id = ${integration_id ?? null},
            endpoint_id = ${endpoint_id ?? null},
            request_mapping = ${request_mapping ? JSON.stringify(request_mapping) : null}::jsonb,
            response_mapping = ${response_mapping ? JSON.stringify(response_mapping) : null}::jsonb,
            timeout_seconds = ${timeout_seconds ?? null},
            max_retries = ${max_retries},
            retry_delay_seconds = ${retry_delay_seconds},
            fallback_on_error = ${fallback_on_error ?? null},
            fallback_on_timeout = ${fallback_on_timeout ?? null},
            test_mode = ${test_mode},
            mock_response = ${mock_response ? JSON.stringify(mock_response) : null}::jsonb,
            is_active = ${is_active},
            updated_at = NOW()
          WHERE stage_id = ${stageId}
          RETURNING *
        `);
      } else {
        result = await dynamicDB.execute(sqlTag`
          INSERT INTO stage_api_configs (
            stage_id, integration_id, endpoint_id,
            request_mapping, response_mapping,
            timeout_seconds, max_retries, retry_delay_seconds,
            fallback_on_error, fallback_on_timeout, test_mode, mock_response,
            is_active, created_by, created_at, updated_at
          ) VALUES (
            ${stageId}, ${integration_id ?? null}, ${endpoint_id ?? null},
            ${request_mapping ? JSON.stringify(request_mapping) : null}::jsonb,
            ${response_mapping ? JSON.stringify(response_mapping) : null}::jsonb,
            ${timeout_seconds ?? null}, ${max_retries}, ${retry_delay_seconds},
            ${fallback_on_error ?? null}, ${fallback_on_timeout ?? null},
            ${test_mode}, ${mock_response ? JSON.stringify(mock_response) : null}::jsonb,
            ${is_active}, ${currentUser?.id ?? 'system'}, NOW(), NOW()
          ) RETURNING *
        `);
      }
      res.json((result.rows ?? result)[0]);
    } catch (error) {
      console.error("Error saving stage API config:", error);
      res.status(500).json({ message: "Failed to save stage API config" });
    }
  });

  // Delete stage API config
  app.delete("/api/admin/workflows/:id/stages/:stageId/api-config", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      await dynamicDB.execute(sqlTag`DELETE FROM stage_api_configs WHERE stage_id = ${parseInt(req.params.stageId)}`);
      res.json({ message: "API config removed" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete stage API config" });
    }
  });

  // Create a stage
  app.post("/api/admin/workflows/:id/stages", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const workflowId = parseInt(req.params.id);
      const stageSchema = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        stage_type: z.string().optional(),
        handler_key: z.string().nullable().optional(),
        is_required: z.boolean().optional(),
        requires_review: z.boolean().optional(),
        auto_advance: z.boolean().optional(),
        issue_blocks_severity: z.string().nullable().optional(),
        timeout_minutes: z.number().int().nullable().optional(),
        configuration: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      });
      const parsed = stageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stage payload", errors: parsed.error.flatten() });
      }
      const { code, name, description, stage_type = "manual", handler_key,
              is_required = true, requires_review = false, auto_advance = false,
              issue_blocks_severity, timeout_minutes, configuration = {}, is_active = true } = parsed.data;
      // Auto-assign order_index as max + 1
      const maxResult = await dynamicDB.execute(sqlTag`
        SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index
        FROM workflow_stages WHERE workflow_definition_id = ${workflowId}
      `);
      const nextIndex = (maxResult.rows ?? maxResult)[0]?.next_index ?? 0;
      const result = await dynamicDB.execute(sqlTag`
        INSERT INTO workflow_stages
          (workflow_definition_id, code, name, description, order_index, stage_type,
           handler_key, is_required, requires_review, auto_advance, issue_blocks_severity,
           timeout_minutes, configuration, is_active, created_at, updated_at)
        VALUES (
          ${workflowId}, ${code}, ${name}, ${description ?? null}, ${nextIndex},
          ${stage_type}, ${handler_key ?? null}, ${is_required}, ${requires_review},
          ${auto_advance}, ${issue_blocks_severity ?? null}, ${timeout_minutes ?? null},
          ${JSON.stringify(configuration)}, ${is_active}, NOW(), NOW()
        )
        RETURNING *
      `);
      res.status(201).json((result.rows ?? result)[0]);
    } catch (error) {
      console.error("Error creating stage:", error);
      res.status(500).json({ message: "Failed to create stage" });
    }
  });

  // Update a stage
  app.put("/api/admin/workflows/:id/stages/:stageId", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const stageUpdateSchema = z.object({
        code: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        stage_type: z.string().optional(),
        handler_key: z.string().nullable().optional(),
        is_required: z.boolean().optional(),
        requires_review: z.boolean().optional(),
        auto_advance: z.boolean().optional(),
        issue_blocks_severity: z.string().nullable().optional(),
        timeout_minutes: z.number().nullable().optional(),
        order_index: z.number().optional(),
        configuration: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      });
      const parsed = stageUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stage payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const stageId = parseInt(req.params.stageId);
      const { code, name, description, stage_type, handler_key, is_required,
              requires_review, auto_advance, issue_blocks_severity, timeout_minutes,
              order_index, configuration, is_active } = parsed.data;
      const result = await dynamicDB.execute(sqlTag`
        UPDATE workflow_stages SET
          code = COALESCE(${code ?? null}, code),
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          stage_type = COALESCE(${stage_type ?? null}, stage_type),
          handler_key = COALESCE(${handler_key ?? null}, handler_key),
          is_required = COALESCE(${is_required ?? null}, is_required),
          requires_review = COALESCE(${requires_review ?? null}, requires_review),
          auto_advance = COALESCE(${auto_advance ?? null}, auto_advance),
          issue_blocks_severity = COALESCE(${issue_blocks_severity ?? null}, issue_blocks_severity),
          timeout_minutes = COALESCE(${timeout_minutes ?? null}, timeout_minutes),
          order_index = COALESCE(${order_index ?? null}, order_index),
          configuration = COALESCE(${configuration ? JSON.stringify(configuration) : null}::jsonb, configuration),
          is_active = COALESCE(${is_active ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${stageId}
        RETURNING *
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Stage not found" });
      res.json(rows[0]);
    } catch (error) {
      console.error("Error updating stage:", error);
      res.status(500).json({ message: "Failed to update stage" });
    }
  });

  // Delete a stage
  app.delete("/api/admin/workflows/:id/stages/:stageId", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const stageId = parseInt(req.params.stageId);
      const result = await dynamicDB.execute(sqlTag`
        DELETE FROM workflow_stages WHERE id = ${stageId} RETURNING id
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Stage not found" });
      res.json({ message: "Stage deleted" });
    } catch (error) {
      console.error("Error deleting stage:", error);
      res.status(500).json({ message: "Failed to delete stage" });
    }
  });

  // ─── Workflow Tickets ─────────────────────────────────────────────────────
  app.get("/api/admin/workflow-tickets", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const workflowId = req.query.workflowId ? parseInt(req.query.workflowId as string) : null;
      const result = await dynamicDB.execute(sqlTag`
        SELECT wt.id, wt.ticket_number, wt.workflow_definition_id, wt.entity_type,
               wt.entity_id, wt.status, wt.sub_status, wt.priority, wt.risk_level,
               wt.risk_score, wt.assigned_to_id, wt.submitted_at, wt.started_at,
               wt.completed_at, wt.due_at, wt.review_count, wt.metadata,
               wt.created_at, wt.updated_at,
               ws.name AS current_stage_name, ws.code AS current_stage_code,
               ws.stage_type AS current_stage_type
        FROM workflow_tickets wt
        LEFT JOIN workflow_stages ws ON ws.id = wt.current_stage_id
        WHERE (${workflowId}::int IS NULL OR wt.workflow_definition_id = ${workflowId})
        ORDER BY wt.created_at DESC
        LIMIT 100
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching workflow tickets:", error);
      res.status(500).json({ message: "Failed to fetch workflow tickets" });
    }
  });

  app.get("/api/admin/workflow-tickets/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const ticketResult = await dynamicDB.execute(sqlTag`
        SELECT wt.*, ws.name AS current_stage_name, ws.code AS current_stage_code,
               u.username AS assigned_to_username, u.email AS assigned_to_email
        FROM workflow_tickets wt
        LEFT JOIN workflow_stages ws ON ws.id = wt.current_stage_id
        LEFT JOIN users u ON u.id = wt.assigned_to_id
        WHERE wt.id = ${id}
      `);
      const ticket = (ticketResult.rows ?? ticketResult)[0];
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const stageProgressResult = await dynamicDB.execute(sqlTag`
        SELECT wts.id, wts.ticket_id, wts.stage_id, wts.status,
               wts.result, wts.review_decision, wts.review_notes,
               wts.started_at, wts.completed_at, wts.error_message,
               ws.name AS stage_name, ws.code AS stage_code,
               ws.stage_type, ws.order_index, ws.requires_review
        FROM workflow_ticket_stages wts
        JOIN workflow_stages ws ON ws.id = wts.stage_id
        WHERE wts.ticket_id = ${id}
        ORDER BY ws.order_index
      `);

      const notesResult = await dynamicDB.execute(sqlTag`
        SELECT id, content, note_type, is_internal, created_by, created_at
        FROM workflow_notes WHERE ticket_id = ${id} ORDER BY created_at DESC LIMIT 20
      `);

      const issuesResult = await dynamicDB.execute(sqlTag`
        SELECT id, issue_code, issue_type, severity, title, description,
               status, score_impact, created_at
        FROM workflow_issues WHERE ticket_id = ${id} ORDER BY created_at DESC LIMIT 50
      `);

      res.json({
        ...ticket,
        stageProgress: stageProgressResult.rows ?? stageProgressResult,
        notes: notesResult.rows ?? notesResult,
        issues: issuesResult.rows ?? issuesResult,
      });
      return;
    } catch (error) {
      console.error("Error fetching workflow ticket:", error);
      res.status(500).json({ message: "Failed to fetch workflow ticket" });
      return;
    }
  });

  // Stage action: approve / reject / unblock
  app.patch("/api/admin/workflow-tickets/:ticketId/stages/:ticketStageId", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const stageActionSchema = z.object({
        action: z.enum(["approve", "reject", "unblock"]),
        notes: z.string().optional(),
      });
      const parsed = stageActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stage action payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const ticketId = parseInt(req.params.ticketId);
      const ticketStageId = parseInt(req.params.ticketStageId);
      const currentUser = req.currentUser;
      const { action, notes } = parsed.data;

      // Get the current ticket stage record with stage info
      const tsResult = await dynamicDB.execute(sqlTag`
        SELECT wts.*, ws.order_index, ws.workflow_definition_id
        FROM workflow_ticket_stages wts
        JOIN workflow_stages ws ON ws.id = wts.stage_id
        WHERE wts.id = ${ticketStageId} AND wts.ticket_id = ${ticketId}
      `);
      const ticketStage = (tsResult.rows ?? tsResult)[0];
      if (!ticketStage) return res.status(404).json({ message: "Stage record not found" });

      const isApprove = action === "approve" || action === "unblock";
      const newStatus = isApprove ? "completed" : "failed";
      const newResult = isApprove ? "approved" : "rejected";
      const reviewDecision = action === "unblock" ? null : action;

      // ── Dispatch back into the underwriting domain ──
      // When an underwriter approves/rejects a manual phase (Derogatory
      // or G2) from the unified Worklist, the underwriting domain must
      // remain the system of record. Run the manual phase first so
      // underwriting_runs / underwriting_phase_results / underwriting_issues
      // get the canonical record; the orchestrator's mirror updates the
      // workflow_ticket_stage row, then our UPDATE below layers the
      // review_decision/notes/reviewer metadata on top.
      // Auto-resolve any open issues for the phase on approval so the
      // ticket isn't blocked by stale issues. On rejection we leave the
      // issues open for follow-up.
      try {
        const { loadTicketContext } = await import("./underwriting/workflowMirror");
        const { runManualPhase } = await import("./underwriting/orchestrator");
        const { underwritingIssues } = await import("@shared/schema");
        const { eq: eqOp, and: andOp } = await import("drizzle-orm");
        const ctx = await loadTicketContext(dynamicDB as unknown as Parameters<typeof loadTicketContext>[0], ticketStageId);
        if (ctx && ctx.stageType === "manual" &&
            (ctx.handlerKey === "derogatory_check" || ctx.handlerKey === "g2_check")) {
          if (isApprove) {
            await runManualPhase({
              db: dynamicDB as unknown as Parameters<typeof runManualPhase>[0]["db"],
              applicationId: ctx.applicationId,
              phaseKey: ctx.handlerKey,
              startedBy: currentUser?.id ?? null,
            });
            // db-tier-allow: legacy direct DB use; route-layer access tracked for storage-layer migration
            await dynamicDB.update(underwritingIssues)
              .set({ status: "resolved", resolvedBy: currentUser?.id ?? "system", resolvedAt: new Date(),
                     resolutionNote: notes ?? `Auto-resolved by Worklist ${action}` })
              .where(andOp(eqOp(underwritingIssues.applicationId, ctx.applicationId),
                           eqOp(underwritingIssues.phaseKey, ctx.handlerKey),
                           eqOp(underwritingIssues.status, "open")));
          }
          // On reject we deliberately do not auto-run the phase — the
          // reviewer is asserting a decision; leave the underwriting
          // domain to be moved by the explicit /transition endpoint.
        }
      } catch (dispatchErr) {
        console.error("[workflow-tickets] underwriting dispatch failed:", dispatchErr);
      }

      // Update the ticket stage
      await dynamicDB.execute(sqlTag`
        UPDATE workflow_ticket_stages SET
          status = ${newStatus},
          result = ${newResult},
          completed_at = NOW(),
          review_decision = ${reviewDecision},
          review_notes = ${notes ?? null},
          reviewed_at = NOW(),
          reviewed_by = ${currentUser?.id ?? 'system'},
          updated_at = NOW()
        WHERE id = ${ticketStageId}
      `);

      if (isApprove) {
        // Find the next stage in the workflow
        const nextStageResult = await dynamicDB.execute(sqlTag`
          SELECT id FROM workflow_stages
          WHERE workflow_definition_id = ${ticketStage.workflow_definition_id}
            AND order_index > ${ticketStage.order_index}
            AND is_active = true
          ORDER BY order_index
          LIMIT 1
        `);
        const nextStageRows = nextStageResult.rows ?? nextStageResult;

        if (nextStageRows.length > 0) {
          const nextStageId = (nextStageRows[0] as { id: number }).id;
          // Check if ticket stage record already exists for next stage
          const existingNext = await dynamicDB.execute(sqlTag`
            SELECT id FROM workflow_ticket_stages WHERE ticket_id = ${ticketId} AND stage_id = ${nextStageId}
          `);
          if ((existingNext.rows ?? existingNext).length === 0) {
            await dynamicDB.execute(sqlTag`
              INSERT INTO workflow_ticket_stages (ticket_id, stage_id, status, created_at, updated_at)
              VALUES (${ticketId}, ${nextStageId}, 'pending', NOW(), NOW())
            `);
          } else {
            await dynamicDB.execute(sqlTag`
              UPDATE workflow_ticket_stages SET status = 'pending', updated_at = NOW()
              WHERE ticket_id = ${ticketId} AND stage_id = ${nextStageId}
            `);
          }
          // Advance ticket's current stage
          await dynamicDB.execute(sqlTag`
            UPDATE workflow_tickets SET
              current_stage_id = ${nextStageId},
              status = 'in_progress',
              updated_at = NOW()
            WHERE id = ${ticketId}
          `);
        } else {
          // No more stages — ticket is complete
          await dynamicDB.execute(sqlTag`
            UPDATE workflow_tickets SET
              status = 'approved',
              completed_at = NOW(),
              updated_at = NOW()
            WHERE id = ${ticketId}
          `);
        }
      } else {
        // Rejected — mark ticket as declined
        await dynamicDB.execute(sqlTag`
          UPDATE workflow_tickets SET status = 'declined', updated_at = NOW() WHERE id = ${ticketId}
        `);
      }

      // Add a note recording the action
      const noteContent = `Stage "${ticketStage.stage_name ?? ticketStageId}" ${action}d by ${currentUser?.username ?? currentUser?.id ?? 'admin'}${notes ? `: ${notes}` : ""}.`;
      await dynamicDB.execute(sqlTag`
        INSERT INTO workflow_notes (ticket_id, content, note_type, is_internal, created_by, created_at, updated_at)
        VALUES (${ticketId}, ${noteContent}, 'action', true, ${currentUser?.id ?? 'system'}, NOW(), NOW())
      `);

      res.json({ message: `Stage ${action}d successfully` });
    } catch (error) {
      console.error("Error performing stage action:", error);
      res.status(500).json({ message: "Failed to perform stage action" });
    }
  });

  // Get staff users for workflow assignment
  app.get("/api/admin/workflow-users", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT id, username, email, roles
        FROM users
        WHERE roles && ARRAY['admin','super_admin','agent','corporate']::text[]
        ORDER BY username
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workflow users" });
    }
  });

  // Assign / unassign a ticket
  app.patch("/api/admin/workflow-tickets/:id/assign", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const assignSchema = z.object({
        assigned_to_id: z.union([z.number(), z.string()]).nullable().optional(),
      });
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid assignment payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const ticketId = parseInt(req.params.id);
      const currentUser = req.currentUser;
      const { assigned_to_id } = parsed.data;

      if (assigned_to_id !== null && assigned_to_id !== undefined) {
        // Verify user exists
        const userCheck = await dynamicDB.execute(sqlTag`SELECT id, username FROM users WHERE id = ${assigned_to_id}`);
        if ((userCheck.rows ?? userCheck).length === 0) {
          return res.status(404).json({ message: "User not found" });
        }
        await dynamicDB.execute(sqlTag`
          UPDATE workflow_tickets SET
            assigned_to_id = ${assigned_to_id},
            assigned_at = NOW(),
            updated_at = NOW()
          WHERE id = ${ticketId}
        `);
        const assignee = ((userCheck.rows ?? userCheck)[0] as { username: string }).username;
        // Log to notes
        await dynamicDB.execute(sqlTag`
          INSERT INTO workflow_notes (ticket_id, content, note_type, is_internal, created_by, created_at, updated_at)
          VALUES (${ticketId}, ${`Ticket assigned to ${assignee} by ${currentUser?.username ?? currentUser?.id ?? 'admin'}.`}, 'action', true, ${currentUser?.id ?? 'system'}, NOW(), NOW())
        `);
      } else {
        await dynamicDB.execute(sqlTag`
          UPDATE workflow_tickets SET
            assigned_to_id = NULL,
            assigned_at = NULL,
            updated_at = NOW()
          WHERE id = ${ticketId}
        `);
        await dynamicDB.execute(sqlTag`
          INSERT INTO workflow_notes (ticket_id, content, note_type, is_internal, created_by, created_at, updated_at)
          VALUES (${ticketId}, ${`Ticket unassigned by ${currentUser?.username ?? currentUser?.id ?? 'admin'}.`}, 'action', true, ${currentUser?.id ?? 'system'}, NOW(), NOW())
        `);
      }
      res.json({ message: assigned_to_id ? "Ticket assigned" : "Ticket unassigned" });
    } catch (error) {
      console.error("Error assigning ticket:", error);
      res.status(500).json({ message: "Failed to assign ticket" });
    }
  });

  // ─── Application Templates (Acquirers + Templates) ───────────────────────
  app.get("/api/admin/acquirers", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`SELECT id, name, display_name, code, description, is_active, created_at FROM acquirers ORDER BY name`);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching acquirers:", error);
      res.status(500).json({ message: "Failed to fetch acquirers" });
    }
  });

  app.get("/api/admin/acquirers/:id/templates", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT t.id, t.template_name, t.version, t.is_active, t.created_at, t.updated_at,
               a.name AS acquirer_name
        FROM acquirer_application_templates t
        JOIN acquirers a ON a.id = t.acquirer_id
        WHERE t.acquirer_id = ${parseInt(req.params.id)}
        ORDER BY t.template_name
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/admin/application-templates", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT t.id, t.template_name, t.version, t.is_active, t.created_at, t.updated_at,
               a.id AS acquirer_id, a.name AS acquirer_name, a.code AS acquirer_code
        FROM acquirer_application_templates t
        JOIN acquirers a ON a.id = t.acquirer_id
        ORDER BY a.name, t.template_name
      `);
      res.json(result.rows ?? result);
    } catch (error) {
      console.error("Error fetching application templates:", error);
      res.status(500).json({ message: "Failed to fetch application templates" });
    }
  });

  app.get("/api/admin/application-templates/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT t.*, a.name AS acquirer_name, a.code AS acquirer_code
        FROM acquirer_application_templates t
        JOIN acquirers a ON a.id = t.acquirer_id
        WHERE t.id = ${parseInt(req.params.id)}
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Template not found" });
      res.json(rows[0]);
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  app.patch("/api/admin/application-templates/:id/toggle", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const parsed = z.object({}).strict().safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid toggle payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      await dynamicDB.execute(sqlTag`
        UPDATE acquirer_application_templates SET is_active = NOT is_active, updated_at = NOW() WHERE id = ${parseInt(req.params.id)}
      `);
      res.json({ message: "Template status updated" });
    } catch (error) {
      console.error("Error toggling template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });


  // ============================================================
  // Acquirer Management API endpoints
  // ============================================================

  app.get('/api/acquirers', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirers } = await import("@shared/schema");
      const allAcquirers = await dbToUse.select().from(acquirers).orderBy(acquirers.name);
      res.json(allAcquirers);
    } catch (error) {
      console.error('Error fetching acquirers:', error);
      res.status(500).json({ error: 'Failed to fetch acquirers' });
    }
  });

  app.post('/api/acquirers', dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertAcquirerSchema'), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const parsed = insertAcquirerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid acquirer payload", details: parsed.error.flatten() });
      }
      const { acquirers } = await import("@shared/schema");
      const [newAcquirer] = await dbToUse.insert(acquirers).values(parsed.data).returning();
      res.status(201).json(newAcquirer);
    } catch (error) {
      console.error('Error creating acquirer:', error);
      res.status(500).json({ error: 'Failed to create acquirer' });
    }
  });

  app.get('/api/acquirers/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const acquirerId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [acquirer] = await dbToUse.select().from(acquirers).where(eq(acquirers.id, acquirerId)).limit(1);
      if (!acquirer) return res.status(404).json({ error: "Acquirer not found" });
      const templates = await dbToUse.select()
        .from(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.acquirerId, acquirerId))
        .orderBy(acquirerApplicationTemplates.templateName);
      res.json({ ...acquirer, templates });
    } catch (error) {
      console.error('Error fetching acquirer:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer' });
    }
  });

  app.put('/api/acquirers/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertAcquirerSchema'), async (req: RequestWithDB, res: Response) => {
    try {
      const acquirerId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const parsed = insertAcquirerSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid acquirer payload', details: parsed.error.flatten() });
      }
      const updateData = parsed.data;
      const { acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [updatedAcquirer] = await dbToUse.update(acquirers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(acquirers.id, acquirerId))
        .returning();
      if (!updatedAcquirer) return res.status(404).json({ error: "Acquirer not found" });
      res.json(updatedAcquirer);
    } catch (error) {
      console.error('Error updating acquirer:', error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      res.status(500).json({ error: 'Failed to update acquirer' });
    }
  });

  // Application counts endpoint (must be before /:id route)
  app.get('/api/acquirer-application-templates/application-counts', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { sql: sqlTag } = await import("drizzle-orm");
      const result = await dbToUse.execute(sqlTag`
        SELECT template_id, COUNT(*) as count
        FROM prospect_applications
        GROUP BY template_id
      `);
      const rows = ((result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])) as Array<{ template_id: number | string; count: number | string }>;
      const counts: Record<number, number> = {};
      for (const row of rows) {
        counts[Number(row.template_id)] = Number(row.count);
      }
      res.json(counts);
    } catch (error) {
      console.error('Error fetching application counts:', error);
      res.status(500).json({ error: 'Failed to fetch application counts' });
    }
  });

  app.get('/api/acquirer-application-templates', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates, acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const templates = await dbToUse.select({
        id: acquirerApplicationTemplates.id,
        acquirerId: acquirerApplicationTemplates.acquirerId,
        templateName: acquirerApplicationTemplates.templateName,
        version: acquirerApplicationTemplates.version,
        isActive: acquirerApplicationTemplates.isActive,
        fieldConfiguration: acquirerApplicationTemplates.fieldConfiguration,
        pdfMappingConfiguration: acquirerApplicationTemplates.pdfMappingConfiguration,
        originalPdfFilename: acquirerApplicationTemplates.originalPdfFilename,
        requiredFields: acquirerApplicationTemplates.requiredFields,
        conditionalFields: acquirerApplicationTemplates.conditionalFields,
        addressGroups: acquirerApplicationTemplates.addressGroups,
        signatureGroups: acquirerApplicationTemplates.signatureGroups,
        createdAt: acquirerApplicationTemplates.createdAt,
        updatedAt: acquirerApplicationTemplates.updatedAt,
        acquirer: {
          id: acquirers.id,
          name: acquirers.name,
          displayName: acquirers.displayName,
          code: acquirers.code
        }
      })
      .from(acquirerApplicationTemplates)
      .leftJoin(acquirers, eq(acquirerApplicationTemplates.acquirerId, acquirers.id))
      .orderBy(acquirerApplicationTemplates.templateName);
      const templatesWithPdfFlag = templates.map(t => ({
        ...t,
        hasOriginalPdf: !!t.originalPdfFilename,
      }));
      res.json(templatesWithPdfFlag);
    } catch (error) {
      console.error('Error fetching acquirer application templates:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer application templates' });
    }
  });

  // PDF upload for template parsing
  app.post('/api/acquirer-application-templates/upload', dbEnvironmentMiddleware, requirePerm('admin:manage'), upload.single('pdf'), async (req: RequestWithDB, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });

      const pdfBuffer = req.file.buffer;
      const parseResult = await pdfFormParser.parsePDFForm(pdfBuffer);

      let templateData: any = {};
      if (req.body.templateData) {
        try {
          templateData = JSON.parse(req.body.templateData);
        } catch (e) {
          console.error('Failed to parse templateData:', e);
        }
      }
      const acquirerIdRaw = templateData.acquirerId || req.body.acquirerId;
      const templateNameRaw = templateData.templateName || req.body.templateName;

      if (acquirerIdRaw && templateNameRaw) {
        const acquirerId = parseInt(acquirerIdRaw);
        const { acquirerApplicationTemplates } = await import("@shared/schema");
        const fieldConfiguration = {
          sections: parseResult.sections.map((section: any) => ({
            id: `section_${section.title.toLowerCase().replace(/\s+/g, '_')}`,
            title: section.title,
            description: section.description || '',
            fields: section.fields.map((field: any) => ({
              id: field.fieldName,
              type: field.fieldType,
              label: field.fieldLabel,
              required: field.isRequired || false,
              placeholder: field.placeholder || '',
              description: field.description || '',
              options: field.options || undefined,
              pattern: field.pattern || undefined,
              min: field.min || undefined,
              max: field.max || undefined,
              sensitive: field.sensitive || false,
              pdfFieldId: field.pdfFieldId,
              pdfFieldIds: field.pdfFieldIds || field.rawPdfFieldNames
            }))
          }))
        };
        const [newTemplate] = await dbToUse.insert(acquirerApplicationTemplates).values({
          acquirerId,
          templateName: templateNameRaw,
          version: templateData.version || req.body.version || '1.0',
          isActive: true,
          fieldConfiguration,
          pdfMappingConfiguration: parseResult.rawFields || {},
          originalPdfBase64: pdfBuffer.toString('base64'),
          originalPdfFilename: req.file.originalname || 'uploaded.pdf',
          requiredFields: [],
          conditionalFields: []
        }).returning();
        return res.status(201).json({ template: newTemplate, parseResult });
      }

      res.json({ parseResult });
    } catch (error) {
      console.error('Error processing PDF upload:', error);
      res.status(500).json({ error: 'Failed to process PDF' });
    }
  });

  app.get('/api/acquirer-application-templates/:id/parse-diagnostics', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [template] = await dbToUse.select().from(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, templateId)).limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });

      if (!template.originalPdfBase64) {
        return res.json({
          templateId,
          templateName: template.templateName,
          hasOriginalPdf: false,
          parseResult: null,
          message: 'No original PDF stored. Upload a PDF to see parse diagnostics.',
        });
      }

      const pdfBuffer = Buffer.from(template.originalPdfBase64, 'base64');
      const parseResult = await pdfFormParser.parsePDFForm(pdfBuffer);

      res.json({
        templateId,
        templateName: template.templateName,
        hasOriginalPdf: true,
        parseResult: {
          totalFields: parseResult.totalFields,
          warnings: parseResult.warnings,
          summary: parseResult.summary,
          sections: parseResult.sections.map((s: any) => ({
            title: s.title,
            order: s.order,
            fieldCount: s.fields.length,
            fields: s.fields.map((f: any) => ({
              fieldName: f.fieldName,
              fieldType: f.fieldType,
              fieldLabel: f.fieldLabel,
              pdfFieldId: f.pdfFieldId,
              rawPdfFieldNames: f.rawPdfFieldNames,
            })),
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching parse diagnostics:', error);
      res.status(500).json({ error: 'Failed to generate parse diagnostics' });
    }
  });

  app.get('/api/acquirer-application-templates/:id/field-mapping', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [template] = await dbToUse.select().from(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, templateId)).limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const rawFields: any[] = Array.isArray(template.pdfMappingConfiguration) ? template.pdfMappingConfiguration : [];
      const fieldConfig: any = template.fieldConfiguration || {};
      const templateFields: any[] = [];
      if (Array.isArray(fieldConfig.sections)) {
        for (const section of fieldConfig.sections) {
          if (Array.isArray(section.fields)) {
            for (const f of section.fields) {
              templateFields.push({ ...f, sectionTitle: section.title });
            }
          }
        }
      }

      const mappedPdfFieldIds = new Set<string>();
      for (const tf of templateFields) {
        if (tf.pdfFieldId) mappedPdfFieldIds.add(tf.pdfFieldId);
      }

      const mappedFields = rawFields.filter((rf: any) => mappedPdfFieldIds.has(rf.pdfFieldId));
      const unmappedFields = rawFields.filter((rf: any) => !mappedPdfFieldIds.has(rf.pdfFieldId));
      const templateFieldsWithoutMapping = templateFields.filter(tf => !tf.pdfFieldId);

      res.json({
        success: true,
        templateId,
        totalPdfFields: rawFields.length,
        totalTemplateFields: templateFields.length,
        mappedCount: mappedFields.length,
        unmappedPdfFields: unmappedFields,
        unmappedTemplateFields: templateFieldsWithoutMapping,
        mappedFields: mappedFields.map((rf: any) => {
          const tf = templateFields.find(t => t.pdfFieldId === rf.pdfFieldId);
          return { pdfField: rf, templateField: tf || null };
        }),
        allPdfFields: rawFields,
      });
    } catch (error) {
      console.error('Error fetching field mapping:', error);
      res.status(500).json({ error: 'Failed to fetch field mapping' });
    }
  });

  app.put('/api/acquirer-application-templates/:id/field-mapping', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [template] = await dbToUse.select().from(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, templateId)).limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const fieldMappingSchema = z.object({
        pdfFieldId: z.string(),
        templateFieldId: z.string(),
        action: z.enum(['map', 'unmap']).optional(),
      });
      const fmParsed = fieldMappingSchema.safeParse(req.body);
      if (!fmParsed.success) {
        return res.status(400).json({ error: "Invalid field mapping payload", details: fmParsed.error.flatten() });
      }
      const { pdfFieldId, templateFieldId, action } = fmParsed.data;

      const existingConfig = (template.fieldConfiguration ?? {}) as import("@shared/schema").PdfTemplateFieldConfiguration;
      const fieldConfig: import("@shared/schema").PdfTemplateFieldConfiguration = { ...existingConfig };
      const rawFields: import("@shared/schema").PdfMappingEntry[] = Array.isArray(template.pdfMappingConfiguration)
        ? [...(template.pdfMappingConfiguration as import("@shared/schema").PdfMappingEntry[])]
        : [];

      const findTemplateField = (id: string) => {
        for (const section of fieldConfig.sections ?? []) {
          const field = section.fields?.find((f) => f.id === id);
          if (field) return field;
        }
        return undefined;
      };

      if (action === 'map') {
        const field = findTemplateField(templateFieldId);
        if (field) field.pdfFieldId = pdfFieldId;
        const rawIdx = rawFields.findIndex((rf) => rf.pdfFieldId === pdfFieldId);
        if (rawIdx >= 0) {
          rawFields[rawIdx] = { ...rawFields[rawIdx], mappedToTemplateField: templateFieldId, mappingStatus: 'manual' };
        }
      } else if (action === 'unmap') {
        const field = findTemplateField(templateFieldId);
        if (field) delete field.pdfFieldId;
        const rawIdx = rawFields.findIndex((rf) => rf.pdfFieldId === pdfFieldId);
        if (rawIdx >= 0) {
          rawFields[rawIdx] = { ...rawFields[rawIdx], mappedToTemplateField: null, mappingStatus: 'unmapped' };
        }
      }

      const [updated] = await dbToUse.update(acquirerApplicationTemplates).set({
        fieldConfiguration: fieldConfig,
        pdfMappingConfiguration: rawFields,
        updatedAt: new Date()
      }).where(eq(acquirerApplicationTemplates.id, templateId)).returning();

      res.json({ success: true, template: updated });
    } catch (error) {
      console.error('Error updating field mapping:', error);
      res.status(500).json({ error: 'Failed to update field mapping' });
    }
  });

  app.post('/api/acquirer-application-templates', dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertAcquirerApplicationTemplateSchema'), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const parsed = insertAcquirerApplicationTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid template payload", details: parsed.error.flatten() });
      }
      const [newTemplate] = await dbToUse.insert(acquirerApplicationTemplates).values(parsed.data).returning();
      res.status(201).json(newTemplate);
    } catch (error) {
      console.error('Error creating acquirer application template:', error);
      res.status(500).json({ error: 'Failed to create acquirer application template' });
    }
  });

  app.get('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates, acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [template] = await dbToUse.select()
        .from(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.id, templateId))
        .limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error('Error fetching acquirer application template:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer application template' });
    }
  });

  app.get('/api/acquirer-application-templates/:id/as-form', isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      let [template] = await dbToUse.select()
        .from(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.id, templateId))
        .limit(1);

      // If not found in session's DB, fall back to the dev database (templates are managed in dev)
      const sessionDbEnv: string = req.session?.dbEnv || 'production';
      const isAlreadyDevDB = sessionDbEnv === 'dev' || sessionDbEnv === 'development';
      if (!template && !isAlreadyDevDB) {
        const { getDynamicDatabase } = await import("./db");
        const devDB = getDynamicDatabase('dev');
        const [devTemplate] = await devDB.select()
          .from(acquirerApplicationTemplates)
          .where(eq(acquirerApplicationTemplates.id, templateId))
          .limit(1);
        if (devTemplate) template = devTemplate;
      }

      if (!template) return res.status(404).json({ error: "Template not found" });

      const fieldConfig: any = template.fieldConfiguration || {};
      const templateSections: any[] = Array.isArray(fieldConfig.sections) ? fieldConfig.sections : [];

      // requiredFields is a separate column: array of field IDs that are required
      const requiredFieldIds = new Set<string>(Array.isArray(template.requiredFields) ? template.requiredFields : []);

      const normalizeFieldType = (type: string): string => {
        switch (type) {
          case 'tel': return 'phone';
          case 'radio': return 'select';
          default: return type || 'text';
        }
      };

      let position = 0;
      const fields: any[] = [];
      templateSections.forEach((section: any) => {
        const sectionTitle: string = section.title || section.id || 'General';
        const sectionFields: any[] = Array.isArray(section.fields) ? section.fields : [];
        sectionFields.forEach((f: any) => {
          const fieldId = f.id || f.pdfFieldId || `field_${position + 1}`;
          fields.push({
            id: ++position,
            fieldName: fieldId,
            fieldType: normalizeFieldType(f.type),
            fieldLabel: f.label || f.id || `Field ${position}`,
            isRequired: requiredFieldIds.has(fieldId) || !!f.required || !!f.isRequired,
            options: Array.isArray(f.options) ? f.options : null,
            defaultValue: f.defaultValue ?? null,
            validation: f.validation ?? null,
            description: f.description || null,
            position,
            section: sectionTitle,
            disclosureDefinitionId: f.disclosureDefinitionId || null,
            disclosureTitle: f.disclosureTitle || null,
            requiresSignature: !!f.requiresSignature,
            maxSigners: f.maxSigners || null,
            signerLabel: f.signerLabel || null,
            ownerGroupConfig: f.ownerGroupConfig || null,
            conditional: f.conditional || null,
            displayOrientation: f.displayOrientation || null,
          });
        });
      });

      res.json({
        id: template.id,
        name: template.templateName,
        description: `Preview: ${template.templateName} v${template.version}`,
        fileName: '',
        fields
      });
    } catch (error) {
      console.error('Error converting acquirer application template to form:', error);
      res.status(500).json({ error: 'Failed to convert template to form' });
    }
  });

  app.put('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const parsed = insertAcquirerApplicationTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid template payload", details: parsed.error.flatten() });
      }
      const [updatedTemplate] = await dbToUse.update(acquirerApplicationTemplates)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(acquirerApplicationTemplates.id, templateId))
        .returning();
      if (!updatedTemplate) return res.status(404).json({ error: "Template not found" });
      res.json(updatedTemplate);
    } catch (error) {
      console.error('Error updating acquirer application template:', error);
      res.status(500).json({ error: 'Failed to update acquirer application template' });
    }
  });

  app.post('/api/acquirer-application-templates/:id/upload-pdf', dbEnvironmentMiddleware, requirePerm('admin:manage'), upload.single('pdf'), async (req: RequestWithDB, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [template] = await dbToUse.select().from(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, templateId)).limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const pdfBuffer = req.file.buffer;
      const parseResult = await pdfFormParser.parsePDFForm(pdfBuffer);

      const [updated] = await dbToUse.update(acquirerApplicationTemplates).set({
        originalPdfBase64: pdfBuffer.toString('base64'),
        originalPdfFilename: req.file.originalname || 'uploaded.pdf',
        updatedAt: new Date()
      }).where(eq(acquirerApplicationTemplates.id, templateId)).returning();

      res.json({
        success: true,
        message: "Original PDF uploaded successfully",
        originalPdfFilename: updated.originalPdfFilename,
        parseResult: {
          totalFields: parseResult.totalFields,
          warnings: parseResult.warnings,
          summary: parseResult.summary,
        }
      });
    } catch (error) {
      console.error('Error uploading PDF for template:', error);
      res.status(500).json({ error: 'Failed to upload PDF' });
    }
  });

  app.delete('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await dbToUse.delete(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, templateId));
      res.json({ message: "Template deleted successfully" });
    } catch (error) {
      console.error('Error deleting acquirer application template:', error);
      res.status(500).json({ error: 'Failed to delete acquirer application template' });
    }
  });


  app.get('/api/prospect-applications/:id/mapped-pdf', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      const dbToUse = req.dynamicDB;
      if (!dbToUse) return res.status(500).json({ error: "Database connection not available" });
      const { prospectApplications, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [application] = await dbToUse.select().from(prospectApplications).where(eq(prospectApplications.id, applicationId)).limit(1);
      if (!application) return res.status(404).json({ error: "Application not found" });

      const [template] = await dbToUse.select().from(acquirerApplicationTemplates).where(eq(acquirerApplicationTemplates.id, application.templateId)).limit(1);
      if (!template) return res.status(404).json({ error: "Template not found" });

      if (!template.originalPdfBase64) {
        return res.status(400).json({ error: "No original PDF stored for this template. Re-upload the PDF to enable filled PDF generation." });
      }

      const { pdfGenerator } = await import('./pdfGenerator');
      const pdfBuffer = await pdfGenerator.generateFilledPDF(
        template.originalPdfBase64,
        application.applicationData as Record<string, any>,
        template.fieldConfiguration,
        Array.isArray(template.pdfMappingConfiguration) ? template.pdfMappingConfiguration as unknown[] : []
      );

      const safeFilename = template.templateName.replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_application_${applicationId}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating filled PDF:', error);
      res.status(500).json({ error: 'Failed to generate filled PDF' });
    }
  });

  // ============================================================
  // MCC Codes API
  // ============================================================

  app.get('/api/mcc-codes/categories', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (_req: RequestWithDB, res: Response) => {
    try {
      const categories = await storage.listMccCategories();
      res.json(categories);
    } catch (error) {
      console.error('Error fetching MCC categories:', error);
      res.status(500).json({ error: 'Failed to fetch MCC categories' });
    }
  });

  app.get('/api/mcc-codes', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { search, category } = req.query;
      const results = await storage.listMccCodes({
        search: typeof search === "string" ? search : undefined,
        category: typeof category === "string" ? category : undefined,
      });
      res.json(results);
    } catch (error) {
      console.error('Error fetching MCC codes:', error);
      res.status(500).json({ error: 'Failed to fetch MCC codes' });
    }
  });

  app.get('/api/mcc-codes/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const code = await storage.getMccCode(parseInt(req.params.id));
      if (!code) return res.status(404).json({ error: 'MCC code not found' });
      res.json(code);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch MCC code' });
    }
  });

  app.post('/api/mcc-codes', dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertMccCodeSchema'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertMccCodeSchema } = await import("@shared/schema");
      const validated = insertMccCodeSchema.parse(req.body);
      const newCode = await storage.createMccCode(validated);
      res.status(201).json(newCode);
    } catch (error) {
      console.error('Error creating MCC code:', error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
      res.status(500).json({ error: 'Failed to create MCC code' });
    }
  });

  app.patch('/api/mcc-codes/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertMccCodeSchema } = await import("@shared/schema");
      const parsed = insertMccCodeSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid MCC code payload", details: parsed.error.flatten() });
      }
      const updated = await storage.updateMccCode(parseInt(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ error: 'MCC code not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update MCC code' });
    }
  });

  app.delete('/api/mcc-codes/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      await storage.deleteMccCode(parseInt(req.params.id));
      res.json({ message: 'MCC code deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete MCC code' });
    }
  });

  // Public MCC search (used by autocomplete in forms)
  app.get('/api/mcc/search', async (req: RequestWithDB, res: Response) => {
    try {
      const q = req.query.q as string || '';
      if (!q || q.length < 2) return res.json({ suggestions: [] });
      const results = await storage.searchActiveMccCodes(q, 10);
      res.json({ suggestions: results.map((r) => ({ mcc: r.code, description: r.description, category: r.category, irs_description: r.description })) });
    } catch (error) {
      res.status(500).json({ suggestions: [] });
    }
  });

  // ============================================================
  // MCC Policies API
  // ============================================================

  app.get('/api/mcc-policies', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (_req: RequestWithDB, res: Response) => {
    try {
      const policies = await storage.listMccPoliciesWithRefs();
      res.json(policies);
    } catch (error) {
      console.error('Error fetching MCC policies:', error);
      res.status(500).json({ error: 'Failed to fetch MCC policies' });
    }
  });

  app.post('/api/mcc-policies', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertMccPolicySchema } = await import("@shared/schema");
      const session = req.session;
      const parsed = insertMccPolicySchema.safeParse({ ...req.body, createdBy: session?.userId });
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const newPolicy = await storage.createMccPolicy(parsed.data);
      res.status(201).json(newPolicy);
    } catch (error) {
      console.error('Error creating MCC policy:', error);
      res.status(500).json({ error: 'Failed to create MCC policy' });
    }
  });

  app.patch('/api/mcc-policies/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertMccPolicySchema } = await import("@shared/schema");
      const parsed = insertMccPolicySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid MCC policy payload", details: parsed.error.flatten() });
      }
      const updated = await storage.updateMccPolicy(parseInt(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ error: 'MCC policy not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update MCC policy' });
    }
  });

  app.delete('/api/mcc-policies/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      await storage.deleteMccPolicy(parseInt(req.params.id));
      res.json({ message: 'MCC policy deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete MCC policy' });
    }
  });

  // ============================================================
  // Disclosure Library API
  // ============================================================

  app.get('/api/disclosures', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (_req: RequestWithDB, res: Response) => {
    try {
      const disclosures = await storage.listDisclosuresWithVersions();
      res.json({ success: true, disclosures });
    } catch (error) {
      console.error('Error fetching disclosures:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosures' });
    }
  });

  app.get('/api/disclosures/:id/signature-report', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const report = await storage.getDisclosureSignatureReport(parseInt(req.params.id));
      res.json({ success: true, report });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to get signature report' });
    }
  });

  app.get('/api/disclosures/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const disclosureId = parseInt(req.params.id);
      let disclosure: Awaited<ReturnType<typeof storage.getDisclosureWithVersions>> | null = null;
      try {
        disclosure = await storage.getDisclosureWithVersions(disclosureId);
      } catch (tableErr: any) {
        if (!tableErr?.message?.includes('does not exist')) throw tableErr;
      }

      if (!disclosure) {
        // Cross-env fallback: try dev DB
        const sessionDbEnv: string = req.session?.dbEnv || 'production';
        const isAlreadyDevDB = sessionDbEnv === 'dev' || sessionDbEnv === 'development';
        if (!isAlreadyDevDB) {
          try {
            const { getDynamicDatabase, runWithDb } = await import("./db");
            const devDB = getDynamicDatabase('dev');
            disclosure = await runWithDb(devDB, () => storage.getDisclosureWithVersions(disclosureId));
          } catch { /* noop: cross-env disclosure lookup is best-effort */ }
        }
      }

      if (!disclosure) return res.status(404).json({ success: false, message: 'Disclosure not found' });
      res.json({ success: true, disclosure });
    } catch (error: any) {
      console.error('Error retrieving disclosure:', error?.message || error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosure' });
    }
  });

  app.post('/api/disclosures', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const session = req.session;
      const bodySchema = z.object({
        slug: z.string().min(1),
        displayName: z.string().min(1),
        description: z.string().nullable().optional(),
        category: z.string().optional(),
        requiresSignature: z.boolean().optional(),
        companyId: z.coerce.number().nullable().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid disclosure payload', errors: parsed.error.flatten() });
      }
      const { slug, displayName, description, category, requiresSignature, companyId } = parsed.data;
      const newDef = await storage.createDisclosure({
        slug, displayName, description: description || null, category: category || 'general',
        requiresSignature: requiresSignature || false, companyId: companyId || null,
        createdBy: session?.userId || null, isActive: true,
      });
      res.status(201).json({ success: true, disclosure: { ...newDef, versions: [], currentVersion: null } });
    } catch (error) {
      console.error('Error creating disclosure:', error);
      res.status(500).json({ success: false, message: 'Failed to create disclosure' });
    }
  });

  app.patch('/api/disclosures/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertDisclosureDefinitionSchema } = await import("@shared/schema");
      const parsed = insertDisclosureDefinitionSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid disclosure payload", errors: parsed.error.flatten() });
      }
      const updated = await storage.updateDisclosure(parseInt(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ success: false, message: 'Disclosure not found' });
      res.json({ success: true, disclosure: updated });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update disclosure' });
    }
  });

  app.delete('/api/disclosures/:id', dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req: RequestWithDB, res: Response) => {
    try {
      await storage.deleteDisclosure(parseInt(req.params.id));
      res.json({ success: true, message: 'Disclosure deleted' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete disclosure' });
    }
  });

  app.post('/api/disclosures/:definitionId/versions', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const definitionId = parseInt(req.params.definitionId);
      const session = req.session;
      const bodySchema = z.object({
        version: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
        requiresSignature: z.boolean().optional(),
        effectiveDate: z.union([z.string(), z.date()]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid disclosure version payload", errors: parsed.error.flatten() });
      }
      const { version, title, content, requiresSignature, effectiveDate } = parsed.data;
      const newVersion = await storage.createDisclosureVersion(definitionId, {
        version, title, content,
        requiresSignature: requiresSignature || false,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        createdBy: session?.userId || null,
        contentHash: Buffer.from(content).toString('base64').slice(0, 32),
      });
      res.status(201).json({ success: true, version: newVersion });
    } catch (error) {
      console.error('Error creating disclosure version:', error);
      res.status(500).json({ success: false, message: 'Failed to create disclosure version' });
    }
  });

  app.patch('/api/disclosure-versions/:id', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const { insertDisclosureVersionSchema } = await import("@shared/schema");
      const parsed = insertDisclosureVersionSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid disclosure version payload", errors: parsed.error.flatten() });
      }
      const updated = await storage.updateDisclosureVersion(parseInt(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ success: false, message: 'Version not found' });
      res.json({ success: true, version: updated });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update version' });
    }
  });

  app.post('/api/disclosure-versions/:id/copy', dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res: Response) => {
    try {
      const session = req.session;
      const bodySchema = z.object({
        version: z.string().min(1),
        title: z.string().min(1),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid copy payload", errors: parsed.error.flatten() });
      }
      const copy = await storage.copyDisclosureVersion(parseInt(req.params.id), {
        version: parsed.data.version,
        title: parsed.data.title,
      }, session?.userId || null);
      if (!copy) return res.status(404).json({ success: false, message: 'Version not found' });
      res.status(201).json({ success: true, version: copy });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to copy version' });
    }
  });

  // ─── Action Templates & Trigger System ──────────────────────────────────────

  // GET /api/action-templates — list all templates
  app.get("/api/action-templates", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const templates = await db.select().from(actionTemplates).orderBy(actionTemplates.name);
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch action templates", error: error.message });
    }
  });

  // GET /api/action-templates/usage — template usage stats
  app.get("/api/action-templates/usage", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const templates = await db.select().from(actionTemplates);
      const usage = await Promise.all(templates.map(async (t) => {
        const activity = await db.select().from(actionActivity).where(eq(actionActivity.actionTemplateId, t.id));
        return { templateId: t.id, templateName: t.name, usageCount: activity.length };
      }));
      res.json(usage);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch usage", error: error.message });
    }
  });

  // GET /api/action-templates/:id — fetch single template by ID
  app.get("/api/action-templates/:id", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid template id" });
      const [template] = await db.select().from(actionTemplates).where(eq(actionTemplates.id, id));
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch action template", error: error.message });
    }
  });

  // POST /api/action-templates — create template
  app.post("/api/action-templates", dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertActionTemplateSchema'), async (req: RequestWithDB, res) => {
    try {
      const { insertActionTemplateSchema } = await import("@shared/schema");
      const parsed = insertActionTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid action template payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [template] = await db.insert(actionTemplates).values(parsed.data).returning();
      res.status(201).json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create action template", error: error.message });
    }
  });

  // PATCH /api/action-templates/:id — update template
  app.patch("/api/action-templates/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertActionTemplateSchema } = await import("@shared/schema");
      const parsed = insertActionTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid action template payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [template] = await db.update(actionTemplates).set({ ...parsed.data, updatedAt: new Date() }).where(eq(actionTemplates.id, parseInt(req.params.id))).returning();
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update action template", error: error.message });
    }
  });

  // DELETE /api/action-templates/:id — delete template
  app.delete("/api/action-templates/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      await db.delete(actionTemplates).where(eq(actionTemplates.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete action template", error: error.message });
    }
  });

  // POST /api/action-templates/:id/test — test send a template
  app.post("/api/action-templates/:id/test", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { mode, config: inlineConfig, recipientEmail, endpointId: bodyEndpointId } = req.body;

      // Handle webhook live proxy
      if (mode === 'live') {
        // When a real template ID is given, verify it is a webhook template
        // and prefer transport from the External Endpoints Registry when set.
        const proxyIdStr = req.params.id;
        let storedTemplate: any = null;
        if (proxyIdStr !== 'preview' && !isNaN(parseInt(proxyIdStr))) {
          const db = req.db!;
          const [tmpl] = await db.select().from(actionTemplates).where(eq(actionTemplates.id, parseInt(proxyIdStr)));
          if (tmpl && tmpl.actionType !== 'webhook') {
            return res.status(400).json({ message: `Cannot run live request test on a '${tmpl.actionType}' template — only webhook templates support this mode.` });
          }
          storedTemplate = tmpl ?? null;
        }

        const cfg = inlineConfig || {};
        let bodyStr: string | undefined = cfg.body;

        // If the saved template references an endpoint, ALWAYS use the
        // registry transport so the test reflects what production will do.
        // Otherwise fall through to the inline `cfg` values supplied by the
        // editor (this is what unsaved drafts use).
        let url: string;
        let method: string;
        let finalHeaders: Record<string, string>;

        try {
          // Saved template's endpointId wins; otherwise honor an endpointId
          // passed by an unsaved draft from the editor.
          const effectiveEndpointId = storedTemplate?.endpointId ?? bodyEndpointId ?? null;
          if (effectiveEndpointId) {
            const { transport } = await resolveTemplateTransport({
              endpointId: effectiveEndpointId,
              config: storedTemplate?.config ?? cfg,
            });
            const finalized = finalizeTransport(transport);
            url = finalized.url;
            method = finalized.method;
            finalHeaders = finalized.headers;
          } else {
            const m = (cfg.method as string) || 'GET';
            let inlineUrl = cfg.url as string | undefined;
            let headersStr = cfg.headers as string | undefined;
            if (!inlineUrl) return res.status(400).json({ message: "No URL configured for this webhook" });
            inlineUrl = resolveSecrets(inlineUrl);
            if (headersStr) headersStr = resolveSecrets(headersStr);
            let parsedHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (headersStr) {
              try { parsedHeaders = { ...parsedHeaders, ...JSON.parse(headersStr) }; } catch { /* noop: malformed header JSON ignored, keep prior headers */ }
            }
            url = inlineUrl;
            method = m;
            finalHeaders = parsedHeaders;
          }

          if (bodyStr) bodyStr = resolveSecrets(bodyStr);
        } catch (secretErr: any) {
          return res.status(400).json({ message: secretErr.message });
        }

        const fetchOptions: RequestInit = { method, headers: finalHeaders };
        if (method !== 'GET' && method !== 'HEAD' && bodyStr) {
          fetchOptions.body = bodyStr;
        }

        const startTime = Date.now();
        const upstream = await fetch(url, fetchOptions);
        const elapsed = Date.now() - startTime;

        let data: any;
        const contentType = upstream.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await upstream.json();
        } else {
          const text = await upstream.text();
          try { data = JSON.parse(text); } catch { data = { _raw: text }; }
        }

        return res.json({
          success: upstream.ok,
          status: upstream.status,
          statusText: upstream.statusText,
          elapsed,
          data,
          mode: 'live',
        });
      }

      // Handle email test
      const db = req.db!;
      const idStr = req.params.id;
      if (idStr !== 'preview' && !isNaN(parseInt(idStr))) {
        const [template] = await db.select().from(actionTemplates).where(eq(actionTemplates.id, parseInt(idStr)));
        if (!template) return res.status(404).json({ message: "Template not found" });
        if (template.actionType === 'email' && recipientEmail) {
          const cfg = (template.config ?? {}) as Record<string, string | undefined>;
          await emailService.sendGenericEmail({
            to: recipientEmail,
            subject: `[TEST] ${cfg.subject || template.name}`,
            html: cfg.body || cfg.html || `<p>Test send of template: ${template.name}</p>`,
            text: cfg.text || `Test send of template: ${template.name}`,
          });
        }
      }

      res.json({ success: true, message: "Test sent successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to send test", error: error.message });
    }
  });

  // GET /api/admin/available-secrets — return env var names available for use as {{$SECRET_NAME}} references
  app.get("/api/admin/available-secrets", requirePerm('admin:manage'), (req, res) => {
    // System / infrastructure vars to never expose even by name
    const systemExclusions = new Set([
      'NODE_ENV', 'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'PWD', 'OLDPWD',
      'LOGNAME', 'SHLVL', 'HOSTNAME', 'PORT', 'HOST',
      'DATABASE_URL', 'DEV_DATABASE_URL', 'TEST_DATABASE_URL', 'SESSION_SECRET',
      'REPLIT_DB_URL', 'REPL_ID', 'REPL_SLUG', 'REPL_OWNER', 'REPL_IMAGE',
      'REPLIT_CLUSTER', 'REPLIT_DEPLOYMENT', 'REPLIT_ENV', 'REPLIT_DOMAINS',
      'NPM_CONFIG_LOGLEVEL', 'npm_lifecycle_event', 'npm_package_name',
    ]);
    const names = Object.keys(process.env)
      .filter(k => !systemExclusions.has(k) && !k.startsWith('npm_') && !k.startsWith('REPL_') && k === k.toUpperCase())
      .sort();
    res.json({ secrets: names });
  });

  // GET /api/action-templates/:id/data — fetch live data from a webhook data-source template (for dashboard widgets)
  app.get("/api/action-templates/:id/data", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const templateId = parseInt(req.params.id);
      if (isNaN(templateId)) return res.status(400).json({ message: "Invalid template ID" });

      const [template] = await db.select().from(actionTemplates).where(eq(actionTemplates.id, templateId));
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (template.actionType !== 'webhook') return res.status(400).json({ message: "Template is not a webhook type" });

      const cfg = (template.config || {}) as Record<string, any>;

      // Prefer transport from External Endpoints Registry when set; fall back
      // to legacy inline url/method/headers in `config` for not-yet-migrated
      // rows.
      let url: string;
      let method: string;
      let headersObj: Record<string, string> = {};
      let bodyRaw: string | undefined = cfg.body;
      try {
        if (template.endpointId) {
          const { transport } = await resolveTemplateTransport({
            endpointId: template.endpointId,
            config: cfg,
          });
          // Apply auth + secret resolution to URL/headers, but defer route
          // param substitution below.
          const finalized = finalizeTransport(transport);
          url = finalized.url;
          method = finalized.method;
          headersObj = finalized.headers;
        } else {
          if (!cfg.url) return res.status(400).json({ message: "Template has no URL configured" });
          url = resolveSecrets(cfg.url);
          method = cfg.method || 'GET';
          let headersRaw: string | undefined = cfg.headers;
          if (headersRaw) headersRaw = resolveSecrets(headersRaw);
          headersObj = { 'Content-Type': 'application/json' };
          if (headersRaw) {
            try { headersObj = { ...headersObj, ...JSON.parse(headersRaw) }; } catch { /* noop: malformed header JSON ignored, keep prior headers */ }
          }
        }
        if (bodyRaw) bodyRaw = resolveSecrets(bodyRaw);
      } catch (secretErr: any) {
        return res.status(400).json({ message: secretErr.message });
      }

      // Resolve route params — runtime query-string values take priority over template defaults.
      // This allows per-row expansion calls: GET /api/action-templates/:id/data?merchantId=123
      const routeParams: Array<{ name: string; defaultValue?: string }> = cfg.routeParams || [];
      for (const param of routeParams) {
        const runtimeValue = req.query[param.name] as string | undefined;
        const value = runtimeValue || param.defaultValue;
        if (value) {
          url = url.replace(new RegExp(`\\{${param.name}\\}`, 'g'), encodeURIComponent(String(value)));
          // Substitute route params inside header values too.
          for (const k of Object.keys(headersObj)) {
            headersObj[k] = headersObj[k].replace(new RegExp(`\\{${param.name}\\}`, 'g'), String(value));
          }
          if (bodyRaw)    bodyRaw    = bodyRaw.replace(new RegExp(`\\{${param.name}\\}`, 'g'), String(value));
        }
      }
      // Also substitute any ad-hoc query params that match unresolved placeholders
      const remainingPlaceholders = [...(url.match(/\{([^{}]+)\}/g) || [])];
      for (const placeholder of remainingPlaceholders) {
        const paramName = placeholder.slice(1, -1);
        const runtimeValue = req.query[paramName] as string | undefined;
        if (runtimeValue) {
          url = url.replace(new RegExp(`\\{${paramName}\\}`, 'g'), encodeURIComponent(String(runtimeValue)));
        }
      }
      if (/\{[^{}]+\}/.test(url)) {
        return res.status(400).json({ message: `URL has unresolved route parameters: ${url}. Set default values on the template or pass them as query parameters.` });
      }

      const fetchOptions: RequestInit = { method, headers: headersObj };
      if (method !== 'GET' && method !== 'HEAD' && bodyRaw) {
        fetchOptions.body = bodyRaw;
      }

      const startTime = Date.now();
      const upstream = await fetch(url, fetchOptions);
      const elapsed = Date.now() - startTime;

      let data: any;
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await upstream.json();
      } else {
        const text = await upstream.text();
        try { data = JSON.parse(text); } catch { data = { _raw: text }; }
      }

      res.json({
        success: upstream.ok,
        status: upstream.status,
        elapsed,
        data,
        templateId,
        templateConfig: {
          name: template.name,
          dataPath: cfg.dataPath || null,
          rowPath: cfg.rowPath || null,
          fieldLabels: cfg.fieldLabels || null,
        },
      });
    } catch (error: any) {
      console.error(`[template/data] template=${req.params.id} error:`, error.message);
      res.status(500).json({ message: "Failed to fetch data from template", error: error.message });
    }
  });

  // GET /api/admin/trigger-catalog — list all triggers
  app.get("/api/admin/trigger-catalog", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const triggers = await db.select().from(triggerCatalog).orderBy(triggerCatalog.name);
      res.json(triggers);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch trigger catalog", error: error.message });
    }
  });

  // POST /api/admin/trigger-catalog — create trigger
  app.post("/api/admin/trigger-catalog", dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertTriggerCatalogSchema'), async (req: RequestWithDB, res) => {
    try {
      const { insertTriggerCatalogSchema } = await import("@shared/schema");
      const parsed = insertTriggerCatalogSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trigger payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [trigger] = await db.insert(triggerCatalog).values(parsed.data).returning();
      res.status(201).json(trigger);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create trigger", error: error.message });
    }
  });

  // PUT /api/admin/trigger-catalog/:id — update trigger
  app.put("/api/admin/trigger-catalog/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertTriggerCatalogSchema } = await import("@shared/schema");
      const parsed = insertTriggerCatalogSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trigger payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [trigger] = await db.update(triggerCatalog).set({ ...parsed.data, updatedAt: new Date() }).where(eq(triggerCatalog.id, parseInt(req.params.id))).returning();
      if (!trigger) return res.status(404).json({ message: "Trigger not found" });
      res.json(trigger);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update trigger", error: error.message });
    }
  });

  // GET /api/admin/trigger-catalog/:id/actions — get actions for a trigger
  app.get("/api/admin/trigger-catalog/:id/actions", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const actions = await db.select({
        id: triggerActions.id,
        triggerId: triggerActions.triggerId,
        actionTemplateId: triggerActions.actionTemplateId,
        sequenceOrder: triggerActions.sequenceOrder,
        conditions: triggerActions.conditions,
        requiresEmailPreference: triggerActions.requiresEmailPreference,
        requiresSmsPreference: triggerActions.requiresSmsPreference,
        delaySeconds: triggerActions.delaySeconds,
        retryOnFailure: triggerActions.retryOnFailure,
        maxRetries: triggerActions.maxRetries,
        isActive: triggerActions.isActive,
        templateName: actionTemplates.name,
        templateActionType: actionTemplates.actionType,
      }).from(triggerActions)
        .leftJoin(actionTemplates, eq(triggerActions.actionTemplateId, actionTemplates.id))
        .where(eq(triggerActions.triggerId, parseInt(req.params.id)))
        .orderBy(triggerActions.sequenceOrder);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch trigger actions", error: error.message });
    }
  });

  // POST /api/admin/trigger-actions — add action to trigger
  app.post("/api/admin/trigger-actions", dbEnvironmentMiddleware, requirePerm('admin:manage'), markSchema('insertTriggerActionSchema'), async (req: RequestWithDB, res) => {
    try {
      const { insertTriggerActionSchema } = await import("@shared/schema");
      const parsed = insertTriggerActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trigger action payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [action] = await db.insert(triggerActions).values(parsed.data).returning();
      res.status(201).json(action);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create trigger action", error: error.message });
    }
  });

  // PUT /api/admin/trigger-actions/:id — update trigger action
  app.put("/api/admin/trigger-actions/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { insertTriggerActionSchema } = await import("@shared/schema");
      const parsed = insertTriggerActionSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trigger action payload", errors: parsed.error.flatten() });
      }
      const db = req.db!;
      const [action] = await db.update(triggerActions).set({ ...parsed.data, updatedAt: new Date() }).where(eq(triggerActions.id, parseInt(req.params.id))).returning();
      if (!action) return res.status(404).json({ message: "Trigger action not found" });
      res.json(action);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update trigger action", error: error.message });
    }
  });

  // GET /api/admin/action-activity/stats — activity statistics
  app.get("/api/admin/action-activity/stats", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const activity = await db.select().from(actionActivity);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const stats = {
        totalSent: activity.filter(a => a.status === 'delivered' || a.status === 'sent').length,
        totalFailed: activity.filter(a => a.status === 'failed').length,
        totalPending: activity.filter(a => a.status === 'pending').length,
        thisMonth: activity.filter(a => a.executedAt && new Date(a.executedAt) >= monthStart).length,
        byType: activity.reduce((acc: any, a) => { acc[a.actionType] = (acc[a.actionType] || 0) + 1; return acc; }, {}),
      };
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch activity stats", error: error.message });
    }
  });

  // GET /api/admin/action-activity/recent — recent activity
  app.get("/api/admin/action-activity/recent", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const db = req.db!;
      const { and, desc } = await import("drizzle-orm");
      const recent = await db.select().from(actionActivity).orderBy(desc(actionActivity.executedAt)).limit(50);
      res.json(recent);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch recent activity", error: error.message });
    }
  });

  // ─── Role Definitions CRUD ────────────────────────────────────────────────
  app.get("/api/admin/role-definitions", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB.execute(sqlTag`
        SELECT id, code, label, description, color, is_system, permissions, capabilities, created_at, updated_at
        FROM role_definitions
        ORDER BY is_system DESC, label ASC
      `);
      res.json(result.rows ?? result);
    } catch (error: any) {
      // Table may not exist yet in this environment (changes are promoted dev → test → production)
      if (error?.code === '42P01') {
        return res.json([]);
      }
      console.error("Error fetching role definitions:", error);
      res.status(500).json({ message: "Failed to fetch role definitions" });
    }
  });

  app.post("/api/admin/role-definitions", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const roleCreateSchema = z.object({
        code: z.string().min(1),
        label: z.string().min(1),
        description: z.string().nullable().optional(),
        color: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        capabilities: z.array(z.string()).optional(),
      });
      const parsedRole = roleCreateSchema.safeParse(req.body);
      if (!parsedRole.success) {
        return res.status(400).json({ message: "Invalid role definition payload", errors: parsedRole.error.flatten() });
      }
      const { code, label, description, color, permissions, capabilities } = parsedRole.data;
      const result = await dynamicDB.execute(sqlTag`
        INSERT INTO role_definitions (code, label, description, color, is_system, permissions, capabilities, created_at, updated_at)
        VALUES (${code}, ${label}, ${description ?? ''}, ${color ?? 'secondary'}, false,
                ${permissions ?? []}, ${capabilities ?? []}, NOW(), NOW())
        RETURNING *
      `);
      const row = (result.rows ?? result)[0];
      res.status(201).json(row);
    } catch (error: any) {
      if (error?.code === '23505') return res.status(409).json({ message: "A role with that code already exists" });
      console.error("Error creating role definition:", error);
      res.status(500).json({ message: "Failed to create role definition" });
    }
  });

  app.put("/api/admin/role-definitions/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const roleDefSchema = z.object({
        label: z.string(),
        description: z.string().optional(),
        color: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        capabilities: z.array(z.string()).optional(),
      });
      const parsed = roleDefSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role definition payload", errors: parsed.error.flatten() });
      }
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const { label, description, color, permissions, capabilities } = parsed.data;
      const result = await dynamicDB.execute(sqlTag`
        UPDATE role_definitions
        SET label = ${label}, description = ${description ?? ''}, color = ${color ?? 'secondary'},
            permissions = ${permissions ?? []}, capabilities = ${capabilities ?? []}, updated_at = NOW()
        WHERE id = ${id} AND is_system = false
        RETURNING *
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Role not found or is a system role" });
      res.json(rows[0]);
    } catch (error) {
      console.error("Error updating role definition:", error);
      res.status(500).json({ message: "Failed to update role definition" });
    }
  });

  app.delete("/api/admin/role-definitions/:id", dbEnvironmentMiddleware, requirePerm('admin:manage'), async (req: RequestWithDB, res) => {
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const result = await dynamicDB.execute(sqlTag`
        DELETE FROM role_definitions WHERE id = ${id} AND is_system = false RETURNING id
      `);
      const rows = result.rows ?? result;
      if (!rows.length) return res.status(404).json({ message: "Role not found or is a system role" });
      res.json({ message: "Role deleted" });
    } catch (error) {
      console.error("Error deleting role definition:", error);
      res.status(500).json({ message: "Failed to delete role definition" });
    }
  });

  // ─── Role × Action Permission Matrix ─────────────────────────────────────
  // Super-admin only. Surfaces the merged registry (defaults + DB overrides),
  // accepts toggle writes with audit, and exposes change history.
  app.get("/api/admin/role-action-grants", dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req: RequestWithDB, res) => {
    try {
      const { getOverrides } = await import("./permissionRegistry");
      const { DEFAULT_ACTION_GRANTS, ACTIONS, ACTION_LABELS, ACTION_GROUPS, DESTRUCTIVE_ACTIONS } = await import("@shared/permissions");
      const env = req.dbEnv ?? 'production';
      const overrides = await getOverrides(env, getRequestDB(req), true);
      res.json({
        actions: ACTIONS,
        actionLabels: ACTION_LABELS,
        actionGroups: ACTION_GROUPS,
        destructiveActions: Array.from(DESTRUCTIVE_ACTIONS),
        defaults: DEFAULT_ACTION_GRANTS,
        overrides,
      });
    } catch (error) {
      console.error("Error fetching role-action grants:", error);
      res.status(500).json({ message: "Failed to fetch grants" });
    }
  });

  app.put("/api/admin/role-action-grants", dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req: RequestWithDB, res) => {
    try {
      const grantSchema = z.object({
        roleCode: z.string().min(1),
        action: z.string().min(1),
        scope: z.enum(['own', 'downline', 'all', 'none']),
      });
      const parsed = grantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid grant payload", errors: parsed.error.flatten() });
      }
      const { roleCode, action, scope } = parsed.data;

      // Block edits to the implicit super_admin grant — it's hard-coded to 'all'.
      if (roleCode === 'super_admin') return res.status(400).json({ message: "super_admin grants cannot be modified" });

      const { setGrant } = await import("./permissionRegistry");
      const changedBy = req.currentUser?.id ?? null;
      const env = req.dbEnv ?? 'production';
      const result = await setGrant(env, getRequestDB(req), roleCode, action, scope as 'own' | 'downline' | 'all' | 'none', changedBy);
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Error updating role-action grant:", error);
      res.status(500).json({ message: "Failed to update grant" });
    }
  });

  app.get("/api/admin/role-action-audit", dbEnvironmentMiddleware, requirePerm('system:superadmin'), async (req: RequestWithDB, res) => {
    try {
      const dynamicDB = getRequestDB(req);
      const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
      // Typed Drizzle SELECT through the per-request DynamicDB.
      const rows = await dynamicDB
        .select({
          id: roleActionAudit.id,
          role_code: roleActionAudit.roleCode,
          action: roleActionAudit.action,
          prev_scope: roleActionAudit.prevScope,
          new_scope: roleActionAudit.newScope,
          changed_by: roleActionAudit.changedBy,
          changed_at: roleActionAudit.changedAt,
        })
        .from(roleActionAudit)
        .orderBy(desc(roleActionAudit.changedAt))
        .limit(limit);
      res.json(rows);
    } catch (error: any) {
      if (error?.code === '42P01') return res.json([]);
      console.error("Error fetching role-action audit:", error);
      res.status(500).json({ message: "Failed to fetch audit" });
    }
  });

  // ── Prospect Portal ──────────────────────────────────────────────────────
  // Helper: check prospect portal session
  const requireProspectPortalAuth = async (req: RequestWithDB, res: any, next: any) => {
    const prospectId = req.session?.portalProspectId;
    if (!prospectId) return res.status(401).json({ message: "Portal session required" });
    next();
  };

  // POST /api/portal/setup-password — prospect sets password via their validation token
  app.post("/api/portal/setup-password", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password || password.length < 8) {
        return res.status(400).json({ message: "Token and password (min 8 chars) required" });
      }
      const bcrypt = await import("bcrypt");
      const prospect = await storage.getMerchantProspectByToken(token);
      if (!prospect) return res.status(404).json({ message: "Invalid token" });
      if (prospect.portalPasswordHash) return res.status(409).json({ message: "Portal account already set up. Please log in." });
      const hash = await bcrypt.hash(password, 10);
      await storage.updateMerchantProspect(prospect.id, { portalPasswordHash: hash, portalSetupAt: new Date() });
      req.session.portalProspectId = prospect.id;
      req.session.portalProspectEmail = prospect.email;
      req.session.portalDbEnv = req.dbEnv;
      res.json({ message: "Portal account created", prospect: { id: prospect.id, firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email } });
    } catch (error) {
      console.error("Error setting up portal password:", error);
      res.status(500).json({ message: "Failed to set up portal account" });
    }
  });

  // POST /api/portal/login
  app.post("/api/portal/login", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      const bcrypt = await import("bcrypt");
      const prospect = await storage.getMerchantProspectByEmail(email.toLowerCase().trim());
      if (!prospect || !prospect.portalPasswordHash) return res.status(401).json({ message: "Invalid email or password" });
      const valid = await bcrypt.compare(password, prospect.portalPasswordHash);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });
      req.session.portalProspectId = prospect.id;
      req.session.portalProspectEmail = prospect.email;
      req.session.portalDbEnv = req.dbEnv;
      res.json({ prospect: { id: prospect.id, firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email, status: prospect.status } });
    } catch (error) {
      console.error("Error in portal login:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // POST /api/portal/logout
  app.post("/api/portal/logout", async (req: any, res) => {
    delete req.session.portalProspectId;
    delete req.session.portalProspectEmail;
    delete req.session.portalDbEnv;
    res.json({ message: "Logged out" });
  });

  // POST /api/portal/magic-link-request — prospect requests a one-click sign-in email
  app.post("/api/portal/magic-link-request", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { email } = req.body;
      if (!email?.trim()) return res.status(400).json({ message: "Email required" });
      const prospect = await storage.getMerchantProspectByEmail(email.trim().toLowerCase());
      // Always respond 200 to avoid email enumeration
      if (!prospect) return res.json({ message: "If that email matches an application, a sign-in link has been sent." });
      // Generate a secure random token
      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      await storage.createPortalMagicLink({ prospectId: prospect.id, token, expiresAt });
      // Determine the portal URL for the email
      const dbParam = req.dbEnv === "dev" ? "?db=dev" : "";
      const baseUrl = process.env.BASE_URL || `https://${req.hostname}`;
      const magicUrl = `${baseUrl}/portal/magic-login${dbParam}#token=${token}`;
      emailService.sendMagicLinkEmail({ firstName: prospect.firstName, email: prospect.email, magicUrl }).catch(() => {});
      res.json({ message: "If that email matches an application, a sign-in link has been sent." });
    } catch (error) {
      console.error("Magic link request error:", error);
      res.status(500).json({ message: "Failed to send magic link" });
    }
  });

  // POST /api/portal/magic-link-login — exchange token for a portal session
  app.post("/api/portal/magic-link-login", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "Token required" });
      const link = await storage.getActivePortalMagicLinkByToken(token);
      if (!link) return res.status(401).json({ message: "Invalid or already-used sign-in link" });
      if (new Date() > link.expiresAt) return res.status(401).json({ message: "This sign-in link has expired. Please request a new one." });
      // Mark as used
      await storage.markPortalMagicLinkUsed(link.id);
      // Look up prospect
      const prospect = await storage.getMerchantProspect(link.prospectId);
      if (!prospect) return res.status(404).json({ message: "Account not found" });
      // Create portal session
      req.session.portalProspectId = prospect.id;
      req.session.portalProspectEmail = prospect.email;
      req.session.portalDbEnv = req.dbEnv || "production";
      res.json({ message: "Signed in", prospect: { id: prospect.id, firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email } });
    } catch (error) {
      console.error("Magic link login error:", error);
      res.status(500).json({ message: "Failed to sign in" });
    }
  });

  // GET /api/portal/me
  app.get("/api/portal/me", dbEnvironmentMiddleware, requireProspectPortalAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = req.session.portalProspectId!;
      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      // Fetch latest application
      const app = await storage.getLatestProspectApplication(prospectId) ?? null;
      let templateName: string | null = null;
      if (app?.templateId) {
        templateName = await storage.getApplicationTemplateName(app.templateId);
      }
      res.json({
        id: prospect.id, firstName: prospect.firstName, lastName: prospect.lastName,
        email: prospect.email, status: prospect.status,
        validationToken: prospect.validationToken,
        portalSetupAt: prospect.portalSetupAt,
        application: app ? { id: app.id, status: app.status, templateName, createdAt: app.createdAt, hasGeneratedPdf: !!app.generatedPdfPath } : null,
      });
    } catch (error) {
      console.error("Error fetching portal me:", error);
      res.status(500).json({ message: "Failed to fetch account" });
    }
  });

  // GET /api/portal/messages
  app.get("/api/portal/messages", dbEnvironmentMiddleware, requireProspectPortalAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = req.session.portalProspectId!;
      const msgs = await storage.getProspectMessages(prospectId);
      // Mark all agent messages as read
      await storage.markProspectMessagesReadForProspect(prospectId);
      res.json({ messages: msgs });
    } catch (error) {
      console.error("Error fetching portal messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // POST /api/portal/messages — prospect sends a message
  app.post("/api/portal/messages", dbEnvironmentMiddleware, requireProspectPortalAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = req.session.portalProspectId!;
      const email = req.session.portalProspectEmail ?? "";
      const parsed = sharedMessageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid message payload", errors: parsed.error.flatten() });
      }
      const { subject = "", message } = parsed.data;
      if (!message.trim()) return res.status(400).json({ message: "Message body required" });
      const msg = await storage.createProspectMessage({
        prospectId, senderId: email, senderType: "prospect", subject: subject.trim(),
        message: message.trim(), isRead: false,
      });
      res.json(msg);
    } catch (error) {
      console.error("Error sending portal message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // GET /api/portal/file-requests
  app.get("/api/portal/file-requests", dbEnvironmentMiddleware, requireProspectPortalAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = req.session.portalProspectId!;
      const requests = await storage.getProspectFileRequestsSummary(prospectId);
      res.json({ fileRequests: requests });
    } catch (error) {
      console.error("Error fetching portal file requests:", error);
      res.status(500).json({ message: "Failed to fetch file requests" });
    }
  });

  // POST /api/portal/file-requests/:id/upload — prospect uploads a document
  app.post("/api/portal/file-requests/:id/upload", dbEnvironmentMiddleware, requireProspectPortalAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = req.session.portalProspectId!;
      const email = req.session.portalProspectEmail ?? "";
      const frId = parseInt(req.params.id);
      const parsed = sharedPortalUploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid upload payload", errors: parsed.error.flatten() });
      }
      const { fileName, mimeType, fileData } = parsed.data;
      const fr = await storage.getProspectFileRequestForProspect(frId, prospectId);
      if (!fr) return res.status(404).json({ message: "File request not found" });
      const updated = await storage.updateProspectFileRequestUpload(frId, { fileName, mimeType, fileData, uploadedBy: email });
      res.json(updated);
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // ── Prospect Portal — CRM-side routes ──────────────────────────────────────
  // GET /api/prospects/:id/messages
  app.get("/api/prospects/:id/messages", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const msgs = await storage.getProspectMessages(prospectId);
      res.json({ messages: msgs });
    } catch (error) {
      console.error("Error fetching prospect messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // POST /api/prospects/:id/messages — agent sends a message
  app.post("/api/prospects/:id/messages", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const parsed = sharedMessageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid message payload", errors: parsed.error.flatten() });
      }
      const { subject = "", message } = parsed.data;
      if (!message.trim()) return res.status(400).json({ message: "Message body required" });
      const userId = req.session?.userId || req.user?.claims?.sub || "agent";
      const userInfo = await storage.getUserDisplayInfo(userId);
      const senderName = userInfo ? (userInfo.username || userInfo.email || "Agent") : "Agent";
      const msg = await storage.createProspectMessage({
        prospectId, senderId: userId, senderType: "agent", subject: subject.trim(),
        message: message.trim(), isRead: false,
      });
      // Non-blocking: notify prospect by email
      (async () => {
        try {
          const prospect = await storage.getMerchantProspect(prospectId);
          if (prospect) {
            const dbParam = req.dbEnv === "dev" ? "?db=dev" : "";
            const baseUrl = process.env.BASE_URL || `https://${req.hostname}`;
            const portalUrl = `${baseUrl}/portal/login${dbParam}`;
            await emailService.sendNewMessageNotification({ firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email, portalUrl, agentName: senderName, subject: subject.trim() || undefined });
          }
        } catch { /* ignore — email failure must not break the route */ }
      })();
      res.json(msg);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // PATCH /api/prospects/:id/messages/:mid/read
  app.patch("/api/prospects/:id/messages/:mid/read", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const parsed = z.object({}).strict().safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
      }
      const mid = parseInt(req.params.mid);
      await storage.markProspectMessageRead(mid);
      res.json({ message: "Marked as read" });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });

  // GET /api/prospects/:id/file-requests
  app.get("/api/prospects/:id/file-requests", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const rows = await storage.getProspectFileRequestsSummary(prospectId);
      res.json({ fileRequests: rows });
    } catch (error) {
      console.error("Error fetching file requests:", error);
      res.status(500).json({ message: "Failed to fetch file requests" });
    }
  });

  // POST /api/prospects/:id/file-requests — agent creates a file request
  app.post("/api/prospects/:id/file-requests", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const parsed = sharedFileRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid file request payload", errors: parsed.error.flatten() });
      }
      const { label, description, required = true } = parsed.data;
      if (!label.trim()) return res.status(400).json({ message: "Label required" });
      const row = await storage.createProspectFileRequest({ prospectId, label: label.trim(), description: description?.trim() || null, required });
      // Non-blocking: notify prospect by email
      (async () => {
        try {
          const userId = req.session?.userId || req.user?.claims?.sub || "agent";
          const prospect = await storage.getMerchantProspect(prospectId);
          const userInfo = await storage.getUserDisplayInfo(userId);
          const agentName = userInfo?.username || "Your advisor";
          if (prospect) {
            const dbParam = req.dbEnv === "dev" ? "?db=dev" : "";
            const baseUrl = process.env.BASE_URL || `https://${req.hostname}`;
            const portalUrl = `${baseUrl}/portal/login${dbParam}`;
            await emailService.sendFileRequestNotification({ firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email, portalUrl, agentName, label: label.trim() });
          }
        } catch { /* ignore */ }
      })();
      res.json(row);
    } catch (error) {
      console.error("Error creating file request:", error);
      res.status(500).json({ message: "Failed to create file request" });
    }
  });

  // PATCH /api/prospects/:id/file-requests/:frid — update status (approve/reject)
  app.patch("/api/prospects/:id/file-requests/:frid", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const frPatchSchema = z.object({
        status: z.string().min(1),
      });
      const parsed = frPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid file request payload", errors: parsed.error.flatten() });
      }
      const frId = parseInt(req.params.frid);
      const { status } = parsed.data;
      const row = await storage.updateProspectFileRequestStatus(frId, status);
      res.json(row);
    } catch (error) {
      res.status(500).json({ message: "Failed to update file request" });
    }
  });

  // DELETE /api/prospects/:id/file-requests/:frid
  app.delete("/api/prospects/:id/file-requests/:frid", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const frId = parseInt(req.params.frid);
      await storage.deleteProspectFileRequest(frId);
      res.json({ message: "Deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete file request" });
    }
  });

  // GET /api/prospects/:id/file-requests/:frid/download — agent downloads uploaded file
  app.get("/api/prospects/:id/file-requests/:frid/download", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const frId = parseInt(req.params.frid);
      const fr = await storage.getProspectFileRequest(frId);
      if (!fr || !fr.fileData) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(fr.fileData, "base64");
      res.setHeader("Content-Type", fr.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fr.fileName || "download"}"`);
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // ── User Alerts / Notifications ─────────────────────────────────────────
  app.get("/api/alerts", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { sql: sqlTag } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      const includeRead = req.query.includeRead === "true";
      let alerts;
      if (includeRead) {
        alerts = await dynamicDB
          .select()
          .from(userAlerts)
          .where(sqlTag`${userAlerts.userId} = ${userId}`)
          .orderBy(sqlTag`${userAlerts.createdAt} DESC`);
      } else {
        alerts = await dynamicDB
          .select()
          .from(userAlerts)
          .where(sqlTag`${userAlerts.userId} = ${userId} AND ${userAlerts.isRead} = false`)
          .orderBy(sqlTag`${userAlerts.createdAt} DESC`);
      }
      res.json({ alerts });
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ message: "Failed to fetch alerts" });
    }
  });

  app.get("/api/alerts/count", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { sql: sqlTag, count } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      const result = await dynamicDB
        .select({ count: count() })
        .from(userAlerts)
        .where(sqlTag`${userAlerts.userId} = ${userId} AND ${userAlerts.isRead} = false`);
      res.json({ count: Number(result[0]?.count ?? 0) });
    } catch (error) {
      console.error("Error fetching alert count:", error);
      res.status(500).json({ message: "Failed to fetch alert count" });
    }
  });

  // Server-Sent Events stream for real-time bell updates. Replaces the
  // 60-second polling that used to be the only update path. Clients open
  // a single EventSource and receive `alert` events the moment a new row
  // is inserted via createAlert(); a periodic comment frame keeps proxies
  // from closing the idle connection.
  app.get("/api/alerts/stream", async (req, res) => {
    const userId = (req.session as { userId?: string } | undefined)?.userId;
    if (!userId) return res.status(401).end();

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }
    res.write(`: connected\n\n`);

    const { alertBus } = await import("./alertBus");
    const unsubscribe = alertBus.subscribe(userId, (alert) => {
      try {
        res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
      } catch {
        // socket already closed; cleanup happens via 'close' below
      }
    });

    const heartbeat = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { /* noop */ }
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      try { res.end(); } catch { /* noop */ }
    });
  });

  app.patch("/api/alerts/:id/read", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const parsed = z.object({}).strict().safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
      }
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { sql: sqlTag, eq, and } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const updated = await dynamicDB
        .update(userAlerts)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(userAlerts.id, id), eq(userAlerts.userId, userId)))
        .returning();
      if (!updated.length) return res.status(404).json({ message: "Alert not found" });
      res.json(updated[0]);
    } catch (error) {
      console.error("Error marking alert read:", error);
      res.status(500).json({ message: "Failed to mark alert as read" });
    }
  });

  app.post("/api/alerts/read-all", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { eq } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      await dynamicDB
        .update(userAlerts)
        .set({ isRead: true, readAt: new Date() })
        .where(eq(userAlerts.userId, userId));
      res.json({ message: "All alerts marked as read" });
    } catch (error) {
      console.error("Error marking all alerts read:", error);
      res.status(500).json({ message: "Failed to mark all alerts as read" });
    }
  });

  app.delete("/api/alerts/read/all", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { sql: sqlTag } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      await dynamicDB
        .delete(userAlerts)
        .where(sqlTag`${userAlerts.userId} = ${userId} AND ${userAlerts.isRead} = true`);
      res.json({ message: "All read alerts deleted" });
    } catch (error) {
      console.error("Error deleting read alerts:", error);
      res.status(500).json({ message: "Failed to delete read alerts" });
    }
  });

  app.delete("/api/alerts/:id", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { and, eq } = await import("drizzle-orm");
      const { userAlerts } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      const id = parseInt(req.params.id);
      const deleted = await dynamicDB
        .delete(userAlerts)
        .where(and(eq(userAlerts.id, id), eq(userAlerts.userId, userId)))
        .returning();
      if (!deleted.length) return res.status(404).json({ message: "Alert not found" });
      res.json({ message: "Alert deleted" });
    } catch (error) {
      console.error("Error deleting alert:", error);
      res.status(500).json({ message: "Failed to delete alert" });
    }
  });

  // POST /api/prospects/:id/send-portal-invite — agent sends portal invitation email
  app.post("/api/prospects/:id/send-portal-invite", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (!prospect.validationToken) return res.status(400).json({ message: "Prospect does not have a validation token" });
      const userId = req.session?.userId || req.user?.claims?.sub || "agent";
      const userInfo = await storage.getUserDisplayInfo(userId);
      const agentName = userInfo?.username || "Your advisor";
      const baseUrl = process.env.BASE_URL || `https://${req.hostname}`;
      const statusUrl = `${baseUrl}/application-status/${prospect.validationToken}`;
      await emailService.sendPortalInviteEmail({ firstName: prospect.firstName, lastName: prospect.lastName, email: prospect.email, statusUrl, agentName });
      res.json({ message: "Portal invitation sent", email: prospect.email });
    } catch (error) {
      console.error("Error sending portal invite:", error);
      res.status(500).json({ message: "Failed to send portal invitation" });
    }
  });

  // ─── Epic B — Underwriting Engine API ──────────────────────────────────────
  registerUnderwritingRoutes(app);
  registerCommissionsRoutes(app);
  registerSchemaSyncRoutes(app, requirePerm);
  registerExternalEndpointsRoutes(app);

  // ─── Auto-generated route catalogue (Task #73) ────────────────────────────
  // Walks the Express router stack at request time and returns every public
  // route with its method, path, and the permission middleware applied. Used
  // by /api-documentation so the Endpoints tab stays in sync with the code.
  const { publicRouteCatalogue, groupCatalogue } = await import("./routeCatalogue");
  app.get(
    "/api/admin/route-catalogue",
    isAuthenticated,
    requirePerm("admin:manage"),
    (req, res) => {
      const entries = publicRouteCatalogue(app);
      const sections = groupCatalogue(entries);
      res.json({
        generatedAt: new Date().toISOString(),
        total: entries.length,
        sections,
        entries,
      });
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}