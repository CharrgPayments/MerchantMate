/**
 * @jest-environment node
 *
 * Task #78 — Real-endpoint integration tests for the request-body
 * validation added in Task #69.
 *
 * Unlike `validation.routes.test.ts` (which exercises the shared Zod
 * schemas in isolation), this suite boots the actual `registerRoutes()`
 * from `server/routes.ts` against a stub-backed Express app. Heavy
 * dependencies (DB, OIDC auth, audit, email, alerts, pdf, rate limits,
 * compliance jobs, sub-route registrars) are mocked so the production
 * route handlers themselves run end-to-end.
 *
 * For each endpoint touched in Task #69, we send:
 *   - one valid payload  → expect non-400 (the handler reaches storage)
 *   - one invalid payload → expect 400 with the documented envelope:
 *       { message|error, errors|details: { formErrors, fieldErrors } }
 *
 * If a future change drops the validation, attaches the wrong schema,
 * weakens the response envelope, or rewires the route entirely, these
 * assertions will fail.
 */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

// ── Mocks (must be declared BEFORE importing routes) ──────────────────────

// `connect-pg-simple` returns a class constructor; we need it to not open
// a real connection. The session middleware itself uses express-session's
// default MemoryStore when no `store` is provided, so we mock the factory
// to return a class whose instances satisfy the session.Store interface
// well enough for express-session to skip live DB calls.
jest.mock('connect-pg-simple', () => {
  return jest.fn(() => {
    return class FakeStore {
      get(_sid: unknown, cb: (err: unknown, sess?: unknown) => void) { cb(null, undefined); }
      set(_sid: unknown, _sess: unknown, cb: (err: unknown) => void) { cb(null); }
      destroy(_sid: unknown, cb: (err: unknown) => void) { cb(null); }
      on() { /* no-op */ }
    };
  });
});

// Chainable, awaitable Drizzle stand-in. Every method returns the same
// proxy, and the proxy is itself thenable, resolving to [{ id: 1 }] —
// enough for `db.insert(t).values(v).returning()` and the various
// update/delete/select chains used by the routes under test.
// NOTE: must be inlined inside each `jest.mock` factory because Jest
// disallows referencing out-of-scope identifiers from mock factories
// (unless prefixed with `mock`). Kept here for documentation.

jest.mock('../db', () => {
  function makeChainableDb(): any {
    const target: any = function () { return target; };
    const proxy: any = new Proxy(target, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([{ id: 1 }]);
        if (prop === Symbol.toPrimitive || prop === 'toString') return undefined;
        return () => proxy;
      },
      apply() { return proxy; },
    });
    return proxy;
  }
  const fakeDb = makeChainableDb();
  return {
    db: fakeDb,
    pool: { query: jest.fn(async () => ({ rows: [] })), end: jest.fn(), on: jest.fn() },
    runWithDb: <T,>(_d: unknown, fn: () => T) => fn(),
    getActiveDb: () => fakeDb,
    getDynamicDatabase: () => fakeDb,
    extractDbEnv: () => null,
    isShutdownInProgress: () => false,
    closeAllConnections: jest.fn(),
  };
});

// `dbEnvironmentMiddleware` calls runWithDb; mock to a simple pass-through
// that just sets req.dbEnv so handlers don't blow up dereferencing it.
jest.mock('../dbMiddleware', () => {
  function makeChainableDb(): any {
    const target: any = function () { return target; };
    const proxy: any = new Proxy(target, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([{ id: 1 }]);
        if (prop === Symbol.toPrimitive || prop === 'toString') return undefined;
        return () => proxy;
      },
      apply() { return proxy; },
    });
    return proxy;
  }
  const fakeDb = makeChainableDb();
  return {
    dbEnvironmentMiddleware: (req: any, _res: any, next: NextFunction) => {
      req.dbEnv = 'production';
      req.dynamicDB = fakeDb;
      req.db = fakeDb;
      next();
    },
    adminDbMiddleware: (req: any, _res: any, next: NextFunction) => {
      req.dbEnv = 'production';
      req.dynamicDB = fakeDb;
      req.db = fakeDb;
      next();
    },
    getRequestDB: () => fakeDb,
  };
});

// Auth middlewares: bypass and inject a fake user / session.
jest.mock('../replitAuth', () => {
  const inject = (req: any, _res: any, next: NextFunction) => {
    req.session = req.session || {};
    req.session.userId = req.session.userId || 'test-user';
    req.user = req.user || { id: 'test-user', claims: { sub: 'test-user' }, role: 'super_admin' };
    next();
  };
  return {
    setupAuth: jest.fn(async () => undefined),
    isAuthenticated: inject,
    requireRole: () => inject,
    requirePerm: () => inject,
    requirePermission: () => inject,
    getSession: () => (_req: any, _res: any, next: NextFunction) => next(),
  };
});

jest.mock('../authRoutes', () => ({ setupAuthRoutes: jest.fn() }));

