// Central permission/action registry shared by client + server.
// Single source of truth for who can hit which endpoint and which UI controls render.
//
// Concepts:
//   ROLE_CODES — the catalogue of all known roles (system + future custom)
//   ACTIONS    — coarse capability tokens used by route middleware + UI gates
//   Scope      — per-grant data scope ("own" | "downline" | "all"); coarse enough
//                to drive data filters without being a full ABAC system
//   DEFAULT_ACTION_GRANTS — file-defined defaults; runtime overrides live in
//                           the role_action_grants DB table and are merged in
//                           by the server's permission registry cache.

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

// Scope hierarchy: 'all' ⊃ 'downline' ⊃ 'own'. None = denied.
export const SCOPES = ["own", "downline", "all"] as const;
export type Scope = (typeof SCOPES)[number];

export function scopeRank(s: Scope | null | undefined): number {
  if (!s) return 0;
  if (s === "own") return 1;
  if (s === "downline") return 2;
  return 3; // all
}

export function maxScope(a: Scope | null | undefined, b: Scope | null | undefined): Scope | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return scopeRank(a) >= scopeRank(b) ? a : b;
}

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

  // Navigation visibility (sidebar). One per nav item so super-admin can
  // surgically toggle who sees what from the matrix UI without code changes.
  NAV_DASHBOARD: "nav:dashboard",
  NAV_AGENT_DASHBOARD: "nav:agent-dashboard",
  NAV_MERCHANTS: "nav:merchants",
  NAV_LOCATIONS: "nav:locations",
  NAV_AGENTS: "nav:agents",
  NAV_PROSPECTS: "nav:prospects",
  NAV_CAMPAIGNS: "nav:campaigns",
  NAV_ACQUIRERS: "nav:acquirers",
  NAV_TRANSACTIONS: "nav:transactions",
  NAV_PDF_FORMS: "nav:pdf-forms",
  NAV_USERS: "nav:users",
  NAV_REPORTS: "nav:reports",
  NAV_SECURITY: "nav:security",
  NAV_COMMUNICATIONS: "nav:communications",
  NAV_WORKFLOWS: "nav:workflows",
  NAV_API_DOCS: "nav:api-docs",
  NAV_TESTING: "nav:testing-utilities",
  NAV_PERMISSION_MATRIX: "nav:permission-matrix",
  NAV_ACTION_TEMPLATES: "nav:action-templates",
  NAV_DATA_VIEW: "nav:data-view",
  NAV_COMMISSIONS: "nav:commissions",

  // Epic E — Commission ledger & residuals
  COMMISSIONS_VIEW: "commissions:view",       // see your own (or downline) statement
  COMMISSIONS_MANAGE: "commissions:manage",   // edit overrides, recalc, settings
  PAYOUTS_MANAGE: "payouts:manage",           // create / mark paid / void payouts
} as const;
export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];
export const ALL_ACTIONS: Action[] = Object.values(ACTIONS);

export type ActionGrants = Partial<Record<RoleCode, Scope>>;

