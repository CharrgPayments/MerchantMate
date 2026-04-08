import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { 
  DollarSign, 
  TrendingUp, 
  MapPin, 
  Users, 
  Activity, 
  Settings,
  Building2,
  CreditCard,
  BarChart3,
  Shield,
  AlertTriangle,
  Monitor,
  Target,
  Zap,
  UserCheck,
  X
} from "lucide-react";
import { WIDGET_TYPES, type WidgetType, type WidgetSize } from "@shared/widget-schema";
import { type UserDashboardPreference } from "@shared/schema";
import { ApiDataWidget } from "@/components/widgets/ApiDataWidget";

interface DashboardWidgetProps {
  widget: UserDashboardPreference;
  onConfigure?: (widgetId: string) => void;
  onRemove?: (widgetId: string) => void;
  editMode?: boolean;
}

export function DashboardWidget({ widget, onConfigure, onRemove, editMode }: DashboardWidgetProps) {
  const getSizeClasses = (size: WidgetSize) => {
    switch (size) {
      case "small": return "col-span-1 row-span-1";
      case "medium": return "col-span-2 row-span-1";
      case "large": return "col-span-3 row-span-2";
      case "full": return "col-span-4 row-span-1";
      default: return "col-span-2 row-span-1";
    }
  };

  const getWidgetIcon = (widgetType: WidgetType) => {
    switch (widgetType) {
      case WIDGET_TYPES.QUICK_STATS: return DollarSign;
      case WIDGET_TYPES.REVENUE_OVERVIEW: return TrendingUp;
      case WIDGET_TYPES.LOCATION_PERFORMANCE: return MapPin;
      case WIDGET_TYPES.TRANSACTION_TRENDS: return BarChart3;
      case WIDGET_TYPES.ASSIGNED_MERCHANTS: return Building2;
      case WIDGET_TYPES.COMMISSION_TRACKING: return CreditCard;
      case WIDGET_TYPES.SYSTEM_OVERVIEW: return Shield;
      case WIDGET_TYPES.USER_MANAGEMENT: return Users;
      case WIDGET_TYPES.RECENT_ACTIVITY: return Activity;
      default: return Activity;
    }
  };

  const getWidgetTitle = (widgetType: WidgetType) => {
    switch (widgetType) {
      case WIDGET_TYPES.QUICK_STATS: return "Quick Stats";
      case WIDGET_TYPES.REVENUE_OVERVIEW: return "Revenue Overview";
      case WIDGET_TYPES.LOCATION_PERFORMANCE: return "Location Performance";
      case WIDGET_TYPES.TRANSACTION_TRENDS: return "Transaction Trends";
      case WIDGET_TYPES.TOP_LOCATIONS: return "Top Locations";
      case WIDGET_TYPES.ASSIGNED_MERCHANTS: return "Assigned Merchants";
      case WIDGET_TYPES.MERCHANT_PERFORMANCE: return "Merchant Performance";
      case WIDGET_TYPES.COMMISSION_TRACKING: return "Commission Tracking";
      case WIDGET_TYPES.AGENT_LEADERBOARD: return "Agent Leaderboard";
      case WIDGET_TYPES.SYSTEM_OVERVIEW: return "System Overview";
      case WIDGET_TYPES.USER_MANAGEMENT: return "User Management";
      case WIDGET_TYPES.COMPLIANCE_MONITOR: return "Compliance Monitor";
      case WIDGET_TYPES.FINANCIAL_SUMMARY: return "Financial Summary";
      case WIDGET_TYPES.RECENT_ACTIVITY: return "Recent Activity";
      case WIDGET_TYPES.PROFILE_SUMMARY: return "Profile Summary";
      default: return "Widget";
    }
  };

  if (!widget.isVisible) return null;

  // API Data Widget manages its own Card shell including title, refresh button, and config dialog
  if (widget.widgetId === WIDGET_TYPES.API_DATA_WIDGET) {
    return (
      <div className={`${getSizeClasses(widget.size)} relative`}>
        <ApiDataWidget
          widgetDbId={widget.id}
          config={(widget.configuration as any) || {}}
          editMode={editMode}
        />
      </div>
    );
  }

  const IconComponent = getWidgetIcon(widget.widgetId as WidgetType);

  return (
    <Card className={`${getSizeClasses(widget.size)} relative group`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <IconComponent className="h-4 w-4" />
          {getWidgetTitle(widget.widgetId as WidgetType)}
        </CardTitle>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          {onConfigure && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onConfigure(widget.widgetId)}
            >
              <Settings className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <WidgetContent widget={widget} />
      </CardContent>
    </Card>
  );
}

function WidgetContent({ widget }: { widget: UserDashboardPreference }) {
  const widgetType = widget.widgetId as WidgetType;
  
  switch (widgetType) {
    case WIDGET_TYPES.QUICK_STATS:
      return <QuickStatsWidget />;
    case WIDGET_TYPES.REVENUE_OVERVIEW:
      return <RevenueOverviewWidget config={widget.configuration} />;
    case WIDGET_TYPES.LOCATION_PERFORMANCE:
      return <LocationPerformanceWidget config={widget.configuration} />;
    case WIDGET_TYPES.RECENT_ACTIVITY:
      return <RecentActivityWidget />;
    case WIDGET_TYPES.ASSIGNED_MERCHANTS:
      return <AssignedMerchantsWidget config={widget.configuration} />;
    case WIDGET_TYPES.SYSTEM_OVERVIEW:
      return <SystemOverviewWidget config={widget.configuration} />;
    default:
      return <div className="text-sm text-muted-foreground">Widget content loading...</div>;
  }
}

function QuickStatsWidget() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading metrics...</div>;
  }

  if (!metrics) {
    return <div className="text-sm text-muted-foreground">No metrics available</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-2xl font-bold">${metrics.totalRevenue}</div>
        <p className="text-xs text-muted-foreground">Total Revenue</p>
      </div>
      <div>
        <div className="text-2xl font-bold">{metrics.transactionsToday}</div>
        <p className="text-xs text-muted-foreground">Today's Transactions</p>
      </div>
      <div>
        <div className="text-2xl font-bold">{metrics.activeMerchants}</div>
        <p className="text-xs text-muted-foreground">Active Merchants</p>
      </div>
      <div>
        <div className="text-2xl font-bold">{metrics.activeAgents}</div>
        <p className="text-xs text-muted-foreground">Active Agents</p>
      </div>
    </div>
  );
}

