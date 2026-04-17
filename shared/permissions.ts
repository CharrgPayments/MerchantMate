// Central permission/action registry shared by client + server.
// "Source of truth" for who can hit which endpoint and which UI controls render.
// Adding a new role = add it to ROLE_CODES + (optionally) grant it actions below.
// Adding a new action = add to ACTIONS + entry in ACTION_TO_ROLES.

export const ROLE_CODES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  CORPORATE: "corporate",
  AGENT: "agent",
  MERCHANT: "merchant",
  UNDERWRITER: "underwriter",
  SENIOR_UNDERWRITER: "senior_underwriter",
  DATA_PROCESSING: "data_processing",
  DEPLOYMENT: "deployment",
} as const;
export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const ALL_ROLE_CODES: RoleCode[] = Object.values(ROLE_CODES);

// Actions are coarse capability tokens used by route middleware + UI gates.
// Names follow `domain:verb` and intentionally mirror the legacy requireRole
// argument groupings so behaviour parity is trivially auditable.
export const ACTIONS = {
  // Catch-alls for legacy requireRole signatures (preserves prior behaviour 1:1)
  ADMIN_MANAGE: "admin:manage",         // ['admin','super_admin']
  ADMIN_READ: "admin:read",             // ['admin','corporate','super_admin']
  AGENT_READ: "agent:read",             // ['admin','corporate','super_admin','agent']
  SUPERADMIN_ONLY: "system:superadmin", // ['super_admin']

  // Underwriting pipeline (Epic B will gate transitions on these)
  UNDERWRITING_VIEW_QUEUE: "underwriting:view-queue",
  UNDERWRITING_REVIEW: "underwriting:review",
  UNDERWRITING_APPROVE: "underwriting:approve",
  UNDERWRITING_DECLINE: "underwriting:decline",

  // Data processing & deployment ops
  DATA_PROCESSING_VIEW: "data-processing:view",
  DATA_PROCESSING_EDIT: "data-processing:edit",
  DEPLOYMENT_VIEW: "deployment:view",
  DEPLOYMENT_MANAGE: "deployment:manage",
} as const;
export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

