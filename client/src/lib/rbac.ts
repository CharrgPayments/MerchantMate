import type { User } from "@shared/schema";

// Define role hierarchy and permissions
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin", 
  CORPORATE: "corporate",
  AGENT: "agent",
  MERCHANT: "merchant",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Permission definitions
export const PERMISSIONS = {
  // User management
  VIEW_ALL_USERS: "view_all_users",
  CREATE_USERS: "create_users",
  EDIT_USERS: "edit_users",
  DELETE_USERS: "delete_users",
  MANAGE_USER_ROLES: "manage_user_roles",
  
  // Merchant management
  VIEW_ALL_MERCHANTS: "view_all_merchants",
  VIEW_OWN_MERCHANT: "view_own_merchant",
  CREATE_MERCHANTS: "create_merchants",
  EDIT_MERCHANTS: "edit_merchants",
  DELETE_MERCHANTS: "delete_merchants",
  
  // Agent management
  VIEW_ALL_AGENTS: "view_all_agents",
  VIEW_OWN_AGENTS: "view_own_agents",
  CREATE_AGENTS: "create_agents",
  EDIT_AGENTS: "edit_agents",
  DELETE_AGENTS: "delete_agents",
  
  // Transaction management
  VIEW_ALL_TRANSACTIONS: "view_all_transactions",
  VIEW_OWN_TRANSACTIONS: "view_own_transactions",
  CREATE_TRANSACTIONS: "create_transactions",
  EDIT_TRANSACTIONS: "edit_transactions",
  DELETE_TRANSACTIONS: "delete_transactions",
  
  // Location management
  VIEW_ALL_LOCATIONS: "view_all_locations",
  VIEW_OWN_LOCATIONS: "view_own_locations",
  CREATE_LOCATIONS: "create_locations",
  EDIT_LOCATIONS: "edit_locations",
  DELETE_LOCATIONS: "delete_locations",
  
  // Analytics and reporting
  VIEW_ANALYTICS: "view_analytics",
  VIEW_REPORTS: "view_reports",
  VIEW_FINANCIAL_DATA: "view_financial_data",
  EXPORT_DATA: "export_data",
  
  // System administration
  MANAGE_SYSTEM: "manage_system",
  VIEW_SYSTEM_LOGS: "view_system_logs",
  MANAGE_INTEGRATIONS: "manage_integrations",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Role-based permission mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.SUPER_ADMIN]: [
    // Super admin has all permissions
    ...Object.values(PERMISSIONS),
  ],
  
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_ALL_USERS,
    PERMISSIONS.CREATE_USERS,
    PERMISSIONS.EDIT_USERS,
    PERMISSIONS.MANAGE_USER_ROLES,
    PERMISSIONS.VIEW_ALL_MERCHANTS,
    PERMISSIONS.CREATE_MERCHANTS,
    PERMISSIONS.EDIT_MERCHANTS,
    PERMISSIONS.VIEW_ALL_AGENTS,
    PERMISSIONS.CREATE_AGENTS,
    PERMISSIONS.EDIT_AGENTS,
    PERMISSIONS.VIEW_ALL_TRANSACTIONS,
    PERMISSIONS.CREATE_TRANSACTIONS,
    PERMISSIONS.EDIT_TRANSACTIONS,
    PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.CREATE_LOCATIONS,
    PERMISSIONS.EDIT_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_DATA,
    PERMISSIONS.EXPORT_DATA,
    PERMISSIONS.VIEW_SYSTEM_LOGS,
  ],
  
  [ROLES.CORPORATE]: [
    PERMISSIONS.VIEW_ALL_MERCHANTS,
    PERMISSIONS.CREATE_MERCHANTS,
    PERMISSIONS.EDIT_MERCHANTS,
    PERMISSIONS.VIEW_ALL_AGENTS,
    PERMISSIONS.VIEW_ALL_TRANSACTIONS,
    PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_DATA,
    PERMISSIONS.EXPORT_DATA,
  ],
  
  [ROLES.AGENT]: [
    PERMISSIONS.VIEW_OWN_MERCHANT,
    PERMISSIONS.VIEW_OWN_AGENTS,
    PERMISSIONS.VIEW_OWN_TRANSACTIONS,
    PERMISSIONS.VIEW_OWN_LOCATIONS,
    PERMISSIONS.CREATE_TRANSACTIONS,
    PERMISSIONS.EDIT_TRANSACTIONS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_REPORTS,
  ],
  
  [ROLES.MERCHANT]: [
    PERMISSIONS.VIEW_OWN_MERCHANT,
    PERMISSIONS.VIEW_OWN_TRANSACTIONS,
    PERMISSIONS.VIEW_OWN_LOCATIONS,
    PERMISSIONS.CREATE_LOCATIONS,
    PERMISSIONS.EDIT_LOCATIONS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
};

