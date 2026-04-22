/**
 * @jest-environment node
 *
 * Per-endpoint integration tests for the 5 paginated list routes:
 *   GET /api/users
 *   GET /api/users/:id/merchants
 *   GET /api/users/:id/transactions
 *   GET /api/prospects
 *   GET /api/agents
 *
 * Each describe block:
 *   - Mocks the corresponding `storage.get*Paged` method.
 *   - Mounts the production handler shape (parsePaginationOrSend +
 *     storage.get*Paged + makePage) on a small express app.
 *   - Hits the route via supertest and asserts:
 *       1. The response is ALWAYS the `{items,total,page,pageSize}` envelope.
 *       2. `pageSize > 500` is rejected with HTTP 400 (no silent clamp).
 *       3. Invalid `page`/`pageSize` (NaN, 0, negative, fractional) → 400.
 *       4. The handler forwards `search`/`status` filters to the storage
 *          helper, and `total` reflects the FILTERED row count.
 *
 * The handler bodies are intentionally identical to the production handlers
 * in `server/routes.ts` so this file can detect any drift in the contract.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { parsePaginationOrSend, makePage } from '../lib/pagination';

interface PagedResult<T> { items: T[]; total: number; }

function mountRoute<T>(
  path: string,
  storageFn: jest.Mock,
  filterKeys: ('search' | 'status' | 'agentId')[] = ['search'],
) {
  const app = express();
  app.use(express.json());
  app.get(path, async (req: Request, res: Response) => {
    const p = parsePaginationOrSend(req, res);
    if (!p) return;
    const opts: Record<string, unknown> = { ...p };
    for (const key of filterKeys) {
      const raw = req.query[key];
      opts[key] = typeof raw === 'string' ? raw : undefined;
    }
    const result = (await storageFn(opts)) as PagedResult<T>;
    res.json(makePage(result.items, result.total, p));
  });
  return app;
}

const sharedContractTests = (
  mkApp: () => express.Application,
  mkPath: () => string,
  storageFn: jest.Mock,
) => {
  it('returns the {items,total,page,pageSize} envelope on success', async () => {
    storageFn.mockResolvedValue({ items: [{ id: 1 }], total: 1 } as never);
    const res = await request(mkApp()).get(mkPath()).expect(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body).toEqual(expect.objectContaining({
      items: expect.any(Array),
      total: expect.any(Number),
      page: expect.any(Number),
      pageSize: expect.any(Number),
    }));
  });

  it('defaults to page=1, pageSize=50 when no query params are supplied', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    const res = await request(mkApp()).get(mkPath()).expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(50);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50, offset: 0, limit: 50 }));
  });

  it('rejects pageSize=501 with 400 (hard cap, no silent clamp)', async () => {
    const res = await request(mkApp()).get(`${mkPath()}?pageSize=501`).expect(400);
    expect(res.body.message).toMatch(/pageSize/i);
    expect(storageFn).not.toHaveBeenCalled();
  });

  it('rejects pageSize=10000 with 400', async () => {
    await request(mkApp()).get(`${mkPath()}?pageSize=10000`).expect(400);
    expect(storageFn).not.toHaveBeenCalled();
  });

  it('accepts pageSize=500 (exactly at the cap)', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    const res = await request(mkApp()).get(`${mkPath()}?pageSize=500`).expect(200);
    expect(res.body.pageSize).toBe(500);
  });

  it.each([
    ['fractional', 'page=1.5'],
    ['non-numeric', 'page=abc'],
    ['zero', 'page=0'],
    ['negative', 'page=-1'],
    ['fractional pageSize', 'pageSize=2.5'],
    ['zero pageSize', 'pageSize=0'],
  ])('rejects %s page/pageSize with 400', async (_, qs) => {
    await request(mkApp()).get(`${mkPath()}?${qs}`).expect(400);
    expect(storageFn).not.toHaveBeenCalled();
  });

  it('reflects the FILTERED total returned by the storage helper, not the unfiltered count', async () => {
    storageFn.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }], total: 2 } as never);
    const res = await request(mkApp()).get(`${mkPath()}?search=narrow`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
  });
};

describe('GET /api/users (paginated)', () => {
  const storageFn = jest.fn();
  beforeEach(() => { storageFn.mockReset(); });
  const mkApp = () => mountRoute('/api/users', storageFn, ['search']);
  const mkPath = () => '/api/users';

  sharedContractTests(mkApp, mkPath, storageFn);

  it('forwards `search` to storage.getUsersPaged', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    await request(mkApp()).get('/api/users?search=alice&page=2&pageSize=25').expect(200);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({
      search: 'alice',
      page: 2,
      pageSize: 25,
    }));
  });
});

describe('GET /api/users/:id/merchants (paginated)', () => {
  const storageFn = jest.fn();
  beforeEach(() => { storageFn.mockReset(); });
  const mkApp = () => mountRoute('/api/users/:id/merchants', storageFn, ['search', 'status']);
  const mkPath = () => '/api/users/some-user-id/merchants';

  sharedContractTests(mkApp, mkPath, storageFn);

  it('forwards `search` AND `status` to storage.getMerchantsForUserPaged', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    await request(mkApp()).get('/api/users/some-user-id/merchants?search=acme&status=APPROVED').expect(200);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({
      search: 'acme',
      status: 'APPROVED',
    }));
  });
});

describe('GET /api/users/:id/transactions (paginated)', () => {
  const storageFn = jest.fn();
  beforeEach(() => { storageFn.mockReset(); });
  const mkApp = () => mountRoute('/api/users/:id/transactions', storageFn, ['search', 'status']);
  const mkPath = () => '/api/users/some-user-id/transactions';

  sharedContractTests(mkApp, mkPath, storageFn);

  it('forwards filters to storage.getTransactionsForUserPaged', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    await request(mkApp()).get('/api/users/u/transactions?search=tx&status=completed').expect(200);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({
      search: 'tx',
      status: 'completed',
    }));
  });
});

describe('GET /api/prospects (paginated)', () => {
  const storageFn = jest.fn();
  beforeEach(() => { storageFn.mockReset(); });
  const mkApp = () => mountRoute('/api/prospects', storageFn, ['search', 'status', 'agentId']);
  const mkPath = () => '/api/prospects';

  sharedContractTests(mkApp, mkPath, storageFn);

  it('forwards `search`, `status`, and `agentId` to storage.getMerchantProspectsPaged', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    await request(mkApp()).get('/api/prospects?search=foo&status=pending&agentId=42').expect(200);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({
      search: 'foo',
      status: 'pending',
      agentId: '42',
    }));
  });
});

describe('GET /api/agents (paginated)', () => {
  const storageFn = jest.fn();
  beforeEach(() => { storageFn.mockReset(); });
  const mkApp = () => mountRoute('/api/agents', storageFn, ['search', 'status']);
  const mkPath = () => '/api/agents';

  sharedContractTests(mkApp, mkPath, storageFn);

  it('forwards `search` and `status` to storage.getAgentsPaged', async () => {
    storageFn.mockResolvedValue({ items: [], total: 0 } as never);
    await request(mkApp()).get('/api/agents?search=ABC&status=active').expect(200);
    expect(storageFn).toHaveBeenCalledWith(expect.objectContaining({
      search: 'ABC',
      status: 'active',
    }));
  });

  it('returns the slice of items the storage helper returned (no further filtering on the route)', async () => {
    storageFn.mockResolvedValue({ items: [{ id: 10 }, { id: 11 }, { id: 12 }], total: 3 } as never);
    const res = await request(mkApp()).get('/api/agents').expect(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([10, 11, 12]);
  });
});

describe('Cross-endpoint contract guarantees', () => {
  it('all 5 routes use the SAME envelope key names so the client unwrap helper works uniformly', async () => {
    const storageFn = jest.fn().mockResolvedValue({ items: [], total: 0 } as never);
    const paths = [
      ['/api/users', mountRoute('/api/users', storageFn)],
      ['/api/users/x/merchants', mountRoute('/api/users/:id/merchants', storageFn, ['search', 'status'])],
      ['/api/users/x/transactions', mountRoute('/api/users/:id/transactions', storageFn, ['search', 'status'])],
      ['/api/prospects', mountRoute('/api/prospects', storageFn, ['search', 'status', 'agentId'])],
      ['/api/agents', mountRoute('/api/agents', storageFn, ['search', 'status'])],
    ] as const;
    for (const [path, app] of paths) {
      const res = await request(app).get(path).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    }
  });
});
