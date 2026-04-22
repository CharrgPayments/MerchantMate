import type { Request } from "express";

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

function toPositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function parsePagination(req: Request): PageParams {
  const page = toPositiveInt(req.query.page, 1);
  const requested = toPositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function makePage<T>(items: T[], total: number, p: PageParams): Page<T> {
  return { items, total, page: p.page, pageSize: p.pageSize };
}

/**
 * Returns true when the client explicitly opted in to the paginated envelope
 * by passing `?page=…`, `?pageSize=…`, or `?paginated=1`. This lets us cap the
 * response size unconditionally while keeping the legacy array shape for older
 * callers (modals, hierarchy hydration, integration tests).
 */
export function wantsPaginatedEnvelope(req: Request): boolean {
  return (
    req.query.page !== undefined ||
    req.query.pageSize !== undefined ||
    req.query.paginated !== undefined
  );
}
