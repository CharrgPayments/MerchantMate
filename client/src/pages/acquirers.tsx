import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit2, Building2, CreditCard, FileText, Eye } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { insertAcquirerSchema, type Acquirer, type AcquirerWithTemplates } from '@shared/schema';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';

type InsertAcquirer = z.infer<typeof insertAcquirerSchema>;

export default function AcquirersPage() {
  const [selectedAcquirer, setSelectedAcquirer] = useState<AcquirerWithTemplates | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch acquirers
  const { data: acquirers = [], isLoading } = useQuery<Acquirer[]>({
    queryKey: ['/api/acquirers'],
    queryFn: async () => {
      const response = await fetch('/api/acquirers', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch acquirers');
      return response.json();
    },
    staleTime: 0,
    gcTime: 0
  });

  // Create acquirer mutation
  const createMutation = useMutation({
    mutationFn: (data: InsertAcquirer) => apiRequest('POST', '/api/acquirers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirers'] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Success",
        description: "Acquirer created successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create acquirer",
        variant: "destructive"
      });
    }
  });

  // Update acquirer mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: InsertAcquirer }) => 
      apiRequest('PUT', `/api/acquirers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirers'] });
      setIsEditDialogOpen(false);
      setSelectedAcquirer(null);
      toast({
        title: "Success",
        description: "Acquirer updated successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update acquirer",
        variant: "destructive"
      });
    }
  });

  // Forms
  const createForm = useForm<InsertAcquirer>({
    resolver: zodResolver(insertAcquirerSchema),
    defaultValues: {
      name: '',
      displayName: '',
      code: '',
      description: '',
      isActive: true
    }
  });

  const editForm = useForm<InsertAcquirer>({
    resolver: zodResolver(insertAcquirerSchema)
  });

  const handleCreate = (data: InsertAcquirer) => {
    createMutation.mutate(data);
  };

  const handleEdit = (acquirer: Acquirer) => {
    setSelectedAcquirer(acquirer as AcquirerWithTemplates);
    editForm.reset({
      name: acquirer.name,
      displayName: acquirer.displayName,
      code: acquirer.code,
      description: acquirer.description || '',
      isActive: acquirer.isActive
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdate = (data: InsertAcquirer) => {
    if (selectedAcquirer) {
      updateMutation.mutate({ id: selectedAcquirer.id, data });
    }
  };

  const handleViewDetails = async (acquirer: Acquirer) => {
    try {
      const detailedAcquirer = await apiRequest('GET', `/api/acquirers/${acquirer.id}`) as unknown as AcquirerWithTemplates;
      setSelectedAcquirer(detailedAcquirer);
      setIsViewDialogOpen(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load acquirer details",
        variant: "destructive"
      });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading acquirers...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Acquirer Management</h1>
          <p className="text-muted-foreground">
            Manage payment processors and their application requirements
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-acquirer">
              <Plus className="mr-2 h-4 w-4" />
              Add Acquirer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create New Acquirer</DialogTitle>
              <DialogDescription>
                Add a new payment processor to the system
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Wells Fargo" {...field} data-testid="input-acquirer-name" />
                        </FormControl>
                        <FormDescription>Internal name for the acquirer</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code</FormLabel>
                        <FormControl>
                          <Input placeholder="WF" {...field} data-testid="input-acquirer-code" />
                        </FormControl>
                        <FormDescription>Short code (2-3 letters)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={createForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Wells Fargo Merchant Services" {...field} data-testid="input-acquirer-display-name" />
                      </FormControl>
                      <FormDescription>User-friendly display name</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Brief description of the acquirer's services..." 
                          {...field} 
                          value={field.value || ''}
                          data-testid="input-acquirer-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Active</FormLabel>
                        <FormDescription>
                          Enable this acquirer for new applications
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch 
                          checked={field.value} 
                          onCheckedChange={field.onChange}
                          data-testid="switch-acquirer-active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex justify-end space-x-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsCreateDialogOpen(false)}
                    data-testid="button-cancel-create"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending}
                    data-testid="button-submit-create"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Acquirer'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Acquirers</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-acquirers">
              {acquirers?.length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Acquirers</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-acquirers">
              {acquirers?.filter((a: Acquirer) => a.isActive).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Templates</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-templates">
              {acquirers?.reduce((sum: number, a: any) => sum + (a.templates?.length || 0), 0) || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acquirers List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {acquirers?.map((acquirer: Acquirer) => (
          <Card key={acquirer.id} className="relative">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg" data-testid={`text-acquirer-name-${acquirer.id}`}>
                  {acquirer.displayName}
                </CardTitle>
                <Badge 
                  variant={acquirer.isActive ? "default" : "secondary"}
                  data-testid={`badge-acquirer-status-${acquirer.id}`}
                >
                  {acquirer.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <CardDescription>
                Code: {acquirer.code}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {acquirer.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {acquirer.description}
                </p>
              )}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Created: {new Date(acquirer.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex space-x-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleViewDetails(acquirer)}
                  data-testid={`button-view-acquirer-${acquirer.id}`}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  View
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleEdit(acquirer)}
                  data-testid={`button-edit-acquirer-${acquirer.id}`}
                >
                  <Edit2 className="mr-1 h-3 w-3" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Acquirer</DialogTitle>
            <DialogDescription>
              Update acquirer information
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-acquirer-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-acquirer-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-acquirer-display-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ''} data-testid="input-edit-acquirer-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Active</FormLabel>
                      <FormDescription>
                        Enable this acquirer for new applications
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch 
                        checked={field.value} 
                        onCheckedChange={field.onChange}
                        data-testid="switch-edit-acquirer-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsEditDialogOpen(false)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={updateMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update Acquirer'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Acquirer Details</DialogTitle>
            <DialogDescription>
              View complete acquirer information and application templates
            </DialogDescription>
          </DialogHeader>
          {selectedAcquirer && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold">Name</h4>
                  <p className="text-sm text-muted-foreground">{selectedAcquirer.name}</p>
                </div>
                <div>
                  <h4 className="font-semibold">Code</h4>
                  <p className="text-sm text-muted-foreground">{selectedAcquirer.code}</p>
                </div>
                <div>
                  <h4 className="font-semibold">Display Name</h4>
                  <p className="text-sm text-muted-foreground">{selectedAcquirer.displayName}</p>
                </div>
                <div>
                  <h4 className="font-semibold">Status</h4>
                  <Badge variant={selectedAcquirer.isActive ? "default" : "secondary"}>
                    {selectedAcquirer.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              {selectedAcquirer.description && (
                <div>
                  <h4 className="font-semibold">Description</h4>
                  <p className="text-sm text-muted-foreground">{selectedAcquirer.description}</p>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-3">Application Templates</h4>
                {selectedAcquirer.templates && selectedAcquirer.templates.length > 0 ? (
                  <div className="space-y-2">
                    {selectedAcquirer.templates.map((template: any) => (
                      <Card key={template.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{template.templateName}</p>
                            <p className="text-sm text-muted-foreground">Version {template.version}</p>
                          </div>
                          <Badge variant={template.isActive ? "default" : "secondary"}>
                            {template.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No application templates configured</p>
                )}
              </div>
              <div className="flex justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => setIsViewDialogOpen(false)}
                  data-testid="button-close-details"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}