import { Request, Response, NextFunction } from 'express';
import { getDynamicDatabase, extractDbEnv } from './db';

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
  if (!req.userId && req.user?.id) {
    req.userId = req.user.id;
  }
  
  // Check if we're in a production deployment environment (Replit production domain)
  const isProductionDomain = req.get('host')?.includes('.replit.app') || 
                            req.get('host')?.includes('charrg.com') ||
                            process.env.NODE_ENV === 'production';
  
  if (isProductionDomain) {
    // Force production database for production deployments
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', 'production');
    console.log('Production deployment: forcing production database');
    next();
    return;
  }
  
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
  
  // Extract database environment from URL parameters, headers, or subdomain
  const dbEnv = extractDbEnv(req);
  
  if (dbEnv && ['test', 'development', 'dev'].includes(dbEnv)) {
    req.dbEnv = dbEnv;
    req.dynamicDB = getDynamicDatabase(dbEnv);
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', dbEnv);
    console.log(`Database switching: using ${dbEnv} database`);
  } else {
    // Use default production database
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', 'production');
    console.log('Using default production database');
  }
  
  next();
};

/**
 * Helper function to get the appropriate database connection from request
 */
export const getRequestDB = (req: RequestWithDB) => {
  return req.dynamicDB || getDynamicDatabase();
};

/**
 * Middleware specifically for admin routes that allows database switching for super_admin users
 */
export const adminDbMiddleware = (req: RequestWithDB, res: Response, next: NextFunction) => {
  // Check if we're in a production deployment environment
  const isProductionDomain = req.get('host')?.includes('.replit.app') || 
                            req.get('host')?.includes('charrg.com') ||
                            process.env.NODE_ENV === 'production';
  
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