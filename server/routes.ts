import type { Express, Request as ExpressRequest, Response } from "express";
import { createServer, type Server } from "http";
import { storage, createStorage } from "./storage";
import { setupAuthRoutes } from "./authRoutes";
import { insertMerchantSchema, insertAgentSchema, insertTransactionSchema, insertLocationSchema, insertAddressSchema, insertPdfFormSchema, insertApiKeySchema, insertAcquirerSchema, insertAcquirerApplicationTemplateSchema, insertProspectApplicationSchema } from "@shared/schema";
import { authenticateApiKey, requireApiPermission, logApiRequest, generateApiKey } from "./apiAuth";
import { setupAuth, isAuthenticated, requireRole, requirePermission } from "./replitAuth";
import { auditService } from "./auditService";
import { z } from "zod";
import session from "express-session";
import connectPg from "connect-pg-simple";
import multer from "multer";
import { pdfFormParser } from "./pdfParser";
import { emailService } from "./emailService";
import { ObjectStorageService, AccessDeniedError } from "./objectStorage";
import { checkObjectAccess } from "./objectAcl";
import { v4 as uuidv4 } from "uuid";
// Legacy import kept for gradual migration
import { dbEnvironmentMiddleware, adminDbMiddleware, getRequestDB, createStorageForRequest, type RequestWithDB } from "./dbMiddleware";
// New global environment system
import { globalEnvironmentMiddleware, adminEnvironmentMiddleware, type RequestWithGlobalDB } from "./globalEnvironmentMiddleware";
import { setupEnvironmentRoutes } from "./environmentRoutes";
import { getDynamicDatabase, db } from "./db";
import { users, agents, merchants, agentMerchants, companies, addresses, companyAddresses, acquirerApplicationTemplates, merchantProspects, campaignApplicationTemplates } from "@shared/schema";
import crypto from "crypto";
import { eq, or, ilike, sql, inArray } from "drizzle-orm";

// Helper functions for user account creation
async function generateUsername(firstName: string, lastName: string, email: string, dynamicDB: any): Promise<string> {
  // Try email-based username first
  const emailUsername = email.split('@')[0].toLowerCase();
  const existingUser = await dynamicDB.select().from(users).where(eq(users.username, emailUsername)).limit(1);
  
  if (existingUser.length === 0) {
    return emailUsername;
  }
  
  // Try first initial + last name
  const firstInitialLastname = `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}`;
  const existingUser2 = await dynamicDB.select().from(users).where(eq(users.username, firstInitialLastname)).limit(1);
  
  if (existingUser2.length === 0) {
    return firstInitialLastname;
  }
  
  // Add number suffix
  let counter = 1;
  let username = `${firstInitialLastname}${counter}`;
  while (true) {
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

// Address mapper: translates canonical address field names to template-specific names
function mapCanonicalAddressesToTemplate(formData: Record<string, any>, addressGroups: any[]): Record<string, any> {
  if (!addressGroups || addressGroups.length === 0) {
    return formData;
  }

  const mappedData = { ...formData };

  addressGroups.forEach((group: any) => {
    const groupType = group.type; // 'business', 'mailing', 'shipping', etc.
    const canonicalPrefix = `${groupType}Address`;
    const fieldMappings = group.fieldMappings || {};

    // Map canonical fields to template-specific fields
    Object.entries(fieldMappings).forEach(([canonicalKey, templateFieldName]: [string, any]) => {
      const canonicalFieldName = `${canonicalPrefix}.${canonicalKey}`;
      
      if (mappedData[canonicalFieldName] !== undefined) {
        mappedData[templateFieldName] = mappedData[canonicalFieldName];
        delete mappedData[canonicalFieldName];
      }
    });
  });

  return mappedData;
}

// Reverse mapper: translates template-specific field names to canonical names (for loading saved data)
// IMPORTANT: Keeps BOTH original template field names AND canonical names so the form can use either
function mapTemplateAddressesToCanonical(formData: Record<string, any>, addressGroups: any[]): Record<string, any> {
  if (!addressGroups || addressGroups.length === 0) {
    return formData;
  }

  const mappedData = { ...formData };

  addressGroups.forEach((group: any) => {
    const groupType = group.type; // 'business', 'mailing', 'shipping', etc.
    const canonicalPrefix = `${groupType}Address`;
    const fieldMappings = group.fieldMappings || {};

    // Map template-specific fields to canonical fields
    // Keep both the original template field name AND the canonical name for compatibility
    Object.entries(fieldMappings).forEach(([canonicalKey, templateFieldName]: [string, any]) => {
      const canonicalFieldName = `${canonicalPrefix}.${canonicalKey}`;
      
      if (mappedData[templateFieldName] !== undefined) {
        // Copy to canonical name (for components expecting canonical format)
        mappedData[canonicalFieldName] = mappedData[templateFieldName];
        // DO NOT delete the original template field name - the form needs it for rendering!
        // The form uses the original template field names from the field configuration
      }
      
      // Also reverse: if only canonical exists, copy to template field name
      if (mappedData[canonicalFieldName] !== undefined && mappedData[templateFieldName] === undefined) {
        mappedData[templateFieldName] = mappedData[canonicalFieldName];
      }
    });
  });

  return mappedData;
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
    const userId = (req.session as any)?.userId;
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

          // Log CRUD operations with detailed data
          if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 300) {
            // CREATE operation
            await auditServiceInstance.logAction(
              'create',
              resource,
              {
                userId,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || null,
                method: req.method,
                endpoint: req.path,
                requestData: requestBody,
                responseData: parsedResponse,
                resourceId: parsedResponse?.id || 'unknown',
                environment: req.dbEnv || 'production'
              },
              {
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
                userAgent: req.get('User-Agent') || null,
                method: req.method,
                endpoint: req.path,
                requestData: requestBody,
                responseData: parsedResponse,
                resourceId,
                environment: req.dbEnv || 'production'
              },
              {
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
                userAgent: req.get('User-Agent') || null,
                method: req.method,
                endpoint: req.path,
                requestData: requestBody,
                responseData: parsedResponse,
                resourceId,
                environment: req.dbEnv || 'production'
              },
              {
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
                userAgent: req.get('User-Agent') || null,
                method: req.method,
                endpoint: req.path,
                resourceId,
                environment: req.dbEnv || 'production'
              },
              {
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
  app.post('/api/address-autocomplete', async (req, res) => {
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
  app.post('/api/validate-address', async (req, res) => {
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
      const envStorage = createStorageForRequest(req);
      const { locationId } = req.params;
      console.log('Revenue endpoint - fetching revenue for location:', locationId);
      const revenue = await envStorage.getLocationRevenue(parseInt(locationId));
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching location revenue:", error);
      res.status(500).json({ message: "Failed to fetch location revenue" });
    }
  });

  // Merchant MTD revenue endpoint (placed early to avoid auth middleware)
  app.get("/api/merchants/:merchantId/mtd-revenue", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { merchantId } = req.params;
      console.log('MTD Revenue endpoint - fetching MTD revenue for merchant:', merchantId);
      
      // Get all locations for this merchant
      const locations = await envStorage.getLocationsByMerchant(parseInt(merchantId));
      
      // Calculate total MTD revenue across all locations
      let totalMTD = 0;
      for (const location of locations) {
        const revenue = await envStorage.getLocationRevenue(location.id);
        totalMTD += parseFloat(revenue.monthToDate || '0');
      }
      
      res.json({ mtdRevenue: totalMTD.toFixed(2) });
    } catch (error) {
      console.error("Error fetching merchant MTD revenue:", error);
      res.status(500).json({ message: "Failed to fetch merchant MTD revenue" });
    }
  });

  // Dashboard API endpoints (placed early to avoid auth middleware for development)
  app.get("/api/dashboard/metrics", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const metrics = await envStorage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/dashboard/revenue", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const revenue = await envStorage.getDashboardRevenue();
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching dashboard revenue:", error);
      res.status(500).json({ message: "Failed to fetch dashboard revenue" });
    }
  });

  app.get("/api/dashboard/top-locations", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const limit = parseInt(String(req.query.limit || "5"));
      const sortBy = String(req.query.sortBy || "revenue");
      const locations = await envStorage.getTopLocations(limit, sortBy);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching top locations:", error);
      res.status(500).json({ message: "Failed to fetch top locations" });
    }
  });

  app.get("/api/dashboard/recent-activity", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const activities = await envStorage.getRecentActivity();
      res.json(activities);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  app.get("/api/dashboard/assigned-merchants", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const limit = parseInt(String(req.query.limit || "10"));
      const merchants = await envStorage.getAssignedMerchants(limit);
      res.json(merchants);
    } catch (error) {
      console.error("Error fetching assigned merchants:", error);
      res.status(500).json({ message: "Failed to fetch assigned merchants" });
    }
  });

  app.get("/api/dashboard/system-overview", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const systemData = await envStorage.getSystemOverview();
      res.json(systemData);
    } catch (error) {
      console.error("Error fetching system overview:", error);
      res.status(500).json({ message: "Failed to fetch system overview" });
    }
  });

  // Get current agent for logged-in user
  app.get("/api/agent/current", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const agent = await envStorage.getAgentByUserId(userId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      res.json({ agent });
    } catch (error) {
      console.error("Error fetching current agent:", error);
      res.status(500).json({ message: "Failed to fetch agent" });
    }
  });

  // Agent dashboard endpoints
  app.get("/api/agent/dashboard/stats", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      console.log('Agent Dashboard Stats - Session ID:', req.sessionID);
      console.log('Agent Dashboard Stats - Session data:', req.session);
      
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get user data
      const user = await envStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get agent by userId (company-centric architecture)
      let agent = await envStorage.getAgentByUserId(userId);
      
      // If no agent found, use fallback for development/testing
      if (!agent && userId === 'user_agent_1') {
        // For development, fallback to agent ID 2 (Mike Chen)
        agent = await envStorage.getAgent(2);
        console.log('Using fallback agent for development:', agent?.firstName, agent?.lastName);
      }
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      console.log('Found agent:', agent.id, agent.firstName, agent.lastName);

      // Get all prospects assigned to this agent
      const prospects = await envStorage.getProspectsByAgent(agent.id);
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
      const envStorage = createStorageForRequest(req);
      console.log('Agent Applications - Session ID:', req.sessionID);
      console.log('Agent Applications - Session data:', req.session);
      
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get user data
      const user = await envStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get agent by userId (company-centric architecture)
      let agent = await envStorage.getAgentByUserId(userId);
      
      // If no agent found, use fallback for development/testing
      if (!agent && userId === 'user_agent_1') {
        // For development, fallback to agent ID 2 (Mike Chen)
        agent = await envStorage.getAgent(2);
        console.log('Using fallback agent for development:', agent?.firstName, agent?.lastName);
      }
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get all prospects assigned to this agent with application details
      const prospects = await envStorage.getProspectsByAgent(agent.id);
      
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
        const dbSignatures = await envStorage.getProspectSignaturesByProspect(prospect.id);
        const prospectOwners = await envStorage.getProspectOwners(prospect.id);

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
      const envStorage = createStorageForRequest(req);
      const { userId } = req.params;
      const widgets = await envStorage.getUserWidgetPreferences(userId);
      res.json(widgets);
    } catch (error) {
      console.error("Error fetching user widgets:", error);
      res.status(500).json({ message: "Failed to fetch user widgets" });
    }
  });

  app.post("/api/user/:userId/widgets", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { userId } = req.params;
      const widgetData = {
        ...req.body,
        userId
      };
      const widget = await envStorage.createWidgetPreference(widgetData);
      res.json(widget);
    } catch (error) {
      console.error("Error creating widget preference:", error);
      res.status(500).json({ message: "Failed to create widget preference" });
    }
  });

  app.put("/api/widgets/:widgetId", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { widgetId } = req.params;
      const widget = await envStorage.updateWidgetPreference(parseInt(widgetId), req.body);
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
      const envStorage = createStorageForRequest(req);
      const { widgetId } = req.params;
      const success = await envStorage.deleteWidgetPreference(parseInt(widgetId));
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
  
  // Setup new global environment routes
  setupEnvironmentRoutes(app);



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

  // Debug endpoint to check database environment and connection
  app.get('/api/debug/database', isAuthenticated, dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const dbToUse = req.dynamicDB;
      const { withRetry } = await import("./db");
      
      // Get a count from fee_items to verify connection and environment
      const { feeItems } = await import("@shared/schema");
      const result = await withRetry(() => dbToUse!.select().from(feeItems));
      
      res.json({
        sessionDbEnv: req.dbEnv,
        feeItemsCount: result.length,
        environment: req.dbEnv,
        timestamp: new Date().toISOString(),
        sampleItems: result.slice(0, 3).map(item => ({ id: item.id, name: item.name, displayOrder: item.displayOrder }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Debug failed', details: error });
    }
  });

  app.get('/api/auth/user', isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      console.log('🔍 /api/auth/user response:', {
        id: user.id,
        email: user.email,
        role: user.role,
        username: user.username
      });
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

;



  // User management routes (admin and super admin only) - Development bypass
  app.get("/api/users", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log('Users endpoint - Fetching all users (development mode)...');
      console.log('Users endpoint - Database environment:', req.dbEnv);
      
      // Use dynamic database connection if available, otherwise use default storage
      const dynamicDB = getRequestDB(req);
      
      // Get users from the dynamic database
      const { users: usersTable } = await import('@shared/schema');
      const users = await dynamicDB.select({
        id: usersTable.id,
        email: usersTable.email,
        username: usersTable.username,
        passwordHash: usersTable.passwordHash,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        status: usersTable.status,
        permissions: usersTable.permissions,
        lastLoginAt: usersTable.lastLoginAt,
        lastLoginIp: usersTable.lastLoginIp,
        timezone: usersTable.timezone,
        twoFactorEnabled: usersTable.twoFactorEnabled,
        twoFactorSecret: usersTable.twoFactorSecret,
        passwordResetToken: usersTable.passwordResetToken,
        passwordResetExpires: usersTable.passwordResetExpires,
        emailVerified: usersTable.emailVerified,
        emailVerificationToken: usersTable.emailVerificationToken,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
        roles: usersTable.roles
      }).from(usersTable);
      console.log('Users endpoint - Found', users.length, 'users');
      console.log('Users found:', users.map((u: any) => ({ id: u.id, username: u.username, email: u.email, role: u.role })));
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id/role", dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { role, password } = req.body;
      
      // Require password verification for sensitive role changes
      if (!password) {
        return res.status(400).json({ message: "Password verification required for role changes" });
      }
      
      // Verify the current user's password
      const currentUser = await envStorage.getUser(req.session!.userId!);
      if (!currentUser) {
        return res.status(404).json({ message: "Current user not found" });
      }
      
      const { authService } = await import("./auth");
      const isPasswordValid = await authService.verifyPassword(password, currentUser.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }
      
      if (!['merchant', 'agent', 'admin', 'corporate', 'super_admin', 'underwriter'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const user = await envStorage.updateUserRole(id, role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.patch("/api/users/:id/status", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { status, password } = req.body;
      
      // Require password verification for status changes
      if (!password) {
        return res.status(400).json({ message: "Password verification required for status changes" });
      }
      
      // Verify the current user's password
      const currentUser = await envStorage.getUser(req.session!.userId!);
      if (!currentUser) {
        return res.status(404).json({ message: "Current user not found" });
      }
      
      const { authService } = await import("./auth");
      const isPasswordValid = await authService.verifyPassword(password, currentUser.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }
      
      if (!['active', 'suspended', 'inactive'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const user = await envStorage.updateUserStatus(id, status);
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
  app.delete("/api/users/:id", dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      
      const success = await envStorage.deleteUser(id);
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ message: "User account deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      
      // Check if error is due to foreign key constraint (agent or merchant exists)
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        return res.status(409).json({ 
          message: "Cannot delete user: User has associated agent or merchant records. Please delete or reassign those records first, or deactivate the user instead." 
        });
      }
      
      res.status(500).json({ message: "Failed to delete user account" });
    }
  });

  // Update user account information
  app.patch("/api/users/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.params.id;
      const updates = req.body;
      
      console.log('Update user endpoint - User ID:', userId);
      console.log('Update user endpoint - Updates:', updates);
      console.log('Update user endpoint - Database environment:', req.dbEnv);
      
      // Check if sensitive fields are being updated (roles or status)
      const isSensitiveUpdate = updates.roles !== undefined || updates.status !== undefined;
      
      if (isSensitiveUpdate) {
        // Require password verification for sensitive updates
        const { password } = req.body;
        if (!password) {
          return res.status(400).json({ message: "Password verification required for role or status changes" });
        }
        
        // Verify the current user's password
        const currentUser = await envStorage.getUser(req.session!.userId!);
        if (!currentUser) {
          return res.status(404).json({ message: "Current user not found" });
        }
        
        const { authService } = await import("./auth");
        const isPasswordValid = await authService.verifyPassword(password, currentUser.passwordHash);
        if (!isPasswordValid) {
          return res.status(401).json({ message: "Invalid password" });
        }
        
        // Remove password from updates after verification
        delete updates.password;
      }
      
      // Remove sensitive fields that shouldn't be updated via this endpoint
      delete updates.passwordHash;
      delete updates.passwordResetToken;
      delete updates.passwordResetExpires;
      delete updates.id;
      delete updates.createdAt;
      
      // Use dynamic database connection if available, otherwise use default storage
      const dynamicDB = getRequestDB(req);
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
  app.post("/api/users/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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
          mustChangePassword: true, // Force password change on next login
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

  // Get user lockout status - check for recent failed login attempts
  app.get("/api/users/:id/lockout-status", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const userId = req.params.id;
      const dynamicDB = getRequestDB(req);
      const schema = await import('@shared/schema');
      const { eq, or, and, gte } = await import('drizzle-orm');
      
      // Get the user first
      const users = await dynamicDB
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      
      const user = users[0];
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check for failed login attempts in the last 15 minutes
      const lockoutTime = 15 * 60 * 1000; // 15 minutes
      const maxAttempts = 5;
      const timeThreshold = new Date(Date.now() - lockoutTime);
      
      const recentAttempts = await dynamicDB
        .select()
        .from(schema.loginAttempts)
        .where(and(
          or(
            eq(schema.loginAttempts.username, user.username),
            eq(schema.loginAttempts.email, user.email)
          ),
          eq(schema.loginAttempts.success, false),
          gte(schema.loginAttempts.createdAt, timeThreshold)
        ));
      
      const failedAttempts = recentAttempts.length;
      const isLockedOut = failedAttempts >= maxAttempts;
      
      // Get the most recent failure reason if locked out
      let lastFailureReason = null;
      if (isLockedOut && recentAttempts.length > 0) {
        const sortedAttempts = recentAttempts.sort((a: any, b: any) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        lastFailureReason = sortedAttempts[0]?.failureReason;
      }
      
      res.json({
        userId,
        username: user.username,
        isLockedOut,
        failedAttempts,
        maxAttempts,
        lockoutDuration: '15 minutes',
        lastFailureReason,
        lockedUntil: isLockedOut ? new Date(Date.now() + lockoutTime - (Date.now() - Math.max(...recentAttempts.map((a: any) => new Date(a.createdAt).getTime())))).toISOString() : null
      });
    } catch (error) {
      console.error("Error checking user lockout status:", error);
      res.status(500).json({ message: "Failed to check lockout status" });
    }
  });

  // Clear user lockout - delete recent failed login attempts
  app.post("/api/users/:id/clear-lockout", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const userId = req.params.id;
      const dynamicDB = getRequestDB(req);
      const schema = await import('@shared/schema');
      const { eq, or, and } = await import('drizzle-orm');
      
      // Get the user first
      const users = await dynamicDB
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      
      const user = users[0];
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Delete failed login attempts for this user
      const result = await dynamicDB
        .delete(schema.loginAttempts)
        .where(and(
          or(
            eq(schema.loginAttempts.username, user.username),
            eq(schema.loginAttempts.email, user.email)
          ),
          eq(schema.loginAttempts.success, false)
        ));
      
      console.log(`Cleared lockout for user ${user.username} (${userId})`);
      
      res.json({
        message: "Lockout cleared successfully",
        userId,
        username: user.username
      });
    } catch (error) {
      console.error("Error clearing user lockout:", error);
      res.status(500).json({ message: "Failed to clear lockout" });
    }
  });

  // Agent password reset
  app.post("/api/agents/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const agent = await envStorage.getAgent(parseInt(id));
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get the user account for this agent
      const user = await envStorage.getAgentUser(parseInt(id));
      if (!user) {
        return res.status(404).json({ message: "User account not found for agent" });
      }

      // Generate new temporary password
      const temporaryPassword = Math.random().toString(36).slice(-12);
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      // Update user password with mustChangePassword flag
      await envStorage.updateUser(user.id, { 
        passwordHash,
        mustChangePassword: true // Force password change on next login
      });

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
  app.post("/api/merchants/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const merchant = await envStorage.getMerchant(parseInt(id));
      
      if (!merchant) {
        return res.status(404).json({ message: "Merchant not found" });
      }

      // Get the user account for this merchant
      const user = await envStorage.getMerchantUser(parseInt(id));
      if (!user) {
        return res.status(404).json({ message: "User account not found for merchant" });
      }

      // Generate new temporary password
      const temporaryPassword = Math.random().toString(36).slice(-12);
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      // Update user password with mustChangePassword flag
      await envStorage.updateUser(user.id, { 
        passwordHash,
        mustChangePassword: true // Force password change on next login
      });

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
      const envStorage = createStorageForRequest(req);
      const userId = req.user?.id || req.user?.claims?.sub;
      const { search } = req.query;

      // Use role-based filtering from storage layer
      const merchants = await envStorage.getMerchantsForUser(userId);

      if (search) {
        const filteredMerchants = merchants.filter(merchant =>
          merchant.businessName.toLowerCase().includes(search.toLowerCase()) ||
          merchant.email.toLowerCase().includes(search.toLowerCase())
        );
        res.json(filteredMerchants);
      } else {
        res.json(merchants);
      }
    } catch (error) {
      console.error("Error fetching merchants:", error);
      res.status(500).json({ message: "Failed to fetch merchants" });
    }
  });

  // Location routes with role-based access
  app.get("/api/merchants/:merchantId/locations", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { merchantId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // For merchant users, only allow access to their own merchant data
      if (user?.role === 'merchant') {
        // For now, we'll allow merchant users to access merchant ID 1
        // TODO: Implement proper merchant-user association
        if (parseInt(merchantId) !== 1) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const locations = await envStorage.getLocationsByMerchant(parseInt(merchantId));
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/merchants/:merchantId/locations", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { merchantId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // For merchant users, only allow access to their own merchant data
      if (user?.role === 'merchant') {
        if (parseInt(merchantId) !== 1) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const validatedData = insertLocationSchema.parse({
        ...req.body,
        merchantId: parseInt(merchantId)
      });
      
      const location = await envStorage.createLocation(validatedData);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });



  app.put("/api/locations/:locationId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await envStorage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const validatedData = insertLocationSchema.partial().parse(req.body);
      const updatedLocation = await envStorage.updateLocation(parseInt(locationId), validatedData);
      
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
      const envStorage = createStorageForRequest(req);
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await envStorage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const success = await envStorage.deleteLocation(parseInt(locationId));
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
  app.get("/api/locations/:locationId/addresses", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await envStorage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const addresses = await envStorage.getAddressesByLocation(parseInt(locationId));
      res.json(addresses);
    } catch (error) {
      console.error("Error fetching addresses:", error);
      res.status(500).json({ message: "Failed to fetch addresses" });
    }
  });

  app.post("/api/locations/:locationId/addresses", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { locationId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get location to check merchant ownership
      const location = await envStorage.getLocation(parseInt(locationId));
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const validatedData = insertAddressSchema.parse({
        ...req.body,
        locationId: parseInt(locationId)
      });
      
      const address = await envStorage.createAddress(validatedData);
      res.json(address);
    } catch (error) {
      console.error("Error creating address:", error);
      res.status(500).json({ message: "Failed to create address" });
    }
  });

  app.put("/api/addresses/:addressId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { addressId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get address and location to check merchant ownership
      const address = await envStorage.getAddress(parseInt(addressId));
      if (!address) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      const location = await envStorage.getLocation(address.locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const validatedData = insertAddressSchema.partial().parse(req.body);
      const updatedAddress = await envStorage.updateAddress(parseInt(addressId), validatedData);
      
      if (!updatedAddress) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error updating address:", error);
      res.status(500).json({ message: "Failed to update address" });
    }
  });

  app.delete("/api/addresses/:addressId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { addressId } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get address and location to check merchant ownership
      const address = await envStorage.getAddress(parseInt(addressId));
      if (!address) {
        return res.status(404).json({ message: "Address not found" });
      }
      
      const location = await envStorage.getLocation(address.locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const success = await envStorage.deleteAddress(parseInt(addressId));
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
  app.get("/api/transactions", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      const { search } = req.query;

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // For agents, only show transactions for their assigned merchants
      if (user.role === 'agent') {
        const transactions = await envStorage.getTransactionsForUser(userId);
        
        if (search) {
          const filteredTransactions = transactions.filter(t => 
            t.transactionId.toLowerCase().includes(search.toString().toLowerCase()) ||
            t.merchant?.businessName?.toLowerCase().includes(search.toString().toLowerCase()) ||
            t.amount.toString().includes(search.toString()) ||
            t.paymentMethod.toLowerCase().includes(search.toString().toLowerCase())
          );
          return res.json(filteredTransactions);
        }
        
        return res.json(transactions);
      }

      // For merchants, only show their own transactions
      if (user.role === 'merchant') {
        const transactions = await envStorage.getTransactionsForUser(userId);
        
        if (search) {
          const filteredTransactions = transactions.filter(t => 
            t.transactionId.toLowerCase().includes(search.toString().toLowerCase()) ||
            t.amount.toString().includes(search.toString()) ||
            t.paymentMethod.toLowerCase().includes(search.toString().toLowerCase())
          );
          return res.json(filteredTransactions);
        }
        
        return res.json(transactions);
      }

      // For admin/corporate/super_admin, show all transactions
      if (['admin', 'corporate', 'super_admin'].includes(user.role)) {
        if (search) {
          const transactions = await envStorage.searchTransactions(search as string);
          return res.json(transactions);
        } else {
          const transactions = await envStorage.getAllTransactions();
          return res.json(transactions);
        }
      }

      // Default fallback - use role-based filtering from storage layer
      const transactions = await envStorage.getTransactionsForUser(userId);

      if (search) {
        const filteredTransactions = transactions.filter(transaction =>
          transaction.transactionId.toLowerCase().includes(search.toString().toLowerCase()) ||
          transaction.merchant?.businessName?.toLowerCase().includes(search.toString().toLowerCase()) ||
          transaction.amount.toString().includes(search.toString()) ||
          transaction.paymentMethod.toLowerCase().includes(search.toString().toLowerCase())
        );
        return res.json(filteredTransactions);
      }

      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Get transactions by MID (location-specific transactions)
  app.get("/api/transactions/mid/:mid", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { mid } = req.params;
      const userId = req.user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      // Get location by MID to check access permissions
      const locations = await envStorage.getLocationsByMerchant(0); // Get all locations first
      const location = locations.find(loc => loc.mid === mid);
      
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Check if user has access to this merchant
      if (user?.role === 'merchant' && location.merchantId !== 1) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const transactions = await envStorage.getTransactionsByMID(mid);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions by MID:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Agent-merchant assignment routes (admin only)
  app.post("/api/agents/:agentId/merchants/:merchantId", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { agentId, merchantId } = req.params;
      const userId = (req as any).user.claims.sub;
      console.log(`Agent assignment endpoint - Database environment: ${req.dbEnv}`);

      const assignment = await envStorage.assignAgentToMerchant(
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

  app.delete("/api/agents/:agentId/merchants/:merchantId", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { agentId, merchantId } = req.params;
      console.log(`Agent unassignment endpoint - Database environment: ${req.dbEnv}`);

      const success = await envStorage.unassignAgentFromMerchant(
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
  app.get("/api/agents/:agentId/merchants", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { agentId } = req.params;
      const dynamicDB = getRequestDB(req);
      console.log(`Agent merchants endpoint - Database environment: ${req.dbEnv}`);
      
      // Use dynamic database to get agent merchants  
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
      console.log(`🔍 PROSPECTS ENDPOINT - req.dbEnv: ${req.dbEnv}, session.dbEnv: ${(req.session as any)?.dbEnv}`);
      console.log(`🔍 PROSPECTS ENDPOINT - Host: ${req.get('host')}`);
      
      // Use req.storage set by middleware, fallback to createStorageForRequest
      const envStorage = req.storage || createStorageForRequest(req);
      console.log(`🔍 PROSPECTS ENDPOINT - Using storage from: ${req.storage ? 'req.storage (middleware)' : 'createStorageForRequest'}`);
      
      const { search } = req.query;
      const userId = (req.session as any).userId;
      const user = await envStorage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      let prospects;
      
      // Get user roles (handle both single role and roles array)
      const userRoles = user.roles || (user.role ? [user.role] : []);
      
      if (userRoles.includes('agent')) {
        // Agents can only see their assigned prospects
        let agent = await envStorage.getAgentByUserId(userId);
        
        // If no agent found, use fallback for development/testing
        if (!agent && userId === 'user_agent_1') {
          // For development, fallback to agent ID 2 (Mike Chen)
          agent = await envStorage.getAgent(2);
          console.log('Using fallback agent for prospects:', agent?.firstName, agent?.lastName);
        }
        
        if (!agent) {
          return res.status(403).json({ message: "Agent not found" });
        }
        
        if (search) {
          prospects = await envStorage.searchMerchantProspectsByAgent(agent.id, search as string);
        } else {
          prospects = await envStorage.getMerchantProspectsByAgent(agent.id);
        }
      } else if (userRoles.some(role => ['admin', 'corporate', 'super_admin'].includes(role))) {
        // Admins can see all prospects
        if (search) {
          prospects = await envStorage.searchMerchantProspects(search as string);
        } else {
          prospects = await envStorage.getAllMerchantProspects();
        }
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Include campaign assignment for each prospect
      const prospectsWithCampaign = await Promise.all(
        prospects.map(async (prospect) => {
          const campaignAssignment = await envStorage.getProspectCampaignAssignment(prospect.id);
          return {
            ...prospect,
            campaignId: campaignAssignment?.campaignId || null,
          };
        })
      );
      
      res.json(prospectsWithCampaign);
    } catch (error) {
      console.error("Error fetching prospects:", error);
      res.status(500).json({ message: "Failed to fetch prospects" });
    }
  });

  app.post("/api/prospects", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { insertMerchantProspectSchema } = await import("@shared/schema");
      const { emailService } = await import("./emailService");
      
      // Check user role authorization
      const userId = (req.session as any).userId;
      const user = await envStorage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get user roles (handle both single role and roles array)
      const userRoles = user.roles || (user.role ? [user.role] : []);
      
      if (!userRoles.some(role => ['agent', 'admin', 'corporate', 'super_admin'].includes(role))) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      // Extract campaignId from request body for campaign assignment
      const { campaignId, ...prospectData } = req.body;
      
      // Validate campaign assignment is provided
      if (!campaignId || campaignId === 0) {
        return res.status(400).json({ message: "Campaign assignment is required" });
      }
      
      // If user is an agent, automatically use their agent ID
      let finalAgentId = prospectData.agentId;
      if (userRoles.includes('agent')) {
        const agentRecord = await envStorage.getAgentByUserId(userId);
        if (agentRecord) {
          finalAgentId = agentRecord.id;
          console.log(`Auto-assigned agent ID ${finalAgentId} for user ${userId}`);
        } else {
          return res.status(400).json({ message: "Agent record not found for current user. Please contact support." });
        }
      }
      
      const result = insertMerchantProspectSchema.safeParse({
        ...prospectData,
        agentId: finalAgentId
      });
      if (!result.success) {
        return res.status(400).json({ message: "Invalid prospect data", errors: result.error.errors });
      }

      // Validate agentId
      const agent = await envStorage.getAgent(result.data.agentId);
      if (!agent) {
        return res.status(400).json({ message: `Invalid agent ID: ${result.data.agentId}. Agent not found.` });
      }

      // Generate validation token for the prospect
      const crypto = await import('crypto');
      const validationToken = crypto.randomUUID();
      
      // Create prospect with validation token and capture the database environment
      const adminDbEnv = (req.session as any)?.dbEnv || 'development';
      const prospect = await envStorage.createMerchantProspect({
        ...result.data,
        validationToken,
        databaseEnv: adminDbEnv
      });
      
      // Create campaign assignment
      await envStorage.assignCampaignToProspect(campaignId, prospect.id, userId);
      
      // Auto-create prospect application if campaign has a template assigned
      const { campaignApplicationTemplates, acquirerApplicationTemplates, prospectApplications } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const dynamicDB = getRequestDB(req);
      
      // Get the campaign's template
      const campaignTemplates = await dynamicDB
        .select()
        .from(campaignApplicationTemplates)
        .where(eq(campaignApplicationTemplates.campaignId, campaignId));
      
      if (campaignTemplates && campaignTemplates.length > 0) {
        const templateId = campaignTemplates[0].templateId;
        
        // Get the template details to find the acquirer
        const templates = await dynamicDB.select()
          .from(acquirerApplicationTemplates)
          .where(eq(acquirerApplicationTemplates.id, templateId));
        
        if (templates && templates.length > 0) {
          const template = templates[0];
          
          // Create the prospect application automatically
          await dynamicDB.insert(prospectApplications).values({
            prospectId: prospect.id,
            acquirerId: template.acquirerId,
            templateId: template.id,
            templateVersion: template.version || '1.0',
            status: 'draft',
            applicationData: {}
          });
          
          console.log(`Auto-created prospect application for prospect ${prospect.id} using template ${template.templateName} v${template.version}`);
        }
      }
      
      // Use already fetched agent information for email
      console.log(`Email debug - Agent found:`, agent ? `${agent.firstName} ${agent.lastName}` : 'No agent');
      console.log(`Email debug - Validation token:`, prospect.validationToken ? 'Present' : 'Missing');
      
      // Send validation email if agent information is available
      if (agent && prospect.validationToken) {
        console.log(`Attempting to send validation email to: ${prospect.email}`);
        const emailSent = await emailService.sendProspectValidationEmail({
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          email: prospect.email,
          validationToken: prospect.validationToken,
          agentName: `${agent.firstName} ${agent.lastName}`,
          dbEnv: req.dbEnv,
        });
        
        if (emailSent) {
          console.log(`Validation email sent successfully to prospect: ${prospect.email}`);
        } else {
          console.warn(`Failed to send validation email to prospect: ${prospect.email}`);
        }
      } else {
        console.warn(`Email not sent - Missing agent: ${!agent}, Missing token: ${!prospect.validationToken}`);
      }
      
      res.status(201).json(prospect);
    } catch (error) {
      console.error("Error creating prospect:", error);
      
      // Handle specific database constraint errors
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') { // Unique constraint violation
          const detail = (error as any).detail || '';
          if (detail.includes('email')) {
            return res.status(400).json({ 
              message: "A prospect with this email already exists. Please use a different email address." 
            });
          }
          return res.status(400).json({ 
            message: "A record with these details already exists" 
          });
        }
      }
      
      res.status(500).json({ message: "Failed to create prospect" });
    }
  });

  app.put("/api/prospects/:id", dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const prospectId = parseInt(id);
      
      // If email is being updated, check if it already exists for a different prospect
      if (req.body.email) {
        const existingProspect = await envStorage.getMerchantProspectByEmail(req.body.email);
        if (existingProspect && existingProspect.id !== prospectId) {
          return res.status(400).json({ 
            message: "A prospect with this email already exists" 
          });
        }
      }
      
      const prospect = await envStorage.updateMerchantProspect(prospectId, req.body);
      
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

  app.post("/api/prospects/:id/resend-invitation", dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { emailService } = await import("./emailService");
      
      // Get prospect details
      const prospect = await envStorage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Get agent information
      const agent = await envStorage.getAgent(prospect.agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Generate validation token if one doesn't exist
      let validationToken = prospect.validationToken;
      if (!validationToken) {
        const crypto = await import('crypto');
        validationToken = crypto.randomUUID();
        
        // Update prospect with the new validation token
        const updatedProspect = await envStorage.updateMerchantProspect(parseInt(id), {
          validationToken
        });
        
        if (!updatedProspect) {
          return res.status(500).json({ message: "Failed to generate validation token" });
        }
        
        console.log(`Generated new validation token for prospect: ${prospect.email}`);
      }

      // Send validation email
      const emailSent = await emailService.sendProspectValidationEmail({
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        validationToken,
        agentName: `${agent.firstName} ${agent.lastName}`,
        dbEnv: req.dbEnv,
      });
      
      if (emailSent) {
        console.log(`Validation email sent to prospect: ${prospect.email}`);
        res.json({ success: true, message: "Invitation email sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send invitation email" });
      }
    } catch (error) {
      console.error("Error resending invitation:", error);
      res.status(500).json({ message: "Failed to resend invitation" });
    }
  });

  // Save agent signature for a prospect
  app.post("/api/prospects/:id/agent-signature", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { agentSignature, agentSignatureType } = req.body;
      
      const prospect = await envStorage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }
      
      // Update prospect with agent signature
      const updatedProspect = await envStorage.updateMerchantProspect(parseInt(id), {
        agentSignature,
        agentSignatureType,
        agentSignedAt: new Date().toISOString(),
      });
      
      if (!updatedProspect) {
        return res.status(500).json({ message: "Failed to save agent signature" });
      }
      
      res.json({ success: true, prospect: updatedProspect });
    } catch (error) {
      console.error("Error saving agent signature:", error);
      res.status(500).json({ message: "Failed to save agent signature" });
    }
  });

  app.delete("/api/prospects/:id", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      
      // Check user role authorization
      const userId = (req.session as any).userId;
      const user = await envStorage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get user roles (handle both single role and roles array)
      const userRoles = user.roles || (user.role ? [user.role] : []);
      
      if (!userRoles.some(role => ['agent', 'admin', 'corporate', 'super_admin'].includes(role))) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      const success = await envStorage.deleteMerchantProspect(parseInt(id));
      
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

  // Bulk operations for prospects
  app.post("/api/prospects/bulk-delete", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      
      // Delete all prospects with the given IDs
      const deletedCount = await Promise.all(
        ids.map(id => envStorage.deleteMerchantProspect(id))
      ).then(results => results.filter(Boolean).length);
      
      res.json({ 
        success: true, 
        deletedCount,
        message: `Successfully deleted ${deletedCount} of ${ids.length} prospects`
      });
    } catch (error) {
      console.error("Error deleting prospects in bulk:", error);
      res.status(500).json({ message: "Failed to delete prospects" });
    }
  });

  app.post("/api/prospects/bulk-status-update", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { ids, status } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      
      if (!status || !['pending', 'approved', 'rejected', 'in_progress', 'submitted'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      // Update all prospects with the new status
      const updatedProspects = await Promise.all(
        ids.map(id => envStorage.updateMerchantProspect(id, { status }))
      );
      
      const successCount = updatedProspects.filter(Boolean).length;
      
      res.json({ 
        success: true, 
        updatedCount: successCount,
        message: `Successfully updated ${successCount} of ${ids.length} prospects to ${status}`
      });
    } catch (error) {
      console.error("Error updating prospect statuses in bulk:", error);
      res.status(500).json({ message: "Failed to update prospect statuses" });
    }
  });

  // Get individual prospect for application view
  app.get("/api/prospects/view/:id", dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      console.log('Fetching prospect ID:', id);
      
      const userId = req.user.claims.sub;
      console.log('User ID from session:', userId);
      
      // Get user data
      const user = await envStorage.getUser(userId);
      if (!user) {
        console.log('User not found for ID:', userId);
        return res.status(404).json({ message: "User not found" });
      }
      console.log('Found user:', user.email, 'role:', user.role);

      // Get prospect data
      const prospect = await envStorage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        console.log('Prospect not found for ID:', id);
        return res.status(404).json({ message: "Prospect not found" });
      }
      console.log('Found prospect:', prospect.firstName, prospect.lastName, 'agentId:', prospect.agentId);

      // For agents, check if this prospect is assigned to them
      if (user.role === 'agent') {
        let agent = await envStorage.getAgentByUserId(userId);
        
        // If no agent found, use fallback for development/testing
        if (!agent && userId === 'user_agent_1') {
          // For development, fallback to agent ID 2 (Mike Chen)
          agent = await envStorage.getAgent(2);
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
        const agent = await envStorage.getAgent(prospect.agentId);
        if (agent) {
          assignedAgent = `${agent.firstName} ${agent.lastName}`;
        }
      }

      console.log('Returning prospect data with assigned agent:', assignedAgent);
      // Return prospect with agent info
      res.json({
        ...prospect,
        assignedAgent
      });
    } catch (error) {
      console.error("Error fetching prospect:", error);
      res.status(500).json({ message: "Failed to fetch prospect", error: error.message });
    }
  });

  // Prospect validation route (public, no auth required)
  app.post("/api/prospects/validate", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const prospect = await envStorage.getMerchantProspectByEmail(email);
      
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
      await envStorage.updateMerchantProspect(prospect.id, {
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

  // Validate prospect by token (public, no auth required)
  app.post("/api/prospects/validate-token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ message: "Token is required" });
      }

      const prospect = await envStorage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Invalid or expired token" });
      }

      // Update validation timestamp if not already validated
      if (!prospect.validatedAt) {
        await envStorage.updateMerchantProspect(prospect.id, {
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

  // Prospect Authentication Endpoints
  
  // Set password for prospect portal (public, uses reset token)
  app.post("/api/prospects/auth/set-password", async (req: RequestWithDB, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ 
          success: false, 
          message: "Token and password are required" 
        });
      }
      
      // Validate password strength using shared validation function
      const { validatePasswordStrength } = await import('./services/userAccountService');
      const validationResult = validatePasswordStrength(password);
      if (!validationResult.valid) {
        return res.status(400).json({ 
          success: false, 
          message: validationResult.error || "Password does not meet strength requirements"
        });
      }
      
      // Find user by password reset token
      const dynamicDB = getRequestDB(req);
      const { users } = await import('@shared/schema');
      const { eq, and, gt } = await import('drizzle-orm');
      const bcrypt = await import('bcrypt');
      
      const [user] = await dynamicDB
        .select()
        .from(users)
        .where(
          and(
            eq(users.passwordResetToken, token),
            gt(users.passwordResetExpires, new Date())
          )
        )
        .limit(1);
      
      if (!user) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid or expired token" 
        });
      }
      
      // Verify user has prospect role
      if (!user.roles || !user.roles.includes('prospect')) {
        return res.status(403).json({ 
          success: false, 
          message: "This endpoint is only for prospect accounts" 
        });
      }
      
      // Hash password and update user
      const passwordHash = await bcrypt.hash(password, 10);
      
      await dynamicDB
        .update(users)
        .set({
          passwordHash,
          status: 'active',
          passwordResetToken: null,
          passwordResetExpires: null
        })
        .where(eq(users.id, user.id));
      
      console.log(`Prospect ${user.email} successfully set password`);
      
      res.json({ 
        success: true, 
        message: "Password set successfully. You can now log in to the prospect portal." 
      });
    } catch (error) {
      console.error("Prospect password setup error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to set password" 
      });
    }
  });
  
  // Prospect portal login (public)
  app.post("/api/prospects/auth/login", async (req: RequestWithDB, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          message: "Email and password are required" 
        });
      }
      
      // Find user by email
      const dynamicDB = getRequestDB(req);
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const bcrypt = await import('bcrypt');
      
      const [user] = await dynamicDB
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      
      if (!user || !user.passwordHash) {
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
      
      // Verify user has prospect role
      if (!user.roles || !user.roles.includes('prospect')) {
        return res.status(403).json({ 
          success: false, 
          message: "This login is only for prospect accounts. Please use the main login page." 
        });
      }
      
      // Check user status
      if (user.status === 'pending_password') {
        return res.status(403).json({ 
          success: false, 
          message: "Please set your password first using the link sent to your email." 
        });
      }
      
      if (user.status === 'suspended') {
        return res.status(403).json({ 
          success: false, 
          message: "Your account has been suspended. Please contact support." 
        });
      }
      
      if (user.status !== 'active') {
        return res.status(403).json({ 
          success: false, 
          message: "Your account is not active. Please contact support." 
        });
      }
      
      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      
      if (!isPasswordValid) {
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
      
      // Get prospect record linked to this user using environment-aware storage
      const envStorage = createStorageForRequest(req);
      const prospect = await envStorage.getProspectByUserId(user.id);
      
      if (!prospect) {
        return res.status(404).json({ 
          success: false, 
          message: "Prospect record not found. Please contact support." 
        });
      }
      
      // Create session using the prospect's stored database environment
      // This ensures the prospect always accesses the same database they were created in
      const prospectDbEnv = (prospect as any).databaseEnv || req.dbEnv || 'development';
      req.session.userId = user.id;
      req.session.sessionId = `prospect-${Date.now()}`;
      req.session.dbEnv = prospectDbEnv;
      
      console.log(`Prospect login successful: ${user.email}, prospectId: ${prospect.id}, dbEnv: ${prospectDbEnv}`);
      
      // Force session save before responding
      req.session.save((err: any) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ 
            success: false, 
            message: "Login failed. Please try again." 
          });
        }
        
        res.json({ 
          success: true, 
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            roles: user.roles
          },
          prospect: {
            id: prospect.id,
            status: prospect.status
          }
        });
      });
    } catch (error) {
      console.error("Prospect login error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Login failed. Please try again." 
      });
    }
  });

  // Prospect Document Management Endpoints
  
  // Middleware to verify prospect owns the resource or is authorized
  const requireProspectAuth = async (req: RequestWithDB, res: Response, next: any) => {
    console.log(`🔐 requireProspectAuth - Session userId: ${req.session?.userId}, dbEnv: ${req.dbEnv}`);
    console.log(`🔐 req.db exists: ${!!req.db}, req.dynamicDB exists: ${!!req.dynamicDB}`);
    
    if (!req.session?.userId) {
      console.log("❌ No session userId");
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    
    // Use request-specific storage to respect database environment
    // IMPORTANT: Don't use req.db - it may be bound to wrong connection pool
    // Always call getDynamicDatabase with the session's dbEnv to get correct pool
    const dbEnv = req.dbEnv || 'development';
    const correctDb = getDynamicDatabase(dbEnv);
    console.log(`🔐 Using database for environment: ${dbEnv}`);
    const requestStorage = createStorage(correctDb);
    
    const user = await requestStorage.getUser(req.session.userId);
    console.log(`👤 User found: ${!!user}, roles: ${user?.roles}, dbEnv: ${req.dbEnv}`);
    
    if (!user || !user.roles.includes('prospect')) {
      console.log(`❌ User not found or missing prospect role`);
      return res.status(403).json({ success: false, message: "Prospect access only" });
    }
    
    // Get prospect record using request-specific storage
    const prospect = await requestStorage.getProspectByUserId(user.id);
    console.log(`📋 Prospect found: ${!!prospect}, id: ${prospect?.id}, dbEnv: ${req.dbEnv}`);
    
    if (!prospect) {
      console.log("❌ Prospect record not found");
      return res.status(404).json({ success: false, message: "Prospect record not found" });
    }
    
    // Attach prospect to request for use in handlers
    (req as any).prospect = prospect;
    console.log("✅ Prospect auth successful");
    next();
  };
  
  // Get presigned upload URL for document
  app.post("/api/prospects/:id/documents/upload-url", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const { fileName, fileType, fileSize } = req.body;
      
      if (!fileName || !fileType) {
        return res.status(400).json({ success: false, message: "fileName and fileType are required" });
      }
      
      // Generate unique storage key
      const storageKey = `prospects/${prospectId}/documents/${Date.now()}-${fileName}`;
      
      // Get presigned upload URL
      const objectStorageService = new ObjectStorageService();
      const uploadUrl = await objectStorageService.getUploadUrl(storageKey, {
        contentType: fileType,
        ownerId: prospect.userId!,
        acl: 'PROSPECT_OWNER'
      });
      
      res.json({ 
        success: true, 
        uploadUrl,
        storageKey
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ success: false, message: "Failed to generate upload URL" });
    }
  });
  
  // Create document metadata after successful upload
  app.post("/api/prospects/:id/documents", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const { fileName, originalFileName, fileType, fileSize, storageKey, category, notes } = req.body;
      
      if (!fileName || !fileType || !storageKey) {
        return res.status(400).json({ success: false, message: "fileName, fileType, and storageKey are required" });
      }
      
      // Set ACL on uploaded file
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.setFileAcl(storageKey, {
        visibility: 'private',
        ownerId: prospect.userId!,
        acl: 'PROSPECT_OWNER'
      });
      
      // Create document record using environment-aware storage
      const envStorage = createStorageForRequest(req);
      const document = await envStorage.createProspectDocument({
        prospectId,
        fileName,
        originalFileName: originalFileName || fileName,
        fileType,
        fileSize: fileSize || 0,
        storageKey,
        category: category || 'general',
        uploadedBy: prospect.userId,
        notes: notes || null
      });
      
      res.json({ success: true, document });
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ success: false, message: "Failed to create document" });
    }
  });
  
  // List prospect documents
  app.get("/api/prospects/:id/documents", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Use dynamic database based on session environment
      const dbEnv = req.dbEnv || 'development';
      const correctDb = getDynamicDatabase(dbEnv);
      const requestStorage = createStorage(correctDb);
      
      const documents = await requestStorage.getProspectDocuments(prospectId);
      res.json({ success: true, documents });
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ success: false, message: "Failed to fetch documents" });
    }
  });
  
  // Get presigned download URL for document
  app.get("/api/prospects/:id/documents/:docId/download-url", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const docId = parseInt(req.params.docId);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Use dynamic database based on session environment
      const dbEnv = req.dbEnv || 'development';
      const correctDb = getDynamicDatabase(dbEnv);
      const requestStorage = createStorage(correctDb);
      
      // Get document metadata
      const document = await requestStorage.getProspectDocument(docId);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found" });
      }
      
      // Verify document belongs to this prospect
      if (document.prospectId !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Get presigned download URL - for generated PDFs, use admin-level access
      const objectStorageService = new ObjectStorageService();
      const downloadUrl = await objectStorageService.getDownloadUrl(document.storageKey, {
        userId: prospect.userId!,
        acl: 'ADMIN' // Use ADMIN ACL to allow prospect access to their generated PDF
      });
      
      res.json({ success: true, downloadUrl, document });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        console.error("Access denied for document download:", error);
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      console.error("Error generating download URL:", error);
      res.status(500).json({ success: false, message: "Failed to generate download URL" });
    }
  });
  
  // Delete document
  app.delete("/api/prospects/:id/documents/:docId", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const docId = parseInt(req.params.docId);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Get document metadata using environment-aware storage
      const envStorage = createStorageForRequest(req);
      const document = await envStorage.getProspectDocument(docId);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found" });
      }
      
      // Verify document belongs to this prospect
      if (document.prospectId !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Delete from storage
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteFile(document.storageKey);
      
      // Delete metadata from database
      await envStorage.deleteProspectDocument(docId);
      
      res.json({ success: true, message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ success: false, message: "Failed to delete document" });
    }
  });

  // Get prospect's application with template field configuration for read-only view
  app.get("/api/prospects/:id/application", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ success: false, message: "Database connection not available" });
      }
      
      const { prospectApplications, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the application with template data - use authenticated prospect's ID for security
      const [applicationData] = await dbToUse.select({
        application: prospectApplications,
        template: acquirerApplicationTemplates
      })
      .from(prospectApplications)
      .leftJoin(acquirerApplicationTemplates, eq(prospectApplications.templateId, acquirerApplicationTemplates.id))
      .where(eq(prospectApplications.prospectId, prospect.id))
      .limit(1);
      
      if (!applicationData || !applicationData.application) {
        return res.json({ success: true, application: null });
      }
      
      const { application, template } = applicationData;
      
      // Transform template fieldConfiguration to formSections for frontend display
      // Template uses: fieldName (data key), fieldLabel (display label), fieldType
      let formSections: any[] = [];
      
      // Helper function to transform sections to display format
      const transformSectionsToDisplay = (sections: any[]) => {
        return sections
          .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
          .map((section: any, sectionIndex: number) => ({
            id: section.id || section.title?.toLowerCase().replace(/\s+/g, '_') || `section_${sectionIndex}`,
            title: section.title || 'Section',
            description: section.description || '',
            order: section.order || sectionIndex,
            fields: (section.fields || [])
              .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
              .map((field: any) => {
                const fieldName = field.fieldName || field.name || field.id;
                const fieldType = field.fieldType || field.type || 'text';
                return {
                  id: fieldName,
                  type: fieldType,
                  label: field.fieldLabel || field.label || fieldName,
                  required: field.isRequired || field.required || false,
                  helpText: field.helpText || field.helperText || '',
                  sensitive: field.sensitive || fieldType === 'ssn' || 
                    fieldName?.toLowerCase().includes('ssn') || 
                    fieldName?.toLowerCase().includes('taxid') ||
                    fieldName?.toLowerCase().includes('federaltaxid') ||
                    fieldName?.toLowerCase().includes('socialsecurity')
                };
              })
          }));
      };
      
      // Try to get field configuration from template
      let fieldConfigLoaded = false;
      if (template?.fieldConfiguration) {
        try {
          const fieldConfig = typeof template.fieldConfiguration === 'string' 
            ? JSON.parse(template.fieldConfiguration) 
            : template.fieldConfiguration;
          
          if (Array.isArray(fieldConfig) && fieldConfig.length > 0) {
            formSections = transformSectionsToDisplay(fieldConfig);
            fieldConfigLoaded = true;
          }
        } catch (parseError) {
          console.error("Error parsing fieldConfiguration:", parseError);
        }
      }
      
      // Build a field label lookup from template sections
      const fieldLabelMap: Record<string, { label: string; section: string; sensitive: boolean }> = {};
      formSections.forEach(section => {
        section.fields.forEach((field: any) => {
          fieldLabelMap[field.id] = {
            label: field.label,
            section: section.title,
            sensitive: field.sensitive
          };
        });
      });
      
      // Build display sections from actual applicationData
      // Group fields by detected category based on field name patterns
      const appData = application.applicationData || {};
      const fieldGroups: Record<string, { title: string; description: string; fields: any[] }> = {
        'business': { title: 'Business Information', description: 'Business details and contact information', fields: [] },
        'owner': { title: 'Owner Information', description: 'Principal owner and business ownership details', fields: [] },
        'banking': { title: 'Banking Information', description: 'Bank account and payment details', fields: [] },
        'contact': { title: 'Contact Information', description: 'Contact details', fields: [] },
        'other': { title: 'Additional Information', description: 'Other application details', fields: [] }
      };
      
      // Helper to convert camelCase to Title Case
      const formatLabel = (key: string): string => {
        return key
          .replace(/([A-Z])/g, ' $1')
          .replace(/[._]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .trim();
      };
      
      // Categorize each field
      Object.keys(appData).forEach(key => {
        const lowerKey = key.toLowerCase();
        const isSensitive = lowerKey.includes('ssn') || lowerKey.includes('taxid') || 
          lowerKey.includes('federaltaxid') || lowerKey.includes('socialsecurity') ||
          lowerKey.includes('routingnumber') || lowerKey.includes('accountnumber');
        
        // Get label from template if available, otherwise format the key
        const templateInfo = fieldLabelMap[key];
        const label = templateInfo?.label || formatLabel(key);
        
        const fieldData = {
          id: key,
          type: 'text',
          label,
          required: false,
          sensitive: isSensitive || templateInfo?.sensitive || false
        };
        
        // Categorize based on field name
        if (lowerKey.includes('owner') || lowerKey.includes('principal') || lowerKey.includes('beneficial')) {
          fieldGroups['owner'].fields.push(fieldData);
        } else if (lowerKey.includes('bank') || lowerKey.includes('routing') || lowerKey.includes('account')) {
          fieldGroups['banking'].fields.push(fieldData);
        } else if (lowerKey.includes('contact') || lowerKey.includes('phone') || lowerKey.includes('fax')) {
          fieldGroups['contact'].fields.push(fieldData);
        } else if (lowerKey.includes('business') || lowerKey.includes('company') || lowerKey.includes('dba') || 
                   lowerKey.includes('merchant') || lowerKey.includes('legal') || lowerKey.includes('address') ||
                   lowerKey.includes('city') || lowerKey.includes('state') || lowerKey.includes('zip')) {
          fieldGroups['business'].fields.push(fieldData);
        } else {
          fieldGroups['other'].fields.push(fieldData);
        }
      });
      
      // Build final sections array, only including non-empty groups
      const dataDrivenSections = Object.entries(fieldGroups)
        .filter(([_, group]) => group.fields.length > 0)
        .map(([id, group], index) => ({
          id,
          title: group.title,
          description: group.description,
          order: index,
          fields: group.fields
        }));
      
      // Use data-driven sections if template sections don't have matching data
      const finalSections = dataDrivenSections.length > 0 ? dataDrivenSections : formSections;
      
      res.json({
        success: true,
        application: {
          id: application.id,
          prospectId: application.prospectId,
          acquirerId: application.acquirerId,
          templateId: application.templateId,
          applicationData: application.applicationData || {},
          status: application.status,
          submittedAt: application.submittedAt,
          template: template ? {
            templateName: template.templateName,
            formSections: finalSections
          } : null
        }
      });
    } catch (error) {
      console.error("Error fetching prospect application:", error);
      res.status(500).json({ success: false, message: "Failed to fetch application" });
    }
  });

  // Get download URL for completed application PDF (prospect-accessible)
  app.get("/api/prospects/:id/applications/:appId/download-pdf", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      const applicationId = parseInt(req.params.appId);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ success: false, message: "Database connection not available" });
      }
      
      const { prospectApplications, acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      
      // Get the application
      const [applicationData] = await dbToUse.select({
        application: prospectApplications,
        acquirer: acquirers,
        template: acquirerApplicationTemplates
      })
      .from(prospectApplications)
      .leftJoin(acquirers, eq(prospectApplications.acquirerId, acquirers.id))
      .leftJoin(acquirerApplicationTemplates, eq(prospectApplications.templateId, acquirerApplicationTemplates.id))
      .where(and(
        eq(prospectApplications.id, applicationId),
        eq(prospectApplications.prospectId, prospectId)
      ))
      .limit(1);
      
      if (!applicationData || !applicationData.application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }
      
      const { application, acquirer } = applicationData;
      
      // Check if PDF has been generated
      if (!application.generatedPdfPath) {
        return res.status(404).json({ success: false, message: "Completed application PDF not yet available" });
      }
      
      // Only allow PDF download for submitted applications
      if (!['submitted', 'approved'].includes(application.status)) {
        return res.status(400).json({ success: false, message: "PDF only available for submitted applications" });
      }
      
      // Generate download URL from object storage
      if (application.generatedPdfPath.startsWith('applications/')) {
        const { objectStorageService } = await import('./objectStorage');
        const downloadUrl = await objectStorageService.getDownloadUrl(application.generatedPdfPath, {
          userId: prospect.userId?.toString()
        });
        
        res.json({
          success: true,
          downloadUrl,
          filename: `${acquirer?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Application'}_${prospect.firstName}_${prospect.lastName}_Application.pdf`
        });
      } else {
        // Legacy file path - redirect to the file
        res.json({
          success: true,
          downloadUrl: `/api/prospect-applications/${applicationId}/download-pdf`,
          filename: `${acquirer?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Application'}_${prospect.firstName}_${prospect.lastName}_Application.pdf`
        });
      }
    } catch (error) {
      console.error("Error generating PDF download URL:", error);
      res.status(500).json({ success: false, message: "Failed to generate download URL" });
    }
  });

  // Prospect Notification Endpoints
  
  // Get all notifications for a prospect
  app.get("/api/prospects/:id/notifications", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const notifications = await envStorage.getProspectNotifications(prospectId);
      res.json({ success: true, notifications });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
  });
  
  // Get unread notification count for a prospect
  app.get("/api/prospects/:id/notifications/unread-count", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const unreadNotifications = await envStorage.getUnreadProspectNotifications(prospectId);
      res.json({ success: true, count: unreadNotifications.length });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ success: false, message: "Failed to fetch unread count" });
    }
  });
  
  // Mark notification as read
  app.patch("/api/prospects/:id/notifications/:notificationId/read", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const notificationId = parseInt(req.params.notificationId);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Get notification to verify ownership
      const notification = await envStorage.getProspectNotification(notificationId);
      if (!notification) {
        return res.status(404).json({ success: false, message: "Notification not found" });
      }
      
      // Verify notification belongs to this prospect
      if (notification.prospectId !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Mark as read
      const updatedNotification = await envStorage.markProspectNotificationAsRead(notificationId);
      res.json({ success: true, notification: updatedNotification });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ success: false, message: "Failed to mark notification as read" });
    }
  });
  
  // Create notification (admin/agent endpoint - for task 14, added here for completeness)
  app.post("/api/prospects/:id/notifications", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const { subject, message, type, metadata } = req.body;
      
      if (!subject || !message) {
        return res.status(400).json({ success: false, message: "subject and message are required" });
      }
      
      // Verify prospect exists
      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ success: false, message: "Prospect not found" });
      }
      
      // Create notification
      const notification = await envStorage.createProspectNotification({
        prospectId,
        subject,
        message,
        type: type || 'info',
        createdBy: req.session.userId!,
        metadata: metadata || null
      });
      
      res.json({ success: true, notification });
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ success: false, message: "Failed to create notification" });
    }
  });

  // =====================================================
  // PROSPECT MESSAGING ENDPOINTS (Prospect-Agent Communication)
  // =====================================================

  // Get messages for a prospect
  app.get("/api/prospects/:id/messages", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const messages = await envStorage.getProspectMessages(prospectId);
      res.json({ success: true, messages });
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ success: false, message: "Failed to fetch messages" });
    }
  });

  // Get unread message count for prospect
  app.get("/api/prospects/:id/messages/unread-count", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      // Count messages from agent that prospect hasn't read
      const count = await envStorage.getUnreadProspectMessagesCount(prospectId, 'agent');
      res.json({ success: true, count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ success: false, message: "Failed to fetch unread count" });
    }
  });

  // Send message from prospect to assigned agent
  app.post("/api/prospects/:id/messages", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      const userId = req.session.userId;
      
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const { subject, message } = req.body;
      if (!subject || !message) {
        return res.status(400).json({ success: false, message: "Subject and message are required" });
      }
      
      // Create message
      const newMessage = await envStorage.createProspectMessage({
        prospectId,
        agentId: prospect.agentId || null,
        senderId: userId!,
        senderType: 'prospect',
        subject,
        message,
        isRead: false
      });
      
      res.json({ success: true, message: newMessage });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ success: false, message: "Failed to send message" });
    }
  });

  // Mark message as read
  app.patch("/api/prospects/:id/messages/:messageId/read", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const messageId = parseInt(req.params.messageId);
      const prospect = (req as any).prospect;
      
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const msg = await envStorage.getProspectMessage(messageId);
      if (!msg || msg.prospectId !== prospectId) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }
      
      const updated = await envStorage.markProspectMessageAsRead(messageId);
      res.json({ success: true, message: updated });
    } catch (error) {
      console.error("Error marking message as read:", error);
      res.status(500).json({ success: false, message: "Failed to mark message as read" });
    }
  });

  // Agent message routes
  app.get("/api/agents/:id/messages", dbEnvironmentMiddleware, isAuthenticated, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      const userId = req.session.userId;
      
      // Verify the agent owns this ID or user is admin
      const user = await envStorage.getUser(userId!);
      if (!user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const userRoles = (user as any).roles || [user.role];
      const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
      
      if (!isAdmin) {
        // Check if user is this agent
        const agent = await envStorage.getAgent(agentId);
        if (!agent || agent.userId !== userId) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
      
      const messages = await envStorage.getAgentMessages(agentId);
      
      // Enrich messages with prospect info
      const enrichedMessages = await Promise.all(messages.map(async (msg) => {
        const prospect = await envStorage.getMerchantProspect(msg.prospectId);
        return {
          ...msg,
          prospectName: prospect ? `${prospect.firstName} ${prospect.lastName}` : 'Unknown',
          prospectEmail: prospect?.email || ''
        };
      }));
      
      res.json({ success: true, messages: enrichedMessages });
    } catch (error) {
      console.error("Error fetching agent messages:", error);
      res.status(500).json({ success: false, message: "Failed to fetch messages" });
    }
  });

  app.get("/api/agents/:id/messages/unread-count", dbEnvironmentMiddleware, isAuthenticated, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      const userId = req.session.userId;
      
      // Verify the agent owns this ID or user is admin
      const user = await envStorage.getUser(userId!);
      if (!user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const userRoles = (user as any).roles || [user.role];
      const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
      
      if (!isAdmin) {
        const agent = await envStorage.getAgent(agentId);
        if (!agent || agent.userId !== userId) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
      
      const count = await envStorage.getAgentUnreadMessagesCount(agentId);
      res.json({ success: true, count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ success: false, message: "Failed to fetch unread count" });
    }
  });

  // Agent reply to prospect message
  app.post("/api/agents/:id/messages", dbEnvironmentMiddleware, isAuthenticated, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      const userId = req.session.userId;
      
      // Verify the agent owns this ID or user is admin
      const user = await envStorage.getUser(userId!);
      if (!user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const userRoles = (user as any).roles || [user.role];
      const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
      
      if (!isAdmin) {
        const agent = await envStorage.getAgent(agentId);
        if (!agent || agent.userId !== userId) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
      
      const { prospectId, subject, message } = req.body;
      if (!prospectId || !subject || !message) {
        return res.status(400).json({ success: false, message: "prospectId, subject and message are required" });
      }
      
      // Verify prospect is assigned to this agent
      const prospect = await envStorage.getMerchantProspect(parseInt(prospectId));
      if (!prospect) {
        return res.status(404).json({ success: false, message: "Prospect not found" });
      }
      
      if (!isAdmin && prospect.agentId !== agentId) {
        return res.status(403).json({ success: false, message: "Prospect not assigned to this agent" });
      }
      
      const newMessage = await envStorage.createProspectMessage({
        prospectId: parseInt(prospectId),
        agentId,
        senderId: userId!,
        senderType: 'agent',
        subject,
        message,
        isRead: false
      });
      
      res.json({ success: true, message: newMessage });
    } catch (error) {
      console.error("Error sending agent message:", error);
      res.status(500).json({ success: false, message: "Failed to send message" });
    }
  });

  // Agent mark message as read
  app.patch("/api/agents/:id/messages/:messageId/read", dbEnvironmentMiddleware, isAuthenticated, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      const messageId = parseInt(req.params.messageId);
      const userId = req.session.userId;
      
      const user = await envStorage.getUser(userId!);
      if (!user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const userRoles = (user as any).roles || [user.role];
      const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
      
      if (!isAdmin) {
        const agent = await envStorage.getAgent(agentId);
        if (!agent || agent.userId !== userId) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
      
      const msg = await envStorage.getProspectMessage(messageId);
      if (!msg || msg.agentId !== agentId) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }
      
      const updated = await envStorage.markProspectMessageAsRead(messageId);
      res.json({ success: true, message: updated });
    } catch (error) {
      console.error("Error marking message as read:", error);
      res.status(500).json({ success: false, message: "Failed to mark message as read" });
    }
  });

  // Get current prospect (for logged-in prospect portal)
  app.get("/api/prospects/me", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const prospect = (req as any).prospect;
      
      // Extract businessName from form_data for frontend display
      // form_data may be stored as a string in the database, so parse it if needed
      let formData: Record<string, any> = {};
      if (prospect.formData) {
        formData = typeof prospect.formData === 'string' 
          ? JSON.parse(prospect.formData) 
          : prospect.formData;
      }
      const businessName = formData.merchant_company_name || 
                          formData.businessLegalName || 
                          formData.merchantLegalName ||
                          formData.merchant_legal_name ||
                          `${prospect.firstName} ${prospect.lastName}`;
      
      // Fetch documents for this prospect
      const dbEnv = req.dbEnv || 'development';
      const correctDb = getDynamicDatabase(dbEnv);
      const requestStorage = createStorage(correctDb);
      const documents = await requestStorage.getProspectDocuments(prospect.id);
      
      // Build enhanced prospect response
      const enhancedProspect = {
        ...prospect,
        businessName,
        documents
      };
      
      res.json({ success: true, prospect: enhancedProspect });
    } catch (error) {
      console.error("Error fetching prospect:", error);
      res.status(500).json({ success: false, message: "Failed to fetch prospect data" });
    }
  });

  // Update prospect profile
  app.patch("/api/prospects/:id", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospectId = parseInt(req.params.id);
      const prospect = (req as any).prospect;
      
      // Verify prospect owns this resource
      if (prospect.id !== prospectId) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      
      const { contactEmail, contactPhone } = req.body;
      
      // Update prospect
      const updatedProspect = await envStorage.updateMerchantProspect(prospectId, {
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      });
      
      res.json({ success: true, prospect: updatedProspect });
    } catch (error) {
      console.error("Error updating prospect:", error);
      res.status(500).json({ success: false, message: "Failed to update profile" });
    }
  });

  // Change prospect password
  app.post("/api/prospects/auth/change-password", dbEnvironmentMiddleware, requireProspectAuth, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const prospect = (req as any).prospect;
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: "currentPassword and newPassword are required" });
      }
      
      // Validate password strength
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({ 
          success: false, 
          message: `Password not strong enough: ${passwordValidation.errors.join(', ')}` 
        });
      }
      
      // Get user account
      const user = await envStorage.getUser(prospect.userId!);
      if (!user) {
        return res.status(404).json({ success: false, message: "User account not found" });
      }
      
      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: "Current password is incorrect" });
      }
      
      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      // Update user password
      await envStorage.updateUser(user.id, { passwordHash });
      
      res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ success: false, message: "Failed to change password" });
    }
  });

  // Get prospect by token (for starting application)
  app.get("/api/prospects/token/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token} = req.params;
      
      // Use storage method (uses the same DB connection as other operations)
      const prospect = await envStorage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Invalid or expired token" });
      }

      // Get agent information
      const agent = await envStorage.getAgent(prospect.agentId);

      // Get campaign assignment for this prospect
      const campaignAssignment = await envStorage.getProspectCampaignAssignment(prospect.id);
      let campaign = null;
      let campaignEquipment = [];
      let applicationTemplate = null;
      let prospectApplication = null;

      if (campaignAssignment) {
        // Get campaign details
        campaign = await envStorage.getCampaignWithDetails(campaignAssignment.campaignId);
        
        // Get equipment associated with this campaign
        campaignEquipment = await envStorage.getCampaignEquipment(campaignAssignment.campaignId);
        
        // Get the specific template assigned to this campaign using environment-specific DB
        const dynamicDB = getRequestDB(req);
        const campaignTemplates = await dynamicDB
          .select()
          .from(campaignApplicationTemplates)
          .where(eq(campaignApplicationTemplates.campaignId, campaignAssignment.campaignId));
        
        if (campaignTemplates && campaignTemplates.length > 0) {
          const templateId = campaignTemplates[0].templateId;
          const templates = await dynamicDB.select()
            .from(acquirerApplicationTemplates)
            .where(eq(acquirerApplicationTemplates.id, templateId));
          applicationTemplate = templates[0] || null;
        }
      }

      // Get prospect's application from prospect_applications table
      const { prospectApplications } = await import("@shared/schema");
      const dynamicDB = getRequestDB(req);
      const applications = await dynamicDB
        .select()
        .from(prospectApplications)
        .where(eq(prospectApplications.prospectId, prospect.id))
        .limit(1);
      
      if (applications && applications.length > 0) {
        prospectApplication = applications[0];
      }

      // Reverse-map template-specific address fields to canonical names for loading
      let prospectWithMappedData = prospect;
      if (prospect.formData && applicationTemplate?.addressGroups) {
        try {
          const parsedFormData = JSON.parse(prospect.formData);
          const canonicalFormData = mapTemplateAddressesToCanonical(parsedFormData, applicationTemplate.addressGroups);
          prospectWithMappedData = {
            ...prospect,
            formData: JSON.stringify(canonicalFormData)
          };
          console.log('Reverse-mapped template addresses to canonical fields:', {
            templateId: applicationTemplate.id,
            templateName: applicationTemplate.templateName,
            originalFields: Object.keys(parsedFormData).filter(k => k.includes('merchant_')),
            canonicalFields: Object.keys(canonicalFormData).filter(k => k.includes('Address.'))
          });
        } catch (err) {
          console.error('Error reverse-mapping addresses:', err);
          // Continue with original data on error
        }
      }

      res.json({
        prospect: prospectWithMappedData,
        agent,
        campaign,
        campaignEquipment,
        applicationTemplate,
        prospectApplication
      });
    } catch (error) {
      console.error("Error fetching prospect by token:", error);
      res.status(500).json({ message: "Failed to fetch prospect" });
    }
  });

  // Public API endpoint for application status lookup by token (no auth required)
  app.get("/api/prospects/status/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({ message: "Token is required" });
      }

      const prospect = await envStorage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Return prospect data for status display (no sensitive data)
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
        formData: prospect.formData // Include form data for company name display
      });
    } catch (error) {
      console.error("Error fetching prospect status:", error);
      res.status(500).json({ message: "Failed to fetch application status" });
    }
  });

  // Clear all prospect applications (Super Admin only)
  app.delete("/api/admin/clear-prospects", dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      // Get current counts for reporting
      const allProspects = await envStorage.getAllMerchantProspects();
      const prospectCount = allProspects.length;

      // Clear all prospect data using storage methods
      await envStorage.clearAllProspectData();

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
      delete (req.session as any).passport;
      
      // Set the new database environment for the next login
      (req.session as any).dbEnv = newEnvironment;
      
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
  app.get("/api/admin/db-diagnostics", requireRole(['super_admin']), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
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
      
      // Test actual database connections by counting users and key tables
      const dynamicDB = getRequestDB(req);
      const users = await dynamicDB.select().from((await import('@shared/schema')).users);
      
      // Get table counts for pricing/fee tables to verify which database we're hitting
      const { pricingTypeFeeItems, feeItems, pricingTypes } = await import("@shared/schema");
      const { sql } = await import("drizzle-orm");
      
      const pricingTypeCount = await dynamicDB.select({ count: sql`count(*)` }).from(pricingTypes);
      const feeItemCount = await dynamicDB.select({ count: sql`count(*)` }).from(feeItems);  
      const pricingTypeFeeItemCount = await dynamicDB.select({ count: sql`count(*)` }).from(pricingTypeFeeItems);
      
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
        },
        table_counts: {
          pricing_types: Number(pricingTypeCount[0]?.count || 0),
          fee_items: Number(feeItemCount[0]?.count || 0), 
          pricing_type_fee_items: Number(pricingTypeFeeItemCount[0]?.count || 0)
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
  app.get("/api/admin/schema-compare", requireRole(['super_admin']), async (req, res) => {
    try {
      const { getDynamicDatabase } = await import("./db");
      const { MigrationCommandBuilder } = await import("./utils/migrationCommandBuilder");
      
      // Get schema information from each environment
      const getSchemaInfo = async (environment: string) => {
        try {
          const db = getDynamicDatabase(environment);
          
          // Query to get table and column information
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
          
          // Query to get indexes
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
        const differences = {
          missingTables: [],
          extraTables: [],
          columnDifferences: [],
          indexDifferences: []
        };
        
        // Get unique table names from both schemas
        const schema1Tables = new Set(schema1.tables.map((t: any) => t.table_name));
        const schema2Tables = new Set(schema2.tables.map((t: any) => t.table_name));
        
        // Find missing and extra tables
        for (const table of schema1Tables) {
          if (!schema2Tables.has(table)) {
            const diff = {
              table: table,
              type: 'missing_table' as const
            };
            differences.missingTables.push({
              table: table,
              recommendedCommands: MigrationCommandBuilder.generateCommandsForDifference(diff)
            });
          }
        }
        
        for (const table of schema2Tables) {
          if (!schema1Tables.has(table)) {
            const diff = {
              table: table,
              type: 'extra_table' as const
            };
            differences.extraTables.push({
              table: table,
              recommendedCommands: MigrationCommandBuilder.generateCommandsForDifference(diff)
            });
          }
        }
        
        // Find column differences for common tables
        for (const table of schema1Tables) {
          if (schema2Tables.has(table)) {
            const schema1Cols = schema1.tables.filter((t: any) => t.table_name === table);
            const schema2Cols = schema2.tables.filter((t: any) => t.table_name === table);
            
            const schema1ColNames = new Set(schema1Cols.map((c: any) => c.column_name));
            const schema2ColNames = new Set(schema2Cols.map((c: any) => c.column_name));
            
            for (const col of schema1ColNames) {
              if (!schema2ColNames.has(col)) {
                const diff = {
                  table: table,
                  column: col,
                  type: 'missing_in_target' as const,
                  details: schema1Cols.find((c: any) => c.column_name === col)
                };
                differences.columnDifferences.push({
                  ...diff,
                  recommendedCommands: MigrationCommandBuilder.generateCommandsForDifference(diff)
                });
              }
            }
            
            for (const col of schema2ColNames) {
              if (!schema1ColNames.has(col)) {
                const diff = {
                  table: table,
                  column: col,
                  type: 'extra_in_target' as const,
                  details: schema2Cols.find((c: any) => c.column_name === col)
                };
                differences.columnDifferences.push({
                  ...diff,
                  recommendedCommands: MigrationCommandBuilder.generateCommandsForDifference(diff)
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
  app.post("/api/admin/migration", requireRole(['super_admin']), async (req, res) => {
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

  // Schema synchronization endpoint [DEPRECATED]
  app.post("/api/admin/schema-sync", requireRole(['super_admin']), async (req, res) => {
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
      
      const results = {
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
          
        } catch (error) {
          console.error(`❌ Failed to sync to ${toEnvironment}:`, error);
          
          let errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
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
                question: promptMatch[0],
                column: promptMatch[1],
                table: promptMatch[2],
                options: [
                  { type: 'create', label: `+ ${promptMatch[1]} create column`, recommended: false },
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
          try {
            // Get the CREATE TABLE statement from source
            const createTableResult = await sourceDB.execute(`
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
              WHERE table_schema = 'public' AND table_name = $1
              GROUP BY table_name
            `, [tableName]);
            
            if (createTableResult.rows && createTableResult.rows.length > 0) {
              const createStatement = createTableResult.rows[0].create_statement;
              
              // Drop table if exists and recreate
              await targetDB.execute(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
              await targetDB.execute(createStatement);
              
              results.operations.push({
                type: 'table-sync',
                table: tableName,
                operation: 'created',
                success: true
              });
            }
            
          } catch (error) {
            results.errors.push({
              table: tableName,
              error: error instanceof Error ? error.message : 'Unknown error',
              operation: 'table-sync'
            });
          }
        }
      }
      
      res.json(results);
      
    } catch (error) {
      console.error("Error syncing schemas:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to sync database schemas", 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Comprehensive testing data reset utility (Super Admin only)
  app.post("/api/admin/reset-testing-data", requireRole(['super_admin']), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
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

  // Schema drift detection endpoint
  app.get("/api/admin/schema-drift/:env1/:env2", requireRole(['super_admin', 'admin']), async (req, res) => {
    try {
      const { env1, env2 } = req.params;
      
      const envMap: Record<string, string | undefined> = {
        development: process.env.DEV_DATABASE_URL,
        test: process.env.TEST_DATABASE_URL,
        production: process.env.DATABASE_URL,
      };

      const url1 = envMap[env1];
      const url2 = envMap[env2];

      if (!url1 || !url2) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid environment specified" 
        });
      }

      // Get schema from both environments
      const getSchema = async (connectionString: string) => {
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString });
        try {
          const result = await pool.query(`
            SELECT 
              table_name as "tableName",
              column_name as "columnName",
              data_type as "dataType",
              is_nullable as "isNullable",
              column_default as "columnDefault",
              ordinal_position as "position"
            FROM information_schema.columns 
            WHERE table_schema = 'public'
              AND table_name NOT IN ('drizzle_migrations', 'drizzle__migrations', 'schema_migrations')
            ORDER BY table_name, ordinal_position
          `);
          return result.rows;
        } finally {
          await pool.end();
        }
      };

      const [schema1, schema2] = await Promise.all([
        getSchema(url1),
        getSchema(url2)
      ]);

      // Organize by table
      const organizeByTable = (rows: any[]) => {
        const map = new Map();
        for (const row of rows) {
          if (!map.has(row.tableName)) {
            map.set(row.tableName, []);
          }
          map.get(row.tableName).push(row);
        }
        return map;
      };

      const tables1 = organizeByTable(schema1);
      const tables2 = organizeByTable(schema2);

      // Find differences
      const missingInEnv2: any[] = [];
      const extraInEnv2: any[] = [];

      // Find columns in env1 but not in env2
      for (const [tableName, columns] of tables1.entries()) {
        const columns2 = tables2.get(tableName);
        if (!columns2) {
          missingInEnv2.push(...columns);
          continue;
        }
        const columnNames2 = new Set(columns2.map((c: any) => c.columnName));
        for (const col of columns) {
          if (!columnNames2.has(col.columnName)) {
            missingInEnv2.push(col);
          }
        }
      }

      // Find columns in env2 but not in env1
      for (const [tableName, columns] of tables2.entries()) {
        const columns1 = tables1.get(tableName);
        if (!columns1) {
          extraInEnv2.push(...columns);
          continue;
        }
        const columnNames1 = new Set(columns1.map((c: any) => c.columnName));
        for (const col of columns) {
          if (!columnNames1.has(col.columnName)) {
            extraInEnv2.push(col);
          }
        }
      }

      const hasDrift = missingInEnv2.length > 0 || extraInEnv2.length > 0;

      res.json({
        success: true,
        hasDrift,
        env1,
        env2,
        totalTables: tables1.size,
        totalColumnsEnv1: schema1.length,
        totalColumnsEnv2: schema2.length,
        missingInEnv2,
        extraInEnv2,
      });
    } catch (error) {
      console.error("Error detecting schema drift:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to detect schema drift",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Generate SQL migration to fix schema drift
  app.post("/api/admin/schema-drift/generate-fix", requireRole(['super_admin']), async (req, res) => {
    try {
      const { env1, env2 } = req.body;
      
      // Strict whitelist validation to prevent command injection
      const allowedEnvs = ['development', 'test', 'production'];
      if (!allowedEnvs.includes(env1) || !allowedEnvs.includes(env2)) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid environment. Allowed values: development, test, production" 
        });
      }

      if (env1 === env2) {
        return res.status(400).json({ 
          success: false, 
          message: "Source and target environments must be different" 
        });
      }

      // Use spawn instead of exec to prevent command injection
      const { spawn } = await import('child_process');
      
      const child = spawn('tsx', ['scripts/schema-sync-generator.ts', env1, env2], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,           // Production
          TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, // Test
          DEV_DATABASE_URL: process.env.DEV_DATABASE_URL    // Development
        }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}: ${stderr}`));
          }
        });
        child.on('error', reject);
      });

      // Parse output to find generated file
      const fileMatch = stdout.match(/Generated migration file: (.+)/);
      const migrationFile = fileMatch ? fileMatch[1] : null;

      res.json({
        success: true,
        message: "SQL migration generated successfully",
        migrationFile,
        output: stdout,
        errors: stderr
      });
    } catch (error) {
      console.error("Error generating fix SQL:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to generate fix SQL",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Auto-sync environments (runs sync-environments script)
  app.post("/api/admin/schema-drift/auto-sync", requireRole(['super_admin']), async (req, res) => {
    try {
      const { env1, env2 } = req.body;
      
      // Strict whitelist validation to prevent command injection
      const allowedEnvs = ['development', 'test', 'production'];
      if (!allowedEnvs.includes(env1) || !allowedEnvs.includes(env2)) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid environment. Allowed values: development, test, production" 
        });
      }

      if (env1 === env2) {
        return res.status(400).json({ 
          success: false, 
          message: "Source and target environments must be different" 
        });
      }

      // Map environment names to sync script format (dev-to-test, test-to-prod, etc.)
      const envMapping: Record<string, string> = {
        development: 'dev',
        test: 'test',
        production: 'prod'
      };

      const sourceEnv = envMapping[env1];
      const targetEnv = envMapping[env2];
      const syncType = `${sourceEnv}-to-${targetEnv}`;
      
      // Validate that this is a supported sync type
      const supportedSyncs = ['dev-to-test', 'test-to-prod'];
      if (!supportedSyncs.includes(syncType)) {
        return res.status(400).json({ 
          success: false, 
          message: `Unsupported sync direction: ${syncType}. Supported syncs: dev-to-test, test-to-prod` 
        });
      }

      // Use spawn instead of exec to prevent command injection
      const { spawn } = await import('child_process');
      
      // Pass environment variables to the child process
      const child = spawn('tsx', ['scripts/sync-environments.ts', syncType, '--auto-confirm'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,           // Production
          TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, // Test
          DEV_DATABASE_URL: process.env.DEV_DATABASE_URL    // Development
        }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Sync operation timed out after 60 seconds')), 60000);
      });

      await Promise.race([
        new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Process exited with code ${code}: ${stderr}`));
            }
          });
          child.on('error', reject);
        }),
        timeoutPromise
      ]);

      // Log the sync output for debugging
      console.log('=== SYNC SCRIPT OUTPUT ===');
      console.log('STDOUT:', stdout);
      console.log('STDERR:', stderr);
      console.log('=========================');

      res.json({
        success: true,
        message: `Successfully synced ${env1} to ${env2}`,
        syncType,
        output: stdout,
        errors: stderr
      });
    } catch (error) {
      console.error("Error auto-syncing environments:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to auto-sync environments",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update prospect status to "in progress" when they start filling out the form
  app.post("/api/prospects/:id/start-application", async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const prospectId = parseInt(id);
      
      // Use environment-aware storage
      const envStorage = createStorageForRequest(req);
      
      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Only update if status is 'contacted' (validated email)
      if (prospect.status === 'contacted') {
        const updatedProspect = await envStorage.updateMerchantProspect(prospectId, {
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
  app.post("/api/prospects/:id/clear-address-data", async (req: RequestWithDB, res) => {
    try {
      const prospectId = parseInt(req.params.id);
      
      // Use environment-aware storage
      const envStorage = createStorageForRequest(req);
      
      const prospect = await envStorage.getMerchantProspect(prospectId);
      
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
      await envStorage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(existingFormData)
      });

      res.json({ success: true, message: "Address data cleared" });
    } catch (error) {
      console.error("Error clearing address data:", error);
      res.status(500).json({ message: "Failed to clear address data" });
    }
  });

  // Save form data for prospects
  app.post("/api/prospects/:id/save-form-data", async (req: RequestWithDB, res) => {
    try {
      const { id } = req.params;
      const { formData, currentStep } = req.body;
      const prospectId = parseInt(id);

      // DEBUG: Log signature-related keys being saved
      const allKeys = Object.keys(formData || {});
      const signatureGroupKeys = allKeys.filter(k => k.startsWith('signatureGroup_'));
      const signatureKeys = allKeys.filter(k => 
        k.toLowerCase().includes('signature') || k.toLowerCase().includes('owner')
      );
      
      console.log(`📥 Save form data for prospect ${prospectId}: ${allKeys.length} total keys`);
      console.log(`✍️ SignatureGroup keys found: ${signatureGroupKeys.length}`, signatureGroupKeys);
      
      // DEBUG: Log address-related fields being saved
      const addressKeys = allKeys.filter(k => 
        k.toLowerCase().includes('address') || k.toLowerCase().includes('location') || 
        k.toLowerCase().includes('city') || k.toLowerCase().includes('state') || 
        k.toLowerCase().includes('zip') || k.toLowerCase().includes('postal') ||
        k.toLowerCase().includes('street')
      );
      console.log(`🏠 Address-related fields being saved: ${addressKeys.length}`, addressKeys);
      addressKeys.forEach(k => console.log(`  📍 ${k}: "${formData[k]}"`));
      
      if (signatureGroupKeys.length > 0) {
        signatureGroupKeys.forEach(k => {
          const val = formData[k];
          console.log(`  📝 ${k}: type=${typeof val}, length=${typeof val === 'string' ? val.length : 'N/A'}, preview=${typeof val === 'string' ? val.substring(0, 150) : JSON.stringify(val).substring(0, 150)}`);
        });
      }
      
      if (signatureKeys.length > 0) {
        console.log(`ℹ️ Other signature/owner keys:`, signatureKeys.filter(k => !signatureGroupKeys.includes(k)));
      }

      // Use environment-aware storage
      const envStorage = createStorageForRequest(req);

      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Server-side application locking - prevent modifications after submission
      const lockedStatuses = ['submitted', 'applied', 'approved', 'rejected', 'under_review', 'pending_review'];
      if (lockedStatuses.includes(prospect.status)) {
        console.log(`🔒 Blocking save for prospect ${prospectId} - application locked (status: ${prospect.status})`);
        return res.status(403).json({ 
          success: false, 
          message: "Application is locked and cannot be modified. Please contact your agent if changes are needed."
        });
      }

      // Save the form data and current step
      await envStorage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(formData),
        currentStep: currentStep
      });

      console.log(`Form data saved for prospect ${prospectId}, step ${currentStep} to ${req.dbEnv || 'development'} database`);
      res.json({ success: true, message: "Form data saved successfully" });
    } catch (error) {
      console.error("Error saving prospect form data:", error);
      res.status(500).json({ message: "Failed to save form data" });
    }
  });

  // Download application PDF for prospects  
  app.get("/api/prospects/:id/download-pdf", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    console.log(`PDF Download - Route hit for prospect ${req.params.id}`);
    
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const prospectId = parseInt(id);

      if (isNaN(prospectId)) {
        console.log(`PDF Download - Invalid prospect ID: ${id}`);
        return res.status(400).json({ message: "Invalid prospect ID" });
      }

      console.log(`PDF Download - Looking up prospect ID: ${prospectId}`);

      const prospect = await envStorage.getMerchantProspect(prospectId);
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

      // Generate PDF document
      try {
        const { pdfGenerator } = await import('./pdfGenerator');
        const pdfBuffer = await pdfGenerator.generateApplicationPDF(prospect, formData);
        
        // Set headers for PDF download
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
  app.post("/api/prospects/:id/submit-application", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { formData, status } = req.body;
      const prospectId = parseInt(id);

      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }

      // Validation is handled by the frontend wizard - the form fields and their required status
      // are defined dynamically in the template, not hardcoded field names
      // We perform only minimal server-side checks for data integrity
      
      const validationErrors: string[] = [];
      
      // Basic data integrity check - ensure we have some form data
      if (!formData || Object.keys(formData).length === 0) {
        validationErrors.push('No form data submitted');
      }
      
      // Optional: Check ownership totals if owners array is present
      // (ownership validation is typically done on frontend during wizard navigation)
      if (formData && formData.owners && Array.isArray(formData.owners) && formData.owners.length > 0) {
        const totalOwnership = formData.owners.reduce((sum: number, owner: any) => {
          return sum + (parseFloat(owner.percentage) || 0);
        }, 0);

        if (Math.abs(totalOwnership - 100) > 0.01) {
          validationErrors.push(`Total ownership must equal 100% (currently ${totalOwnership.toFixed(1)}%)`);
        }
      }

      // Return validation errors if any exist
      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          message: `Application incomplete. Please complete the following:\n${validationErrors.map(err => `• ${err}`).join('\n')}`,
          validationErrors
        });
      }

      // Get agent information
      const agent = await envStorage.getAgent(prospect.agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get template configuration for address mapping
      let mappedFormData = formData;
      let templateForMapping = null;
      
      if (prospect.campaignId) {
        // Get the specific template(s) assigned to this campaign
        const dynamicDB = await getDynamicDatabase(req.dbEnv);
        const { campaignApplicationTemplates } = await import('@shared/schema');
        
        const campaignTemplates = await dynamicDB
          .select()
          .from(campaignApplicationTemplates)
          .where(eq(campaignApplicationTemplates.campaignId, prospect.campaignId));
        
        if (campaignTemplates && campaignTemplates.length > 0) {
          // Get the first template for this campaign
          const templateId = campaignTemplates[0].templateId;
          const templates = await envStorage.getAcquirerApplicationTemplates();
          templateForMapping = templates.find(t => t.id === templateId);
          
          if (templateForMapping && templateForMapping.addressGroups) {
            mappedFormData = mapCanonicalAddressesToTemplate(formData, templateForMapping.addressGroups);
            console.log('Mapped canonical addresses to template fields:', {
              templateId: templateForMapping.id,
              templateName: templateForMapping.templateName,
              originalFields: Object.keys(formData).filter(k => k.includes('Address.')),
              mappedFields: Object.keys(mappedFormData).filter(k => k.includes('merchant_'))
            });
          }
        }
      }

      // Process user_account fields and create user accounts if present
      const accountCreationResults: any[] = [];
      if (templateForMapping) {
        try {
          const { createUserFromFormField } = await import('./services/userAccountService');
          const dynamicDB = await getDynamicDatabase((req as any).dbEnv);
          
          // Get template fields to find user_account types
          const templateFields = templateForMapping.formSections || [];
          
          for (const section of templateFields) {
            if (!section.fields) continue;
            
            for (const field of section.fields) {
              if (field.fieldType !== 'user_account') continue;
              
              // Check if this field has data in the submission
              const fieldData = formData[field.fieldId];
              if (!fieldData || typeof fieldData !== 'object') continue;
              
              // Parse field configuration
              let userAccountConfig: any = null;
              if (field.validation) {
                try {
                  const validationObj = typeof field.validation === 'string'
                    ? JSON.parse(field.validation)
                    : field.validation;
                  userAccountConfig = validationObj.userAccount || validationObj;
                } catch (e) {
                  console.error('Failed to parse user account config:', e);
                  accountCreationResults.push({
                    fieldId: field.fieldId,
                    success: false,
                    error: 'Invalid field configuration'
                  });
                  continue;
                }
              }
              
              if (!userAccountConfig) {
                console.warn(`User account field ${field.fieldId} has no configuration`);
                accountCreationResults.push({
                  fieldId: field.fieldId,
                  success: false,
                  error: 'Missing field configuration'
                });
                continue;
              }
              
              // Create user account
              try {
                const userId = await createUserFromFormField(
                  fieldData,
                  userAccountConfig,
                  dynamicDB,
                  (req as any).dbEnv || 'development'
                );
                console.log(`Created user account ${userId} from form submission field ${field.fieldId}`);
                accountCreationResults.push({
                  fieldId: field.fieldId,
                  success: true,
                  userId
                });
              } catch (userError: any) {
                console.error(`Failed to create user account from field ${field.fieldId}:`, userError);
                // Collect error but continue with form submission
                let errorMessage = 'Account creation failed';
                if (userError.name === 'DuplicateEmailError') {
                  errorMessage = 'Email address is already registered';
                } else if (userError.name === 'DuplicateUsernameError') {
                  errorMessage = 'Username is already taken';
                } else if (userError.name === 'PasswordMismatchError') {
                  errorMessage = 'Passwords do not match';
                } else if (userError.name === 'PasswordStrengthError') {
                  errorMessage = userError.message;
                } else if (userError.message) {
                  errorMessage = userError.message;
                }
                
                accountCreationResults.push({
                  fieldId: field.fieldId,
                  success: false,
                  error: errorMessage
                });
              }
            }
          }
        } catch (error) {
          console.error('User account creation processing failed:', error);
          // Continue with submission - user account creation is optional
        }
      }

      // Update prospect with final form data and status
      const updatedProspect = await envStorage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(mappedFormData),
        status: 'submitted'
      });

      // Create prospect portal account with password reset token
      let portalAccountCreated = false;
      let resetToken: string | undefined;
      try {
        const accountResult = await envStorage.createProspectPortalAccount(prospectId);
        resetToken = accountResult.resetToken;
        portalAccountCreated = true;
        console.log(`Created portal account for prospect ${prospectId}, userId: ${accountResult.user.id}`);
        
        // Send password setup email to prospect
        try {
          const currentDbEnv = (req as any).dbEnv || prospect.databaseEnv || 'development';
          let passwordSetupUrl = `${req.protocol}://${req.get('host')}/prospect-portal/set-password?token=${resetToken}`;
          if (currentDbEnv && currentDbEnv !== 'production') {
            passwordSetupUrl += `&db=${currentDbEnv}`;
          }
          // Check multiple possible field names for company name
          const resolvedCompanyName = formData.companyName || formData.merchant_company_name || formData.businessName || prospect.companyName || 'Unknown Company';
          await emailService.sendProspectPasswordSetup({
            prospectName: `${prospect.firstName} ${prospect.lastName}`,
            prospectEmail: prospect.email,
            companyName: resolvedCompanyName,
            passwordSetupUrl,
            expiresAt: accountResult.resetExpires,
            dbEnv: (req as any).dbEnv
          });
          console.log(`Sent password setup email to ${prospect.email}`);
        } catch (emailError) {
          console.error('Password setup email failed:', emailError);
          // Continue - portal account is created, they can request password reset
        }
      } catch (accountError) {
        console.error('Portal account creation failed:', accountError);
        // Continue with submission - account creation is optional
      }

      // Capture all signatures in the signature_captures table for unified access
      let capturedSignatures: string[] = [];
      try {
        // Process owner signatures from formData
        if (formData.owners && Array.isArray(formData.owners)) {
          for (let i = 0; i < formData.owners.length; i++) {
            const owner = formData.owners[i];
            if (owner.signature) {
              const captureData = {
                prospectId,
                roleKey: `owner${i + 1}`,
                signerType: 'owner' as const,
                signerName: owner.name || owner.email,
                signerEmail: owner.email,
                signature: owner.signature,
                signatureType: owner.signatureType || 'typed',
                ownershipPercentage: owner.percentage,
                dateSigned: new Date(),
                timestampSigned: new Date(),
                status: 'signed' as const,
              };
              await envStorage.createSignatureCapture(captureData);
              capturedSignatures.push(`owner${i + 1}`);
            }
          }
        }
        
        // Also check for signature group fields in formData (Template 25 style)
        const signatureGroupKeys = Object.keys(formData).filter(k => k.startsWith('signatureGroup_') || k.startsWith('_signatureGroup_'));
        for (const groupKey of signatureGroupKeys) {
          try {
            const sigData = typeof formData[groupKey] === 'string' ? JSON.parse(formData[groupKey]) : formData[groupKey];
            if (sigData?.signature) {
              const roleMatch = groupKey.match(/owner(\d+)_signature_owner/);
              const roleKey = roleMatch ? `owner${roleMatch[1]}` : groupKey.replace(/^_?signatureGroup_/, '');
              
              const captureData = {
                prospectId,
                roleKey,
                signerType: roleKey.includes('agent') ? 'agent' as const : 'owner' as const,
                signerName: sigData.signerName || sigData.ownerName,
                signerEmail: sigData.email || sigData.ownerEmail,
                signature: sigData.signature,
                signatureType: sigData.signatureType || 'canvas',
                ownershipPercentage: sigData.ownershipPercentage,
                dateSigned: new Date(),
                timestampSigned: new Date(),
                status: 'signed' as const,
              };
              await envStorage.createSignatureCapture(captureData);
              capturedSignatures.push(roleKey);
            }
          } catch (parseError) {
            console.warn(`Failed to parse signature group ${groupKey}:`, parseError);
          }
        }
        
        console.log(`Captured ${capturedSignatures.length} signatures: ${capturedSignatures.join(', ')}`);
      } catch (sigError) {
        console.error('Signature capture failed:', sigError);
        // Continue - signature capture is for PDF rehydration, don't fail submission
      }

      // Generate PDF document
      let pdfBuffer: Buffer | undefined;
      let pdfStoragePath: string | undefined;
      try {
        // Try to use PDFRehydrator if template has a source PDF
        if (templateForMapping && templateForMapping.sourcePdfPath && templateForMapping.pdfMappingConfiguration) {
          console.log(`Using PDFRehydrator with template ${templateForMapping.id} source: ${templateForMapping.sourcePdfPath}`);
          const { PDFRehydrator } = await import('./pdfRehydrator');
          const rehydrator = new PDFRehydrator();
          
          // Get signature groups from template if available
          const signatureGroups = templateForMapping.signatureGroups || [];
          
          pdfBuffer = await rehydrator.rehydratePdf(
            templateForMapping.sourcePdfPath,
            mappedFormData,
            templateForMapping.pdfMappingConfiguration as any,
            signatureGroups as any
          );
          console.log(`PDF rehydration successful, size: ${pdfBuffer.length} bytes`);
        } else {
          // Fall back to HTML-based PDF generation
          console.log('No source PDF template, using HTML-based PDF generation');
          const { pdfGenerator } = await import('./pdfGenerator');
          pdfBuffer = await pdfGenerator.generateApplicationPDF(updatedProspect, formData);
        }
        
        // Save PDF to object storage with applicant-specific path
        if (pdfBuffer) {
          try {
            const { objectStorageService } = await import('./objectStorage');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            // Check multiple possible field names for company name
            const companyNameForSlug = formData.companyName || formData.merchant_company_name || formData.businessName || prospect.companyName || 'unknown';
            const companySlug = companyNameForSlug.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 50);
            const storageKey = `applications/${prospectId}/${companySlug}_${timestamp}.pdf`;
            
            await objectStorageService.saveBuffer(storageKey, pdfBuffer, {
              contentType: 'application/pdf',
              ownerId: String(prospectId),
              visibility: 'owner-only',
            });
            
            pdfStoragePath = storageKey;
            console.log(`Saved application PDF to object storage: ${storageKey}`);
            
            // Update prospect with PDF path
            await envStorage.updateMerchantProspect(prospectId, {
              formData: JSON.stringify({ ...mappedFormData, _pdfStoragePath: pdfStoragePath })
            });
            
            // Create a document record for the generated PDF
            try {
              const docFileName = `${companySlug}_application.pdf`;
              await envStorage.createProspectDocument({
                prospectId,
                fileName: docFileName,
                originalFileName: docFileName,
                fileType: 'application/pdf',
                fileSize: pdfBuffer.length,
                category: 'application',
                storageKey,
              });
              console.log(`Created prospect document record for PDF: ${storageKey}`);
            } catch (docError) {
              console.error('Failed to create document record:', docError);
              // Continue - document record is optional
            }
          } catch (storageError) {
            console.error('PDF storage failed:', storageError);
            // Continue - PDF storage is optional
          }
        }
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        // Continue without PDF - don't fail the submission
      }
      
      // Update prospect_applications record with submitted status and data
      try {
        const dynamicDB = await getDynamicDatabase((req as any).dbEnv);
        const { prospectApplications } = await import('@shared/schema');
        
        await dynamicDB
          .update(prospectApplications)
          .set({
            status: 'submitted',
            applicationData: mappedFormData,
            submittedAt: new Date(),
            generatedPdfPath: pdfStoragePath || null,
            updatedAt: new Date(),
          })
          .where(eq(prospectApplications.prospectId, prospectId));
        
        console.log(`Updated prospect_applications record for prospect ${prospectId}`);
      } catch (appUpdateError) {
        console.error('Failed to update prospect_applications:', appUpdateError);
        // Continue - the merchant_prospects record is already updated
      }

      // Send notification emails
      try {
        const submissionDate = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        // Check multiple possible field names for company name
        const emailCompanyName = formData.companyName || formData.merchant_company_name || formData.businessName || prospect.companyName || 'Unknown Company';
        await emailService.sendApplicationSubmissionNotification({
          companyName: emailCompanyName,
          applicantName: `${prospect.firstName} ${prospect.lastName}`,
          applicantEmail: prospect.email,
          agentName: `${agent.firstName} ${agent.lastName}`,
          agentEmail: agent.email,
          submissionDate,
          applicationToken: prospect.validationToken || 'unknown',
          dbEnv: (req as any).dbEnv
        }, pdfBuffer);
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
        // Continue without email - don't fail the submission
      }

      // Fire APPLICATION.SUBMITTED trigger for Communications Manager actions
      try {
        const { TriggerService } = await import('./triggerService');
        const { TRIGGER_KEYS } = await import('@shared/triggerKeys');
        const triggerService = new TriggerService();
        
        const emailCompanyName = formData.companyName || formData.merchant_company_name || formData.businessName || prospect.companyName || 'Unknown Company';
        
        await triggerService.fireTrigger(TRIGGER_KEYS.APPLICATION.SUBMITTED, {
          triggerEvent: TRIGGER_KEYS.APPLICATION.SUBMITTED,
          prospectId,
          applicationId: prospectId, // For context
          companyName: emailCompanyName,
          applicantName: `${prospect.firstName} ${prospect.lastName}`,
          applicantEmail: prospect.email,
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          agentName: `${agent.firstName} ${agent.lastName}`,
          agentEmail: agent.email,
          submissionDate: new Date().toISOString(),
          statusUrl: `/application-status/${prospect.validationToken}`,
        });
        
        console.log(`Fired APPLICATION.SUBMITTED trigger for prospect ${prospectId}`);
      } catch (triggerError) {
        console.error('APPLICATION.SUBMITTED trigger failed:', triggerError);
        // Continue - trigger failures shouldn't block submission
      }

      // Create underwriting workflow ticket for the submitted application
      let underwritingTicketNumber = null;
      try {
        const { createWorkflowEngine } = await import('./services/workflow-engine');
        const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
        
        const engine = createWorkflowEngine(storage);
        registerUnderwritingHandlers(engine);
        
        const underwritingTicket = await engine.createTicket({
          workflowCode: 'merchant_underwriting',
          entityType: 'prospect_application',
          entityId: prospectId,
          createdById: (req as any).user?.id || 'system',
          priority: 'normal',
          metadata: {
            prospectId,
            prospectEmail: prospect.email,
            companyName: formData.companyName || formData.merchant_company_name || formData.businessName || prospect.companyName,
            submittedAt: new Date().toISOString()
          }
        });
        
        underwritingTicketNumber = underwritingTicket.ticketNumber;
        console.log(`[Underwriting] Created workflow ticket ${underwritingTicketNumber} for prospect ${prospectId}`);
      } catch (workflowError) {
        console.error('[Underwriting] Error creating workflow ticket:', workflowError);
        // Don't fail the submission if workflow creation fails
      }

      console.log(`Application submitted for prospect ${prospectId}`);
      res.json({ 
        success: true, 
        message: "Application submitted successfully",
        prospect: updatedProspect,
        statusUrl: `/application-status/${prospect.validationToken}`,
        accountCreationResults: accountCreationResults.length > 0 ? accountCreationResults : undefined,
        underwritingTicketNumber
      });
    } catch (error) {
      console.error("Error submitting prospect application:", error);
      res.status(500).json({ message: "Failed to submit application" });
    }
  });

  // Application status lookup
  app.get("/api/application-status/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      
      const prospect = await envStorage.getMerchantProspectByToken(token);
      if (!prospect) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Get agent information
      const agent = await envStorage.getAgent(prospect.agentId);
      
      const response = {
        ...prospect,
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

  // Send signature request email
  app.post("/api/signature-request", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { 
        ownerName, 
        ownerEmail, 
        companyName, 
        ownershipPercentage, 
        requesterName, 
        agentName,
        prospectId
      } = req.body;

      if (!ownerName || !ownerEmail || !companyName || !ownershipPercentage || !prospectId) {
        return res.status(400).json({ 
          success: false, 
          message: "Missing required fields" 
        });
      }

      // Generate unique signature token
      const signatureToken = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create or update prospect owner in database
      const existingOwners = await envStorage.getProspectOwners(prospectId);
      const existingOwner = existingOwners.find(owner => owner.email === ownerEmail);

      if (existingOwner) {
        // Update existing owner with signature token
        await envStorage.updateProspectOwner(existingOwner.id, {
          signatureToken,
          emailSent: true,
          emailSentAt: new Date()
        });
      } else {
        // Create new prospect owner
        await envStorage.createProspectOwner({
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
        ownershipPercentage,
        signatureToken,
        requesterName,
        agentName,
        dbEnv: (req as any).dbEnv
      });

      if (success) {
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
  app.post("/api/signature-submit", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { signatureToken, signature, signatureType } = req.body;

      if (!signatureToken || !signature) {
        return res.status(400).json({ 
          success: false, 
          message: "Missing signature token or signature data" 
        });
      }

      // Find the prospect owner by signature token
      const owner = await envStorage.getProspectOwnerBySignatureToken(signatureToken);
      if (!owner) {
        return res.status(404).json({ 
          success: false, 
          message: "Invalid signature token" 
        });
      }

      // Create the signature record in database
      await envStorage.createProspectSignature({
        prospectId: owner.prospectId,
        ownerId: owner.id,
        signatureToken,
        signature,
        signatureType: signatureType || 'type'
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
  app.post("/api/prospects/:id/save-inline-signature", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { ownerEmail, ownerName, signature, signatureType, ownershipPercentage } = req.body;
      const prospectId = parseInt(id);

      if (!ownerEmail || !ownerName || !signature || !signatureType) {
        return res.status(400).json({ 
          success: false, 
          message: "Missing required signature data" 
        });
      }

      // Server-side application locking - prevent signature modifications after submission
      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (prospect) {
        const lockedStatuses = ['submitted', 'applied', 'approved', 'rejected', 'under_review', 'pending_review'];
        if (lockedStatuses.includes(prospect.status)) {
          console.log(`🔒 Blocking signature save for prospect ${prospectId} - application locked (status: ${prospect.status})`);
          return res.status(403).json({ 
            success: false, 
            message: "Application is locked and cannot be modified."
          });
        }
      }

      // First, ensure the prospect owner exists in the database
      let owner = await envStorage.getProspectOwnerByEmailAndProspectId(ownerEmail, prospectId);
      
      if (!owner) {
        // Create the owner record if it doesn't exist
        const ownerData = {
          prospectId,
          name: ownerName,
          email: ownerEmail,
          ownershipPercentage: ownershipPercentage || '0'
        };
        
        owner = await envStorage.createProspectOwner(ownerData);
      }

      // Generate a signature token for the inline signature
      const signatureToken = `inline_sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create the signature record in database
      await envStorage.createProspectSignature({
        prospectId,
        ownerId: owner.id,
        signatureToken,
        signature,
        signatureType
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
  app.get("/api/signature-request/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      
      // First, try to find in the new signature_captures table
      const signatureCapture = await envStorage.getSignatureCaptureByToken(token);
      
      if (signatureCapture) {
        // New signature capture system - get prospect/application details
        let companyName = 'Merchant Application';
        let applicantName = 'Applicant';
        let applicantEmail = '';
        let agentName = 'Agent';
        let agentEmail = '';
        let prospect: any = null;
        
        if (signatureCapture.prospectId) {
          prospect = await envStorage.getMerchantProspect(signatureCapture.prospectId);
          if (prospect) {
            applicantName = `${prospect.firstName} ${prospect.lastName}`;
            applicantEmail = prospect.email;
            
            // Parse form data to get company name
            if (prospect.formData) {
              try {
                const formData = JSON.parse(prospect.formData);
                companyName = formData.companyName || formData.merchant_company_name || companyName;
              } catch (e) {
                console.error('Error parsing form data:', e);
              }
            }
            
            // Get agent information
            const agent = await envStorage.getAgent(prospect.agentId);
            if (agent) {
              agentName = `${agent.firstName} ${agent.lastName}`;
              agentEmail = agent.email;
            }
          }
        }
        
        // Check if already signed
        if (signatureCapture.status === 'signed') {
          return res.json({
            success: true,
            alreadySigned: true,
            applicationContext: {
              companyName,
              applicantName,
              applicantEmail,
              agentName,
              agentEmail,
              ownerName: signatureCapture.signerName || 'Owner',
              ownerEmail: signatureCapture.signerEmail,
              ownershipPercentage: signatureCapture.ownershipPercentage ? `${signatureCapture.ownershipPercentage}%` : 'N/A',
              applicationId: signatureCapture.prospectId || signatureCapture.applicationId,
              status: prospect?.status || 'pending',
              signedAt: signatureCapture.dateSigned
            }
          });
        }
        
        // Check if expired
        if (signatureCapture.timestampExpires && signatureCapture.timestampExpires < new Date()) {
          return res.status(410).json({
            success: false,
            expired: true,
            message: 'This signature request has expired'
          });
        }
        
        return res.json({ 
          success: true, 
          applicationContext: {
            companyName,
            applicantName,
            applicantEmail,
            agentName,
            agentEmail,
            ownerName: signatureCapture.signerName || 'Owner',
            ownerEmail: signatureCapture.signerEmail,
            ownershipPercentage: signatureCapture.ownershipPercentage ? `${signatureCapture.ownershipPercentage}%` : 'N/A',
            applicationId: signatureCapture.prospectId || signatureCapture.applicationId,
            status: prospect?.status || 'pending',
            signatureCaptureId: signatureCapture.id
          }
        });
      }
      
      // Fallback: Find the prospect owner by signature token (legacy system)
      const owner = await envStorage.getProspectOwnerBySignatureToken(token);
      if (!owner) {
        return res.status(404).json({ 
          success: false, 
          message: "Invalid signature token" 
        });
      }

      // Get prospect details
      const prospect = await envStorage.getMerchantProspect(owner.prospectId);
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
      const agent = await envStorage.getAgent(prospect.agentId);

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
  app.get("/api/signature/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      
      const signature = await envStorage.getProspectSignature(token);
      
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
  app.get("/api/prospects/:prospectId/owners-with-signatures", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { prospectId } = req.params;
      const owners = await envStorage.getProspectOwners(parseInt(prospectId));
      const signatures = await envStorage.getProspectSignaturesByProspect(parseInt(prospectId));
      
      // Also get signature captures (new unified table)
      const signatureCaptures = await envStorage.getSignatureCapturesByProspect(parseInt(prospectId));
      
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
      
      // Also return signature captures for signature group format (Template 25 style)
      const signatureGroupData: Record<string, any> = {};
      for (const capture of signatureCaptures) {
        const groupKey = `owners_${capture.roleKey}_signature_owner`;
        signatureGroupData[`signatureGroup_${groupKey}`] = {
          signerName: capture.signerName,
          signerEmail: capture.signerEmail,
          signature: capture.signature,
          signatureType: capture.signatureType,
          ownershipPercentage: capture.ownershipPercentage,
          status: 'signed',
          dateSigned: capture.dateSigned,
          timestampSigned: capture.timestampSigned,
        };
      }
      
      res.json({ 
        success: true, 
        owners: ownersWithSignatures,
        signatureCaptures: signatureGroupData
      });
    } catch (error) {
      console.error("Error fetching owners with signatures:", error);
      res.status(500).json({ success: false, message: "Failed to fetch owners with signatures" });
    }
  });

  // Get signature status for a prospect (for application view)
  app.get("/api/prospects/:prospectId/signature-status", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { prospectId } = req.params;
      const prospect = await envStorage.getMerchantProspect(parseInt(prospectId));
      
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

      const dbSignatures = await envStorage.getProspectSignaturesByProspect(parseInt(prospectId));
      const prospectOwners = await envStorage.getProspectOwners(parseInt(prospectId));

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
        // Include owner-level details for application view
        ownerStatus: requiredSignatures.map((owner: any) => {
          const dbOwner = prospectOwners.find(po => po.email === owner.email);
          const hasSignature = dbOwner ? dbSignatures.some((sig: any) => sig.ownerId === dbOwner.id) : false;
          return {
            name: owner.name,
            email: owner.email,
            percentage: owner.percentage,
            hasSignature
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
  app.get("/api/signatures/by-email/:email", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const email = decodeURIComponent(req.params.email);
      
      const signatures = await envStorage.getProspectSignaturesByOwnerEmail(email);
      
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
  app.get("/api/merchants/all", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { search } = req.query;
      const dynamicDB = getRequestDB(req);
      const { merchants, companies, companyAddresses, addresses } = await import("@shared/schema");
      
      console.log(`Merchants endpoint - Database environment: ${req.dbEnv}`);
      
      // Fetch merchants with their user, company and address information
      const { users } = await import("@shared/schema");
      let merchantRecords;
      if (search) {
        merchantRecords = await dynamicDB.select({
          merchant: merchants,
          user: users,
          company: companies,
          address: addresses
        })
        .from(merchants)
        .leftJoin(users, eq(merchants.userId, users.id))
        .leftJoin(companies, eq(merchants.companyId, companies.id))
        .leftJoin(companyAddresses, eq(companies.id, companyAddresses.companyId))
        .leftJoin(addresses, eq(companyAddresses.addressId, addresses.id))
        .where(
          or(
            ilike(companies.name, `%${search}%`),
            ilike(companies.email, `%${search}%`),
            ilike(companies.phone, `%${search}%`),
            ilike(users.firstName, `%${search}%`),
            ilike(users.lastName, `%${search}%`)
          )
        );
      } else {
        merchantRecords = await dynamicDB.select({
          merchant: merchants,
          user: users,
          company: companies,
          address: addresses
        })
        .from(merchants)
        .leftJoin(users, eq(merchants.userId, users.id))
        .leftJoin(companies, eq(merchants.companyId, companies.id))
        .leftJoin(companyAddresses, eq(companies.id, companyAddresses.companyId))
        .leftJoin(addresses, eq(companyAddresses.addressId, addresses.id));
      }
      
      // Transform results to include user and company data (firstName/lastName from user, business info from company)
      const merchantsWithCompanyData = merchantRecords.map(record => ({
        ...record.merchant,
        // Add user fields for backward compatibility (firstName/lastName from user table)
        firstName: record.user?.firstName,
        lastName: record.user?.lastName,
        // Add company fields for backward compatibility
        email: record.company?.email,
        phone: record.company?.phone,
        businessName: record.company?.name,
        businessType: record.company?.businessType,
        company: record.company || undefined,
        address: record.address || undefined
      }));
      
      console.log(`Found ${merchantsWithCompanyData.length} merchants in ${req.dbEnv} database`);
      res.json(merchantsWithCompanyData);
    } catch (error) {
      console.error("Error fetching all merchants:", error);
      res.status(500).json({ message: "Failed to fetch all merchants" });
    }
  });

  app.post("/api/merchants", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    const dynamicDB = getRequestDB(req);
    console.log(`Creating merchant - Database environment: ${req.dbEnv}`);
    
    try {
      const result = await dynamicDB.transaction(async (tx) => {
        // Extract company data from request
        const { 
          userId,
          companyName,
          companyBusinessType,
          companyEmail,
          companyPhone,
          companyWebsite,
          companyTaxId,
          companyIndustry,
          companyDescription,
          ...merchantData 
        } = req.body;

        // Company creation is REQUIRED for merchants
        if (!companyName?.trim()) {
          throw new Error('Company name is required for merchant creation');
        }
        if (!companyEmail?.trim()) {
          throw new Error('Company email is required for merchant creation');
        }

        console.log(`Creating company: ${companyName}`);
        
        // Create company
        const { companies, users } = await import("@shared/schema");
        const companyData = {
          name: companyName.trim(),
          businessType: companyBusinessType || undefined,
          email: companyEmail.trim(),
          phone: companyPhone?.trim() || undefined,
          website: companyWebsite?.trim() || undefined,
          taxId: companyTaxId?.trim() || undefined,
          industry: companyIndustry?.trim() || undefined,
          description: companyDescription?.trim() || undefined,
          status: 'active' as const,
        };

        const [company] = await tx.insert(companies).values(companyData).returning();
        const companyId = company.id;
        console.log(`Company created with ID: ${companyId}`);

        // Generate temporary password
        const tempPassword = `Merch${Math.random().toString(36).slice(-8)}!`;
        const bcrypt = await import('bcrypt');
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        // Create user account for merchant
        const username = merchantData.username || `${merchantData.firstName?.toLowerCase()}.${merchantData.lastName?.toLowerCase()}`;
        const userData = {
          id: crypto.randomUUID(),
          email: companyEmail.trim(),
          username: username,
          passwordHash,
          firstName: merchantData.firstName,
          lastName: merchantData.lastName,
          phone: companyPhone?.trim() || '',
          roles: ['merchant'] as const,
          status: 'active' as const,
          emailVerified: false,
        };

        const [user] = await tx.insert(users).values(userData).returning();

        // Validate merchant-specific data (merchants only have: userId, companyId, agentId, processingFee, status, monthlyVolume, notes)
        const merchantValidation = insertMerchantSchema.omit({ userId: true, companyId: true }).safeParse({
          status: merchantData.status || 'active',
          agentId: merchantData.agentId || null,
          processingFee: merchantData.processingFee || '2.50',
          monthlyVolume: merchantData.monthlyVolume || '0',
          notes: merchantData.notes || null,
        });

        if (!merchantValidation.success) {
          throw new Error(`Invalid merchant data: ${merchantValidation.error.errors.map(e => e.message).join(', ')}`);
        }

        // Create merchant
        const { merchants } = await import("@shared/schema");
        const [merchant] = await tx.insert(merchants).values({
          status: merchantValidation.data.status,
          agentId: merchantValidation.data.agentId,
          processingFee: merchantValidation.data.processingFee,
          monthlyVolume: merchantValidation.data.monthlyVolume,
          notes: merchantValidation.data.notes,
          userId: user.id,
          companyId: companyId
        }).returning();

        return {
          merchant,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            roles: user.roles,
            temporaryPassword: tempPassword
          },
          company: { id: companyId, name: companyName }
        };
      });

      console.log(`Merchant created in ${req.dbEnv} database:`, result.merchant.firstName, result.merchant.lastName);
      
      res.status(201).json({
        merchant: result.merchant,
        user: result.user,
        company: result.company
      });
    } catch (error) {
      console.error("Error creating merchant:", error);
      if (error.message?.includes('unique constraint')) {
        res.status(409).json({ message: "Email address already exists" });
      } else {
        res.status(500).json({ message: error.message || "Failed to create merchant" });
      }
    }
  });

  // Bulk status update for merchants
  app.post("/api/merchants/bulk-status-update", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { ids, status } = req.body;
      const dynamicDB = getRequestDB(req);
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      
      if (!status || !['active', 'inactive', 'suspended'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      // Update all merchants with the new status
      const { merchants } = await import('@shared/schema');
      const { inArray } = await import('drizzle-orm');
      
      const updatedMerchants = await dynamicDB
        .update(merchants)
        .set({ status })
        .where(inArray(merchants.id, ids))
        .returning();
      
      res.json({ 
        success: true, 
        updatedCount: updatedMerchants.length,
        message: `Successfully updated ${updatedMerchants.length} of ${ids.length} merchants to ${status}`
      });
    } catch (error) {
      console.error("Error updating merchant statuses in bulk:", error);
      res.status(500).json({ message: "Failed to update merchant statuses" });
    }
  });

  // Current agent info (for logged-in agents)
  app.get("/api/current-agent", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = (req as any).user.claims.sub;
      console.log("Current Agent API - UserId:", userId);
      
      const agent = await envStorage.getAgentByUserId(userId);
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
  app.get("/api/agents", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { search } = req.query;
      const dynamicDB = getRequestDB(req);
      
      console.log(`Agents endpoint - Database environment: ${req.dbEnv}`);
      
      // Fetch agents with their company and address information
      let agentRecords;
      if (search) {
        agentRecords = await dynamicDB.select({
          agent: agents,
          company: companies,
          address: addresses
        })
        .from(agents)
        .leftJoin(companies, eq(agents.companyId, companies.id))
        .leftJoin(companyAddresses, eq(companies.id, companyAddresses.companyId))
        .leftJoin(addresses, eq(companyAddresses.addressId, addresses.id))
        .where(
          or(
            ilike(agents.firstName, `%${search}%`),
            ilike(agents.lastName, `%${search}%`),
            ilike(companies.email, `%${search}%`)
          )
        );
      } else {
        agentRecords = await dynamicDB.select({
          agent: agents,
          company: companies,
          address: addresses
        })
        .from(agents)
        .leftJoin(companies, eq(agents.companyId, companies.id))
        .leftJoin(companyAddresses, eq(companies.id, companyAddresses.companyId))
        .leftJoin(addresses, eq(companyAddresses.addressId, addresses.id));
      }
      
      // Transform results to include company data (company now holds email/phone)
      const agentsWithCompanyData = agentRecords.map(record => ({
        ...record.agent,
        // Add company email/phone for backward compatibility
        email: record.company?.email,
        phone: record.company?.phone,
        company: record.company || undefined,
        address: record.address || undefined
      }));
      
      console.log(`Found ${agentsWithCompanyData.length} agents in ${req.dbEnv} database`);
      res.json(agentsWithCompanyData);
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ message: "Failed to fetch agents" });
    }
  });

  // Bulk status update for agents
  app.post("/api/agents/bulk-status-update", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { ids, status } = req.body;
      const dynamicDB = getRequestDB(req);
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid request: ids must be a non-empty array" });
      }
      
      if (!status || !['active', 'inactive'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      // Update all agents with the new status
      const { agents } = await import('@shared/schema');
      const { inArray } = await import('drizzle-orm');
      
      const updatedAgents = await dynamicDB
        .update(agents)
        .set({ status })
        .where(inArray(agents.id, ids))
        .returning();
      
      res.json({ 
        success: true, 
        updatedCount: updatedAgents.length,
        message: `Successfully updated ${updatedAgents.length} of ${ids.length} agents to ${status}`
      });
    } catch (error) {
      console.error("Error updating agent statuses in bulk:", error);
      res.status(500).json({ message: "Failed to update agent statuses" });
    }
  });

  app.post("/api/agents", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    const dynamicDB = getRequestDB(req);
    console.log(`Creating agent - Database environment: ${req.dbEnv}`);
    
    // Use database transaction to ensure ACID compliance
    // CRITICAL: Create independent pg.Pool to completely bypass Drizzle's schema cache bug
    // while maintaining environment isolation
    const { Pool } = await import('pg');
    const { getDatabaseUrl } = await import('./db');
    const envConnectionString = getDatabaseUrl(req.dbEnv);
    const rawPool = new Pool({ connectionString: envConnectionString });
    const poolClient = await rawPool.connect();
    
    try {
      await poolClient.query('BEGIN');
      
      const result = await (async () => {
        // Extract company data and user account option from request
        const { 
          userId, 
          companyName, 
          companyBusinessType, 
          companyEmail, 
          companyPhone, 
          companyWebsite, 
          companyTaxId, 
          companyIndustry, 
          companyDescription, 
          companyAddress,
          createUserAccount,
          username,
          password,
          confirmPassword,
          communicationPreference,
          email: agentEmail, // Agent's individual email
          phone: agentPhone, // Agent's individual phone
          ...agentData 
        } = req.body;

        // Company creation is now REQUIRED for agents
        if (!companyName?.trim()) {
          throw new Error('Company name is required for agent creation');
        }
        
        // Email is also required (stored in company)
        if (!companyEmail?.trim()) {
          throw new Error('Company email is required for agent creation');
        }

        console.log(`Creating company: ${companyName}`);
        
        // Prepare company data
        const companyData = {
          name: companyName.trim(),
          businessType: companyBusinessType || undefined,
          email: companyEmail.trim(), // Required
          phone: companyPhone?.trim() || undefined,
          website: companyWebsite?.trim() || undefined,
          taxId: companyTaxId?.trim() || undefined,
          industry: companyIndustry?.trim() || undefined,
          description: companyDescription?.trim() || undefined,
          status: 'active' as const,
        };

        // Create company using raw SQL
        const companyResult = await poolClient.query(
          `INSERT INTO companies (name, business_type, email, phone, website, tax_id, industry, description, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            companyData.name,
            companyData.businessType || null,
            companyData.email,
            companyData.phone || null,
            companyData.website || null,
            companyData.taxId || null,
            companyData.industry || null,
            companyData.description || null,
            companyData.status
          ]
        );
        const company = companyResult.rows[0];
        const companyId = company.id;
        console.log(`Company created with ID: ${companyId}`);
          
          // Create location and address if provided
          if (companyAddress && (
            companyAddress.street1?.trim() || 
            companyAddress.city?.trim() || 
            companyAddress.state?.trim()
          )) {
            console.log(`Creating location and address for company: ${companyName}`);
            
            // Create location using raw SQL
            const locationResult = await poolClient.query(
              `INSERT INTO locations (company_id, name, type, phone, email, status)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *`,
              [
                companyId,
                companyName,
                'company_office',
                companyPhone?.trim() || null,
                companyEmail?.trim() || null,
                'active'
              ]
            );
            const location = locationResult.rows[0];
            console.log(`Location created with ID: ${location.id}`);
            
            // Prepare address data - link to location
            const addressData = {
              locationId: location.id, // Link address to location
              street1: companyAddress.street1?.trim() || '',
              street2: companyAddress.street2?.trim() || undefined,
              city: companyAddress.city?.trim() || '',
              state: companyAddress.state?.trim() || '',
              postalCode: companyAddress.postalCode?.trim() || companyAddress.zipCode?.trim() || '',
              country: companyAddress.country?.trim() || 'US',
              type: 'primary' as const,
              latitude: companyAddress.latitude || undefined,
              longitude: companyAddress.longitude || undefined,
            };
            
            console.log('Address data being inserted:', addressData);
            
            // Create address using raw SQL
            const addressResult = await poolClient.query(
              `INSERT INTO addresses (location_id, street1, street2, city, state, postal_code, country, type, latitude, longitude)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING *`,
              [
                location.id,
                addressData.street1,
                addressData.street2 || null,
                addressData.city,
                addressData.state,
                addressData.postalCode,
                addressData.country,
                addressData.type,
                addressData.latitude || null,
                addressData.longitude || null
              ]
            );
            const address = addressResult.rows[0];
            console.log(`Address created with ID: ${address.id} linked to location ${location.id}`);
            
            // Link company to address using raw SQL
            await poolClient.query(
              `INSERT INTO company_addresses (company_id, address_id, type)
               VALUES ($1, $2, $3)`,
              [companyId, address.id, 'primary']
            );
            console.log(`Company ${companyId} linked to address ${address.id}`);
          }

        // Validate agent-specific data (firstName, lastName, territory, commissionRate)
        const agentValidation = insertAgentSchema.omit({ userId: true, companyId: true, createdAt: true }).safeParse({
          firstName: agentData.firstName,
          lastName: agentData.lastName,
          territory: agentData.territory,
          commissionRate: agentData.commissionRate,
          status: agentData.status || 'active'
        });

        if (!agentValidation.success) {
          throw new Error(`Invalid agent data: ${agentValidation.error.errors.map(e => e.message).join(', ')}`);
        }

        let user = null;
        let userInfo = null;
        
        // Create user account if requested
        if (createUserAccount) {
          // Validate user creation fields if user account is requested
          if (!agentEmail?.trim()) {
            throw new Error('Agent email is required when creating user account');
          }
          if (!username || username.length < 3) {
            throw new Error('Username is required and must be at least 3 characters when creating user account');
          }
          if (!password || password.length < 12) {
            throw new Error('Password is required and must be at least 12 characters when creating user account');
          }
          
          // Validate password strength
          const { validatePasswordStrength } = await import('../shared/schema.js');
          const passwordValidation = validatePasswordStrength(password);
          if (!passwordValidation.valid) {
            throw new Error(`Password does not meet security requirements: ${passwordValidation.errors.join(', ')}`);
          }
          
          // Only check password confirmation if confirmPassword is provided (UI forms)
          // API calls don't need confirmPassword if password is already known
          if (confirmPassword && password !== confirmPassword) {
            throw new Error('Passwords do not match');
          }
          
          // Hash the password
          const bcrypt = await import('bcrypt');
          const passwordHash = await bcrypt.hash(password, 10);
          
          // Create user account within transaction - use agent's individual email
          const userData = {
            id: crypto.randomUUID(),
            email: agentEmail.trim(),
            username: username,
            passwordHash,
            firstName: agentValidation.data.firstName,
            lastName: agentValidation.data.lastName,
            phone: agentPhone?.trim() || '',
            roles: ['agent'] as const,
            status: 'active' as const,
            emailVerified: true,
            communicationPreference: communicationPreference || 'email',
          };
          
          const userResult = await poolClient.query(
            `INSERT INTO users (id, email, username, password_hash, first_name, last_name, phone, roles, status, email_verified, communication_preference)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              userData.id,
              userData.email,
              userData.username,
              userData.passwordHash,
              userData.firstName,
              userData.lastName,
              userData.phone,
              userData.roles,
              userData.status,
              userData.emailVerified,
              userData.communicationPreference
            ]
          );
          user = userResult.rows[0];
          
          userInfo = {
            id: user.id,
            username: user.username,
            email: user.email,
            roles: user.roles,
            temporaryPassword: password // The password they set
          };
        } else {
          // For agents without user accounts, we'll need to generate a special agent-only user ID
          // This maintains the foreign key relationship while indicating no login capability
          const agentOnlyUserId = crypto.randomUUID();
          const bcrypt = await import('bcrypt');
          // Generate a random hash that can't be used for login (since they don't know the original password)
          const randomPasswordHash = await bcrypt.hash(crypto.randomUUID(), 10);
          
          // Use provided username or generate one
          const agentUsername = username?.trim() || `agent-${agentValidation.data.firstName.toLowerCase()}-${agentValidation.data.lastName.toLowerCase()}-${Date.now()}`;
          
          const userData = {
            id: agentOnlyUserId,
            email: agentEmail?.trim() || companyEmail.trim(), // Use agent email if provided, fallback to company email
            username: agentUsername,
            passwordHash: randomPasswordHash, // Random hash - can't be used for login
            firstName: agentValidation.data.firstName,
            lastName: agentValidation.data.lastName,
            phone: agentPhone?.trim() || companyPhone?.trim() || '',
            roles: ['agent'] as const,
            status: 'inactive' as const, // Inactive since they can't log in
            emailVerified: false,
          };
          
          const userResult = await poolClient.query(
            `INSERT INTO users (id, email, username, password_hash, first_name, last_name, phone, roles, status, email_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
              userData.id,
              userData.email,
              userData.username,
              userData.passwordHash,
              userData.firstName,
              userData.lastName,
              userData.phone,
              userData.roles,
              userData.status,
              userData.emailVerified
            ]
          );
          user = userResult.rows[0];
        }
        
        // WORKAROUND: Use raw pool client for agent INSERT to bypass Drizzle completely
        // Drizzle has a critical schema cache bug where it adds phantom email/phone columns
        const agentInsertResult = await poolClient.query(
          `INSERT INTO agents (user_id, company_id, first_name, last_name, territory, commission_rate, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            user.id,
            companyId,
            agentValidation.data.firstName,
            agentValidation.data.lastName,
            agentValidation.data.territory || null,
            agentValidation.data.commissionRate || '5.00',
            agentValidation.data.status
          ]
        );
        const agent = agentInsertResult.rows[0];
        
        // CRITICAL: Create user_company_associations entry to link user to company
        // This is required for getAgentByUserId() to find the agent via the company association
        await poolClient.query(
          `INSERT INTO user_company_associations (user_id, company_id, company_role, is_primary, is_active)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            user.id,
            companyId,
            'agent',
            true,
            true
          ]
        );
        console.log(`User-company association created for user ${user.id} with company ${companyId}`);
        
        return {
          agent,
          user: userInfo, // Only return user info if account was created
          company: companyId ? { id: companyId, name: companyName } : undefined
        };
      })();
      
      await poolClient.query('COMMIT');
      poolClient.release();
      await rawPool.end();
      
      console.log(`Agent created in ${req.dbEnv} database:`, result.agent.first_name, result.agent.last_name);
      if (result.company) {
        console.log(`Company created: ${result.company.name} (ID: ${result.company.id})`);
      }
      
      // Fire agent_registered trigger
      try {
        const { TriggerService } = await import("./triggerService");
        const { TRIGGER_KEYS } = await import("@shared/triggerKeys");
        const triggerService = new TriggerService();
        
        await triggerService.fireTrigger(TRIGGER_KEYS.AGENT.REGISTERED, {
          triggerEvent: TRIGGER_KEYS.AGENT.REGISTERED, // For email template styling
          agentId: result.agent.id,
          agentName: `${result.agent.first_name} ${result.agent.last_name}`,
          firstName: result.agent.first_name,
          lastName: result.agent.last_name,
          email: req.body.email, // Use agent's individual email
          phone: req.body.phone, // Use agent's individual phone
          territory: result.agent.territory,
          companyName: result.company?.name,
          companyId: result.company?.id,
          hasUserAccount: !!result.user,
          username: result.user?.username,
        }, {
          userId: result.user?.id,
          triggerSource: 'agent_creation',
          dbEnv: req.dbEnv
        });
        
        console.log(`agent_registered trigger fired for agent ${result.agent.id}`);
      } catch (triggerError) {
        // Log but don't fail the agent creation
        console.error('Error firing agent_registered trigger:', triggerError);
      }
      
      res.status(201).json(result);
      
    } catch (error) {
      // Rollback transaction on error
      if (poolClient) {
        await poolClient.query('ROLLBACK').catch(console.error);
        poolClient.release();
      }
      if (rawPool) {
        await rawPool.end().catch(console.error);
      }
      console.error("Error creating agent:", error);
      
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

  // Update agent
  app.put("/api/agents/:id", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    const dynamicDB = getRequestDB(req);
    const agentId = parseInt(req.params.id);
    console.log(`Updating agent ${agentId} - Database environment: ${req.dbEnv}`);
    
    try {
      // Check if agent exists
      const [existingAgent] = await dynamicDB.select().from(agents).where(eq(agents.id, agentId));
      if (!existingAgent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      const result = await dynamicDB.transaction(async (tx) => {
        // Extract data from request
        const { 
          companyName, 
          companyBusinessType, 
          companyEmail, 
          companyPhone, 
          companyWebsite, 
          companyTaxId, 
          companyIndustry, 
          companyDescription, 
          companyAddress,
          createUserAccount,
          username,
          password,
          confirmPassword,
          communicationPreference,
          ...agentData 
        } = req.body;

        // Validate agent data
        const validationResult = insertAgentSchema.omit({ userId: true }).partial().safeParse(agentData);
        if (!validationResult.success) {
          throw new Error(`Invalid agent data: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
        }

        // Update agent basic info
        const [updatedAgent] = await tx
          .update(agents)
          .set(validationResult.data)
          .where(eq(agents.id, agentId))
          .returning();

        // Handle user account creation if requested
        let userInfo = null;
        if (createUserAccount) {
          // Check if agent already has a user account
          const [existingUser] = await tx.select().from(users).where(eq(users.id, existingAgent.userId));
          
          // Check if the existing user is actually a login-enabled account
          const hasActiveAccount = existingUser && existingUser.status === 'active';
          
          if (hasActiveAccount) {
            throw new Error('Agent already has an active user account');
          }
          
          // Validate user creation fields
          if (!username || username.length < 3) {
            throw new Error('Username is required and must be at least 3 characters when creating user account');
          }
          if (!password || password.length < 12) {
            throw new Error('Password is required and must be at least 12 characters when creating user account');
          }
          
          // Validate password strength
          const { validatePasswordStrength } = await import('../shared/schema.js');
          const passwordValidation = validatePasswordStrength(password);
          if (!passwordValidation.valid) {
            throw new Error(`Password does not meet security requirements: ${passwordValidation.errors.join(', ')}`);
          }
          
          // Only check password confirmation if confirmPassword is provided (UI forms)
          // API calls don't need confirmPassword if password is already known
          if (confirmPassword && password !== confirmPassword) {
            throw new Error('Passwords do not match');
          }
          
          // Hash the password
          const bcrypt = await import('bcrypt');
          const passwordHash = await bcrypt.hash(password, 10);
          
          // Update the existing user to be active
          const [activatedUser] = await tx
            .update(users)
            .set({
              username: username,
              passwordHash: passwordHash,
              status: 'active' as const,
              emailVerified: true,
              communicationPreference: communicationPreference || 'email',
              roles: ['agent'] as const,
            })
            .where(eq(users.id, existingAgent.userId))
            .returning();
          
          userInfo = {
            id: activatedUser.id,
            username: activatedUser.username,
            email: activatedUser.email,
            roles: activatedUser.roles,
            temporaryPassword: password
          };
        }

        return {
          agent: updatedAgent,
          user: userInfo
        };
      });
      
      console.log(`Agent ${agentId} updated successfully in ${req.dbEnv} database`);
      res.status(200).json(result);
      
    } catch (error) {
      console.error("Error updating agent:", error);
      
      if (error.message?.includes('Invalid agent data')) {
        res.status(400).json({ message: error.message });
      } else if (error.message?.includes('already has an active user account')) {
        res.status(409).json({ message: error.message });
      } else if (error.message?.includes('Username') || error.message?.includes('Password')) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to update agent" });
      }
    }
  });

  // Delete agent
  app.delete("/api/agents/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const dynamicDB = getRequestDB(req);
      
      console.log(`Deleting agent ${agentId} - Database environment: ${req.dbEnv}`);
      
      // First check if agent exists
      const [existingAgent] = await dynamicDB.select().from(agents).where(eq(agents.id, agentId));
      if (!existingAgent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      // Check if agent has any merchants associated (direct link)
      const directMerchants = await dynamicDB
        .select({ count: sql<number>`count(*)` })
        .from(merchants)
        .where(eq(merchants.agentId, agentId));
      
      // Check agent_merchants junction table for many-to-many associations
      const { agentMerchants, merchantProspects } = await import("@shared/schema");
      const junctionMerchants = await dynamicDB
        .select({ count: sql<number>`count(*)` })
        .from(agentMerchants)
        .where(eq(agentMerchants.agentId, agentId));
      
      // Check merchant_prospects for agent associations
      const prospects = await dynamicDB
        .select({ count: sql<number>`count(*)` })
        .from(merchantProspects)
        .where(eq(merchantProspects.agentId, agentId));
      
      const totalAssociations = (directMerchants[0]?.count || 0) + (junctionMerchants[0]?.count || 0) + (prospects[0]?.count || 0);
      
      if (totalAssociations > 0) {
        const parts = [];
        if (directMerchants[0]?.count > 0) parts.push(`${directMerchants[0].count} merchant(s)`);
        if (junctionMerchants[0]?.count > 0) parts.push(`${junctionMerchants[0].count} merchant assignment(s)`);
        if (prospects[0]?.count > 0) parts.push(`${prospects[0].count} prospect(s)`);
        
        return res.status(409).json({ 
          message: `Cannot delete agent: agent has ${parts.join(', ')}. Please reassign before deleting.` 
        });
      }
      
      // CRITICAL: Use raw pg.Pool to bypass Drizzle's schema cache bug
      // Same issue as agent creation - Drizzle caches old schema definitions
      const { Pool } = await import('pg');
      const { getDatabaseUrl } = await import('./db');
      const envConnectionString = getDatabaseUrl(req.dbEnv);
      const rawPool = new Pool({ connectionString: envConnectionString });
      const poolClient = await rawPool.connect();
      
      let result = 0;
      try {
        await poolClient.query('BEGIN');
        
        let companyToDelete = null;
        
        // Check if agent belongs to a company and verify deletion safety
        if (existingAgent.companyId) {
          // Count how many agents belong to this company
          const agentCountResult = await poolClient.query(
            'SELECT COUNT(*)::int as count FROM agents WHERE company_id = $1',
            [existingAgent.companyId]
          );
          const companyAgentCount = parseInt(agentCountResult.rows[0].count);
          
          // Count how many merchants belong to this company
          const merchantCountResult = await poolClient.query(
            'SELECT COUNT(*)::int as count FROM merchants WHERE company_id = $1',
            [existingAgent.companyId]
          );
          const companyMerchantCount = parseInt(merchantCountResult.rows[0].count);
          
          console.log(`Company ${existingAgent.companyId} has ${companyAgentCount} agents and ${companyMerchantCount} merchants`);
          
          // CRITICAL BUSINESS RULE: Cannot delete agent if company has merchants
          // Merchants depend on company structure, so we must preserve everything
          if (companyMerchantCount > 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            await rawPool.end();
            return res.status(409).json({ 
              message: `Cannot delete agent: company has ${companyMerchantCount} merchant(s). Please reassign or remove merchants before deleting agent.` 
            });
          }
          
          // Only cascade delete company if this is the only agent (and no merchants)
          if (companyAgentCount === 1) {
            companyToDelete = existingAgent.companyId;
            console.log(`Will delete company ${companyToDelete} as it has no merchants and no other agents`);
          } else if (companyAgentCount > 1) {
            console.log(`Keeping company ${existingAgent.companyId} as it has ${companyAgentCount - 1} other agents`);
          }
        }
        
        // Delete agent record
        const agentDeleteResult = await poolClient.query(
          'DELETE FROM agents WHERE id = $1',
          [agentId]
        );
        result = agentDeleteResult.rowCount || 0;
        
        // Delete associated user account if it exists
        if (existingAgent.userId) {
          await poolClient.query('DELETE FROM users WHERE id = $1', [existingAgent.userId]);
          console.log(`Deleted user account for agent ${agentId}: ${existingAgent.userId}`);
        }
        
        // Delete company and its associated records if it has no merchants or other agents
        if (companyToDelete) {
          // Delete location addresses
          const locAddrsResult = await poolClient.query(
            'DELETE FROM addresses WHERE location_id IN (SELECT id FROM locations WHERE company_id = $1) RETURNING id',
            [companyToDelete]
          );
          console.log(`Deleted ${locAddrsResult.rowCount} location address(es)`);
          
          // Delete locations
          const locsResult = await poolClient.query(
            'DELETE FROM locations WHERE company_id = $1 RETURNING id',
            [companyToDelete]
          );
          console.log(`Deleted ${locsResult.rowCount} location(s) for company ${companyToDelete}`);
          
          // Get and delete company-address links
          const compAddrLinks = await poolClient.query(
            'SELECT address_id FROM company_addresses WHERE company_id = $1',
            [companyToDelete]
          );
          
          await poolClient.query(
            'DELETE FROM company_addresses WHERE company_id = $1',
            [companyToDelete]
          );
          console.log(`Deleted ${compAddrLinks.rowCount} company-address link(s)`);
          
          // Delete company addresses
          for (const row of compAddrLinks.rows) {
            await poolClient.query('DELETE FROM addresses WHERE id = $1', [row.address_id]);
          }
          console.log(`Deleted ${compAddrLinks.rowCount} company address(es)`);
          
          // Delete the company
          const compResult = await poolClient.query(
            'DELETE FROM companies WHERE id = $1 RETURNING name',
            [companyToDelete]
          );
          console.log(`Deleted company ${companyToDelete}: ${compResult.rows[0]?.name}`);
        }
        
        await poolClient.query('COMMIT');
      } catch (error) {
        await poolClient.query('ROLLBACK');
        throw error;
      } finally {
        poolClient.release();
        await rawPool.end();
      }
      
      if (result > 0) {
        console.log(`Successfully deleted agent ${agentId} in ${req.dbEnv} database`);
        res.json({ success: true, message: "Agent deleted successfully" });
      } else {
        res.status(404).json({ message: "Agent not found" });
      }
    } catch (error) {
      console.error("Error deleting agent:", error);
      if (error.message?.includes('violates foreign key constraint')) {
        res.status(409).json({ 
          message: "Cannot delete agent: agent is still assigned to merchants or has related data" 
        });
      } else {
        res.status(500).json({ message: "Failed to delete agent" });
      }
    }
  });

  // Agent and Merchant User Management
  app.get("/api/agents/:id/user", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      console.log(`Agent user endpoint - Database environment: ${req.dbEnv}`);
      
      const user = await envStorage.getAgentUser(agentId);
      
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

  app.get("/api/merchants/:id/user", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const merchantId = parseInt(req.params.id);
      const user = await envStorage.getMerchantUser(merchantId);
      
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
  app.post("/api/agents/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const agentId = parseInt(req.params.id);
      const user = await envStorage.getAgentUser(agentId);
      
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
      
      await envStorage.updateUser(user.id, { passwordHash });
      
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

  app.post("/api/merchants/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const merchantId = parseInt(req.params.id);
      const user = await envStorage.getMerchantUser(merchantId);
      
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
      
      await envStorage.updateUser(user.id, { passwordHash });
      
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
  app.get("/api/transactions/all", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { search } = req.query;
      
      if (search) {
        const transactions = await envStorage.searchTransactions(search as string);
        res.json(transactions);
      } else {
        const transactions = await envStorage.getAllTransactions();
        res.json(transactions);
      }
    } catch (error) {
      console.error("Error fetching all transactions:", error);
      res.status(500).json({ message: "Failed to fetch all transactions" });
    }
  });

  app.post("/api/transactions", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const result = insertTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid transaction data", errors: result.error.errors });
      }

      const transaction = await envStorage.createTransaction(result.data);
      res.status(201).json(transaction);
    } catch (error) {
      console.error("Error creating transaction:", error);
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Analytics routes
  app.get("/api/analytics/dashboard", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const metrics = await envStorage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/analytics/top-merchants", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const topMerchants = await envStorage.getTopMerchants();
      res.json(topMerchants);
    } catch (error) {
      console.error("Error fetching top merchants:", error);
      res.status(500).json({ message: "Failed to fetch top merchants" });
    }
  });

  app.get("/api/analytics/recent-transactions", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const recentTransactions = await envStorage.getRecentTransactions(limit);
      res.json(recentTransactions);
    } catch (error) {
      console.error("Error fetching recent transactions:", error);
      res.status(500).json({ message: "Failed to fetch recent transactions" });
    }
  });

  // Widget preferences routes
  app.get("/api/user/widgets", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = (req as any).user.claims.sub;
      const preferences = await envStorage.getUserWidgetPreferences(userId);
      res.json(preferences);
    } catch (error) {
      console.error("Error fetching widget preferences:", error);
      res.status(500).json({ message: "Failed to fetch widget preferences" });
    }
  });

  app.post("/api/user/widgets", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = (req as any).user.claims.sub;
      const widgetData = { ...req.body, userId };
      
      const preference = await envStorage.createWidgetPreference(widgetData);
      res.status(201).json(preference);
    } catch (error) {
      console.error("Error creating widget preference:", error);
      res.status(500).json({ message: "Failed to create widget preference" });
    }
  });

  app.patch("/api/user/widgets/:id", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const updates = req.body;

      const preference = await envStorage.updateWidgetPreference(id, updates);
      if (!preference) {
        return res.status(404).json({ message: "Widget preference not found" });
      }

      res.json(preference);
    } catch (error) {
      console.error("Error updating widget preference:", error);
      res.status(500).json({ message: "Failed to update widget preference" });
    }
  });

  app.delete("/api/user/widgets/:id", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const success = await envStorage.deleteWidgetPreference(id);
      
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
  app.get('/api/dashboard/widgets', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      let userId = (req as any).userId;
      console.log(`Main routes - Fetching widgets for userId: ${userId}`);
      
      if (!userId) {
        // Try fallback from session or dev auth
        const fallbackUserId = req.session?.userId || 'admin-prod-001';
        console.log(`Main routes - Using fallback userId for GET: ${fallbackUserId}`);
        userId = fallbackUserId;
      }
      
      const widgets = await envStorage.getUserWidgetPreferences(userId);
      console.log(`Main routes - Found ${widgets.length} widgets`);
      res.json(widgets);
    } catch (error) {
      console.error("Error fetching dashboard widgets:", error);
      res.status(500).json({ message: "Failed to fetch dashboard widgets" });
    }
  });

  app.post('/api/dashboard/widgets', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = (req as any).userId;
      console.log(`Main routes - Creating widget for userId: ${userId}, full req properties:`, Object.keys(req));
      console.log(`Main routes - req.user:`, (req as any).user);
      console.log(`Main routes - req.session:`, req.session);
      
      if (!userId) {
        // Try fallback from session or dev auth
        const fallbackUserId = req.session?.userId || 'admin-prod-001';
        console.log(`Main routes - Using fallback userId: ${fallbackUserId}`);
        const finalUserId = fallbackUserId;
        
        const widgetData = { 
          user_id: finalUserId,
          widget_id: req.body.widgetId,
          position: req.body.position || 0,
          size: req.body.size || 'medium',
          is_visible: req.body.isVisible !== false,
          configuration: req.body.configuration || {}
        };
        
        console.log(`Main routes - Widget data with fallback:`, widgetData);
        const widget = await envStorage.createWidgetPreference(widgetData);
        return res.json(widget);
      }
      
      const widgetData = { 
        user_id: userId,
        widget_id: req.body.widgetId,
        position: req.body.position || 0,
        size: req.body.size || 'medium',
        is_visible: req.body.isVisible !== false,
        configuration: req.body.configuration || {}
      };
      
      console.log(`Main routes - Widget data:`, widgetData);
      const widget = await envStorage.createWidgetPreference(widgetData);
      res.json(widget);
    } catch (error) {
      console.error("Error creating dashboard widget:", error);
      res.status(500).json({ message: "Failed to create dashboard widget" });
    }
  });

  app.put('/api/dashboard/widgets/:id', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const widget = await envStorage.updateWidgetPreference(id, req.body);
      if (!widget) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json(widget);
    } catch (error) {
      console.error("Error updating dashboard widget:", error);
      res.status(500).json({ message: "Failed to update dashboard widget" });
    }
  });

  app.delete('/api/dashboard/widgets/:id', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const success = await envStorage.deleteWidgetPreference(id);
      if (!success) {
        return res.status(404).json({ message: "Widget not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting dashboard widget:", error);
      res.status(500).json({ message: "Failed to delete dashboard widget" });
    }
  });

  app.post('/api/dashboard/initialize', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = (req as any).user.claims.sub;
      const user = await envStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create default widgets based on user role
      const defaultWidgets = getDefaultWidgetsForRole(user.role);
      
      for (const widget of defaultWidgets) {
        await envStorage.createWidgetPreference({
          userId,
          widgetId: widget.id,
          size: widget.size,
          position: widget.position,
          isVisible: true,
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
  app.get('/api/dashboard/metrics', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const metrics = await envStorage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  app.get('/api/dashboard/revenue', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const timeRange = req.query.timeRange as string || 'daily';
      const revenue = await envStorage.getDashboardRevenue(timeRange);
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching dashboard revenue:", error);
      res.status(500).json({ message: "Failed to fetch dashboard revenue" });
    }
  });

  app.get('/api/dashboard/top-locations', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const limit = parseInt(req.query.limit as string) || 5;
      const sortBy = req.query.sortBy as string || 'revenue';
      const locations = await envStorage.getTopLocations(limit, sortBy);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching top locations:", error);
      res.status(500).json({ message: "Failed to fetch top locations" });
    }
  });

  app.get('/api/dashboard/recent-activity', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const activity = await envStorage.getRecentActivity();
      res.json(activity);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  app.get('/api/dashboard/assigned-merchants', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const limit = parseInt(req.query.limit as string) || 5;
      const merchants = await envStorage.getAssignedMerchants(limit);
      res.json(merchants);
    } catch (error) {
      console.error("Error fetching assigned merchants:", error);
      res.status(500).json({ message: "Failed to fetch assigned merchants" });
    }
  });

  app.get('/api/dashboard/system-overview', dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const overview = await envStorage.getSystemOverview();
      res.json(overview);
    } catch (error) {
      console.error("Error fetching system overview:", error);
      res.status(500).json({ message: "Failed to fetch system overview" });
    }
  });

  // Security endpoints - admin only
  app.get("/api/security/login-attempts", isAuthenticated, requireRole(["admin", "super_admin"]), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { loginAttempts } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
      console.log(`Login attempts endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      
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
  app.get("/api/security/audit-logs", isAuthenticated, requireRole(["admin", "super_admin"]), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
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
  app.get("/api/security/events", isAuthenticated, requireRole(["admin", "super_admin"]), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Security events endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { securityEvents } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      
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
  app.get("/api/security/audit-metrics", isAuthenticated, requireRole(["admin", "super_admin"]), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Audit metrics endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { auditLogs, securityEvents } = await import("@shared/schema");
      const { count, gte, eq, and } = await import("drizzle-orm");
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Get total audit logs
      const totalLogs = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(gte(auditLogs.createdAt, thirtyDaysAgo));
      
      // Get high risk actions
      const highRiskActions = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(and(
          gte(auditLogs.createdAt, thirtyDaysAgo),
          eq(auditLogs.riskLevel, 'high')
        ));
      
      // Get critical risk actions
      const criticalRiskActions = await dynamicDB.select({ count: count() }).from(auditLogs)
        .where(and(
          gte(auditLogs.createdAt, thirtyDaysAgo),
          eq(auditLogs.riskLevel, 'critical')
        ));
      
      // Get security events count
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
  app.get("/api/security/audit-logs/export", isAuthenticated, requireRole(["admin", "super_admin"]), adminDbMiddleware, async (req: RequestWithDB, res) => {
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

  app.get("/api/security/metrics", isAuthenticated, requireRole(["admin", "super_admin"]), dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log(`Security metrics endpoint - Database environment: ${req.dbEnv}`);
      const dynamicDB = getRequestDB(req);
      const { loginAttempts } = await import("@shared/schema");
      const { count, gte, and, eq } = await import("drizzle-orm");
      
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Get total attempts in last 30 days
      const totalAttempts = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(gte(loginAttempts.createdAt, thirtyDaysAgo));

      // Get successful logins in last 30 days
      const successfulLogins = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(and(
          gte(loginAttempts.createdAt, thirtyDaysAgo),
          eq(loginAttempts.success, true)
        ));

      // Get failed logins in last 30 days
      const failedLogins = await dynamicDB.select({ count: count() })
        .from(loginAttempts)
        .where(and(
          gte(loginAttempts.createdAt, thirtyDaysAgo),
          eq(loginAttempts.success, false)
        ));

      // Get unique IPs in last 30 days
      const uniqueIPs = await dynamicDB.selectDistinct({ ipAddress: loginAttempts.ipAddress })
        .from(loginAttempts)
        .where(gte(loginAttempts.createdAt, thirtyDaysAgo));

      // Get recent failed attempts (last 24 hours)
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
  app.post("/api/pdf-forms/upload", dbEnvironmentMiddleware, isAuthenticated, requireRole(['admin', 'super_admin']), upload.single('pdf'), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      if (!(req as any).file) {
        return res.status(400).json({ message: "No PDF file uploaded" });
      }

      const { originalname } = (req as any).file;
      const buffer = (req as any).file.buffer;
      
      // Parse the PDF to extract form structure
      const parseResult = await pdfFormParser.parsePDF(buffer);
      
      // Create the PDF form record
      const formData = {
        name: originalname.replace('.pdf', ''),
        fileName: originalname,
        fileSize: buffer.length,
        uploadedBy: (req as any).user.id,
        description: `Merchant Application Form - ${originalname}`
      };

      const pdfForm = await envStorage.createPdfForm(formData);
      
      // Create form fields from parsed data
      const fieldData = pdfFormParser.convertToDbFields(parseResult.sections, pdfForm.id);
      
      for (const field of fieldData) {
        await envStorage.createPdfFormField(field);
      }
      
      // Return the complete form with fields
      const formWithFields = await envStorage.getPdfFormWithFields(pdfForm.id);
      
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
  app.get("/api/pdf-forms", dbEnvironmentMiddleware, isAuthenticated, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const forms = await envStorage.getAllPdfForms();
      res.json(forms);
    } catch (error) {
      console.error("Error fetching PDF forms:", error);
      res.status(500).json({ message: "Failed to fetch PDF forms" });
    }
  });

  // Get specific PDF form with fields (admin only)
  app.get("/api/pdf-forms/:id", dbEnvironmentMiddleware, isAuthenticated, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const form = await envStorage.getPdfFormWithFields(formId);
      
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
  app.get("/api/pdf-forms/:id/with-fields", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const form = await envStorage.getPdfFormWithFields(formId);
      
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
  app.patch("/api/pdf-forms/:id", dbEnvironmentMiddleware, isAuthenticated, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const { name, description, showInNavigation, navigationTitle, allowedRoles } = req.body;
      
      if (!name && !description && showInNavigation === undefined && navigationTitle === undefined && !allowedRoles) {
        return res.status(400).json({ message: "No update data provided" });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (showInNavigation !== undefined) updateData.showInNavigation = showInNavigation;
      if (navigationTitle !== undefined) updateData.navigationTitle = navigationTitle;
      if (allowedRoles !== undefined) updateData.allowedRoles = allowedRoles;
      
      const updatedForm = await envStorage.updatePdfForm(formId, updateData);
      
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
  app.post("/api/pdf-forms/:id/submissions", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const { data, status = 'draft' } = req.body;
      
      const submissionData = {
        formId,
        submittedBy: (req as any).user?.id || null,
        data: typeof data === 'string' ? data : JSON.stringify(data),
        status,
        submissionToken: envStorage.generateSubmissionToken(),
        isPublic: false
      };
      
      const submission = await envStorage.createPdfFormSubmission(submissionData);
      res.status(201).json(submission);
    } catch (error) {
      console.error("Error creating form submission:", error);
      res.status(500).json({ message: "Failed to save form submission" });
    }
  });

  // Submit PDF form data (auto-save functionality)
  app.post("/api/pdf-forms/:id/submit", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const { formData } = req.body;
      
      const submissionData = {
        formId,
        submittedBy: (req as any).user?.id || null,
        data: JSON.stringify(formData),
        submissionToken: envStorage.generateSubmissionToken(),
        status: 'submitted',
        isPublic: false
      };
      
      const submission = await envStorage.createPdfFormSubmission(submissionData);
      res.status(201).json(submission);
    } catch (error) {
      console.error("Error submitting PDF form:", error);
      res.status(500).json({ message: "Failed to submit PDF form" });
    }
  });

  // Get form submissions
  app.get("/api/pdf-forms/:id/submissions", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const submissions = await envStorage.getPdfFormSubmissions(formId);
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching form submissions:", error);
      res.status(500).json({ message: "Failed to fetch form submissions" });
    }
  });

  // Create a new public form submission and return the unique token
  app.post("/api/pdf-forms/:id/create-submission", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const { applicantEmail } = req.body;
      
      // Create a new submission with unique token for public access
      const submissionData = {
        formId,
        submittedBy: null, // Public submission, no authenticated user
        applicantEmail,
        data: JSON.stringify({}), // Empty initial data
        status: 'draft',
        isPublic: true,
        submissionToken: envStorage.generateSubmissionToken()
      };
      
      const submission = await envStorage.createPdfFormSubmission(submissionData);
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
  app.get("/api/submissions/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      const submission = await envStorage.getPdfFormSubmissionByToken(token);
      
      if (!submission) {
        return res.status(404).json({ message: "Form submission not found" });
      }
      
      // Also get the form details
      const form = await envStorage.getPdfForm(submission.formId);
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
  app.put("/api/submissions/:token", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { token } = req.params;
      const { data, status = 'draft' } = req.body;
      
      const updateData = {
        data: typeof data === 'string' ? data : JSON.stringify(data),
        status,
        updatedAt: new Date()
      };
      
      const submission = await envStorage.updatePdfFormSubmissionByToken(token, updateData);
      
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
  app.post("/api/pdf-forms/:id/send-submission-link", dbEnvironmentMiddleware, isAuthenticated, async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const formId = parseInt(req.params.id);
      const { applicantEmail } = req.body;
      
      if (!applicantEmail) {
        return res.status(400).json({ message: "Applicant email is required" });
      }
      
      // Get form details
      const form = await envStorage.getPdfForm(formId);
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
        submissionToken: envStorage.generateSubmissionToken()
      };
      
      const submission = await envStorage.createPdfFormSubmission(submissionData);
      
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
  app.get('/api/fee-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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
      const { withRetry } = await import("./db");
      
      // Get all fee groups first with retry logic
      const groups = await withRetry(() => 
        dbToUse.select().from(feeGroups).orderBy(feeGroups.displayOrder)
      );
      
      // For each group, fetch its associated fee items through the junction table
      const result = await Promise.all(groups.map(async (group) => {
        const items = await withRetry(() =>
          dbToUse
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
            .orderBy(feeItems.name)
        );
        return { ...group, feeItems: items };
      }));
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching fee groups:", error);
      res.status(500).json({ message: "Failed to fetch fee groups" });
    }
  });

  app.get('/api/fee-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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

  app.post('/api/fee-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { name, description, displayOrder } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "Fee group name is required" });
      }

      const feeGroupData = {
        name,
        description: description || null,
        displayOrder: displayOrder || 0,
        author: req.user?.email || 'System'
      };

      console.log(`Creating fee group - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }
      
      const { feeGroups } = await import("@shared/schema");
      const { withRetry } = await import("./db");
      const [feeGroup] = await withRetry(() => dbToUse.insert(feeGroups).values(feeGroupData).returning());
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
  app.put('/api/fee-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, displayOrder } = req.body;
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
        author: req.user?.email || 'System',
        updatedAt: new Date()
      };

      const { feeGroups } = await import("@shared/schema");
      const [updatedFeeGroup] = await dbToUse.update(feeGroups)
        .set(updateData)
        .where(eq(feeGroups.id, id))
        .returning();
      
      if (!updatedFeeGroup) {
        return res.status(404).json({ message: "Fee group not found" });
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
  app.delete('/api/fee-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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

  // Manage fee group-fee item associations
  app.put('/api/fee-groups/:id/fee-items', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const feeGroupId = parseInt(req.params.id);
      const { feeItemIds } = req.body;
      console.log(`Managing fee group ${feeGroupId} fee items - Database environment: ${req.dbEnv}`, feeItemIds);
      
      if (isNaN(feeGroupId)) {
        return res.status(400).json({ message: "Invalid fee group ID" });
      }

      if (!Array.isArray(feeItemIds)) {
        return res.status(400).json({ message: "Fee item IDs must be an array" });
      }

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ message: "Database connection not available" });
      }

      const { feeGroups, feeItems, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, inArray } = await import("drizzle-orm");
      
      // Verify fee group exists
      const existingFeeGroup = await dbToUse.select().from(feeGroups).where(eq(feeGroups.id, feeGroupId));
      if (existingFeeGroup.length === 0) {
        return res.status(404).json({ message: "Fee group not found" });
      }

      // Verify all fee items exist if any are provided
      if (feeItemIds.length > 0) {
        const existingFeeItems = await dbToUse.select().from(feeItems).where(inArray(feeItems.id, feeItemIds));
        if (existingFeeItems.length !== feeItemIds.length) {
          return res.status(400).json({ message: "One or more fee items not found" });
        }
      }

      const { withRetry } = await import("./db");
      
      // Use transaction for atomic operations with retry
      await withRetry(async () => {
        // Remove all existing associations for this fee group
        await dbToUse.delete(feeGroupFeeItems).where(eq(feeGroupFeeItems.feeGroupId, feeGroupId));

        // Add new associations
        if (feeItemIds.length > 0) {
          const associations = feeItemIds.map((feeItemId: number, index: number) => ({
            feeGroupId,
            feeItemId,
            displayOrder: index,
            isRequired: false,
            createdAt: new Date()
          }));

          await dbToUse.insert(feeGroupFeeItems).values(associations);
        }
      });

      res.json({ 
        message: `Successfully updated fee group associations`,
        feeGroupId,
        associatedFeeItemIds: feeItemIds
      });
    } catch (error: any) {
      console.error("Error managing fee group-fee item associations:", error);
      res.status(500).json({ message: "Failed to manage fee group associations" });
    }
  });

  // Fee Item Groups endpoints
  app.get('/api/fee-item-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const feeGroupId = req.query.feeGroupId;
      
      if (feeGroupId) {
        const feeItemGroups = await envStorage.getFeeItemGroupsByFeeGroup(parseInt(feeGroupId as string));
        res.json(feeItemGroups);
      } else {
        const feeItemGroups = await envStorage.getAllFeeItemGroups();
        res.json(feeItemGroups);
      }
    } catch (error) {
      console.error("Error fetching fee item groups:", error);
      res.status(500).json({ message: "Failed to fetch fee item groups" });
    }
  });

  app.get('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const feeItemGroup = await envStorage.getFeeItemGroupWithItems(id);
      
      if (!feeItemGroup) {
        return res.status(404).json({ message: "Fee item group not found" });
      }
      
      res.json(feeItemGroup);
    } catch (error) {
      console.error("Error fetching fee item group:", error);
      res.status(500).json({ message: "Failed to fetch fee item group" });
    }
  });

  app.post('/api/fee-item-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { feeGroupId, name, description, displayOrder } = req.body;
      
      if (!feeGroupId || !name) {
        return res.status(400).json({ message: "Fee group ID and name are required" });
      }

      const feeItemGroupData = {
        feeGroupId,
        name,
        description: description || null,
        displayOrder: displayOrder || 0,
        author: (req as any).user?.email || 'System'
      };

      const feeItemGroup = await envStorage.createFeeItemGroup(feeItemGroupData);
      res.status(201).json(feeItemGroup);
    } catch (error) {
      console.error("Error creating fee item group:", error);
      res.status(500).json({ message: "Failed to create fee item group" });
    }
  });

  app.put('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const { name, description, displayOrder } = req.body;
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
      
      const feeItemGroup = await envStorage.updateFeeItemGroup(id, updateData);
      
      if (!feeItemGroup) {
        return res.status(404).json({ message: "Fee item group not found" });
      }
      
      res.json(feeItemGroup);
    } catch (error) {
      console.error("Error updating fee item group:", error);
      res.status(500).json({ message: "Failed to update fee item group" });
    }
  });

  app.delete('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const success = await envStorage.deleteFeeItemGroup(id);
      
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
  app.get('/api/campaigns', dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching campaigns - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { campaigns, pricingTypes, acquirers, eq } = await import("@shared/schema");
      
      // Join campaigns with pricing types and acquirers to get full data
      const allCampaigns = await dbToUse
        .select({
          id: campaigns.id,
          name: campaigns.name,
          description: campaigns.description,
          acquirerId: campaigns.acquirerId,
          currency: campaigns.currency,
          equipment: campaigns.equipment,
          isActive: campaigns.isActive,
          isDefault: campaigns.isDefault,
          createdBy: campaigns.createdBy,
          createdAt: campaigns.createdAt,
          updatedAt: campaigns.updatedAt,
          pricingTypeId: campaigns.pricingTypeId,
          pricingType: {
            id: pricingTypes.id,
            name: pricingTypes.name,
            description: pricingTypes.description,
          },
          acquirer: {
            id: acquirers.id,
            name: acquirers.name,
            displayName: acquirers.displayName,
            code: acquirers.code,
            description: acquirers.description,
            isActive: acquirers.isActive,
          }
        })
        .from(campaigns)
        .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
        .leftJoin(acquirers, eq(campaigns.acquirerId, acquirers.id));
      
      console.log(`Found ${allCampaigns.length} campaigns in ${req.dbEnv} database`);
      
      // Fetch templates for each campaign using the dynamic database
      const { campaignApplicationTemplates, acquirerApplicationTemplates } = await import("@shared/schema");
      
      const campaignsWithTemplates = await Promise.all(
        allCampaigns.map(async (campaign) => {
          const result = await dbToUse
            .select({
              // Campaign template fields
              id: campaignApplicationTemplates.id,
              campaignId: campaignApplicationTemplates.campaignId,
              templateId: campaignApplicationTemplates.templateId,
              isPrimary: campaignApplicationTemplates.isPrimary,
              displayOrder: campaignApplicationTemplates.displayOrder,
              // Acquirer template fields (excluding source_pdf_path for compatibility)
              templateName: acquirerApplicationTemplates.templateName,
              templateAcquirerId: acquirerApplicationTemplates.acquirerId,
              templateVersion: acquirerApplicationTemplates.version,
              templateIsActive: acquirerApplicationTemplates.isActive,
              templateFieldConfiguration: acquirerApplicationTemplates.fieldConfiguration,
              templateRequiredFields: acquirerApplicationTemplates.requiredFields,
              templateConditionalFields: acquirerApplicationTemplates.conditionalFields,
              templateAddressGroups: acquirerApplicationTemplates.addressGroups,
              templateSignatureGroups: acquirerApplicationTemplates.signatureGroups,
              templateDisclosureGroups: acquirerApplicationTemplates.disclosureGroups,
            })
            .from(campaignApplicationTemplates)
            .innerJoin(acquirerApplicationTemplates, eq(campaignApplicationTemplates.templateId, acquirerApplicationTemplates.id))
            .where(eq(campaignApplicationTemplates.campaignId, campaign.id))
            .orderBy(campaignApplicationTemplates.displayOrder);
          
          const templates = result.map(row => ({
            id: row.id,
            campaignId: row.campaignId,
            templateId: row.templateId,
            isPrimary: row.isPrimary,
            displayOrder: row.displayOrder,
            template: {
              id: row.templateId,
              templateName: row.templateName,
              acquirerId: row.templateAcquirerId,
              version: row.templateVersion,
              isActive: row.templateIsActive,
              fieldConfiguration: row.templateFieldConfiguration,
              requiredFields: row.templateRequiredFields,
              conditionalFields: row.templateConditionalFields,
              addressGroups: row.templateAddressGroups,
              signatureGroups: row.templateSignatureGroups,
              disclosureGroups: row.templateDisclosureGroups,
            },
          }));
          
          return {
            ...campaign,
            templates: templates
          };
        })
      );
      
      res.json(campaignsWithTemplates);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // Get single campaign by ID with full details
  app.get('/api/campaigns/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const campaignId = parseInt(req.params.id);
      console.log(`Fetching campaign ${campaignId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { campaigns, pricingTypes, acquirers, campaignFeeValues, campaignEquipment, feeItems, feeGroups, equipmentItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get campaign with pricing type and acquirer
      const [campaign] = await dbToUse
        .select({
          id: campaigns.id,
          name: campaigns.name,
          description: campaigns.description,
          acquirerId: campaigns.acquirerId,
          currency: campaigns.currency,
          equipment: campaigns.equipment,
          isActive: campaigns.isActive,
          isDefault: campaigns.isDefault,
          createdBy: campaigns.createdBy,
          createdAt: campaigns.createdAt,
          updatedAt: campaigns.updatedAt,
          pricingTypeId: campaigns.pricingTypeId,
          acquirer: {
            id: acquirers.id,
            name: acquirers.name,
            displayName: acquirers.displayName,
            code: acquirers.code,
            description: acquirers.description,
            isActive: acquirers.isActive,
          },
          pricingType: {
            id: pricingTypes.id,
            name: pricingTypes.name,
            description: pricingTypes.description,
          }
        })
        .from(campaigns)
        .leftJoin(pricingTypes, eq(campaigns.pricingTypeId, pricingTypes.id))
        .leftJoin(acquirers, eq(campaigns.acquirerId, acquirers.id))
        .where(eq(campaigns.id, campaignId))
        .limit(1);
      
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      
      // Get fee values with proper schema structure including fee groups
      // Note: Fee groups are linked through feeGroupFeeItems junction table
      // When feeGroupFeeItemId is null, we fall back to looking up fee groups by fee_item_id
      const { feeGroupFeeItems } = await import("@shared/schema");
      let feeValues: any[] = [];
      try {
        // First, get the basic fee values with fee items
        const feeValuesRaw = await dbToUse
          .select({
            id: campaignFeeValues.id,
            campaignId: campaignFeeValues.campaignId,
            feeItemId: campaignFeeValues.feeItemId,
            feeGroupFeeItemId: campaignFeeValues.feeGroupFeeItemId,
            value: campaignFeeValues.value,
            valueType: campaignFeeValues.valueType,
            createdAt: campaignFeeValues.createdAt,
            updatedAt: campaignFeeValues.updatedAt,
            feeItemId2: feeItems.id,
            feeItemName: feeItems.name,
            feeItemDescription: feeItems.description,
            feeItemDefaultValue: feeItems.defaultValue,
            feeItemValueType: feeItems.valueType,
            // Try to get fee group via feeGroupFeeItemId first
            feeGroupId: feeGroups.id,
            feeGroupName: feeGroups.name,
            feeGroupDescription: feeGroups.description,
          })
          .from(campaignFeeValues)
          .leftJoin(feeItems, eq(campaignFeeValues.feeItemId, feeItems.id))
          .leftJoin(feeGroupFeeItems, eq(campaignFeeValues.feeGroupFeeItemId, feeGroupFeeItems.id))
          .leftJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
          .where(eq(campaignFeeValues.campaignId, campaignId))
          .orderBy(feeItems.name);
        
        // For fee values without fee group (feeGroupFeeItemId is null), look up fee group by fee_item_id
        // Build a map of fee_item_id -> fee_group for fallback lookup
        const feeItemIdsWithoutGroup = feeValuesRaw
          .filter(row => !row.feeGroupId && row.feeItemId)
          .map(row => row.feeItemId);
        
        let feeItemToGroupMap: Map<number, { id: number; name: string; description: string | null }> = new Map();
        
        if (feeItemIdsWithoutGroup.length > 0) {
          const { inArray } = await import("drizzle-orm");
          const fallbackGroups = await dbToUse
            .select({
              feeItemId: feeGroupFeeItems.feeItemId,
              feeGroupId: feeGroups.id,
              feeGroupName: feeGroups.name,
              feeGroupDescription: feeGroups.description,
            })
            .from(feeGroupFeeItems)
            .innerJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
            .where(inArray(feeGroupFeeItems.feeItemId, feeItemIdsWithoutGroup));
          
          // Build map (first match wins if a fee item is in multiple groups)
          for (const row of fallbackGroups) {
            if (!feeItemToGroupMap.has(row.feeItemId)) {
              feeItemToGroupMap.set(row.feeItemId, {
                id: row.feeGroupId,
                name: row.feeGroupName,
                description: row.feeGroupDescription,
              });
            }
          }
        }
        
        // Nest feeGroup under feeItem for consistency with frontend expectations
        feeValues = feeValuesRaw.map(row => {
          // Use the fee group from the join, or fall back to the lookup map
          let feeGroup = row.feeGroupId ? {
            id: row.feeGroupId,
            name: row.feeGroupName,
            description: row.feeGroupDescription,
          } : (row.feeItemId ? feeItemToGroupMap.get(row.feeItemId) : undefined);
          
          return {
            id: row.id,
            campaignId: row.campaignId,
            feeItemId: row.feeItemId,
            feeGroupFeeItemId: row.feeGroupFeeItemId,
            value: row.value,
            valueType: row.valueType,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            feeItem: row.feeItemId2 ? {
              id: row.feeItemId2,
              name: row.feeItemName,
              description: row.feeItemDescription,
              defaultValue: row.feeItemDefaultValue,
              valueType: row.feeItemValueType,
              feeGroup: feeGroup,
            } : undefined,
          };
        });
      } catch (error) {
        console.log(`Error fetching fee values for campaign ${campaignId}:`, error);
        feeValues = [];
      }
      
      // Get equipment associations (handle empty case gracefully)
      let equipmentAssociations: any[] = [];
      try {
        equipmentAssociations = await dbToUse
          .select({
            id: campaignEquipment.id,
            equipmentItemId: campaignEquipment.equipmentItemId,
            isRequired: campaignEquipment.isRequired,
            displayOrder: campaignEquipment.displayOrder,
            equipmentItem: {
              id: equipmentItems.id,
              name: equipmentItems.name,
              description: equipmentItems.description,
            }
          })
          .from(campaignEquipment)
          .leftJoin(equipmentItems, eq(campaignEquipment.equipmentItemId, equipmentItems.id))
          .where(eq(campaignEquipment.campaignId, campaignId))
          .orderBy(campaignEquipment.displayOrder);
      } catch (error) {
        console.log(`No equipment associations found for campaign ${campaignId}:`, error);
        equipmentAssociations = [];
      }
      
      // Get fee groups with item counts for the pricing type (if available)
      // Uses the fee_group_id stored directly in pricing_type_fee_items for accurate counts
      let pricingTypeFeeGroups: any[] = [];
      if (campaign.pricingTypeId) {
        try {
          const { pricingTypeFeeItems } = await import("@shared/schema");
          const { count, isNotNull, and } = await import("drizzle-orm");
          
          // Get fee groups directly from pricingTypeFeeItems using the stored feeGroupId
          pricingTypeFeeGroups = await dbToUse
            .select({
              id: feeGroups.id,
              name: feeGroups.name,
              description: feeGroups.description,
              feeItemsCount: count(pricingTypeFeeItems.id),
            })
            .from(pricingTypeFeeItems)
            .innerJoin(feeGroups, eq(pricingTypeFeeItems.feeGroupId, feeGroups.id))
            .where(and(
              eq(pricingTypeFeeItems.pricingTypeId, campaign.pricingTypeId),
              isNotNull(pricingTypeFeeItems.feeGroupId)
            ))
            .groupBy(feeGroups.id, feeGroups.name, feeGroups.description)
            .orderBy(feeGroups.name);
        } catch (error) {
          console.log(`Error fetching fee groups for pricing type ${campaign.pricingTypeId}:`, error);
          pricingTypeFeeGroups = [];
        }
      }
      
      // Get application count from campaign assignments
      const { campaignAssignments, campaignApplicationTemplates, acquirerApplicationTemplates } = await import("@shared/schema");
      const { count } = await import("drizzle-orm");
      
      let applicationCount = 0;
      try {
        const [countResult] = await dbToUse
          .select({ count: count() })
          .from(campaignAssignments)
          .where(eq(campaignAssignments.campaignId, campaignId));
        applicationCount = countResult?.count || 0;
      } catch (error) {
        console.log(`Error fetching application count for campaign ${campaignId}:`, error);
      }
      
      // Get application templates associated with this campaign
      let applicationTemplates: any[] = [];
      try {
        applicationTemplates = await dbToUse
          .select({
            id: campaignApplicationTemplates.id,
            templateId: campaignApplicationTemplates.templateId,
            isPrimary: campaignApplicationTemplates.isPrimary,
            displayOrder: campaignApplicationTemplates.displayOrder,
            templateName: acquirerApplicationTemplates.templateName,
            templateVersion: acquirerApplicationTemplates.version,
          })
          .from(campaignApplicationTemplates)
          .leftJoin(acquirerApplicationTemplates, eq(campaignApplicationTemplates.templateId, acquirerApplicationTemplates.id))
          .where(eq(campaignApplicationTemplates.campaignId, campaignId))
          .orderBy(campaignApplicationTemplates.displayOrder);
      } catch (error) {
        console.log(`Error fetching application templates for campaign ${campaignId}:`, error);
      }
      
      // Combine all data
      const campaignWithDetails = {
        ...campaign,
        pricingType: campaign.pricingType ? {
          ...campaign.pricingType,
          feeGroups: pricingTypeFeeGroups
        } : null,
        feeValues,
        equipment: equipmentAssociations,
        applicationCount,
        applicationTemplates
      };
      
      console.log(`Found campaign ${campaignId} with ${feeValues.length} fee values and ${equipmentAssociations.length} equipment items in ${req.dbEnv} database`);
      res.json(campaignWithDetails);
    } catch (error) {
      console.error('Error fetching campaign:', error);
      res.status(500).json({ error: 'Failed to fetch campaign' });
    }
  });

  app.post('/api/campaigns', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating campaign - Database environment: ${req.dbEnv}`);
      
      const { feeValues, equipmentIds, ...campaignData } = req.body;
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Get current user from session (server-derived, never from client)
      const session = req.session as any;
      const userId = session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      console.log(`Validating and inserting campaign with fee values:`, { 
        campaignName: campaignData.name, 
        userId, 
        feeValuesCount: feeValues?.length || 0,
        equipmentCount: equipmentIds?.length || 0
      });

      // Use database transaction to ensure atomicity for ALL operations
      const result = await dbToUse.transaction(async (tx) => {
        // Import schemas
        const { campaigns, campaignFeeValues, campaignEquipment, users, feeItems, equipmentItems, feeItemGroups, feeGroups, sql } = await import("@shared/schema");
        
        // 1. Verify user exists in target database
        const [userExists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (!userExists) {
          throw new Error(`User ${userId} not found in ${req.dbEnv} database`);
        }
        
        // 2. Prepare campaign data with server-derived createdBy
        const insertCampaign = {
          ...campaignData,
          createdBy: userId, // Server-derived from authenticated session
        };
        
        // 3. Create the campaign
        const [campaign] = await tx.insert(campaigns).values(insertCampaign).returning();
        console.log(`Created campaign with ID: ${campaign.id} in ${req.dbEnv} database`);
        
        // 4. Insert fee values if provided (with deduplication and validation)
        if (feeValues && feeValues.length > 0) {
          console.log(`Processing ${feeValues.length} fee values for campaign ${campaign.id}`);
          
          // Deduplicate by feeItemId to prevent unique constraint violations
          const uniqueFeeValues = feeValues.reduce((acc: any[], curr: any) => {
            if (!acc.find(item => item.feeItemId === curr.feeItemId)) {
              acc.push(curr);
            }
            return acc;
          }, []);
          
          if (uniqueFeeValues.length !== feeValues.length) {
            console.log(`Deduplicated fee values: ${feeValues.length} → ${uniqueFeeValues.length}`);
          }
          
          // Validate all fee items exist
          const feeItemIds = uniqueFeeValues.map((fv: any) => fv.feeItemId);
          const existingFeeItems = await tx.select({ id: feeItems.id })
            .from(feeItems)
            .where(inArray(feeItems.id, feeItemIds));
          
          if (existingFeeItems.length !== feeItemIds.length) {
            throw new Error("Some fee items do not exist");
          }
          
          // Fetch fee group IDs for each fee item through junction table
          const { feeGroupFeeItems } = await import("@shared/schema");
          const feeItemsWithGroups = await tx
            .select({
              feeItemId: feeGroupFeeItems.feeItemId,
              feeGroupId: feeGroupFeeItems.feeGroupId,
            })
            .from(feeGroupFeeItems)
            .where(inArray(feeGroupFeeItems.feeItemId, feeItemIds));
          
          const feeValueInserts = uniqueFeeValues.map((fv: any) => {
            const feeItemWithGroup = feeItemsWithGroups.find(fig => fig.feeItemId === fv.feeItemId);
            if (!feeItemWithGroup || !feeItemWithGroup.feeGroupId) {
              throw new Error(`Fee group not found for fee item ${fv.feeItemId}`);
            }
            
            return {
              campaignId: campaign.id,
              feeItemId: fv.feeItemId,
              feeGroupId: feeItemWithGroup.feeGroupId,
              value: fv.value || "",
              valueType: fv.valueType || "percentage"
            };
          });
          
          await tx.insert(campaignFeeValues).values(feeValueInserts);
          console.log(`Successfully inserted ${feeValueInserts.length} fee values for campaign ${campaign.id}`);
        }
        
        // 5. Insert equipment associations if provided
        if (equipmentIds && equipmentIds.length > 0) {
          console.log(`Processing ${equipmentIds.length} equipment associations for campaign ${campaign.id}`);
          
          // Validate all equipment items exist
          const existingEquipment = await tx.select({ id: equipmentItems.id })
            .from(equipmentItems)
            .where(inArray(equipmentItems.id, equipmentIds));
          
          if (existingEquipment.length !== equipmentIds.length) {
            throw new Error("Some equipment items do not exist");
          }
          
          const equipmentInserts = equipmentIds.map((equipmentId: number, index: number) => ({
            campaignId: campaign.id,
            equipmentItemId: equipmentId,
            isRequired: false,
            displayOrder: index
          }));
          
          await tx.insert(campaignEquipment).values(equipmentInserts);
          console.log(`Successfully inserted ${equipmentInserts.length} equipment associations for campaign ${campaign.id}`);
        }
        
        return campaign;
      });

      console.log(`Campaign creation completed successfully in ${req.dbEnv} database`);
      res.status(201).json(result);
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      
      // Map database errors to appropriate HTTP status codes
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message?.includes('do not exist')) {
        return res.status(400).json({ error: error.message });
      }
      if (error.code === '23503') { // Foreign key violation
        return res.status(400).json({ error: 'Invalid reference to related data' });
      }
      if (error.code === '23505') { // Unique constraint violation
        return res.status(409).json({ error: 'Duplicate data detected' });
      }
      
      res.status(500).json({ error: 'Failed to create campaign' });
    }
  });

  app.get('/api/campaigns/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const campaign = await envStorage.getCampaignWithDetails(id);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      // Fetch related data including application count and templates
      const dbToUse = req.dynamicDB;
      const { campaignAssignments, campaignApplicationTemplates, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq, count } = await import("drizzle-orm");
      
      const [feeValues, equipment, applicationCountResult, templatesResult] = await Promise.all([
        envStorage.getCampaignFeeValues(id),
        envStorage.getCampaignEquipment(id),
        dbToUse ? dbToUse
          .select({ count: count() })
          .from(campaignAssignments)
          .where(eq(campaignAssignments.campaignId, id)) : Promise.resolve([{ count: 0 }]),
        dbToUse ? dbToUse
          .select({
            id: campaignApplicationTemplates.id,
            templateId: campaignApplicationTemplates.templateId,
            isPrimary: campaignApplicationTemplates.isPrimary,
            displayOrder: campaignApplicationTemplates.displayOrder,
            templateName: acquirerApplicationTemplates.templateName,
            templateVersion: acquirerApplicationTemplates.version,
          })
          .from(campaignApplicationTemplates)
          .leftJoin(acquirerApplicationTemplates, eq(campaignApplicationTemplates.templateId, acquirerApplicationTemplates.id))
          .where(eq(campaignApplicationTemplates.campaignId, id)) : Promise.resolve([])
      ]);
      
      const applicationCount = applicationCountResult[0]?.count || 0;
      
      // Return campaign with complete data
      res.json({
        ...campaign,
        feeValues,
        equipment,
        applicationCount,
        applicationTemplates: templatesResult
      });
    } catch (error) {
      console.error('Error fetching campaign:', error);
      res.status(500).json({ error: 'Failed to fetch campaign' });
    }
  });

  app.post('/api/campaigns/:id/deactivate', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const id = parseInt(req.params.id);
      const campaign = await envStorage.deactivateCampaign(id);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      res.json(campaign);
    } catch (error) {
      console.error('Error deactivating campaign:', error);
      res.status(500).json({ error: 'Failed to deactivate campaign' });
    }
  });

  app.put('/api/campaigns/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { feeValues, equipmentIds, templateIds, pricingTypeIds, ...campaignData } = req.body;
      
      console.log('Campaign update request:', { id, campaignData, feeValues, equipmentIds, templateIds, pricingTypeIds });
      console.log(`Updating campaign ${id} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { campaigns, pricingTypes, campaignFeeValues, campaignEquipment, campaignApplicationTemplates, feeItems, feeGroups, equipmentItems, feeItemGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get current user from session
      const session = req.session as any;
      const userId = session?.userId;
      
      // Handle pricing type ID properly - take the first one if it's an array
      const pricingTypeId = Array.isArray(pricingTypeIds) && pricingTypeIds.length > 0 
        ? pricingTypeIds[0] 
        : campaignData.pricingTypeId;
      
      const updateData = {
        ...campaignData,
        pricingTypeId,
        updatedAt: new Date(),
      };

      // Update the campaign
      const [updatedCampaign] = await dbToUse
        .update(campaigns)
        .set(updateData)
        .where(eq(campaigns.id, id))
        .returning();
      
      if (!updatedCampaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      // Handle fee values update if provided
      if (feeValues && feeValues.length > 0) {
        // Delete existing fee values for this campaign
        await dbToUse
          .delete(campaignFeeValues)
          .where(eq(campaignFeeValues.campaignId, id));
        
        // Insert new fee values using proper fee_group_fee_items relationship
        for (const feeValue of feeValues) {
          console.log(`Processing fee value: feeItemId=${feeValue.feeItemId}, value=${feeValue.value}`);
          
          // Find the correct fee_group_fee_items record for this fee item
          const [feeGroupFeeItem] = await dbToUse
            .select({ 
              id: feeGroupFeeItems.id,
              feeGroupId: feeGroupFeeItems.feeGroupId,
              feeItemId: feeGroupFeeItems.feeItemId
            })
            .from(feeGroupFeeItems)
            .where(eq(feeGroupFeeItems.feeItemId, feeValue.feeItemId))
            .limit(1);
          
          if (feeGroupFeeItem?.id) {
            console.log(`Found fee group fee item association: id=${feeGroupFeeItem.id}, feeGroupId=${feeGroupFeeItem.feeGroupId}, feeItemId=${feeGroupFeeItem.feeItemId}`);
            console.log(`Inserting fee value: campaignId=${id}, feeGroupFeeItemId=${feeGroupFeeItem.id}, value=${feeValue.value}`);
            
            // Use the proper relationship-based approach with backward compatibility
            await dbToUse.insert(campaignFeeValues).values({
              campaignId: id,
              feeItemId: feeValue.feeItemId, // Maintain backward compatibility
              feeGroupFeeItemId: feeGroupFeeItem.id, // New relationship structure
              value: feeValue.value,
              valueType: feeValue.valueType || 'percentage',
            });
            console.log(`Successfully inserted fee value for campaign ${id}`);
          } else {
            console.log(`Warning: No fee_group_fee_items association found for fee item ${feeValue.feeItemId}. Available associations should be checked.`);
          }
        }
      }
      
      // Handle equipment associations if provided
      if (equipmentIds && equipmentIds.length > 0) {
        // Delete existing equipment associations
        await dbToUse
          .delete(campaignEquipment)
          .where(eq(campaignEquipment.campaignId, id));
        
        // Insert new equipment associations
        for (let i = 0; i < equipmentIds.length; i++) {
          await dbToUse.insert(campaignEquipment).values({
            campaignId: id,
            equipmentItemId: equipmentIds[i],
            isRequired: false,
            displayOrder: i,
          });
        }
      }
      
      // Handle template associations if provided
      if (templateIds !== undefined) {
        // Delete existing template associations
        await dbToUse
          .delete(campaignApplicationTemplates)
          .where(eq(campaignApplicationTemplates.campaignId, id));
        
        // Insert new template associations if any are selected
        if (templateIds.length > 0) {
          for (const templateId of templateIds) {
            await dbToUse.insert(campaignApplicationTemplates).values({
              campaignId: id,
              templateId: templateId,
            });
          }
        }
      }
      
      console.log('Campaign updated successfully:', updatedCampaign.id);
      res.json(updatedCampaign);
    } catch (error) {
      console.error('Error updating campaign:', error);
      res.status(500).json({ error: 'Failed to update campaign' });
    }
  });

  // Pricing Types
  app.get('/api/pricing-types', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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

  app.get('/api/pricing-types/:id/fee-items', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching fee items for pricing type ${req.params.id} - Database environment: ${req.dbEnv}`);
      
      const id = parseInt(req.params.id);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, sql } = await import("drizzle-orm");
      
      // First, get the pricing type
      const pricingTypeResult = await dbToUse.select()
        .from(pricingTypes)
        .where(eq(pricingTypes.id, id));
      
      if (pricingTypeResult.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      const pricingType = pricingTypeResult[0];
      
      // STEP 1: Get distinct fee item IDs (prevents JOIN duplication)
      const feeItemIdRows = await dbToUse.select({ 
        feeItemId: pricingTypeFeeItems.feeItemId 
      })
      .from(pricingTypeFeeItems)
      .where(eq(pricingTypeFeeItems.pricingTypeId, id));
      
      const distinctFeeItemIds = [...new Set(feeItemIdRows.map(row => row.feeItemId))];
      console.log(`STEP 1: Found ${distinctFeeItemIds.length} distinct fee items for pricing type ${id}:`, distinctFeeItemIds);
      
      // STEP 2: Fetch the actual fee items by those IDs (if any exist)
      const feeItemsWithGroups = [];
      if (distinctFeeItemIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        
        const feeItemsResult = await dbToUse.select({
          feeItem: feeItems,
          feeGroup: feeGroups
        })
        .from(feeItems)
        .leftJoin(feeGroupFeeItems, eq(feeItems.id, feeGroupFeeItems.feeItemId))
        .leftJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
        .where(inArray(feeItems.id, distinctFeeItemIds));
        
        console.log(`STEP 2: Raw query returned ${feeItemsResult.length} rows`);
        
        // Dedupe results by fee item ID (in case one item belongs to multiple groups)
        const seenIds = new Set();
        for (const row of feeItemsResult) {
          if (!seenIds.has(row.feeItem.id)) {
            seenIds.add(row.feeItem.id);
            feeItemsWithGroups.push({
              feeItemId: row.feeItem.id,
              pricingTypeId: id,
              feeItem: {
                ...row.feeItem,
                feeGroup: row.feeGroup
              }
            });
          }
        }
        console.log(`STEP 2: After deduplication, got ${feeItemsWithGroups.length} unique fee items`);
      }
      
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
  app.get('/api/pricing-types/:id/fee-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching fee items by fee group for pricing type ${req.params.id} - Database environment: ${req.dbEnv}`);
      
      const id = parseInt(req.params.id);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems, feeItems, feeGroups, feeGroupFeeItems } = await import("@shared/schema");
      const { eq, asc, isNotNull, and } = await import("drizzle-orm");
      const { withRetry } = await import("./db");
      
      // First verify the pricing type exists
      const pricingTypeResult = await withRetry(() => 
        dbToUse.select().from(pricingTypes).where(eq(pricingTypes.id, id))
      );
      if (pricingTypeResult.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      // Check if this pricing type has fee_group_id stored (new format)
      const hasStoredFeeGroupIds = await withRetry(() =>
        dbToUse.select()
          .from(pricingTypeFeeItems)
          .where(and(
            eq(pricingTypeFeeItems.pricingTypeId, id),
            isNotNull(pricingTypeFeeItems.feeGroupId)
          ))
          .limit(1)
      );
      
      let pricingTypeFeeItemsRaw;
      
      if (hasStoredFeeGroupIds.length > 0) {
        // New format: Use stored fee_group_id from pricingTypeFeeItems
        console.log('Using stored fee_group_id from pricingTypeFeeItems');
        pricingTypeFeeItemsRaw = await withRetry(() =>
          dbToUse
            .select({
              feeItem: feeItems,
              feeGroup: feeGroups,
              pricingTypeFeeItem: pricingTypeFeeItems
            })
            .from(pricingTypeFeeItems)
            .innerJoin(feeItems, eq(pricingTypeFeeItems.feeItemId, feeItems.id))
            .innerJoin(feeGroups, eq(pricingTypeFeeItems.feeGroupId, feeGroups.id))
            .where(eq(pricingTypeFeeItems.pricingTypeId, id))
            .orderBy(asc(feeGroups.displayOrder), asc(feeItems.displayOrder))
        );
      } else {
        // Legacy format: Join with feeGroupFeeItems (may return items in multiple groups)
        console.log('Using legacy format - joining with feeGroupFeeItems');
        pricingTypeFeeItemsRaw = await withRetry(() =>
          dbToUse
            .select({
              feeItem: feeItems,
              feeGroup: feeGroups,
              pricingTypeFeeItem: pricingTypeFeeItems
            })
            .from(pricingTypeFeeItems)
            .innerJoin(feeItems, eq(pricingTypeFeeItems.feeItemId, feeItems.id))
            .innerJoin(feeGroupFeeItems, eq(feeItems.id, feeGroupFeeItems.feeItemId))
            .innerJoin(feeGroups, eq(feeGroupFeeItems.feeGroupId, feeGroups.id))
            .where(eq(pricingTypeFeeItems.pricingTypeId, id))
            .orderBy(asc(feeGroups.displayOrder), asc(feeItems.displayOrder))
        );
      }
      
      // Group fee items by fee group
      const feeGroupMap = new Map();
      
      pricingTypeFeeItemsRaw.forEach(row => {
        const groupId = row.feeGroup.id;
        if (!feeGroupMap.has(groupId)) {
          feeGroupMap.set(groupId, {
            ...row.feeGroup,
            feeItems: []
          });
        }
        
        // Add fee item with additional properties from the associations
        const feeGroupData = feeGroupMap.get(groupId);
        const existingItem = feeGroupData.feeItems.find((item: any) => item.id === row.feeItem.id);
        if (!existingItem) {
          feeGroupData.feeItems.push({
            ...row.feeItem,
            isRequired: row.pricingTypeFeeItem.isRequired || false
          });
        }
      });
      
      // Convert map to array, sort fee groups by displayOrder, and sort fee items within each group
      const feeGroupsWithActiveItems = Array.from(feeGroupMap.values())
        .filter((group: any) => group.feeItems.length > 0)
        .map((group: any) => ({
          ...group,
          // Sort fee items within each group by displayOrder
          feeItems: group.feeItems.sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
        }))
        // Sort fee groups by displayOrder
        .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0));

      
      const response = {
        pricingType: pricingTypeResult[0],
        feeGroups: feeGroupsWithActiveItems
      };
      
      console.log(`Found ${feeGroupsWithActiveItems.length} fee groups with items for pricing type ${id} in ${req.dbEnv} database`);
      res.json(response);
    } catch (error) {
      console.error('Error fetching pricing type fee groups:', error);
      res.status(500).json({ error: 'Failed to fetch fee groups' });
    }
  });

  app.post('/api/pricing-types', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating pricing type - Database environment: ${req.dbEnv}`);
      
      // Support both old format (feeItemIds) and new format (feeGroupItems with feeGroupId context)
      const { name, description, feeItemIds = [], feeGroupItems = [] } = req.body;
      
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      console.log('Extracted feeItemIds:', feeItemIds, 'Type:', typeof feeItemIds, 'Length:', feeItemIds?.length);
      console.log('Extracted feeGroupItems:', feeGroupItems, 'Length:', feeGroupItems?.length);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems } = await import("@shared/schema");
      const { withRetry } = await import("./db");
      
      // Create the pricing type first
      const [pricingType] = await withRetry(() =>
        dbToUse.insert(pricingTypes).values({
          name,
          description,
          isActive: true,
          author: 'System'
        }).returning()
      );
      
      console.log('Created pricing type:', pricingType);
      
      // Use new feeGroupItems format if provided (with fee group context)
      if (feeGroupItems && Array.isArray(feeGroupItems) && feeGroupItems.length > 0) {
        console.log('Adding fee items with fee group context:', feeGroupItems);
        
        await withRetry(() =>
          dbToUse.insert(pricingTypeFeeItems).values(
            feeGroupItems.map((item: { feeGroupId: number; feeItemId: number }, index: number) => ({
              pricingTypeId: pricingType.id,
              feeItemId: item.feeItemId,
              feeGroupId: item.feeGroupId,
              isRequired: false,
              displayOrder: index + 1
            }))
          )
        );
        
        console.log(`Added ${feeGroupItems.length} fee items with fee group context to pricing type`);
      }
      // Fall back to old format without fee group context
      else if (feeItemIds && Array.isArray(feeItemIds) && feeItemIds.length > 0) {
        console.log('Adding selected fee items to pricing type (legacy format):', feeItemIds);
        
        await withRetry(() =>
          dbToUse.insert(pricingTypeFeeItems).values(
            feeItemIds.map((feeItemId: number, index: number) => ({
              pricingTypeId: pricingType.id,
              feeItemId,
              feeGroupId: null, // No fee group context in legacy format
              isRequired: false,
              displayOrder: index + 1
            }))
          )
        );
        
        console.log(`Added ${feeItemIds.length} fee items to pricing type (legacy)`);
      }
      
      console.log(`Pricing type created successfully in ${req.dbEnv} database`);
      res.status(201).json(pricingType);
    } catch (error) {
      console.error('Error creating pricing type:', error);
      res.status(500).json({ error: 'Failed to create pricing type' });
    }
  });

  app.delete('/api/pricing-types/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid pricing type ID' });
      }
      
      console.log(`Deleting pricing type ${id} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { pricingTypes, pricingTypeFeeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { withRetry } = await import("./db");
      
      // First check if pricing type exists
      const existingPricingType = await withRetry(() =>
        dbToUse.select().from(pricingTypes).where(eq(pricingTypes.id, id))
      );
      
      if (existingPricingType.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      // Check if this pricing type has any associated fee items
      const associatedFeeItems = await withRetry(() =>
        dbToUse.select().from(pricingTypeFeeItems).where(eq(pricingTypeFeeItems.pricingTypeId, id))
      );
      
      console.log(`Found ${associatedFeeItems.length} associated fee items for pricing type ${id}`);
      
      if (associatedFeeItems.length > 0) {
        // First delete all fee item associations
        await withRetry(() =>
          dbToUse.delete(pricingTypeFeeItems).where(eq(pricingTypeFeeItems.pricingTypeId, id))
        );
        console.log(`Deleted ${associatedFeeItems.length} fee item associations`);
      }
      
      // Now delete the pricing type
      const [deletedPricingType] = await withRetry(() =>
        dbToUse.delete(pricingTypes).where(eq(pricingTypes.id, id)).returning()
      );
      
      if (!deletedPricingType) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      console.log(`Successfully deleted pricing type: ${deletedPricingType.name}`);
      res.json({ success: true, message: `Pricing type "${deletedPricingType.name}" has been successfully deleted.` });
    } catch (error) {
      console.error('Error deleting pricing type:', error);
      res.status(500).json({ error: 'Failed to delete pricing type' });
    }
  });

  app.put('/api/pricing-types/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid pricing type ID' });
      }
      
      // Support both old format (feeItemIds) and new format (feeGroupItems with feeGroupId context)
      const { name, description, feeItemIds, feeGroupItems = [] } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      
      console.log(`Updating pricing type ${id} - Database environment: ${req.dbEnv}`);
      console.log('Updating pricing type with data:', {
        id,
        name: name.trim(),
        description: description?.trim() || null,
        feeItemIds: feeItemIds || [],
        feeGroupItems: feeGroupItems || []
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

      // Update fee item associations using a database transaction to prevent race conditions
      console.log('Updating fee item associations in transaction...');
      await dbToUse.transaction(async (tx) => {
        // Delete existing fee item associations
        console.log('Deleting existing fee item associations...');
        await tx.delete(pricingTypeFeeItems)
          .where(eq(pricingTypeFeeItems.pricingTypeId, id));

        // Use new feeGroupItems format if provided (with fee group context)
        if (feeGroupItems && Array.isArray(feeGroupItems) && feeGroupItems.length > 0) {
          console.log('Adding fee items with fee group context:', feeGroupItems);
          
          await tx.insert(pricingTypeFeeItems).values(
            feeGroupItems.map((item: { feeGroupId: number; feeItemId: number }, index: number) => ({
              pricingTypeId: id,
              feeItemId: item.feeItemId,
              feeGroupId: item.feeGroupId,
              isRequired: false,
              displayOrder: index + 1
            }))
          );
          
          console.log(`Added ${feeGroupItems.length} fee items with fee group context to pricing type`);
        }
        // Fall back to old format without fee group context
        else if (feeItemIds && Array.isArray(feeItemIds) && feeItemIds.length > 0) {
          console.log('Adding selected fee items to pricing type (legacy format):', feeItemIds);
          
          await tx.insert(pricingTypeFeeItems).values(
            feeItemIds.map((feeItemId: number, index: number) => ({
              pricingTypeId: id,
              feeItemId,
              feeGroupId: null,
              isRequired: false,
              displayOrder: index + 1
            }))
          );
          
          console.log(`Added ${feeItemIds.length} fee items to pricing type (legacy)`);
        }
      });
      
      console.log('Pricing type update completed successfully');
      res.json(updatedPricingType);
    } catch (error) {
      console.error('Error updating pricing type:', error);
      res.status(500).json({ error: 'Failed to update pricing type' });
    }
  });

  // Duplicate fee groups endpoints removed - using the correct ones with dbEnvironmentMiddleware

  // Acquirer Management API endpoints
  
  // Acquirers
  app.get('/api/acquirers', dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching acquirers - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { acquirers } = await import("@shared/schema");
      
      const allAcquirers = await dbToUse.select().from(acquirers).orderBy(acquirers.name);
      
      console.log(`Found ${allAcquirers.length} acquirers in ${req.dbEnv} database`);
      res.json(allAcquirers);
    } catch (error) {
      console.error('Error fetching acquirers:', error);
      res.status(500).json({ error: 'Failed to fetch acquirers' });
    }
  });

  app.post('/api/acquirers', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating acquirer - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body
      const validated = insertAcquirerSchema.parse(req.body);
      
      const { acquirers } = await import("@shared/schema");
      
      const [newAcquirer] = await dbToUse.insert(acquirers).values(validated).returning();
      
      console.log(`Created acquirer: ${newAcquirer.name} (${newAcquirer.code})`);
      res.status(201).json(newAcquirer);
    } catch (error) {
      console.error('Error creating acquirer:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create acquirer' });
    }
  });

  app.get('/api/acquirers/:id', dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const acquirerId = parseInt(req.params.id);
      console.log(`Fetching acquirer ${acquirerId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get acquirer with its application templates
      const [acquirer] = await dbToUse.select().from(acquirers).where(eq(acquirers.id, acquirerId)).limit(1);
      
      if (!acquirer) {
        return res.status(404).json({ error: "Acquirer not found" });
      }
      
      // Get application templates for this acquirer
      const templates = await dbToUse.select()
        .from(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.acquirerId, acquirerId))
        .orderBy(acquirerApplicationTemplates.templateName);
      
      console.log(`Found acquirer with ${templates.length} templates`);
      res.json({ ...acquirer, templates });
    } catch (error) {
      console.error('Error fetching acquirer:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer' });
    }
  });

  app.put('/api/acquirers/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const acquirerId = parseInt(req.params.id);
      console.log(`Updating acquirer ${acquirerId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body (excluding id)
      const updateData = insertAcquirerSchema.parse(req.body);
      
      const { acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const [updatedAcquirer] = await dbToUse.update(acquirers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(acquirers.id, acquirerId))
        .returning();
      
      if (!updatedAcquirer) {
        return res.status(404).json({ error: "Acquirer not found" });
      }
      
      console.log(`Updated acquirer: ${updatedAcquirer.name} (${updatedAcquirer.code})`);
      res.json(updatedAcquirer);
    } catch (error) {
      console.error('Error updating acquirer:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update acquirer' });
    }
  });

  // =====================================================
  // MCC CODES AND POLICIES (Underwriting)
  // =====================================================
  
  // Get all MCC codes (lookup table)
  app.get('/api/mcc-codes', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { search, category } = req.query;
      console.log(`Fetching MCC codes - Database environment: ${req.dbEnv}, search: ${search}, category: ${category}`);
      
      let mccCodesList;
      if (search || category) {
        mccCodesList = await envStorage.searchMccCodes(
          search as string || '', 
          category as string || undefined
        );
      } else {
        mccCodesList = await envStorage.getAllMccCodes();
      }
      
      res.json(mccCodesList);
    } catch (error) {
      console.error('Error fetching MCC codes:', error);
      res.status(500).json({ error: 'Failed to fetch MCC codes' });
    }
  });

  // Get MCC code categories (distinct list)
  app.get('/api/mcc-codes/categories', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const categories = await envStorage.getMccCategories();
      res.json(categories);
    } catch (error) {
      console.error('Error fetching MCC categories:', error);
      res.status(500).json({ error: 'Failed to fetch MCC categories' });
    }
  });

  // Get single MCC code
  app.get('/api/mcc-codes/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const codeId = parseInt(req.params.id);
      const mccCode = await envStorage.getMccCode(codeId);
      
      if (!mccCode) {
        return res.status(404).json({ error: 'MCC code not found' });
      }
      
      res.json(mccCode);
    } catch (error) {
      console.error('Error fetching MCC code:', error);
      res.status(500).json({ error: 'Failed to fetch MCC code' });
    }
  });

  // Create MCC code
  app.post('/api/mcc-codes', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { code, description, category, riskLevel, isActive } = req.body;
      
      if (!code || !description || !category) {
        return res.status(400).json({ error: 'code, description, and category are required' });
      }
      
      if (code.length !== 4 || !/^\d{4}$/.test(code)) {
        return res.status(400).json({ error: 'MCC code must be exactly 4 digits' });
      }
      
      const existingCode = await envStorage.getMccCodeByCode(code);
      if (existingCode) {
        return res.status(409).json({ error: `MCC code ${code} already exists` });
      }
      
      const newCode = await envStorage.createMccCode({
        code,
        description,
        category,
        riskLevel: riskLevel || 'low',
        isActive: isActive !== false
      });
      
      console.log(`Created MCC code: ${newCode.code} - ${newCode.description}`);
      res.status(201).json(newCode);
    } catch (error) {
      console.error('Error creating MCC code:', error);
      res.status(500).json({ error: 'Failed to create MCC code' });
    }
  });

  // Update MCC code
  app.patch('/api/mcc-codes/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const codeId = parseInt(req.params.id);
      const { code, description, category, riskLevel, isActive } = req.body;
      
      const existingCode = await envStorage.getMccCode(codeId);
      if (!existingCode) {
        return res.status(404).json({ error: 'MCC code not found' });
      }
      
      if (code && code !== existingCode.code) {
        if (code.length !== 4 || !/^\d{4}$/.test(code)) {
          return res.status(400).json({ error: 'MCC code must be exactly 4 digits' });
        }
        const duplicateCode = await envStorage.getMccCodeByCode(code);
        if (duplicateCode) {
          return res.status(409).json({ error: `MCC code ${code} already exists` });
        }
      }
      
      const updates: Record<string, any> = {};
      if (code !== undefined) updates.code = code;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (riskLevel !== undefined) updates.riskLevel = riskLevel;
      if (isActive !== undefined) updates.isActive = isActive;
      
      const updatedCode = await envStorage.updateMccCode(codeId, updates);
      
      console.log(`Updated MCC code: ${updatedCode?.code}`);
      res.json(updatedCode);
    } catch (error) {
      console.error('Error updating MCC code:', error);
      res.status(500).json({ error: 'Failed to update MCC code' });
    }
  });

  // Delete MCC code
  app.delete('/api/mcc-codes/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const codeId = parseInt(req.params.id);
      
      const existingCode = await envStorage.getMccCode(codeId);
      if (!existingCode) {
        return res.status(404).json({ error: 'MCC code not found' });
      }
      
      const deleted = await envStorage.deleteMccCode(codeId);
      
      if (deleted) {
        console.log(`Deleted MCC code: ${existingCode.code}`);
        res.json({ success: true, message: `MCC code ${existingCode.code} deleted` });
      } else {
        res.status(500).json({ error: 'Failed to delete MCC code' });
      }
    } catch (error: any) {
      console.error('Error deleting MCC code:', error);
      if (error.code === '23503') {
        return res.status(409).json({ 
          error: 'Cannot delete MCC code that has associated policies. Delete the policies first.' 
        });
      }
      res.status(500).json({ error: 'Failed to delete MCC code' });
    }
  });

  // Get all MCC policies (with joined MCC code data)
  app.get('/api/mcc-policies', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      console.log(`Fetching MCC policies - Database environment: ${req.dbEnv}`);
      const policies = await envStorage.getAllMccPolicies();
      res.json(policies);
    } catch (error) {
      console.error('Error fetching MCC policies:', error);
      res.status(500).json({ error: 'Failed to fetch MCC policies' });
    }
  });

  // Get single MCC policy
  app.get('/api/mcc-policies/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const policyId = parseInt(req.params.id);
      const policy = await envStorage.getMccPolicy(policyId);
      
      if (!policy) {
        return res.status(404).json({ error: 'MCC policy not found' });
      }
      
      res.json(policy);
    } catch (error) {
      console.error('Error fetching MCC policy:', error);
      res.status(500).json({ error: 'Failed to fetch MCC policy' });
    }
  });

  // Create MCC policy
  app.post('/api/mcc-policies', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { mccCodeId, acquirerId, policyType, riskLevelOverride, notes } = req.body;
      
      // Validate required fields
      if (!mccCodeId || !policyType) {
        return res.status(400).json({ error: 'mccCodeId and policyType are required' });
      }
      
      // Check if MCC code exists
      const mccCode = await envStorage.getMccCode(mccCodeId);
      if (!mccCode) {
        return res.status(404).json({ error: 'MCC code not found' });
      }
      
      // Check for duplicate policy (same MCC code and acquirer)
      const existingPolicy = await envStorage.getMccPolicyByCodeAndAcquirer(mccCodeId, acquirerId || undefined);
      if (existingPolicy) {
        return res.status(409).json({ error: 'A policy already exists for this MCC code and acquirer combination' });
      }
      
      const policy = await envStorage.createMccPolicy({
        mccCodeId,
        acquirerId: acquirerId || null,
        policyType,
        riskLevelOverride: riskLevelOverride || null,
        notes: notes || null,
        createdBy: req.session?.userId || null,
        isActive: true
      });
      
      console.log(`Created MCC policy for code ID ${mccCodeId}: ${policyType}`);
      res.status(201).json(policy);
    } catch (error) {
      console.error('Error creating MCC policy:', error);
      res.status(500).json({ error: 'Failed to create MCC policy' });
    }
  });

  // Update MCC policy
  app.patch('/api/mcc-policies/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const policyId = parseInt(req.params.id);
      const { policyType, riskLevelOverride, notes, isActive } = req.body;
      
      const updates: any = {};
      if (policyType !== undefined) updates.policyType = policyType;
      if (riskLevelOverride !== undefined) updates.riskLevelOverride = riskLevelOverride;
      if (notes !== undefined) updates.notes = notes;
      if (isActive !== undefined) updates.isActive = isActive;
      
      const updatedPolicy = await envStorage.updateMccPolicy(policyId, updates);
      
      if (!updatedPolicy) {
        return res.status(404).json({ error: 'MCC policy not found' });
      }
      
      console.log(`Updated MCC policy ${policyId}`);
      res.json(updatedPolicy);
    } catch (error) {
      console.error('Error updating MCC policy:', error);
      res.status(500).json({ error: 'Failed to update MCC policy' });
    }
  });

  // Delete MCC policy
  app.delete('/api/mcc-policies/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const envStorage = createStorageForRequest(req);
      const policyId = parseInt(req.params.id);
      const success = await envStorage.deleteMccPolicy(policyId);
      
      if (!success) {
        return res.status(404).json({ error: 'MCC policy not found' });
      }
      
      console.log(`Deleted MCC policy ${policyId}`);
      res.json({ message: 'MCC policy deleted successfully' });
    } catch (error) {
      console.error('Error deleting MCC policy:', error);
      res.status(500).json({ error: 'Failed to delete MCC policy' });
    }
  });

  // Acquirer Application Templates
  app.get('/api/acquirer-application-templates', dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const acquirerId = req.query.acquirerId ? parseInt(req.query.acquirerId as string) : null;
      console.log(`Fetching acquirer application templates - Database environment: ${req.dbEnv}, acquirerId filter: ${acquirerId}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { acquirerApplicationTemplates, acquirers } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      
      // Build the query with optional acquirerId filter
      let query = dbToUse.select({
        id: acquirerApplicationTemplates.id,
        acquirerId: acquirerApplicationTemplates.acquirerId,
        templateName: acquirerApplicationTemplates.templateName,
        version: acquirerApplicationTemplates.version,
        isActive: acquirerApplicationTemplates.isActive,
        fieldConfiguration: acquirerApplicationTemplates.fieldConfiguration,
        pdfMappingConfiguration: acquirerApplicationTemplates.pdfMappingConfiguration,
        requiredFields: acquirerApplicationTemplates.requiredFields,
        conditionalFields: acquirerApplicationTemplates.conditionalFields,
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
      .leftJoin(acquirers, eq(acquirerApplicationTemplates.acquirerId, acquirers.id));
      
      // Apply acquirerId filter if provided
      let templates;
      if (acquirerId) {
        templates = await query.where(
          and(
            eq(acquirerApplicationTemplates.acquirerId, acquirerId),
            eq(acquirerApplicationTemplates.isActive, true)
          )
        ).orderBy(acquirerApplicationTemplates.templateName);
      } else {
        templates = await query.orderBy(acquirers.name, acquirerApplicationTemplates.templateName);
      }
      
      console.log(`Found ${templates.length} acquirer application templates in ${req.dbEnv} database`);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching acquirer application templates:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer application templates' });
    }
  });

  app.post('/api/acquirer-application-templates', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating acquirer application template - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body
      const validated = insertAcquirerApplicationTemplateSchema.parse(req.body);
      
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      
      const [newTemplate] = await dbToUse.insert(acquirerApplicationTemplates).values(validated).returning();
      
      console.log(`Created acquirer application template: ${newTemplate.templateName} v${newTemplate.version}`);
      res.status(201).json(newTemplate);
    } catch (error) {
      console.error('Error creating acquirer application template:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create acquirer application template' });
    }
  });

  // Get application counts per template (must be before /:id route)
  app.get('/api/acquirer-application-templates/application-counts', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching application counts per template - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications } = await import("@shared/schema");
      const { count, sql } = await import("drizzle-orm");
      
      // Get application counts grouped by templateId
      const applicationCounts = await dbToUse
        .select({
          templateId: prospectApplications.templateId,
          applicationCount: count()
        })
        .from(prospectApplications)
        .groupBy(prospectApplications.templateId);
      
      // Convert to a map for easy lookup
      const countsMap = applicationCounts.reduce((acc, item) => {
        acc[item.templateId] = item.applicationCount;
        return acc;
      }, {} as Record<number, number>);
      
      console.log(`Found application counts for ${applicationCounts.length} templates in ${req.dbEnv} environment`);
      console.log(`Application counts map:`, countsMap);
      res.json(countsMap);
    } catch (error) {
      console.error('Error fetching application counts:', error);
      res.status(500).json({ error: 'Failed to fetch application counts' });
    }
  });

  app.get('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requireRole(['agent', 'admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      console.log(`Fetching acquirer application template ${templateId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { acquirerApplicationTemplates, acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get template with acquirer information
      const [template] = await dbToUse.select({
        id: acquirerApplicationTemplates.id,
        acquirerId: acquirerApplicationTemplates.acquirerId,
        templateName: acquirerApplicationTemplates.templateName,
        version: acquirerApplicationTemplates.version,
        isActive: acquirerApplicationTemplates.isActive,
        fieldConfiguration: acquirerApplicationTemplates.fieldConfiguration,
        pdfMappingConfiguration: acquirerApplicationTemplates.pdfMappingConfiguration,
        requiredFields: acquirerApplicationTemplates.requiredFields,
        conditionalFields: acquirerApplicationTemplates.conditionalFields,
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
      .where(eq(acquirerApplicationTemplates.id, templateId))
      .limit(1);
      
      if (!template) {
        return res.status(404).json({ error: "Acquirer application template not found" });
      }
      
      console.log(`Found acquirer application template: ${template.templateName} v${template.version}`);
      res.json(template);
    } catch (error) {
      console.error('Error fetching acquirer application template:', error);
      res.status(500).json({ error: 'Failed to fetch acquirer application template' });
    }
  });

  app.put('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      console.log(`Updating acquirer application template ${templateId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body - for updates, make fields optional except for the ones being updated
      const updateSchema = insertAcquirerApplicationTemplateSchema.partial();
      const updateData = updateSchema.parse(req.body);
      
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const [updatedTemplate] = await dbToUse.update(acquirerApplicationTemplates)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(acquirerApplicationTemplates.id, templateId))
        .returning();
      
      if (!updatedTemplate) {
        return res.status(404).json({ error: "Acquirer application template not found" });
      }
      
      console.log(`Updated acquirer application template: ${updatedTemplate.templateName} v${updatedTemplate.version}`);
      res.json(updatedTemplate);
    } catch (error) {
      console.error('Error updating acquirer application template:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update acquirer application template' });
    }
  });

  // DELETE endpoint for Application Templates
  app.delete('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const templateId = parseInt(req.params.id);
      console.log(`🗑️ Deleting acquirer application template ${templateId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { 
        acquirerApplicationTemplates, 
        prospectApplications,
        campaignApplicationTemplates,
        campaignAssignments 
      } = await import("@shared/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      
      // Check if template has any applications
      const applications = await dbToUse
        .select()
        .from(prospectApplications)
        .where(eq(prospectApplications.templateId, templateId))
        .limit(1);
      
      if (applications.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete template with existing applications. Please remove all applications using this template first." 
        });
      }
      
      // Check if template is linked to any campaigns
      const linkedCampaigns = await dbToUse
        .select({ campaignId: campaignApplicationTemplates.campaignId })
        .from(campaignApplicationTemplates)
        .where(eq(campaignApplicationTemplates.templateId, templateId));
      
      if (linkedCampaigns.length > 0) {
        const campaignIds = linkedCampaigns.map(c => c.campaignId);
        
        // Check if any of these campaigns have active prospects assigned
        const activeAssignments = await dbToUse
          .select()
          .from(campaignAssignments)
          .where(
            and(
              inArray(campaignAssignments.campaignId, campaignIds),
              eq(campaignAssignments.isActive, true)
            )
          )
          .limit(1);
        
        if (activeAssignments.length > 0) {
          return res.status(400).json({ 
            error: "Cannot delete template that is assigned to campaigns with active prospects. Please remove the template from campaigns or unassign prospects first." 
          });
        }
      }
      
      // Delete the template
      const [deletedTemplate] = await dbToUse
        .delete(acquirerApplicationTemplates)
        .where(eq(acquirerApplicationTemplates.id, templateId))
        .returning();
      
      if (!deletedTemplate) {
        return res.status(404).json({ error: "Acquirer application template not found" });
      }
      
      console.log(`✅ Deleted acquirer application template: ${deletedTemplate.templateName} v${deletedTemplate.version}`);
      res.json({ success: true, message: "Template deleted successfully" });
    } catch (error) {
      console.error('Error deleting acquirer application template:', error);
      res.status(500).json({ error: 'Failed to delete acquirer application template' });
    }
  });

  // PDF Upload for Application Templates
  app.post('/api/acquirer-application-templates/upload', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), upload.single('pdf'), async (req: any, res: Response) => {
    try {
      console.log(`Creating application template from PDF upload - Database environment: ${req.dbEnv}`);
      
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      if (!req.body.templateData) {
        return res.status(400).json({ error: "Template data is required" });
      }

      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }

      // Parse template data from JSON
      const templateData = JSON.parse(req.body.templateData);
      
      // Validate template data
      const { insertAcquirerApplicationTemplateSchema } = await import("@shared/schema");
      const validatedData = insertAcquirerApplicationTemplateSchema.parse(templateData);

      const { originalname } = req.file;
      const buffer = req.file.buffer;
      
      // Parse the PDF to extract form structure
      const parseResult = await pdfFormParser.parsePDF(buffer);
      
      // Convert PDF fields to template field configuration
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
            pdfFieldIds: field.pdfFieldIds
          }))
        }))
      };

      // Use client-provided required fields, or start with empty array
      // Don't auto-populate from parsed PDF as fallback templates have many fields marked required
      const requiredFields = validatedData.requiredFields || [];

      // Create PDF mapping configuration
      const pdfMappingConfiguration = {
        originalFileName: originalname,
        uploadedAt: new Date().toISOString(),
        totalFields: parseResult.totalFields,
        sectionsMapping: parseResult.sections.map((section: any) => ({
          sectionId: `section_${section.title.toLowerCase().replace(/\s+/g, '_')}`,
          fieldMappings: section.fields.map((field: any) => ({
            fieldId: field.fieldName,
            pdfFieldName: field.pdfFieldId || field.pdfFieldIds?.[0] || field.fieldName,
            pdfFieldIds: field.pdfFieldIds,
            extractionMethod: 'auto'
          }))
        }))
      };

      // Save the original PDF to object storage for rehydration
      let sourcePdfPath: string | null = null;
      try {
        const { objectStorageService } = await import('./objectStorage');
        const safeFileName = originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storageKey = `pdf-templates/acquirer_${validatedData.acquirerId}/${Date.now()}_${safeFileName}`;
        await objectStorageService.saveBuffer(storageKey, buffer, {
          contentType: 'application/pdf',
        });
        sourcePdfPath = storageKey;
        console.log(`Saved source PDF template to: ${sourcePdfPath}`);
      } catch (storageError) {
        console.warn('Failed to save source PDF to object storage:', storageError);
        // Continue without source PDF - rehydration won't be available
      }

      // Create the application template with PDF-derived configuration
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      
      const templateToCreate = {
        ...validatedData,
        fieldConfiguration,
        pdfMappingConfiguration,
        sourcePdfPath,
        requiredFields,
        conditionalFields: validatedData.conditionalFields || {},
        addressGroups: parseResult.addressGroups || [],
        signatureGroups: parseResult.signatureGroups || []
      };

      const [newTemplate] = await dbToUse.insert(acquirerApplicationTemplates)
        .values(templateToCreate)
        .returning();

      console.log(`Created application template from PDF: ${newTemplate.templateName} v${newTemplate.version} with ${parseResult.totalFields} fields`);
      
      res.status(201).json({
        template: newTemplate,
        derivedFields: parseResult.sections,
        totalFields: parseResult.totalFields,
        message: `Successfully created template with ${parseResult.totalFields} fields derived from PDF`
      });
    } catch (error: any) {
      console.error('Error creating application template from PDF:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid template data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create application template from PDF', details: error?.message || 'Unknown error' });
    }
  });

  // Prospect Applications
  app.get('/api/prospect-applications', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const prospectIdParam = req.query.prospectId ? parseInt(req.query.prospectId as string) : null;
      console.log(`Fetching prospect applications - Database environment: ${req.dbEnv}, prospectId filter: ${prospectIdParam}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get prospect applications with acquirer and template data
      let query = dbToUse.select({
        id: prospectApplications.id,
        prospectId: prospectApplications.prospectId,
        acquirerId: prospectApplications.acquirerId,
        templateId: prospectApplications.templateId,
        status: prospectApplications.status,
        applicationData: prospectApplications.applicationData,
        submittedAt: prospectApplications.submittedAt,
        approvedAt: prospectApplications.approvedAt,
        rejectedAt: prospectApplications.rejectedAt,
        rejectionReason: prospectApplications.rejectionReason,
        generatedPdfPath: prospectApplications.generatedPdfPath,
        createdAt: prospectApplications.createdAt,
        updatedAt: prospectApplications.updatedAt,
        acquirer: {
          id: acquirers.id,
          name: acquirers.name,
          displayName: acquirers.displayName,
          code: acquirers.code
        },
        template: {
          id: acquirerApplicationTemplates.id,
          templateName: acquirerApplicationTemplates.templateName,
          version: acquirerApplicationTemplates.version
        }
      })
      .from(prospectApplications)
      .leftJoin(acquirers, eq(prospectApplications.acquirerId, acquirers.id))
      .leftJoin(acquirerApplicationTemplates, eq(prospectApplications.templateId, acquirerApplicationTemplates.id));
      
      let applications;
      if (prospectIdParam) {
        applications = await query
          .where(eq(prospectApplications.prospectId, prospectIdParam))
          .orderBy(prospectApplications.createdAt);
      } else {
        applications = await query.orderBy(prospectApplications.createdAt);
      }
      
      console.log(`Found ${applications.length} prospect applications in ${req.dbEnv} database`);
      res.json(applications);
    } catch (error) {
      console.error('Error fetching prospect applications:', error);
      res.status(500).json({ error: 'Failed to fetch prospect applications' });
    }
  });

  app.post('/api/prospect-applications', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating prospect application - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body
      const validated = insertProspectApplicationSchema.parse(req.body);
      
      const { prospectApplications } = await import("@shared/schema");
      
      const [newApplication] = await dbToUse.insert(prospectApplications).values(validated).returning();
      
      console.log(`Created prospect application for prospect ${newApplication.prospectId}`);
      res.status(201).json(newApplication);
    } catch (error) {
      console.error('Error creating prospect application:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create prospect application' });
    }
  });

  app.get('/api/prospect-applications/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Fetching prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get prospect application with full related data
      const [application] = await dbToUse.select({
        id: prospectApplications.id,
        prospectId: prospectApplications.prospectId,
        acquirerId: prospectApplications.acquirerId,
        templateId: prospectApplications.templateId,
        templateVersion: prospectApplications.templateVersion,
        status: prospectApplications.status,
        applicationData: prospectApplications.applicationData,
        submittedAt: prospectApplications.submittedAt,
        approvedAt: prospectApplications.approvedAt,
        rejectedAt: prospectApplications.rejectedAt,
        rejectionReason: prospectApplications.rejectionReason,
        generatedPdfPath: prospectApplications.generatedPdfPath,
        createdAt: prospectApplications.createdAt,
        updatedAt: prospectApplications.updatedAt,
        prospect: {
          id: merchantProspects.id,
          businessName: merchantProspects.businessName,
          contactFirstName: merchantProspects.contactFirstName,
          contactLastName: merchantProspects.contactLastName,
          contactEmail: merchantProspects.contactEmail,
          contactPhone: merchantProspects.contactPhone,
          status: merchantProspects.status
        },
        acquirer: {
          id: acquirers.id,
          name: acquirers.name,
          displayName: acquirers.displayName,
          code: acquirers.code
        },
        template: {
          id: acquirerApplicationTemplates.id,
          templateName: acquirerApplicationTemplates.templateName,
          version: acquirerApplicationTemplates.version,
          fieldConfiguration: acquirerApplicationTemplates.fieldConfiguration,
          requiredFields: acquirerApplicationTemplates.requiredFields,
          conditionalFields: acquirerApplicationTemplates.conditionalFields
        }
      })
      .from(prospectApplications)
      .leftJoin(merchantProspects, eq(prospectApplications.prospectId, merchantProspects.id))
      .leftJoin(acquirers, eq(prospectApplications.acquirerId, acquirers.id))
      .leftJoin(acquirerApplicationTemplates, eq(prospectApplications.templateId, acquirerApplicationTemplates.id))
      .where(eq(prospectApplications.id, applicationId))
      .limit(1);
      
      if (!application) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      console.log(`Found prospect application: ${application.id} for prospect ${application.prospect?.businessName}`);
      res.json(application);
    } catch (error) {
      console.error('Error fetching prospect application:', error);
      res.status(500).json({ error: 'Failed to fetch prospect application' });
    }
  });

  app.put('/api/prospect-applications/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Updating prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      // Validate request body (excluding id)
      const updateData = insertProspectApplicationSchema.parse(req.body);
      
      const { prospectApplications } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const [updatedApplication] = await dbToUse.update(prospectApplications)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(prospectApplications.id, applicationId))
        .returning();
      
      if (!updatedApplication) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      console.log(`Updated prospect application: ${updatedApplication.id}`);
      res.json(updatedApplication);
    } catch (error) {
      console.error('Error updating prospect application:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update prospect application' });
    }
  });

  // Prospect Application Workflow Endpoints
  
  // Start application (draft → in_progress)
  app.post('/api/prospect-applications/:id/start', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Starting prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, agents } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the application with prospect and agent information to validate ownership
      const [applicationWithProspect] = await dbToUse.select({
        application: prospectApplications,
        prospect: merchantProspects,
        agent: agents
      })
      .from(prospectApplications)
      .leftJoin(merchantProspects, eq(prospectApplications.prospectId, merchantProspects.id))
      .leftJoin(agents, eq(merchantProspects.agentId, agents.id))
      .where(eq(prospectApplications.id, applicationId))
      .limit(1);
      
      if (!applicationWithProspect || !applicationWithProspect.application) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      const currentApp = applicationWithProspect.application;
      const prospect = applicationWithProspect.prospect;
      const assignedAgent = applicationWithProspect.agent;
      
      // Check ownership/authorization: agent can only access their own prospects, admins can access all
      const userRoles = (req.user as any)?.roles || [];
      const isAdmin = userRoles.some((role: string) => ['admin', 'super_admin'].includes(role));
      
      if (!isAdmin) {
        // For agents, verify this application belongs to a prospect assigned to them
        const currentUserId = req.user?.id;
        if (!assignedAgent || assignedAgent.userId !== currentUserId) {
          console.log(`Access denied: User ${currentUserId} attempted to access application for prospect assigned to agent ${assignedAgent?.userId}`);
          return res.status(403).json({ error: "Access denied. You can only modify applications for prospects assigned to you." });
        }
      }
      
      // Validate status transition: only allow draft → in_progress
      if (currentApp.status !== 'draft') {
        return res.status(400).json({ 
          error: `Cannot start application. Current status is '${currentApp.status}', expected 'draft'` 
        });
      }
      
      // Update status to in_progress
      const [updatedApplication] = await dbToUse.update(prospectApplications)
        .set({ 
          status: 'in_progress', 
          updatedAt: new Date() 
        })
        .where(eq(prospectApplications.id, applicationId))
        .returning();
      
      console.log(`Application ${applicationId} status updated to in_progress`);
      res.json(updatedApplication);
      
    } catch (error) {
      console.error('Error starting prospect application:', error);
      res.status(500).json({ error: 'Failed to start application' });
    }
  });

  // Submit application (in_progress → submitted)
  app.post('/api/prospect-applications/:id/submit', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      const { applicationData } = req.body; // Optional updated application data
      console.log(`Submitting prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, agents } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the application with prospect and agent information to validate ownership
      const [applicationWithProspect] = await dbToUse.select({
        application: prospectApplications,
        prospect: merchantProspects,
        agent: agents
      })
      .from(prospectApplications)
      .leftJoin(merchantProspects, eq(prospectApplications.prospectId, merchantProspects.id))
      .leftJoin(agents, eq(merchantProspects.agentId, agents.id))
      .where(eq(prospectApplications.id, applicationId))
      .limit(1);
      
      if (!applicationWithProspect || !applicationWithProspect.application) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      const currentApp = applicationWithProspect.application;
      const prospect = applicationWithProspect.prospect;
      const assignedAgent = applicationWithProspect.agent;
      
      // Check ownership/authorization: agent can only access their own prospects, admins can access all
      const userRoles = (req.user as any)?.roles || [];
      const isAdmin = userRoles.some((role: string) => ['admin', 'super_admin'].includes(role));
      
      if (!isAdmin) {
        // For agents, verify this application belongs to a prospect assigned to them
        const currentUserId = req.user?.id;
        if (!assignedAgent || assignedAgent.userId !== currentUserId) {
          console.log(`Access denied: User ${currentUserId} attempted to access application for prospect assigned to agent ${assignedAgent?.userId}`);
          return res.status(403).json({ error: "Access denied. You can only modify applications for prospects assigned to you." });
        }
      }
      
      // Validate status transition: only allow in_progress → submitted
      if (currentApp.status !== 'in_progress') {
        return res.status(400).json({ 
          error: `Cannot submit application. Current status is '${currentApp.status}', expected 'in_progress'` 
        });
      }
      
      // Process user_account fields if present in the template
      if (applicationData && currentApp.templateId) {
        try {
          const { acquirerApplicationTemplates } = await import("@shared/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          const [template] = await dbToUse.select()
            .from(acquirerApplicationTemplates)
            .where(eqOp(acquirerApplicationTemplates.id, currentApp.templateId))
            .limit(1);
          
          if (template && template.fieldConfiguration) {
            const config = typeof template.fieldConfiguration === 'string' 
              ? JSON.parse(template.fieldConfiguration)
              : template.fieldConfiguration;
            
            // Scan all sections for user_account fields
            for (const section of (config.sections || [])) {
              for (const field of (section.fields || [])) {
                if (field.type === 'user_account' && applicationData[field.id]) {
                  try {
                    const { createUserFromFormField } = await import('./services/userAccountService');
                    const userAccountData = applicationData[field.id];
                    const validationData = typeof field.validation === 'string' 
                      ? JSON.parse(field.validation)
                      : field.validation;
                    const userAccountConfig = validationData?.userAccount;
                    
                    if (userAccountConfig) {
                      const userId = await createUserFromFormField(
                        userAccountData,
                        userAccountConfig,
                        dbToUse
                      );
                      console.log(`Created user account ${userId} from field ${field.id}`);
                    }
                  } catch (userError: any) {
                    console.error(`Error creating user account from field ${field.id}:`, userError);
                    // Check for specific errors
                    if (userError.name === 'DuplicateEmailError' || userError.name === 'DuplicateUsernameError') {
                      return res.status(400).json({ error: userError.message });
                    }
                    // Log other errors but continue submission
                    console.error('User account creation failed, continuing with submission');
                  }
                }
              }
            }
          }
        } catch (templateError) {
          console.error('Error processing user account fields:', templateError);
          // Continue with submission even if user account creation fails
        }
      }
      
      // Update application with submission
      const updateData: any = {
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date()
      };
      
      // Include application data if provided
      if (applicationData) {
        updateData.applicationData = applicationData;
      }
      
      const [updatedApplication] = await dbToUse.update(prospectApplications)
        .set(updateData)
        .where(eq(prospectApplications.id, applicationId))
        .returning();
      
      console.log(`Application ${applicationId} status updated to submitted`);
      
      // Generate rehydrated PDF after successful submission
      let generatedPdfPath: string | null = null;
      try {
        const { acquirerApplicationTemplates } = await import("@shared/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        const [template] = await dbToUse.select()
          .from(acquirerApplicationTemplates)
          .where(eqOp(acquirerApplicationTemplates.id, currentApp.templateId))
          .limit(1);
        
        if (template && template.sourcePdfPath && template.pdfMappingConfiguration) {
          const { pdfRehydrator } = await import('./pdfRehydrator');
          const finalApplicationData = applicationData || (currentApp.applicationData as Record<string, any>) || {};
          const pdfMappingConfig = typeof template.pdfMappingConfiguration === 'string'
            ? JSON.parse(template.pdfMappingConfiguration)
            : template.pdfMappingConfiguration;
          const signatureGroups = typeof template.signatureGroups === 'string'
            ? JSON.parse(template.signatureGroups)
            : (template.signatureGroups || []);
          
          console.log(`[PDF Generation] Starting PDF rehydration for application ${applicationId}`);
          
          // Generate the filled PDF
          const pdfBuffer = await pdfRehydrator.rehydratePdf(
            template.sourcePdfPath,
            finalApplicationData,
            pdfMappingConfig,
            signatureGroups
          );
          
          // Get agent user ID if available
          const agentUserId = assignedAgent?.userId?.toString();
          const prospectUserId = prospect?.userId?.toString();
          
          // Save the rehydrated PDF with proper ACLs
          generatedPdfPath = await pdfRehydrator.saveRehydratedPdf(
            pdfBuffer,
            currentApp.prospectId,
            applicationId,
            prospectUserId,
            agentUserId
          );
          
          // Update application with PDF path
          await dbToUse.update(prospectApplications)
            .set({ generatedPdfPath })
            .where(eq(prospectApplications.id, applicationId));
          
          console.log(`[PDF Generation] Successfully generated and saved PDF: ${generatedPdfPath}`);
        } else {
          console.log(`[PDF Generation] Skipped - no source PDF template available for template ${currentApp.templateId}`);
        }
      } catch (pdfError) {
        console.error('[PDF Generation] Error generating rehydrated PDF:', pdfError);
        // Don't fail the submission if PDF generation fails
      }
      
      // Create underwriting workflow ticket for the submitted application
      let underwritingTicket = null;
      try {
        const { createWorkflowEngine } = await import('./services/workflow-engine');
        const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
        
        // Use request-scoped storage for dynamic DB environment
        const requestStorage = createStorageForRequest(req);
        const engine = createWorkflowEngine(requestStorage);
        registerUnderwritingHandlers(engine);
        
        underwritingTicket = await engine.createTicket({
          workflowCode: 'merchant_underwriting',
          entityType: 'prospect_application',
          entityId: applicationId,
          createdById: req.user?.id || 'system',
          priority: 'normal',
          metadata: {
            prospectId: currentApp.prospectId,
            prospectEmail: prospect?.email,
            applicationTemplateId: currentApp.templateId,
            submittedAt: new Date().toISOString()
          }
        });
        
        console.log(`[Underwriting] Created workflow ticket ${underwritingTicket.ticketNumber} for application ${applicationId}`);
      } catch (workflowError) {
        console.error('[Underwriting] Error creating workflow ticket:', workflowError);
        // Don't fail the submission if workflow creation fails
      }
      
      res.json({ ...updatedApplication, generatedPdfPath, underwritingTicketNumber: underwritingTicket?.ticketNumber });
      
    } catch (error) {
      console.error('Error submitting prospect application:', error);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  });

  // Approve application (submitted → approved)
  app.post('/api/prospect-applications/:id/approve', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Approving prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the current application to validate status - admin-only endpoint, no ownership check needed
      const [currentApp] = await dbToUse.select()
        .from(prospectApplications)
        .where(eq(prospectApplications.id, applicationId))
        .limit(1);
      
      if (!currentApp) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      // Validate status transition: only allow submitted → approved
      if (currentApp.status !== 'submitted') {
        return res.status(400).json({ 
          error: `Cannot approve application. Current status is '${currentApp.status}', expected 'submitted'` 
        });
      }
      
      const { merchantProspects, users } = await import("@shared/schema");
      
      // Get the prospect associated with this application before starting transaction
      const [prospect] = await dbToUse.select()
        .from(merchantProspects)
        .where(eq(merchantProspects.id, currentApp.prospectId))
        .limit(1);
      
      if (!prospect) {
        return res.status(404).json({ error: "Prospect not found for this application" });
      }
      
      // Perform all updates in a transaction to ensure atomicity
      const updatedApplication = await dbToUse.transaction(async (tx) => {
        // 1. Update application status to approved
        const [appResult] = await tx.update(prospectApplications)
          .set({ 
            status: 'approved',
            approvedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(prospectApplications.id, applicationId))
          .returning();
        
        console.log(`Application ${applicationId} status updated to approved`);
        
        // 2. Convert prospect to merchant if they have a user account
        if (prospect.userId) {
          console.log(`Converting prospect ${prospect.id} to merchant (userId: ${prospect.userId})`);
          
          // Update user role from 'prospect' to 'merchant'
          await tx.update(users)
            .set({ role: 'merchant' })
            .where(eq(users.id, prospect.userId));
          
          console.log(`User ${prospect.userId} role updated to merchant`);
        } else {
          console.log(`Prospect ${prospect.id} does not have a user account, skipping user conversion`);
        }
        
        // 3. Update prospect status to 'approved'
        await tx.update(merchantProspects)
          .set({ status: 'approved' })
          .where(eq(merchantProspects.id, prospect.id));
        
        console.log(`Prospect ${prospect.id} status updated to approved`);
        
        return appResult;
      });
      
      console.log(`Successfully completed approval and conversion for application ${applicationId}`);
      res.json(updatedApplication);
      
    } catch (error) {
      console.error('Error approving prospect application:', error);
      res.status(500).json({ error: 'Failed to approve application' });
    }
  });

  // Reject application (submitted → rejected)
  app.post('/api/prospect-applications/:id/reject', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      const { rejectionReason } = req.body;
      console.log(`Rejecting prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the current application to validate status - admin-only endpoint, no ownership check needed
      const [currentApp] = await dbToUse.select()
        .from(prospectApplications)
        .where(eq(prospectApplications.id, applicationId))
        .limit(1);
      
      if (!currentApp) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      // Validate status transition: only allow submitted → rejected
      if (currentApp.status !== 'submitted') {
        return res.status(400).json({ 
          error: `Cannot reject application. Current status is '${currentApp.status}', expected 'submitted'` 
        });
      }
      
      // Update status to rejected
      const [updatedApplication] = await dbToUse.update(prospectApplications)
        .set({ 
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: rejectionReason || null,
          updatedAt: new Date()
        })
        .where(eq(prospectApplications.id, applicationId))
        .returning();
      
      console.log(`Application ${applicationId} status updated to rejected`);
      res.json(updatedApplication);
      
    } catch (error) {
      console.error('Error rejecting prospect application:', error);
      res.status(500).json({ error: 'Failed to reject application' });
    }
  });

  // Fee Items API endpoints
  app.get('/api/fee-items', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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

  app.post('/api/fee-items', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating fee item - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { feeItems } = await import("@shared/schema");
      const feeItemData = {
        ...req.body,
        author: req.user?.email || 'System'
      };
      
      const [feeItem] = await dbToUse.insert(feeItems).values(feeItemData).returning();
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

  app.put('/api/fee-items/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      console.log(`Updating fee item ${id} - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { feeItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const updateData = {
        ...req.body,
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
  app.delete('/api/fee-items/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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
  app.get("/api/campaigns", requireRole(['agent', 'admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const campaigns = await req.storage!.getAllCampaigns();
      
      // Fetch templates for each campaign
      const campaignsWithTemplates = await Promise.all(
        campaigns.map(async (campaign) => {
          const templates = await req.storage!.getCampaignTemplates(campaign.id);
          return {
            ...campaign,
            templates: templates
          };
        })
      );
      
      res.json(campaignsWithTemplates);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.post("/api/campaigns", requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const { equipmentIds = [], feeValues = [], templateIds = [], ...campaignData } = req.body;
      const campaign = await req.storage!.createCampaign(campaignData, feeValues, equipmentIds, templateIds);
      res.status(201).json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  app.post("/api/campaigns/:id/deactivate", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      res.json({ success: true, message: "Campaign deactivated successfully" });
    } catch (error) {
      console.error("Error deactivating campaign:", error);
      res.status(500).json({ message: "Failed to deactivate campaign" });
    }
  });

  app.get("/api/campaigns/:id/equipment", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const equipment = await req.storage!.getCampaignEquipment(id);
      res.json(equipment);
    } catch (error) {
      console.error("Error fetching campaign equipment:", error);
      res.status(500).json({ message: "Failed to fetch campaign equipment" });
    }
  });

  app.get("/api/campaigns/:id/templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const templates = await req.storage!.getCampaignTemplates(id);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching campaign templates:", error);
      res.status(500).json({ message: "Failed to fetch campaign templates" });
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

  app.post("/api/equipment-items", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      console.log(`Creating equipment item - Database environment: ${req.dbEnv}`);
      
      // Use the request-specific database connection (critical for environment isolation)
      const { getRequestDB } = await import("./dbMiddleware");
      const dbToUse = getRequestDB(req);
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { insertEquipmentItemSchema, equipmentItems } = await import("@shared/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      const validated = insertEquipmentItemSchema.parse(req.body);
      
      // Duplicate prevention: check for existing item with same name (case-insensitive)
      const normalizedName = validated.name.toLowerCase().trim();
      const existingItem = await dbToUse.select()
        .from(equipmentItems)
        .where(sql`LOWER(TRIM(${equipmentItems.name})) = ${normalizedName}`)
        .limit(1);
      
      if (existingItem.length > 0) {
        console.log(`Duplicate equipment item prevented in ${req.dbEnv} database: "${validated.name}"`);
        return res.status(409).json({ 
          message: `Equipment item "${validated.name}" already exists. Please use a different name.`,
          existingItem: existingItem[0]
        });
      }
      
      const [equipmentItem] = await dbToUse.insert(equipmentItems).values(validated).returning();
      console.log(`✅ Created equipment item in ${req.dbEnv} database:`, equipmentItem);
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error creating equipment item:', error);
      res.status(500).json({ message: 'Failed to create equipment item' });
    }
  });

  app.put("/api/equipment-items/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      console.log(`Updating equipment item - Database environment: ${req.dbEnv}`);
      
      // Use the request-specific database connection (critical for environment isolation)
      const { getRequestDB } = await import("./dbMiddleware");
      const dbToUse = getRequestDB(req);
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { insertEquipmentItemSchema, equipmentItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const id = parseInt(req.params.id);
      const validated = insertEquipmentItemSchema.partial().parse(req.body);
      
      const [equipmentItem] = await dbToUse.update(equipmentItems)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(equipmentItems.id, id))
        .returning();
      
      if (!equipmentItem) {
        return res.status(404).json({ message: 'Equipment item not found' });
      }
      
      console.log(`✅ Updated equipment item in ${req.dbEnv} database:`, equipmentItem);
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error updating equipment item:', error);
      res.status(500).json({ message: 'Failed to update equipment item' });
    }
  });

  app.delete("/api/equipment-items/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      console.log(`Deleting equipment item - Database environment: ${req.dbEnv}`);
      
      // Use the request-specific database connection (critical for environment isolation)
      const { getRequestDB } = await import("./dbMiddleware");
      const dbToUse = getRequestDB(req);
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { equipmentItems } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const id = parseInt(req.params.id);
      
      const deletedRows = await dbToUse.delete(equipmentItems)
        .where(eq(equipmentItems.id, id))
        .returning();
      
      if (deletedRows.length === 0) {
        return res.status(404).json({ message: 'Equipment item not found' });
      }
      
      console.log(`✅ Deleted equipment item from ${req.dbEnv} database:`, deletedRows[0]);
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
  app.get("/api/admin/api-keys", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const apiKeys = await req.storage!.getAllApiKeys();
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
  app.post("/api/admin/api-keys", requireRole(['admin', 'super_admin']), async (req: any, res) => {
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

      const apiKey = await req.storage!.createApiKey(apiKeyData);

      // Return the full key only once
      res.status(201).json({
        ...apiKey,
        keySecret: undefined, // Don't include hashed secret
        fullKey, // Only returned on creation
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "API key name already exists" });
      }
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // Update API key
  app.patch("/api/admin/api-keys/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, organizationName, contactEmail, permissions, rateLimit, isActive, expiresAt } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (organizationName !== undefined) updateData.organizationName = organizationName;
      if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
      if (permissions !== undefined) updateData.permissions = permissions;
      if (rateLimit !== undefined) updateData.rateLimit = rateLimit;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

      const apiKey = await req.storage!.updateApiKey(id, updateData);
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
  app.delete("/api/admin/api-keys/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await req.storage!.deleteApiKey(id);
      
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
  app.get("/api/admin/api-keys/:id/usage", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const timeRange = req.query.timeRange as string || '24h';
      
      const stats = await req.storage!.getApiUsageStats(id, timeRange);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching API usage stats:", error);
      res.status(500).json({ message: "Failed to fetch API usage statistics" });
    }
  });

  // Get API request logs
  app.get("/api/admin/api-logs", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const apiKeyId = req.query.apiKeyId ? parseInt(req.query.apiKeyId as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      
      const logs = await req.storage!.getApiRequestLogs(apiKeyId, limit);
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
      const merchants = await req.storage!.getAllMerchants();
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
      const merchant = await req.storage!.getMerchant(id);
      
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

  app.post('/api/v1/merchants', requireApiPermission('merchants:write'), async (req: any, res) => {
    try {
      const result = insertMerchantSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: 'Validation error',
          message: 'Invalid merchant data',
          details: result.error.errors 
        });
      }

      const merchant = await req.storage!.createMerchant(result.data);
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
      const agents = await req.storage!.getAllAgents();
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
      const agent = await req.storage!.getAgent(id);
      
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
      const transactions = await req.storage!.getAllTransactions();
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions via API:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch transactions' 
      });
    }
  });

  app.post('/api/v1/transactions', requireApiPermission('transactions:write'), async (req: any, res) => {
    try {
      const result = insertTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: 'Validation error',
          message: 'Invalid transaction data',
          details: result.error.errors 
        });
      }

      const transaction = await req.storage!.createTransaction(result.data);
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

  // Email Wrappers
  // Get all email wrappers
  app.get("/api/admin/email-wrappers", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const wrappers = await req.storage!.getAllEmailWrappers();
      res.json(wrappers);
    } catch (error) {
      console.error("Error fetching email wrappers:", error);
      res.status(500).json({ message: "Failed to fetch email wrappers" });
    }
  });

  // Get single email wrapper
  app.get("/api/admin/email-wrappers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const wrapper = await req.storage!.getEmailWrapper(id);
      
      if (!wrapper) {
        return res.status(404).json({ message: "Email wrapper not found" });
      }
      
      res.json(wrapper);
    } catch (error) {
      console.error("Error fetching email wrapper:", error);
      res.status(500).json({ message: "Failed to fetch email wrapper" });
    }
  });

  // Create email wrapper
  app.post("/api/admin/email-wrappers", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertEmailWrapperSchema } = await import("@shared/schema");
      const result = insertEmailWrapperSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email wrapper data", 
          errors: result.error.errors 
        });
      }

      const wrapper = await req.storage!.createEmailWrapper(result.data);
      res.status(201).json(wrapper);
    } catch (error) {
      console.error("Error creating email wrapper:", error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "Email wrapper name already exists" });
      }
      res.status(500).json({ message: "Failed to create email wrapper" });
    }
  });

  // Update email wrapper
  app.put("/api/admin/email-wrappers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertEmailWrapperSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const result = insertEmailWrapperSchema.partial().safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email wrapper data", 
          errors: result.error.errors 
        });
      }

      const wrapper = await req.storage!.updateEmailWrapper(id, result.data);
      
      if (!wrapper) {
        return res.status(404).json({ message: "Email wrapper not found" });
      }
      
      res.json(wrapper);
    } catch (error) {
      console.error("Error updating email wrapper:", error);
      if (error.code === '23505') {
        return res.status(400).json({ message: "Email wrapper name already exists" });
      }
      res.status(500).json({ message: "Failed to update email wrapper" });
    }
  });

  // Delete email wrapper
  app.delete("/api/admin/email-wrappers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await req.storage!.deleteEmailWrapper(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Email wrapper not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting email wrapper:", error);
      res.status(500).json({ message: "Failed to delete email wrapper" });
    }
  });

  // ============================================================================
  // EMAIL TEMPLATES (DEPRECATED - Use /api/admin/action-templates/type/email instead)
  // ============================================================================
  // These routes are deprecated as of the unified action templates migration.
  // Email templates are now managed as action templates with actionType='email'.
  // Kept temporarily for backward compatibility but will be removed in future version.
  
  // Get all email templates
  // @deprecated Use GET /api/admin/action-templates/type/email instead
  app.get("/api/admin/email-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      // Fetch action templates with type 'email'
      const actionTemplates = await req.storage!.getActionTemplatesByType('email');
      
      // Transform to email template format for UI compatibility
      const emailTemplates = actionTemplates.map(at => ({
        id: at.id,
        name: at.name,
        description: at.description,
        subject: at.config.subject || '',
        htmlContent: at.config.htmlContent || '',
        textContent: at.config.textContent,
        variables: at.variables,
        category: at.category,
        isActive: at.isActive,
        useWrapper: at.config.useWrapper,
        wrapperType: at.config.wrapperType,
        headerGradient: at.config.headerGradient,
        headerSubtitle: at.config.headerSubtitle,
        ctaButtonText: at.config.ctaButtonText,
        ctaButtonUrl: at.config.ctaButtonUrl,
        ctaButtonColor: at.config.ctaButtonColor,
        customFooter: at.config.customFooter,
        createdAt: at.createdAt,
        updatedAt: at.updatedAt,
      }));
      
      res.json(emailTemplates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // Public endpoint for email templates (development bypass)
  app.get("/api/email-templates", async (req, res) => {
    try {
      const templates = await req.storage!.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  // Get single email template
  // @deprecated Use GET /api/admin/action-templates/:id instead
  app.get("/api/admin/email-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const actionTemplate = await req.storage!.getActionTemplate(id);
      
      if (!actionTemplate || actionTemplate.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      // Transform to email template format
      const emailTemplate = {
        id: actionTemplate.id,
        name: actionTemplate.name,
        description: actionTemplate.description,
        subject: actionTemplate.config.subject || '',
        htmlContent: actionTemplate.config.htmlContent || '',
        textContent: actionTemplate.config.textContent,
        variables: actionTemplate.variables,
        category: actionTemplate.category,
        isActive: actionTemplate.isActive,
        useWrapper: actionTemplate.config.useWrapper,
        wrapperType: actionTemplate.config.wrapperType,
        headerGradient: actionTemplate.config.headerGradient,
        headerSubtitle: actionTemplate.config.headerSubtitle,
        ctaButtonText: actionTemplate.config.ctaButtonText,
        ctaButtonUrl: actionTemplate.config.ctaButtonUrl,
        ctaButtonColor: actionTemplate.config.ctaButtonColor,
        customFooter: actionTemplate.config.customFooter,
        createdAt: actionTemplate.createdAt,
        updatedAt: actionTemplate.updatedAt,
      };
      
      res.json(emailTemplate);
    } catch (error) {
      console.error("Error fetching email template:", error);
      res.status(500).json({ message: "Failed to fetch email template" });
    }
  });

  // Create email template (saved as action template with type 'email')
  // @deprecated Use POST /api/admin/action-templates instead
  app.post("/api/admin/email-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertEmailTemplateSchema } = await import("@shared/schema");
      const result = insertEmailTemplateSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email template data", 
          errors: result.error.errors 
        });
      }

      // Create as action template with type 'email' so it's available for trigger actions
      const actionTemplate = await req.storage!.createActionTemplate({
        name: result.data.name,
        description: result.data.description || '',
        actionType: 'email',
        category: result.data.category || 'general',
        config: {
          subject: result.data.subject,
          htmlContent: result.data.htmlContent,
          textContent: result.data.textContent,
          useWrapper: result.data.useWrapper,
          wrapperType: result.data.wrapperType,
          headerGradient: result.data.headerGradient,
          headerSubtitle: result.data.headerSubtitle,
          ctaButtonText: result.data.ctaButtonText,
          ctaButtonUrl: result.data.ctaButtonUrl,
          ctaButtonColor: result.data.ctaButtonColor,
          customFooter: result.data.customFooter,
        },
        variables: result.data.variables || {},
        isActive: result.data.isActive ?? true,
        version: 1,
      });
      
      // Return in email template format for UI compatibility
      res.status(201).json({
        id: actionTemplate.id,
        name: actionTemplate.name,
        description: actionTemplate.description,
        subject: actionTemplate.config.subject,
        htmlContent: actionTemplate.config.htmlContent,
        textContent: actionTemplate.config.textContent,
        variables: actionTemplate.variables,
        category: actionTemplate.category,
        isActive: actionTemplate.isActive,
        useWrapper: actionTemplate.config.useWrapper,
        wrapperType: actionTemplate.config.wrapperType,
        headerGradient: actionTemplate.config.headerGradient,
        headerSubtitle: actionTemplate.config.headerSubtitle,
        ctaButtonText: actionTemplate.config.ctaButtonText,
        ctaButtonUrl: actionTemplate.config.ctaButtonUrl,
        ctaButtonColor: actionTemplate.config.ctaButtonColor,
        customFooter: actionTemplate.config.customFooter,
        createdAt: actionTemplate.createdAt,
        updatedAt: actionTemplate.updatedAt,
      });
    } catch (error) {
      console.error("Error creating email template:", error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "Email template name already exists" });
      }
      res.status(500).json({ message: "Failed to create email template" });
    }
  });

  // Update email template (updates action template with type 'email')
  // @deprecated Use PUT /api/admin/action-templates/:id instead
  app.put("/api/admin/email-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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

      // Build the update object for action template
      const updates: any = {};
      if (result.data.name) updates.name = result.data.name;
      if (result.data.description !== undefined) updates.description = result.data.description;
      if (result.data.category !== undefined) updates.category = result.data.category;
      if (result.data.isActive !== undefined) updates.isActive = result.data.isActive;
      
      // Build config updates
      const existing = await req.storage!.getActionTemplate(id);
      if (!existing || existing.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      const configUpdates: any = { ...existing.config };
      if (result.data.subject) configUpdates.subject = result.data.subject;
      if (result.data.htmlContent) configUpdates.htmlContent = result.data.htmlContent;
      if (result.data.textContent !== undefined) configUpdates.textContent = result.data.textContent;
      if (result.data.useWrapper !== undefined) configUpdates.useWrapper = result.data.useWrapper;
      if (result.data.wrapperType !== undefined) configUpdates.wrapperType = result.data.wrapperType;
      if (result.data.headerGradient !== undefined) configUpdates.headerGradient = result.data.headerGradient;
      if (result.data.headerSubtitle !== undefined) configUpdates.headerSubtitle = result.data.headerSubtitle;
      if (result.data.ctaButtonText !== undefined) configUpdates.ctaButtonText = result.data.ctaButtonText;
      if (result.data.ctaButtonUrl !== undefined) configUpdates.ctaButtonUrl = result.data.ctaButtonUrl;
      if (result.data.ctaButtonColor !== undefined) configUpdates.ctaButtonColor = result.data.ctaButtonColor;
      if (result.data.customFooter !== undefined) configUpdates.customFooter = result.data.customFooter;
      
      updates.config = configUpdates;
      if (result.data.variables !== undefined) updates.variables = result.data.variables;
      
      const actionTemplate = await req.storage!.updateActionTemplate(id, updates);
      
      if (!actionTemplate) {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      // Return in email template format for UI compatibility
      res.json({
        id: actionTemplate.id,
        name: actionTemplate.name,
        description: actionTemplate.description,
        subject: actionTemplate.config.subject,
        htmlContent: actionTemplate.config.htmlContent,
        textContent: actionTemplate.config.textContent,
        variables: actionTemplate.variables,
        category: actionTemplate.category,
        isActive: actionTemplate.isActive,
        useWrapper: actionTemplate.config.useWrapper,
        wrapperType: actionTemplate.config.wrapperType,
        headerGradient: actionTemplate.config.headerGradient,
        headerSubtitle: actionTemplate.config.headerSubtitle,
        ctaButtonText: actionTemplate.config.ctaButtonText,
        ctaButtonUrl: actionTemplate.config.ctaButtonUrl,
        ctaButtonColor: actionTemplate.config.ctaButtonColor,
        customFooter: actionTemplate.config.customFooter,
        createdAt: actionTemplate.createdAt,
        updatedAt: actionTemplate.updatedAt,
      });
    } catch (error) {
      console.error("Error updating email template:", error);
      res.status(500).json({ message: "Failed to update email template" });
    }
  });

  // Delete email template (deletes from action_templates)
  // @deprecated Use DELETE /api/admin/action-templates/:id instead
  app.delete("/api/admin/email-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Verify it's an email type action template before deleting
      const template = await req.storage!.getActionTemplate(id);
      if (!template || template.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      const success = await req.storage!.deleteActionTemplate(id);
      
      if (!success) {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting email template:", error);
      res.status(500).json({ message: "Failed to delete email template" });
    }
  });

  // Send test email with template
  app.post("/api/admin/email-templates/:id/test", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { email } = req.body;
      
      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }
      
      // Get template from action_templates
      const actionTemplate = await req.storage!.getActionTemplate(id);
      if (!actionTemplate || actionTemplate.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      // Extract email config from action template
      const emailConfig = actionTemplate.config;
      
      // Import email wrapper utility
      const { applyEmailWrapper } = await import("./emailTemplateWrapper");
      
      // Apply wrapper if configured (keeping placeholders intact)
      let htmlContent = emailConfig.htmlContent || '';
      if (emailConfig.useWrapper) {
        htmlContent = applyEmailWrapper({
          subject: emailConfig.subject || '',
          htmlContent: emailConfig.htmlContent || '',
          useWrapper: emailConfig.useWrapper,
          wrapperType: emailConfig.wrapperType || 'notification',
          headerSubtitle: emailConfig.headerSubtitle,
          ctaButtonText: emailConfig.ctaButtonText,
          ctaButtonUrl: emailConfig.ctaButtonUrl,
          headerGradient: emailConfig.headerGradient,
          ctaButtonColor: emailConfig.ctaButtonColor,
          customFooter: emailConfig.customFooter
        }, {}); // Empty variables object to preserve placeholders
      }
      
      // Send email using SendGrid
      const mailService = (await import('@sendgrid/mail')).default;
      mailService.setApiKey(process.env.SENDGRID_API_KEY!);
      
      await mailService.send({
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@charrg.com',
        subject: `[TEST] ${emailConfig.subject || actionTemplate.name}`,
        html: htmlContent
        // Don't send text version for test emails - always show HTML wrapper
      });
      
      res.json({ 
        success: true, 
        message: `Test email sent to ${email}` 
      });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ 
        message: "Failed to send test email",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get available trigger events
  app.get("/api/admin/trigger-events", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { TRIGGER_EVENTS } = await import("@shared/schema");
      res.json(TRIGGER_EVENTS);
    } catch (error) {
      console.error("Error fetching trigger events:", error);
      res.status(500).json({ message: "Failed to fetch trigger events" });
    }
  });

  // Get all email triggers
  app.get("/api/admin/email-triggers", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const triggers = await req.storage!.getAllEmailTriggers();
      res.json(triggers);
    } catch (error) {
      console.error("Error fetching email triggers:", error);
      res.status(500).json({ message: "Failed to fetch email triggers" });
    }
  });

  // Create email trigger
  app.post("/api/admin/email-triggers", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertEmailTriggerSchema } = await import("@shared/schema");
      const result = insertEmailTriggerSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid email trigger data", 
          errors: result.error.errors 
        });
      }

      const trigger = await req.storage!.createEmailTrigger(result.data);
      res.status(201).json(trigger);
    } catch (error) {
      console.error("Error creating email trigger:", error);
      res.status(500).json({ message: "Failed to create email trigger" });
    }
  });

  // Update email trigger
  app.put("/api/admin/email-triggers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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

      const trigger = await req.storage!.updateEmailTrigger(id, result.data);
      
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
  app.delete("/api/admin/email-triggers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await req.storage!.deleteEmailTrigger(id);
      
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
  app.get("/api/admin/email-activity", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const filters: any = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.templateId) filters.templateId = parseInt(req.query.templateId as string);
      if (req.query.recipientEmail) filters.recipientEmail = req.query.recipientEmail as string;
      
      const activity = await req.storage!.getEmailActivity(limit, filters);
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
      
      const activity = await req.storage!.getEmailActivity(limit, filters);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching email activity:", error);
      res.status(500).json({ message: "Failed to fetch email activity" });
    }
  });

  // Get email activity statistics
  app.get("/api/admin/email-stats", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const stats = await req.storage!.getEmailActivityStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching email statistics:", error);
      res.status(500).json({ message: "Failed to fetch email statistics" });
    }
  });

  // ============================================================================
  // ACTION TEMPLATE API ENDPOINTS - Admin Only
  // ============================================================================

  // Get all action templates
  app.get("/api/admin/action-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const templates = await req.storage!.getAllActionTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching action templates:", error);
      res.status(500).json({ message: "Failed to fetch action templates" });
    }
  });

  // Get action templates by type
  app.get("/api/admin/action-templates/type/:actionType", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const templates = await req.storage!.getActionTemplatesByType(req.params.actionType);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching action templates by type:", error);
      res.status(500).json({ message: "Failed to fetch action templates" });
    }
  });

  // Get single action template
  app.get("/api/admin/action-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await req.storage!.getActionTemplate(id);
      
      if (!template) {
        return res.status(404).json({ message: "Action template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error fetching action template:", error);
      res.status(500).json({ message: "Failed to fetch action template" });
    }
  });

  // Create action template
  app.post("/api/admin/action-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertActionTemplateSchema } = await import("@shared/schema");
      const result = insertActionTemplateSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid action template data", 
          errors: result.error.errors 
        });
      }

      const template = await req.storage!.createActionTemplate(result.data);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating action template:", error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "Action template name already exists" });
      }
      res.status(500).json({ message: "Failed to create action template" });
    }
  });

  // Update action template
  app.put("/api/admin/action-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertActionTemplateSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const result = insertActionTemplateSchema.partial().safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid action template data", 
          errors: result.error.errors 
        });
      }

      const template = await req.storage!.updateActionTemplate(id, result.data);
      
      if (!template) {
        return res.status(404).json({ message: "Action template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error updating action template:", error);
      res.status(500).json({ message: "Failed to update action template" });
    }
  });

  // Delete action template
  app.delete("/api/admin/action-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await req.storage!.deleteActionTemplate(id);
      
      if (!success) {
        return res.status(404).json({ message: "Action template not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting action template:", error);
      res.status(500).json({ message: "Failed to delete action template" });
    }
  });

  // Get template usage (which triggers use this template)
  app.get("/api/admin/action-templates/:id/usage", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const usage = await req.storage!.getActionTemplateUsage(id);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching action template usage:", error);
      res.status(500).json({ message: "Failed to fetch action template usage" });
    }
  });

  // Get all template usage
  app.get("/api/admin/action-templates-usage", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const usage = await req.storage!.getAllActionTemplateUsage();
      res.json(usage);
    } catch (error) {
      console.error("Error fetching action template usage:", error);
      res.status(500).json({ message: "Failed to fetch action template usage" });
    }
  });

  // ============================================================================
  // PUBLIC ACTION TEMPLATE ENDPOINTS
  // ============================================================================

  // Get all action templates (public - authenticated users)
  app.get("/api/action-templates", isAuthenticated, async (req, res) => {
    try {
      const templates = await req.storage!.getAllActionTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching action templates:", error);
      res.status(500).json({ message: "Failed to fetch action templates" });
    }
  });

  // Get all template usage (public - authenticated users)
  app.get("/api/action-templates/usage", isAuthenticated, async (req, res) => {
    try {
      const usage = await req.storage!.getAllActionTemplateUsage();
      res.json(usage);
    } catch (error) {
      console.error("Error fetching action template usage:", error);
      res.status(500).json({ message: "Failed to fetch action template usage" });
    }
  });

  // Create action template (admin only)
  app.post("/api/action-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const template = await req.storage!.createActionTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating action template:", error);
      res.status(500).json({ message: "Failed to create action template" });
    }
  });

  // Update action template (admin only)
  app.patch("/api/action-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await req.storage!.updateActionTemplate(id, req.body);
      
      if (!template) {
        return res.status(404).json({ message: "Action template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error updating action template:", error);
      res.status(500).json({ message: "Failed to update action template" });
    }
  });

  // Delete action template (admin only)
  app.delete("/api/action-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if template is in use
      const usage = await req.storage!.getActionTemplateUsage(id);
      if (usage && usage.length > 0) {
        return res.status(400).json({ 
          message: "Cannot delete template that is in use by triggers",
          usage 
        });
      }
      
      const deleted = await req.storage!.deleteActionTemplate(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Action template not found" });
      }
      
      res.json({ message: "Action template deleted successfully" });
    } catch (error) {
      console.error("Error deleting action template:", error);
      res.status(500).json({ message: "Failed to delete action template" });
    }
  });

  // Send test email with action template
  app.post("/api/action-templates/:id/test", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { recipientEmail } = req.body;
      
      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!recipientEmail || !emailRegex.test(recipientEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }
      
      // Get template from action_templates
      const actionTemplate = await req.storage!.getActionTemplate(id);
      if (!actionTemplate || actionTemplate.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      // Extract email config from action template
      const emailConfig = actionTemplate.config;
      
      // Import email wrapper utility
      const { applyEmailWrapper } = await import("./emailTemplateWrapper");
      
      // Prepare HTML content with wrapper if enabled
      let htmlContent = emailConfig.htmlContent || '';
      if (emailConfig.useWrapper !== false) {
        htmlContent = applyEmailWrapper({
          subject: emailConfig.subject || actionTemplate.name,
          htmlContent: emailConfig.htmlContent || '',
          textContent: emailConfig.textContent,
          useWrapper: true,
          wrapperType: emailConfig.wrapperType || 'notification',
          headerSubtitle: emailConfig.headerSubtitle,
          headerGradient: emailConfig.headerGradient,
          ctaButtonText: emailConfig.ctaButtonText,
          ctaButtonUrl: emailConfig.ctaButtonUrl,
          ctaButtonColor: emailConfig.ctaButtonColor,
          customFooter: emailConfig.customFooter
        }, {}); // Empty variables object to preserve placeholders
      }
      
      // Send email using SendGrid
      const mailService = (await import('@sendgrid/mail')).default;
      mailService.setApiKey(process.env.SENDGRID_API_KEY!);
      
      await mailService.send({
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@charrg.com',
        subject: `[TEST] ${emailConfig.subject || actionTemplate.name}`,
        html: htmlContent
      });
      
      res.json({ 
        success: true, 
        message: `Test email sent to ${recipientEmail}` 
      });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ 
        message: "Failed to send test email",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================================================
  // TRIGGER CATALOG API ENDPOINTS - Admin Only
  // ============================================================================

  // Get all triggers with action counts
  app.get("/api/admin/trigger-catalog", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const db = getDynamicDatabase(req.session.dbEnvironment || 'development');
      
      // Get triggers with action counts
      const triggers = await db.execute(sql`
        SELECT 
          tc.*,
          COUNT(ta.id) as action_count
        FROM trigger_catalog tc
        LEFT JOIN trigger_actions ta ON tc.id = ta.trigger_id
        GROUP BY tc.id
        ORDER BY tc.created_at DESC
      `);
      
      res.json(triggers.rows.map((row: any) => ({
        id: row.id,
        triggerKey: row.trigger_key,
        name: row.name,
        description: row.description,
        category: row.category,
        contextSchema: row.context_schema,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        actionCount: parseInt(row.action_count) || 0
      })));
    } catch (error) {
      console.error("Error fetching trigger catalog:", error);
      res.status(500).json({ message: "Failed to fetch trigger catalog" });
    }
  });

  // Get single trigger
  app.get("/api/admin/trigger-catalog/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trigger = await req.storage!.getTriggerCatalog(id);
      
      if (!trigger) {
        return res.status(404).json({ message: "Trigger not found" });
      }
      
      res.json(trigger);
    } catch (error) {
      console.error("Error fetching trigger:", error);
      res.status(500).json({ message: "Failed to fetch trigger" });
    }
  });

  // Create trigger
  app.post("/api/admin/trigger-catalog", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertTriggerCatalogSchema } = await import("@shared/schema");
      const result = insertTriggerCatalogSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: "Invalid trigger data", errors: result.error.errors });
      }
      
      const trigger = await req.storage!.createTriggerCatalog(result.data);
      res.status(201).json(trigger);
    } catch (error) {
      console.error("Error creating trigger:", error);
      res.status(500).json({ message: "Failed to create trigger" });
    }
  });

  // Update trigger
  app.put("/api/admin/trigger-catalog/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trigger = await req.storage!.updateTriggerCatalog(id, req.body);
      
      if (!trigger) {
        return res.status(404).json({ message: "Trigger not found" });
      }
      
      res.json(trigger);
    } catch (error) {
      console.error("Error updating trigger:", error);
      res.status(500).json({ message: "Failed to update trigger" });
    }
  });

  // Delete trigger
  app.delete("/api/admin/trigger-catalog/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await req.storage!.deleteTriggerCatalog(id);
      
      if (!success) {
        return res.status(404).json({ message: "Trigger not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting trigger:", error);
      res.status(500).json({ message: "Failed to delete trigger" });
    }
  });

  // ============================================================================
  // TRIGGER ACTIONS API ENDPOINTS - Admin Only
  // ============================================================================

  // Get actions for a trigger
  app.get("/api/admin/trigger-catalog/:triggerId/actions", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const triggerId = parseInt(req.params.triggerId);
      const actions = await req.storage!.getTriggerActions(triggerId);
      res.json(actions);
    } catch (error) {
      console.error("Error fetching trigger actions:", error);
      res.status(500).json({ message: "Failed to fetch trigger actions" });
    }
  });

  // Create trigger action (link action template to trigger)
  app.post("/api/admin/trigger-actions", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { insertTriggerActionSchema } = await import("@shared/schema");
      const result = insertTriggerActionSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: "Invalid trigger action data", errors: result.error.errors });
      }
      
      const action = await req.storage!.createTriggerAction(result.data);
      res.status(201).json(action);
    } catch (error) {
      console.error("Error creating trigger action:", error);
      res.status(500).json({ message: "Failed to create trigger action" });
    }
  });

  // Update trigger action
  app.put("/api/admin/trigger-actions/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const action = await req.storage!.updateTriggerAction(id, req.body);
      
      if (!action) {
        return res.status(404).json({ message: "Trigger action not found" });
      }
      
      res.json(action);
    } catch (error) {
      console.error("Error updating trigger action:", error);
      res.status(500).json({ message: "Failed to update trigger action" });
    }
  });

  // Delete trigger action
  app.delete("/api/admin/trigger-actions/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await req.storage!.deleteTriggerAction(id);
      
      if (!success) {
        return res.status(404).json({ message: "Trigger action not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting trigger action:", error);
      res.status(500).json({ message: "Failed to delete trigger action" });
    }
  });

  // ============================================================================
  // ACTION ACTIVITY API ENDPOINTS - Admin Only
  // ============================================================================

  // Get action activity statistics
  app.get("/api/admin/action-activity/stats", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const db = getDynamicDatabase(req.session.dbEnvironment || 'development');
      
      // Get activity statistics
      const stats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_sent,
          SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) as delivered,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM action_activity
      `);
      
      const row = stats.rows[0] as any;
      const totalSent = parseInt(row.total_sent) || 0;
      const delivered = parseInt(row.delivered) || 0;
      const failed = parseInt(row.failed) || 0;
      
      res.json({
        totalSent,
        delivered,
        failed,
        pending: parseInt(row.pending) || 0,
        deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0,
        failureRate: totalSent > 0 ? Math.round((failed / totalSent) * 100) : 0
      });
    } catch (error) {
      console.error("Error fetching action activity stats:", error);
      res.status(500).json({ message: "Failed to fetch activity statistics" });
    }
  });

  // Get recent action activity
  app.get("/api/admin/action-activity/recent", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const db = getDynamicDatabase(req.session.dbEnvironment || 'development');
      
      // Get recent activity with template names
      const activity = await db.execute(sql`
        SELECT 
          aa.id,
          aa.action_type,
          aa.status,
          aa.recipient,
          aa.executed_at,
          at.name as template_name
        FROM action_activity aa
        LEFT JOIN action_templates at ON aa.action_template_id = at.id
        ORDER BY aa.executed_at DESC
        LIMIT ${limit}
      `);
      
      res.json(activity.rows.map((row: any) => ({
        id: row.id,
        actionType: row.action_type,
        status: row.status,
        recipient: row.recipient,
        executedAt: row.executed_at,
        templateName: row.template_name || 'Unknown Template'
      })));
    } catch (error) {
      console.error("Error fetching recent action activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  // ============================================================================
  // EMAIL CONFIGURATION & TESTING ENDPOINTS
  // ============================================================================

  // Get email configuration
  app.get("/api/email-config", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      res.json({
        fromEmail: process.env.SENDGRID_FROM_EMAIL || 'Not configured',
        provider: 'SendGrid',
        isConfigured: !!process.env.SENDGRID_API_KEY && !!process.env.SENDGRID_FROM_EMAIL
      });
    } catch (error) {
      console.error("Error fetching email config:", error);
      res.status(500).json({ message: "Failed to fetch email configuration" });
    }
  });

  // Send test email
  app.post("/api/test-email", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const { templateType, recipientEmail, firstName, lastName } = req.body;

      if (!recipientEmail) {
        return res.status(400).json({ error: "Recipient email is required" });
      }

      const { EmailService } = await import("./emailService");
      const emailService = new EmailService();
      const dbEnv = req.session?.dbEnvironment || 'development';

      let success = false;
      
      switch (templateType) {
        case 'prospect-validation':
          success = await emailService.sendProspectValidationEmail({
            firstName: firstName || 'Test',
            lastName: lastName || 'User',
            email: recipientEmail,
            validationToken: 'test-token-' + Date.now(),
            agentName: 'Test Agent',
            dbEnv
          });
          break;
          
        case 'signature-request':
          success = await emailService.sendSignatureRequestEmail({
            ownerName: `${firstName || 'Test'} ${lastName || 'User'}`,
            ownerEmail: recipientEmail,
            companyName: 'Test Company LLC',
            ownershipPercentage: '25',
            signatureToken: 'test-signature-' + Date.now(),
            requesterName: 'Test Requester',
            agentName: 'Test Agent',
            dbEnv
          });
          break;
          
        case 'application-submission':
          success = await emailService.sendApplicationSubmissionNotification({
            companyName: 'Test Company LLC',
            applicantName: `${firstName || 'Test'} ${lastName || 'User'}`,
            applicantEmail: recipientEmail,
            agentName: 'Test Agent',
            agentEmail: 'agent@example.com',
            submissionDate: new Date().toLocaleDateString(),
            applicationToken: 'test-app-' + Date.now(),
            dbEnv
          });
          break;
          
        case 'password-reset':
          success = await emailService.sendPasswordResetEmail({
            email: recipientEmail,
            resetToken: 'test-reset-' + Date.now(),
            dbEnv
          });
          break;
          
        default:
          return res.status(400).json({ error: "Invalid template type" });
      }

      if (success) {
        res.json({ 
          success: true, 
          message: `Test email sent to ${recipientEmail}`,
          templateType,
          note: 'Test emails contain dummy data and temporary tokens. Links may not work as they reference non-existent records.'
        });
      } else {
        throw new Error("Email service returned false");
      }
    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({ 
        error: error.message || "Failed to send test email",
        details: error.toString()
      });
    }
  });

  // ============================================================================
  // SENDGRID WEBHOOK ENDPOINTS
  // ============================================================================

  // SendGrid Event Webhook - receives email events (delivered, opened, bounced, etc.)
  app.post("/api/webhooks/sendgrid", dbEnvironmentMiddleware, async (req: RequestWithDB, res: Response) => {
    try {
      const events = req.body;
      
      if (!Array.isArray(events)) {
        return res.status(400).json({ message: "Invalid webhook payload" });
      }

      console.log(`Received ${events.length} SendGrid webhook events`);

      const dbToUse = req.dynamicDB || getDynamicDatabase('development');

      for (const event of events) {
        const { email, event: eventType, timestamp } = event;
        
        if (!email || !eventType) {
          console.warn('Skipping event with missing email or eventType:', event);
          continue;
        }

        console.log(`Processing ${eventType} event for ${email}`);

        try {
          await req.storage!.updateEmailActivityByWebhook(
            email,
            eventType,
            timestamp ? new Date(timestamp * 1000) : new Date(),
            dbToUse
          );
        } catch (error) {
          console.error(`Failed to process ${eventType} event for ${email}:`, error);
        }
      }

      res.status(200).json({ success: true, processed: events.length });
    } catch (error) {
      console.error("Error processing SendGrid webhook:", error);
      res.status(500).json({ message: "Failed to process webhook" });
    }
  });

  // ============================================================================
  // DASHBOARD API ENDPOINTS
  // ============================================================================

  // Import and use dashboard routes
  const { dashboardRouter } = await import("./routes/dashboard");
  app.use("/api/dashboard", dashboardRouter);

  // ============================================================================
  // SECURITY & COMPLIANCE API ENDPOINTS 
  // ============================================================================

  // Get audit logs
  app.get("/api/audit-logs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const auditLogs = await req.storage!.getAuditLogs(limit);
      res.json(auditLogs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // ============================================================================
  // PDF GENERATION API ENDPOINTS
  // ============================================================================
  
  // Generate PDF for a prospect application
  app.post('/api/prospect-applications/:id/generate-pdf', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Generating PDF for prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, agents, acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the complete application data with all relationships
      const [applicationData] = await dbToUse.select({
        application: prospectApplications,
        prospect: merchantProspects,
        agent: agents,
        acquirer: acquirers,
        template: acquirerApplicationTemplates
      })
      .from(prospectApplications)
      .leftJoin(merchantProspects, eq(prospectApplications.prospectId, merchantProspects.id))
      .leftJoin(agents, eq(merchantProspects.agentId, agents.id))
      .leftJoin(acquirers, eq(prospectApplications.acquirerId, acquirers.id))
      .leftJoin(acquirerApplicationTemplates, eq(prospectApplications.templateId, acquirerApplicationTemplates.id))
      .where(eq(prospectApplications.id, applicationId))
      .limit(1);
      
      if (!applicationData || !applicationData.application) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      const { application, prospect, agent, acquirer, template } = applicationData;
      
      // Check ownership/authorization (same as workflow endpoints)
      const userRoles = (req.user as any)?.roles || [];
      const isAdmin = userRoles.some((role: string) => ['admin', 'super_admin'].includes(role));
      
      if (!isAdmin) {
        const currentUserId = req.user?.id;
        if (!agent || agent.userId !== currentUserId) {
          console.log(`Access denied: User ${currentUserId} attempted to generate PDF for prospect assigned to agent ${agent?.userId}`);
          return res.status(403).json({ error: "Access denied. You can only generate PDFs for prospects assigned to you." });
        }
      }
      
      if (!acquirer || !template) {
        return res.status(400).json({ error: "Missing acquirer or template information" });
      }
      
      // Generate the PDF using the dynamic PDF generator
      const { DynamicPDFGenerator } = await import("./dynamicPdfGenerator");
      const pdfGenerator = new DynamicPDFGenerator();
      
      const prospectWithAgent = {
        ...prospect!,
        agent: agent
      };
      
      const pdfBuffer = await pdfGenerator.generateApplicationPDF(
        application,
        template,
        prospectWithAgent,
        acquirer
      );
      
      // Generate filename and save path
      const filename = `${acquirer.name.replace(/[^a-zA-Z0-9]/g, '_')}_${prospect!.firstName}_${prospect!.lastName}_Application.pdf`;
      const relativePath = `pdfs/${applicationId}_${Date.now()}.pdf`;
      const fullPath = `public/${relativePath}`;
      
      // Ensure the pdfs directory exists
      const fs = await import("fs");
      const path = await import("path");
      const pdfDir = path.dirname(fullPath);
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }
      
      // Save the PDF file
      fs.writeFileSync(fullPath, pdfBuffer);
      
      // Update the application record with the generated PDF path
      await dbToUse.update(prospectApplications)
        .set({ 
          generatedPdfPath: relativePath,
          updatedAt: new Date()
        })
        .where(eq(prospectApplications.id, applicationId));
      
      console.log(`PDF generated successfully for application ${applicationId}: ${relativePath}`);
      
      res.json({
        success: true,
        filename,
        pdfPath: relativePath,
        downloadUrl: `/api/prospect-applications/${applicationId}/download-pdf`
      });
      
    } catch (error) {
      console.error('PDF generation error:', error);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  // Download PDF for a prospect application
  app.get('/api/prospect-applications/:id/download-pdf', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'agent']), async (req: RequestWithDB, res: Response) => {
    try {
      const applicationId = parseInt(req.params.id);
      console.log(`Downloading PDF for prospect application ${applicationId} - Database environment: ${req.dbEnv}`);
      
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, agents, acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get the application with prospect and agent information for ownership check
      const [applicationData] = await dbToUse.select({
        application: prospectApplications,
        prospect: merchantProspects,
        agent: agents,
        acquirer: acquirers
      })
      .from(prospectApplications)
      .leftJoin(merchantProspects, eq(prospectApplications.prospectId, merchantProspects.id))
      .leftJoin(agents, eq(merchantProspects.agentId, agents.id))
      .leftJoin(acquirers, eq(prospectApplications.acquirerId, acquirers.id))
      .where(eq(prospectApplications.id, applicationId))
      .limit(1);
      
      if (!applicationData || !applicationData.application) {
        return res.status(404).json({ error: "Prospect application not found" });
      }
      
      const { application, prospect, agent, acquirer } = applicationData;
      
      // Check ownership/authorization
      const userRoles = (req.user as any)?.roles || [];
      const isAdmin = userRoles.some((role: string) => ['admin', 'super_admin'].includes(role));
      
      if (!isAdmin) {
        const currentUserId = req.user?.id;
        if (!agent || agent.userId !== currentUserId) {
          console.log(`Access denied: User ${currentUserId} attempted to download PDF for prospect assigned to agent ${agent?.userId}`);
          return res.status(403).json({ error: "Access denied. You can only download PDFs for prospects assigned to you." });
        }
      }
      
      // Check if PDF exists
      if (!application.generatedPdfPath) {
        return res.status(404).json({ error: "PDF not generated yet. Please generate the PDF first." });
      }
      
      // Generate download filename
      const filename = `${acquirer?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Application'}_${prospect!.firstName}_${prospect!.lastName}_Application.pdf`;
      
      // Check if this is an object storage path (applications/ prefix) or local path
      if (application.generatedPdfPath.startsWith('applications/')) {
        // Object storage path - use objectStorageService
        try {
          const { objectStorageService } = await import('./objectStorage');
          const downloadUrl = await objectStorageService.getDownloadUrl(application.generatedPdfPath, {
            userId: req.user?.id?.toString()
          });
          
          // Redirect to signed download URL
          console.log(`PDF download redirecting to signed URL for application ${applicationId}`);
          return res.redirect(downloadUrl);
        } catch (storageError) {
          console.error('Object storage download error:', storageError);
          return res.status(404).json({ error: "PDF file not found in storage. Please regenerate the PDF." });
        }
      } else {
        // Legacy file system path
        const path = await import("path");
        const fs = await import("fs");
        const fullPath = path.join(process.cwd(), 'public', application.generatedPdfPath);
        
        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: "PDF file not found. Please regenerate the PDF." });
        }
        
        // Send the file
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.sendFile(fullPath);
        
        console.log(`PDF downloaded successfully for application ${applicationId}`);
      }
      
    } catch (error) {
      console.error('PDF download error:', error);
      res.status(500).json({ error: 'Failed to download PDF' });
    }
  });

  // MCC (Merchant Category Code) API endpoints
  app.get('/api/mcc/search', async (req: RequestWithDB, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: 'Query parameter q is required' });
      }

      const mcc = await import('mcc');
      const query = q.toLowerCase().trim();
      
      // Get all MCC codes and search through descriptions
      const allMCCs = mcc.all || [];
      const suggestions = allMCCs
        .filter((code: any) => {
          const description = (code.edited_description || code.description || '').toLowerCase();
          const combined = (code.combined_description || '').toLowerCase();
          return description.includes(query) || combined.includes(query);
        })
        .slice(0, 10) // Limit to 10 suggestions
        .map((code: any) => ({
          mcc: code.mcc,
          description: code.edited_description || code.description,
          category: code.combined_description,
          irs_description: code.irs_description
        }));

      res.json({ suggestions });
    } catch (error) {
      console.error('MCC search error:', error);
      res.status(500).json({ message: 'Failed to search MCC codes' });
    }
  });

  // Get specific MCC code details
  app.get('/api/mcc/:code', async (req: RequestWithDB, res) => {
    try {
      const { code } = req.params;
      if (!code) {
        return res.status(400).json({ message: 'MCC code is required' });
      }

      const mcc = await import('mcc');
      const mccData = mcc.get(code);
      
      if (!mccData) {
        return res.status(404).json({ message: 'MCC code not found' });
      }

      res.json({
        mcc: mccData.mcc,
        description: mccData.edited_description || mccData.description,
        category: mccData.combined_description,
        irs_description: mccData.irs_description
      });
    } catch (error) {
      console.error('MCC lookup error:', error);
      res.status(500).json({ message: 'Failed to lookup MCC code' });
    }
  });

  // User Alerts API routes
  app.get('/api/alerts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const includeRead = req.query.includeRead === 'true';
      const alerts = await req.storage!.getUserAlerts(userId, includeRead);
      
      res.json({ alerts });
    } catch (error) {
      console.error('Get alerts error:', error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  app.get('/api/alerts/count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const count = await req.storage!.getUnreadAlertCount(userId);
      
      res.json({ count });
    } catch (error) {
      console.error('Get alert count error:', error);
      res.status(500).json({ error: 'Failed to fetch alert count' });
    }
  });

  app.patch('/api/alerts/:alertId/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const alertId = parseInt(req.params.alertId);
      if (isNaN(alertId)) {
        return res.status(400).json({ error: 'Invalid alert ID' });
      }

      const alert = await req.storage!.markAlertAsRead(alertId, userId);
      
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ alert });
    } catch (error) {
      console.error('Mark alert read error:', error);
      res.status(500).json({ error: 'Failed to mark alert as read' });
    }
  });

  app.post('/api/alerts/read-all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const count = await req.storage!.markAllAlertsAsRead(userId);
      
      res.json({ count, message: `${count} alerts marked as read` });
    } catch (error) {
      console.error('Mark all alerts read error:', error);
      res.status(500).json({ error: 'Failed to mark alerts as read' });
    }
  });

  app.delete('/api/alerts/:alertId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const alertId = parseInt(req.params.alertId);
      if (isNaN(alertId)) {
        return res.status(400).json({ error: 'Invalid alert ID' });
      }

      const success = await req.storage!.deleteAlert(alertId, userId);
      
      if (!success) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ success: true, message: 'Alert deleted' });
    } catch (error) {
      console.error('Delete alert error:', error);
      res.status(500).json({ error: 'Failed to delete alert' });
    }
  });

  // ============================================================================
  // USER PROFILE API ENDPOINTS
  // ============================================================================

  // Update own profile (any authenticated user)
  app.patch("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { firstName, lastName, email, phone, communicationPreference } = req.body;
      
      // Update only allowed profile fields
      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (email !== undefined) updates.email = email;
      if (phone !== undefined) updates.phone = phone;
      if (communicationPreference !== undefined) updates.communicationPreference = communicationPreference;

      const updatedUser = await req.storage!.updateUser(userId, updates);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Remove sensitive data from response
      const { passwordHash, passwordResetToken, passwordResetExpires, twoFactorSecret, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Change own password (any authenticated user)
  app.post("/api/profile/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }

      // Get current user
      const user = await req.storage!.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const { authService } = await import("./auth");
      const isPasswordValid = await authService.verifyPassword(currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash(newPassword, 10);

      // Update password
      await req.storage!.updateUser(userId, { passwordHash });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.delete('/api/alerts/read/all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const count = await req.storage!.deleteAllReadAlerts(userId);
      
      res.json({ count, message: `${count} read alerts deleted` });
    } catch (error) {
      console.error('Delete read alerts error:', error);
      res.status(500).json({ error: 'Failed to delete read alerts' });
    }
  });

  app.post('/api/alerts/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const testAlerts = [
        {
          userId,
          message: 'This is a test info alert. Everything is working as expected!',
          type: 'info' as const,
          actionUrl: '/alerts',
        },
        {
          userId,
          message: 'This is a test warning alert. Please review this important information.',
          type: 'warning' as const,
          actionUrl: null,
        },
        {
          userId,
          message: 'This is a test error alert. Something went wrong but has been resolved.',
          type: 'error' as const,
          actionUrl: null,
        },
        {
          userId,
          message: 'This is a test success alert. Your action was completed successfully!',
          type: 'success' as const,
          actionUrl: null,
        },
      ];

      const createdAlerts = await Promise.all(
        testAlerts.map(alert => req.storage!.createUserAlert(alert))
      );

      res.json({ 
        success: true, 
        message: `${createdAlerts.length} test alerts created`,
        alerts: createdAlerts
      });
    } catch (error) {
      console.error('Create test alerts error:', error);
      res.status(500).json({ error: 'Failed to create test alerts' });
    }
  });

  // ============================================================================
  // Signature Capture API Endpoints
  // ============================================================================

  // POST /api/signature-requests - Request signature from a signer
  app.post('/api/signature-requests', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const { applicationId, prospectId, roleKey, signerType, signerName, signerEmail, ownershipPercentage } = req.body;
      
      // Validation
      if (!signerEmail || !roleKey || !signerType) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields: signerEmail, roleKey, signerType' 
        });
      }

      // Generate secure token
      const requestToken = crypto.randomBytes(32).toString('hex');
      
      // Calculate expiration (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create signature capture record
      const signature = await req.storage!.createSignatureCapture({
        applicationId: applicationId || null,
        prospectId: prospectId || null,
        roleKey,
        signerType,
        signerName: signerName || null,
        signerEmail,
        signature: null,
        signatureType: null,
        initials: null,
        dateSigned: null,
        timestampSigned: null,
        timestampRequested: new Date(),
        timestampExpires: expiresAt,
        requestToken,
        status: 'requested',
        notes: null,
        ownershipPercentage: ownershipPercentage || null,
      });

      // Get application/prospect data for email context
      let companyName = 'Merchant Application';
      if (applicationId) {
        const application = await req.storage!.getApplication(applicationId);
        if (application?.businessName) {
          companyName = application.businessName;
        }
      } else if (prospectId) {
        const prospect = await req.storage!.getMerchantProspect(prospectId);
        if (prospect?.businessName) {
          companyName = prospect.businessName;
        }
      }
      
      // Send signature request email
      const { emailService } = await import('./emailService');
      const currentUser = req.user;
      
      const emailSent = await emailService.sendSignatureRequestEmail({
        ownerName: signerName,
        ownerEmail: signerEmail,
        companyName,
        ownershipPercentage: ownershipPercentage ? `${ownershipPercentage}%` : 'N/A',
        signatureToken: requestToken,
        requesterName: currentUser?.username || 'System',
        agentName: currentUser?.firstName && currentUser?.lastName 
          ? `${currentUser.firstName} ${currentUser.lastName}` 
          : currentUser?.username || 'Agent',
        dbEnv: req.dbEnv,
      });

      // If email failed, update status and return error
      if (!emailSent) {
        await req.storage!.updateSignatureCapture(signature.id, { 
          status: 'pending',
          notes: 'Email delivery failed - request not sent'
        });
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to send signature request email. Please try again.',
          signature: { ...signature, status: 'pending' }
        });
      }

      // Fire signature_requested trigger for audit trail after successful email send
      try {
        const agentName = currentUser?.firstName && currentUser?.lastName 
          ? `${currentUser.firstName} ${currentUser.lastName}` 
          : currentUser?.username || 'Agent';
          
        const { TriggerService } = await import('./triggerService');
        const { TRIGGER_KEYS } = await import('@shared/triggerKeys');
        const triggerService = new TriggerService();
        await triggerService.fireTrigger(TRIGGER_KEYS.SIGNATURE.REQUESTED, {
          triggerEvent: TRIGGER_KEYS.SIGNATURE.REQUESTED,
          ownerName: signerName,
          ownerEmail: signerEmail,
          companyName,
          ownershipPercentage: ownershipPercentage ? `${ownershipPercentage}%` : 'N/A',
          signatureUrl: `${process.env.REPLIT_DEV_DOMAIN || 'http://localhost:5000'}/sign/${requestToken}`,
          signatureToken: requestToken,
          requesterName: currentUser?.username || 'System',
          agentName
        }, {
          triggerSource: 'signature_request',
          dbEnv: req.dbEnv
        });
      } catch (triggerError) {
        console.error('Error firing signature_requested trigger:', triggerError);
        // Don't fail the request if trigger fails
      }

      res.json({ 
        success: true, 
        message: 'Signature request sent successfully',
        signature,
        expiresAt
      });
    } catch (error) {
      console.error('Signature request error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send signature request',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // POST /api/signatures/capture - Submit a signature (public endpoint with token validation)
  app.post('/api/signatures/capture', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { token, signature, signatureType, initials, signerName, signerEmail } = req.body;
      
      // Validation
      if (!token || !signature || !signatureType) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields: token, signature, signatureType' 
        });
      }

      // Find signature capture by token
      const capture = await req.storage!.getSignatureCaptureByToken(token);
      
      if (!capture) {
        return res.status(404).json({ 
          success: false, 
          message: 'Invalid or expired signature request' 
        });
      }

      // Check if already signed
      if (capture.status === 'signed') {
        return res.status(400).json({ 
          success: false, 
          message: 'This signature has already been submitted' 
        });
      }

      // Check if expired
      if (capture.timestampExpires && capture.timestampExpires < new Date()) {
        await req.storage!.updateSignatureCapture(capture.id, { status: 'expired' });
        return res.status(400).json({ 
          success: false, 
          message: 'This signature request has expired' 
        });
      }

      // Update signature capture
      const updated = await req.storage!.updateSignatureCapture(capture.id, {
        signature,
        signatureType,
        initials: initials || null,
        signerName: signerName || capture.signerName,
        signerEmail: signerEmail || capture.signerEmail,
        timestampSigned: new Date(),
        dateSigned: new Date(),
        status: 'signed',
      });

      // Fire signature_captured trigger for automated email notification
      try {
        // Get application/prospect data for trigger context
        let companyName = 'Merchant Application';
        let agentName = 'Agent';
        
        if (updated.applicationId) {
          const application = await req.storage!.getApplication(updated.applicationId);
          if (application?.businessName) {
            companyName = application.businessName;
          }
          // Try to get agent info from application if available
          if (application?.createdBy) {
            const creator = await req.storage!.getUserByIdOrUsername(application.createdBy);
            if (creator && creator.firstName && creator.lastName) {
              agentName = `${creator.firstName} ${creator.lastName}`;
            } else if (creator && creator.username) {
              agentName = creator.username;
            }
          }
        } else if (updated.prospectId) {
          const prospect = await req.storage!.getMerchantProspect(updated.prospectId);
          if (prospect?.businessName) {
            companyName = prospect.businessName;
          }
          // Try to get agent info from prospect if available
          if (prospect?.createdBy) {
            const creator = await req.storage!.getUserByIdOrUsername(prospect.createdBy);
            if (creator && creator.firstName && creator.lastName) {
              agentName = `${creator.firstName} ${creator.lastName}`;
            } else if (creator && creator.username) {
              agentName = creator.username;
            }
          }
        }
        
        const { TriggerService } = await import('./triggerService');
        const { TRIGGER_KEYS } = await import('@shared/triggerKeys');
        const triggerService = new TriggerService();
        await triggerService.fireTrigger(TRIGGER_KEYS.SIGNATURE.CAPTURED, {
          triggerEvent: TRIGGER_KEYS.SIGNATURE.CAPTURED,
          ownerName: updated.signerName || 'Owner',
          ownerEmail: updated.signerEmail,
          companyName,
          roleKey: updated.roleKey,
          signatureType: updated.signatureType,
          dateSigned: updated.dateSigned?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
          agentName
        }, {
          triggerSource: 'signature_capture',
          dbEnv: req.dbEnv
        });
      } catch (triggerError) {
        console.error('Error firing signature_captured trigger:', triggerError);
        // Don't fail the request if trigger fails
      }

      res.json({ 
        success: true, 
        message: 'Signature captured successfully',
        signature: updated
      });
    } catch (error) {
      console.error('Signature capture error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to capture signature',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/signatures/:token/status - Check signature status (public endpoint)
  app.get('/api/signatures/:token/status', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const { token } = req.params;
      
      const capture = await req.storage!.getSignatureCaptureByToken(token);
      
      if (!capture) {
        return res.status(404).json({ 
          success: false, 
          message: 'Signature request not found' 
        });
      }

      // Check if expired
      const isExpired = capture.timestampExpires && capture.timestampExpires < new Date();
      if (isExpired && capture.status !== 'expired') {
        await req.storage!.updateSignatureCapture(capture.id, { status: 'expired' });
      }

      res.json({ 
        success: true, 
        status: isExpired ? 'expired' : capture.status,
        roleKey: capture.roleKey,
        signerType: capture.signerType,
        signerName: capture.signerName,
        signerEmail: capture.signerEmail,
        timestampRequested: capture.timestampRequested,
        timestampExpires: capture.timestampExpires,
        timestampSigned: capture.timestampSigned,
        ownershipPercentage: capture.ownershipPercentage
      });
    } catch (error) {
      console.error('Signature status check error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to check signature status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // POST /api/signatures/:token/resend - Resend signature request (authenticated)
  app.post('/api/signatures/:token/resend', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const { token } = req.params;
      
      const capture = await req.storage!.getSignatureCaptureByToken(token);
      
      if (!capture) {
        return res.status(404).json({ 
          success: false, 
          message: 'Signature request not found' 
        });
      }

      // Check if already signed
      if (capture.status === 'signed') {
        return res.status(400).json({ 
          success: false, 
          message: 'This signature has already been submitted' 
        });
      }

      // Generate new token and expiration
      const newToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Update signature capture
      const updated = await req.storage!.updateSignatureCapture(capture.id, {
        requestToken: newToken,
        timestampRequested: new Date(),
        timestampExpires: expiresAt,
        status: 'requested',
      });

      // Resend email
      const { emailService } = await import('./emailService');
      const currentUser = req.user;
      
      const emailSent = await emailService.sendSignatureRequestEmail({
        ownerName: capture.signerName || 'Owner',
        ownerEmail: capture.signerEmail,
        companyName: 'Merchant Application',
        ownershipPercentage: capture.ownershipPercentage ? `${capture.ownershipPercentage}%` : 'N/A',
        signatureToken: newToken,
        requesterName: currentUser?.username || 'System',
        agentName: currentUser?.firstName && currentUser?.lastName 
          ? `${currentUser.firstName} ${currentUser.lastName}` 
          : currentUser?.username || 'Agent',
        dbEnv: req.dbEnv,
      });

      // If email failed, revert status and return error
      if (!emailSent) {
        await req.storage!.updateSignatureCapture(capture.id, { 
          requestToken: token, // Revert to old token
          timestampRequested: capture.timestampRequested, // Revert timestamp
          timestampExpires: capture.timestampExpires, // Revert expiration
          status: capture.status, // Revert status
          notes: 'Resend email delivery failed'
        });
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to resend signature request email. Please try again.'
        });
      }

      res.json({ 
        success: true, 
        message: 'Signature request resent successfully',
        signature: updated,
        newToken,
        expiresAt
      });
    } catch (error) {
      console.error('Signature resend error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to resend signature request',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/signatures/application/:applicationId - Get all signatures for an application (authenticated)
  app.get('/api/signatures/application/:applicationId', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const { applicationId } = req.params;
      
      const signatures = await req.storage!.getSignatureCapturesByApplication(parseInt(applicationId));
      
      res.json({ 
        success: true, 
        signatures
      });
    } catch (error) {
      console.error('Get application signatures error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve signatures',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/signatures/prospect/:prospectId - Get all signatures for a prospect (authenticated)
  app.get('/api/signatures/prospect/:prospectId', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const { prospectId } = req.params;
      
      const signatures = await req.storage!.getSignatureCapturesByProspect(parseInt(prospectId));
      
      res.json({ 
        success: true, 
        signatures
      });
    } catch (error) {
      console.error('Get prospect signatures error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve signatures',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // POST /api/signatures/request - Enhanced signature request from form fields
  app.post('/api/signatures/request', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    try {
      const { email, name, fieldName, applicationId, linkedDisclosures } = req.body;
      
      if (!email || !name || !fieldName) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields: email, name, fieldName' 
        });
      }

      const requestToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const signature = await req.storage!.createSignatureCapture({
        applicationId: applicationId || null,
        prospectId: null,
        roleKey: fieldName,
        signerType: 'form_field',
        signerName: name,
        signerEmail: email,
        signature: null,
        signatureType: null,
        initials: null,
        dateSigned: null,
        timestampSigned: null,
        timestampRequested: new Date(),
        timestampExpires: expiresAt,
        requestToken,
        status: 'requested',
        notes: linkedDisclosures?.length ? `Linked disclosures: ${linkedDisclosures.join(', ')}` : null,
        ownershipPercentage: null,
      });

      // Create disclosure links if provided
      if (linkedDisclosures?.length && signature.id) {
        for (const disclosureFieldName of linkedDisclosures) {
          try {
            await req.storage!.createSignatureDisclosureLink({
              signatureCaptureId: signature.id,
              disclosureFieldName,
              isRequired: true,
              signerRole: 'signer',
            });
          } catch (linkError) {
            console.error('Error creating disclosure link:', linkError);
          }
        }
      }

      const { emailService } = await import('./emailService');
      const currentUser = req.user;
      
      let companyName = 'Signature Request';
      if (applicationId) {
        const application = await req.storage!.getApplication(applicationId);
        if (application?.businessName) {
          companyName = application.businessName;
        }
      }
      
      const emailSent = await emailService.sendSignatureRequestEmail({
        ownerName: name,
        ownerEmail: email,
        companyName,
        ownershipPercentage: 'N/A',
        signatureToken: requestToken,
        requesterName: currentUser?.username || 'System',
        agentName: currentUser?.firstName && currentUser?.lastName 
          ? `${currentUser.firstName} ${currentUser.lastName}` 
          : currentUser?.username || 'Agent',
        dbEnv: req.dbEnv,
      });

      if (!emailSent) {
        await req.storage!.updateSignatureCapture(signature.id, { 
          status: 'pending',
          notes: 'Email delivery failed - request not sent'
        });
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to send signature request email. Please try again.',
        });
      }

      // Return a complete SignatureEnvelope that the frontend can store
      const signatureEnvelope = {
        signerName: name,
        signerEmail: email,
        signature: '',
        signatureType: 'drawn' as const,
        status: 'requested' as const,
        linkedDisclosures: linkedDisclosures || [],
        requestToken,
        requestedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      res.json({ 
        success: true, 
        message: 'Signature request sent successfully',
        signature,
        signatureEnvelope,
        requestToken,
        expiresAt
      });
    } catch (error) {
      console.error('Enhanced signature request error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send signature request',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // =====================================================
  // WORKFLOW API ROUTES
  // =====================================================

  // Workflow Definitions
  app.get('/api/workflow/definitions', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const definitions = await req.storage!.getAllWorkflowDefinitions();
      const definitionsWithStages = await Promise.all(
        definitions.map(async (def) => {
          const stages = await req.storage!.getWorkflowStages(def.id);
          return { ...def, stages };
        })
      );
      res.json({ success: true, definitions: definitionsWithStages });
    } catch (error) {
      console.error('Get workflow definitions error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve workflow definitions' });
    }
  });

  app.get('/api/workflow/definitions/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const definition = await req.storage!.getWorkflowDefinition(parseInt(id));
      if (!definition) {
        return res.status(404).json({ success: false, message: 'Workflow definition not found' });
      }
      const stages = await req.storage!.getWorkflowStages(definition.id);
      res.json({ success: true, definition, stages });
    } catch (error) {
      console.error('Get workflow definition error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve workflow definition' });
    }
  });

  // Workflow Tickets - List
  app.get('/api/workflow/tickets', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { status, workflowCode, entityType, assignedToId } = req.query;
      const filters: any = {};
      if (status) filters.status = status;
      if (workflowCode) filters.workflowCode = workflowCode;
      if (entityType) filters.entityType = entityType;
      if (assignedToId) filters.assignedToId = assignedToId;

      const tickets = await req.storage!.getAllWorkflowTickets(filters);
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('Get workflow tickets error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve workflow tickets' });
    }
  });

  // Workflow Tickets - Get single with details
  app.get('/api/workflow/tickets/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const ticket = await req.storage!.getWorkflowTicket(parseInt(id));
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Workflow ticket not found' });
      }

      const definition = await req.storage!.getWorkflowDefinition(ticket.workflowDefinitionId);
      const stages = await req.storage!.getWorkflowStages(ticket.workflowDefinitionId);
      const ticketStages = await req.storage!.getWorkflowTicketStages(ticket.id);
      const issues = await req.storage!.getWorkflowIssues(ticket.id);
      const tasks = await req.storage!.getWorkflowTasks(ticket.id);
      const transitions = await req.storage!.getWorkflowTransitions(ticket.id);
      const notes = await req.storage!.getWorkflowNotes(ticket.id);
      const currentStage = ticket.currentStageId ? stages.find(s => s.id === ticket.currentStageId) : null;

      res.json({
        success: true,
        ticket,
        definition,
        stages,
        ticketStages,
        issues,
        tasks,
        transitions,
        notes,
        currentStage,
      });
    } catch (error) {
      console.error('Get workflow ticket details error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve workflow ticket' });
    }
  });

  // Workflow Tickets - Create
  app.post('/api/workflow/tickets', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { workflowCode, entityType, entityId, priority, metadata } = req.body;
      const userId = req.user?.claims?.sub;

      if (!workflowCode || !entityType || !entityId) {
        return res.status(400).json({ success: false, message: 'Missing required fields: workflowCode, entityType, entityId' });
      }

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const ticket = await engine.createTicket({
        workflowCode,
        entityType,
        entityId: parseInt(entityId),
        createdById: userId,
        priority,
        metadata,
      });

      res.json({ success: true, ticket, message: 'Workflow ticket created' });
    } catch (error) {
      console.error('Create workflow ticket error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to create workflow ticket' 
      });
    }
  });

  // Workflow Tickets - Start Processing
  app.post('/api/workflow/tickets/:id/start', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.claims?.sub;

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const ticket = await engine.startProcessing(parseInt(id), userId);
      res.json({ success: true, ticket, message: 'Workflow processing started' });
    } catch (error) {
      console.error('Start workflow processing error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to start workflow processing' 
      });
    }
  });

  // Workflow Tickets - Execute Current Stage
  app.post('/api/workflow/tickets/:id/execute', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.claims?.sub;

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const result = await engine.executeCurrentStage(parseInt(id), userId);
      
      const ticket = await req.storage!.getWorkflowTicket(parseInt(id));
      res.json({ success: true, result, ticket, message: 'Stage executed' });
    } catch (error) {
      console.error('Execute workflow stage error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to execute workflow stage' 
      });
    }
  });

  // Workflow Tickets - Execute Specific Stage
  app.post('/api/workflow/tickets/:id/stages/:stageId/execute', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id, stageId } = req.params;
      const userId = req.user?.claims?.sub;

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const ticket = await req.storage!.getWorkflowTicket(parseInt(id));
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }

      // Auto-start processing if still pending/submitted
      if (ticket.status === 'pending' || ticket.status === 'submitted') {
        await engine.startProcessing(parseInt(id), userId);
      }

      // If stageId doesn't match current stage, switch to it first
      if (ticket.currentStageId !== parseInt(stageId)) {
        await req.storage!.updateWorkflowTicket(parseInt(id), {
          currentStageId: parseInt(stageId),
        });
      }

      const result = await engine.executeCurrentStage(parseInt(id), userId);
      const updatedTicket = await req.storage!.getWorkflowTicket(parseInt(id));
      
      res.json({ success: true, result, ticket: updatedTicket, message: 'Stage executed' });
    } catch (error) {
      console.error('Execute specific workflow stage error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to execute workflow stage' 
      });
    }
  });

  // Workflow Tickets - Advance to next stage
  app.post('/api/workflow/tickets/:id/advance', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.claims?.sub;

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const ticket = await req.storage!.getWorkflowTicket(parseInt(id));
      if (!ticket || !ticket.currentStageId) {
        return res.status(404).json({ success: false, message: 'Ticket not found or has no current stage' });
      }

      const currentStage = await req.storage!.getWorkflowStage(ticket.currentStageId);
      if (!currentStage) {
        return res.status(404).json({ success: false, message: 'Current stage not found' });
      }

      const updatedTicket = await engine.advanceToNextStage(ticket, currentStage, userId);
      res.json({ success: true, ticket: updatedTicket, message: 'Advanced to next stage' });
    } catch (error) {
      console.error('Advance workflow stage error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to advance workflow stage' 
      });
    }
  });

  // Workflow Tickets - Resolve Checkpoint
  app.post('/api/workflow/tickets/:id/resolve-checkpoint', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { decision, notes } = req.body;
      const userId = req.user?.claims?.sub;

      if (!decision || !['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ success: false, message: 'Invalid decision. Must be approve or reject' });
      }

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const { registerUnderwritingHandlers } = await import('./services/underwriting-handlers');
      
      const engine = new WorkflowEngine(storage);
      registerUnderwritingHandlers(engine);

      const ticket = await engine.resolveCheckpoint(parseInt(id), decision, userId, notes);
      res.json({ success: true, ticket, message: `Checkpoint ${decision}d` });
    } catch (error) {
      console.error('Resolve checkpoint error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to resolve checkpoint' 
      });
    }
  });

  // Workflow Tickets - Assign
  app.post('/api/workflow/tickets/:id/assign', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { assigneeId, notes } = req.body;
      const userId = req.user?.claims?.sub;

      if (!assigneeId) {
        return res.status(400).json({ success: false, message: 'Assignee ID is required' });
      }

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const engine = new WorkflowEngine(storage);

      await engine.assignTicket(parseInt(id), assigneeId, userId, notes);
      
      const ticket = await req.storage!.getWorkflowTicket(parseInt(id));
      res.json({ success: true, ticket, message: 'Ticket assigned' });
    } catch (error) {
      console.error('Assign ticket error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to assign ticket' 
      });
    }
  });

  // Workflow Notes - Add
  app.post('/api/workflow/tickets/:id/notes', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { content, noteType = 'general', isInternal = true } = req.body;
      const userId = req.user?.claims?.sub;

      if (!content) {
        return res.status(400).json({ success: false, message: 'Note content is required' });
      }

      const { WorkflowEngine } = await import('./services/workflow-engine');
      const engine = new WorkflowEngine(storage);

      await engine.addNote(parseInt(id), noteType, content, userId, isInternal);
      
      const notes = await req.storage!.getWorkflowNotes(parseInt(id));
      res.json({ success: true, notes, message: 'Note added' });
    } catch (error) {
      console.error('Add note error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to add note' 
      });
    }
  });

  // Workflow Issues - Update status
  app.patch('/api/workflow/issues/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status, resolution, overrideReason } = req.body;
      const userId = req.user?.claims?.sub;

      const issue = await req.storage!.getWorkflowIssue(parseInt(id));
      if (!issue) {
        return res.status(404).json({ success: false, message: 'Issue not found' });
      }

      if (status === 'overridden' && overrideReason) {
        await req.storage!.overrideWorkflowIssue(parseInt(id), overrideReason, userId);
      } else {
        await req.storage!.updateWorkflowIssue(parseInt(id), { status, resolution });
      }

      const updatedIssue = await req.storage!.getWorkflowIssue(parseInt(id));
      res.json({ success: true, issue: updatedIssue, message: 'Issue updated' });
    } catch (error) {
      console.error('Update issue error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to update issue' 
      });
    }
  });

  // Workflow Tasks - Update status
  app.patch('/api/workflow/tasks/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status, completionNotes, assignedToId } = req.body;
      const userId = req.user?.claims?.sub;

      const updates: any = {};
      if (status) {
        updates.status = status;
        if (status === 'completed') {
          updates.completedAt = new Date();
          updates.completedBy = userId;
        }
      }
      if (completionNotes) updates.completionNotes = completionNotes;
      if (assignedToId) {
        updates.assignedToId = assignedToId;
        updates.assignedAt = new Date();
      }

      await req.storage!.updateWorkflowTask(parseInt(id), updates);
      
      const task = await req.storage!.getWorkflowTask(parseInt(id));
      res.json({ success: true, task, message: 'Task updated' });
    } catch (error) {
      console.error('Update task error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to update task' 
      });
    }
  });

  // Workflow Dashboard Stats
  app.get('/api/workflow/stats', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const userRole = req.user?.role;

      const allTickets = await req.storage!.getAllWorkflowTickets({});
      
      const stats = {
        total: allTickets.length,
        byStatus: {
          submitted: allTickets.filter(t => t.status === 'submitted').length,
          in_progress: allTickets.filter(t => t.status === 'in_progress').length,
          pending_review: allTickets.filter(t => t.status === 'pending_review').length,
          approved: allTickets.filter(t => t.status === 'approved').length,
          rejected: allTickets.filter(t => t.status === 'rejected').length,
          on_hold: allTickets.filter(t => t.status === 'on_hold').length,
        },
        byPriority: {
          urgent: allTickets.filter(t => t.priority === 'urgent').length,
          high: allTickets.filter(t => t.priority === 'high').length,
          normal: allTickets.filter(t => t.priority === 'normal').length,
          low: allTickets.filter(t => t.priority === 'low').length,
        },
        myAssigned: allTickets.filter(t => t.assignedToId === userId).length,
        awaitingReview: allTickets.filter(t => t.status === 'pending_review').length,
      };

      res.json({ success: true, stats });
    } catch (error) {
      console.error('Get workflow stats error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve workflow stats' });
    }
  });

  // MCC Policies - List
  app.get('/api/workflow/mcc-policies', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const policies = await req.storage!.getMccPolicies();
      res.json({ success: true, policies });
    } catch (error) {
      console.error('Get MCC policies error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve MCC policies' });
    }
  });

  // MCC Policies - Create
  app.post('/api/workflow/mcc-policies', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { mccCode, description, category, acquirerId, riskLevel, notes } = req.body;
      const userId = req.user?.claims?.sub;

      if (!mccCode || !description || !category) {
        return res.status(400).json({ success: false, message: 'MCC code, description, and category are required' });
      }

      const policy = await req.storage!.createMccPolicy({
        mccCode,
        description,
        category,
        acquirerId: acquirerId || null,
        riskLevel: riskLevel || null,
        notes: notes || null,
        createdBy: userId,
        isActive: true,
      });

      res.json({ success: true, policy, message: 'MCC policy created' });
    } catch (error) {
      console.error('Create MCC policy error:', error);
      res.status(500).json({ success: false, message: 'Failed to create MCC policy' });
    }
  });

  // Volume Thresholds - List
  app.get('/api/workflow/volume-thresholds', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const thresholds = await req.storage!.getVolumeThresholds();
      res.json({ success: true, thresholds });
    } catch (error) {
      console.error('Get volume thresholds error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve volume thresholds' });
    }
  });

  // Volume Thresholds - Create
  app.post('/api/workflow/volume-thresholds', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { thresholdType, minValue, maxValue, action, severity, description, notes } = req.body;
      const userId = req.user?.claims?.sub;

      if (!thresholdType || !action || !severity) {
        return res.status(400).json({ success: false, message: 'Threshold type, action, and severity are required' });
      }

      const threshold = await req.storage!.createVolumeThreshold({
        thresholdType,
        minValue: minValue || null,
        maxValue: maxValue || null,
        action,
        severity,
        description: description || null,
        notes: notes || null,
        createdBy: userId,
        isActive: true,
      });

      res.json({ success: true, threshold, message: 'Volume threshold created' });
    } catch (error) {
      console.error('Create volume threshold error:', error);
      res.status(500).json({ success: false, message: 'Failed to create volume threshold' });
    }
  });

  // =====================================================
  // STAGE API CONFIGURATION ROUTES
  // =====================================================

  // Get all stage API configurations
  app.get('/api/workflow/stage-configs', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const configs = await req.storage!.getAllStageApiConfigs();
      res.json({ success: true, configs });
    } catch (error) {
      console.error('Get stage API configs error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve stage API configurations' });
    }
  });

  // Get stage API configuration by stage ID
  app.get('/api/workflow/stage-configs/by-stage/:stageId', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const { stageId } = req.params;
      const config = await req.storage!.getStageApiConfig(parseInt(stageId));
      if (!config) {
        return res.status(404).json({ success: false, message: 'Stage API configuration not found' });
      }
      res.json({ success: true, config });
    } catch (error) {
      console.error('Get stage API config error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve stage API configuration' });
    }
  });

  // Get stage API configuration by ID
  app.get('/api/workflow/stage-configs/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const config = await req.storage!.getStageApiConfigById(parseInt(id));
      if (!config) {
        return res.status(404).json({ success: false, message: 'Stage API configuration not found' });
      }
      res.json({ success: true, config });
    } catch (error) {
      console.error('Get stage API config error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve stage API configuration' });
    }
  });

  // Create stage API configuration
  app.post('/api/workflow/stage-configs', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const {
        stageId,
        integrationId,
        endpointUrl,
        httpMethod,
        headers,
        authType,
        authSecretKey,
        requestMapping,
        requestTemplate,
        responseMapping,
        rules,
        timeoutSeconds,
        maxRetries,
        retryDelaySeconds,
        fallbackOnError,
        fallbackOnTimeout,
        isActive,
        testMode,
        mockResponse
      } = req.body;

      if (!stageId) {
        return res.status(400).json({ success: false, message: 'Stage ID is required' });
      }

      // Check if config already exists for this stage
      const existingConfig = await req.storage!.getStageApiConfig(stageId);
      if (existingConfig) {
        return res.status(400).json({ success: false, message: 'A configuration already exists for this stage. Use update instead.' });
      }

      const config = await req.storage!.createStageApiConfig({
        stageId,
        integrationId: integrationId || null,
        endpointUrl: endpointUrl || null,
        httpMethod: httpMethod || 'POST',
        headers: headers || {},
        authType: authType || 'none',
        authSecretKey: authSecretKey || null,
        requestMapping: requestMapping || {},
        requestTemplate: requestTemplate || null,
        responseMapping: responseMapping || {},
        rules: rules || [],
        timeoutSeconds: timeoutSeconds || 30,
        maxRetries: maxRetries || 3,
        retryDelaySeconds: retryDelaySeconds || 5,
        fallbackOnError: fallbackOnError || 'pending_review',
        fallbackOnTimeout: fallbackOnTimeout || 'pending_review',
        isActive: isActive !== false,
        testMode: testMode || false,
        mockResponse: mockResponse || null,
        createdBy: userId,
      });

      res.json({ success: true, config, message: 'Stage API configuration created' });
    } catch (error) {
      console.error('Create stage API config error:', error);
      res.status(500).json({ success: false, message: 'Failed to create stage API configuration' });
    }
  });

  // Update stage API configuration
  app.patch('/api/workflow/stage-configs/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.id;
      delete updates.createdAt;
      delete updates.createdBy;

      const config = await req.storage!.updateStageApiConfig(parseInt(id), updates);
      if (!config) {
        return res.status(404).json({ success: false, message: 'Stage API configuration not found' });
      }

      res.json({ success: true, config, message: 'Stage API configuration updated' });
    } catch (error) {
      console.error('Update stage API config error:', error);
      res.status(500).json({ success: false, message: 'Failed to update stage API configuration' });
    }
  });

  // Delete stage API configuration
  app.delete('/api/workflow/stage-configs/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const deleted = await req.storage!.deleteStageApiConfig(parseInt(id));
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Stage API configuration not found' });
      }
      res.json({ success: true, message: 'Stage API configuration deleted' });
    } catch (error) {
      console.error('Delete stage API config error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete stage API configuration' });
    }
  });

  // =====================================================
  // RBAC (Role-Based Access Control) API ROUTES
  // =====================================================

  // Get all RBAC resources grouped by type
  app.get('/api/rbac/resources', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const dynamicDB = req.dynamicDB || db;
      const { rbacResources } = await import('@shared/schema');
      
      const resources = await dynamicDB.select().from(rbacResources).where(eq(rbacResources.isActive, true));
      
      // Group by resource type
      const grouped = resources.reduce((acc: any, resource: any) => {
        if (!acc[resource.resourceType]) {
          acc[resource.resourceType] = [];
        }
        acc[resource.resourceType].push(resource);
        return acc;
      }, {});
      
      res.json({ success: true, resources, grouped });
    } catch (error) {
      console.error('Get RBAC resources error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve resources' });
    }
  });

  // Get all roles with their permission counts
  app.get('/api/rbac/roles', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    const startTime = Date.now();
    const requestId = `rbac-roles-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const dbEnv = req.dbEnv || 'unknown';
    
    console.log(`[RBAC:roles] ${requestId} - Starting request (env: ${dbEnv})`);
    
    try {
      const dynamicDB = req.dynamicDB || db;
      const { rolePermissions, SYSTEM_ROLES, ROLE_HIERARCHY } = await import('@shared/schema');
      
      // Get permission counts for each role
      const permissionCounts = await dynamicDB
        .select({
          roleKey: rolePermissions.roleKey,
          count: sql<number>`count(*)::int`,
        })
        .from(rolePermissions)
        .where(eq(rolePermissions.isGranted, true))
        .groupBy(rolePermissions.roleKey);
      
      console.log(`[RBAC:roles] ${requestId} - Fetched permission counts for ${permissionCounts.length} roles`);
      
      // Build role info with counts
      const roles = SYSTEM_ROLES.map(roleKey => ({
        roleKey,
        displayName: roleKey.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        hierarchyRank: ROLE_HIERARCHY[roleKey],
        permissionCount: permissionCounts.find(p => p.roleKey === roleKey)?.count || 0,
      }));
      
      const totalTime = Date.now() - startTime;
      console.log(`[RBAC:roles] ${requestId} - Completed successfully in ${totalTime}ms`);
      
      res.json({ success: true, roles });
    } catch (error: any) {
      const totalTime = Date.now() - startTime;
      console.error(`[RBAC:roles] ${requestId} - FAILED after ${totalTime}ms:`, {
        error: error.message,
        code: error.code,
        dbEnvironment: dbEnv,
      });
      
      // Check for common schema issues
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        console.error(`[RBAC:roles] ${requestId} - SCHEMA MISMATCH DETECTED! Run migration: npx tsx scripts/migration-manager.ts apply ${dbEnv}`);
      }
      
      res.status(500).json({ success: false, message: 'Failed to retrieve roles' });
    }
  });

  // Get permissions for a specific role
  app.get('/api/rbac/roles/:roleKey/permissions', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const { roleKey } = req.params;
      const dynamicDB = req.dynamicDB || db;
      const { rolePermissions, rbacResources, SYSTEM_ROLES } = await import('@shared/schema');
      
      if (!SYSTEM_ROLES.includes(roleKey)) {
        return res.status(400).json({ success: false, message: 'Invalid role key' });
      }
      
      // Get all permissions for this role
      const permissions = await dynamicDB
        .select({
          id: rolePermissions.id,
          roleKey: rolePermissions.roleKey,
          resourceId: rolePermissions.resourceId,
          action: rolePermissions.action,
          isGranted: rolePermissions.isGranted,
          grantedAt: rolePermissions.grantedAt,
          notes: rolePermissions.notes,
          resourceKey: rbacResources.resourceKey,
          resourceType: rbacResources.resourceType,
          displayName: rbacResources.displayName,
          category: rbacResources.category,
        })
        .from(rolePermissions)
        .innerJoin(rbacResources, eq(rolePermissions.resourceId, rbacResources.id))
        .where(eq(rolePermissions.roleKey, roleKey));
      
      // Build a permission map for easy lookup
      const permissionMap: Record<string, string[]> = {};
      permissions.forEach((p: any) => {
        if (p.isGranted) {
          if (!permissionMap[p.resourceKey]) {
            permissionMap[p.resourceKey] = [];
          }
          permissionMap[p.resourceKey].push(p.action);
        }
      });
      
      res.json({ success: true, permissions, permissionMap, roleKey });
    } catch (error) {
      console.error('Get role permissions error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve role permissions' });
    }
  });

  // Get full policy snapshot (all roles, all resources, all permissions)
  app.get('/api/rbac/policies', dbEnvironmentMiddleware, isAuthenticated, async (req: any, res) => {
    const startTime = Date.now();
    const requestId = `rbac-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const dbEnv = req.dbEnv || 'unknown';
    
    console.log(`[RBAC:policies] ${requestId} - Starting request (env: ${dbEnv})`);
    
    try {
      const dynamicDB = req.dynamicDB || db;
      const { rolePermissions, rbacResources, SYSTEM_ROLES } = await import('@shared/schema');
      
      // Get all active resources with timing
      const resourcesStartTime = Date.now();
      const resources = await dynamicDB
        .select()
        .from(rbacResources)
        .where(eq(rbacResources.isActive, true));
      console.log(`[RBAC:policies] ${requestId} - Fetched ${resources.length} resources in ${Date.now() - resourcesStartTime}ms`);
      
      // Verify schema by checking first resource has expected fields
      if (resources.length > 0) {
        const sampleResource = resources[0];
        const expectedFields = ['id', 'resourceType', 'resourceKey', 'displayName', 'category', 'metadata'];
        const missingFields = expectedFields.filter(f => !(f in sampleResource));
        if (missingFields.length > 0) {
          console.warn(`[RBAC:policies] ${requestId} - Schema warning: Missing fields in rbac_resources: ${missingFields.join(', ')}`);
        }
      }
      
      // Get all granted permissions with timing
      const permissionsStartTime = Date.now();
      const permissions = await dynamicDB
        .select({
          roleKey: rolePermissions.roleKey,
          resourceId: rolePermissions.resourceId,
          action: rolePermissions.action,
          isGranted: rolePermissions.isGranted,
          resourceKey: rbacResources.resourceKey,
        })
        .from(rolePermissions)
        .innerJoin(rbacResources, eq(rolePermissions.resourceId, rbacResources.id))
        .where(eq(rolePermissions.isGranted, true));
      console.log(`[RBAC:policies] ${requestId} - Fetched ${permissions.length} permissions in ${Date.now() - permissionsStartTime}ms`);
      
      // Build policy map: { roleKey: { resourceKey: [actions] } }
      const policyMap: Record<string, Record<string, string[]>> = {};
      
      SYSTEM_ROLES.forEach(role => {
        policyMap[role] = {};
      });
      
      permissions.forEach((p: any) => {
        if (!policyMap[p.roleKey]) {
          policyMap[p.roleKey] = {};
        }
        if (!policyMap[p.roleKey][p.resourceKey]) {
          policyMap[p.roleKey][p.resourceKey] = [];
        }
        if (!policyMap[p.roleKey][p.resourceKey].includes(p.action)) {
          policyMap[p.roleKey][p.resourceKey].push(p.action);
        }
      });
      
      const totalTime = Date.now() - startTime;
      console.log(`[RBAC:policies] ${requestId} - Completed successfully in ${totalTime}ms (resources: ${resources.length}, permissions: ${permissions.length})`);
      
      res.json({ 
        success: true, 
        policies: policyMap,
        resources: resources.map((r: any) => ({
          resourceKey: r.resourceKey,
          resourceType: r.resourceType,
          displayName: r.displayName,
          category: r.category,
        })),
        roles: SYSTEM_ROLES,
      });
    } catch (error: any) {
      const totalTime = Date.now() - startTime;
      console.error(`[RBAC:policies] ${requestId} - FAILED after ${totalTime}ms:`, {
        error: error.message,
        code: error.code,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
        dbEnvironment: dbEnv,
      });
      
      // Check for common schema issues
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        console.error(`[RBAC:policies] ${requestId} - SCHEMA MISMATCH DETECTED! Run migration: npx tsx scripts/migration-manager.ts apply ${dbEnv}`);
      }
      
      res.status(500).json({ success: false, message: 'Failed to retrieve policies' });
    }
  });

  // Update permissions for a role
  app.put('/api/rbac/roles/:roleKey/permissions', dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { roleKey } = req.params;
      const { grants } = req.body; // Array of { resourceKey, action, allow: boolean }
      const userId = (req.session as any)?.userId;
      const dynamicDB = req.dynamicDB || db;
      const { rolePermissions, rbacResources, permissionAuditLog, SYSTEM_ROLES } = await import('@shared/schema');
      
      if (!SYSTEM_ROLES.includes(roleKey)) {
        return res.status(400).json({ success: false, message: 'Invalid role key' });
      }
      
      if (!Array.isArray(grants) || grants.length === 0) {
        return res.status(400).json({ success: false, message: 'Grants array is required' });
      }
      
      const results: any[] = [];
      
      for (const grant of grants) {
        const { resourceKey, action, allow } = grant;
        
        // Find the resource
        const [resource] = await dynamicDB
          .select()
          .from(rbacResources)
          .where(eq(rbacResources.resourceKey, resourceKey))
          .limit(1);
        
        if (!resource) {
          results.push({ resourceKey, action, success: false, message: 'Resource not found' });
          continue;
        }
        
        // Check if permission already exists
        const [existingPerm] = await dynamicDB
          .select()
          .from(rolePermissions)
          .where(sql`${rolePermissions.roleKey} = ${roleKey} AND ${rolePermissions.resourceId} = ${resource.id} AND ${rolePermissions.action} = ${action}`)
          .limit(1);
        
        const previousValue = existingPerm?.isGranted ?? null;
        
        if (existingPerm) {
          // Update existing permission
          await dynamicDB
            .update(rolePermissions)
            .set({ 
              isGranted: allow, 
              grantedBy: userId,
              grantedAt: new Date(),
            })
            .where(eq(rolePermissions.id, existingPerm.id));
        } else {
          // Insert new permission
          await dynamicDB
            .insert(rolePermissions)
            .values({
              roleKey,
              resourceId: resource.id,
              action,
              isGranted: allow,
              grantedBy: userId,
            });
        }
        
        // Log the change to audit log
        await dynamicDB
          .insert(permissionAuditLog)
          .values({
            actorUserId: userId,
            roleKey,
            resourceId: resource.id,
            action,
            changeType: allow ? 'grant' : 'revoke',
            previousValue,
            newValue: allow,
            notes: `Permission ${allow ? 'granted' : 'revoked'} by admin`,
          });
        
        results.push({ resourceKey, action, success: true, allow });
      }
      
      res.json({ success: true, results, message: 'Permissions updated successfully' });
    } catch (error) {
      console.error('Update role permissions error:', error);
      res.status(500).json({ success: false, message: 'Failed to update permissions' });
    }
  });

  // Get permission audit log
  app.get('/api/rbac/audit-log', dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { roleKey, limit = '50', offset = '0' } = req.query;
      const dynamicDB = req.dynamicDB || db;
      const { permissionAuditLog, rbacResources, users: usersTable } = await import('@shared/schema');
      
      let query = dynamicDB
        .select({
          id: permissionAuditLog.id,
          actorUserId: permissionAuditLog.actorUserId,
          roleKey: permissionAuditLog.roleKey,
          action: permissionAuditLog.action,
          changeType: permissionAuditLog.changeType,
          previousValue: permissionAuditLog.previousValue,
          newValue: permissionAuditLog.newValue,
          notes: permissionAuditLog.notes,
          createdAt: permissionAuditLog.createdAt,
          resourceKey: rbacResources.resourceKey,
          resourceDisplayName: rbacResources.displayName,
          actorUsername: usersTable.username,
        })
        .from(permissionAuditLog)
        .innerJoin(rbacResources, eq(permissionAuditLog.resourceId, rbacResources.id))
        .leftJoin(usersTable, eq(permissionAuditLog.actorUserId, usersTable.id))
        .orderBy(sql`${permissionAuditLog.createdAt} DESC`)
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));
      
      if (roleKey) {
        query = query.where(eq(permissionAuditLog.roleKey, roleKey as string));
      }
      
      const logs = await query;
      
      res.json({ success: true, logs });
    } catch (error) {
      console.error('Get permission audit log error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve audit log' });
    }
  });

  // =====================================================
  // DISCLOSURE LIBRARY MANAGEMENT ROUTES
  // =====================================================

  // Get all disclosure definitions with their versions
  app.get('/api/disclosures', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const disclosures = await envStorage.getAllDisclosureDefinitions();
      res.json({ success: true, disclosures });
    } catch (error) {
      console.error('Get disclosures error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosures' });
    }
  });

  // Get single disclosure definition with versions
  app.get('/api/disclosures/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const disclosure = await envStorage.getDisclosureDefinition(parseInt(id));
      if (!disclosure) {
        return res.status(404).json({ success: false, message: 'Disclosure not found' });
      }
      res.json({ success: true, disclosure });
    } catch (error) {
      console.error('Get disclosure error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosure' });
    }
  });

  // Get disclosure by slug (for form rendering)
  app.get('/api/disclosures/by-slug/:slug', dbEnvironmentMiddleware, async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { slug } = req.params;
      const disclosure = await envStorage.getDisclosureDefinitionBySlug(slug);
      if (!disclosure) {
        return res.status(404).json({ success: false, message: 'Disclosure not found' });
      }
      res.json({ success: true, disclosure });
    } catch (error) {
      console.error('Get disclosure by slug error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosure' });
    }
  });

  // Create disclosure definition
  app.post('/api/disclosures', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.user?.claims?.sub;
      const { slug, displayName, description, category, requiresSignature, companyId } = req.body;

      if (!slug || !displayName) {
        return res.status(400).json({ success: false, message: 'Slug and display name are required' });
      }

      // Check if slug already exists
      const existing = await envStorage.getDisclosureDefinitionBySlug(slug);
      if (existing) {
        return res.status(400).json({ success: false, message: 'A disclosure with this slug already exists' });
      }

      const disclosure = await envStorage.createDisclosureDefinition({
        slug,
        displayName,
        description: description || null,
        category: category || 'general',
        requiresSignature: requiresSignature !== false,
        companyId: companyId || null,
        createdBy: userId,
        isActive: true,
      });

      res.json({ success: true, disclosure, message: 'Disclosure created successfully' });
    } catch (error) {
      console.error('Create disclosure error:', error);
      res.status(500).json({ success: false, message: 'Failed to create disclosure' });
    }
  });

  // Update disclosure definition
  app.patch('/api/disclosures/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const updates = req.body;
      
      const disclosure = await envStorage.updateDisclosureDefinition(parseInt(id), updates);
      if (!disclosure) {
        return res.status(404).json({ success: false, message: 'Disclosure not found' });
      }
      
      res.json({ success: true, disclosure, message: 'Disclosure updated successfully' });
    } catch (error) {
      console.error('Update disclosure error:', error);
      res.status(500).json({ success: false, message: 'Failed to update disclosure' });
    }
  });

  // Delete disclosure definition
  app.delete('/api/disclosures/:id', dbEnvironmentMiddleware, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const success = await envStorage.deleteDisclosureDefinition(parseInt(id));
      if (!success) {
        return res.status(404).json({ success: false, message: 'Disclosure not found' });
      }
      res.json({ success: true, message: 'Disclosure deleted successfully' });
    } catch (error) {
      console.error('Delete disclosure error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete disclosure' });
    }
  });

  // =====================================================
  // DISCLOSURE VERSION ROUTES
  // =====================================================

  // Get all versions for a disclosure
  app.get('/api/disclosures/:definitionId/versions', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { definitionId } = req.params;
      const versions = await envStorage.getDisclosureVersions(parseInt(definitionId));
      res.json({ success: true, versions });
    } catch (error) {
      console.error('Get disclosure versions error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve disclosure versions' });
    }
  });

  // Get current version for a disclosure
  app.get('/api/disclosures/:definitionId/current-version', dbEnvironmentMiddleware, async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { definitionId } = req.params;
      const version = await envStorage.getCurrentDisclosureVersion(parseInt(definitionId));
      if (!version) {
        return res.status(404).json({ success: false, message: 'No current version found' });
      }
      res.json({ success: true, version });
    } catch (error) {
      console.error('Get current disclosure version error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve current disclosure version' });
    }
  });

  // Create new disclosure version
  app.post('/api/disclosures/:definitionId/versions', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const userId = req.user?.claims?.sub;
      const { definitionId } = req.params;
      const { version, title, content, requiresSignature } = req.body;

      if (!version || !title || !content) {
        return res.status(400).json({ success: false, message: 'Version, title, and content are required' });
      }

      // Generate content hash for tamper detection
      const crypto = await import('crypto');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      const disclosureVersion = await envStorage.createDisclosureVersion({
        definitionId: parseInt(definitionId),
        version,
        title,
        content,
        contentHash,
        requiresSignature: requiresSignature !== false,
        createdBy: userId,
        effectiveDate: new Date(),
        isCurrentVersion: true,
      });

      res.json({ success: true, version: disclosureVersion, message: 'Disclosure version created successfully' });
    } catch (error) {
      console.error('Create disclosure version error:', error);
      res.status(500).json({ success: false, message: 'Failed to create disclosure version' });
    }
  });

  // Update disclosure version content (only if no signatures collected)
  app.patch('/api/disclosure-versions/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const { title, content, version } = req.body;
      
      // Check if this version has any signatures
      const signatureCount = await envStorage.getDisclosureVersionSignatureCount(parseInt(id));
      if (signatureCount > 0) {
        return res.status(403).json({ 
          success: false, 
          message: `Cannot edit this version - it has ${signatureCount} signature(s) collected. Create a new version instead.`,
          signatureCount
        });
      }
      
      // Validate at least one field is being updated
      if (!title && !content && !version) {
        return res.status(400).json({ success: false, message: 'At least one field (title, content, or version) must be provided' });
      }
      
      const updatedVersion = await envStorage.updateDisclosureVersion(parseInt(id), { title, content, version });
      if (!updatedVersion) {
        return res.status(404).json({ success: false, message: 'Version not found' });
      }
      
      res.json({ success: true, version: updatedVersion, message: 'Version updated successfully' });
    } catch (error) {
      console.error('Update disclosure version error:', error);
      res.status(500).json({ success: false, message: 'Failed to update disclosure version' });
    }
  });

  // Retire a disclosure version
  app.post('/api/disclosure-versions/:id/retire', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { id } = req.params;
      const version = await envStorage.retireDisclosureVersion(parseInt(id));
      if (!version) {
        return res.status(404).json({ success: false, message: 'Version not found' });
      }
      res.json({ success: true, version, message: 'Version retired successfully' });
    } catch (error) {
      console.error('Retire disclosure version error:', error);
      res.status(500).json({ success: false, message: 'Failed to retire disclosure version' });
    }
  });

  // =====================================================
  // DISCLOSURE SIGNATURE ROUTES
  // =====================================================

  // Get signatures for a specific version
  app.get('/api/disclosure-versions/:versionId/signatures', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { versionId } = req.params;
      const signatures = await envStorage.getDisclosureSignatures(parseInt(versionId));
      res.json({ success: true, signatures });
    } catch (error) {
      console.error('Get disclosure signatures error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve signatures' });
    }
  });

  // Get signature report for a disclosure (all versions or specific version)
  app.get('/api/disclosures/:definitionId/signature-report', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter']), async (req: any, res) => {
    try {
      const envStorage = createStorageForRequest(req);
      const { definitionId } = req.params;
      const { versionId } = req.query;
      
      const report = await envStorage.getDisclosureSignatureReport(
        parseInt(definitionId),
        versionId ? parseInt(versionId as string) : undefined
      );
      
      res.json({ success: true, report });
    } catch (error) {
      console.error('Get disclosure signature report error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve signature report' });
    }
  });

  // Record a disclosure signature
  app.post('/api/disclosure-signatures', dbEnvironmentMiddleware, async (req: any, res) => {
    try {
      const {
        disclosureVersionId,
        prospectId,
        userId,
        signerName,
        signerEmail,
        signerTitle,
        signatureType,
        signatureData,
        scrollStartedAt,
        scrollCompletedAt,
        scrollDurationMs,
        templateId,
        applicationId,
      } = req.body;

      if (!disclosureVersionId || !signerName || !signatureType) {
        return res.status(400).json({ success: false, message: 'Disclosure version ID, signer name, and signature type are required' });
      }

      // Get the version to capture the content hash
      const version = await req.storage!.getDisclosureVersion(disclosureVersionId);
      if (!version) {
        return res.status(404).json({ success: false, message: 'Disclosure version not found' });
      }

      const signature = await req.storage!.createDisclosureSignature({
        disclosureVersionId,
        prospectId: prospectId || null,
        userId: userId || null,
        signerName,
        signerEmail: signerEmail || null,
        signerTitle: signerTitle || null,
        signatureType,
        signatureData: signatureData || null,
        scrollStartedAt: scrollStartedAt ? new Date(scrollStartedAt) : null,
        scrollCompletedAt: scrollCompletedAt ? new Date(scrollCompletedAt) : null,
        scrollDurationMs: scrollDurationMs || null,
        signedAt: new Date(),
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        contentHashAtSigning: version.contentHash,
        templateId: templateId || null,
        applicationId: applicationId || null,
        isRevoked: false,
      });

      res.json({ success: true, signature, message: 'Signature recorded successfully' });
    } catch (error) {
      console.error('Create disclosure signature error:', error);
      res.status(500).json({ success: false, message: 'Failed to record signature' });
    }
  });

  // Get signatures by prospect
  app.get('/api/prospects/:prospectId/disclosure-signatures', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin', 'underwriter', 'agent']), async (req: any, res) => {
    try {
      const { prospectId } = req.params;
      const signatures = await req.storage!.getDisclosureSignaturesByProspect(parseInt(prospectId));
      res.json({ success: true, signatures });
    } catch (error) {
      console.error('Get prospect disclosure signatures error:', error);
      res.status(500).json({ success: false, message: 'Failed to retrieve signatures' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}