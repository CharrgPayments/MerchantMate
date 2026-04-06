import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Settings, Layout, Palette, Grid } from "lucide-react";
import { BaseWidget } from "@/components/widgets/BaseWidget";
import { WidgetCatalog } from "@/components/widgets/WidgetCatalog";
import { WIDGET_REGISTRY, WIDGET_DEFINITIONS } from "@/components/widgets/WidgetRegistry";
import { QuickStatsWidget } from "@/components/widgets/QuickStatsWidget";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  getAvailableWidgets, 
  getDefaultLayout,
  type WidgetType, 
  type WidgetSize 
} from "@shared/widget-schema";
import type { UserDashboardPreference, InsertUserDashboardPreference } from "@shared/schema";

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [showCustomize, setShowCustomize] = useState(false);
  const [currentTab, setCurrentTab] = useState("dashboard");

  // Fetch user's dashboard widgets
  const { data: widgets = [], isLoading, refetch, error } = useQuery<UserDashboardPreference[]>({
    queryKey: ["/api/dashboard/widgets"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/widgets", {
        credentials: "include",
        headers: {
          "Accept": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch widgets: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!user,
    staleTime: 0, // Always fetch fresh data
    cacheTime: 0, // Don't cache the data
  });

  // Remove debug logging since system is now working
  // console.log("Dashboard Query State:", { user: user?.id, widgets, isLoading });

  // Add new widget mutation
  const addWidget = useMutation({
    mutationFn: (data: InsertUserDashboardPreference) => 
      apiRequest("POST", "/api/dashboard/widgets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
      toast({
        title: "Widget added",
        description: "New widget has been added to your dashboard.",
      });
    },
  });

  // Update widget mutation
  const updateWidget = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<UserDashboardPreference> }) =>
      apiRequest("PATCH", `/api/dashboard/widgets/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
      toast({
        title: "Widget updated",
        description: "Widget settings have been saved.",
      });
    },
  });

  // Remove widget mutation
  const removeWidget = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/dashboard/widgets/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
      toast({
        title: "Widget removed",
        description: "Widget has been removed from your dashboard.",
      });
    },
  });

  const handleWidgetConfigChange = (widgetId: number, config: Record<string, any>) => {
    updateWidget.mutate({
      id: widgetId,
      updates: { configuration: config }
    });
  };

  const handleWidgetSizeChange = (widgetId: number, size: WidgetSize) => {
    updateWidget.mutate({
      id: widgetId,
      updates: { size }
    });
  };

  const handleWidgetVisibilityChange = (widgetId: number, visible: boolean) => {
    updateWidget.mutate({
      id: widgetId,
      updates: { is_visible: visible }
    });
  };

  const handleWidgetAdd = (widgetType: WidgetType) => {
    // Widget catalog will handle the addition
    setCurrentTab("dashboard");
  };

  const handleRemoveWidget = (widgetId: number) => {
    removeWidget.mutate(widgetId);
  };

  // Get widget size class for CSS Grid
  const getWidgetSizeClass = (size: WidgetSize) => {
    switch (size) {
      case 'small': return 'col-span-1 row-span-1';
      case 'medium': return 'col-span-2 row-span-1'; 
      case 'large': return 'col-span-3 row-span-2';
      default: return 'col-span-2 row-span-1';
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Please log in to view your dashboard</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600">Welcome back, {user.firstName || user.username}</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            size="sm"
          >
            <Layout className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowCustomize(true)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Customize
          </Button>
        </div>
      </div>

      <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="dashboard" className="flex items-center space-x-2">
            <Grid className="h-4 w-4" />
            <span>My Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="catalog" className="flex items-center space-x-2">
            <Palette className="h-4 w-4" />
            <span>Widget Catalog</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="space-y-0 pb-3">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                      <div className="h-4 bg-gray-200 rounded w-full"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : widgets.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <Layout className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium mb-2">No widgets yet</h3>
              <p className="text-gray-600 mb-4">
                Add widgets from the catalog to customize your dashboard
              </p>
              <Button onClick={() => setCurrentTab("catalog")}>
                <Plus className="h-4 w-4 mr-2" />
                Browse Widgets
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 auto-rows-min" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {widgets
                .filter(widget => widget.is_visible)
                .sort((a, b) => a.position - b.position)
                .map((widget) => {
                  // Fallback mappings for widgets not in registry
                  const fallbackDefinition = {
                    id: widget.widget_id,
                    name: widget.widget_id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    description: `Widget: ${widget.widget_id}`,
                    category: "business" as const,
                    allowedRoles: ["admin", "super_admin"],
                    defaultSize: "medium" as const,
                    configurable: [],
                  };
                  
                  const definition = WIDGET_DEFINITIONS[widget.widget_id] || fallbackDefinition;
                  const WidgetComponent = WIDGET_REGISTRY[widget.widget_id] || QuickStatsWidget;
                  
                  if (!definition || !WidgetComponent) {
                    console.warn(`Widget not found: ${widget.widget_id}`);
                    return null;
                  }

                  return (
                    <div key={widget.id} className={getWidgetSizeClass(widget.size)}>
                      <WidgetComponent
                        definition={definition}
                        preference={widget}
                        onConfigChange={(config) => handleWidgetConfigChange(widget.id, config)}
                        onSizeChange={(size) => handleWidgetSizeChange(widget.id, size)}
                        onVisibilityChange={(visible) => handleWidgetVisibilityChange(widget.id, visible)}
                        onRemove={() => handleRemoveWidget(widget.id)}
                      />
                    </div>
                  );
                })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="catalog" className="mt-6">
          <WidgetCatalog onWidgetAdd={handleWidgetAdd} />
        </TabsContent>
      </Tabs>

      {/* Customize Dialog */}
      <Dialog open={showCustomize} onOpenChange={setShowCustomize}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customize Dashboard</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <WidgetCatalog onWidgetAdd={(widgetType) => {
              handleWidgetAdd(widgetType);
              setShowCustomize(false);
            }} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}