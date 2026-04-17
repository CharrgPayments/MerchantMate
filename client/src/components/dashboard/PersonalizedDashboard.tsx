import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Settings, Eye, EyeOff, GripVertical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ACTIONS, getUserRoleCodes, ROLE_CODES, type RoleCode } from "@shared/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { DashboardWidget } from "./DashboardWidget";
import { toast } from "@/hooks/use-toast";

interface WidgetPreference {
  id: number;
  userId: string;
  widgetId: string;
  size: string;
  position: number;
  isVisible: boolean;
  configuration: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export function PersonalizedDashboard() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const userRoles = getUserRoleCodes(user);
  const primaryRole = userRoles[0] ?? "";
  const hasRole = (r: RoleCode) => userRoles.includes(r);

  const { data: widgets = [], isLoading } = useQuery({
    queryKey: ["/api/dashboard/widgets"],
    enabled: !!user
  });

  const initializeDashboard = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/dashboard/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Failed to initialize dashboard");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
      toast({ title: "Dashboard initialized with default widgets" });
    }
  });

  const updateWidget = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<WidgetPreference> }) => {
      const response = await fetch(`/api/dashboard/widgets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error("Failed to update widget");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
    }
  });

  const toggleWidgetVisibility = (widget: WidgetPreference) => {
    updateWidget.mutate({
      id: widget.id,
      updates: { isVisible: !widget.isVisible }
    });
  };

  const getAvailableWidgets = () => {
    if (!user) return [];

    const baseWidgets = ["quick_stats", "recent_activity"];
    
    switch (primaryRole) {
      case ROLE_CODES.SUPER_ADMIN:
      case ROLE_CODES.ADMIN:
        return [
          ...baseWidgets,
          "system_overview",
          "user_management", 
          "financial_summary",
          "revenue_overview",
          "performance_metrics"
        ];
      case ROLE_CODES.CORPORATE:
        return [
          ...baseWidgets,
          "revenue_overview",
          "performance_metrics",
          "location_performance",
          "transaction_trends"
        ];
      case ROLE_CODES.AGENT:
        return [
          ...baseWidgets,
          "assigned_merchants",
          "pipeline_overview",
          "merchant_stats"
        ];
      case ROLE_CODES.MERCHANT:
        return [
          ...baseWidgets,
          "revenue_overview",
          "location_performance",
          "transaction_trends",
          "top_locations"
        ];
      default:
        return baseWidgets;
    }
  };

  const visibleWidgets = widgets
    .filter((w: WidgetPreference) => w.isVisible)
    .sort((a: WidgetPreference, b: WidgetPreference) => a.position - b.position);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-32 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <h3 className="text-lg font-semibold mb-2">Welcome to your dashboard!</h3>
          <p className="text-gray-600 mb-6">
            Get started by initializing your personalized dashboard with widgets tailored to your role.
          </p>
          <Button 
            onClick={() => initializeDashboard.mutate()}
            disabled={initializeDashboard.isPending}
          >
            {initializeDashboard.isPending ? "Setting up..." : "Initialize Dashboard"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dashboard Controls */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-gray-600">
            Welcome back, {user?.firstName || user?.username}
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            <Settings className="h-4 w-4 mr-2" />
            {editMode ? "Done" : "Customize"}
          </Button>
          
          {can(ACTIONS.ADMIN_MANAGE) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => initializeDashboard.mutate()}
              disabled={initializeDashboard.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
          )}
        </div>
      </div>

      {/* Edit Mode Controls */}
      {editMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Widget Management</CardTitle>
            <CardDescription>
              Show/hide widgets and customize your dashboard layout
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {widgets.map((widget: WidgetPreference) => (
                <div
                  key={widget.id}
                  className="flex items-center justify-between p-2 border rounded"
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium">
                      {widget.widgetId.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleWidgetVisibility(widget)}
                  >
                    {widget.isVisible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleWidgets.map((widget: WidgetPreference) => (
          <div
            key={widget.id}
            className={`
              ${widget.size === "small" ? "col-span-1" : ""}
              ${widget.size === "medium" ? "col-span-1 md:col-span-1" : ""}
              ${widget.size === "large" ? "col-span-1 md:col-span-2" : ""}
              ${widget.size === "full" ? "col-span-1 md:col-span-2 lg:col-span-3" : ""}
            `}
          >
            <DashboardWidget
              type={widget.widgetId}
              size={widget.size}
              configuration={widget.configuration}
              editMode={editMode}
            />
          </div>
        ))}
      </div>

      {/* Role-based Tips */}
      {user && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Badge variant="secondary">{primaryRole.replace(/_/g, " ").toUpperCase()}</Badge>
              <div className="text-sm text-blue-700">
                {hasRole(ROLE_CODES.ADMIN) && (
                  <p>As an admin, you have access to system overview, user management, and financial summary widgets.</p>
                )}
                {hasRole(ROLE_CODES.AGENT) && (
                  <p>Your dashboard shows assigned merchants and pipeline overview to help manage your portfolio.</p>
                )}
                {hasRole(ROLE_CODES.MERCHANT) && (
                  <p>Track your revenue, location performance, and transaction trends from your personalized dashboard.</p>
                )}
                {hasRole(ROLE_CODES.CORPORATE) && (
                  <p>Monitor overall performance metrics and revenue overview across your organization.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}