// Storage: every method is an auto-stubbed jest.fn that resolves to a
// generic "ok" value. Specific tests can override via storageOverrides.
const storageOverrides: Record<string, (...a: unknown[]) => unknown> = {};
jest.mock('../storage', () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string) {
      if (prop === 'then') return undefined; // not a thenable
      return (...args: unknown[]) => {
        if (storageOverrides[prop]) return storageOverrides[prop](...args);
        return Promise.resolve({ id: 1, prospectId: 1 });
      };
    },
  };
  const fakeStorage: any = new Proxy({}, handler);
  return { storage: fakeStorage, default: fakeStorage, DatabaseStorage: function () { return fakeStorage; } };
});

jest.mock('../auditService', () => ({
  auditService: { auditMiddleware: () => (_req: any, _res: any, next: NextFunction) => next() },
  AuditService: function () { return { logAction: jest.fn() }; },
}));

jest.mock('../alertService', () => ({
  createAlert: jest.fn(async () => undefined),
  createAlertForUsers: jest.fn(async () => undefined),
  createAlertForRoles: jest.fn(async () => undefined),
}));

jest.mock('../emailService', () => ({
  emailService: new Proxy({}, { get: () => jest.fn(async () => true) }),
  EmailService: function () { return {}; },
}));

jest.mock('../auditRedaction', () => ({ redactSensitive: (x: unknown) => x }));

jest.mock('../apiAuth', () => ({
  authenticateApiKey: (_req: any, _res: any, next: NextFunction) => next(),
  requireApiPermission: () => (_req: any, _res: any, next: NextFunction) => next(),
  logApiRequest: (_req: any, _res: any, next: NextFunction) => next(),
  generateApiKey: jest.fn(() => 'fake-api-key'),
}));

jest.mock('../rateLimits', () => ({
  rateLimit: () => (_req: any, _res: any, next: NextFunction) => next(),
  clearRateLimitBuckets: jest.fn(),
}));

jest.mock('../routeCatalogue', () => ({
  markInternal: () => (_req: any, _res: any, next: NextFunction) => next(),
  markSchema: () => (_req: any, _res: any, next: NextFunction) => next(),
  buildRouteCatalogue: () => [],
  publicRouteCatalogue: () => [],
  groupCatalogue: () => [],
  isInternalRoute: () => false,
}));

jest.mock('../hierarchyService', () => ({
  MAX_HIERARCHY_DEPTH: 5,
  HierarchyError: class extends Error {},
  initAgentClosure: jest.fn(), initMerchantClosure: jest.fn(),
  setAgentParent: jest.fn(), setMerchantParent: jest.fn(),
  getAgentDescendantIds: jest.fn(async () => []),
  getMerchantDescendantIds: jest.fn(async () => []),
  isAgentDescendantOf: jest.fn(async () => false),
  detachAgentForDelete: jest.fn(), detachMerchantForDelete: jest.fn(),
}));

jest.mock('../commissions', () => ({
  calculateCommissionsForTransaction: jest.fn(async () => undefined),
}));

jest.mock('../pdfParser', () => ({
  pdfFormParser: { parse: jest.fn(async () => ({ fields: [] })) },
  PDFFormParser: function () { return { parse: jest.fn(async () => ({ fields: [] })) }; },
}));

jest.mock('../underwriting/routes', () => ({ registerUnderwritingRoutes: jest.fn() }));
jest.mock('../routes/commissions', () => ({ registerCommissionsRoutes: jest.fn() }));
jest.mock('../routes/schemaSync', () => ({ registerSchemaSyncRoutes: jest.fn() }));
jest.mock('../routes/externalEndpoints', () => ({ registerExternalEndpointsRoutes: jest.fn() }));
jest.mock('../routes/dashboard', () => ({ __esModule: true, default: express.Router(), dashboardRouter: express.Router() }));
jest.mock('../routes/compliance', () => ({ __esModule: true, default: express.Router() }));
jest.mock('../routes/testing', () => ({ __esModule: true, default: express.Router() }));

jest.mock('../lib/resolveSecrets', () => ({
  resolveSecrets: (s: string) => s,
  resolveSecretsDeep: <T,>(v: T) => v,
}));

jest.mock('../lib/endpointTransport', () => ({
  applyAuth: jest.fn(),
  resolveTemplateTransport: jest.fn(async () => ({})),
  finalizeTransport: jest.fn(() => ({})),
}));

// ── Boot the real router ──────────────────────────────────────────────────
let app: Express;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub';
  process.env.SESSION_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';

  // Silence expected error logs from handlers running against stub DB so
  // they don't drown real test output. Real failures still surface via
  // assertion failures.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  // Inject portal session for the /api/portal/* tests, since
  // requireProspectPortalAuth (defined inline in registerRoutes) needs it.
  app.use((req: any, _res, next) => {
    req.session = req.session || {};
    if (req.path.startsWith('/api/portal/')) {
      req.session.portalProspectId = 1;
      req.session.portalProspectEmail = 'prospect@example.com';
    }
    next();
  });

  const { registerRoutes } = await import('../routes');
  await registerRoutes(app);
});

