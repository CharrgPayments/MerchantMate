import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Check which database environments are available
export function getAvailableEnvironments(): { environment: string; url: string | undefined; available: boolean }[] {
  return [
    { 
      environment: 'production', 
      url: process.env.DATABASE_URL, 
      available: !!process.env.DATABASE_URL 
    },
    { 
      environment: 'development', 
      url: process.env.DEV_DATABASE_URL, 
      available: !!process.env.DEV_DATABASE_URL 
    },
    { 
      environment: 'test', 
      url: process.env.TEST_DATABASE_URL, 
      available: !!process.env.TEST_DATABASE_URL 
    }
  ];
}

// Environment-based database URL selection
// Returns the URL for the specified environment, or null if not configured
// For development: Only falls back to production if ALLOW_DEV_PROD_FALLBACK is explicitly set
export function getDatabaseUrl(environment?: string): string | null {
  switch (environment) {
    case 'test':
      // For test, return TEST_DATABASE_URL if available, otherwise null (don't fallback)
      return process.env.TEST_DATABASE_URL || null;
    case 'development':
    case 'dev':  // Handle both 'dev' and 'development'
      // For development, only fallback to production if explicitly allowed
      if (process.env.DEV_DATABASE_URL) {
        return process.env.DEV_DATABASE_URL;
      }
      // Allow fallback only if explicitly enabled (for backwards compatibility)
      if (process.env.ALLOW_DEV_PROD_FALLBACK === 'true') {
        console.warn('⚠️  WARNING: DEV_DATABASE_URL not set, falling back to production database');
        console.warn('⚠️  Set DEV_DATABASE_URL to avoid using production data in development');
        return process.env.DATABASE_URL!;
      }
      return null;
    case 'production':
    default:
      // Production always uses DATABASE_URL
      return process.env.DATABASE_URL!;
  }
}

// Get database URL based on environment - default to DEVELOPMENT for safety, not production
// Production should only be used explicitly to prevent accidental data changes
const environment = process.env.DEFAULT_DB_ENV || 'development';
const databaseUrl = getDatabaseUrl(environment);

if (!databaseUrl) {
  throw new Error(
    `DATABASE_URL must be set for environment: ${environment}. ` +
    `Available environments: production (DATABASE_URL), development (DEV_DATABASE_URL), test (TEST_DATABASE_URL)`
  );
}

// PRODUCTION SAFETY WARNING
if (environment === 'production') {
  console.warn('\n🚨 WARNING: USING PRODUCTION DATABASE CONNECTION');
  console.warn('🚨 This can cause PRODUCTION OUTAGES if schema changes are made!');
  console.warn('🚨 Ensure this is intentional for production operations only.\n');
} else {
  console.log(`📊 Database: ${environment.charAt(0).toUpperCase() + environment.slice(1)} environment`);
}

export const pool = new Pool({ 
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Set search_path to public schema for all connections
pool.on('connect', (client) => {
  client.query('SET search_path TO public', (err) => {
    if (err) {
      console.error('Error setting search_path on static pool:', err);
    }
  });
});

export const db = drizzle(pool, { schema });

// Environment switching for testing utilities
const connectionPools = new Map<string, Pool>();

export function getDynamicDatabase(environment: string = 'production') {
  if (!connectionPools.has(environment)) {
    const url = getDatabaseUrl(environment);
    
    // Guard against missing database URL
    if (!url) {
      throw new Error(
        `Database URL not configured for environment: ${environment}. ` +
        `Please set the appropriate environment variable: ` +
        `${environment === 'test' ? 'TEST_DATABASE_URL' : environment === 'development' ? 'DEV_DATABASE_URL' : 'DATABASE_URL'}`
      );
    }
    
    // Debug logging
    console.log(`🔧 Creating dynamic database pool for: ${environment}`);
    console.log(`🔧 Connection URL: ${url.substring(0, 60)}...`);
    
    const dynamicPool = new Pool({
      connectionString: url,
      max: 3, // Reduced from 5 to prevent connection overload
      idleTimeoutMillis: 15000, // Reduced from 30000 to free connections faster
      connectionTimeoutMillis: 15000, // Increased from 10000 to allow more time for connections
    });
    
    // Set search_path to public schema for all connections
    dynamicPool.on('connect', (client) => {
      client.query('SET search_path TO public', (err) => {
        if (err) {
          console.error('Error setting search_path:', err);
        }
      });
    });
    connectionPools.set(environment, dynamicPool);
  }
  
  const dynamicPool = connectionPools.get(environment)!;
  return drizzle(dynamicPool, { schema });
}

// Extract database environment from request
export function extractDbEnv(req: any): string | null {
  // Get host info
  const host = req.get ? req.get('host') : req.headers?.host || '';
  
  // Force production database for deployed applications
  const isProductionDomain = host.includes('.replit.app') || 
                            host.includes('charrg.com') ||
                            process.env.NODE_ENV === 'production';
  
  if (isProductionDomain) {
    return null; // null = production database for production domains
  }
  
  // In development/test environments, allow database switching
  // Check URL query parameter first
  if (req.query?.db && ['test', 'dev', 'development'].includes(req.query.db)) {
    console.log(`Database environment from query: ${req.query.db}`);
    return req.query.db;
  }
  
  // Check custom header
  if (req.headers['x-database-env'] && ['test', 'dev', 'development'].includes(req.headers['x-database-env'])) {
    console.log(`Database environment from header: ${req.headers['x-database-env']}`);
    return req.headers['x-database-env'];
  }
  
  // Check subdomain
  if (host.startsWith('test.')) {
    return 'test';
  }
  if (host.startsWith('dev.')) {
    return 'development';
  }
  
  // Default to null (production database)
  return null;
}

// Track if we're shutting down to prevent new operations
let isShuttingDown = false;

export function isShutdownInProgress() {
  return isShuttingDown;
}

// Cleanup function for graceful shutdown
export function closeAllConnections() {
  isShuttingDown = true;
  
  // Give some time for pending operations to complete
  setTimeout(() => {
    pool.end().catch(console.error);
    connectionPools.forEach((pool) => {
      pool.end().catch(console.error);
    });
    connectionPools.clear();
  }, 1000); // 1 second delay
}

// Database operation retry utility
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 100
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain error types (authentication, not found, etc.)
      if (error.code === '23505' || error.status === 404 || error.status === 400) {
        throw error;
      }
      
      console.warn(`Database operation failed (attempt ${i + 1}/${maxRetries + 1}):`, error.message);
      
      if (i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  }
  
  throw lastError;
}

process.on('SIGTERM', closeAllConnections);
process.on('SIGINT', closeAllConnections);
