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
 * Returns true only for the canonical production domain (crm.charrg.com).
 * test-crm.charrg.com, *.replit.app and localhost are NOT locked to production.
 */
function isHardProductionDomain(req: RequestWithDB): boolean {
  const host = req.get('host') || '';
  // Exact match — only the live production URL is locked
  return host === 'crm.charrg.com' || host === 'www.crm.charrg.com';
}

/**
 * Middleware to extract database environment from URL and attach dynamic database connection.
 *
 * Priority order:
 *   1. Hard-locked production domain (crm.charrg.com) → always production, no override
 *   2. Session value (user explicitly chose at login — wins on all other domains)
 *   3. Query-param / header (unauthenticated flows, e.g. portal login ?db=dev)
 *   4. Fallback: production
 */
export const dbEnvironmentMiddleware = (req: RequestWithDB, res: Response, next: NextFunction) => {
  if (!req.userId && req.user?.id) {
    req.userId = req.user.id;
  }

  // 1. crm.charrg.com is always production — no session or param can override this
  if (isHardProductionDomain(req)) {
    req.dbEnv = 'production';
    req.dynamicDB = getDynamicDatabase('production');
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', 'production');
    console.log('Production domain (crm.charrg.com): using production database');
    next();
    return;
  }

  // 2. Session value wins on all other domains (test-crm.charrg.com, *.replit.app, localhost)
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

  // 3. Explicit query-param or header (e.g. ?db=dev before session is established)
  const paramDbEnv = extractDbEnv(req);
  if (paramDbEnv && ['test', 'development', 'dev'].includes(paramDbEnv)) {
    req.dbEnv = paramDbEnv;
    req.dynamicDB = getDynamicDatabase(paramDbEnv);
    req.db = req.dynamicDB;
    res.setHeader('X-Database-Environment', paramDbEnv);
    console.log(`Database switching: using ${paramDbEnv} database from query/header`);
    next();
    return;
  }

  // 4. Fallback: production
  req.dbEnv = 'production';
  req.dynamicDB = getDynamicDatabase('production');
  req.db = req.dynamicDB;
  res.setHeader('X-Database-Environment', 'production');
  console.log('Using default production database');
  next();
};

/**
 * Helper function to get the appropriate database connection from request
 */
export const getRequestDB = (req: RequestWithDB) => {
  return req.dynamicDB || getDynamicDatabase();
};

/**
 * Middleware specifically for admin routes.
 * Same priority rules as dbEnvironmentMiddleware — always delegates to it.
 * crm.charrg.com is still locked to production; all other domains respect session.
 */
export const adminDbMiddleware = (req: RequestWithDB, res: Response, next: NextFunction) => {
  dbEnvironmentMiddleware(req, res, next);
};