function RevenueOverviewWidget({ config }: { config: any }) {
  const timeRange = config?.timeRange || "30d";
  
  const { data: revenue, isLoading } = useQuery({
    queryKey: ["/api/dashboard/revenue", timeRange],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading revenue data...</div>;
  }

  if (!revenue) {
    return <div className="text-sm text-muted-foreground">No revenue data available</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">${revenue.current}</div>
          <p className="text-xs text-muted-foreground">Current Period</p>
        </div>
        {config?.showComparison && revenue.change && (
          <Badge variant={revenue.change > 0 ? "default" : "destructive"}>
            {revenue.change > 0 ? "+" : ""}{revenue.change}%
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="font-medium">${revenue.daily}</div>
          <div className="text-muted-foreground">Daily Avg</div>
        </div>
        <div>
          <div className="font-medium">${revenue.weekly}</div>
          <div className="text-muted-foreground">Weekly Avg</div>
        </div>
        <div>
          <div className="font-medium">${revenue.monthly}</div>
          <div className="text-muted-foreground">Monthly Avg</div>
        </div>
      </div>
    </div>
  );
}

function LocationPerformanceWidget({ config }: { config: any }) {
  const maxLocations = config?.maxLocations || 5;
  const sortBy = config?.sortBy || "revenue";
  
  const { data: locations, isLoading } = useQuery({
    queryKey: ["/api/dashboard/top-locations", { limit: maxLocations, sortBy }],
    refetchInterval: 120000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading location data...</div>;
  }

  if (!locations || locations.length === 0) {
    return <div className="text-sm text-muted-foreground">No location data available</div>;
  }

  return (
    <div className="space-y-3">
      {locations.slice(0, maxLocations).map((location: any, index: number) => (
        <div key={location.id} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">#{index + 1}</div>
            <div>
              <div className="text-sm font-medium">{location.name}</div>
              <div className="text-xs text-muted-foreground">{location.city}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium">${location.revenue}</div>
            {config?.showTrends && (
              <div className="text-xs text-muted-foreground">
                {location.trend > 0 ? "+" : ""}{location.trend}%
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentActivityWidget() {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["/api/dashboard/recent-activity"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading activity...</div>;
  }

  if (!activities || activities.length === 0) {
    return <div className="text-sm text-muted-foreground">No recent activity</div>;
  }

  return (
    <div className="space-y-3">
      {activities.slice(0, 5).map((activity: any, index: number) => (
        <div key={index} className="flex items-center gap-3">
          <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">{activity.description}</div>
            <div className="text-xs text-muted-foreground">{activity.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssignedMerchantsWidget({ config }: { config: any }) {
  const maxMerchants = config?.maxMerchants || 10;
  
  const { data: merchants, isLoading } = useQuery({
    queryKey: ["/api/dashboard/assigned-merchants", { limit: maxMerchants }],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading merchants...</div>;
  }

  if (!merchants || merchants.length === 0) {
    return <div className="text-sm text-muted-foreground">No assigned merchants</div>;
  }

  return (
    <div className="space-y-3">
      {merchants.slice(0, maxMerchants).map((merchant: any) => (
        <div key={merchant.id} className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{merchant.businessName}</div>
            <div className="text-xs text-muted-foreground">{merchant.businessType}</div>
          </div>
          <div className="text-right">
            <Badge variant={merchant.status === "active" ? "default" : "secondary"}>
              {merchant.status}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function SystemOverviewWidget({ config }: { config: any }) {
  const { data: systemData, isLoading } = useQuery({
    queryKey: ["/api/dashboard/system-overview"],
    refetchInterval: (config?.refreshInterval || 60) * 1000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading system data...</div>;
  }

  if (!systemData) {
    return <div className="text-sm text-muted-foreground">System data unavailable</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-lg font-bold">{systemData.uptime}</div>
          <p className="text-xs text-muted-foreground">System Uptime</p>
        </div>
        <div>
          <div className="text-lg font-bold">{systemData.activeUsers}</div>
          <p className="text-xs text-muted-foreground">Active Users</p>
        </div>
      </div>
      
      {config?.showAlerts && systemData.alerts && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" />
            System Alerts
          </div>
          {systemData.alerts.slice(0, 3).map((alert: any, index: number) => (
            <div key={index} className="flex items-center justify-between text-xs">
              <span>{alert.message}</span>
              <Badge variant={alert.severity === "high" ? "destructive" : "secondary"}>
                {alert.severity}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}