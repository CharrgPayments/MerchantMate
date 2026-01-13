/**
 * Global Environment Manager
 * 
 * Provides a single source of truth for database environment across the entire application.
 * Uses URL-based detection: production URLs use production, all others use global selected environment.
 */

export interface EnvironmentConfig {
  environment: 'production' | 'development' | 'test';
  isProduction: boolean;
  url: string;
}

class EnvironmentManager {
  private static instance: EnvironmentManager;
  private currentEnvironment: string = 'development';
  
  private constructor() {
    // Initialize from environment variable or default to development
    this.currentEnvironment = process.env.GLOBAL_DB_ENV || 'development';
    console.log(`🌍 EnvironmentManager initialized with: ${this.currentEnvironment}`);
  }
  
  public static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }
  
  /**
   * Resolve environment based on URL and global settings
   */
  public resolveEnvironment(host: string): EnvironmentConfig {
    const isProductionUrl = host === 'crm.charrg.com';
    
    if (isProductionUrl) {
      // Production URL always uses production database - no selection allowed
      return {
        environment: 'production',
        isProduction: true,
        url: host
      };
    }
    
    // All non-production URLs use globally selected environment (allows switching)
    return {
      environment: this.currentEnvironment as any,
      isProduction: false,
      url: host
    };
  }
  
  /**
   * Get current global environment (for non-production URLs)
   */
  public getGlobalEnvironment(): string {
    return this.currentEnvironment;
  }
  
  /**
   * Set global environment (affects all non-production requests)
   */
  public setGlobalEnvironment(env: 'development' | 'test'): void {
    if (!['development', 'test'].includes(env)) {
      throw new Error(`Invalid environment: ${env}. Must be 'development' or 'test'`);
    }
    
    this.currentEnvironment = env;
    console.log(`🔄 Global environment changed to: ${env}`);
  }
  
  /**
   * Resolve environment for a request object
   * PRIORITY: Session-based environment > Global environment
   */
  public resolveFromRequest(req: any): EnvironmentConfig {
    const host = req.get ? req.get('host') : req.headers?.host || '';
    const isProductionUrl = host === 'crm.charrg.com';
    
    // Production URL always uses production - no override allowed
    if (isProductionUrl) {
      return {
        environment: 'production',
        isProduction: true,
        url: host
      };
    }
    
    // PRIORITY: Check session-based environment (per-user isolation)
    const sessionDbEnv = req.session?.dbEnv;
    if (sessionDbEnv && ['test', 'development', 'production'].includes(sessionDbEnv)) {
      console.log(`🔐 Session-based environment: ${sessionDbEnv}`);
      return {
        environment: sessionDbEnv,
        isProduction: false,
        url: host
      };
    }
    
    // Fallback: Use global environment
    return this.resolveEnvironment(host);
  }
}

// Export singleton instance
export const environmentManager = EnvironmentManager.getInstance();

// Helper function for backward compatibility
export function getGlobalEnvironment(): string {
  return environmentManager.getGlobalEnvironment();
}

// Helper function to resolve environment from request
export function resolveEnvironmentFromRequest(req: any): EnvironmentConfig {
  return environmentManager.resolveFromRequest(req);
}