// Client RBAC bridge. Authoritative registry: @shared/permissions.ts.
import type { User } from "@shared/schema";
import {
  ACTIONS,
  ROLE_CODES,
  hasPermission as registryHasAction,
  hasAnyPermission as registryHasAnyAction,
  hasRoleCode,
  hasAnyRoleCode,
  getUserRoleCodes,
  type Action,
  type RoleCode,
} from "@shared/permissions";

export { ACTIONS, ROLE_CODES, getUserRoleCodes, hasRoleCode, hasAnyRoleCode };
export type { Action, RoleCode };

export const ROLES = {
  SUPER_ADMIN: ROLE_CODES.SUPER_ADMIN,
  ADMIN: ROLE_CODES.ADMIN,
  CORPORATE: ROLE_CODES.CORPORATE,
  AGENT: ROLE_CODES.AGENT,
  MERCHANT: ROLE_CODES.MERCHANT,
  UNDERWRITER: ROLE_CODES.UNDERWRITER,
  SENIOR_UNDERWRITER: ROLE_CODES.SENIOR_UNDERWRITER,
  DATA_PROCESSING: ROLE_CODES.DATA_PROCESSING,
  DEPLOYMENT: ROLE_CODES.DEPLOYMENT,
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

// DISPLAY-ONLY: labels for the Role Definitions / Permission Matrix UI in
// users.tsx. NOT consulted for any authorization decision — all gating goes
// through ACTIONS + the runtime permission registry.
export const PERMISSIONS = {
  VIEW_ALL_USERS: "view_all_users",
  CREATE_USERS: "create_users",
  EDIT_USERS: "edit_users",
  DELETE_USERS: "delete_users",
  MANAGE_USER_ROLES: "manage_user_roles",
  VIEW_ALL_MERCHANTS: "view_all_merchants",
  VIEW_OWN_MERCHANT: "view_own_merchant",
  CREATE_MERCHANTS: "create_merchants",
  EDIT_MERCHANTS: "edit_merchants",
  DELETE_MERCHANTS: "delete_merchants",
  VIEW_ALL_AGENTS: "view_all_agents",
  VIEW_OWN_AGENTS: "view_own_agents",
  CREATE_AGENTS: "create_agents",
  EDIT_AGENTS: "edit_agents",
  DELETE_AGENTS: "delete_agents",
  VIEW_ALL_TRANSACTIONS: "view_all_transactions",
  VIEW_OWN_TRANSACTIONS: "view_own_transactions",
  CREATE_TRANSACTIONS: "create_transactions",
  EDIT_TRANSACTIONS: "edit_transactions",
  DELETE_TRANSACTIONS: "delete_transactions",
  VIEW_ALL_LOCATIONS: "view_all_locations",
  VIEW_OWN_LOCATIONS: "view_own_locations",
  CREATE_LOCATIONS: "create_locations",
  EDIT_LOCATIONS: "edit_locations",
  DELETE_LOCATIONS: "delete_locations",
  VIEW_ANALYTICS: "view_analytics",
  VIEW_REPORTS: "view_reports",
  VIEW_FINANCIAL_DATA: "view_financial_data",
  EXPORT_DATA: "export_data",
  MANAGE_SYSTEM: "manage_system",
  VIEW_SYSTEM_LOGS: "view_system_logs",
  MANAGE_INTEGRATIONS: "manage_integrations",
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// DISPLAY-ONLY map for the Permission Matrix tab. Server authorization uses
// ACTION_TO_ROLES in shared/permissions.ts + DB overrides — never this map.
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS) as Permission[],
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_ALL_USERS, PERMISSIONS.CREATE_USERS, PERMISSIONS.EDIT_USERS, PERMISSIONS.MANAGE_USER_ROLES,
    PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.CREATE_MERCHANTS, PERMISSIONS.EDIT_MERCHANTS,
    PERMISSIONS.VIEW_ALL_AGENTS, PERMISSIONS.CREATE_AGENTS, PERMISSIONS.EDIT_AGENTS,
    PERMISSIONS.VIEW_ALL_TRANSACTIONS, PERMISSIONS.CREATE_TRANSACTIONS, PERMISSIONS.EDIT_TRANSACTIONS,
    PERMISSIONS.VIEW_ALL_LOCATIONS, PERMISSIONS.CREATE_LOCATIONS, PERMISSIONS.EDIT_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_FINANCIAL_DATA,
    PERMISSIONS.EXPORT_DATA, PERMISSIONS.VIEW_SYSTEM_LOGS,
  ],
  [ROLES.CORPORATE]: [
    PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.CREATE_MERCHANTS, PERMISSIONS.EDIT_MERCHANTS,
    PERMISSIONS.VIEW_ALL_AGENTS, PERMISSIONS.VIEW_ALL_TRANSACTIONS, PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_FINANCIAL_DATA, PERMISSIONS.EXPORT_DATA,
  ],
  [ROLES.AGENT]: [
    PERMISSIONS.VIEW_OWN_MERCHANT, PERMISSIONS.VIEW_OWN_AGENTS, PERMISSIONS.VIEW_OWN_TRANSACTIONS,
    PERMISSIONS.VIEW_OWN_LOCATIONS, PERMISSIONS.CREATE_TRANSACTIONS, PERMISSIONS.EDIT_TRANSACTIONS,
    PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_REPORTS,
  ],
  [ROLES.MERCHANT]: [
    PERMISSIONS.VIEW_OWN_MERCHANT, PERMISSIONS.VIEW_OWN_TRANSACTIONS, PERMISSIONS.VIEW_OWN_LOCATIONS,
    PERMISSIONS.CREATE_LOCATIONS, PERMISSIONS.EDIT_LOCATIONS, PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLES.UNDERWRITER]: [
    PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.VIEW_ALL_AGENTS, PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_REPORTS,
  ],
  [ROLES.SENIOR_UNDERWRITER]: [
    PERMISSIONS.VIEW_ALL_USERS, PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.EDIT_MERCHANTS,
    PERMISSIONS.VIEW_ALL_AGENTS, PERMISSIONS.VIEW_ALL_LOCATIONS, PERMISSIONS.VIEW_ALL_TRANSACTIONS,
    PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_FINANCIAL_DATA, PERMISSIONS.EXPORT_DATA,
  ],
  [ROLES.DATA_PROCESSING]: [
    PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.EDIT_MERCHANTS, PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.VIEW_ALL_TRANSACTIONS, PERMISSIONS.EDIT_TRANSACTIONS, PERMISSIONS.VIEW_REPORTS,
  ],
  [ROLES.DEPLOYMENT]: [
    PERMISSIONS.VIEW_ALL_MERCHANTS, PERMISSIONS.VIEW_ALL_LOCATIONS, PERMISSIONS.EDIT_LOCATIONS,
    PERMISSIONS.VIEW_REPORTS,
  ],
};

