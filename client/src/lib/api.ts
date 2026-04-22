import { apiRequest } from "./queryClient";
import type { Merchant, Agent, Transaction, InsertMerchant, InsertAgent, InsertTransaction, MerchantWithAgent, TransactionWithMerchant } from "@shared/schema";

// Server hard-caps page size at 500 (see server/lib/pagination.ts).
// `getAll()` callers request that cap so they receive the full list (up to
// 500 rows) instead of the default-50 first page. New paginated UIs should
// use `*.getPaged(...)` instead.
const MAX_PAGE_SIZE = 500;

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

function buildPageQuery(opts: PageQuery & { defaultPageSize?: number }): string {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  params.set("pageSize", String(opts.pageSize ?? opts.defaultPageSize ?? 50));
  if (opts.search) params.set("search", opts.search);
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  return params.toString();
}

async function fetchPage<T>(path: string, opts: PageQuery & { defaultPageSize?: number }): Promise<PageResponse<T>> {
  const qs = buildPageQuery(opts);
  const response = await apiRequest("GET", `${path}?${qs}`);
  return response.json();
}

// Merchants API
export const merchantsApi = {
  // Legacy unwrapped list — used by hierarchy hydration and modal lookups.
  // Requests up to MAX_PAGE_SIZE so the response is the full set (capped),
  // not just the default first page of 50.
  getAll: async (search?: string): Promise<MerchantWithAgent[]> => {
    const page = await fetchPage<MerchantWithAgent>('/api/merchants', { search, pageSize: MAX_PAGE_SIZE });
    return page.items;
  },

  getPaged: (opts: PageQuery): Promise<PageResponse<MerchantWithAgent>> =>
    fetchPage<MerchantWithAgent>('/api/merchants', opts),

  getById: async (id: number): Promise<Merchant> => {
    const response = await apiRequest('GET', `/api/merchants/${id}`);
    return response.json();
  },

  create: async (merchant: InsertMerchant): Promise<Merchant> => {
    const response = await apiRequest('POST', '/api/merchants', merchant);
    return response.json();
  },

  update: async (id: number, merchant: Partial<InsertMerchant>): Promise<Merchant> => {
    const response = await apiRequest('PUT', `/api/merchants/${id}`, merchant);
    return response.json();
  },

  delete: async (id: number): Promise<void> => {
    await apiRequest('DELETE', `/api/merchants/${id}`);
  }
};

// Agents API
export const agentsApi = {
  getAll: async (search?: string): Promise<Agent[]> => {
    const page = await fetchPage<Agent>('/api/agents', { search, pageSize: MAX_PAGE_SIZE });
    return page.items;
  },

  getPaged: (opts: PageQuery): Promise<PageResponse<Agent>> =>
    fetchPage<Agent>('/api/agents', opts),

  getById: async (id: number): Promise<Agent> => {
    const response = await apiRequest('GET', `/api/agents/${id}`);
    return response.json();
  },

  create: async (agent: InsertAgent): Promise<Agent> => {
    const response = await apiRequest('POST', '/api/agents', agent);
    return response.json();
  },

  update: async (id: number, agent: Partial<InsertAgent>): Promise<Agent> => {
    const response = await apiRequest('PUT', `/api/agents/${id}`, agent);
    return response.json();
  },

  delete: async (id: number): Promise<void> => {
    await apiRequest('DELETE', `/api/agents/${id}`);
  }
};

// Transactions API
export const transactionsApi = {
  getAll: async (search?: string, merchantId?: number): Promise<TransactionWithMerchant[]> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (merchantId) params.append('merchantId', merchantId.toString());
    params.set('pageSize', String(MAX_PAGE_SIZE));
    const response = await apiRequest('GET', `/api/transactions?${params.toString()}`);
    const page = await response.json();
    // Backwards compat: server now returns { items, total, ... }
    return Array.isArray(page) ? page : page.items;
  },

  getPaged: (opts: PageQuery): Promise<PageResponse<TransactionWithMerchant>> =>
    fetchPage<TransactionWithMerchant>('/api/transactions', opts),

  getById: async (id: number): Promise<Transaction> => {
    const response = await apiRequest('GET', `/api/transactions/${id}`);
    return response.json();
  },

  create: async (transaction: InsertTransaction): Promise<Transaction> => {
    const response = await apiRequest('POST', '/api/transactions', transaction);
    return response.json();
  },

  update: async (id: number, transaction: Partial<InsertTransaction>): Promise<Transaction> => {
    const response = await apiRequest('PUT', `/api/transactions/${id}`, transaction);
    return response.json();
  }
};

// Analytics API
export const analyticsApi = {
  getDashboardMetrics: async (): Promise<{
    totalRevenue: string;
    activeMerchants: number;
    transactionsToday: number;
    activeAgents: number;
  }> => {
    const response = await apiRequest('GET', '/api/analytics/dashboard');
    return response.json();
  },

  getTopMerchants: async (): Promise<(Merchant & { transactionCount: number; totalVolume: string })[]> => {
    const response = await apiRequest('GET', '/api/analytics/top-merchants');
    return response.json();
  },

  getRecentTransactions: async (limit?: number): Promise<TransactionWithMerchant[]> => {
    const url = limit ? `/api/analytics/recent-transactions?limit=${limit}` : '/api/analytics/recent-transactions';
    const response = await apiRequest('GET', url);
    return response.json();
  }
};
