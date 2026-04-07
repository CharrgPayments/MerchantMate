import { z } from "zod";

// Define available widget types based on user roles
export const WIDGET_TYPES = {
  // Common widgets available to all roles
  QUICK_STATS: "quick_stats",
  RECENT_ACTIVITY: "recent_activity",
  PROFILE_SUMMARY: "profile_summary",
  
  // Merchant-specific widgets
  REVENUE_OVERVIEW: "revenue_overview",
  LOCATION_PERFORMANCE: "location_performance",
  TRANSACTION_TRENDS: "transaction_trends",
  TOP_LOCATIONS: "top_locations",
  
  // Agent-specific widgets
  ASSIGNED_MERCHANTS: "assigned_merchants",
  MERCHANT_PERFORMANCE: "merchant_performance",
  COMMISSION_TRACKING: "commission_tracking",
  AGENT_LEADERBOARD: "agent_leaderboard",
  PIPELINE_OVERVIEW: "pipeline_overview",
  
  // Admin-specific widgets
  SYSTEM_OVERVIEW: "system_overview",
  USER_MANAGEMENT: "user_management",
  COMPLIANCE_MONITOR: "compliance_monitor",
  FINANCIAL_SUMMARY: "financial_summary",
  ALERTS_CENTER: "alerts_center",
  PERFORMANCE_METRICS: "performance_metrics",
} as const;

export type WidgetType = typeof WIDGET_TYPES[keyof typeof WIDGET_TYPES];

// Widget size options
export const WIDGET_SIZES = {
  SMALL: "small",
  MEDIUM: "medium", 
  LARGE: "large",
  FULL: "full"
} as const;

export type WidgetSize = typeof WIDGET_SIZES[keyof typeof WIDGET_SIZES];

// Role-based widget permissions
export const ROLE_WIDGET_PERMISSIONS = {
  merchant: [
    WIDGET_TYPES.QUICK_STATS,
    WIDGET_TYPES.RECENT_ACTIVITY,
    WIDGET_TYPES.PROFILE_SUMMARY,
    WIDGET_TYPES.REVENUE_OVERVIEW,
    WIDGET_TYPES.LOCATION_PERFORMANCE,
    WIDGET_TYPES.TRANSACTION_TRENDS,
    WIDGET_TYPES.TOP_LOCATIONS,
  ],
  agent: [
    WIDGET_TYPES.QUICK_STATS,
    WIDGET_TYPES.RECENT_ACTIVITY,
    WIDGET_TYPES.PROFILE_SUMMARY,
    WIDGET_TYPES.ASSIGNED_MERCHANTS,
    WIDGET_TYPES.MERCHANT_PERFORMANCE,
    WIDGET_TYPES.COMMISSION_TRACKING,
    WIDGET_TYPES.AGENT_LEADERBOARD,
    WIDGET_TYPES.PIPELINE_OVERVIEW,
  ],
  admin: [
    WIDGET_TYPES.QUICK_STATS,
    WIDGET_TYPES.RECENT_ACTIVITY,
    WIDGET_TYPES.PROFILE_SUMMARY,
    WIDGET_TYPES.SYSTEM_OVERVIEW,
    WIDGET_TYPES.USER_MANAGEMENT,
    WIDGET_TYPES.COMPLIANCE_MONITOR,
    WIDGET_TYPES.FINANCIAL_SUMMARY,
    WIDGET_TYPES.REVENUE_OVERVIEW,
    WIDGET_TYPES.LOCATION_PERFORMANCE,
    WIDGET_TYPES.ALERTS_CENTER,
    WIDGET_TYPES.PERFORMANCE_METRICS,
    WIDGET_TYPES.PIPELINE_OVERVIEW,
    WIDGET_TYPES.AGENT_LEADERBOARD,
  ],
  corporate: [
    WIDGET_TYPES.QUICK_STATS,
    WIDGET_TYPES.RECENT_ACTIVITY,
    WIDGET_TYPES.PROFILE_SUMMARY,
    WIDGET_TYPES.FINANCIAL_SUMMARY,
    WIDGET_TYPES.REVENUE_OVERVIEW,
    WIDGET_TYPES.SYSTEM_OVERVIEW,
  ],
  super_admin: Object.values(WIDGET_TYPES),
} as const;

// Widget configuration schemas
export const widgetConfigSchemas = {
  [WIDGET_TYPES.REVENUE_OVERVIEW]: z.object({
    timeRange: z.enum(["24h", "7d", "30d", "90d"]).default("30d"),
    showComparison: z.boolean().default(true),
    includeProjections: z.boolean().default(false),
  }),
  
  [WIDGET_TYPES.LOCATION_PERFORMANCE]: z.object({
    maxLocations: z.number().min(1).max(20).default(5),
    sortBy: z.enum(["revenue", "transactions", "growth"]).default("revenue"),
    showTrends: z.boolean().default(true),
  }),
  
  [WIDGET_TYPES.TRANSACTION_TRENDS]: z.object({
    period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
    chartType: z.enum(["line", "bar", "area"]).default("line"),
    showVolume: z.boolean().default(true),
  }),
  
  [WIDGET_TYPES.ASSIGNED_MERCHANTS]: z.object({
    maxMerchants: z.number().min(1).max(50).default(10),
    sortBy: z.enum(["name", "revenue", "status", "created"]).default("revenue"),
    showInactive: z.boolean().default(false),
  }),
  
  [WIDGET_TYPES.SYSTEM_OVERVIEW]: z.object({
    refreshInterval: z.number().min(30).max(300).default(60), // seconds
    showAlerts: z.boolean().default(true),
    alertThreshold: z.number().min(1).max(100).default(10),
  }),
} as const;

