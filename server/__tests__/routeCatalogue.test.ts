/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import express, { type RequestHandler } from 'express';
import {
  buildRouteCatalogue,
  publicRouteCatalogue,
  groupCatalogue,
  markInternal,
  markSchema,
} from '../routeCatalogue';

// Stand-in for the real auth middleware so we don't pull in the database.
function makeRequirePerm(action: string): RequestHandler {
  const handler: RequestHandler & {
    __docPermission?: string;
    __docPermissionType?: string;
  } = (_req, _res, next) => next();
  handler.__docPermission = action;
  handler.__docPermissionType = 'action';
  return handler;
}

const sessionMw: RequestHandler & {
  __docPermission?: string;
  __docPermissionType?: string;
} = (_req, _res, next) => next();
sessionMw.__docPermission = 'session';
sessionMw.__docPermissionType = 'session';

describe('routeCatalogue', () => {
  function buildApp() {
    const app = express();

    // Sentinel public route — must appear in the catalogue.
    app.get(
      '/api/admin/route-catalogue-sentinel',
      sessionMw,
      makeRequirePerm('admin:manage'),
      (_req, res) => res.json({ ok: true }),
    );

    // Validated route with a schema marker.
    app.post(
      '/api/widgets',
      sessionMw,
      markSchema('insertWidgetSchema'),
      (_req, res) => res.json({ ok: true }),
    );

    // Plain session route.
    app.get('/api/me', sessionMw, (_req, res) => res.json({ ok: true }));

    // Public route (no auth middleware).
    app.get('/api/public/health', (_req, res) => res.json({ ok: true }));

    // Sub-router mounted under a prefix — should be flattened with the prefix.
    const sub = express.Router();
    sub.get('/list', sessionMw, makeRequirePerm('underwriting:view-detail'), (_req, res) =>
      res.json({ ok: true }),
    );
    app.use('/api/underwriting', sub);

    // Routes that must be excluded from the public catalogue.
    app.get('/api/login', (_req, res) => res.redirect('/'));
    app.get('/api/callback', (_req, res) => res.redirect('/'));
    app.get('/api/logout', (_req, res) => res.redirect('/'));
    app.get('/api/csrf-token', (_req, res) => res.json({ token: 'x' }));
    app.post('/api/auth/check-username', (_req, res) => res.json({ available: true }));

    // Explicitly opted-out internal route.
    app.get('/api/internal/secret', markInternal(), (_req, res) => res.json({}));

    return app;
  }

  it('emits every mounted route with method and path, including sub-routers', () => {
    const app = buildApp();
    const all = buildRouteCatalogue(app);

    const paths = all.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain('GET /api/admin/route-catalogue-sentinel');
    expect(paths).toContain('POST /api/widgets');
    expect(paths).toContain('GET /api/underwriting/list');
  });

  it('extracts the action permission attached to the middleware chain', () => {
    const app = buildApp();
    const entries = buildRouteCatalogue(app);
    const sentinel = entries.find((e) => e.path === '/api/admin/route-catalogue-sentinel');
    expect(sentinel).toBeDefined();
    expect(sentinel?.permission).toBe('admin:manage');
    expect(sentinel?.permissionType).toBe('action');

    const sessionOnly = entries.find((e) => e.path === '/api/me');
    expect(sessionOnly?.permission).toBe('session');

    const publicRoute = entries.find((e) => e.path === '/api/public/health');
    expect(publicRoute?.permission).toBe('public');
  });

  it('captures Zod schema names from the markSchema marker', () => {
    const app = buildApp();
    const entry = buildRouteCatalogue(app).find((e) => e.path === '/api/widgets');
    expect(entry?.validated).toBe(true);
    expect(entry?.schema).toBe('insertWidgetSchema');
  });

  it('contains a known sentinel route and excludes known internal routes', () => {
    const app = buildApp();
    const publicEntries = publicRouteCatalogue(app);
    const paths = publicEntries.map((e) => `${e.method} ${e.path}`);

    // Sentinel must be present.
    expect(paths).toContain('GET /api/admin/route-catalogue-sentinel');

    // Internal routes must be omitted — both pattern-based and marker-based.
    expect(paths).not.toContain('GET /api/login');
    expect(paths).not.toContain('GET /api/callback');
    expect(paths).not.toContain('GET /api/logout');
    expect(paths).not.toContain('GET /api/csrf-token');
    expect(paths).not.toContain('POST /api/auth/check-username');
    expect(paths).not.toContain('GET /api/internal/secret');
  });

  it('inherits router-level middleware from router.use() onto child routes', () => {
    const app = express();

    // Router that mounts isAuthenticated + a permission middleware via use().
    // Routes registered after these `use` calls must inherit them.
    const sub = express.Router();
    sub.use(sessionMw);
    sub.use(makeRequirePerm('admin:manage'));
    sub.get('/list', (_req, res) => res.json({ ok: true }));
    sub.post('/create', (_req, res) => res.json({ ok: true }));

    // A route registered BEFORE the use() must not inherit them.
    const sub2 = express.Router();
    sub2.get('/before', (_req, res) => res.json({ ok: true }));
    sub2.use(sessionMw);
    sub2.get('/after', (_req, res) => res.json({ ok: true }));

    app.use('/api/admin', sub);
    app.use('/api/mixed', sub2);

    const entries = buildRouteCatalogue(app);
    const list = entries.find((e) => e.path === '/api/admin/list');
    const create = entries.find((e) => e.path === '/api/admin/create');
    expect(list?.permission).toBe('admin:manage');
    expect(list?.permissionType).toBe('action');
    expect(create?.permission).toBe('admin:manage');

    const before = entries.find((e) => e.path === '/api/mixed/before');
    const after = entries.find((e) => e.path === '/api/mixed/after');
    expect(before?.permission).toBe('public');
    expect(after?.permission).toBe('session');
  });

  it('inherits app-level unconditional middleware onto subsequent routes', () => {
    const app = express();
    app.use(sessionMw);
    app.get('/api/me', (_req, res) => res.json({ ok: true }));

    const entry = buildRouteCatalogue(app).find((e) => e.path === '/api/me');
    expect(entry?.permission).toBe('session');
  });


  // Integration-style assertions against the *real* registration files.
  // We can't `import()` them here because ts-jest type-checks the whole
  // import graph and several legacy server modules have pre-existing TS
  // errors. Instead we statically read the source files and assert that
  // the real production code uses our markers correctly. This catches the
  // exact drift the reviewer asked about: a real route file being
  // refactored without keeping its marker / inherited-auth pattern.
  it('real route files actually use the markInternal / markSchema markers', () => {
    // These are checked at the source level so the assertion does not
    // depend on the rest of the codebase compiling cleanly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '..', '..');

    const testingSrc = fs.readFileSync(path.join(root, 'server/routes/testing.ts'), 'utf8');
    // Sentinel: testing router opts the whole file out via inherited markInternal.
    expect(testingSrc).toMatch(/from\s+['"]\.\.\/routeCatalogue['"]/);
    expect(testingSrc).toMatch(/router\.use\(\s*markInternal\(\)\s*\)/);

    const extSrc = fs.readFileSync(
      path.join(root, 'server/routes/externalEndpoints.ts'),
      'utf8',
    );
    // Zod-validated route declares its schema via the marker.
    expect(extSrc).toMatch(/markSchema\(\s*['"]insertExternalEndpointSchema['"]\s*\)/);

    const dashboardSrc = fs.readFileSync(
      path.join(root, 'server/routes/dashboard.ts'),
      'utf8',
    );
    // Inherited session auth + at least one markSchema call.
    expect(dashboardSrc).toMatch(/router\.use\(\s*isAuthenticated\s*\)/);
    expect(dashboardSrc).toMatch(/markSchema\(\s*['"]addWidgetSchema['"]\s*\)/);

    const replitAuthSrc = fs.readFileSync(path.join(root, 'server/replitAuth.ts'), 'utf8');
    // OIDC plumbing routes are explicitly marked internal.
    expect(replitAuthSrc).toMatch(/markInternal\(\)/);
    expect(replitAuthSrc).toMatch(/__docPermission/);

    const apiAuthSrc = fs.readFileSync(path.join(root, 'server/apiAuth.ts'), 'utf8');
    // requireApiPermission tags itself so /api/v1 routes report API-key perms.
    expect(apiAuthSrc).toMatch(/__docPermission/);
  });

  it('groups entries into sections keyed by URL prefix', () => {
    const app = buildApp();
    const sections = groupCatalogue(publicRouteCatalogue(app));
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('admin');
    expect(ids).toContain('underwriting');
    expect(ids).toContain('widgets');

    const adminSection = sections.find((s) => s.id === 'admin')!;
    expect(adminSection.endpoints.some((e) => e.path === '/api/admin/route-catalogue-sentinel'))
      .toBe(true);
  });
});
