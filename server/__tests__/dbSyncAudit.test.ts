import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../db', () => ({
  db: {},
  getDynamicDatabase: () => ({}),
  isShutdownInProgress: () => false,
}));

import { AuditService } from '../auditService';

describe('/api/admin/db-sync explicit audit payload', () => {
  it('writes a high-severity cross_env_sync row with all required fields', async () => {
    const inserted: any[] = [];
    const fakeDb: any = {
      insert: () => ({
        values: (row: any) => ({
          returning: async () => {
            inserted.push(row);
            return [{ id: 42 }];
          },
        }),
      }),
    };

    const svc = new AuditService(fakeDb);

    const fromEnvironment = 'production';
    const toEnvironment = 'development';
    const syncType = 'data';
    const tables = ['users', 'merchants'];
    const rowCounts = { users: 1234, merchants: 56 };
    const userId = 'user_abc';

    const auditId = await svc.logAction(
      'cross_env_sync',
      'database',
      {
        userId,
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
        method: 'POST',
        endpoint: '/api/admin/db-sync',
        environment: toEnvironment,
      } as any,
      {
        riskLevel: 'high',
        dataClassification: 'restricted',
        tags: { fromEnvironment, toEnvironment, syncType, tables, rowCounts },
        notes: `Cross-env sync: ${syncType} from ${fromEnvironment} -> ${toEnvironment}`,
      },
    );

    expect(auditId).toBe(42);
    expect(inserted).toHaveLength(1);
    const row = inserted[0];

    expect(row.action).toBe('cross_env_sync');
    expect(row.resource).toBe('database');
    expect(row.userId).toBe(userId);
    expect(row.endpoint).toBe('/api/admin/db-sync');
    expect(row.riskLevel).toBe('high');
    expect(row.dataClassification).toBe('restricted');

    expect(row.tags.fromEnvironment).toBe(fromEnvironment);
    expect(row.tags.toEnvironment).toBe(toEnvironment);
    expect(row.tags.syncType).toBe(syncType);
    expect(row.tags.tables).toEqual(tables);
    expect(row.tags.rowCounts).toEqual(rowCounts);
  });
});
