import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Mail, 
  Plus, 
  Edit, 
  Trash2, 
  Send, 
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Search,
  Bell
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { EmailTemplate } from '@shared/schema';
import { WysiwygEditor } from '@/components/WysiwygEditor';

interface EmailActivity {
  id: number;
  templateId: number;
  templateName?: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed';
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  errorMessage?: string;
  triggerSource?: string;
  triggeredBy?: string;
  metadata?: Record<string, any>;
}

interface EmailTrigger {
  id: number;
  name: string;
  description?: string;
  triggerEvent: string;
  templateId: number;
  conditions: Record<string, any>;
  isActive: boolean;
  createdAt: string;
}

interface EmailStats {
  totalSent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
}

interface NotificationTemplate {
  id: number;
  name: string;
  description?: string;
  actionType: string;
  category: string;
  config: {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    actionUrl?: string;
  };
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TriggerCatalogItem {
  id: number;
  triggerKey: string;
  name: string;
  description?: string;
  category: string;
  contextSchema?: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TriggerActionItem {
  id: number;
  triggerId: number;
  actionTemplateId: number;
  sequenceOrder: number;
  conditions?: any;
  requiresEmailPreference: boolean;
  requiresSmsPreference: boolean;
  delaySeconds: number;
  retryOnFailure: boolean;
  maxRetries: number;
  isActive: boolean;
  actionTemplate?: NotificationTemplate | EmailTemplate;
}

const SystemTriggersTab: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerCatalogItem | null>(null);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);
  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<TriggerCatalogItem | null>(null);
  const [editingAction, setEditingAction] = useState<TriggerActionItem | null>(null);
  const [selectedTriggerEvent, setSelectedTriggerEvent] = useState('');

  // Populate form when editing trigger
  useEffect(() => {
    if (editingTrigger) {
      setSelectedTriggerEvent(editingTrigger.triggerKey);
    }
  }, [editingTrigger]);

