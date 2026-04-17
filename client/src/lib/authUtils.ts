// Legacy helpers — prefer @/lib/rbac (canPerformAction, canAccessXxx) for new code.
// These wrappers tolerate user.roles[] (new) and user.role (legacy single-role).
import { getUserRoleCodes, ROLE_CODES } from "@shared/permissions";

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

function userRoles(user: any): string[] {
  return getUserRoleCodes(user);
}

export function hasRole(user: any, allowedRoles: string[]): boolean {
  if (!user) return false;
  const roles = userRoles(user);
  if (roles.includes(ROLE_CODES.SUPER_ADMIN)) return true;
  return roles.some((r) => allowedRoles.includes(r));
}

const ALL_AGENT_OR_HIGHER = [
  ROLE_CODES.AGENT, ROLE_CODES.ADMIN, ROLE_CODES.CORPORATE, ROLE_CODES.SUPER_ADMIN,
  ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER,
  ROLE_CODES.DATA_PROCESSING, ROLE_CODES.DEPLOYMENT,
];
const ALL_ADMIN_TIER = [
  ROLE_CODES.ADMIN, ROLE_CODES.CORPORATE, ROLE_CODES.SUPER_ADMIN,
];

export function canAccessMerchants(user: any): boolean {
  return hasRole(user, [ROLE_CODES.MERCHANT, ...ALL_AGENT_OR_HIGHER]);
}

export function canAccessAgents(user: any): boolean {
  return hasRole(user, ALL_AGENT_OR_HIGHER);
}

export function canAccessTransactions(user: any): boolean {
  return hasRole(user, [ROLE_CODES.MERCHANT, ...ALL_AGENT_OR_HIGHER]);
}

export function canAccessAnalytics(user: any): boolean {
  return hasRole(user, ALL_ADMIN_TIER);
}

export function canManageMerchants(user: any): boolean {
  return hasRole(user, ALL_ADMIN_TIER);
}

export function canManageAgents(user: any): boolean {
  return hasRole(user, ALL_ADMIN_TIER);
}

export function canManageTransactions(user: any): boolean {
  return hasRole(user, ALL_ADMIN_TIER);
}

export function canManageUsers(user: any): boolean {
  return hasRole(user, ALL_ADMIN_TIER);
}
