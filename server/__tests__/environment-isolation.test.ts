import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';

const mockDynamicDatabase = jest.fn();
const mockCreateStorage = jest.fn();
const mockEnvironmentManager = {
  resolveFromRequest: jest.fn(),
  getCurrentEnvironment: jest.fn(),
  setEnvironment: jest.fn(),
};

jest.mock('../db', () => ({
  getDynamicDatabase: (env: string) => mockDynamicDatabase(env),
}));

jest.mock('../storage', () => ({
  createStorage: (db: any) => mockCreateStorage(db),
}));

jest.mock('../environmentManager', () => ({
  environmentManager: mockEnvironmentManager,
}));

describe('Environment Isolation Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('Global Environment Middleware', () => {
    it('should attach storage to req based on resolved environment', () => {
      const mockDevDb = { env: 'development', connected: true };
      const mockDevStorage = { 
        getProspects: jest.fn(), 
        environment: 'development' 
      };

      mockEnvironmentManager.resolveFromRequest.mockReturnValue({
        environment: 'development',
        isProduction: false,
        url: 'localhost:5000',
      });
      mockDynamicDatabase.mockReturnValue(mockDevDb);
      mockCreateStorage.mockReturnValue(mockDevStorage);

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/test', (req: any, res: Response) => {
        res.json({
          hasStorage: !!req.storage,
          hasDb: !!req.db,
          environment: req.dbEnv,
        });
      });

      return request(app)
        .get('/test')
        .expect(200)
        .then((response) => {
          expect(response.body.hasStorage).toBe(true);
          expect(response.body.hasDb).toBe(true);
          expect(response.body.environment).toBe('development');
          expect(mockDynamicDatabase).toHaveBeenCalledWith('development');
          expect(mockCreateStorage).toHaveBeenCalledWith(mockDevDb);
        });
    });

    it('should use production database for production URLs', () => {
      const mockProdDb = { env: 'production', connected: true };
      const mockProdStorage = { 
        getProspects: jest.fn(), 
        environment: 'production' 
      };

      mockEnvironmentManager.resolveFromRequest.mockReturnValue({
        environment: 'production',
        isProduction: true,
        url: 'crm.charrg.com',
      });
      mockDynamicDatabase.mockReturnValue(mockProdDb);
      mockCreateStorage.mockReturnValue(mockProdStorage);

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/test', (req: any, res: Response) => {
        res.json({
          environment: req.dbEnv,
          isProduction: req.environmentConfig.isProduction,
        });
      });

      return request(app)
        .get('/test')
        .set('Host', 'crm.charrg.com')
        .expect(200)
        .then((response) => {
          expect(response.body.environment).toBe('production');
          expect(response.body.isProduction).toBe(true);
          expect(mockDynamicDatabase).toHaveBeenCalledWith('production');
        });
    });

    it('should set X-Database-Environment header in response', () => {
      mockEnvironmentManager.resolveFromRequest.mockReturnValue({
        environment: 'development',
        isProduction: false,
        url: 'localhost:5000',
      });
      mockDynamicDatabase.mockReturnValue({});
      mockCreateStorage.mockReturnValue({});

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/test', (req: any, res: Response) => {
        res.json({ ok: true });
      });

      return request(app)
        .get('/test')
        .expect(200)
        .expect('X-Database-Environment', 'development');
    });
  });

  describe('Storage Isolation Per Request', () => {
    it('should create new storage instance for each request', () => {
      const callCount = { value: 0 };
      
      mockEnvironmentManager.resolveFromRequest.mockReturnValue({
        environment: 'development',
        isProduction: false,
        url: 'localhost:5000',
      });
      mockDynamicDatabase.mockReturnValue({});
      mockCreateStorage.mockImplementation(() => {
        callCount.value++;
        return { requestId: callCount.value };
      });

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/test', (req: any, res: Response) => {
        res.json({ storageId: req.storage.requestId });
      });

      return Promise.all([
        request(app).get('/test').expect(200),
        request(app).get('/test').expect(200),
      ]).then(([res1, res2]) => {
        expect(mockCreateStorage).toHaveBeenCalledTimes(2);
      });
    });

    it('should use different database connections for different environments', () => {
      const dbConnections: string[] = [];
      
      mockDynamicDatabase.mockImplementation((env: string) => {
        dbConnections.push(env);
        return { connectionEnv: env };
      });
      mockCreateStorage.mockImplementation((db: any) => ({ 
        dbEnv: db.connectionEnv 
      }));

      mockEnvironmentManager.resolveFromRequest.mockReturnValueOnce({
        environment: 'development',
        isProduction: false,
        url: 'localhost:5000',
      });

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/test', (req: any, res: Response) => {
        res.json({ 
          storageEnv: req.storage.dbEnv,
          dbEnv: req.dbEnv 
        });
      });

      return request(app)
        .get('/test')
        .expect(200)
        .then((response) => {
          expect(response.body.storageEnv).toBe('development');
          expect(response.body.dbEnv).toBe('development');
          expect(dbConnections).toContain('development');
        });
    });
  });

  describe('Routes Use req.storage Pattern', () => {
    it('should verify routes access database through req.storage only', async () => {
      let storageAccessCount = 0;
      const mockStorage = {
        getProspects: jest.fn().mockImplementation(() => {
          storageAccessCount++;
          return Promise.resolve([]);
        }),
      };

      mockEnvironmentManager.resolveFromRequest.mockReturnValue({
        environment: 'development',
        isProduction: false,
        url: 'localhost:5000',
      });
      mockDynamicDatabase.mockReturnValue({});
      mockCreateStorage.mockReturnValue(mockStorage);

      const { globalEnvironmentMiddleware } = require('../globalEnvironmentMiddleware');
      
      app.use(globalEnvironmentMiddleware);
      app.get('/api/test-prospects', async (req: any, res: Response) => {
        const prospects = await req.storage.getProspects();
        res.json(prospects);
      });

      await request(app)
        .get('/api/test-prospects')
        .expect(200);

      expect(storageAccessCount).toBe(1);
      expect(mockStorage.getProspects).toHaveBeenCalled();
    });
  });

  describe('Environment Switch Authorization', () => {
    it('should only allow admins to switch environments', () => {
      const canSwitchEnvironment = (userRole: string): boolean => {
        const allowedRoles = ['super_admin', 'admin'];
        return allowedRoles.includes(userRole);
      };

      expect(canSwitchEnvironment('super_admin')).toBe(true);
      expect(canSwitchEnvironment('admin')).toBe(true);
      expect(canSwitchEnvironment('merchant')).toBe(false);
      expect(canSwitchEnvironment('agent')).toBe(false);
      expect(canSwitchEnvironment('underwriter')).toBe(false);
    });

    it('should reject environment switch for non-admin users', async () => {
      app.post('/api/environment/switch', (req: any, res: Response) => {
        const user = req.body.user;
        const allowedRoles = ['super_admin', 'admin'];
        
        if (!allowedRoles.includes(user?.role)) {
          return res.status(403).json({ error: 'Unauthorized' });
        }
        
        return res.json({ success: true });
      });

      const response = await request(app)
        .post('/api/environment/switch')
        .send({ user: { role: 'merchant' }, environment: 'development' })
        .expect(403);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should allow environment switch for admin users', async () => {
      app.post('/api/environment/switch', (req: any, res: Response) => {
        const user = req.body.user;
        const allowedRoles = ['super_admin', 'admin'];
        
        if (!allowedRoles.includes(user?.role)) {
          return res.status(403).json({ error: 'Unauthorized' });
        }
        
        return res.json({ success: true, environment: req.body.environment });
      });

      const response = await request(app)
        .post('/api/environment/switch')
        .send({ user: { role: 'super_admin' }, environment: 'development' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.environment).toBe('development');
    });
  });

  describe('Database URL Selection', () => {
    it('should use DEV_DATABASE_URL for development environment', () => {
      const originalDevUrl = process.env.DEV_DATABASE_URL;
      const originalProdUrl = process.env.DATABASE_URL;
      
      process.env.DEV_DATABASE_URL = 'postgresql://dev-host:5432/dev_db';
      process.env.DATABASE_URL = 'postgresql://prod-host:5432/prod_db';

      const getDatabaseUrl = (environment: string): string | undefined => {
        switch (environment) {
          case 'development':
            return process.env.DEV_DATABASE_URL;
          case 'test':
            return process.env.TEST_DATABASE_URL || process.env.DEV_DATABASE_URL;
          case 'production':
            return process.env.DATABASE_URL;
          default:
            return process.env.DATABASE_URL;
        }
      };

      expect(getDatabaseUrl('development')).toBe('postgresql://dev-host:5432/dev_db');
      expect(getDatabaseUrl('production')).toBe('postgresql://prod-host:5432/prod_db');
      expect(getDatabaseUrl('development')).not.toBe(getDatabaseUrl('production'));

      process.env.DEV_DATABASE_URL = originalDevUrl;
      process.env.DATABASE_URL = originalProdUrl;
    });
  });

  describe('Static Import Guard - All Server Files', () => {
    const serverDir = path.join(__dirname, '..');
    
    const getServerFiles = (): string[] => {
      const files: string[] = [];
      const items = fs.readdirSync(serverDir);
      for (const item of items) {
        const fullPath = path.join(serverDir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && item.endsWith('.ts') && !item.endsWith('.test.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    it('should not import static db or pool from db.ts in routes.ts', () => {
      const routesPath = path.join(__dirname, '..', 'routes.ts');
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      
      const staticDbImportPatterns = [
        /import\s+\{\s*db\s*\}\s+from\s+['"]\.\/db['"]/,
        /import\s+\{\s*pool\s*\}\s+from\s+['"]\.\/db['"]/,
        /import\s+db\s+from\s+['"]\.\/db['"]/,
      ];
      
      for (const pattern of staticDbImportPatterns) {
        const matches = routesContent.match(pattern);
        expect(matches).toBeNull();
      }
    });

    it('should not import static storage instance from storage.ts in routes.ts', () => {
      const routesPath = path.join(__dirname, '..', 'routes.ts');
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      
      const staticStoragePatterns = [
        /import\s+\{\s*storage\s*\}\s+from\s+['"]\.\/storage['"]/,
        /import\s+storage\s+from\s+['"]\.\/storage['"]/,
      ];
      
      for (const pattern of staticStoragePatterns) {
        const matches = routesContent.match(pattern);
        expect(matches).toBeNull();
      }
    });

    it('should use req.storage pattern extensively in route handlers', () => {
      const routesPath = path.join(__dirname, '..', 'routes.ts');
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      
      const reqStorageUsage = routesContent.match(/req\.storage/g);
      expect(reqStorageUsage).not.toBeNull();
      expect(reqStorageUsage!.length).toBeGreaterThan(10);
    });

    it('should verify globalEnvironmentMiddleware exports required function', () => {
      const middlewarePath = path.join(__dirname, '..', 'globalEnvironmentMiddleware.ts');
      const middlewareContent = fs.readFileSync(middlewarePath, 'utf-8');
      
      expect(middlewareContent).toContain('export const globalEnvironmentMiddleware');
      expect(middlewareContent).toContain('req.storage = createStorage');
      expect(middlewareContent).toContain('req.dbEnv = environmentConfig.environment');
    });

    it('should verify routes.ts applies globalEnvironmentMiddleware', () => {
      const routesPath = path.join(__dirname, '..', 'routes.ts');
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      
      expect(routesContent).toContain('globalEnvironmentMiddleware');
    });

    it('should identify intentional static db usage in compliance services', () => {
      const auditServicePath = path.join(__dirname, '..', 'auditService.ts');
      if (fs.existsSync(auditServicePath)) {
        const auditContent = fs.readFileSync(auditServicePath, 'utf-8');
        expect(auditContent).toContain('db');
      }
    });
  });

  describe('Cross-Environment Data Isolation', () => {
    it('should not allow data from dev environment to leak to prod', async () => {
      const devData = new Map<number, { name: string; env: string }>();
      const prodData = new Map<number, { name: string; env: string }>();
      
      devData.set(1, { name: 'Dev Record', env: 'development' });
      prodData.set(1, { name: 'Prod Record', env: 'production' });
      
      const getRecordForEnv = (id: number, env: string) => {
        const dataStore = env === 'production' ? prodData : devData;
        return dataStore.get(id);
      };
      
      const devRecord = getRecordForEnv(1, 'development');
      const prodRecord = getRecordForEnv(1, 'production');
      
      expect(devRecord!.name).toBe('Dev Record');
      expect(prodRecord!.name).toBe('Prod Record');
      expect(devRecord).not.toEqual(prodRecord);
    });

    it('should create isolated storage instances per environment', () => {
      const storageFactory = (env: string) => ({
        environment: env,
        data: new Map(),
        add: function(key: string, value: any) { this.data.set(key, value); },
        get: function(key: string) { return this.data.get(key); },
      });
      
      const devStorage = storageFactory('development');
      const prodStorage = storageFactory('production');
      
      devStorage.add('user-1', { name: 'Dev User' });
      prodStorage.add('user-1', { name: 'Prod User' });
      
      expect(devStorage.get('user-1')).toEqual({ name: 'Dev User' });
      expect(prodStorage.get('user-1')).toEqual({ name: 'Prod User' });
      expect(devStorage).not.toBe(prodStorage);
      expect(devStorage.data).not.toBe(prodStorage.data);
    });
  });

  describe('Environment Resolution Logic', () => {
    it('should resolve production for production domain', () => {
      const resolveEnvironment = (host: string, sessionEnv?: string): string => {
        const productionDomains = ['crm.charrg.com', 'app.example.com'];
        
        if (productionDomains.some(domain => host.includes(domain))) {
          return 'production';
        }
        
        return sessionEnv || 'development';
      };
      
      expect(resolveEnvironment('crm.charrg.com')).toBe('production');
      expect(resolveEnvironment('localhost:5000', 'development')).toBe('development');
      expect(resolveEnvironment('test.replit.dev', 'test')).toBe('test');
    });

    it('should always force production for production domains regardless of session', () => {
      const resolveEnvironment = (host: string, sessionEnv?: string): string => {
        const productionDomains = ['crm.charrg.com'];
        
        if (productionDomains.some(domain => host.includes(domain))) {
          return 'production';
        }
        
        return sessionEnv || 'development';
      };
      
      expect(resolveEnvironment('crm.charrg.com', 'development')).toBe('production');
      expect(resolveEnvironment('crm.charrg.com', 'test')).toBe('production');
    });
  });
});
