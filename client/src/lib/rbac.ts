// Client-side RBAC bridge. Shared registry lives in @shared/permissions.ts so the
// same definitions are used by server middleware and by client UI gates.
import type { User } from "@shared/schema";
import {
  ACTIONS,
  ROLE_CODES,
  hasPermission as hasActionPermission,
  hasAnyPermission as hasAnyActionPermission,
  hasRoleCode,
  hasAnyRoleCode,
  getUserRoleCodes,
  type Action,
  type RoleCode,
} from "@shared/permissions";

// Re-export for direct callers
export { ACTIONS, ROLE_CODES, getUserRoleCodes, hasRoleCode, hasAnyRoleCode };
export type { Action, RoleCode };

// ── Backward-compatible legacy ROLES + PERMISSIONS api (used by users.tsx etc.)
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

// Fine-grained permission catalog (mirrors role_definitions.permissions[] strings).
// Kept here for the Users → Role Definitions UI.
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

// Static (frontend display) role -> permissions map. Used by the matrix tab.
// Server-side authorisation does NOT rely on this map — it uses ACTION_TO_ROLES
// in shared/permissions.ts. Keep in rough sync with migrations/0005 seed data.
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

// ── Permission checks ───────────────────────────────────────────────────────

// Legacy fine-grained permission check (uses static ROLE_PERMISSIONS map above).
// Existing call sites pass strings like PERMISSIONS.VIEW_ANALYTICS.
export function hasPermission(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  const roles = getUserRoleCodes(user);
  if (roles.length === 0) return false;
  if (roles.includes(ROLE_CODES.SUPER_ADMIN)) return true;
  return roles.some((r) => {
    const perms = ROLE_PERMISSIONS[r as Role];
    return perms ? perms.includes(permission) : false;
  });
}

export function hasAnyPermission(user: User | null, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export function hasAllPermissions(user: User | null, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(user, p));
}

// Action-based check that mirrors the server's requirePerm middleware.
// Prefer this for new UI gates so the registry is the single source of truth.
export function canPerformAction(user: User | null, action: Action | string): boolean {
  return hasActionPermission(user, action);
}

export function canPerformAnyAction(user: User | null, actions: (Action | string)[]): boolean {
  return hasAnyActionPermission(user, actions);
}

// Role checks (use roles[] array; tolerate legacy single-role users)
export function hasRole(user: User | null, role: Role): boolean {
  return hasRoleCode(user, role);
}

export function hasAnyRole(user: User | null, roles: Role[]): boolean {
  return hasAnyRoleCode(user, roles);
}

// ── Higher-level access control helpers ─────────────────────────────────────
// These are thin shims over the runtime permission registry (DEFAULT_ACTION_GRANTS
// + DB overrides) so the static `ROLE_PERMISSIONS` map below is NEVER consulted
// for authorization. Display-only consumers (e.g. role-definitions UI) may still
// read `ROLE_PERMISSIONS` and `PERMISSIONS` for human-readable labels.
export function canAccessUserManagement(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_USERS);
}

export function canAccessMerchantManagement(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_MERCHANTS);
}

export function canAccessAgentManagement(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_AGENTS);
}

export function canAccessTransactionManagement(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_TRANSACTIONS);
}

export function canAccessLocationManagement(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_LOCATIONS);
}

export function canAccessAnalytics(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.ADMIN_READ);
}

export function canAccessReports(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_REPORTS);
}

export function canAccessSystemAdmin(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.ADMIN_MANAGE);
}

export function canAccessSecurityDashboard(user: User | null): boolean {
  return hasActionPermission(user, ACTIONS.NAV_SECURITY);
}

// ── Data filtering helpers ─────────────────────────────────────────────────

export function shouldFilterByUser(user: User | null): boolean {
  if (!user) return true;
  return !hasAnyRole(user, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE]);
}

export function getUserDataScope(user: User | null): "all" | "own" | "none" {
  if (!user) return "none";
  if (hasAnyRole(user, [
    ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE,
    ROLES.UNDERWRITER, ROLES.SENIOR_UNDERWRITER,
    ROLES.DATA_PROCESSING, ROLES.DEPLOYMENT,
  ])) return "all";
  if (hasAnyRole(user, [ROLES.AGENT, ROLES.MERCHANT])) return "own";
  return "none";
}
