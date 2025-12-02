import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Search, Save, RefreshCw, History, ChevronDown, ChevronRight, Check, X, Eye, Settings, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Resource {
  resourceKey: string;
  resourceType: string;
  displayName: string;
  category: string;
}

interface RoleInfo {
  roleKey: string;
  displayName: string;
  hierarchyRank: number;
  permissionCount: number;
}

interface PolicyData {
  policies: Record<string, Record<string, string[]>>;
  resources: Resource[];
  roles: string[];
}

const ACTIONS = ['view', 'manage', 'execute'];
const ACTION_ICONS: Record<string, any> = {
  view: Eye,
  manage: Settings,
  execute: Zap,
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  page: 'Pages',
  widget: 'Widgets',
  api: 'API Endpoints',
  workflow: 'Workflows',
  feature: 'Features',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  underwriter: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  corporate: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  agent: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  merchant: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export default function PermissionManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string>('super_admin');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResourceType, setSelectedResourceType] = useState<string>('all');
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data: policyData, isLoading: loadingPolicies } = useQuery<PolicyData>({
    queryKey: ['/api/rbac/policies'],
  });

  const { data: rolesData, isLoading: loadingRoles } = useQuery<{ success: boolean; roles: RoleInfo[] }>({
    queryKey: ['/api/rbac/roles'],
  });

  const { data: auditData, isLoading: loadingAudit } = useQuery<{ success: boolean; logs: any[] }>({
    queryKey: ['/api/rbac/audit-log'],
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleKey, grants }: { roleKey: string; grants: any[] }) => {
      return apiRequest(`/api/rbac/roles/${roleKey}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ grants }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/policies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/roles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/audit-log'] });
      setPendingChanges(new Map());
      toast({
        title: "Permissions Updated",
        description: "The role permissions have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
        variant: "destructive",
      });
    },
  });

  const hasPermission = (roleKey: string, resourceKey: string, action: string): boolean => {
    if (!policyData?.policies) return false;
    const changeKey = `${roleKey}:${resourceKey}:${action}`;
    if (pendingChanges.has(changeKey)) {
      return pendingChanges.get(changeKey)!;
    }
    return policyData.policies[roleKey]?.[resourceKey]?.includes(action) ?? false;
  };

  const togglePermission = (resourceKey: string, action: string) => {
    const changeKey = `${selectedRole}:${resourceKey}:${action}`;
    const currentValue = hasPermission(selectedRole, resourceKey, action);
    setPendingChanges(prev => {
      const next = new Map(prev);
      if (currentValue === !prev.get(changeKey) && prev.has(changeKey)) {
        next.delete(changeKey);
      } else {
        next.set(changeKey, !currentValue);
      }
      return next;
    });
  };

  const handleSaveChanges = () => {
    if (pendingChanges.size === 0) return;

    const grants = Array.from(pendingChanges.entries()).map(([key, allow]) => {
      const [_role, resourceKey, action] = key.split(':');
      return { resourceKey, action, allow };
    });

    updatePermissionsMutation.mutate({ roleKey: selectedRole, grants });
  };

  const handleDiscardChanges = () => {
    setPendingChanges(new Map());
  };

  const filteredResources = useMemo(() => {
    if (!policyData?.resources) return [];
    
    return policyData.resources.filter(resource => {
      const matchesSearch = searchQuery === '' || 
        resource.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.resourceKey.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = selectedResourceType === 'all' || resource.resourceType === selectedResourceType;
      return matchesSearch && matchesType;
    });
  }, [policyData?.resources, searchQuery, selectedResourceType]);

  const groupedResources = useMemo(() => {
    const groups: Record<string, Record<string, Resource[]>> = {};
    
    filteredResources.forEach(resource => {
      const type = resource.resourceType;
      const category = resource.category || 'General';
      
      if (!groups[type]) groups[type] = {};
      if (!groups[type][category]) groups[type][category] = [];
      groups[type][category].push(resource);
    });
    
    return groups;
  }, [filteredResources]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const resourceTypeOrder = ['page', 'widget', 'api', 'workflow', 'feature'];

  if (loadingPolicies || loadingRoles) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="permission-manager-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Permission Manager
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure role-based access control for pages, widgets, and features
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingChanges.size > 0 && (
            <Badge variant="secondary" data-testid="pending-changes-badge">
              {pendingChanges.size} pending changes
            </Badge>
          )}
          <Button 
            variant="outline" 
            onClick={handleDiscardChanges}
            disabled={pendingChanges.size === 0}
            data-testid="button-discard-changes"
          >
            <X className="h-4 w-4 mr-2" />
            Discard
          </Button>
          <Button 
            onClick={handleSaveChanges}
            disabled={pendingChanges.size === 0 || updatePermissionsMutation.isPending}
            data-testid="button-save-changes"
          >
            <Save className="h-4 w-4 mr-2" />
            {updatePermissionsMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="matrix" className="w-full">
        <TabsList data-testid="permission-tabs">
          <TabsTrigger value="matrix" data-testid="tab-matrix">Permission Matrix</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">Role Overview</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div className="flex items-center gap-4">
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger className="w-[200px]" data-testid="select-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {rolesData?.roles?.map(role => (
                        <SelectItem key={role.roleKey} value={role.roleKey}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={ROLE_COLORS[role.roleKey]}>
                              {role.displayName}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              ({role.permissionCount} permissions)
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={selectedResourceType} onValueChange={setSelectedResourceType}>
                    <SelectTrigger className="w-[150px]" data-testid="select-resource-type">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {resourceTypeOrder.map(type => (
                        <SelectItem key={type} value={type}>
                          {RESOURCE_TYPE_LABELS[type] || type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="relative w-full md:w-64">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search resources..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                    data-testid="input-search-resources"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                {resourceTypeOrder.filter(type => groupedResources[type]).map(type => (
                  <div key={type} className="mb-6">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      {RESOURCE_TYPE_LABELS[type] || type}
                      <Badge variant="secondary" className="text-xs">
                        {Object.values(groupedResources[type] || {}).flat().length}
                      </Badge>
                    </h3>
                    
                    {Object.entries(groupedResources[type] || {}).map(([category, resources]) => (
                      <Collapsible
                        key={`${type}-${category}`}
                        open={expandedCategories.has(`${type}-${category}`) || true}
                        onOpenChange={() => toggleCategory(`${type}-${category}`)}
                        className="mb-4"
                      >
                        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-2">
                          {expandedCategories.has(`${type}-${category}`) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          {category}
                          <Badge variant="outline" className="text-xs">
                            {resources.length}
                          </Badge>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[300px]">Resource</TableHead>
                                {ACTIONS.map(action => {
                                  const Icon = ACTION_ICONS[action];
                                  return (
                                    <TableHead key={action} className="w-[100px] text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        <Icon className="h-4 w-4" />
                                        <span className="capitalize">{action}</span>
                                      </div>
                                    </TableHead>
                                  );
                                })}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {resources.map(resource => (
                                <TableRow key={resource.resourceKey} data-testid={`row-resource-${resource.resourceKey}`}>
                                  <TableCell>
                                    <div>
                                      <span className="font-medium">{resource.displayName}</span>
                                      <span className="text-xs text-muted-foreground ml-2">
                                        ({resource.resourceKey})
                                      </span>
                                    </div>
                                  </TableCell>
                                  {ACTIONS.map(action => {
                                    const isGranted = hasPermission(selectedRole, resource.resourceKey, action);
                                    const changeKey = `${selectedRole}:${resource.resourceKey}:${action}`;
                                    const isPending = pendingChanges.has(changeKey);
                                    
                                    return (
                                      <TableCell key={action} className="text-center">
                                        <div className="flex justify-center">
                                          <Checkbox
                                            checked={isGranted}
                                            onCheckedChange={() => togglePermission(resource.resourceKey, action)}
                                            className={isPending ? 'border-yellow-500 ring-2 ring-yellow-200' : ''}
                                            data-testid={`checkbox-${resource.resourceKey}-${action}`}
                                          />
                                        </div>
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                ))}
                
                {filteredResources.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No resources found matching your criteria</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rolesData?.roles?.sort((a, b) => a.hierarchyRank - b.hierarchyRank).map(role => (
              <Card 
                key={role.roleKey} 
                className={`cursor-pointer transition-all hover:shadow-md ${selectedRole === role.roleKey ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setSelectedRole(role.roleKey)}
                data-testid={`card-role-${role.roleKey}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between">
                    <Badge className={ROLE_COLORS[role.roleKey]}>
                      {role.displayName}
                    </Badge>
                    <span className="text-sm font-normal text-muted-foreground">
                      Rank: {role.hierarchyRank}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{role.permissionCount}</span>
                    <span className="text-sm text-muted-foreground">permissions granted</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Role Hierarchy</CardTitle>
              <CardDescription>
                Higher ranked roles inherit all permissions from lower ranked roles (when inheritance is enabled)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 flex-wrap">
                {rolesData?.roles?.sort((a, b) => a.hierarchyRank - b.hierarchyRank).map((role, index) => (
                  <div key={role.roleKey} className="flex items-center gap-2">
                    <Badge className={ROLE_COLORS[role.roleKey]} variant="outline">
                      {role.displayName}
                    </Badge>
                    {index < (rolesData?.roles?.length || 0) - 1 && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Permission Change History
              </CardTitle>
              <CardDescription>
                Track all changes made to role permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAudit ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : auditData?.logs?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No permission changes recorded yet</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditData?.logs?.map((log: any) => (
                        <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                          <TableCell className="text-sm">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>{log.actorUsername || 'System'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ROLE_COLORS[log.roleKey]}>
                              {log.roleKey}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{log.resourceDisplayName}</TableCell>
                          <TableCell className="capitalize">{log.action}</TableCell>
                          <TableCell>
                            <Badge variant={log.changeType === 'grant' ? 'default' : 'destructive'}>
                              {log.changeType === 'grant' ? (
                                <Check className="h-3 w-3 mr-1" />
                              ) : (
                                <X className="h-3 w-3 mr-1" />
                              )}
                              {log.changeType}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
