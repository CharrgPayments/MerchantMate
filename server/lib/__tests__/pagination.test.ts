import { describe, it, expect } from '@jest/globals';
import {
  parsePagination,
  parsePaginationOrSend,
  PaginationError,
  wantsPaginatedEnvelope,
  makePage,
  MAX_PAGE_SIZE,
} from '../pagination';
import type { Request, Response } from 'express';

function mkReq(query: Record<string, string | undefined>): Request {
  return { query } as unknown as Request;
}

function mkRes(): Response & { _status?: number; _json?: unknown } {
  const res: any = {};
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: unknown) => { res._json = body; return res; };
  return res;
}

describe('parsePagination', () => {
  it('defaults to page=1 and pageSize=MAX when no params provided', () => {
    const p = parsePagination(mkReq({}));
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(MAX_PAGE_SIZE);
    expect(p.offset).toBe(0);
    expect(p.limit).toBe(MAX_PAGE_SIZE);
  });

  it('respects explicit page and pageSize', () => {
    const p = parsePagination(mkReq({ page: '3', pageSize: '25' }));
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(25);
    expect(p.offset).toBe(50);
    expect(p.limit).toBe(25);
  });

  it('throws PaginationError(400) when pageSize exceeds MAX_PAGE_SIZE', () => {
    expect(() => parsePagination(mkReq({ pageSize: String(MAX_PAGE_SIZE + 1) })))
      .toThrow(PaginationError);
    try {
      parsePagination(mkReq({ pageSize: String(MAX_PAGE_SIZE + 1) }));
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect((e as PaginationError).status).toBe(400);
      expect((e as PaginationError).message).toMatch(/pageSize/);
    }
  });

  it.each([
    ['page', { page: 'abc' }],
    ['page', { page: '0' }],
    ['page', { page: '-1' }],
    ['page', { page: '1.5' }],
    ['pageSize', { pageSize: 'xyz' }],
    ['pageSize', { pageSize: '0' }],
    ['pageSize', { pageSize: '-10' }],
  ])('rejects invalid %s', (_, q) => {
    expect(() => parsePagination(mkReq(q))).toThrow(PaginationError);
  });

  it('treats empty-string params as not provided', () => {
    const p = parsePagination(mkReq({ page: '', pageSize: '' }));
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('parsePaginationOrSend', () => {
  it('returns the parsed params on success', () => {
    const res = mkRes();
    const p = parsePaginationOrSend(mkReq({ page: '2', pageSize: '10' }), res);
    expect(p).not.toBeNull();
    expect(res._status).toBeUndefined();
    expect(p!.page).toBe(2);
  });

  it('writes a 400 response and returns null on oversized pageSize', () => {
    const res = mkRes();
    const p = parsePaginationOrSend(mkReq({ pageSize: String(MAX_PAGE_SIZE + 1) }), res);
    expect(p).toBeNull();
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ message: expect.stringMatching(/pageSize/) });
  });

  it('writes a 400 on invalid page', () => {
    const res = mkRes();
    const p = parsePaginationOrSend(mkReq({ page: 'abc' }), res);
    expect(p).toBeNull();
    expect(res._status).toBe(400);
  });
});

describe('wantsPaginatedEnvelope', () => {
  it.each([
    [{ page: '1' }, true],
    [{ pageSize: '50' }, true],
    [{ paginated: '1' }, true],
    [{}, false],
    [{ search: 'foo' }, false],
  ])('query=%j → %s', (query, expected) => {
    expect(wantsPaginatedEnvelope(mkReq(query as any))).toBe(expected);
  });
});

describe('makePage', () => {
  it('builds an envelope from items + total + params', () => {
    const env = makePage([1, 2, 3], 42, { page: 2, pageSize: 10, offset: 10, limit: 10 });
    expect(env).toEqual({ items: [1, 2, 3], total: 42, page: 2, pageSize: 10 });
  });
});
