import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Mail, 
  MessageSquare, 
  Zap,
  Activity,
  TrendingUp,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  Pencil,
  Plus,
  Bell
} from "lucide-react";

// Import existing action templates page as a component
import ActionTemplatesPage from "./action-templates";

// Triggers Management Component
function TriggersManagement() {
  const [editingTrigger, setEditingTrigger] = useState<any>(null);
  const [selectedTrigger, setSelectedTrigger] = useState<any>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', isActive: true });
  const [createForm, setCreateForm] = useState({ 
    triggerKey: '', 
    name: '', 
    description: '', 
    category: 'system',
    isActive: true 
  });
  const { toast } = useToast();

  const { data: triggers, isLoading, error } = useQuery({
    queryKey: ['/api/admin/trigger-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trigger-catalog', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch triggers');
      return response.json();
    }
  });

  const { data: actionTemplates } = useQuery({
    queryKey: ['/api/action-templates'],
    queryFn: async () => {
      const response = await fetch('/api/action-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch action templates');
      return response.json();
    }
  });

  const { data: triggerActions = [] } = useQuery({
    queryKey: ['/api/admin/trigger-catalog', selectedTrigger?.id, 'actions'],
    queryFn: async () => {
      if (!selectedTrigger) return [];
      const response = await fetch(`/api/admin/trigger-catalog/${selectedTrigger.id}/actions`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch trigger actions');
      return response.json();
    },
    enabled: !!selectedTrigger
  });

  const createTriggerMutation = useMutation({
    mutationFn: async (data: { triggerKey: string; name: string; description: string; category: string; isActive: boolean }) => {
      return apiRequest('POST', '/api/admin/trigger-catalog', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog'] });
      toast({
        title: "Trigger Created",
        description: "The new trigger has been successfully created."
      });
      setCreateDialogOpen(false);
      setCreateForm({ triggerKey: '', name: '', description: '', category: 'system', isActive: true });
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateTriggerMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; description: string; isActive: boolean }) => {
      const { id, ...updateData } = data;
      return apiRequest('PUT', `/api/admin/trigger-catalog/${id}`, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog'] });
      toast({
        title: "Trigger Updated",
        description: "The trigger has been successfully updated."
      });
      setEditingTrigger(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleEditClick = (trigger: any) => {
    setEditingTrigger(trigger);
    setEditForm({
      name: trigger.name,
      description: trigger.description,
      isActive: trigger.isActive
    });
  };

  const createActionMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/admin/trigger-actions', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog', selectedTrigger?.id, 'actions'] });
      toast({
        title: "Action Added",
        description: "The action has been successfully linked to the trigger."
      });
      setActionDialogOpen(false);
      setEditingAction(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Action",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateActionMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...updateData } = data;
      return apiRequest('PUT', `/api/admin/trigger-actions/${id}`, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog', selectedTrigger?.id, 'actions'] });
      toast({
        title: "Action Updated",
        description: "The action has been successfully updated."
      });
      setActionDialogOpen(false);
      setEditingAction(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Action",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleCreateTrigger = () => {
    createTriggerMutation.mutate(createForm);
  };

  const handleSaveEdit = () => {
    if (!editingTrigger) return;
    updateTriggerMutation.mutate({
      id: editingTrigger.id,
      ...editForm
    });
  };

  const handleActionSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const maxSequence = triggerActions.length > 0 
      ? Math.max(...triggerActions.map((a: any) => a.sequenceOrder))
      : 0;
    const nextSequence = editingAction 
      ? parseInt(formData.get('sequenceOrder') as string) || editingAction.sequenceOrder
      : maxSequence + 1;
    
    const data = {
      triggerId: selectedTrigger?.id,
      actionTemplateId: parseInt(formData.get('actionTemplateId') as string),
      sequenceOrder: nextSequence,
      delaySeconds: parseInt(formData.get('delaySeconds') as string) || 0,
      requiresEmailPreference: !!formData.get('requiresEmailPreference'),
      requiresSmsPreference: !!formData.get('requiresSmsPreference'),
      retryOnFailure: !!formData.get('retryOnFailure'),
      maxRetries: parseInt(formData.get('maxRetries') as string) || 3,
      isActive: !!formData.get('isActive')
    };
    
    if (editingAction) {
      updateActionMutation.mutate({ id: editingAction.id, ...data });
    } else {
      createActionMutation.mutate(data);
    }
  };

  console.log('Triggers query state:', { triggers, isLoading, error });

  if (isLoading) {
    return <div className="p-8 text-center">Loading triggers...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-600">Error loading triggers: {(error as Error).message}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Trigger Catalog</h2>
          <p className="text-muted-foreground">
            Manage automated events and link them to action templates
          </p>
        </div>
        <Button 
          onClick={() => setCreateDialogOpen(true)}
          data-testid="button-create-trigger"
        >
          <Zap className="w-4 h-4 mr-2" />
          Create Trigger
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Left Column - Triggers List */}
        <Card>
          <CardHeader>
            <CardTitle>Available Triggers</CardTitle>
            <CardDescription>Select a trigger to view and manage its actions</CardDescription>
          </CardHeader>
          <CardContent>
            {triggers && triggers.length > 0 ? (
              <div className="space-y-2">
                {triggers.map((trigger: any) => (
                  <div
                    key={trigger.id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedTrigger?.id === trigger.id 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedTrigger(trigger)}
                    data-testid={`trigger-item-${trigger.id}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-medium">{trigger.name}</h4>
                        <p className="text-sm text-muted-foreground">{trigger.triggerKey}</p>
                        {trigger.description && (
                          <p className="text-xs text-muted-foreground mt-1">{trigger.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={trigger.isActive ? "default" : "secondary"} className="text-xs">
                          {trigger.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditClick(trigger);
                          }}
                          data-testid={`button-edit-trigger-${trigger.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No triggers found. Create one to get started.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column - Trigger Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger Actions</CardTitle>
            <CardDescription>
              {selectedTrigger ? `Actions for: ${selectedTrigger.name}` : 'Select a trigger to view actions'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedTrigger ? (
              <div className="space-y-4">
                <Button 
                  onClick={() => {
                    setEditingAction(null);
                    setActionDialogOpen(true);
                  }} 
                  variant="outline" 
                  size="sm"
                  data-testid="button-add-action"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Action
                </Button>

                <div className="space-y-2">
                  {triggerActions && triggerActions.length > 0 ? (
                    triggerActions.map((action: any) => (
                      <div
                        key={action.id}
                        className="p-3 border rounded-lg"
                        data-testid={`action-item-${action.id}`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                #{action.sequenceOrder}
                              </Badge>
                              <h5 className="font-medium text-sm">
                                {action.actionTemplate?.name || `Template #${action.actionTemplateId}`}
                              </h5>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 space-x-2">
                              {action.delaySeconds > 0 && <span>Delay: {action.delaySeconds}s</span>}
                              {action.retryOnFailure && <span>Retry: {action.maxRetries}x</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={action.isActive ? "default" : "secondary"} className="text-xs">
                              {action.isActive ? "Active" : "Inactive"}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingAction(action);
                                setActionDialogOpen(true);
                              }}
                              data-testid={`button-edit-action-${action.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No actions configured. Click "Add Action" to get started.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Select a trigger from the left to manage its actions
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Trigger Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Trigger</DialogTitle>
            <DialogDescription>
              Define a new trigger event for the system. This will be available for linking to action templates.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-trigger-key">Trigger Key <span className="text-red-500">*</span></Label>
              <Input 
                id="new-trigger-key"
                value={createForm.triggerKey}
                onChange={(e) => setCreateForm({ ...createForm, triggerKey: e.target.value })}
                placeholder="e.g., user_login, order_completed"
                required
              />
              <p className="text-xs text-muted-foreground">
                Unique identifier used in code. Use snake_case format.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-trigger-name">Display Name <span className="text-red-500">*</span></Label>
              <Input 
                id="new-trigger-name"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="e.g., User Login Event"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-trigger-description">Description</Label>
              <Textarea 
                id="new-trigger-description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Describe when this trigger fires and what it's used for"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-trigger-category">Category</Label>
              <Select 
                value={createForm.category} 
                onValueChange={(value) => setCreateForm({ ...createForm, category: value })}
              >
                <SelectTrigger id="new-trigger-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="application">Application</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="merchant">Merchant</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="notification">Notification</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="new-trigger-active">Active</Label>
                <div className="text-sm text-muted-foreground">
                  Enable this trigger immediately
                </div>
              </div>
              <Switch 
                id="new-trigger-active"
                checked={createForm.isActive}
                onCheckedChange={(checked) => setCreateForm({ ...createForm, isActive: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateTrigger}
              disabled={createTriggerMutation.isPending || !createForm.triggerKey || !createForm.name}
            >
              {createTriggerMutation.isPending ? 'Creating...' : 'Create Trigger'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Management Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAction ? 'Edit' : 'Add'} Action to Trigger</DialogTitle>
            <DialogDescription>
              {editingAction ? 'Update action settings' : `Link an action template to ${selectedTrigger?.name}`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleActionSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="actionTemplateId">Action Template <span className="text-red-500">*</span></Label>
              <Select name="actionTemplateId" defaultValue={editingAction?.actionTemplateId?.toString()} required>
                <SelectTrigger data-testid="select-action-template">
                  <SelectValue placeholder="Select action template" />
                </SelectTrigger>
                <SelectContent>
                  {actionTemplates && actionTemplates.map((template: any) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      <div className="flex items-center gap-2">
                        {template.actionType === 'email' ? (
                          <Mail className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Bell className="h-4 w-4 text-purple-500" />
                        )}
                        <span>{template.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sequenceOrder">Sequence Order</Label>
                <Input 
                  id="sequenceOrder" 
                  name="sequenceOrder" 
                  type="number" 
                  defaultValue={editingAction?.sequenceOrder || 1} 
                  min="1"
                  data-testid="input-sequence-order" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delaySeconds">Delay (seconds)</Label>
                <Input 
                  id="delaySeconds" 
                  name="delaySeconds" 
                  type="number" 
                  defaultValue={editingAction?.delaySeconds || 0} 
                  min="0"
                  data-testid="input-delay-seconds" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Preferences</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    id="requiresEmailPreference" 
                    name="requiresEmailPreference"
                    defaultChecked={editingAction?.requiresEmailPreference || false}
                    className="rounded"
                    data-testid="checkbox-email-preference"
                  />
                  <Label htmlFor="requiresEmailPreference" className="font-normal">
                    Requires email preference
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    id="requiresSmsPreference" 
                    name="requiresSmsPreference"
                    defaultChecked={editingAction?.requiresSmsPreference || false}
                    className="rounded"
                    data-testid="checkbox-sms-preference"
                  />
                  <Label htmlFor="requiresSmsPreference" className="font-normal">
                    Requires SMS preference
                  </Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Retry Settings</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    id="retryOnFailure" 
                    name="retryOnFailure"
                    defaultChecked={editingAction?.retryOnFailure || false}
                    className="rounded"
                    data-testid="checkbox-retry-on-failure"
                  />
                  <Label htmlFor="retryOnFailure" className="font-normal">
                    Retry on failure
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxRetries">Max Retries</Label>
                  <Input 
                    id="maxRetries" 
                    name="maxRetries" 
                    type="number" 
                    defaultValue={editingAction?.maxRetries || 3} 
                    min="0"
                    max="10"
                    data-testid="input-max-retries"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="isActive" 
                name="isActive"
                defaultChecked={editingAction?.isActive ?? true}
                className="rounded"
                data-testid="checkbox-action-active"
              />
              <Label htmlFor="isActive" className="font-normal">
                Active
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setActionDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createActionMutation.isPending || updateActionMutation.isPending}
                data-testid="button-submit-action"
              >
                {createActionMutation.isPending || updateActionMutation.isPending 
                  ? 'Saving...' 
                  : (editingAction ? 'Update' : 'Add') + ' Action'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Trigger Dialog */}
      <Dialog open={!!editingTrigger} onOpenChange={(open) => !open && setEditingTrigger(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Trigger</DialogTitle>
            <DialogDescription>
              Update trigger details. The trigger key cannot be changed.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="trigger-key">Trigger Key (Read-only)</Label>
              <Input 
                id="trigger-key"
                value={editingTrigger?.triggerKey || ''}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trigger-name">Name</Label>
              <Input 
                id="trigger-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Enter trigger name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trigger-description">Description</Label>
              <Textarea 
                id="trigger-description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Enter trigger description"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="trigger-active">Active Status</Label>
                <div className="text-sm text-muted-foreground">
                  Enable or disable this trigger
                </div>
              </div>
              <Switch 
                id="trigger-active"
                checked={editForm.isActive}
                onCheckedChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTrigger(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={updateTriggerMutation.isPending}
            >
              {updateTriggerMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Activity & Analytics Component
function ActivityAnalytics() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['/api/admin/action-activity/stats'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-activity/stats', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch activity stats');
      return response.json();
    }
  });

  const { data: recentActivity } = useQuery({
    queryKey: ['/api/admin/action-activity/recent'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-activity/recent', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch recent activity');
      return response.json();
    }
  });

  if (isLoading) {
    return <div className="p-8 text-center">Loading analytics...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Communication Analytics</h2>
        <p className="text-muted-foreground">
          Monitor delivery, engagement, and performance metrics
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalSent || 0}</div>
            <p className="text-xs text-muted-foreground">
              All channels combined
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Delivered</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.delivered || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.deliveryRate || 0}% delivery rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.failed || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.failureRate || 0}% failure rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting delivery
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest communication deliveries across all channels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivity?.length > 0 ? (
              recentActivity.map((activity: any) => (
                <div key={activity.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div className="flex items-center gap-3">
                    {activity.actionType === 'email' && <Mail className="w-4 h-4 text-blue-600" />}
                    {activity.actionType === 'sms' && <MessageSquare className="w-4 h-4 text-green-600" />}
                    {activity.actionType === 'notification' && <Activity className="w-4 h-4 text-purple-600" />}
                    <div>
                      <div className="font-medium">{activity.templateName}</div>
                      <div className="text-sm text-muted-foreground">
                        To: {activity.recipient}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      activity.status === 'sent' || activity.status === 'delivered' 
                        ? 'default' 
                        : activity.status === 'failed' 
                        ? 'destructive' 
                        : 'secondary'
                    }>
                      {activity.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {new Date(activity.executedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No activity yet
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Main Communications Management Page
export default function CommunicationsManagement() {
  const [activeTab, setActiveTab] = useState("templates");

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Communications Management</h1>
        <p className="text-muted-foreground">
          Unified hub for managing multi-channel communications: email, SMS, webhooks, notifications, and more
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Action Templates
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <TemplateCount />
            </div>
            <p className="text-xs text-muted-foreground">
              Multi-channel templates
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Triggers
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <TriggerCount />
            </div>
            <p className="text-xs text-muted-foreground">
              Automated events
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              This Month
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MonthlyActivityCount />
            </div>
            <p className="text-xs text-muted-foreground">
              Communications sent
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="templates" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="triggers" className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Triggers
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Activity & Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-6">
          <ActionTemplatesPage />
        </TabsContent>

        <TabsContent value="triggers" className="space-y-6">
          <TriggersManagement />
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <ActivityAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper Components for Stats
function TemplateCount() {
  const { data } = useQuery({
    queryKey: ['/api/action-templates'],
    queryFn: async () => {
      const response = await fetch('/api/action-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    }
  });
  return <span>{data?.length || 0}</span>;
}

function TriggerCount() {
  const { data } = useQuery({
    queryKey: ['/api/admin/trigger-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trigger-catalog', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch triggers');
      return response.json();
    }
  });
  return <span>{data?.filter((t: any) => t.isActive)?.length || 0}</span>;
}

function MonthlyActivityCount() {
  const { data } = useQuery({
    queryKey: ['/api/admin/action-activity/stats'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-activity/stats', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });
  return <span>{data?.totalSent || 0}</span>;
}
