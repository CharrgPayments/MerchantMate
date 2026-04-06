import { apiRequest } from "./queryClient";
import type { Merchant, Agent, Transaction, InsertMerchant, InsertAgent, InsertTransaction, MerchantWithAgent, TransactionWithMerchant } from "@shared/schema";

// Merchants API
export const merchantsApi = {
  getAll: async (search?: string): Promise<MerchantWithAgent[]> => {
    const url = search ? `/api/merchants?search=${encodeURIComponent(search)}` : '/api/merchants';
    const response = await apiRequest('GET', url);
    return response.json();
  },

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
    const url = search ? `/api/agents?search=${encodeURIComponent(search)}` : '/api/agents';
    const response = await apiRequest('GET', url);
    return response.json();
  },

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
    let url = '/api/transactions';
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (merchantId) params.append('merchantId', merchantId.toString());
    if (params.toString()) url += `?${params.toString()}`;
    
    const response = await apiRequest('GET', url);
    return response.json();
  },

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