// Default widget configurations for new users by role
export const DEFAULT_DASHBOARD_LAYOUTS = {
  merchant: [
    {
      widgetId: WIDGET_TYPES.QUICK_STATS,
      position: 0,
      size: WIDGET_SIZES.LARGE,
      configuration: {},
    },
    {
      widgetId: WIDGET_TYPES.REVENUE_OVERVIEW,
      position: 1,
      size: WIDGET_SIZES.MEDIUM,
      configuration: { timeRange: "30d", showComparison: true },
    },
    {
      widgetId: WIDGET_TYPES.LOCATION_PERFORMANCE,
      position: 2,
      size: WIDGET_SIZES.MEDIUM,
      configuration: { maxLocations: 5, sortBy: "revenue" },
    },
    {
      widgetId: WIDGET_TYPES.RECENT_ACTIVITY,
      position: 3,
      size: WIDGET_SIZES.SMALL,
      configuration: {},
    },
  ],
  
  agent: [
    {
      widgetId: WIDGET_TYPES.QUICK_STATS,
      position: 0,
      size: WIDGET_SIZES.LARGE,
      configuration: {},
    },
    {
      widgetId: WIDGET_TYPES.ASSIGNED_MERCHANTS,
      position: 1,
      size: WIDGET_SIZES.MEDIUM,
      configuration: { maxMerchants: 8, sortBy: "revenue" },
    },
    {
      widgetId: WIDGET_TYPES.COMMISSION_TRACKING,
      position: 2,
      size: WIDGET_SIZES.MEDIUM,
      configuration: {},
    },
    {
      widgetId: WIDGET_TYPES.RECENT_ACTIVITY,
      position: 3,
      size: WIDGET_SIZES.SMALL,
      configuration: {},
    },
  ],
  
  admin: [
    {
      widgetId: WIDGET_TYPES.SYSTEM_OVERVIEW,
      position: 0,
      size: WIDGET_SIZES.LARGE,
      configuration: { refreshInterval: 60, showAlerts: true },
    },
    {
      widgetId: WIDGET_TYPES.FINANCIAL_SUMMARY,
      position: 1,
      size: WIDGET_SIZES.MEDIUM,
      configuration: {},
    },
    {
      widgetId: WIDGET_TYPES.USER_MANAGEMENT,
      position: 2,
      size: WIDGET_SIZES.MEDIUM,
      configuration: {},
    },
    {
      widgetId: WIDGET_TYPES.COMPLIANCE_MONITOR,
      position: 3,
      size: WIDGET_SIZES.SMALL,
      configuration: {},
    },
  ],
} as const;

// Utility functions
export function getAvailableWidgets(role: string): WidgetType[] {
  const widgets = ROLE_WIDGET_PERMISSIONS[role as keyof typeof ROLE_WIDGET_PERMISSIONS] || [];
  return [...widgets]; // Convert readonly array to mutable array
}

export function getAvailableWidgetsForUser(roles: string[]): WidgetType[] {
  const allWidgets = new Set<WidgetType>();
  for (const role of roles) {
    const roleWidgets = ROLE_WIDGET_PERMISSIONS[role as keyof typeof ROLE_WIDGET_PERMISSIONS] || [];
    roleWidgets.forEach(widget => allWidgets.add(widget));
  }
  return Array.from(allWidgets);
}

export function canUserAccessWidget(roles: string[] | string, widgetType: WidgetType): boolean {
  // Support both single role (string) and multiple roles (array) for backward compatibility
  const userRoles = Array.isArray(roles) ? roles : [roles];
  for (const role of userRoles) {
    const availableWidgets = getAvailableWidgets(role);
    if (availableWidgets.includes(widgetType)) {
      return true;
    }
  }
  return false;
}

export function getDefaultLayout(roles: string[] | string) {
  // Support both single role (string) and multiple roles (array)
  const userRoles = Array.isArray(roles) ? roles : [roles];
  
  // Use the highest privilege role for default layout
  const roleHierarchy = ['super_admin', 'admin', 'corporate', 'agent', 'merchant'];
  
  for (const hierarchyRole of roleHierarchy) {
    if (userRoles.includes(hierarchyRole)) {
      return DEFAULT_DASHBOARD_LAYOUTS[hierarchyRole as keyof typeof DEFAULT_DASHBOARD_LAYOUTS] || [];
    }
  }
  
  // Fallback to merchant layout if no role matches
  return DEFAULT_DASHBOARD_LAYOUTS.merchant || [];
}

export function validateWidgetConfig(widgetType: WidgetType, config: any) {
  const schema = widgetConfigSchemas[widgetType as keyof typeof widgetConfigSchemas];
  if (!schema) return { success: true, data: config };
  
  const result = schema.safeParse(config);
  return result;
}