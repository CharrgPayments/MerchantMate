/**
 * Environment Management Routes
 * 
 * Provides API endpoints for environment management, replacing session-based system
 */

import { Express, Response } from 'express';
import { environmentManager } from './environmentManager';
import { globalEnvironmentMiddleware, RequestWithGlobalDB } from './globalEnvironmentMiddleware';
import { isAuthenticated, requireRole } from './replitAuth';
import { getAvailableEnvironments } from './db';

export function setupEnvironmentRoutes(app: Express) {
  
  /**
   * GET /api/environment
   * Returns current environment configuration for the request
   */
  app.get('/api/environment', globalEnvironmentMiddleware, (req: any, res: Response) => {
    res.json({
      success: true,
      environment: req.environmentConfig.environment,
      isProduction: req.environmentConfig.isProduction,
      url: req.environmentConfig.url,
      globalEnvironment: environmentManager.getGlobalEnvironment()
    });
  });
  
  /**
   * POST /api/admin/environment
   * Change global environment (admin only, affects non-production URLs)
   */
  app.post('/api/admin/environment', 
    globalEnvironmentMiddleware, 
    isAuthenticated, 
    requireRole(['admin', 'super_admin']), 
    (req: any, res: Response) => {
      try {
        const { environment } = req.body;
        
        if (!environment || !['development', 'test'].includes(environment)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid environment. Must be development or test.'
          });
        }
        
        // Only allow changing global environment if current request is not production
        if (req.environmentConfig.isProduction) {
          return res.status(403).json({
            success: false,
            message: 'Cannot change global environment from production URL'
          });
        }
        
        // Update global environment
        environmentManager.setGlobalEnvironment(environment);
        
        console.log(`🔄 Admin ${req.userId} changed global environment to: ${environment}`);
        
        res.json({
          success: true,
          message: `Global environment changed to ${environment}`,
          environment: environment,
          globalEnvironment: environment
        });
        
      } catch (error) {
        console.error('Error changing environment:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to change environment'
        });
      }
    }
  );
  
  /**
   * GET /api/admin/db-environment (legacy compatibility)
   * Maintains backward compatibility with existing frontend code
   */
  app.get('/api/admin/db-environment', globalEnvironmentMiddleware, (req: any, res: Response) => {
    res.json({
      success: true,
      environment: req.environmentConfig.environment,
      isProduction: req.environmentConfig.isProduction
    });
  });
  
  /**
   * GET /api/database-connection-status
   * Check available database environments and their connection status
   * Used when database connection fails for non-production environments
   */
  app.get('/api/database-connection-status', globalEnvironmentMiddleware, (req: any, res: Response) => {
    try {
      const availableEnvs = getAvailableEnvironments();
      const currentEnv = req.environmentConfig.environment;
      const isProduction = req.environmentConfig.isProduction;
      
      // Filter out URLs from response for security
      const safeEnvs = availableEnvs.map(env => ({
        environment: env.environment,
        available: env.available,
        isConfigured: !!env.url
      }));
      
      res.json({
        success: true,
        currentEnvironment: currentEnv,
        availableEnvironments: safeEnvs,
        canSwitch: !isProduction
      });
    } catch (error) {
      console.error('Error checking database connection status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check database connection status'
      });
    }
  });
}