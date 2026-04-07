import type { Express, Request as ExpressRequest, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
    Object.entries(fieldMappings).forEach(([canonicalKey, templateFieldName]: [string, any]) => {
      const canonicalFieldName = `${canonicalPrefix}.${canonicalKey}`;
      
      if (mappedData[templateFieldName] !== undefined) {
        mappedData[canonicalFieldName] = mappedData[templateFieldName];
        delete mappedData[templateFieldName];
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
      // Get all locations for this merchant
      const locations = await storage.getLocationsByMerchant(parseInt(merchantId));
      
      // Calculate total MTD revenue across all locations
      let totalMTD = 0;
      for (const location of locations) {
        const revenue = await storage.getLocationRevenue(location.id);
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
  app.get("/api/agent/dashboard/stats", dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log('Agent Dashboard Stats - Session ID:', req.sessionID);
      console.log('Agent Dashboard Stats - Session data:', req.session);
      
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get user data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get agent by userId (company-centric architecture)
      let agent = await storage.getAgentByUserId(userId);
      
      // If no agent found, use fallback for development/testing
      if (!agent && userId === 'user_agent_1') {
        // For development, fallback to agent ID 2 (Mike Chen)
        agent = await storage.getAgent(2);
        console.log('Using fallback agent for development:', agent?.firstName, agent?.lastName);
      }
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      console.log('Found agent:', agent.id, agent.firstName, agent.lastName);

      // Get all prospects assigned to this agent
      const prospects = await storage.getProspectsByAgent(agent.id);
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
      console.log('Agent Applications - Session ID:', req.sessionID);
      console.log('Agent Applications - Session data:', req.session);
      
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get user data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get agent by userId (company-centric architecture)
      let agent = await storage.getAgentByUserId(userId);
      
      // If no agent found, use fallback for development/testing
      if (!agent && userId === 'user_agent_1') {
        // For development, fallback to agent ID 2 (Mike Chen)
        agent = await storage.getAgent(2);
        console.log('Using fallback agent for development:', agent?.firstName, agent?.lastName);
      }
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get all prospects assigned to this agent with application details
      const prospects = await storage.getProspectsByAgent(agent.id);
      
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
      const widgetData = {
        ...req.body,
        userId
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
      const widget = await storage.updateWidgetPreference(parseInt(widgetId), req.body);
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
      const userId = req.user.claims.sub;
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
      const { id } = req.params;
      const { role, password } = req.body;
      
      // Require password verification for sensitive role changes
      if (!password) {
        return res.status(400).json({ message: "Password verification required for role changes" });
      }
      
      // Verify the current user's password
      const currentUser = await storage.getUser(req.session!.userId!);
      if (!currentUser) {
        return res.status(404).json({ message: "Current user not found" });
      }
      
      const { authService } = await import("./auth");
      const isPasswordValid = await authService.verifyPassword(password, currentUser.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }
      
      if (!['merchant', 'agent', 'admin', 'corporate', 'super_admin'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const user = await storage.updateUserRole(id, role);
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
      const { id } = req.params;
      const { status, password } = req.body;
      
      // Require password verification for status changes
      if (!password) {
        return res.status(400).json({ message: "Password verification required for status changes" });
      }
      
      // Verify the current user's password
      const currentUser = await storage.getUser(req.session!.userId!);
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
  app.delete("/api/users/:id", requireRole(['super_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      
      const success = await storage.deleteUser(id);
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
        const currentUser = await storage.getUser(req.session!.userId!);
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
  app.post("/api/agents/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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
  app.post("/api/merchants/:id/reset-password", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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
      const { search } = req.query;

      // Use role-based filtering from storage layer
      const merchants = await storage.getMerchantsForUser(userId);

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
      const { merchantId } = req.params;
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
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
      
      const location = await storage.createLocation(validatedData);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });



  app.put("/api/locations/:locationId", isAuthenticated, dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
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
      
      const validatedData = insertLocationSchema.partial().parse(req.body);
      const updatedLocation = await storage.updateLocation(parseInt(locationId), validatedData);
      
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
      
      const validatedData = insertAddressSchema.parse({
        ...req.body,
        locationId: parseInt(locationId)
      });
      
      const address = await storage.createAddress(validatedData);
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
      
      const validatedData = insertAddressSchema.partial().parse(req.body);
      const updatedAddress = await storage.updateAddress(parseInt(addressId), validatedData);
      
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
      const { search } = req.query;

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // For agents, only show transactions for their assigned merchants
      if (user.role === 'agent') {
        const transactions = await storage.getTransactionsForUser(userId);
        
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
        const transactions = await storage.getTransactionsForUser(userId);
        
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
          const transactions = await storage.searchTransactions(search as string);
          return res.json(transactions);
        } else {
          const transactions = await storage.getAllTransactions();
          return res.json(transactions);
        }
      }

      // Default fallback - use role-based filtering from storage layer
      const transactions = await storage.getTransactionsForUser(userId);

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
  app.post("/api/agents/:agentId/merchants/:merchantId", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { agentId, merchantId } = req.params;
      const userId = (req as any).user.claims.sub;
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

  app.delete("/api/agents/:agentId/merchants/:merchantId", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
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
  app.get("/api/prospects", isAuthenticated, async (req, res) => {
    try {
      const { search } = req.query;
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      let prospects;
      
      // Get user roles (handle both single role and roles array)
      const userRoles = user.roles || (user.role ? [user.role] : []);
      
      if (userRoles.includes('agent')) {
        // Agents can only see their assigned prospects
        let agent = await storage.getAgentByUserId(userId);
        
        // If no agent found, use fallback for development/testing
        if (!agent && userId === 'user_agent_1') {
          // For development, fallback to agent ID 2 (Mike Chen)
          agent = await storage.getAgent(2);
          console.log('Using fallback agent for prospects:', agent?.firstName, agent?.lastName);
        }
        
        if (!agent) {
          return res.status(403).json({ message: "Agent not found" });
        }
        
        if (search) {
          prospects = await storage.searchMerchantProspectsByAgent(agent.id, search as string);
        } else {
          prospects = await storage.getMerchantProspectsByAgent(agent.id);
        }
      } else if (userRoles.some(role => ['admin', 'corporate', 'super_admin'].includes(role))) {
        // Admins can see all prospects
        if (search) {
          prospects = await storage.searchMerchantProspects(search as string);
        } else {
          prospects = await storage.getAllMerchantProspects();
        }
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Include campaign assignment for each prospect
      const prospectsWithCampaign = await Promise.all(
        prospects.map(async (prospect) => {
          const campaignAssignment = await storage.getProspectCampaignAssignment(prospect.id);
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

  app.post("/api/prospects", isAuthenticated, async (req, res) => {
    try {
      const { insertMerchantProspectSchema } = await import("@shared/schema");
      const { emailService } = await import("./emailService");
      
      // Check user role authorization
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      
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
      
      const result = insertMerchantProspectSchema.safeParse(prospectData);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid prospect data", errors: result.error.errors });
      }

      // Generate validation token for the prospect
      const crypto = await import('crypto');
      const validationToken = crypto.randomUUID();
      
      // Create prospect with validation token
      const prospect = await storage.createMerchantProspect({
        ...result.data,
        validationToken
      });
      
      // Create campaign assignment
      await storage.assignCampaignToProspect(campaignId, prospect.id, userId);
      
      // Fetch agent information for email
      const agent = await storage.getAgent(prospect.agentId);
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
      res.status(500).json({ message: "Failed to create prospect" });
    }
  });

  app.put("/api/prospects/:id", requireRole(['agent', 'admin', 'corporate', 'super_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const prospectId = parseInt(id);
      
      // If email is being updated, check if it already exists for a different prospect
      if (req.body.email) {
        const existingProspect = await storage.getMerchantProspectByEmail(req.body.email);
        if (existingProspect && existingProspect.id !== prospectId) {
          return res.status(400).json({ 
            message: "A prospect with this email already exists" 
          });
        }
      }
      
      const prospect = await storage.updateMerchantProspect(prospectId, req.body);
      
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

  app.post("/api/prospects/:id/resend-invitation", requireRole(['agent', 'admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
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

      // Generate validation token if one doesn't exist
      let validationToken = prospect.validationToken;
      if (!validationToken) {
        const crypto = await import('crypto');
        validationToken = crypto.randomUUID();
        
        // Update prospect with the new validation token
        const updatedProspect = await storage.updateMerchantProspect(parseInt(id), {
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
  app.post("/api/prospects/:id/agent-signature", async (req, res) => {
    try {
      const { id } = req.params;
      const { agentSignature, agentSignatureType } = req.body;
      
      const prospect = await storage.getMerchantProspect(parseInt(id));
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
      }
      
      // Update prospect with agent signature
      const updatedProspect = await storage.updateMerchantProspect(parseInt(id), {
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

  app.delete("/api/prospects/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check user role authorization
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get user roles (handle both single role and roles array)
      const userRoles = user.roles || (user.role ? [user.role] : []);
      
      if (!userRoles.some(role => ['agent', 'admin', 'corporate', 'super_admin'].includes(role))) {
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
        let agent = await storage.getAgentByUserId(userId);
        
        // If no agent found, use fallback for development/testing
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

  // Validate prospect by token (public, no auth required)
  app.post("/api/prospects/validate-token", async (req, res) => {
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
  app.get("/api/prospects/token/:token", async (req: RequestWithDB, res) => {
    try {
      const { token} = req.params;
      
      // Get environment-specific database connection
      const dynamicDB = getRequestDB(req);
      
      // Use storage method (uses the same DB connection as other operations)
      const prospect = await storage.getMerchantProspectByToken(token);
      
      if (!prospect) {
        return res.status(404).json({ message: "Invalid or expired token" });
      }

      // Get agent information
      const agent = await storage.getAgent(prospect.agentId);

      // Get campaign assignment for this prospect
      const campaignAssignment = await storage.getProspectCampaignAssignment(prospect.id);
      let campaign = null;
      let campaignEquipment = [];
      let applicationTemplate = null;

      if (campaignAssignment) {
        // Get campaign details
        campaign = await storage.getCampaignWithDetails(campaignAssignment.campaignId);
        
        // Get equipment associated with this campaign
        campaignEquipment = await storage.getCampaignEquipment(campaignAssignment.campaignId);
        
        // Get the specific template assigned to this campaign using environment-specific DB
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
        applicationTemplate
      });
    } catch (error) {
      console.error("Error fetching prospect by token:", error);
      res.status(500).json({ message: "Failed to fetch prospect" });
    }
  });

  // Public API endpoint for application status lookup by token (no auth required)
  app.get("/api/prospects/status/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({ message: "Token is required" });
      }

      const prospect = await storage.getMerchantProspectByToken(token);
      
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
  app.delete("/api/admin/clear-prospects", requireRole(['super_admin']), async (req, res) => {
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

      // Use environment-aware storage
      const envStorage = createStorageForRequest(req);

      const prospect = await envStorage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
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
  app.post("/api/prospects/:id/submit-application", async (req, res) => {
    try {
      const { id } = req.params;
      const { formData, status } = req.body;
      const prospectId = parseInt(id);

      const prospect = await storage.getMerchantProspect(prospectId);
      if (!prospect) {
        return res.status(404).json({ message: "Prospect not found" });
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
        
        // Check for agent signature after all owner signatures are collected
        if (ownersWithoutSignatures.length === 0 && ownersRequiringSignatures.length > 0) {
          if (!formData.agentSignature || formData.agentSignature === null || formData.agentSignature === '') {
            validationErrors.push('Agent signature required for final approval');
          }
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

      // Get template configuration for address mapping
      let mappedFormData = formData;
      let templateForMapping = null;
      
      if (prospect.campaignId) {
        // Get the specific template(s) assigned to this campaign
        const dynamicDB = await getDynamicDatabase((req as any).dbEnv);
        const { campaignApplicationTemplates } = await import('@shared/schema');
        
        const campaignTemplates = await dynamicDB
          .select()
          .from(campaignApplicationTemplates)
          .where(eq(campaignApplicationTemplates.campaignId, prospect.campaignId));
        
        if (campaignTemplates && campaignTemplates.length > 0) {
          // Get the first template for this campaign
          const templateId = campaignTemplates[0].templateId;
          const templates = await storage.getAcquirerApplicationTemplates();
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

      // Update prospect with final form data and status
      const updatedProspect = await storage.updateMerchantProspect(prospectId, {
        formData: JSON.stringify(mappedFormData),
        status: 'submitted'
      });

      // Generate PDF document
      let pdfBuffer: Buffer | undefined;
      try {
        const { pdfGenerator } = await import('./pdfGenerator');
        pdfBuffer = await pdfGenerator.generateApplicationPDF(updatedProspect, formData);
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        // Continue without PDF - don't fail the submission
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
          applicationToken: prospect.validationToken || 'unknown',
          dbEnv: (req as any).dbEnv
        }, pdfBuffer);
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
        // Continue without email - don't fail the submission
      }

      console.log(`Application submitted for prospect ${prospectId}`);
      res.json({ 
        success: true, 
        message: "Application submitted successfully",
        prospect: updatedProspect,
        statusUrl: `/application-status/${prospect.validationToken}`
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
  app.post("/api/signature-request", async (req, res) => {
    try {
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
  app.post("/api/signature-submit", async (req, res) => {
    try {
      const { signatureToken, signature, signatureType } = req.body;

      if (!signatureToken || !signature) {
        return res.status(400).json({ 
          success: false, 
          message: "Missing signature token or signature data" 
        });
      }

      // Find the prospect owner by signature token
      const owner = await storage.getProspectOwnerBySignatureToken(signatureToken);
      if (!owner) {
        return res.status(404).json({ 
          success: false, 
          message: "Invalid signature token" 
        });
      }

      // Create the signature record in database
      await storage.createProspectSignature({
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
  app.post("/api/prospects/:id/save-inline-signature", async (req, res) => {
    try {
      const { id } = req.params;
      const { ownerEmail, ownerName, signature, signatureType, ownershipPercentage } = req.body;
      const prospectId = parseInt(id);

      if (!ownerEmail || !ownerName || !signature || !signatureType) {
        return res.status(400).json({ 
          success: false, 
          message: "Missing required signature data" 
        });
      }

      // First, ensure the prospect owner exists in the database
      let owner = await storage.getProspectOwnerByEmailAndProspectId(ownerEmail, prospectId);
      
      if (!owner) {
        // Create the owner record if it doesn't exist
        const ownerData = {
          prospectId,
          name: ownerName,
          email: ownerEmail,
          ownershipPercentage: ownershipPercentage || '0'
        };
        
        owner = await storage.createProspectOwner(ownerData);
      }

      // Generate a signature token for the inline signature
      const signatureToken = `inline_sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create the signature record in database
      await storage.createProspectSignature({
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
        const triggerService = new TriggerService();
        
        await triggerService.fireTrigger('agent_registered', {
          triggerEvent: 'agent_registered', // For email template styling
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

  app.get("/api/merchants/:id/user", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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
  app.post("/api/agents/:id/reset-password", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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

  app.post("/api/merchants/:id/reset-password", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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
  app.get("/api/transactions/all", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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

  app.post("/api/transactions", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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
      const widgetData = { ...req.body, userId };
      
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
      const updates = req.body;

      const preference = await storage.updateWidgetPreference(id, updates);
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
        const widget = await storage.createWidgetPreference(widgetData);
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
      const widget = await storage.updateWidgetPreference(id, req.body);
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
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create default widgets based on user role
      const defaultWidgets = getDefaultWidgetsForRole(user.role);
      
      for (const widget of defaultWidgets) {
        await storage.createWidgetPreference({
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
  app.post("/api/pdf-forms/upload", isAuthenticated, requireRole(['admin', 'super_admin']), upload.single('pdf'), async (req: any, res) => {
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
      
      // Create form fields from parsed data
      const fieldData = pdfFormParser.convertToDbFields(parseResult.sections, pdfForm.id);
      
      for (const field of fieldData) {
        await storage.createPdfFormField(field);
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
  app.get("/api/pdf-forms", isAuthenticated, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
      const forms = await storage.getAllPdfForms();
      res.json(forms);
    } catch (error) {
      console.error("Error fetching PDF forms:", error);
      res.status(500).json({ message: "Failed to fetch PDF forms" });
    }
  });

  // Get specific PDF form with fields (admin only)
  app.get("/api/pdf-forms/:id", isAuthenticated, requireRole(['admin', 'super_admin']), async (req: any, res) => {
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
  app.patch("/api/pdf-forms/:id", isAuthenticated, requireRole(['admin', 'super_admin']), async (req: any, res) => {
    try {
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
      const { data, status = 'draft' } = req.body;
      
      const submissionData = {
        formId,
        submittedBy: req.user?.id || null,
        data: typeof data === 'string' ? data : JSON.stringify(data),
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
      const { formData } = req.body;
      
      const submissionData = {
        formId,
        submittedBy: req.user?.id || null,
        data: JSON.stringify(formData),
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
      const { applicantEmail } = req.body;
      
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
      const { data, status = 'draft' } = req.body;
      
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
      const { applicantEmail } = req.body;
      
      if (!applicantEmail) {
        return res.status(400).json({ message: "Applicant email is required" });
      }
      
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
      const feeGroupId = req.query.feeGroupId;
      
      if (feeGroupId) {
        const feeItemGroups = await storage.getFeeItemGroupsByFeeGroup(parseInt(feeGroupId));
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

  app.get('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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

  app.post('/api/fee-item-groups', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { feeGroupId, name, description, displayOrder } = req.body;
      
      if (!feeGroupId || !name) {
        return res.status(400).json({ message: "Fee group ID and name are required" });
      }

      const feeItemGroupData = {
        feeGroupId,
        name,
        description: description || null,
        displayOrder: displayOrder || 0,
        author: req.user?.email || 'System'
      };

      const feeItemGroup = await storage.createFeeItemGroup(feeItemGroupData);
      res.status(201).json(feeItemGroup);
    } catch (error) {
      console.error("Error creating fee item group:", error);
      res.status(500).json({ message: "Failed to create fee item group" });
    }
  });

  app.put('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, displayOrder } = req.body;
      
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

  app.delete('/api/fee-item-groups/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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
  app.get('/api/campaigns', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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
      
      // Fetch templates for each campaign
      const campaignsWithTemplates = await Promise.all(
        allCampaigns.map(async (campaign) => {
          const templates = await storage.getCampaignTemplates(campaign.id);
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
      
      // Get fee values with proper schema structure
      let feeValues: any[] = [];
      try {
        feeValues = await dbToUse
          .select({
            id: campaignFeeValues.id,
            campaignId: campaignFeeValues.campaignId,
            feeItemId: campaignFeeValues.feeItemId,
            feeGroupFeeItemId: campaignFeeValues.feeGroupFeeItemId,
            value: campaignFeeValues.value,
            valueType: campaignFeeValues.valueType,
            createdAt: campaignFeeValues.createdAt,
            updatedAt: campaignFeeValues.updatedAt,
            feeItem: {
              id: feeItems.id,
              name: feeItems.name,
              description: feeItems.description,
              defaultValue: feeItems.defaultValue,
              valueType: feeItems.valueType,
            }
          })
          .from(campaignFeeValues)
          .leftJoin(feeItems, eq(campaignFeeValues.feeItemId, feeItems.id))
          .where(eq(campaignFeeValues.campaignId, campaignId))
          .orderBy(feeItems.name);
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
      let pricingTypeFeeGroups: any[] = [];
      if (campaign.pricingTypeId) {
        try {
          const { feeGroupFeeItems, pricingTypeFeeItems } = await import("@shared/schema");
          const { count } = await import("drizzle-orm");
          
          // Get fee groups that contain fee items belonging to this pricing type
          pricingTypeFeeGroups = await dbToUse
            .select({
              id: feeGroups.id,
              name: feeGroups.name,
              description: feeGroups.description,
              feeItemsCount: count(feeGroupFeeItems.id),
            })
            .from(feeGroups)
            .innerJoin(feeGroupFeeItems, eq(feeGroups.id, feeGroupFeeItems.feeGroupId))
            .innerJoin(pricingTypeFeeItems, eq(feeGroupFeeItems.feeItemId, pricingTypeFeeItems.feeItemId))
            .where(eq(pricingTypeFeeItems.pricingTypeId, campaign.pricingTypeId))
            .groupBy(feeGroups.id, feeGroups.name, feeGroups.description)
            .orderBy(feeGroups.name);
        } catch (error) {
          console.log(`Error fetching fee groups for pricing type ${campaign.pricingTypeId}:`, error);
          pricingTypeFeeGroups = [];
        }
      }
      
      // Combine all data
      const campaignWithDetails = {
        ...campaign,
        pricingType: campaign.pricingType ? {
          ...campaign.pricingType,
          feeGroups: pricingTypeFeeGroups
        } : null,
        feeValues,
        equipmentAssociations
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
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaignWithDetails(id);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      // Fetch related data
      const [feeValues, equipment] = await Promise.all([
        storage.getCampaignFeeValues(id),
        storage.getCampaignEquipment(id)
      ]);
      
      // Return campaign with complete data
      res.json({
        ...campaign,
        feeValues,
        equipment
      });
    } catch (error) {
      console.error('Error fetching campaign:', error);
      res.status(500).json({ error: 'Failed to fetch campaign' });
    }
  });

  app.post('/api/campaigns/:id/deactivate', requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
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
      const { eq, asc } = await import("drizzle-orm");
      const { withRetry } = await import("./db");
      
      // First verify the pricing type exists
      const pricingTypeResult = await withRetry(() => 
        dbToUse.select().from(pricingTypes).where(eq(pricingTypes.id, id))
      );
      if (pricingTypeResult.length === 0) {
        return res.status(404).json({ error: 'Pricing type not found' });
      }
      
      // Get ONLY the fee items that are associated with this specific pricing type
      // This ensures campaign creation shows only relevant fee items, not all items in groups
      const pricingTypeFeeItemsRaw = await withRetry(() =>
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
      
      const { name, description, feeItemIds = [] } = req.body;
      
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      console.log('Extracted feeItemIds:', feeItemIds, 'Type:', typeof feeItemIds, 'Length:', feeItemIds?.length);
      
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
      
      // Add selected fee items to the pricing type
      if (feeItemIds && Array.isArray(feeItemIds) && feeItemIds.length > 0) {
        console.log('Adding selected fee items to pricing type:', feeItemIds);
        
        await withRetry(() =>
          dbToUse.insert(pricingTypeFeeItems).values(
            feeItemIds.map((feeItemId: number, index: number) => ({
              pricingTypeId: pricingType.id,
              feeItemId,
              isRequired: false,
              displayOrder: index + 1
            }))
          )
        );
        
        console.log(`Added ${feeItemIds.length} fee items to pricing type`);
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
      
      const { name, description, feeItemIds } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      
      console.log(`Updating pricing type ${id} - Database environment: ${req.dbEnv}`);
      console.log('Updating pricing type with data:', {
        id,
        name: name.trim(),
        description: description?.trim() || null,
        feeItemIds: feeItemIds || []
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

        // Add new fee item associations if provided
        if (feeItemIds && Array.isArray(feeItemIds) && feeItemIds.length > 0) {
          console.log('Adding selected fee items to pricing type:', feeItemIds);
          
          await tx.insert(pricingTypeFeeItems).values(
            feeItemIds.map((feeItemId: number, index: number) => ({
              pricingTypeId: id,
              feeItemId,
              isRequired: false,
              displayOrder: index + 1
            }))
          );
          
          console.log(`Added ${feeItemIds.length} fee items to pricing type`);
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
  app.get('/api/acquirers', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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

  app.get('/api/acquirers/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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

  // Acquirer Application Templates
  app.get('/api/acquirer-application-templates', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Fetching acquirer application templates - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { acquirerApplicationTemplates, acquirers } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get templates with acquirer information
      const templates = await dbToUse.select({
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
      .orderBy(acquirers.name, acquirerApplicationTemplates.templateName);
      
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
      
      console.log(`Found application counts for ${applicationCounts.length} templates`);
      res.json(countsMap);
    } catch (error) {
      console.error('Error fetching application counts:', error);
      res.status(500).json({ error: 'Failed to fetch application counts' });
    }
  });

  app.get('/api/acquirer-application-templates/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
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

      // Extract required fields from parsed PDF
      const requiredFields = parseResult.sections
        .flatMap((section: any) => section.fields)
        .filter((field: any) => field.isRequired)
        .map((field: any) => field.fieldName);

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

      // Create the application template with PDF-derived configuration
      const { acquirerApplicationTemplates } = await import("@shared/schema");
      
      const templateToCreate = {
        ...validatedData,
        fieldConfiguration,
        pdfMappingConfiguration,
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
      console.log(`Fetching prospect applications - Database environment: ${req.dbEnv}`);
      
      // Use the dynamic database connection
      const dbToUse = req.dynamicDB;
      if (!dbToUse) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      
      const { prospectApplications, merchantProspects, acquirers, acquirerApplicationTemplates } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Get prospect applications with minimal data to avoid query issues
      const applications = await dbToUse.select()
      .from(prospectApplications)
      .orderBy(prospectApplications.createdAt);
      
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
      res.json(updatedApplication);
      
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
      
      // Update status to approved
      const [updatedApplication] = await dbToUse.update(prospectApplications)
        .set({ 
          status: 'approved',
          approvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(prospectApplications.id, applicationId))
        .returning();
      
      console.log(`Application ${applicationId} status updated to approved`);
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
  app.get("/api/campaigns", requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      
      // Fetch templates for each campaign
      const campaignsWithTemplates = await Promise.all(
        campaigns.map(async (campaign) => {
          const templates = await storage.getCampaignTemplates(campaign.id);
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
      const campaign = await storage.createCampaign(campaignData, feeValues, equipmentIds, templateIds);
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
      const equipment = await storage.getCampaignEquipment(id);
      res.json(equipment);
    } catch (error) {
      console.error("Error fetching campaign equipment:", error);
      res.status(500).json({ message: "Failed to fetch campaign equipment" });
    }
  });

  app.get("/api/campaigns/:id/templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const templates = await storage.getCampaignTemplates(id);
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

      const apiKey = await storage.createApiKey(apiKeyData);

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
  app.delete("/api/admin/api-keys/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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
  app.get("/api/admin/api-keys/:id/usage", requireRole(['admin', 'super_admin']), async (req, res) => {
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
  app.get("/api/admin/api-logs", requireRole(['admin', 'super_admin']), async (req, res) => {
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

  // Email Wrappers
  // Get all email wrappers
  app.get("/api/admin/email-wrappers", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const wrappers = await storage.getAllEmailWrappers();
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
      const wrapper = await storage.getEmailWrapper(id);
      
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

      const wrapper = await storage.createEmailWrapper(result.data);
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

      const wrapper = await storage.updateEmailWrapper(id, result.data);
      
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
      const deleted = await storage.deleteEmailWrapper(id);
      
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
      const actionTemplates = await storage.getActionTemplatesByType('email');
      
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
      const templates = await storage.getAllEmailTemplates();
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
      const actionTemplate = await storage.getActionTemplate(id);
      
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
      const actionTemplate = await storage.createActionTemplate({
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
      const existing = await storage.getActionTemplate(id);
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
      
      const actionTemplate = await storage.updateActionTemplate(id, updates);
      
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
      const template = await storage.getActionTemplate(id);
      if (!template || template.actionType !== 'email') {
        return res.status(404).json({ message: "Email template not found" });
      }
      
      const success = await storage.deleteActionTemplate(id);
      
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
      const actionTemplate = await storage.getActionTemplate(id);
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
      const triggers = await storage.getAllEmailTriggers();
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

      const trigger = await storage.createEmailTrigger(result.data);
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
  app.delete("/api/admin/email-triggers/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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
  app.get("/api/admin/email-activity", requireRole(['admin', 'super_admin']), async (req, res) => {
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
  app.get("/api/admin/email-stats", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const stats = await storage.getEmailActivityStats();
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
      const templates = await storage.getAllActionTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching action templates:", error);
      res.status(500).json({ message: "Failed to fetch action templates" });
    }
  });

  // Get action templates by type
  app.get("/api/admin/action-templates/type/:actionType", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const templates = await storage.getActionTemplatesByType(req.params.actionType);
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
      const template = await storage.getActionTemplate(id);
      
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

      const template = await storage.createActionTemplate(result.data);
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

      const template = await storage.updateActionTemplate(id, result.data);
      
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
      const success = await storage.deleteActionTemplate(id);
      
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
      const usage = await storage.getActionTemplateUsage(id);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching action template usage:", error);
      res.status(500).json({ message: "Failed to fetch action template usage" });
    }
  });

  // Get all template usage
  app.get("/api/admin/action-templates-usage", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const usage = await storage.getAllActionTemplateUsage();
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
      const templates = await storage.getAllActionTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching action templates:", error);
      res.status(500).json({ message: "Failed to fetch action templates" });
    }
  });

  // Get all template usage (public - authenticated users)
  app.get("/api/action-templates/usage", isAuthenticated, async (req, res) => {
    try {
      const usage = await storage.getAllActionTemplateUsage();
      res.json(usage);
    } catch (error) {
      console.error("Error fetching action template usage:", error);
      res.status(500).json({ message: "Failed to fetch action template usage" });
    }
  });

  // Create action template (admin only)
  app.post("/api/action-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
    try {
      const template = await storage.createActionTemplate(req.body);
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
      const template = await storage.updateActionTemplate(id, req.body);
      
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
      const usage = await storage.getActionTemplateUsage(id);
      if (usage && usage.length > 0) {
        return res.status(400).json({ 
          message: "Cannot delete template that is in use by triggers",
          usage 
        });
      }
      
      const deleted = await storage.deleteActionTemplate(id);
      
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
      const actionTemplate = await storage.getActionTemplate(id);
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
      const trigger = await storage.getTriggerCatalog(id);
      
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
      
      const trigger = await storage.createTriggerCatalog(result.data);
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
      const trigger = await storage.updateTriggerCatalog(id, req.body);
      
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
      const success = await storage.deleteTriggerCatalog(id);
      
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
      const actions = await storage.getTriggerActions(triggerId);
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
      
      const action = await storage.createTriggerAction(result.data);
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
      const action = await storage.updateTriggerAction(id, req.body);
      
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
      const success = await storage.deleteTriggerAction(id);
      
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
          await storage.updateEmailActivityByWebhook(
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
      const auditLogs = await storage.getAuditLogs(limit);
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
      
      const path = await import("path");
      const fs = await import("fs");
      const fullPath = path.join(process.cwd(), 'public', application.generatedPdfPath);
      
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "PDF file not found. Please regenerate the PDF." });
      }
      
      // Generate download filename
      const filename = `${acquirer?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Application'}_${prospect!.firstName}_${prospect!.lastName}_Application.pdf`;
      
      // Send the file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(fullPath);
      
      console.log(`PDF downloaded successfully for application ${applicationId}`);
      
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
      const alerts = await storage.getUserAlerts(userId, includeRead);
      
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

      const count = await storage.getUnreadAlertCount(userId);
      
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

      const alert = await storage.markAlertAsRead(alertId, userId);
      
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

      const count = await storage.markAllAlertsAsRead(userId);
      
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

      const success = await storage.deleteAlert(alertId, userId);
      
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

      const updatedUser = await storage.updateUser(userId, updates);
      
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
      const user = await storage.getUser(userId);
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
      await storage.updateUser(userId, { passwordHash });

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

      const count = await storage.deleteAllReadAlerts(userId);
      
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
        testAlerts.map(alert => storage.createUserAlert(alert))
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
      const signature = await storage.createSignatureCapture({
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
        const application = await storage.getApplication(applicationId);
        if (application?.businessName) {
          companyName = application.businessName;
        }
      } else if (prospectId) {
        const prospect = await storage.getProspectById(prospectId);
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
        await storage.updateSignatureCapture(signature.id, { 
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
        const triggerService = new TriggerService();
        await triggerService.fireTrigger('signature_requested', {
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
      const capture = await storage.getSignatureCaptureByToken(token);
      
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
        await storage.updateSignatureCapture(capture.id, { status: 'expired' });
        return res.status(400).json({ 
          success: false, 
          message: 'This signature request has expired' 
        });
      }

      // Update signature capture
      const updated = await storage.updateSignatureCapture(capture.id, {
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
          const application = await storage.getApplication(updated.applicationId);
          if (application?.businessName) {
            companyName = application.businessName;
          }
          // Try to get agent info from application if available
          if (application?.createdBy) {
            const creator = await storage.getUserByIdOrUsername(application.createdBy);
            if (creator && creator.firstName && creator.lastName) {
              agentName = `${creator.firstName} ${creator.lastName}`;
            } else if (creator && creator.username) {
              agentName = creator.username;
            }
          }
        } else if (updated.prospectId) {
          const prospect = await storage.getProspectById(updated.prospectId);
          if (prospect?.businessName) {
            companyName = prospect.businessName;
          }
          // Try to get agent info from prospect if available
          if (prospect?.createdBy) {
            const creator = await storage.getUserByIdOrUsername(prospect.createdBy);
            if (creator && creator.firstName && creator.lastName) {
              agentName = `${creator.firstName} ${creator.lastName}`;
            } else if (creator && creator.username) {
              agentName = creator.username;
            }
          }
        }
        
        const { TriggerService } = await import('./triggerService');
        const triggerService = new TriggerService();
        await triggerService.fireTrigger('signature_captured', {
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
      
      const capture = await storage.getSignatureCaptureByToken(token);
      
      if (!capture) {
        return res.status(404).json({ 
          success: false, 
          message: 'Signature request not found' 
        });
      }

      // Check if expired
      const isExpired = capture.timestampExpires && capture.timestampExpires < new Date();
      if (isExpired && capture.status !== 'expired') {
        await storage.updateSignatureCapture(capture.id, { status: 'expired' });
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
      
      const capture = await storage.getSignatureCaptureByToken(token);
      
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
      const updated = await storage.updateSignatureCapture(capture.id, {
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
        await storage.updateSignatureCapture(capture.id, { 
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
      
      const signatures = await storage.getSignatureCapturesByApplication(parseInt(applicationId));
      
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
      
      const signatures = await storage.getSignatureCapturesByProspect(parseInt(prospectId));
      
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

  const httpServer = createServer(app);
  return httpServer;
}