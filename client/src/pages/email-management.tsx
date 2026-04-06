import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Search
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface EmailTemplate {
  id: number;
  name: string;
  description?: string;
  category: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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

const EmailManagement: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [activityFilters, setActivityFilters] = useState({
    status: 'all',
    templateId: 'all',
    search: ''
  });

  // Fetch email templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['/api/admin/email-templates'],
    queryFn: async () => {
      const response = await fetch('/api/admin/email-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
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

  // Create/Update template mutation
  const templateMutation = useMutation({
    mutationFn: async (template: Partial<EmailTemplate>) => {
      const url = template.id 
        ? `/api/admin/email-templates/${template.id}`
        : '/api/admin/email-templates';
      const method = template.id ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(template)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-templates'] });
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
      const response = await fetch(`/api/admin/email-templates/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-templates'] });
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

  const handleTemplateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const templateData: Partial<EmailTemplate> = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      description: formData.get('description') as string,
      subject: formData.get('subject') as string,
      htmlContent: formData.get('htmlContent') as string,
      variables: JSON.parse((formData.get('variables') as string) || '{}'),
      isActive: formData.get('isActive') === 'true'
    };

    if (editingTemplate) {
      templateData.id = editingTemplate.id;
    }

    templateMutation.mutate(templateData);
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Click Rate</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.clickRate?.toFixed(1) || 0}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="templates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="templates">Email Templates</TabsTrigger>
          <TabsTrigger value="activity">Email Activity</TabsTrigger>
          <TabsTrigger value="triggers">Email Triggers</TabsTrigger>
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
                    <Textarea
                      id="htmlContent"
                      name="htmlContent"
                      defaultValue={editingTemplate?.htmlContent || ''}
                      rows={10}
                      required
                      placeholder="HTML email content with template variables"
                    />
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
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templatesLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        Loading templates...
                      </TableCell>
                    </TableRow>
                  ) : templates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        No email templates found
                      </TableCell>
                    </TableRow>
                  ) : (
                    templates.map((template: EmailTemplate) => (
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
                          {format(new Date(template.updatedAt), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingTemplate(template);
                              setIsTemplateDialogOpen(true);
                            }}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteTemplateMutation.mutate(template.id)}
                            disabled={deleteTemplateMutation.isPending}
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
        </TabsContent>

        {/* Email Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Email Activity</h3>
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

        {/* Email Triggers Tab */}
        <TabsContent value="triggers" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Email Triggers</h3>
              <p className="text-sm text-gray-600">Automated email triggers based on system events</p>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triggersLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        Loading triggers...
                      </TableCell>
                    </TableRow>
                  ) : triggers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        No email triggers configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    triggers.map((trigger: EmailTrigger) => (
                      <TableRow key={trigger.id}>
                        <TableCell className="font-medium">{trigger.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{trigger.triggerEvent}</Badge>
                        </TableCell>
                        <TableCell>
                          {templates.find((t: EmailTemplate) => t.id === trigger.templateId)?.name || 'Unknown'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={trigger.isActive ? 'default' : 'secondary'}>
                            {trigger.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {format(new Date(trigger.createdAt), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmailManagement;