import { Request, Response, NextFunction } from 'express';
import { getDynamicDatabase, extractDbEnv } from './db';
import { createStorage } from './storage';
import { environmentManager } from './environmentManager';

// Extend the Request interface to include database environment info
export interface RequestWithDB extends Request {
  dbEnv?: string;
  dynamicDB?: ReturnType<typeof getDynamicDatabase>;
  db?: ReturnType<typeof getDynamicDatabase>;
  userId?: string;
}

/**
 * Middleware to extract database environment from URL and attach dynamic database connection
 */
export const dbEnvironmentMiddleware = (req: RequestWithDB, res: Response, next: NextFunction) => {
  // Set userId from authentication context if available
  if (!req.userId && (req.user as any)?.id) {
    req.userId = (req.user as any).id;
  }
  
  // Check if we're in production deployment environment 
  const host = req.get('host') || '';
  const isProductionDomain = host === 'crm.charrg.com';
  
  // Only production domain is locked to production database
  if (isProductionDomain) {
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', 'production');
    console.log('Production domain: using production database');
    next();
    return;
  }
  
  // For non-production domains, use the globally selected environment (via admin dropdown)
  // This takes precedence over session to allow runtime environment switching
  const globalEnv = environmentManager.getGlobalEnvironment();
  req.dbEnv = globalEnv;
  req.dynamicDB = getDynamicDatabase(globalEnv);
  req.db = req.dynamicDB;
  res.setHeader('X-Database-Environment', globalEnv);
  console.log(`Non-production domain: using ${globalEnv} database (global selection)`);
  
  next();
};

/**
 * Helper function to get the appropriate database connection from request
 */
export const getRequestDB = (req: RequestWithDB) => {
  return req.dynamicDB || getDynamicDatabase();
};

/**
 * Helper function to create an environment-aware storage instance for a request
 * Uses the request's dynamic database connection to ensure data goes to the correct environment
 */
export const createStorageForRequest = (req: RequestWithDB) => {
  const dynamicDB = getRequestDB(req);
  return createStorage(dynamicDB);
};

/**
 * Middleware specifically for admin routes that allows database switching for super_admin users
 */
export const adminDbMiddleware = (req: RequestWithDB, res: Response, next: NextFunction) => {
  // Check if we're in production deployment environment
  const isProductionDomain = req.get('host') === 'crm.charrg.com';
  
  if (isProductionDomain) {
    // Force production database for production deployments - no selection allowed
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    res.setHeader('X-Database-Environment', 'production');
    console.log('Admin middleware: production deployment - forcing production database');
    next();
    return;
  }
  
  // In development, allow database switching for super_admin users
  const currentUser = (req as any).currentUser;
  
  if (currentUser?.role === 'super_admin') {
    // Allow database switching for super_admin users
    dbEnvironmentMiddleware(req, res, next);
  } else {
    // Regular users always use production database
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    res.setHeader('X-Database-Environment', 'production');
    console.log('Admin middleware: non-super_admin user - using production database');
    next();
  }
};