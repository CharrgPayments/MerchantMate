import { Request, Response, NextFunction } from 'express';
import { getDynamicDatabase, extractDbEnv } from './db';
import { createStorage } from './storage';

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
  
  // Check if we're in a production deployment environment 
  const host = req.get('host') || '';
  const isProductionDomain = host === 'crm.charrg.com';
  
  // First check if there's a stored database environment in session
  const sessionDbEnv = (req.session as any)?.dbEnv;
  if (sessionDbEnv && ['test', 'development', 'dev', 'production'].includes(sessionDbEnv)) {
    req.dbEnv = sessionDbEnv;
    req.dynamicDB = getDynamicDatabase(sessionDbEnv);
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', sessionDbEnv);
    console.log(`Session database: using ${sessionDbEnv} database from session`);
    next();
    return;
  }
  
  // Check request body for database selection (e.g., from login form)
  const bodyDbEnv = req.body?.database;
  if (bodyDbEnv && ['test', 'development', 'dev', 'production'].includes(bodyDbEnv)) {
    const normalizedEnv = bodyDbEnv === 'dev' ? 'development' : bodyDbEnv;
    req.dbEnv = normalizedEnv;
    req.dynamicDB = getDynamicDatabase(normalizedEnv);
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', normalizedEnv);
    console.log(`Database from request body: using ${normalizedEnv} database`);
    next();
    return;
  }
  
  // Extract database environment from URL parameters, headers, or subdomain
  const dbEnv = extractDbEnv(req);
  
  // Allow explicit environment switching even on production domains for development/testing
  if (dbEnv && ['test', 'development', 'dev'].includes(dbEnv)) {
    req.dbEnv = dbEnv;
    req.dynamicDB = getDynamicDatabase(dbEnv);
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', dbEnv);
    console.log(`Database switching: using ${dbEnv} database (production domain: ${isProductionDomain})`);
    next();
    return;
  }
  
  if (isProductionDomain) {
    // Use production database for production deployments (default behavior)
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', 'production');
    console.log('Production deployment: using production database');
    next();
    return;
  }
  
  // If no explicit environment selection, use development database for non-production domains
  req.dbEnv = 'development';
  req.dynamicDB = getDynamicDatabase('development');
  req.db = req.dynamicDB;
  res.setHeader('X-Database-Environment', 'development');
  console.log('Non-production domain: using default development database');
  
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
  // Check if we're in a production deployment environment
  const isProductionDomain = req.get('host') === 'crm.charrg.com';
  
  if (isProductionDomain) {
    // Force production database for production deployments
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