  // Fetch available trigger events
  const { data: triggerEvents = [] } = useQuery({
    queryKey: ['/api/admin/trigger-events'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trigger-events', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch trigger events');
      return response.json();
    }
  });

  // Fetch all triggers
  const { data: triggers = [], isLoading: triggersLoading } = useQuery<TriggerCatalogItem[]>({
    queryKey: ['/api/admin/trigger-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trigger-catalog', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch triggers');
      return response.json();
    }
  });

  // Fetch actions for selected trigger
  const { data: triggerActions = [] } = useQuery<TriggerActionItem[]>({
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

  // Fetch all action templates
  const { data: actionTemplates = [] } = useQuery<NotificationTemplate[]>({
    queryKey: ['/api/admin/action-templates'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch action templates');
      return response.json();
    }
  });

  const createTriggerMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/admin/trigger-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to create trigger');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog'] });
      setIsTriggerDialogOpen(false);
      setEditingTrigger(null);
      setSelectedTriggerEvent('');
      toast({ title: 'Trigger created successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to create trigger', variant: 'destructive' });
    }
  });

  const updateTriggerMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...updates } = data;
      const response = await fetch(`/api/admin/trigger-catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Failed to update trigger');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog'] });
      setIsTriggerDialogOpen(false);
      setEditingTrigger(null);
      setSelectedTriggerEvent('');
      toast({ title: 'Trigger updated successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to update trigger', variant: 'destructive' });
    }
  });

  const createActionMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/admin/trigger-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to create action');
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog', variables.triggerId, 'actions'] });
      setIsActionDialogOpen(false);
      setEditingAction(null);
      toast({ title: 'Action added successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to add action', variant: 'destructive' });
    }
  });

  const updateActionMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...updates } = data;
      const response = await fetch(`/api/admin/trigger-actions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Failed to update action');
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trigger-catalog', selectedTrigger?.id, 'actions'] });
      setIsActionDialogOpen(false);
      setEditingAction(null);
      toast({ title: 'Action updated successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to update action', variant: 'destructive' });
    }
  });

  const handleTriggerSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      triggerKey: selectedTriggerEvent,
      name: formData.get('name'),
      description: formData.get('description'),
      category: formData.get('category'),
      isActive: formData.get('isActive') === 'true'
    };
    
    if (editingTrigger) {
      updateTriggerMutation.mutate({ id: editingTrigger.id, ...data });
    } else {
      createTriggerMutation.mutate(data);
    }
  };

  const handleActionSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    // Calculate next sequence order for new actions
    const maxSequence = triggerActions.length > 0 
      ? Math.max(...triggerActions.map(a => a.sequenceOrder))
      : 0;
    const nextSequence = editingAction 
      ? parseInt(formData.get('sequenceOrder') as string) || editingAction.sequenceOrder
      : maxSequence + 1;
    
    const data = {
      triggerId: selectedTrigger?.id,
      actionTemplateId: parseInt(formData.get('actionTemplateId') as string),
      sequenceOrder: nextSequence,
      delaySeconds: parseInt(formData.get('delaySeconds') as string) || 0,
      requiresEmailPreference: formData.get('requiresEmailPreference') === 'true',
      requiresSmsPreference: formData.get('requiresSmsPreference') === 'true',
      retryOnFailure: formData.get('retryOnFailure') === 'true',
      maxRetries: parseInt(formData.get('maxRetries') as string) || 3,
      isActive: formData.get('isActive') === 'true'
    };
    
    if (editingAction) {
      updateActionMutation.mutate({ id: editingAction.id, ...data });
    } else {
      createActionMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">System Triggers</h3>
          <p className="text-sm text-gray-600">Manage automated triggers and their associated actions</p>
        </div>
        <Dialog open={isTriggerDialogOpen} onOpenChange={setIsTriggerDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingTrigger(null);
              setSelectedTriggerEvent('');
              setIsTriggerDialogOpen(true);
            }} data-testid="button-create-trigger">
              <Plus className="w-4 h-4 mr-2" />
              New Trigger
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTrigger ? 'Edit' : 'Create'} Trigger</DialogTitle>
              <DialogDescription>
                {editingTrigger ? 'Update trigger settings' : 'Define a new system trigger event'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleTriggerSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="triggerKey">Trigger Event</Label>
                <Select 
                  value={selectedTriggerEvent} 
                  onValueChange={setSelectedTriggerEvent}
                  required
                >
                  <SelectTrigger data-testid="select-trigger-event">
                    <SelectValue placeholder="Select trigger event" />
                  </SelectTrigger>
                  <SelectContent>
                    {triggerEvents.map((event: string) => (
                      <SelectItem key={event} value={event}>
                        {event.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input 
                  id="name" 
                  name="name" 
                  placeholder="User Registered" 
                  defaultValue={editingTrigger?.name || ''}
                  required 
                  data-testid="input-trigger-name" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea 
                  id="description" 
                  name="description" 
                  placeholder="Triggered when a user registers" 
                  defaultValue={editingTrigger?.description || ''}
                  data-testid="input-trigger-description" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select name="category" defaultValue={editingTrigger?.category || 'user'} required>
                  <SelectTrigger data-testid="select-trigger-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="application">Application</SelectItem>
                    <SelectItem value="merchant">Merchant</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="isActive">Status</Label>
                <Select name="isActive" defaultValue={editingTrigger?.isActive === false ? 'false' : 'true'}>
                  <SelectTrigger data-testid="select-trigger-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="button-submit-trigger">
                  {editingTrigger ? 'Update' : 'Create'} Trigger
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Available Triggers</CardTitle>
            <CardDescription>Select a trigger to view and manage its actions</CardDescription>
          </CardHeader>
          <CardContent>
            {triggersLoading ? (
              <div>Loading triggers...</div>
            ) : (
              <div className="space-y-2">
                {triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedTrigger?.id === trigger.id 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => setSelectedTrigger(trigger)}
                    data-testid={`trigger-item-${trigger.id}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1" onClick={() => setSelectedTrigger(trigger)}>
                        <h4 className="font-medium">{trigger.name}</h4>
                        <p className="text-sm text-gray-600">{trigger.triggerKey}</p>
                        {trigger.description && (
                          <p className="text-xs text-gray-500 mt-1">{trigger.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={trigger.isActive ? 'default' : 'secondary'}>
                          {trigger.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTrigger(trigger);
                            setIsTriggerDialogOpen(true);
                          }}
                          data-testid={`button-edit-trigger-${trigger.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {triggers.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No triggers configured</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

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
                <Dialog open={isActionDialogOpen} onOpenChange={setIsActionDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      onClick={() => {
                        setEditingAction(null);
                        setIsActionDialogOpen(true);
                      }} 
                      variant="outline" 
                      size="sm"
                      data-testid="button-add-action"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Action
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{editingAction ? 'Edit' : 'Add'} Action to Trigger</DialogTitle>
                      <DialogDescription>
                        {editingAction ? 'Update action settings' : `Associate an action template with ${selectedTrigger.name}`}
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleActionSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="actionTemplateId">Action Template</Label>
                        <Select name="actionTemplateId" defaultValue={editingAction?.actionTemplateId?.toString()} required>
                          <SelectTrigger data-testid="select-action-template">
                            <SelectValue placeholder="Select action template" />
                          </SelectTrigger>
                          <SelectContent>
                            {actionTemplates.map((template) => (
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
                              value="true"
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
                              value="true"
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <input 
                              type="checkbox" 
                              id="retryOnFailure" 
                              name="retryOnFailure" 
                              value="true"
                              defaultChecked={editingAction?.retryOnFailure !== false}
                              className="rounded"
                              data-testid="checkbox-retry-failure"
                            />
                            <Label htmlFor="retryOnFailure" className="font-normal">
                              Retry on failure
                            </Label>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="maxRetries">Max Retries</Label>
                          <Input 
                            id="maxRetries" 
                            name="maxRetries" 
                            type="number" 
                            defaultValue={editingAction?.maxRetries || 3} 
                            min="0"
                            data-testid="input-max-retries" 
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actionIsActive">Status</Label>
                        <Select name="isActive" defaultValue={editingAction?.isActive === false ? 'false' : 'true'}>
                          <SelectTrigger data-testid="select-action-status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Active</SelectItem>
                            <SelectItem value="false">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <DialogFooter>
                        <Button type="submit" data-testid="button-submit-action">
                          {editingAction ? 'Update' : 'Add'} Action
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                
                <div className="space-y-2">
                  {triggerActions.map((action) => (
                    <div
                      key={action.id}
                      className="p-3 border rounded-lg"
                      data-testid={`action-item-${action.id}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{action.sequenceOrder}</Badge>
                            <h5 className="font-medium">{action.actionTemplate?.name || 'Unknown Template'}</h5>
                          </div>
                          {action.delaySeconds > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              Delay: {action.delaySeconds}s
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={action.isActive ? 'default' : 'secondary'}>
                            {action.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingAction(action);
                              setIsActionDialogOpen(true);
                            }}
                            data-testid={`button-edit-action-${action.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {triggerActions.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No actions configured</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                Select a trigger from the left to manage its actions
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const EmailWrappersTab: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingWrapper, setEditingWrapper] = useState<any | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: wrappers = [], isLoading, error } = useQuery({
    queryKey: ['/api/admin/email-wrappers'],
    queryFn: async () => {
      const response = await fetch('/api/admin/email-wrappers', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json();
    }
  });

  const wrapperMutation = useMutation({
    mutationFn: async (wrapperData: any) => {
      const url = wrapperData.id 
        ? `/api/admin/email-wrappers/${wrapperData.id}`
        : '/api/admin/email-wrappers';
      
      const method = wrapperData.id ? 'PUT' : 'POST';
      const response = await apiRequest(method, url, wrapperData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-wrappers'] });
      setIsDialogOpen(false);
      setEditingWrapper(null);
      toast({ title: editingWrapper ? 'Wrapper updated successfully' : 'Wrapper created successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to save wrapper', variant: 'destructive' });
    }
  });

  const deleteWrapperMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/admin/email-wrappers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-wrappers'] });
      toast({ title: 'Wrapper deleted successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to delete wrapper', variant: 'destructive' });
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const wrapperData = {
      id: editingWrapper?.id,
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      type: formData.get('type') as string,
      headerGradient: formData.get('headerGradient') as string || null,
      headerSubtitle: formData.get('headerSubtitle') as string || null,
      ctaButtonText: formData.get('ctaButtonText') as string || null,
      ctaButtonUrl: formData.get('ctaButtonUrl') as string || null,
      ctaButtonColor: formData.get('ctaButtonColor') as string || null,
      customFooter: formData.get('customFooter') as string || null,
      isActive: formData.get('isActive') === 'true'
    };

    wrapperMutation.mutate(wrapperData);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Email Wrappers</h3>
          <p className="text-sm text-gray-600">Manage reusable email wrapper templates</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingWrapper(null); setIsDialogOpen(true); }} data-testid="button-new-wrapper">
              <Plus className="w-4 h-4 mr-2" />
              New Wrapper
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingWrapper ? 'Edit Wrapper' : 'Create New Wrapper'}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="name"
                      name="name"
                      defaultValue={editingWrapper?.name}
                      required
                      data-testid="input-wrapper-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="type">Wrapper Type <span className="text-red-500">*</span></Label>
                    <Select name="type" defaultValue={editingWrapper?.type || 'notification'} required>
                      <SelectTrigger data-testid="select-wrapper-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="welcome">Welcome (Green)</SelectItem>
                        <SelectItem value="agentNotification">Agent Notification (Purple)</SelectItem>
                        <SelectItem value="security">Security (Blue)</SelectItem>
                        <SelectItem value="notification">Notification (Teal)</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={editingWrapper?.description}
                    rows={2}
                    data-testid="input-wrapper-description"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="headerGradient">Header Gradient (CSS)</Label>
                  <Input
                    id="headerGradient"
                    name="headerGradient"
                    defaultValue={editingWrapper?.headerGradient}
                    placeholder="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                    data-testid="input-wrapper-gradient"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="headerSubtitle">Header Subtitle</Label>
                  <Input
                    id="headerSubtitle"
                    name="headerSubtitle"
                    defaultValue={editingWrapper?.headerSubtitle}
                    placeholder="Welcome to Core CRM"
                    data-testid="input-wrapper-subtitle"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ctaButtonText">CTA Button Text</Label>
                    <Input
                      id="ctaButtonText"
                      name="ctaButtonText"
                      defaultValue={editingWrapper?.ctaButtonText}
                      placeholder="Get Started"
                      data-testid="input-wrapper-cta-text"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ctaButtonUrl">CTA Button URL</Label>
                    <Input
                      id="ctaButtonUrl"
                      name="ctaButtonUrl"
                      defaultValue={editingWrapper?.ctaButtonUrl}
                      placeholder="{{dashboardUrl}}"
                      data-testid="input-wrapper-cta-url"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ctaButtonColor">CTA Button Color</Label>
                    <Input
                      id="ctaButtonColor"
                      name="ctaButtonColor"
                      defaultValue={editingWrapper?.ctaButtonColor}
                      placeholder="#3b82f6"
                      data-testid="input-wrapper-cta-color"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customFooter">Custom Footer HTML</Label>
                  <Textarea
                    id="customFooter"
                    name="customFooter"
                    defaultValue={editingWrapper?.customFooter}
                    rows={3}
                    placeholder="<p>Need help? Contact us at support@corecrm.com</p>"
                    data-testid="input-wrapper-footer"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    name="isActive"
                    value="true"
                    defaultChecked={editingWrapper?.isActive ?? true}
                    className="rounded"
                    data-testid="checkbox-wrapper-active"
                  />
                  <Label htmlFor="isActive">Active</Label>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={wrapperMutation.isPending} data-testid="button-save-wrapper">
                  {wrapperMutation.isPending ? 'Saving...' : 'Save Wrapper'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                    Loading wrappers...
                  </TableCell>
                </TableRow>
              ) : wrappers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                    No wrappers found. Create your first wrapper to get started.
                  </TableCell>
                </TableRow>
              ) : (
                wrappers.map((wrapper: any) => (
                  <TableRow key={wrapper.id}>
                    <TableCell className="font-medium">{wrapper.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{wrapper.type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{wrapper.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={wrapper.isActive ? 'default' : 'secondary'}>
                        {wrapper.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingWrapper(wrapper);
                          setIsDialogOpen(true);
                        }}
                        data-testid={`button-edit-wrapper-${wrapper.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this wrapper?')) {
                            deleteWrapperMutation.mutate(wrapper.id);
                          }
                        }}
                        disabled={deleteWrapperMutation.isPending}
                        data-testid={`button-delete-wrapper-${wrapper.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

const EmailManagement: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<EmailTrigger | null>(null);
  const [selectedTriggerEvent, setSelectedTriggerEvent] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activityFilters, setActivityFilters] = useState({
    status: 'all',
    templateId: 'all',
    search: ''
  });

  // Notification template state
  const [editingNotification, setEditingNotification] = useState<NotificationTemplate | null>(null);
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);

  // Wrapper configuration state
  const [wrapperType, setWrapperType] = useState('notification');
  
  // HTML content state for WYSIWYG editor
  const [htmlContent, setHtmlContent] = useState('');

  // Test email state
  const [isTestEmailDialogOpen, setIsTestEmailDialogOpen] = useState(false);
  const [testEmailTemplate, setTestEmailTemplate] = useState<EmailTemplate | null>(null);
  const [testEmailRecipient, setTestEmailRecipient] = useState('');

  // Fetch email templates (from action_templates with type 'email')
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['/api/admin/action-templates/type/email'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-templates/type/email', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch templates');
      const actionTemplates = await response.json();
      
      // Transform action templates to email template format for UI compatibility
      return actionTemplates.map((at: any) => ({
        id: at.id,
        name: at.name,
        description: at.description,
        subject: at.config?.subject || '',
        htmlContent: at.config?.htmlContent || '',
        textContent: at.config?.textContent || '',
        variables: at.variables || {},
        category: at.category,
        isActive: at.isActive ?? true,
        useWrapper: at.config?.useWrapper ?? true,
        wrapperType: at.config?.wrapperType || 'notification',
        headerGradient: at.config?.headerGradient || null,
        headerSubtitle: at.config?.headerSubtitle || null,
        ctaButtonText: at.config?.ctaButtonText || null,
        ctaButtonUrl: at.config?.ctaButtonUrl || null,
        ctaButtonColor: at.config?.ctaButtonColor || null,
        customFooter: at.config?.customFooter || null,
        createdAt: at.createdAt,
        updatedAt: at.updatedAt,
      }));
    }
  });

  // Fetch email activity
  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['/api/admin/email-activity', activityFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activityFilters.status) params.append('status', activityFilters.status);
      if (activityFilters.templateId) params.append('templateId', activityFilters.templateId);
      if (activityFilters.search) params.append('recipientEmail', activityFilters.search);
      
      const response = await fetch(`/api/admin/email-activity?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch activity');
      return response.json();
    }
  });

  // Fetch email statistics
  const { data: stats } = useQuery({
    queryKey: ['/api/admin/email-stats'],
    queryFn: async () => {
      const response = await fetch('/api/admin/email-stats', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Fetch email triggers
  const { data: triggers = [], isLoading: triggersLoading } = useQuery({
    queryKey: ['/api/admin/email-triggers'],
    queryFn: async () => {
      const response = await fetch('/api/admin/email-triggers', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch triggers');
      return response.json();
    }
  });

  // Fetch template usage (which triggers use which templates)
  const { data: templateUsage = {} } = useQuery({
    queryKey: ['/api/admin/action-templates-usage'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-templates-usage', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch template usage');
      return response.json();
    }
  });

  // Fetch available trigger events
  const { data: triggerEvents = [] } = useQuery({
    queryKey: ['/api/admin/trigger-events'],
    queryFn: async () => {
      const response = await fetch('/api/admin/trigger-events', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch trigger events');
      return response.json();
    }
  });

  // Set form values when editing a trigger
  React.useEffect(() => {
    if (editingTrigger) {
      setSelectedTriggerEvent(editingTrigger.triggerEvent || '');
      setSelectedTemplateId(editingTrigger.templateId?.toString() || '');
    }
  }, [editingTrigger]);

  // Create/Update template mutation
  const templateMutation = useMutation({
    mutationFn: async (template: Partial<EmailTemplate>) => {
      // Transform email template format to action template format
      const actionTemplate = {
        id: template.id,
        name: template.name,
        description: template.description,
        actionType: 'email',
        category: template.category,
        config: {
          subject: template.subject,
          htmlContent: template.htmlContent,
          textContent: template.textContent,
          useWrapper: template.useWrapper,
          wrapperType: template.wrapperType,
          headerGradient: template.headerGradient,
          headerSubtitle: template.headerSubtitle,
          ctaButtonText: template.ctaButtonText,
          ctaButtonUrl: template.ctaButtonUrl,
          ctaButtonColor: template.ctaButtonColor,
          customFooter: template.customFooter,
        },
        variables: template.variables,
        isActive: template.isActive,
      };

      const url = template.id 
        ? `/api/admin/action-templates/${template.id}`
        : '/api/admin/action-templates';
      const method = template.id ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(actionTemplate)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/action-templates/type/email'] });
      setIsTemplateDialogOpen(false);
      setEditingTemplate(null);
      toast({
        title: 'Success',
        description: 'Email template saved successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/action-templates/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/action-templates/type/email'] });
      toast({
        title: 'Success',
        description: 'Email template deleted successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Test email mutation
  const testEmailMutation = useMutation({
    mutationFn: async ({ templateId, email }: { templateId: number; email: string }) => {
      const response = await fetch(`/api/admin/email-templates/${templateId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send test email');
      }
      
      return response.json();
    },
    onSuccess: () => {
      setIsTestEmailDialogOpen(false);
      setTestEmailRecipient('');
      setTestEmailTemplate(null);
      toast({
        title: 'Success',
        description: 'Test email sent successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Create/Update trigger mutation
  const triggerMutation = useMutation({
    mutationFn: async (trigger: Partial<EmailTrigger>) => {
      const url = trigger.id 
        ? `/api/admin/email-triggers/${trigger.id}`
        : '/api/admin/email-triggers';
      const method = trigger.id ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(trigger)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save trigger');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-triggers'] });
      setIsTriggerDialogOpen(false);
      setEditingTrigger(null);
      toast({
        title: 'Success',
        description: 'Email trigger saved successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Fetch notification templates (action templates with type 'notification')
  const { data: notificationTemplates = [], isLoading: notificationsLoading } = useQuery({
    queryKey: ['/api/admin/action-templates/type/notification'],
    queryFn: async () => {
      const response = await fetch('/api/admin/action-templates/type/notification', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch notification templates');
      return response.json();
    }
  });

  // Create/Update notification template mutation
  const notificationMutation = useMutation({
    mutationFn: async (template: Partial<NotificationTemplate>) => {
      const url = template.id 
        ? `/api/admin/action-templates/${template.id}`
        : '/api/admin/action-templates';
      const method = template.id ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(template)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save notification template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/action-templates/type/notification'] });
      setIsNotificationDialogOpen(false);
      setEditingNotification(null);
      toast({
        title: 'Success',
        description: 'Notification template saved successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Delete notification template mutation
  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/action-templates/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete notification template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/action-templates/type/notification'] });
      toast({
        title: 'Success',
        description: 'Notification template deleted successfully'
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const handleTemplateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const selectedWrapperType = formData.get('wrapperType') as string || 'none';
    
    const templateData: Partial<EmailTemplate> = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      description: formData.get('description') as string,
      subject: formData.get('subject') as string,
      htmlContent: formData.get('htmlContent') as string,
      variables: JSON.parse((formData.get('variables') as string) || '{}'),
      isActive: formData.get('isActive') === 'true',
      // Wrapper configuration - simplified to just wrapper type selection
      useWrapper: selectedWrapperType !== 'none',
      wrapperType: selectedWrapperType !== 'none' ? selectedWrapperType : null,
      headerGradient: null,
      headerSubtitle: null,
      ctaButtonText: null,
      ctaButtonUrl: null,
      ctaButtonColor: null,
      customFooter: null
    };

    if (editingTemplate) {
      templateData.id = editingTemplate.id;
    }

    templateMutation.mutate(templateData);
  };

  const handleTriggerSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const triggerData: Partial<EmailTrigger> = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      triggerEvent: selectedTriggerEvent,
      templateId: parseInt(selectedTemplateId),
      conditions: JSON.parse((formData.get('conditions') as string) || '{}'),
      isActive: formData.get('isActive') === 'true'
    };

    if (editingTrigger) {
      triggerData.id = editingTrigger.id;
    }

    triggerMutation.mutate(triggerData);
  };

  const handleNotificationSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const notificationData: Partial<NotificationTemplate> = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      category: formData.get('category') as string,
      actionType: 'notification',
      config: {
        message: formData.get('message') as string,
        type: formData.get('notificationType') as 'info' | 'success' | 'warning' | 'error',
        actionUrl: formData.get('actionUrl') as string || undefined
      },
      variables: JSON.parse((formData.get('variables') as string) || '[]'),
      isActive: formData.get('isActive') === 'true'
    };

    if (editingNotification) {
      notificationData.id = editingNotification.id;
    }

    notificationMutation.mutate(notificationData);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      pending: 'outline',
      sent: 'secondary', 
      delivered: 'default',
      opened: 'default',
      clicked: 'default',
      failed: 'destructive'
    };

    const icons = {
      pending: Clock,
      sent: Send,
      delivered: CheckCircle,
      opened: Eye,
      clicked: Mail,
      failed: XCircle
    };

    const Icon = icons[status as keyof typeof icons] || AlertCircle;

    return (
      <Badge variant={variants[status] || 'outline'} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  const filteredActivity = activity.filter((item: EmailActivity) => {
    if (activityFilters.search && !item.recipientEmail.toLowerCase().includes(activityFilters.search.toLowerCase())) {
      return false;
    }
    if (activityFilters.status && activityFilters.status !== 'all' && item.status !== activityFilters.status) {
      return false;
    }
    if (activityFilters.templateId && activityFilters.templateId !== 'all' && item.templateId.toString() !== activityFilters.templateId) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
              <Send className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalSent?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.deliveryRate?.toFixed(1) || 0}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.openRate?.toFixed(1) || 0}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="templates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="templates">Email Templates</TabsTrigger>
          <TabsTrigger value="wrappers">Email Wrappers</TabsTrigger>
          <TabsTrigger value="activity">Communication Activity</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="automation">System Triggers</TabsTrigger>
          <TabsTrigger value="guide">Template Guide</TabsTrigger>
        </TabsList>

        {/* Email Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Email Templates</h3>
              <p className="text-sm text-gray-600">Manage email templates for automated communications</p>
            </div>
            <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  onClick={() => {
                    setEditingTemplate(null);
                    setWrapperType('notification');
                    setHtmlContent('');
                    setIsTemplateDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingTemplate ? 'Edit Email Template' : 'Create Email Template'}
                  </DialogTitle>
                  <DialogDescription>
                    Configure email template settings and content
                  </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleTemplateSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Template Name</Label>
                      <Input
                        id="name"
                        name="name"
                        defaultValue={editingTemplate?.name || ''}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="category">Template Category</Label>
                      <Select name="category" defaultValue={editingTemplate?.category || ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="prospect_validation">Prospect Validation</SelectItem>
                          <SelectItem value="signature_request">Signature Request</SelectItem>
                          <SelectItem value="application_submission">Application Submission</SelectItem>
                          <SelectItem value="password_reset">Password Reset</SelectItem>
                          <SelectItem value="two_factor">Two Factor Authentication</SelectItem>
                          <SelectItem value="email_verification">Email Verification</SelectItem>
                          <SelectItem value="welcome">Welcome Email</SelectItem>
                          <SelectItem value="notification">Notification</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="subject">Subject Line</Label>
                    <Input
                      id="subject"
                      name="subject"
                      defaultValue={editingTemplate?.subject || ''}
                      required
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      name="description"
                      defaultValue={editingTemplate?.description || ''}
                      placeholder="Brief description of this template"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="variables">Template Variables (JSON format)</Label>
                    <Textarea
                      id="variables"
                      name="variables"
                      defaultValue={editingTemplate?.variables ? JSON.stringify(editingTemplate.variables, null, 2) : '{}'}
                      placeholder='{"name": "{{name}}", "email": "{{email}}", "link": "{{link}}"}'
                      rows={3}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="htmlContent">HTML Content</Label>
                    <WysiwygEditor
                      id="htmlContent"
                      name="htmlContent"
                      value={htmlContent}
                      onChange={setHtmlContent}
                      placeholder="HTML email content with template variables like {{firstName}}, {{email}}, etc."
                    />
                  </div>

                  {/* Wrapper Selection */}
                  <div>
                    <Label htmlFor="wrapperType">Email Wrapper Style</Label>
                    <Select 
                      name="wrapperType" 
                      value={wrapperType}
                      onValueChange={setWrapperType}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select wrapper style" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Wrapper</SelectItem>
                        <SelectItem value="welcome">Welcome (Green Gradient)</SelectItem>
                        <SelectItem value="agentNotification">Agent Notification (Purple Gradient)</SelectItem>
                        <SelectItem value="security">Security (Blue Gradient)</SelectItem>
                        <SelectItem value="notification">Notification (Teal Gradient)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="isActive"
                      name="isActive"
                      value="true"
                      defaultChecked={editingTemplate?.isActive !== false}
                    />
                    <Label htmlFor="isActive">Active</Label>
                  </div>
                  
                  <DialogFooter>
                    <Button type="submit" disabled={templateMutation.isPending}>
                      {templateMutation.isPending ? 'Saving...' : 'Save Template'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Used in Triggers</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templatesLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-4">
                        Loading templates...
                      </TableCell>
                    </TableRow>
                  ) : templates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-4">
                        No email templates found
                      </TableCell>
                    </TableRow>
                  ) : (
                    templates.map((template: EmailTemplate) => {
                      const usage = templateUsage[template.id] || [];
                      return (
                        <TableRow key={template.id}>
                          <TableCell className="font-medium">{template.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{template.category}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{template.subject}</TableCell>
                          <TableCell>
                            <Badge variant={template.isActive ? 'default' : 'secondary'}>
                              {template.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {usage.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {usage.map((trigger: any) => (
                                  <Badge 
                                    key={trigger.triggerId} 
                                    variant="outline"
                                    className="cursor-help"
                                    title={`${trigger.triggerName} (${trigger.triggerKey})`}
                                    data-testid={`template-usage-${template.id}-${trigger.triggerId}`}
                                  >
                                    {trigger.triggerName}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">Not used</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {template.updatedAt ? format(new Date(template.updatedAt), 'MMM d, yyyy') : '-'}
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setTestEmailTemplate(template);
                                setTestEmailRecipient('');
                                setIsTestEmailDialogOpen(true);
                              }}
                              data-testid={`button-test-email-${template.id}`}
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingTemplate(template);
                                setWrapperType(
                                  template.useWrapper === false 
                                    ? 'none' 
                                    : (template.wrapperType || 'notification')
                                );
                                setHtmlContent(template.htmlContent || '');
                                setIsTemplateDialogOpen(true);
                              }}
                              data-testid={`button-edit-${template.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const usage = templateUsage[template.id] || [];
                                if (usage.length > 0) {
                                  const triggerNames = usage.map((t: any) => t.triggerName).join(', ');
                                  if (!confirm(`Warning: This template is used by ${usage.length} trigger(s): ${triggerNames}\n\nDeleting it will break these automations. Continue?`)) {
                                    return;
                                  }
                                }
                                deleteTemplateMutation.mutate(template.id);
                              }}
                              disabled={deleteTemplateMutation.isPending}
                              data-testid={`button-delete-${template.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Wrappers Tab */}
        <TabsContent value="wrappers" className="space-y-4">
          <EmailWrappersTab />
        </TabsContent>

        {/* Communication Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Communication Activity</h3>
              <p className="text-sm text-gray-600">Track email delivery and engagement metrics</p>
            </div>
          </div>

          {/* Activity Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="statusFilter">Status</Label>
                  <Select 
                    value={activityFilters.status} 
                    onValueChange={(value) => setActivityFilters(prev => ({ ...prev, status: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="delivered">Delivered</SelectItem>
                      <SelectItem value="opened">Opened</SelectItem>
                      <SelectItem value="clicked">Clicked</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="templateFilter">Template</Label>
                  <Select 
                    value={activityFilters.templateId} 
                    onValueChange={(value) => setActivityFilters(prev => ({ ...prev, templateId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All templates" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All templates</SelectItem>
                      {templates.map((template: EmailTemplate) => (
                        <SelectItem key={template.id} value={template.id.toString()}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="searchFilter">Search Email</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="searchFilter"
                      placeholder="Search by email..."
                      value={activityFilters.search}
                      onChange={(e) => setActivityFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="pl-8"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Clicked</TableHead>
                    <TableHead>Opened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activityLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        Loading activity...
                      </TableCell>
                    </TableRow>
                  ) : filteredActivity.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        No email activity found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredActivity.map((item: EmailActivity) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.recipientEmail}</TableCell>
                        <TableCell className="max-w-xs truncate">{item.subject}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>
                          {item.sentAt ? format(new Date(item.sentAt), 'MMM d, yyyy HH:mm') : '-'}
                        </TableCell>
                        <TableCell>
                          {item.clickedAt ? format(new Date(item.clickedAt), 'MMM d, yyyy HH:mm') : '-'}
                        </TableCell>
                        <TableCell>
                          {item.openedAt ? format(new Date(item.openedAt), 'MMM d, yyyy HH:mm') : '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Notification Templates</h3>
              <p className="text-sm text-gray-600">Manage in-app notification templates for user alerts</p>
            </div>
            <Dialog open={isNotificationDialogOpen} onOpenChange={setIsNotificationDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  onClick={() => {
                    setEditingNotification(null);
                    setIsNotificationDialogOpen(true);
                  }}
                  data-testid="button-create-notification"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Notification Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingNotification ? 'Edit Notification Template' : 'Create Notification Template'}
                  </DialogTitle>
                  <DialogDescription>
                    Configure notification template settings and message content
                  </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleNotificationSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="notif-name">Template Name</Label>
                      <Input
                        id="notif-name"
                        name="name"
                        defaultValue={editingNotification?.name || ''}
                        required
                        data-testid="input-notification-name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="notif-category">Category</Label>
                      <Select name="category" defaultValue={editingNotification?.category || ''}>
                        <SelectTrigger data-testid="select-notification-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">System</SelectItem>
                          <SelectItem value="application">Application</SelectItem>
                          <SelectItem value="security">Security</SelectItem>
                          <SelectItem value="payment">Payment</SelectItem>
                          <SelectItem value="general">General</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="notif-description">Description</Label>
                    <Input
                      id="notif-description"
                      name="description"
                      defaultValue={editingNotification?.description || ''}
                      data-testid="input-notification-description"
                    />
                  </div>

                  <div>
                    <Label htmlFor="notif-type">Notification Type</Label>
                    <Select name="notificationType" defaultValue={editingNotification?.config.type || 'info'}>
                      <SelectTrigger data-testid="select-notification-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="notif-message">Message Content</Label>
                    <Textarea
                      id="notif-message"
                      name="message"
                      defaultValue={editingNotification?.config.message || ''}
                      rows={4}
                      required
                      placeholder="Use {{variableName}} for dynamic content"
                      data-testid="textarea-notification-message"
                    />
                  </div>

                  <div>
                    <Label htmlFor="notif-action-url">Action URL (optional)</Label>
                    <Input
                      id="notif-action-url"
                      name="actionUrl"
                      defaultValue={editingNotification?.config.actionUrl || ''}
                      placeholder="/path/to/action or full URL"
                      data-testid="input-notification-url"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="notif-variables">Available Variables (JSON array)</Label>
                    <Input
                      id="notif-variables"
                      name="variables"
                      defaultValue={JSON.stringify(editingNotification?.variables || [])}
                      placeholder='["userId", "userName", "actionType"]'
                      data-testid="input-notification-variables"
                    />
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <Label htmlFor="notif-active">Active</Label>
                    <Select name="isActive" defaultValue={editingNotification?.isActive === false ? 'false' : 'true'}>
                      <SelectTrigger className="w-32" data-testid="select-notification-active">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <DialogFooter>
                    <Button type="submit" data-testid="button-save-notification">
                      {editingNotification ? 'Update' : 'Create'} Template
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Used in Triggers</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notificationsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center">
                        Loading notification templates...
                      </TableCell>
                    </TableRow>
                  ) : notificationTemplates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-gray-500">
                        No notification templates configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    notificationTemplates.map((template: NotificationTemplate) => {
                      const usage = templateUsage[template.id] || [];
                      return (
                        <TableRow key={template.id} data-testid={`row-notification-${template.id}`}>
                          <TableCell className="font-medium">{template.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{template.category}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={
                                template.config.type === 'error' ? 'destructive' :
                                template.config.type === 'warning' ? 'outline' :
                                template.config.type === 'success' ? 'default' : 'secondary'
                              }
                            >
                              {template.config.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-md truncate">
                            {template.config.message}
                          </TableCell>
                          <TableCell>
                            <Badge variant={template.isActive ? 'default' : 'secondary'}>
                              {template.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {usage.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {usage.map((trigger: any) => (
                                  <Badge 
                                    key={trigger.triggerId} 
                                    variant="outline"
                                    className="cursor-help"
                                    title={`${trigger.triggerName} (${trigger.triggerKey})`}
                                    data-testid={`notification-usage-${template.id}-${trigger.triggerId}`}
                                  >
                                    {trigger.triggerName}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">Not used</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingNotification(template);
                                  setIsNotificationDialogOpen(true);
                                }}
                                data-testid={`button-edit-notification-${template.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const usage = templateUsage[template.id] || [];
                                  let message = 'Are you sure you want to delete this notification template?';
                                  
                                  if (usage.length > 0) {
                                    const triggerNames = usage.map((t: any) => t.triggerName).join(', ');
                                    message = `Warning: This template is used by ${usage.length} trigger(s): ${triggerNames}\n\nDeleting it will break these automations. Continue?`;
                                  }
                                  
                                  if (confirm(message)) {
                                    deleteNotificationMutation.mutate(template.id);
                                  }
                                }}
                                data-testid={`button-delete-notification-${template.id}`}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Template Guide Tab */}
        <TabsContent value="guide" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email Template Guide</CardTitle>
              <CardDescription>
                Learn how to create effective email templates using variables and best practices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Variable Syntax Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Using Variables</h3>
                <p className="text-sm text-gray-600">
                  Variables allow you to personalize emails with dynamic content. Use double curly braces to insert variables:
                </p>
                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-md border">
                  <code className="text-sm">
                    Hello {`{{firstName}}`} {`{{lastName}}`},<br/>
                    Welcome to {`{{companyName}}`}!
                  </code>
                </div>
              </div>

              {/* Available Variables by Trigger Type */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Available Variables by Trigger Type</h3>
                
                {/* Agent Registered */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">agent_registered</h4>
                    <Badge variant="outline">Agent Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a new agent is registered in the system</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{agentId}}`}</span> - Agent's unique ID</li>
                      <li><span className="text-blue-600">{`{{agentName}}`}</span> - Full name of the agent</li>
                      <li><span className="text-blue-600">{`{{firstName}}`}</span> - Agent's first name</li>
                      <li><span className="text-blue-600">{`{{lastName}}`}</span> - Agent's last name</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - Agent's email address</li>
                      <li><span className="text-blue-600">{`{{phone}}`}</span> - Agent's phone number</li>
                      <li><span className="text-blue-600">{`{{territory}}`}</span> - Assigned territory</li>
                      <li><span className="text-blue-600">{`{{companyName}}`}</span> - Associated company name</li>
                      <li><span className="text-blue-600">{`{{companyId}}`}</span> - Company's unique ID</li>
                      <li><span className="text-blue-600">{`{{hasUserAccount}}`}</span> - true/false if user account created</li>
                      <li><span className="text-blue-600">{`{{username}}`}</span> - Login username (if account created)</li>
                    </ul>
                  </div>
                </div>

                {/* User Registered */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">user_registered</h4>
                    <Badge variant="outline">User Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a new user account is created</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{userId}}`}</span> - User's unique ID</li>
                      <li><span className="text-blue-600">{`{{username}}`}</span> - Login username</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - User's email address</li>
                      <li><span className="text-blue-600">{`{{firstName}}`}</span> - User's first name</li>
                      <li><span className="text-blue-600">{`{{lastName}}`}</span> - User's last name</li>
                      <li><span className="text-blue-600">{`{{role}}`}</span> - User's assigned role</li>
                    </ul>
                  </div>
                </div>

                {/* Application Submitted */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">application_submitted</h4>
                    <Badge variant="outline">Application Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a merchant application is submitted</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{applicationId}}`}</span> - Application's unique ID</li>
                      <li><span className="text-blue-600">{`{{merchantName}}`}</span> - Merchant's business name</li>
                      <li><span className="text-blue-600">{`{{contactName}}`}</span> - Primary contact name</li>
                      <li><span className="text-blue-600">{`{{contactEmail}}`}</span> - Contact email address</li>
                      <li><span className="text-blue-600">{`{{businessType}}`}</span> - Type of business</li>
                      <li><span className="text-blue-600">{`{{submittedDate}}`}</span> - Submission date</li>
                    </ul>
                  </div>
                </div>

                {/* Signature Requested */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">signature_requested</h4>
                    <Badge variant="outline">Document Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a digital signature is requested</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{requestId}}`}</span> - Signature request ID</li>
                      <li><span className="text-blue-600">{`{{recipientName}}`}</span> - Signer's name</li>
                      <li><span className="text-blue-600">{`{{recipientEmail}}`}</span> - Signer's email</li>
                      <li><span className="text-blue-600">{`{{documentName}}`}</span> - Document to be signed</li>
                      <li><span className="text-blue-600">{`{{signatureUrl}}`}</span> - Link to signature page</li>
                      <li><span className="text-blue-600">{`{{expiresAt}}`}</span> - Request expiration date</li>
                    </ul>
                  </div>
                </div>

                {/* Password Reset */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">password_reset_requested</h4>
                    <Badge variant="outline">Security Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a user requests a password reset</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{userName}}`}</span> - User's full name</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - User's email address</li>
                      <li><span className="text-blue-600">{`{{resetLink}}`}</span> - Password reset URL</li>
                      <li><span className="text-blue-600">{`{{expiresIn}}`}</span> - Link expiration time</li>
                    </ul>
                  </div>
                </div>

                {/* Prospect Validation */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">prospect_validation</h4>
                    <Badge variant="outline">Prospect Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a prospect validates their email address to start an application</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{prospectId}}`}</span> - Prospect's unique ID</li>
                      <li><span className="text-blue-600">{`{{prospectName}}`}</span> - Full name of the prospect</li>
                      <li><span className="text-blue-600">{`{{firstName}}`}</span> - Prospect's first name</li>
                      <li><span className="text-blue-600">{`{{lastName}}`}</span> - Prospect's last name</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - Prospect's email address</li>
                      <li><span className="text-blue-600">{`{{phone}}`}</span> - Prospect's phone number</li>
                      <li><span className="text-blue-600">{`{{companyName}}`}</span> - Business/company name</li>
                      <li><span className="text-blue-600">{`{{agentId}}`}</span> - Assigned agent's ID</li>
                      <li><span className="text-blue-600">{`{{agentName}}`}</span> - Assigned agent's full name</li>
                      <li><span className="text-blue-600">{`{{agentEmail}}`}</span> - Assigned agent's email</li>
                      <li><span className="text-blue-600">{`{{validationDate}}`}</span> - Email validation timestamp</li>
                    </ul>
                  </div>
                </div>

                {/* Email Verification */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">email_verification_requested</h4>
                    <Badge variant="outline">Security Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a user needs to verify their email address</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{userId}}`}</span> - User's unique ID</li>
                      <li><span className="text-blue-600">{`{{userName}}`}</span> - User's full name</li>
                      <li><span className="text-blue-600">{`{{firstName}}`}</span> - User's first name</li>
                      <li><span className="text-blue-600">{`{{lastName}}`}</span> - User's last name</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - User's email address</li>
                      <li><span className="text-blue-600">{`{{verificationLink}}`}</span> - Email verification URL</li>
                      <li><span className="text-blue-600">{`{{verificationCode}}`}</span> - Verification code (if applicable)</li>
                      <li><span className="text-blue-600">{`{{expiresIn}}`}</span> - Link expiration time</li>
                    </ul>
                  </div>
                </div>

                {/* Two Factor Authentication */}
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-base">two_factor_requested</h4>
                    <Badge variant="outline">Security Events</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Fired when a user requests two-factor authentication code</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <ul className="text-sm space-y-1 font-mono">
                      <li><span className="text-blue-600">{`{{userId}}`}</span> - User's unique ID</li>
                      <li><span className="text-blue-600">{`{{userName}}`}</span> - User's full name</li>
                      <li><span className="text-blue-600">{`{{firstName}}`}</span> - User's first name</li>
                      <li><span className="text-blue-600">{`{{lastName}}`}</span> - User's last name</li>
                      <li><span className="text-blue-600">{`{{email}}`}</span> - User's email address</li>
                      <li><span className="text-blue-600">{`{{twoFactorCode}}`}</span> - 6-digit authentication code</li>
                      <li><span className="text-blue-600">{`{{ipAddress}}`}</span> - Login IP address</li>
                      <li><span className="text-blue-600">{`{{deviceInfo}}`}</span> - Device/browser information</li>
                      <li><span className="text-blue-600">{`{{expiresIn}}`}</span> - Code expiration time</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Best Practices Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Best Practices</h3>
                <div className="space-y-2">
                  <div className="border-l-4 border-blue-500 pl-4 py-2">
                    <h4 className="font-semibold text-sm mb-1">✅ Use Clear Subject Lines</h4>
                    <p className="text-sm text-gray-600">
                      Keep subjects under 50 characters and personalize when possible
                    </p>
                    <code className="text-xs bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded mt-1 block">
                      Welcome to Core CRM, {`{{firstName}}`}!
                    </code>
                  </div>

                  <div className="border-l-4 border-green-500 pl-4 py-2">
                    <h4 className="font-semibold text-sm mb-1">✅ Include Plain Text Version</h4>
                    <p className="text-sm text-gray-600">
                      Always provide a text content version for email clients that don't support HTML
                    </p>
                  </div>

                  <div className="border-l-4 border-purple-500 pl-4 py-2">
                    <h4 className="font-semibold text-sm mb-1">✅ Test Your Variables</h4>
                    <p className="text-sm text-gray-600">
                      Create a test email first and verify all variables are populated correctly
                    </p>
                  </div>

                  <div className="border-l-4 border-orange-500 pl-4 py-2">
                    <h4 className="font-semibold text-sm mb-1">✅ Use Valid From Address</h4>
                    <p className="text-sm text-gray-600">
                      Ensure your "from" email is verified in SendGrid to avoid delivery issues
                    </p>
                    <code className="text-xs bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded mt-1 block">
                      Currently verified: noreply@charrg.com
                    </code>
                  </div>

                  <div className="border-l-4 border-red-500 pl-4 py-2">
                    <h4 className="font-semibold text-sm mb-1">⚠️ Respect Communication Preferences</h4>
                    <p className="text-sm text-gray-600">
                      Triggers can check user communication preferences before sending emails
                    </p>
                  </div>
                </div>
              </div>

              {/* Example Template Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Example: Welcome Email Template</h3>
                <div className="border rounded-lg p-4 space-y-3 bg-gray-50 dark:bg-gray-900">
                  <div>
                    <Label className="text-xs font-semibold">Subject Line:</Label>
                    <code className="block text-sm mt-1">Welcome to Core CRM!</code>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">HTML Content:</Label>
                    <pre className="text-xs mt-1 overflow-x-auto p-3 bg-white dark:bg-gray-800 rounded border">
{`<p>Dear {{firstName}} {{lastName}},</p>

<p>Welcome to Core CRM! Your agent account has been successfully created.</p>

<p><strong>Your Login Details:</strong><br>
Username: {{username}}</p>

<p><strong>Company Information:</strong><br>
Company: {{companyName}}<br>
Territory: {{territory}}</p>

<p>We are excited to have you on our team!</p>

<p>Best regards,<br>
Core CRM Team</p>`}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">Text Content:</Label>
                    <pre className="text-xs mt-1 overflow-x-auto p-3 bg-white dark:bg-gray-800 rounded border">
{`Dear {{firstName}} {{lastName}},

Welcome to Core CRM! Your agent account has been successfully created.

Your Login Details:
Username: {{username}}

Company Information:
Company: {{companyName}}
Territory: {{territory}}

We are excited to have you on our team!

Best regards,
Core CRM Team`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Quick Start Guide */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Quick Start: Creating a Template</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
                  <li>Go to the <strong>Email Templates</strong> tab</li>
                  <li>Click <strong>New Template</strong> button</li>
                  <li>Fill in template name, category, and subject line</li>
                  <li>Write your HTML content using available variables from the guide above</li>
                  <li>Add a plain text version of your content</li>
                  <li>Define template variables in JSON format (optional)</li>
                  <li>Save and activate your template</li>
                  <li>Go to <strong>Email Triggers</strong> tab to associate it with a system event</li>
                </ol>
              </div>

              {/* Troubleshooting Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Troubleshooting</h3>
                <div className="space-y-2 text-sm">
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                    <h4 className="font-semibold mb-1">❓ Email not sending?</h4>
                    <ul className="list-disc list-inside space-y-1 text-gray-600">
                      <li>Check that the template is marked as <strong>Active</strong></li>
                      <li>Verify the trigger is marked as <strong>Active</strong></li>
                      <li>Confirm the "from" email is verified in SendGrid</li>
                      <li>Check user communication preferences allow email</li>
                      <li>View <strong>Email Activity</strong> tab for delivery status</li>
                    </ul>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <h4 className="font-semibold mb-1">❓ Variables not populating?</h4>
                    <ul className="list-disc list-inside space-y-1 text-gray-600">
                      <li>Ensure variable names exactly match the available variables list</li>
                      <li>Check for typos in variable names (case-sensitive)</li>
                      <li>Verify the trigger event provides that specific variable</li>
                    </ul>
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>
        </TabsContent>

        {/* System Triggers Tab */}
        <TabsContent value="automation" className="space-y-4">
          <SystemTriggersTab />
        </TabsContent>
      </Tabs>

      {/* Test Email Dialog */}
      <Dialog open={isTestEmailDialogOpen} onOpenChange={setIsTestEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Send a test email with variable placeholders preserved so you can see where they would appear.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {testEmailTemplate && (
              <div className="space-y-2">
                <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                  <p className="text-sm font-medium">{testEmailTemplate.name}</p>
                  <p className="text-xs text-gray-500">{testEmailTemplate.subject}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="test-email-recipient">
                Recipient Email Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="test-email-recipient"
                type="email"
                placeholder="Enter email address"
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                data-testid="input-test-email-recipient"
              />
              <p className="text-xs text-gray-500">
                Variable placeholders like {'{{firstName}}'} will be left as-is so you can see where they would appear.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsTestEmailDialogOpen(false);
                setTestEmailRecipient('');
                setTestEmailTemplate(null);
              }}
              data-testid="button-cancel-test-email"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Email validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!testEmailRecipient || !emailRegex.test(testEmailRecipient)) {
                  toast({
                    title: 'Invalid Email',
                    description: 'Please enter a valid email address',
                    variant: 'destructive'
                  });
                  return;
                }

                if (testEmailTemplate) {
                  testEmailMutation.mutate({
                    templateId: testEmailTemplate.id,
                    email: testEmailRecipient
                  });
                }
              }}
              disabled={testEmailMutation.isPending || !testEmailRecipient}
              data-testid="button-send-test-email"
            >
              {testEmailMutation.isPending ? 'Sending...' : 'Send Test Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailManagement;