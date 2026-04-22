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

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
/**
 * Default pageSize used for callers that DON'T pass a pagination param. Set
 * to MAX_PAGE_SIZE so the legacy unbounded behaviour is preserved up to the
 * cap and existing array-shaped consumers keep receiving the full result set.
 * Callers that pass `?pageSize=` get true paging at that size.
 */
const LEGACY_DEFAULT_PAGE_SIZE = MAX_PAGE_SIZE;

export class PaginationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PaginationError";
  }
}

function toPositiveInt(raw: unknown, fieldName: string): number {
  // Use Number() instead of parseInt() so that decimal/garbage input ("1.5",
  // "abc") becomes NaN and is rejected, rather than being silently truncated.
  const n = typeof raw === "number" ? raw : Number(String(raw));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new PaginationError(400, `Invalid ${fieldName}: must be a positive integer`);
  }
  return n;
}

/**
 * Parses pagination from the query string. Throws PaginationError(400) when:
 *   - page or pageSize is non-numeric / non-positive
 *   - pageSize exceeds MAX_PAGE_SIZE (hard reject, not silent clamp)
 *
 * If the caller did not pass `?pageSize=`, we default to LEGACY_DEFAULT_PAGE_SIZE
 * (= MAX_PAGE_SIZE) so legacy callers that previously received the full list
 * keep working — capped, but not silently truncated to 50.
 */
export function parsePagination(req: Request): PageParams {
  const page = req.query.page === undefined || req.query.page === ""
    ? 1
    : toPositiveInt(req.query.page, "page");

  let pageSize: number;
  if (req.query.pageSize === undefined || req.query.pageSize === "") {
    pageSize = LEGACY_DEFAULT_PAGE_SIZE;
  } else {
    pageSize = toPositiveInt(req.query.pageSize, "pageSize");
    if (pageSize > MAX_PAGE_SIZE) {
      throw new PaginationError(
        400,
        `pageSize must not exceed ${MAX_PAGE_SIZE}`,
      );
    }
  }

  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

/**
 * Wrapper that converts PaginationError into the corresponding HTTP response.
 * Returns the parsed params, or `null` if a 400 was already sent (caller MUST
 * `return` immediately when this returns null).
 */
export function parsePaginationOrSend(req: Request, res: import("express").Response): PageParams | null {
  try {
    return parsePagination(req);
  } catch (err) {
    if (err instanceof PaginationError) {
      res.status(err.status).json({ message: err.message });
      return null;
    }
    throw err;
  }
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
