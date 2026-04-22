/**
 * @jest-environment node
 *
 * Integration tests for the pagination contract used by the 5 paginated list
 * endpoints (`/api/users`, `/api/users/:id/merchants`,
 * `/api/users/:id/transactions`, `/api/prospects`, `/api/agents`).
 *
 * All five endpoints share the same plumbing: `parsePaginationOrSend(req, res)`
 * to validate `page`/`pageSize`, a paged storage helper that returns
 * `{ items, total }`, and `makePage(items, total, p)` to build the wire
 * envelope. Rather than re-mock the entire app surface for each route, we
 * stand up a tiny express app with the same plumbing and assert the contract.
 *
 * That contract is what the front-end relies on:
 *   - Successful responses are ALWAYS a `{ items, total, page, pageSize }`
 *     envelope (never a bare array).
 *   - `page`/`pageSize` are strictly validated; bad input is rejected with 400
 *     and a stable error code, never silently coerced.
 *   - `pageSize > 500` is rejected with 400 (oversize hard cap).
 *   - Defaults are `page=1`, `pageSize=50` when no query params are supplied.
 *   - `search`/`status` filters are forwarded to the storage helper, and the
 *     resulting `total` reflects the FILTERED row count (not the table size),
 *     so the paginator can render correct page numbers.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { parsePaginationOrSend, makePage, PaginationError } from '../lib/pagination';

interface FakeRow { id: number; name: string; status: string; }

function buildApp(rows: FakeRow[]) {
  const app = express();
  app.use(express.json());

  // Mirrors the shape of `getUsersPaged` / `getMerchantProspectsPaged` /
  // `getAgentsPaged` etc.: applies search + status filters in memory, then
  // slices to the requested page and returns `{ items, total }`.
  const fakePaged = (opts: { page: number; pageSize: number; search?: string; status?: string }) => {
    let filtered = rows;
    if (opts.search) {
      const needle = opts.search.toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(needle));
    }
    if (opts.status && opts.status !== 'all') {
      filtered = filtered.filter((r) => r.status === opts.status);
    }
    const start = (opts.page - 1) * opts.pageSize;
    const items = filtered.slice(start, start + opts.pageSize);
    return { items, total: filtered.length };
  };

  app.get('/api/list', (req, res) => {
    const p = parsePaginationOrSend(req, res);
    if (!p) return;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const result = fakePaged({ ...p, search, status });
    res.json(makePage(result.items, result.total, p));
  });

  return app;
}

describe('Pagination contract (integration)', () => {
  let app: express.Application;
  let rows: FakeRow[];

  beforeEach(() => {
    rows = Array.from({ length: 137 }, (_, i) => ({
      id: i + 1,
      name: i % 3 === 0 ? `Acme ${i}` : `Other ${i}`,
      status: i % 2 === 0 ? 'active' : 'inactive',
    }));
    app = buildApp(rows);
  });

  describe('envelope shape', () => {
    it('always returns the {items,total,page,pageSize} envelope (never a bare array)', async () => {
      const res = await request(app).get('/api/list').expect(200);
      expect(Array.isArray(res.body)).toBe(false);
      expect(res.body).toEqual(expect.objectContaining({
        items: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        pageSize: expect.any(Number),
      }));
    });

    it('reports the FILTERED total, not the unfiltered row count, so the pager renders correctly', async () => {
      const res = await request(app).get('/api/list?status=active').expect(200);
      // 137 rows, even-indexed → 69 active rows; pager uses `total` to compute totalPages
      expect(res.body.total).toBe(69);
      expect(res.body.items.length).toBeLessThanOrEqual(50);
    });
  });

  describe('defaults', () => {
    it('defaults to page=1, pageSize=50 when no query params are supplied', async () => {
      const res = await request(app).get('/api/list').expect(200);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(50);
      expect(res.body.items).toHaveLength(50);
      expect(res.body.total).toBe(137);
    });

    it('returns the requested page slice', async () => {
      const res = await request(app).get('/api/list?page=2&pageSize=50').expect(200);
      expect(res.body.page).toBe(2);
      expect(res.body.items[0].id).toBe(51);
      expect(res.body.items).toHaveLength(50);
    });

    it('returns the partial last page', async () => {
      const res = await request(app).get('/api/list?page=3&pageSize=50').expect(200);
      expect(res.body.page).toBe(3);
      // 137 total, 50 + 50 + 37
      expect(res.body.items).toHaveLength(37);
    });
  });

  describe('hard cap rejection', () => {
    it('rejects pageSize > 500 with 400 (no silent clamp) and a stable error message', async () => {
      const res = await request(app).get('/api/list?pageSize=501').expect(400);
      expect(res.body).toEqual(expect.objectContaining({
        message: expect.stringMatching(/pageSize/i),
      }));
    });

    it('rejects pageSize=10000 with 400', async () => {
      await request(app).get('/api/list?pageSize=10000').expect(400);
    });

    it('accepts pageSize exactly at the 500 cap', async () => {
      const res = await request(app).get('/api/list?pageSize=500').expect(200);
      expect(res.body.pageSize).toBe(500);
    });
  });

  describe('input validation', () => {
    it('rejects non-integer page with 400', async () => {
      await request(app).get('/api/list?page=1.5').expect(400);
    });

    it('rejects non-numeric page with 400', async () => {
      await request(app).get('/api/list?page=abc').expect(400);
    });

    it('rejects page=0 with 400', async () => {
      await request(app).get('/api/list?page=0').expect(400);
    });

    it('rejects negative page with 400', async () => {
      await request(app).get('/api/list?page=-1').expect(400);
    });

    it('rejects pageSize=0 with 400', async () => {
      await request(app).get('/api/list?pageSize=0').expect(400);
    });
  });

  describe('search + status filter pass-through', () => {
    it('forwards `search` to the storage helper and recomputes `total`', async () => {
      const res = await request(app).get('/api/list?search=Acme').expect(200);
      // ~46 rows match "Acme"; assert total > 0 and items match
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.total).toBeLessThan(rows.length);
      for (const item of res.body.items) {
        expect(item.name).toMatch(/Acme/);
      }
    });

    it('combines search + status filters', async () => {
      const res = await request(app).get('/api/list?search=Acme&status=active').expect(200);
      for (const item of res.body.items) {
        expect(item.name).toMatch(/Acme/);
        expect(item.status).toBe('active');
      }
    });

    it('returns an empty page (with valid envelope) when filters match nothing', async () => {
      const res = await request(app).get('/api/list?search=nonexistent-needle').expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.page).toBe(1);
    });
  });

  describe('PaginationError export', () => {
    it('exposes a PaginationError class with status=400 for callers that want to catch it directly', () => {
      const err = new PaginationError(400, 'bad');
      expect(err.status).toBe(400);
      expect(err.message).toBe('bad');
    });
  });
});