// Authorization helpers — ALL delegate to the runtime registry.
export function canPerformAction(user: User | null, action: Action | string): boolean {
  return registryHasAction(user, action);
}
export function canPerformAnyAction(user: User | null, actions: (Action | string)[]): boolean {
  return registryHasAnyAction(user, actions);
}

export function hasRole(user: User | null, role: Role): boolean {
  return hasRoleCode(user, role);
}
export function hasAnyRole(user: User | null, roles: Role[]): boolean {
  return hasAnyRoleCode(user, roles);
}

export const canAccessUserManagement       = (u: User | null) => registryHasAction(u, ACTIONS.NAV_USERS);
export const canAccessMerchantManagement   = (u: User | null) => registryHasAction(u, ACTIONS.NAV_MERCHANTS);
export const canAccessAgentManagement      = (u: User | null) => registryHasAction(u, ACTIONS.NAV_AGENTS);
export const canAccessTransactionManagement= (u: User | null) => registryHasAction(u, ACTIONS.NAV_TRANSACTIONS);
export const canAccessLocationManagement   = (u: User | null) => registryHasAction(u, ACTIONS.NAV_LOCATIONS);
export const canAccessAnalytics            = (u: User | null) => registryHasAction(u, ACTIONS.ADMIN_READ);
export const canAccessReports              = (u: User | null) => registryHasAction(u, ACTIONS.NAV_REPORTS);
export const canAccessSystemAdmin          = (u: User | null) => registryHasAction(u, ACTIONS.ADMIN_MANAGE);
export const canAccessSecurityDashboard    = (u: User | null) => registryHasAction(u, ACTIONS.NAV_SECURITY);
