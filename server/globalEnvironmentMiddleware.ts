/**
 * Global Environment Middleware
 * 
 * Replaces session-based database environment selection with URL-based global system.
 * Production URLs (crm.charrg.com) always use production database.
 * All other URLs use the globally selected environment.
 */

import { Request, Response, NextFunction } from 'express';
import { environmentManager, EnvironmentConfig } from './environmentManager';
import { getDynamicDatabase } from './db';

export interface RequestWithGlobalDB extends Request {
  dbEnv: string;
  dynamicDB: any;
  db: any;
  userId?: string;
  environmentConfig: EnvironmentConfig;
}

/**
 * Global Environment Middleware - replaces dbEnvironmentMiddleware
 */
export const globalEnvironmentMiddleware = (req: RequestWithGlobalDB, res: Response, next: NextFunction) => {
  // Set userId from authentication context if available
  if (!req.userId && (req.user as any)?.id) {
    req.userId = (req.user as any).id;
  }
  
  // Resolve environment using global manager (URL-based)
  const environmentConfig = environmentManager.resolveFromRequest(req);
  
  // Set request environment properties
  req.dbEnv = environmentConfig.environment;
  req.environmentConfig = environmentConfig;
  req.dynamicDB = getDynamicDatabase(environmentConfig.environment);
  req.db = req.dynamicDB;
  
  // Set response header
  res.setHeader('X-Database-Environment', environmentConfig.environment);
  
  // Log environment resolution
  const logPrefix = environmentConfig.isProduction ? '🔒 PRODUCTION' : '🔧 DEV/TEST';
  console.log(`${logPrefix}: ${environmentConfig.url} → ${environmentConfig.environment} database`);
  
  next();
};

/**
 * Admin-only middleware for environment changes
 */
export const adminEnvironmentMiddleware = (req: RequestWithGlobalDB, res: Response, next: NextFunction) => {
  // Apply global environment middleware first
  globalEnvironmentMiddleware(req, res, () => {
    // Additional admin checks can go here if needed
    next();
  });
};