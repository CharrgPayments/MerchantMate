import React from "react";
import { WIDGET_TYPES, type WidgetType } from "@shared/widget-schema";
import { WidgetProps } from "./widget-types";

// Widget components
import { QuickStatsWidget } from "./QuickStatsWidget";
import { RevenueMetricsWidget } from "./RevenueMetricsWidget";
import { TransactionCountWidget } from "./TransactionCountWidget";
import { RecentTransactionsWidget } from "./RecentTransactionsWidget";
import { MyMerchantProfileWidget } from "./MyMerchantProfileWidget";
import { AssignedMerchantsWidget } from "./AssignedMerchantsWidget";
import { SystemOverviewWidget } from "./SystemOverviewWidget";
import { LocationPerformanceWidget } from "./LocationPerformanceWidget";
import { CommissionTrackingWidget } from "./CommissionTrackingWidget";
import { ProfileSummaryWidget } from "./ProfileSummaryWidget";
import { RecentActivityWidget } from "./RecentActivityWidget";

// Widget registry mapping widget types to their component implementations  
export const WIDGET_REGISTRY: Record<string, React.ComponentType<WidgetProps>> = {
  [WIDGET_TYPES.QUICK_STATS]: QuickStatsWidget,
  [WIDGET_TYPES.RECENT_ACTIVITY]: RecentActivityWidget,
  [WIDGET_TYPES.PROFILE_SUMMARY]: ProfileSummaryWidget,
  // Add missing widget mappings for database compatibility
  "transaction_summary": RevenueMetricsWidget, // Using revenue metrics as transaction summary
  "merchant_analytics": QuickStatsWidget, // Using quick stats for merchant analytics
  "user_management": SystemOverviewWidget, // Using system overview for user management
  
  // Merchant-specific widgets
  [WIDGET_TYPES.REVENUE_OVERVIEW]: RevenueMetricsWidget,
  [WIDGET_TYPES.LOCATION_PERFORMANCE]: LocationPerformanceWidget,
  [WIDGET_TYPES.TRANSACTION_TRENDS]: TransactionCountWidget,
  [WIDGET_TYPES.TOP_LOCATIONS]: LocationPerformanceWidget,
  
  // Agent-specific widgets
  [WIDGET_TYPES.ASSIGNED_MERCHANTS]: AssignedMerchantsWidget,
  [WIDGET_TYPES.MERCHANT_PERFORMANCE]: AssignedMerchantsWidget,
  [WIDGET_TYPES.COMMISSION_TRACKING]: CommissionTrackingWidget,
  [WIDGET_TYPES.AGENT_LEADERBOARD]: RecentActivityWidget, // Placeholder for now
  [WIDGET_TYPES.PIPELINE_OVERVIEW]: RecentActivityWidget, // Placeholder for now
  
  // Admin-specific widgets
  [WIDGET_TYPES.SYSTEM_OVERVIEW]: SystemOverviewWidget,
  [WIDGET_TYPES.USER_MANAGEMENT]: RecentActivityWidget, // Placeholder for now
  [WIDGET_TYPES.COMPLIANCE_MONITOR]: SystemOverviewWidget,
  [WIDGET_TYPES.FINANCIAL_SUMMARY]: RevenueMetricsWidget,
  [WIDGET_TYPES.ALERTS_CENTER]: SystemOverviewWidget,
  [WIDGET_TYPES.PERFORMANCE_METRICS]: QuickStatsWidget,
};