// Default mapping: action → roles that may perform it.
// super_admin is always implicitly allowed (handled by hasPermission helper).
export const DEFAULT_ACTION_ROLES: Record<Action, RoleCode[]> = {
  [ACTIONS.ADMIN_MANAGE]: [ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN],
  [ACTIONS.ADMIN_READ]: [ROLE_CODES.ADMIN, ROLE_CODES.CORPORATE, ROLE_CODES.SUPER_ADMIN],
  [ACTIONS.AGENT_READ]: [
    ROLE_CODES.ADMIN, ROLE_CODES.CORPORATE, ROLE_CODES.SUPER_ADMIN, ROLE_CODES.AGENT,
  ],
  [ACTIONS.SUPERADMIN_ONLY]: [ROLE_CODES.SUPER_ADMIN],

  [ACTIONS.UNDERWRITING_VIEW_QUEUE]: [
    ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER,
    ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.UNDERWRITING_REVIEW]: [
    ROLE_CODES.UNDERWRITER, ROLE_CODES.SENIOR_UNDERWRITER,
    ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.UNDERWRITING_APPROVE]: [
    ROLE_CODES.SENIOR_UNDERWRITER, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.UNDERWRITING_DECLINE]: [
    ROLE_CODES.SENIOR_UNDERWRITER, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],

  [ACTIONS.DATA_PROCESSING_VIEW]: [
    ROLE_CODES.DATA_PROCESSING, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.DATA_PROCESSING_EDIT]: [
    ROLE_CODES.DATA_PROCESSING, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.DEPLOYMENT_VIEW]: [
    ROLE_CODES.DEPLOYMENT, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
  [ACTIONS.DEPLOYMENT_MANAGE]: [
    ROLE_CODES.DEPLOYMENT, ROLE_CODES.ADMIN, ROLE_CODES.SUPER_ADMIN,
  ],
};

// Build a UI-friendly grouping for the permission matrix display.
export const ACTION_GROUPS: { label: string; actions: Action[] }[] = [
  {
    label: "Administration",
    actions: [ACTIONS.ADMIN_MANAGE, ACTIONS.ADMIN_READ, ACTIONS.AGENT_READ, ACTIONS.SUPERADMIN_ONLY],
  },
  {
    label: "Underwriting",
    actions: [
      ACTIONS.UNDERWRITING_VIEW_QUEUE, ACTIONS.UNDERWRITING_REVIEW,
      ACTIONS.UNDERWRITING_APPROVE, ACTIONS.UNDERWRITING_DECLINE,
    ],
  },
  {
    label: "Data Processing & Deployment",
    actions: [
      ACTIONS.DATA_PROCESSING_VIEW, ACTIONS.DATA_PROCESSING_EDIT,
      ACTIONS.DEPLOYMENT_VIEW, ACTIONS.DEPLOYMENT_MANAGE,
    ],
  },
];

export const ACTION_LABELS: Record<Action, string> = {
  [ACTIONS.ADMIN_MANAGE]: "Admin: Manage (write)",
  [ACTIONS.ADMIN_READ]: "Admin: Read all",
  [ACTIONS.AGENT_READ]: "Agent or higher: Read",
  [ACTIONS.SUPERADMIN_ONLY]: "Super Admin only",
  [ACTIONS.UNDERWRITING_VIEW_QUEUE]: "View underwriting queue",
  [ACTIONS.UNDERWRITING_REVIEW]: "Review applications",
  [ACTIONS.UNDERWRITING_APPROVE]: "Approve applications",
  [ACTIONS.UNDERWRITING_DECLINE]: "Decline applications",
  [ACTIONS.DATA_PROCESSING_VIEW]: "View processing data",
  [ACTIONS.DATA_PROCESSING_EDIT]: "Edit processing data",
  [ACTIONS.DEPLOYMENT_VIEW]: "View deployments",
  [ACTIONS.DEPLOYMENT_MANAGE]: "Manage deployments",
};

// Minimal user shape that both server (db row) and client (auth/me) satisfy.
export interface UserWithRoles {
  roles?: string[] | null;
  role?: string | null;
}

// Returns the effective role list for a user. Tolerates legacy single-role users.
export function getUserRoleCodes(user: UserWithRoles | null | undefined): string[] {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  if (user.role) return [user.role];
  return [];
}

// Resolve which roles are allowed for an action. Override map is used at runtime
// once the role_definitions DB table is loaded; callers that don't pass an
// override fall back to DEFAULT_ACTION_ROLES.
export function getAllowedRolesForAction(
  action: Action | string,
  overrides?: Record<string, string[]>,
): string[] {
  if (overrides && overrides[action]) return overrides[action];
  return (DEFAULT_ACTION_ROLES as Record<string, string[]>)[action] ?? [];
}

// Pure permission check usable on both client and server.
// super_admin always passes (matches existing requirePermission behaviour).
export function hasPermission(
  user: UserWithRoles | null | undefined,
  action: Action | string,
  overrides?: Record<string, string[]>,
): boolean {
  const userRoles = getUserRoleCodes(user);
  if (userRoles.length === 0) return false;
  if (userRoles.includes(ROLE_CODES.SUPER_ADMIN)) return true;
  const allowed = getAllowedRolesForAction(action, overrides);
  return userRoles.some((r) => allowed.includes(r));
}

export function hasAnyPermission(
  user: UserWithRoles | null | undefined,
  actions: (Action | string)[],
  overrides?: Record<string, string[]>,
): boolean {
  return actions.some((a) => hasPermission(user, a, overrides));
}

export function hasRoleCode(
  user: UserWithRoles | null | undefined,
  role: RoleCode | string,
): boolean {
  return getUserRoleCodes(user).includes(role);
}

export function hasAnyRoleCode(
  user: UserWithRoles | null | undefined,
  roles: (RoleCode | string)[],
): boolean {
  const userRoles = getUserRoleCodes(user);
  return roles.some((r) => userRoles.includes(r));
}
