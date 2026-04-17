// Thin delegating wrappers — the single source of truth is shared/permissions.ts
// (consulted via canPerformAction). These helpers exist purely to keep call
// sites in legacy components readable; they all resolve to action checks.
import { hasPermission as registryHasPermission, ACTIONS, getUserRoleCodes, ROLE_CODES } from "@shared/permissions";

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Backwards-compat: takes a role-code list. Kept only for legacy call sites
// that haven't been migrated to action-based checks. New code should call
// canPerformAction(user, ACTIONS.X) instead.
export function hasRole(user: any, allowedRoles: string[]): boolean {
  if (!user) return false;
  const roles = getUserRoleCodes(user);
  if (roles.includes(ROLE_CODES.SUPER_ADMIN)) return true;
  return roles.some((r) => allowedRoles.includes(r));
}

export const canAccessMerchants    = (u: any) => registryHasPermission(u, ACTIONS.NAV_MERCHANTS);
export const canAccessAgents       = (u: any) => registryHasPermission(u, ACTIONS.NAV_AGENTS);
export const canAccessTransactions = (u: any) => registryHasPermission(u, ACTIONS.NAV_TRANSACTIONS);
export const canAccessAnalytics    = (u: any) => registryHasPermission(u, ACTIONS.ADMIN_READ);

export const canManageMerchants    = (u: any) => registryHasPermission(u, ACTIONS.ADMIN_MANAGE);
export const canManageAgents       = (u: any) => registryHasPermission(u, ACTIONS.ADMIN_MANAGE);
export const canManageTransactions = (u: any) => registryHasPermission(u, ACTIONS.ADMIN_MANAGE);
export const canManageUsers        = (u: any) => registryHasPermission(u, ACTIONS.NAV_USERS);