// Asserting the flattened shape protects against anyone "fixing" a
// failing test by switching to `format()` (deeply nested) or by
// stripping the structured errors entirely.
function expectFlattenedZodError(body: unknown, errorKey: 'errors' | 'details') {
  expect(body).toEqual(
    expect.objectContaining({
      [errorKey]: expect.objectContaining({
        formErrors: expect.any(Array),
        fieldErrors: expect.any(Object),
      }),
    }),
  );
}

// ── POST /api/campaigns ───────────────────────────────────────────────────
describe('POST /api/campaigns (real route)', () => {
  it('rejects an empty body with 400 + flattened Zod errors', async () => {
    const res = await request(app).post('/api/campaigns').send({}).expect(400);
    expect(res.body.error).toMatch(/invalid campaign payload/i);
    expectFlattenedZodError(res.body, 'details');
    expect(res.body.details.fieldErrors.name).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send({ name: 'Spring', acquirer: 'Wells Fargo', acquirerId: 1 });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── PUT /api/campaigns/:id ────────────────────────────────────────────────
describe('PUT /api/campaigns/:id (real route)', () => {
  it('rejects pricingTypeIds with wrong element type (400 + flattened errors)', async () => {
    const res = await request(app)
      .put('/api/campaigns/1')
      .send({ pricingTypeIds: ['nope'] })
      .expect(400);
    expect(res.body.error).toMatch(/invalid campaign payload/i);
    expectFlattenedZodError(res.body, 'details');
    expect(res.body.details.fieldErrors.pricingTypeIds).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app)
      .put('/api/campaigns/1')
      .send({ name: 'Renamed', pricingTypeIds: [3] });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/prospects/:id/messages ──────────────────────────────────────
describe('POST /api/prospects/:id/messages (real route)', () => {
  it('rejects empty message with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/prospects/1/messages')
      .send({ message: '' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid message payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.message).toBeDefined();
  });

  it('accepts a valid message body (returns 2xx)', async () => {
    const res = await request(app)
      .post('/api/prospects/1/messages')
      .send({ subject: 'Hello', message: 'Hi there' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/prospects/:id/file-requests ─────────────────────────────────
describe('POST /api/prospects/:id/file-requests (real route)', () => {
  it('rejects empty label with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/prospects/1/file-requests')
      .send({ label: '' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid file request payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.label).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app)
      .post('/api/prospects/1/file-requests')
      .send({ label: 'Drivers License', required: true });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/signature-request ───────────────────────────────────────────
describe('POST /api/signature-request (real route)', () => {
  it('rejects an invalid email with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/signature-request')
      .send({
        ownerName: 'Jane',
        ownerEmail: 'not-an-email',
        companyName: 'Acme',
        ownershipPercentage: 100,
        prospectId: 42,
      })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid signature request payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.ownerEmail).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    storageOverrides.getProspectOwners = async () => [];
    const res = await request(app).post('/api/signature-request').send({
      ownerName: 'Jane',
      ownerEmail: 'jane@example.com',
      companyName: 'Acme',
      ownershipPercentage: 100,
      prospectId: 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/signature-submit ────────────────────────────────────────────
describe('POST /api/signature-submit (real route)', () => {
  it('rejects empty signature/token with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/signature-submit')
      .send({ signatureToken: '', signature: '' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid signature payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.signatureToken).toBeDefined();
    expect(res.body.errors.fieldErrors.signature).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app).post('/api/signature-submit').send({
      signatureToken: 'sig_abc',
      signature: 'Jane Doe',
      signatureType: 'type',
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/prospects/:id/save-inline-signature ─────────────────────────
describe('POST /api/prospects/:id/save-inline-signature (real route)', () => {
  it('rejects malformed email + missing signatureType with 400', async () => {
    const res = await request(app)
      .post('/api/prospects/1/save-inline-signature')
      .send({ ownerEmail: 'nope', ownerName: 'Jane', signature: 'Jane' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid inline signature payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.ownerEmail).toBeDefined();
    expect(res.body.errors.fieldErrors.signatureType).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app).post('/api/prospects/1/save-inline-signature').send({
      ownerEmail: 'jane@example.com',
      ownerName: 'Jane',
      signature: 'Jane Doe',
      signatureType: 'type',
      ownershipPercentage: 100,
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/portal/messages ─────────────────────────────────────────────
describe('POST /api/portal/messages (real route)', () => {
  it('rejects empty message with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/portal/messages')
      .send({ message: '' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid message payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.message).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app)
      .post('/api/portal/messages')
      .send({ subject: 'Q', message: 'Can you clarify?' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── POST /api/portal/file-requests/:id/upload ─────────────────────────────
describe('POST /api/portal/file-requests/:id/upload (real route)', () => {
  it('rejects missing fileData with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/api/portal/file-requests/1/upload')
      .send({ fileName: 'doc.pdf', mimeType: 'application/pdf' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid upload payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.fileData).toBeDefined();
  });

  it('accepts a valid payload (returns 2xx)', async () => {
    const res = await request(app)
      .post('/api/portal/file-requests/1/upload')
      .send({ fileName: 'doc.pdf', mimeType: 'application/pdf', fileData: 'aGVsbG8=' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});
