import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../storage');
jest.mock('../auth');

const mockRbacResources = [
  {
    id: 1,
    resourceType: 'page',
    resourceKey: 'page:dashboard',
    displayName: 'Dashboard',
    description: 'Main dashboard page',
    category: 'Pages - Core',
    parentResourceKey: null,
    metadata: { icon: 'LayoutDashboard', route: '/dashboard' },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 2,
    resourceType: 'page',
    resourceKey: 'page:merchants',
    displayName: 'Merchants',
    description: 'Merchant management page',
    category: 'Pages - Core',
    parentResourceKey: null,
    metadata: { icon: 'Store', route: '/merchants' },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 3,
    resourceType: 'widget',
    resourceKey: 'widget:quick_stats',
    displayName: 'Quick Stats',
    description: 'Dashboard quick stats widget',
    category: 'Dashboard Widgets',
    parentResourceKey: null,
    metadata: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const mockRolePermissions = [
  { id: 1, roleKey: 'super_admin', resourceId: 1, action: 'view', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 2, roleKey: 'super_admin', resourceId: 1, action: 'manage', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 3, roleKey: 'super_admin', resourceId: 2, action: 'view', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 4, roleKey: 'super_admin', resourceId: 2, action: 'manage', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 5, roleKey: 'admin', resourceId: 1, action: 'view', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 6, roleKey: 'admin', resourceId: 2, action: 'view', isGranted: true, grantedAt: new Date(), notes: null },
  { id: 7, roleKey: 'merchant', resourceId: 1, action: 'view', isGranted: true, grantedAt: new Date(), notes: null }
];

const mockAuditLogs = [
  {
    id: 1,
    actorUserId: 'admin-test-001',
    roleKey: 'merchant',
    resourceId: 1,
    action: 'view',
    changeType: 'grant',
    previousValue: null,
    newValue: true,
    notes: 'Initial grant',
    metadata: {},
    createdAt: new Date()
  }
];

const mockStorage = {
  getRbacResources: jest.fn(),
  getRolePermissions: jest.fn(),
  getPermissionAuditLogs: jest.fn(),
  updateRolePermissions: jest.fn(),
  createPermissionAuditLog: jest.fn()
};

const mockAuth = {
  isAuthenticated: jest.fn((req: any, res: any, next: any) => {
    req.user = { id: 'test-user', role: 'super_admin' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, res: any, next: any) => {
    req.user = { id: 'test-user', role: 'super_admin' };
    next();
  })
};

describe('RBAC API Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    jest.doMock('../storage', () => ({ DatabaseStorage: jest.fn(() => mockStorage) }));
    jest.doMock('../auth', () => mockAuth);
    
    const routes = require('../routes');
    app.use('/api', routes.default);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('GET /api/rbac/policies', () => {
    it('returns resources and policy map for authenticated users', async () => {
      mockStorage.getRbacResources.mockResolvedValue(mockRbacResources);
      mockStorage.getRolePermissions.mockResolvedValue(mockRolePermissions);

      const response = await request(app)
        .get('/api/rbac/policies')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.resources).toBeDefined();
      expect(response.body.policies).toBeDefined();
      expect(Array.isArray(response.body.resources)).toBe(true);
      expect(response.body.resources.length).toBe(3);
      expect(mockStorage.getRbacResources).toHaveBeenCalled();
      expect(mockStorage.getRolePermissions).toHaveBeenCalled();
    });

    it('includes metadata in resource objects', async () => {
      mockStorage.getRbacResources.mockResolvedValue(mockRbacResources);
      mockStorage.getRolePermissions.mockResolvedValue(mockRolePermissions);

      const response = await request(app)
        .get('/api/rbac/policies')
        .expect(200);

      const dashboardResource = response.body.resources.find((r: any) => r.resourceKey === 'page:dashboard');
      expect(dashboardResource.metadata).toBeDefined();
      expect(dashboardResource.metadata.icon).toBe('LayoutDashboard');
    });

    it('groups permissions by role in policies object', async () => {
      mockStorage.getRbacResources.mockResolvedValue(mockRbacResources);
      mockStorage.getRolePermissions.mockResolvedValue(mockRolePermissions);

      const response = await request(app)
        .get('/api/rbac/policies')
        .expect(200);

      expect(response.body.policies.super_admin).toBeDefined();
      expect(response.body.policies.admin).toBeDefined();
      expect(response.body.policies.merchant).toBeDefined();
    });
  });

  describe('GET /api/rbac/roles', () => {
    it('returns list of roles with permission counts', async () => {
      mockStorage.getRolePermissions.mockResolvedValue(mockRolePermissions);

      const response = await request(app)
        .get('/api/rbac/roles')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.roles).toBeDefined();
      expect(Array.isArray(response.body.roles)).toBe(true);
      
      const superAdminRole = response.body.roles.find((r: any) => r.key === 'super_admin');
      expect(superAdminRole).toBeDefined();
      expect(superAdminRole.permissionCount).toBeGreaterThan(0);
    });

    it('includes all system roles', async () => {
      mockStorage.getRolePermissions.mockResolvedValue(mockRolePermissions);

      const response = await request(app)
        .get('/api/rbac/roles')
        .expect(200);

      const roleKeys = response.body.roles.map((r: any) => r.key);
      expect(roleKeys).toContain('super_admin');
      expect(roleKeys).toContain('admin');
      expect(roleKeys).toContain('agent');
      expect(roleKeys).toContain('merchant');
      expect(roleKeys).toContain('underwriter');
      expect(roleKeys).toContain('corporate');
    });
  });

  describe('GET /api/rbac/audit-log', () => {
    it('returns audit log entries', async () => {
      mockStorage.getPermissionAuditLogs.mockResolvedValue(mockAuditLogs);

      const response = await request(app)
        .get('/api/rbac/audit-log')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.logs).toBeDefined();
      expect(Array.isArray(response.body.logs)).toBe(true);
    });

    it('returns empty array when no audit logs exist', async () => {
      mockStorage.getPermissionAuditLogs.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/rbac/audit-log')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.logs).toEqual([]);
    });
  });

  describe('PUT /api/rbac/roles/:roleKey/permissions', () => {
    it('updates permissions for a role', async () => {
      const permissionGrants = [
        { resourceId: 1, action: 'view', isGranted: true },
        { resourceId: 1, action: 'manage', isGranted: false }
      ];

      mockStorage.updateRolePermissions.mockResolvedValue({ success: true });
      mockStorage.createPermissionAuditLog.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .put('/api/rbac/roles/admin/permissions')
        .send({ grants: permissionGrants })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockStorage.updateRolePermissions).toHaveBeenCalled();
    });

    it('validates role key parameter', async () => {
      const response = await request(app)
        .put('/api/rbac/roles/invalid_role/permissions')
        .send({ grants: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid role');
    });

    it('requires grants array in request body', async () => {
      const response = await request(app)
        .put('/api/rbac/roles/admin/permissions')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('prevents modification of super_admin permissions by non-super-admins', async () => {
      mockAuth.isAuthenticated.mockImplementation((req: any, res: any, next: any) => {
        req.user = { id: 'test-user', role: 'admin' };
        next();
      });

      const response = await request(app)
        .put('/api/rbac/roles/super_admin/permissions')
        .send({ grants: [{ resourceId: 1, action: 'view', isGranted: false }] })
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Authentication and Authorization', () => {
    it('requires authentication for RBAC endpoints', async () => {
      mockAuth.isAuthenticated.mockImplementation((req, res, next) => {
        res.status(401).json({ error: 'Authentication required' });
      });

      await request(app)
        .get('/api/rbac/policies')
        .expect(401);
    });

    it('requires admin role for permission updates', async () => {
      mockAuth.requireRole.mockImplementation(() => (req, res, next) => {
        res.status(403).json({ error: 'Insufficient permissions' });
      });

      await request(app)
        .put('/api/rbac/roles/merchant/permissions')
        .send({ grants: [] })
        .expect(403);
    });
  });

  describe('Error Handling', () => {
    it('handles database errors gracefully for policies', async () => {
      mockStorage.getRbacResources.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/rbac/policies')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('handles database errors gracefully for roles', async () => {
      mockStorage.getRolePermissions.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/rbac/roles')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('handles database errors gracefully for permission updates', async () => {
      mockStorage.updateRolePermissions.mockRejectedValue(new Error('Failed to update permissions'));

      const response = await request(app)
        .put('/api/rbac/roles/admin/permissions')
        .send({ grants: [{ resourceId: 1, action: 'view', isGranted: true }] })
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });
});
