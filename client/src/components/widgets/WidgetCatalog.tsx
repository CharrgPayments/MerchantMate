import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Filter, Grid, List } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { WIDGET_DEFINITIONS } from "./WidgetRegistry";
import { getAvailableWidgetsForUser, canUserAccessWidget } from "@shared/widget-schema";
import type { WidgetType, WidgetSize } from "@shared/widget-schema";
import type { InsertUserDashboardPreference } from "@shared/schema";

interface WidgetCatalogProps {
  onWidgetAdd?: (widgetId: WidgetType) => void;
}

export function WidgetCatalog({ onWidgetAdd }: WidgetCatalogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<WidgetSize>("medium");

  // Get available widgets for user's roles
  const availableWidgets = user ? getAvailableWidgetsForUser(user.roles) : [];
  
  // Get user's current widgets to show which are already added
  const { data: userWidgets = [] } = useQuery({
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

  // Add widget mutation
  const addWidget = useMutation({
    mutationFn: (data: InsertUserDashboardPreference) => 
      apiRequest("POST", "/api/dashboard/widgets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/widgets"] });
      setShowAddDialog(false);
      setSelectedWidget("");
      setSelectedSize("medium");
      toast({
        title: "Widget added",
        description: "New widget has been added to your dashboard.",
      });
      if (onWidgetAdd && selectedWidget) {
        onWidgetAdd(selectedWidget as WidgetType);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error adding widget",
        description: error.message || "Failed to add widget to dashboard.",
        variant: "destructive",
      });
    },
  });

  // Filter widgets based on search and category
  const filteredWidgets = availableWidgets
    .map(widgetId => ({ widgetId, ...WIDGET_DEFINITIONS[widgetId] }))
    .filter(widget => {
      if (!widget) return false;
      
      const matchesSearch = !searchQuery || 
        widget.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        widget.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = selectedCategory === "all" || widget.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });

  // Get unique categories
  const categories = Array.from(
    new Set(
      availableWidgets
        .map(widgetId => WIDGET_DEFINITIONS[widgetId]?.category)
        .filter(Boolean)
    )
  );

  const handleAddWidget = () => {
    if (!selectedWidget || !user) return;

    const maxPosition = userWidgets.length > 0 ? Math.max(...userWidgets.map(w => w.position)) : -1;
    
    addWidget.mutate({
      widgetId: selectedWidget,
      position: maxPosition + 1,
      size: selectedSize,
      isVisible: true,
      configuration: {},
    });
  };

  const isWidgetAdded = (widgetId: string) => {
    return userWidgets.some(widget => widget.widget_id === widgetId);
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'financial': return 'bg-green-100 text-green-800';
      case 'business': return 'bg-blue-100 text-blue-800';
      case 'activity': return 'bg-purple-100 text-purple-800';
      case 'system': return 'bg-red-100 text-red-800';
      case 'profile': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Widget Catalog</h2>
          <p className="text-gray-600">Browse and add widgets to customize your dashboard</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search widgets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(category => (
              <SelectItem key={category} value={category}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Widget Grid/List */}
      <div className={`grid gap-4 ${
        viewMode === "grid" 
          ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" 
          : "grid-cols-1"
      }`}>
        {filteredWidgets.map((widget) => (
          <Card key={widget.widgetId} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{widget.name}</CardTitle>
                  <Badge className={getCategoryColor(widget.category)}>
                    {widget.category}
                  </Badge>
                </div>
                <Badge variant={isWidgetAdded(widget.widgetId) ? "default" : "secondary"}>
                  {isWidgetAdded(widget.widgetId) ? "Added" : "Available"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">{widget.description}</p>
              
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Default: {widget.defaultSize}
                </span>
                
                {!isWidgetAdded(widget.widgetId) ? (
                  <Dialog open={showAddDialog && selectedWidget === widget.widgetId} 
                          onOpenChange={(open) => {
                            setShowAddDialog(open);
                            if (open) setSelectedWidget(widget.widgetId);
                            else setSelectedWidget("");
                          }}>
                    <DialogTrigger asChild>
                      <Button size="sm" onClick={() => setSelectedWidget(widget.widgetId)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add {widget.name}</DialogTitle>
                        <DialogDescription>
                          Choose the size for this widget on your dashboard.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium">Widget Size</label>
                          <Select value={selectedSize} onValueChange={(value: WidgetSize) => setSelectedSize(value)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="small">Small (1x1)</SelectItem>
                              <SelectItem value="medium">Medium (2x1)</SelectItem>
                              <SelectItem value="large">Large (3x2)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleAddWidget} disabled={addWidget.isPending}>
                            {addWidget.isPending ? "Adding..." : "Add Widget"}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    Already Added
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredWidgets.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-2">No widgets found</div>
          <p className="text-sm text-gray-600">
            Try adjusting your search or category filter.
          </p>
        </div>
      )}
    </div>
  );
}