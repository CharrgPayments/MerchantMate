import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Environment-based database URL selection
function getDatabaseUrl(environment?: string): string {
  switch (environment) {
    case 'test':
      return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
    case 'development':
    case 'dev':  // Handle both 'dev' and 'development'
      return process.env.DEV_DATABASE_URL || process.env.DATABASE_URL!;
    case 'production':
    default:
      return process.env.DATABASE_URL!;
  }
}

// Get database URL based on environment - always use production to show seeded data
const environment = 'production';
const databaseUrl = getDatabaseUrl(environment);

if (!databaseUrl) {
  throw new Error(
    `DATABASE_URL must be set for environment: ${environment}. ` +
    `Available environments: production (DATABASE_URL), development (DEV_DATABASE_URL), test (TEST_DATABASE_URL)`
  );
}

console.log(`${environment.charAt(0).toUpperCase() + environment.slice(1)} database for ${environment} environment`);

export const pool = new Pool({ 
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle({ client: pool, schema });

// Environment switching for testing utilities
const connectionPools = new Map<string, Pool>();

export function getDynamicDatabase(environment: string = 'production') {
  if (!connectionPools.has(environment)) {
    const url = getDatabaseUrl(environment);
    const dynamicPool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    connectionPools.set(environment, dynamicPool);
  }
  
  const dynamicPool = connectionPools.get(environment)!;
  return drizzle({ client: dynamicPool, schema });
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

process.on('SIGTERM', closeAllConnections);
process.on('SIGINT', closeAllConnections);