// Default mapping. super_admin is implicitly 'all' on every action (handled by helpers).
export const DEFAULT_ACTION_GRANTS: Record<Action, ActionGrants> = {
  [ACTIONS.ADMIN_MANAGE]: {
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.ADMIN_READ]: {
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.AGENT_READ]: {
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.AGENT]: "downline",
  },
  [ACTIONS.SUPERADMIN_ONLY]: {
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },

  [ACTIONS.UNDERWRITING_VIEW_QUEUE]: {
    [ROLE_CODES.UNDERWRITER]: "own",
    [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.UNDERWRITING_REVIEW]: {
    [ROLE_CODES.UNDERWRITER]: "own",
    [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.UNDERWRITING_APPROVE]: {
    [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.UNDERWRITING_DECLINE]: {
    [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },

  [ACTIONS.DATA_PROCESSING_VIEW]: {
    [ROLE_CODES.DATA_PROCESSING]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.DATA_PROCESSING_EDIT]: {
    [ROLE_CODES.DATA_PROCESSING]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.DEPLOYMENT_VIEW]: {
    [ROLE_CODES.DEPLOYMENT]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.DEPLOYMENT_MANAGE]: {
    [ROLE_CODES.DEPLOYMENT]: "all",
    [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all",
  },

  // Nav defaults — derived from the previous hard-coded sidebar role arrays.
  [ACTIONS.NAV_DASHBOARD]: {
    [ROLE_CODES.MERCHANT]: "all", [ROLE_CODES.AGENT]: "all", [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.UNDERWRITER]: "all", [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.DATA_PROCESSING]: "all", [ROLE_CODES.DEPLOYMENT]: "all",
  },
  [ACTIONS.NAV_AGENT_DASHBOARD]: { [ROLE_CODES.AGENT]: "all" },
  [ACTIONS.NAV_MERCHANTS]: {
    [ROLE_CODES.AGENT]: "downline", [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all",
    [ROLE_CODES.SUPER_ADMIN]: "all", [ROLE_CODES.UNDERWRITER]: "all",
    [ROLE_CODES.SENIOR_UNDERWRITER]: "all", [ROLE_CODES.DATA_PROCESSING]: "all",
    [ROLE_CODES.DEPLOYMENT]: "all",
  },
  [ACTIONS.NAV_LOCATIONS]: {
    [ROLE_CODES.MERCHANT]: "own", [ROLE_CODES.AGENT]: "downline",
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all",
    [ROLE_CODES.DEPLOYMENT]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.NAV_AGENTS]: {
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.AGENT]: "downline",
    [ROLE_CODES.UNDERWRITER]: "all", [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
  },
  [ACTIONS.NAV_PROSPECTS]: {
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.UNDERWRITER]: "own", [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
  },
  [ACTIONS.NAV_CAMPAIGNS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_ACQUIRERS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_TRANSACTIONS]: {
    [ROLE_CODES.MERCHANT]: "own", [ROLE_CODES.AGENT]: "downline", [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.DATA_PROCESSING]: "all",
  },
  [ACTIONS.NAV_PDF_FORMS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_USERS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_REPORTS]: {
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
    [ROLE_CODES.AGENT]: "downline",
    [ROLE_CODES.UNDERWRITER]: "own", [ROLE_CODES.SENIOR_UNDERWRITER]: "all",
    [ROLE_CODES.DATA_PROCESSING]: "all", [ROLE_CODES.DEPLOYMENT]: "all",
  },
  [ACTIONS.NAV_SECURITY]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_COMMUNICATIONS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_WORKFLOWS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_API_DOCS]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_TESTING]: { [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_PERMISSION_MATRIX]: { [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_ACTION_TEMPLATES]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_DATA_VIEW]: { [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all" },
  [ACTIONS.NAV_COMMISSIONS]: {
    [ROLE_CODES.AGENT]: "downline", [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.COMMISSIONS_VIEW]: {
    [ROLE_CODES.AGENT]: "downline", [ROLE_CODES.ADMIN]: "all",
    [ROLE_CODES.CORPORATE]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.COMMISSIONS_MANAGE]: {
    // Agents can manage overrides on their own direct downline edges (the
    // server enforces edge ownership). Admins/super-admins can manage any.
    [ROLE_CODES.AGENT]: "downline",
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
  },
  [ACTIONS.PAYOUTS_MANAGE]: {
    [ROLE_CODES.ADMIN]: "all", [ROLE_CODES.SUPER_ADMIN]: "all",
  },
};

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
  {
    label: "Sidebar Navigation",
    actions: [
      ACTIONS.NAV_DASHBOARD, ACTIONS.NAV_AGENT_DASHBOARD, ACTIONS.NAV_MERCHANTS,
      ACTIONS.NAV_LOCATIONS, ACTIONS.NAV_AGENTS, ACTIONS.NAV_PROSPECTS,
      ACTIONS.NAV_CAMPAIGNS, ACTIONS.NAV_ACQUIRERS, ACTIONS.NAV_TRANSACTIONS,
      ACTIONS.NAV_PDF_FORMS, ACTIONS.NAV_USERS, ACTIONS.NAV_REPORTS,
      ACTIONS.NAV_SECURITY, ACTIONS.NAV_COMMUNICATIONS, ACTIONS.NAV_WORKFLOWS,
      ACTIONS.NAV_API_DOCS, ACTIONS.NAV_TESTING, ACTIONS.NAV_PERMISSION_MATRIX,
      ACTIONS.NAV_ACTION_TEMPLATES, ACTIONS.NAV_DATA_VIEW, ACTIONS.NAV_COMMISSIONS,
    ],
  },
  {
    label: "Commissions & Payouts",
    actions: [ACTIONS.COMMISSIONS_VIEW, ACTIONS.COMMISSIONS_MANAGE, ACTIONS.PAYOUTS_MANAGE],
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
  [ACTIONS.NAV_DASHBOARD]: "Sidebar: Dashboard",
  [ACTIONS.NAV_AGENT_DASHBOARD]: "Sidebar: Agent Dashboard",
  [ACTIONS.NAV_MERCHANTS]: "Sidebar: Merchants",
  [ACTIONS.NAV_LOCATIONS]: "Sidebar: Locations",
  [ACTIONS.NAV_AGENTS]: "Sidebar: Agents",
  [ACTIONS.NAV_PROSPECTS]: "Sidebar: Prospects",
  [ACTIONS.NAV_CAMPAIGNS]: "Sidebar: Campaigns",
  [ACTIONS.NAV_ACQUIRERS]: "Sidebar: Acquirers",
  [ACTIONS.NAV_TRANSACTIONS]: "Sidebar: Transactions",
  [ACTIONS.NAV_PDF_FORMS]: "Sidebar: PDF Forms",
  [ACTIONS.NAV_USERS]: "Sidebar: Users",
  [ACTIONS.NAV_REPORTS]: "Sidebar: Reports",
  [ACTIONS.NAV_SECURITY]: "Sidebar: Security",
  [ACTIONS.NAV_COMMUNICATIONS]: "Sidebar: Communications",
  [ACTIONS.NAV_WORKFLOWS]: "Sidebar: Workflows",
  [ACTIONS.NAV_API_DOCS]: "Sidebar: API Documentation",
  [ACTIONS.NAV_TESTING]: "Sidebar: Testing Utilities",
  [ACTIONS.NAV_PERMISSION_MATRIX]: "Sidebar: Roles & Permissions",
  [ACTIONS.NAV_ACTION_TEMPLATES]: "Sidebar: Action Templates",
  [ACTIONS.NAV_DATA_VIEW]: "Sidebar: Data View",
  [ACTIONS.NAV_COMMISSIONS]: "Sidebar: Commissions",
  [ACTIONS.COMMISSIONS_VIEW]: "Commissions: View statement",
  [ACTIONS.COMMISSIONS_MANAGE]: "Commissions: Manage overrides & recalc",
  [ACTIONS.PAYOUTS_MANAGE]: "Payouts: Create / mark paid / void",
};

// Destructive actions (UI confirms before granting "all" scope on these).
export const DESTRUCTIVE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  ACTIONS.ADMIN_MANAGE,
  ACTIONS.SUPERADMIN_ONLY,
  ACTIONS.UNDERWRITING_APPROVE,
  ACTIONS.UNDERWRITING_DECLINE,
  ACTIONS.DATA_PROCESSING_EDIT,
  ACTIONS.DEPLOYMENT_MANAGE,
]);

// Minimal user shape that both server (db row) and client (auth/me) satisfy.
export interface UserWithRoles {
  roles?: string[] | null;
  role?: string | null;
}

export function getUserRoleCodes(user: UserWithRoles | null | undefined): string[] {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  if (user.role) return [user.role];
  return [];
}

// Merge default grants with runtime overrides. Overrides shape:
//   { [action]: { [roleCode]: scope | null } }
// A null scope in overrides means "explicitly revoked" for that role.
export type GrantOverrides = Partial<Record<string, Partial<Record<string, Scope | null>>>>;

export function getEffectiveGrants(
  action: Action | string,
  overrides?: GrantOverrides,
): ActionGrants {
  const defaults = (DEFAULT_ACTION_GRANTS as Record<string, ActionGrants>)[action] ?? {};
  if (!overrides || !overrides[action]) return defaults;
  const merged: Record<string, Scope> = { ...defaults } as Record<string, Scope>;
  for (const [role, scope] of Object.entries(overrides[action] || {})) {
    if (scope === null || scope === undefined) {
      delete merged[role];
    } else {
      merged[role] = scope;
    }
  }
  return merged as ActionGrants;
}

export function getAllowedRolesForAction(
  action: Action | string,
  overrides?: GrantOverrides,
): string[] {
  const grants = getEffectiveGrants(action, overrides);
  return Object.keys(grants);
}

// Returns the broadest scope this user has for this action, or null if denied.
// super_admin always returns 'all' (cannot be revoked).
export function getActionScope(
  user: UserWithRoles | null | undefined,
  action: Action | string,
  overrides?: GrantOverrides,
): Scope | null {
  const userRoles = getUserRoleCodes(user);
  if (userRoles.length === 0) return null;
  if (userRoles.includes(ROLE_CODES.SUPER_ADMIN)) return "all";
  const grants = getEffectiveGrants(action, overrides);
  let best: Scope | null = null;
  for (const r of userRoles) {
    const s = (grants as Record<string, Scope>)[r];
    if (s) best = maxScope(best, s);
  }
  return best;
}

export function hasPermission(
  user: UserWithRoles | null | undefined,
  action: Action | string,
  overrides?: GrantOverrides,
): boolean {
  return getActionScope(user, action, overrides) !== null;
}

export function hasAnyPermission(
  user: UserWithRoles | null | undefined,
  actions: (Action | string)[],
  overrides?: GrantOverrides,
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
