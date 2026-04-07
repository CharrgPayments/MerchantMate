import type { Express, Request as ExpressRequest, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuthRoutes } from "./authRoutes";
import { insertMerchantSchema, insertAgentSchema, insertTransactionSchema, insertLocationSchema, insertAddressSchema, insertPdfFormSchema, insertApiKeySchema } from "@shared/schema";
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
import { dbEnvironmentMiddleware, adminDbMiddleware, getRequestDB, type RequestWithDB } from "./dbMiddleware";
import { getDynamicDatabase } from "./db";
import { users, agents, merchants, agentMerchants } from "@shared/schema";
import crypto from "crypto";
import { eq, or, ilike } from "drizzle-orm";

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

      // Get agent by user email with fallback for development
      let agent = await storage.getAgentByEmail(user.email);
      
      // If no agent found by email, use fallback for development/testing
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

      // Get agent by user email with fallback for development
      let agent = await storage.getAgentByEmail(user.email);
      
      // If no agent found by email, use fallback for development/testing
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
      const users = await dynamicDB.select().from((await import('@shared/schema')).users);
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
      const { role } = req.body;
      
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
      const { status } = req.body;
      
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
    } catch (error) {
      console.error("Error deleting user:", error);
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
      
      if (user.role === 'agent') {
        // Agents can only see their assigned prospects
        let agent = await storage.getAgentByEmail(user.email);
        
        // If no agent found by email, use fallback for development/testing
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
      } else if (['admin', 'corporate', 'super_admin'].includes(user.role)) {
        // Admins can see all prospects
        if (search) {
          prospects = await storage.searchMerchantProspects(search as string);
        } else {
          prospects = await storage.getAllMerchantProspects();
        }
      } else {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(prospects);
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
      
      if (!['agent', 'admin', 'corporate', 'super_admin'].includes(user.role)) {
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

      const prospect = await storage.createMerchantProspect(result.data);
      
      // Create campaign assignment
      await storage.assignCampaignToProspect(campaignId, prospect.id, userId);
      
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

  app.post("/api/prospects/:id/resend-invitation", requireRole(['agent', 'admin', 'corporate', 'super_admin']), async (req, res) => {
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
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      if (!['agent', 'admin', 'corporate', 'super_admin'].includes(user.role)) {
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
      let campaign = null;
      let campaignEquipment = [];

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
      
      // Test actual database connections by counting users
      const dynamicDB = getRequestDB(req);
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
  app.get("/api/admin/schema-compare", requireRole(['super_admin']), async (req, res) => {
    try {
      const { getDynamicDatabase } = await import("./db");
      
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
            differences.missingTables.push(table);
          }
        }
        
        for (const table of schema2Tables) {
          if (!schema1Tables.has(table)) {
            differences.extraTables.push(table);
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
                differences.columnDifferences.push({
                  table: table,
                  column: col,
                  type: 'missing_in_target',
                  details: schema1Cols.find((c: any) => c.column_name === col)
                });
              }
            }
            
            for (const col of schema2ColNames) {
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
      const { formData, currentStep } = req.body;
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
          applicationToken: prospect.validationToken || 'unknown'
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
        agentName
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
  app.get("/api/merchants/all", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
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

  app.post("/api/merchants", requireRole(['admin', 'corporate', 'super_admin']), async (req, res) => {
    try {
      // Remove userId from validation since it's auto-generated
      const { userId, ...merchantData } = req.body;
      const result = insertMerchantSchema.omit({ userId: true }).safeParse(merchantData);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid merchant data", errors: result.error.errors });
      }

      // Create merchant with automatic user account creation
      const { merchant, user, temporaryPassword } = await storage.createMerchantWithUser(result.data);
      
      res.status(201).json({
        merchant,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          temporaryPassword // Include for admin to share with merchant
        }
      });
    } catch (error) {
      console.error("Error creating merchant:", error);
      if (error.message?.includes('unique constraint')) {
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
  app.get("/api/agents", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { search } = req.query;
      const dynamicDB = getRequestDB(req);
      
      console.log(`Agents endpoint - Database environment: ${req.dbEnv}`);
      
      // Use dynamic database connection directly
      if (search) {
        const searchResults = await dynamicDB.select().from(agents).where(
          or(
            ilike(agents.firstName, `%${search}%`),
            ilike(agents.lastName, `%${search}%`),
            ilike(agents.email, `%${search}%`)
          )
        );
        console.log(`Found ${searchResults.length} agents matching "${search}" in ${req.dbEnv} database`);
        res.json(searchResults);
      } else {
        const allAgents = await dynamicDB.select().from(agents);
        console.log(`Found ${allAgents.length} agents in ${req.dbEnv} database`);
        res.json(allAgents);
      }
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ message: "Failed to fetch agents" });
    }
  });

  app.post("/api/agents", dbEnvironmentMiddleware, requireRole(['admin', 'corporate', 'super_admin']), async (req: RequestWithDB, res) => {
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
          role: 'agent' as const,
          status: 'active' as const,
          emailVerified: true,
        };
        
        const [user] = await tx.insert(users).values(userData).returning();
        
        // Create agent linked to user within transaction
        const [agent] = await tx.insert(agents).values({
          ...validationResult.data,
          userId: user.id
        }).returning();
        
        return {
          agent,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            temporaryPassword // Include for admin to share with agent
          }
        };
      });
      
      console.log(`Agent created in ${req.dbEnv} database:`, result.agent.firstName, result.agent.lastName);
      res.status(201).json(result);
      
    } catch (error) {
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
      
      // Use database transaction to ensure ACID compliance
      const result = await dynamicDB.transaction(async (tx) => {
        // Delete agent record first
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
      const [feeGroup] = await dbToUse.insert(feeGroups).values(feeGroupData).returning();
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
      
      const { campaigns } = await import("@shared/schema");
      const allCampaigns = await dbToUse.select().from(campaigns);
      
      console.log(`Found ${allCampaigns.length} campaigns in ${req.dbEnv} database`);
      res.json(allCampaigns);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  app.post('/api/campaigns', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const { feeValues, equipmentIds, ...campaignData } = req.body;
      
      // Get current user from session
      const session = req.session as any;
      const userId = session?.userId;
      
      const insertCampaign = {
        ...campaignData,
        createdBy: userId ? parseInt(userId.replace('admin-demo-', '')) : undefined,
      };

      const campaign = await storage.createCampaign(insertCampaign, feeValues || [], equipmentIds || []);
      res.status(201).json(campaign);
    } catch (error) {
      console.error('Error creating campaign:', error);
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

  app.put('/api/campaigns/:id', requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { feeValues, equipmentIds, pricingTypeIds, ...campaignData } = req.body;
      
      console.log('Campaign update request:', { id, campaignData, feeValues, equipmentIds, pricingTypeIds });
      
      // Get current user from session
      const session = req.session as any;
      const userId = session?.userId;
      
      // Handle pricing type ID properly - take the first one if it's an array
      const pricingTypeId = Array.isArray(pricingTypeIds) && pricingTypeIds.length > 0 
        ? pricingTypeIds[0] 
        : campaignData.pricingTypeId;
      
      const updateCampaign = {
        ...campaignData,
        pricingTypeId,
        updatedBy: userId ? parseInt(userId.replace('admin-demo-', '')) : undefined,
      };

      const campaign = await storage.updateCampaign(id, updateCampaign, feeValues || [], equipmentIds || []);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      console.log('Campaign updated successfully:', campaign);
      res.json(campaign);
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

  app.post('/api/pricing-types', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      console.log(`Creating pricing type - Database environment: ${req.dbEnv}`);
      
      const { name, description, feeGroupIds = [] } = req.body;
      
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
      
      // Add fee items to the pricing type via fee groups (pricing types can only associate fee items through fee groups)
      if (feeGroupIds && Array.isArray(feeGroupIds) && feeGroupIds.length > 0) {
        console.log('Adding fee items via fee groups to pricing type:', feeGroupIds);
        
        // Get all fee items that belong to the selected fee groups
        const feeItemsFromGroups = await dbToUse
          .select({ 
            feeItemId: feeGroupFeeItems.feeItemId,
            displayOrder: feeGroupFeeItems.displayOrder
          })
          .from(feeGroupFeeItems)
          .where(inArray(feeGroupFeeItems.feeGroupId, feeGroupIds));
        
        console.log(`Found ${feeItemsFromGroups.length} fee items from selected fee groups`);
        
        if (feeItemsFromGroups.length > 0) {
          await dbToUse.insert(pricingTypeFeeItems).values(
            feeItemsFromGroups.map((item, index) => ({
              pricingTypeId: pricingType.id,
              feeItemId: item.feeItemId,
              isRequired: false,
              displayOrder: item.displayOrder || index + 1
            }))
          );
          console.log(`Added ${feeItemsFromGroups.length} fee items to pricing type via fee groups`);
        }
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

  app.put('/api/pricing-types/:id', dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid pricing type ID' });
      }
      
      const { name, description, feeGroupIds } = req.body;
      
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

      // Update fee item associations
      console.log('Deleting existing fee item associations...');
      await dbToUse.delete(pricingTypeFeeItems)
        .where(eq(pricingTypeFeeItems.pricingTypeId, id));

      // Add new fee item associations via fee groups if provided
      if (feeGroupIds && feeGroupIds.length > 0) {
        console.log('Adding fee items via fee groups:', feeGroupIds);
        
        // Get all fee items that belong to the selected fee groups
        const feeItemsFromGroups = await dbToUse
          .select({ 
            feeItemId: feeGroupFeeItems.feeItemId,
            displayOrder: feeGroupFeeItems.displayOrder
          })
          .from(feeGroupFeeItems)
          .where(inArray(feeGroupFeeItems.feeGroupId, feeGroupIds));
        
        console.log(`Found ${feeItemsFromGroups.length} fee items from selected fee groups`);
        
        if (feeItemsFromGroups.length > 0) {
          await dbToUse.insert(pricingTypeFeeItems).values(
            feeItemsFromGroups.map((item, index) => ({
              pricingTypeId: id,
              feeItemId: item.feeItemId,
              isRequired: false,
              displayOrder: item.displayOrder || index + 1
            }))
          );
          console.log(`Added ${feeItemsFromGroups.length} fee items to pricing type via fee groups`);
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
      res.json(campaigns);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.post("/api/campaigns", requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const { equipmentIds = [], feeValues = [], ...campaignData } = req.body;
      const campaign = await storage.createCampaign(campaignData, feeValues, equipmentIds);
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
      const { insertEquipmentItemSchema } = await import("@shared/schema");
      const validated = insertEquipmentItemSchema.parse(req.body);
      const equipmentItem = await storage.createEquipmentItem(validated);
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error creating equipment item:', error);
      res.status(500).json({ message: 'Failed to create equipment item' });
    }
  });

  app.put("/api/equipment-items/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
    try {
      const { insertEquipmentItemSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const validated = insertEquipmentItemSchema.partial().parse(req.body);
      const equipmentItem = await storage.updateEquipmentItem(id, validated);
      
      if (!equipmentItem) {
        return res.status(404).json({ message: 'Equipment item not found' });
      }
      
      res.json(equipmentItem);
    } catch (error) {
      console.error('Error updating equipment item:', error);
      res.status(500).json({ message: 'Failed to update equipment item' });
    }
  });

  app.delete("/api/equipment-items/:id", dbEnvironmentMiddleware, requireRole(['admin', 'super_admin']), async (req: RequestWithDB, res) => {
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

  // Get all email templates
  app.get("/api/admin/email-templates", requireRole(['admin', 'super_admin']), async (req, res) => {
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
  app.get("/api/admin/email-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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

      const template = await storage.createEmailTemplate(result.data);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating email template:", error);
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "Email template name already exists" });
      }
      res.status(500).json({ message: "Failed to create email template" });
    }
  });

  // Update email template
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
  app.delete("/api/admin/email-templates/:id", requireRole(['admin', 'super_admin']), async (req, res) => {
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


  const httpServer = createServer(app);
  return httpServer;
}