// Widget definitions with metadata
export const WIDGET_DEFINITIONS = {
  [WIDGET_TYPES.QUICK_STATS]: {
    id: WIDGET_TYPES.QUICK_STATS,
    name: "Quick Stats",
    description: "Key performance indicators at a glance",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent", "merchant"],
    defaultSize: "large" as const,
    configurable: [],
  },
  [WIDGET_TYPES.RECENT_ACTIVITY]: {
    id: WIDGET_TYPES.RECENT_ACTIVITY,
    name: "Recent Activity", 
    description: "Latest system activity and updates",
    category: "activity" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent", "merchant"],
    defaultSize: "medium" as const,
    configurable: ["limit", "activityTypes"],
  },
  // Add missing widget definitions for database compatibility
  "transaction_summary": {
    id: "transaction_summary",
    name: "Transaction Summary", 
    description: "Overview of recent transactions",
    category: "financial" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent", "merchant"],
    defaultSize: "large" as const,
    configurable: ["timeframe"],
  },
  "merchant_analytics": {
    id: "merchant_analytics",
    name: "Merchant Analytics", 
    description: "Key merchant performance metrics",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent"],
    defaultSize: "medium" as const,
    configurable: ["showRevenue"],
  },
  "user_management": {
    id: "user_management",
    name: "User Management", 
    description: "Manage system users and permissions",
    category: "system" as const,
    allowedRoles: ["admin", "super_admin"],
    defaultSize: "medium" as const,
    configurable: [],
  },
  [WIDGET_TYPES.PROFILE_SUMMARY]: {
    id: WIDGET_TYPES.PROFILE_SUMMARY,
    name: "Profile Summary",
    description: "User account information and settings", 
    category: "profile" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent", "merchant"],
    defaultSize: "small" as const,
    configurable: ["showDetails"],
  },
  [WIDGET_TYPES.REVENUE_OVERVIEW]: {
    id: WIDGET_TYPES.REVENUE_OVERVIEW,
    name: "Revenue Overview",
    description: "Revenue metrics and trends",
    category: "financial" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "merchant"],
    defaultSize: "medium" as const,
    configurable: ["timeRange", "showComparison"],
  },
  [WIDGET_TYPES.LOCATION_PERFORMANCE]: {
    id: WIDGET_TYPES.LOCATION_PERFORMANCE,
    name: "Location Performance",
    description: "Performance metrics by location",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "merchant"],
    defaultSize: "medium" as const,
    configurable: ["maxLocations", "sortBy", "showTrends"],
  },
  [WIDGET_TYPES.TRANSACTION_TRENDS]: {
    id: WIDGET_TYPES.TRANSACTION_TRENDS,
    name: "Transaction Trends",
    description: "Transaction volume and trends over time",
    category: "financial" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent", "merchant"],
    defaultSize: "large" as const,
    configurable: ["period", "chartType"],
  },
  [WIDGET_TYPES.TOP_LOCATIONS]: {
    id: WIDGET_TYPES.TOP_LOCATIONS,
    name: "Top Locations",
    description: "Best performing locations",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent"],
    defaultSize: "medium" as const,
    configurable: ["maxLocations", "sortBy"],
  },
  [WIDGET_TYPES.ASSIGNED_MERCHANTS]: {
    id: WIDGET_TYPES.ASSIGNED_MERCHANTS,
    name: "My Merchants",
    description: "Merchants assigned to you",
    category: "business" as const,
    allowedRoles: ["agent"],
    defaultSize: "large" as const,
    configurable: ["maxMerchants", "sortBy", "showInactive"],
  },
  [WIDGET_TYPES.MERCHANT_PERFORMANCE]: {
    id: WIDGET_TYPES.MERCHANT_PERFORMANCE,
    name: "Merchant Performance",
    description: "Performance metrics for your merchants",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent"],
    defaultSize: "large" as const,
    configurable: ["maxMerchants", "sortBy"],
  },
  [WIDGET_TYPES.COMMISSION_TRACKING]: {
    id: WIDGET_TYPES.COMMISSION_TRACKING,
    name: "Commission Tracking",
    description: "Your commission earnings and history",
    category: "financial" as const,
    allowedRoles: ["agent"],
    defaultSize: "medium" as const,
    configurable: [],
  },
  [WIDGET_TYPES.AGENT_LEADERBOARD]: {
    id: WIDGET_TYPES.AGENT_LEADERBOARD,
    name: "Agent Leaderboard",
    description: "Top performing agents",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "medium" as const,
    configurable: ["sortBy", "limit"],
  },
  [WIDGET_TYPES.PIPELINE_OVERVIEW]: {
    id: WIDGET_TYPES.PIPELINE_OVERVIEW,
    name: "Sales Pipeline",
    description: "Prospect and application pipeline",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin", "agent"],
    defaultSize: "large" as const,
    configurable: ["stages", "showConversionRates"],
  },
  [WIDGET_TYPES.SYSTEM_OVERVIEW]: {
    id: WIDGET_TYPES.SYSTEM_OVERVIEW,
    name: "System Overview",
    description: "System health and performance metrics",
    category: "system" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "large" as const,
    configurable: ["refreshInterval", "showAlerts", "alertThreshold"],
  },
  [WIDGET_TYPES.USER_MANAGEMENT]: {
    id: WIDGET_TYPES.USER_MANAGEMENT,
    name: "User Management",
    description: "User accounts and permissions overview",
    category: "system" as const,
    allowedRoles: ["admin", "super_admin"],
    defaultSize: "large" as const,
    configurable: ["userTypes", "sortBy"],
  },
  [WIDGET_TYPES.COMPLIANCE_MONITOR]: {
    id: WIDGET_TYPES.COMPLIANCE_MONITOR,
    name: "Compliance Monitor",
    description: "Compliance status and audit information",
    category: "system" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "medium" as const,
    configurable: ["complianceTypes", "alertLevel"],
  },
  [WIDGET_TYPES.FINANCIAL_SUMMARY]: {
    id: WIDGET_TYPES.FINANCIAL_SUMMARY,
    name: "Financial Summary",
    description: "Overall financial performance",
    category: "financial" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "large" as const,
    configurable: ["timeRange", "includeProjections"],
  },
  [WIDGET_TYPES.ALERTS_CENTER]: {
    id: WIDGET_TYPES.ALERTS_CENTER,
    name: "Alerts Center",
    description: "System alerts and notifications",
    category: "system" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "medium" as const,
    configurable: ["alertTypes", "maxAlerts"],
  },
  [WIDGET_TYPES.PERFORMANCE_METRICS]: {
    id: WIDGET_TYPES.PERFORMANCE_METRICS,
    name: "Performance Metrics",
    description: "Key performance indicators",
    category: "business" as const,
    allowedRoles: ["admin", "corporate", "super_admin"],
    defaultSize: "large" as const,
    configurable: ["metrics", "timeRange"],
  },
} as const;

// Helper function to get widget component
export function getWidgetComponent(widgetType: WidgetType): React.ComponentType<WidgetProps> | null {
  return WIDGET_REGISTRY[widgetType] || null;
}

// Helper function to get widget definition
export function getWidgetDefinition(widgetType: WidgetType) {
  return WIDGET_DEFINITIONS[widgetType] || null;
}

// Helper function to render a widget
export function renderWidget(widgetType: WidgetType, props: WidgetProps) {
  const WidgetComponent = getWidgetComponent(widgetType);
  const definition = getWidgetDefinition(widgetType);
  
  if (!WidgetComponent || !definition) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50">
        <p className="text-sm text-red-600">
          Widget "{widgetType}" not found
        </p>
      </div>
    );
  }
  
  return <WidgetComponent {...props} definition={definition} />;
}