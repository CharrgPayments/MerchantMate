import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { ApiKey } from "@shared/schema";

// Extended request interface for API authentication
export interface ApiRequest extends Request {
  apiKey?: ApiKey;
  apiKeyId?: number;
}

// Rate limiting storage (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Middleware to authenticate API requests using API keys
 */
export const authenticateApiKey = async (
  req: ApiRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing or invalid Authorization header',
        message: 'Please provide a valid API key in the Authorization header as "Bearer YOUR_API_KEY"'
      });
      return;
    }

    const apiKeyValue = authHeader.substring(7); // Remove "Bearer " prefix
    
    // Parse API key format: keyId.keySecret
    const [keyId, keySecret] = apiKeyValue.split('.');
    if (!keyId || !keySecret) {
      res.status(401).json({
        error: 'Invalid API key format',
        message: 'API key must be in format: keyId.keySecret'
      });
      return;
    }

    // Find API key in database
    const apiKey = await storage.getApiKeyByKeyId(keyId);
    if (!apiKey) {
      res.status(401).json({
        error: 'Invalid API key',
        message: 'API key not found'
      });
      return;
    }

    // Check if API key is active
    if (!apiKey.isActive) {
      res.status(401).json({
        error: 'API key disabled',
        message: 'This API key has been disabled'
      });
      return;
    }

    // Check if API key has expired
    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      res.status(401).json({
        error: 'API key expired',
        message: 'This API key has expired'
      });
      return;
    }

    // Verify the secret
    const isValidSecret = await bcrypt.compare(keySecret, apiKey.keySecret);
    if (!isValidSecret) {
      res.status(401).json({
        error: 'Invalid API key',
        message: 'API key authentication failed'
      });
      return;
    }

    // Check rate limiting
    const rateLimitKey = `${apiKey.id}:${new Date().getHours()}`;
    const currentUsage = rateLimitStore.get(rateLimitKey) || { count: 0, resetTime: Date.now() + 3600000 };
    
    if (currentUsage.count >= (apiKey.rateLimit || 1000)) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Rate limit of ${apiKey.rateLimit} requests per hour exceeded`,
        resetTime: new Date(currentUsage.resetTime).toISOString()
      });
      return;
    }

    // Update rate limiting
    rateLimitStore.set(rateLimitKey, {
      count: currentUsage.count + 1,
      resetTime: currentUsage.resetTime
    });

    // Update last used timestamp
    await storage.updateApiKeyLastUsed(apiKey.id);

    // Attach API key info to request
    req.apiKey = apiKey;
    req.apiKeyId = apiKey.id;

    next();
  } catch (error) {
    console.error('API authentication error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
};

/**
 * Middleware to check if API key has specific permissions
 */
export const requireApiPermission = (permission: string) => {
  return (req: ApiRequest, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required'
      });
      return;
    }

    const permissions = Array.isArray(req.apiKey.permissions) ? req.apiKey.permissions : [];
    
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      res.status(403).json({
        error: 'Insufficient permissions',
        message: `This API key does not have permission: ${permission}`,
        requiredPermission: permission,
        availablePermissions: permissions
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to log API requests
 */
export const logApiRequest = async (
  req: ApiRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  
  // Override res.json to capture response data
  const originalJson = res.json;
  let responseSize = 0;
  
  res.json = function(body) {
    responseSize = JSON.stringify(body).length;
    return originalJson.call(this, body);
  };

  // Log after response is sent
  res.on('finish', async () => {
    try {
      const responseTime = Date.now() - startTime;
      const requestSize = JSON.stringify(req.body || {}).length;
      
      await storage.createApiRequestLog({
        apiKeyId: req.apiKeyId || null,
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        responseTime,
        userAgent: req.get('User-Agent') || null,
        ipAddress: req.ip || req.connection.remoteAddress || null,
        requestSize,
        responseSize,
        errorMessage: res.statusCode >= 400 ? `${res.statusCode} ${res.statusMessage}` : null,
      });
    } catch (error) {
      console.error('Error logging API request:', error);
    }
  });

  next();
};

/**
 * Generate a new API key pair
 */
export const generateApiKey = async (): Promise<{ keyId: string; keySecret: string; fullKey: string }> => {
  // Generate key ID (public part)
  const keyId = 'ak_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Generate secret (private part)
  const keySecret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Hash the secret for storage
  const hashedSecret = await bcrypt.hash(keySecret, 12);
  
  return {
    keyId,
    keySecret,
    fullKey: `${keyId}.${keySecret}`
  };
};

/**
 * Available API permissions
 */
export const API_PERMISSIONS = {
  // Read permissions
  'merchants:read': 'Read merchant information',
  'agents:read': 'Read agent information',
  'transactions:read': 'Read transaction data',
  'locations:read': 'Read location information',
  'prospects:read': 'Read prospect information',
  'campaigns:read': 'Read campaign information',
  'equipment:read': 'Read equipment information',
  
  // Write permissions
  'merchants:write': 'Create and update merchants',
  'agents:write': 'Create and update agents',
  'transactions:write': 'Create and update transactions',
  'locations:write': 'Create and update locations',
  'prospects:write': 'Create and update prospects',
  'campaigns:write': 'Create and update campaigns',
  'equipment:write': 'Create and update equipment',
  
  // Delete permissions
  'merchants:delete': 'Delete merchant records',
  'agents:delete': 'Delete agent records',
  'transactions:delete': 'Delete transaction records',
  'locations:delete': 'Delete location records',
  'prospects:delete': 'Delete prospect records',
  'campaigns:delete': 'Delete campaign records',
  'equipment:delete': 'Delete equipment records',
  
  // Special permissions
  '*': 'Full access to all endpoints'
} as const;

export type ApiPermission = keyof typeof API_PERMISSIONS;