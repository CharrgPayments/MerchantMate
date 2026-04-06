export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

export function hasRole(user: any, allowedRoles: string[]): boolean {
  return user && allowedRoles.includes(user.role);
}

export function canAccessMerchants(user: any): boolean {
  return hasRole(user, ['merchant', 'agent', 'admin', 'corporate', 'super_admin']);
}

export function canAccessAgents(user: any): boolean {
  return hasRole(user, ['agent', 'admin', 'corporate', 'super_admin']);
}

export function canAccessTransactions(user: any): boolean {
  return hasRole(user, ['merchant', 'agent', 'admin', 'corporate', 'super_admin']);
}

export function canAccessAnalytics(user: any): boolean {
  return hasRole(user, ['admin', 'corporate', 'super_admin']);
}

export function canManageMerchants(user: any): boolean {
  return hasRole(user, ['admin', 'corporate', 'super_admin']);
}

export function canManageAgents(user: any): boolean {
  return hasRole(user, ['admin', 'corporate', 'super_admin']);
}

export function canManageTransactions(user: any): boolean {
  return hasRole(user, ['admin', 'corporate', 'super_admin']);
}

export function canManageUsers(user: any): boolean {
  return hasRole(user, ['admin', 'corporate', 'super_admin']);
}