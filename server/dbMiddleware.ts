import { Request, Response, NextFunction } from 'express';
import { getDynamicDatabase, extractDbEnv } from './db';
import { createStorage } from './storage';
import { environmentManager } from './environmentManager';

// Extend the Request interface to include database environment info
export interface RequestWithDB extends Request {
  dbEnv?: string;
  dynamicDB?: ReturnType<typeof getDynamicDatabase>;
  db?: ReturnType<typeof getDynamicDatabase>;
  storage?: ReturnType<typeof createStorage>;
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
  
  // Check if we're in production or test deployment environment 
  const host = req.get('host') || '';
  const isProductionDomain = host === 'crm.charrg.com';
  const isTestDomain = host === 'test-crm.charrg.com';
  
  // Production domain is locked to production database
  if (isProductionDomain) {
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    req.storage = createStorage(req.dynamicDB);
    res.setHeader('X-Database-Environment', 'production');
    console.log('🔒 Production domain: using production database');
    next();
    return;
  }
  
  // Test domain is locked to test database
  if (isTestDomain) {
    req.dbEnv = 'test';
    req.dynamicDB = getDynamicDatabase('test');
    req.db = req.dynamicDB;
    req.storage = createStorage(req.dynamicDB);
    res.setHeader('X-Database-Environment', 'test');
    console.log('🧪 Test domain: using test database');
    next();
    return;
  }
  
  // For non-production domains:
  // 1. Check if request body OR query string contains database selection
  //    Body uses 'database' key (login form), query string uses 'db' key (email links)
  const bodyDbEnv = req.body?.database;
  const queryDbEnv = (req.query as any)?.db;
  const requestDbEnv = bodyDbEnv || queryDbEnv;
  if (requestDbEnv && ['test', 'development', 'dev'].includes(requestDbEnv)) {
    const normalizedEnv = requestDbEnv === 'dev' ? 'development' : requestDbEnv;
    // Update global environment to match the selection
    environmentManager.setGlobalEnvironment(normalizedEnv as 'development' | 'test');
    console.log(`Database selection from request (${bodyDbEnv ? 'body' : 'query'}): setting global environment to ${normalizedEnv}`);
    // For query-string-based requests (e.g. email links), set the DB immediately without
    // waiting for session, since these are unauthenticated flows
    if (queryDbEnv && !bodyDbEnv) {
      req.dbEnv = normalizedEnv;
      req.dynamicDB = getDynamicDatabase(normalizedEnv);
      req.db = req.dynamicDB;
      req.storage = createStorage(req.dynamicDB);
      res.setHeader('X-Database-Environment', normalizedEnv);
      console.log(`🔗 Query-param DB: using ${normalizedEnv} database (from ?db= param)`);
      next();
      return;
    }
  }
  
  // 2. PRIORITY: Use session-based environment if available (per-user isolation)
  const sessionDbEnv = (req.session as any)?.dbEnv;
  if (sessionDbEnv && ['test', 'development', 'production'].includes(sessionDbEnv)) {
    req.dbEnv = sessionDbEnv;
    req.dynamicDB = getDynamicDatabase(sessionDbEnv);
    req.db = req.dynamicDB;
    req.storage = createStorage(req.dynamicDB);
    res.setHeader('X-Database-Environment', sessionDbEnv);
    console.log(`🔐 Session-based DB: using ${sessionDbEnv} database (from user session)`);
    next();
    return;
  }
  
  // 3. Fallback: Use the globally selected environment
  const globalEnv = environmentManager.getGlobalEnvironment();
  req.dbEnv = globalEnv;
  req.dynamicDB = getDynamicDatabase(globalEnv);
  req.db = req.dynamicDB;
  req.storage = createStorage(req.dynamicDB);
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
    req.storage = createStorage(req.dynamicDB);
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
    req.storage = createStorage(req.dynamicDB);
    res.setHeader('X-Database-Environment', 'production');
    console.log('Admin middleware: non-super_admin user - using production database');
    next();
  }
};