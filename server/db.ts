import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { AsyncLocalStorage } from 'node:async_hooks';

neonConfig.webSocketConstructor = ws;

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
const dbContext = new AsyncLocalStorage<DrizzleDB>();

export function runWithDb<T>(database: DrizzleDB, fn: () => T): T {
  return dbContext.run(database, fn);
}

export function getActiveDb(): DrizzleDB {
  return dbContext.getStore() || (db as DrizzleDB);
}

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

const staticDb: DrizzleDB = drizzle({ client: pool, schema });

// Proxy that transparently routes to the per-request DB when one is bound
// via runWithDb(...) (see dbMiddleware), or falls back to the production DB.
// This lets storage.ts and auditService.ts use `db.*` unchanged.
//
// Data-tier abstraction guard: when running outside any runWithDb scope
// (e.g. an HTTP handler that forgot to be wrapped, or a background timer
// that didn't bind a context), we fall back to the static production pool.
// In dev/test we log a one-time warning per call site so regressions are
// visible without flooding production logs.
const fallbackWarned = new Set<string>();
function warnStaticFallback(prop: string | symbol): void {
  if (process.env.NODE_ENV === 'production') return;
  // Capture a short stack frame to identify the offender's call site
  const stack = new Error().stack?.split('\n').slice(3, 6).join('\n') || '';
  const key = `${String(prop)}::${stack.split('\n')[0] || ''}`;
  if (fallbackWarned.has(key)) return;
  fallbackWarned.add(key);
  console.warn(
    `[db] WARNING: db.${String(prop)} accessed outside runWithDb() — ` +
    `falling back to staticDb (production). This bypasses per-request ` +
    `environment isolation. Wrap the caller in runWithDb(...) or use ` +
    `getDynamicDatabase(env) explicitly.\n${stack}`
  );
}

export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_target, prop, receiver) {
    const store = dbContext.getStore();
    const active = store || staticDb;
    if (!store) warnStaticFallback(prop);
    const value = Reflect.get(active as any, prop, receiver);
    return typeof value === 'function' ? value.bind(active) : value;
  },
}) as DrizzleDB;

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

  // Explicit query param always wins — needed for initial login flow on any domain
  // (e.g. ?db=development on charrg.com before a session exists)
  if (req.query?.db && ['test', 'dev', 'development'].includes(req.query.db)) {
    console.log(`Database environment from query param: ${req.query.db}`);
    return req.query.db;
  }

  // Explicit header also always wins
  if (req.headers['x-database-env'] && ['test', 'dev', 'development'].includes(req.headers['x-database-env'])) {
    console.log(`Database environment from header: ${req.headers['x-database-env']}`);
    return req.headers['x-database-env'];
  }

  // Subdomain-based switching (dev-only convenience)
  if (host.startsWith('test.')) return 'test';
  if (host.startsWith('dev.')) return 'development';

  // No explicit override found — caller decides the default
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