// Permission checking functions
export function hasPermission(user: User | null, permission: Permission): boolean {
  if (!user || !user.role) return false;
  
  const userRole = user.role as Role;
  const rolePermissions = ROLE_PERMISSIONS[userRole] || [];
  
  return rolePermissions.includes(permission);
}

export function hasAnyPermission(user: User | null, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(user, permission));
}

export function hasAllPermissions(user: User | null, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(user, permission));
}

// Role checking functions
export function hasRole(user: User | null, role: Role): boolean {
  if (!user || !user.role) return false;
  return user.role === role;
}

export function hasAnyRole(user: User | null, roles: Role[]): boolean {
  if (!user || !user.role) return false;
  return roles.includes(user.role as Role);
}

// Higher-level access control functions
export function canAccessUserManagement(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_ALL_USERS,
    PERMISSIONS.CREATE_USERS,
    PERMISSIONS.EDIT_USERS,
  ]);
}

export function canAccessMerchantManagement(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_ALL_MERCHANTS,
    PERMISSIONS.VIEW_OWN_MERCHANT,
    PERMISSIONS.CREATE_MERCHANTS,
  ]);
}

export function canAccessAgentManagement(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_ALL_AGENTS,
    PERMISSIONS.VIEW_OWN_AGENTS,
    PERMISSIONS.CREATE_AGENTS,
  ]);
}

export function canAccessTransactionManagement(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_ALL_TRANSACTIONS,
    PERMISSIONS.VIEW_OWN_TRANSACTIONS,
    PERMISSIONS.CREATE_TRANSACTIONS,
  ]);
}

export function canAccessLocationManagement(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_ALL_LOCATIONS,
    PERMISSIONS.VIEW_OWN_LOCATIONS,
    PERMISSIONS.CREATE_LOCATIONS,
  ]);
}

export function canAccessAnalytics(user: User | null): boolean {
  return hasPermission(user, PERMISSIONS.VIEW_ANALYTICS);
}

export function canAccessReports(user: User | null): boolean {
  return hasPermission(user, PERMISSIONS.VIEW_REPORTS);
}

export function canAccessSystemAdmin(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.MANAGE_SYSTEM,
    PERMISSIONS.VIEW_SYSTEM_LOGS,
  ]);
}

export function canAccessSecurityDashboard(user: User | null): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.VIEW_SYSTEM_LOGS,
    PERMISSIONS.MANAGE_SYSTEM,
  ]);
}

// Data filtering functions based on user role
export function shouldFilterByUser(user: User | null): boolean {
  if (!user) return true;
  
  // Super admin, admin, and corporate can see all data
  return !hasAnyRole(user, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE]);
}

export function getUserDataScope(user: User | null): 'all' | 'own' | 'none' {
  if (!user) return 'none';
  
  if (hasAnyRole(user, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE])) {
    return 'all';
  }
  
  if (hasAnyRole(user, [ROLES.AGENT, ROLES.MERCHANT])) {
    return 'own';
  }
  
  return 'none';
}