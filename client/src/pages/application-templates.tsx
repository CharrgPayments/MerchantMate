import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Eye, Copy, Download, Upload, Trash2, Settings, Circle, CheckCircle, ChevronDown, ChevronRight, GripVertical, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Types for template data
interface AcquirerApplicationTemplate {
  id: number;
  acquirerId: number;
  templateName: string;
  version: string;
  isActive: boolean;
  fieldConfiguration: any;
  pdfMappingConfiguration?: any;
  requiredFields: string[];
  conditionalFields?: any;
  createdAt: string;
  updatedAt: string;
  acquirer: {
    id: number;
    name: string;
    displayName: string;
    code: string;
  };
}

interface Acquirer {
  id: number;
  name: string;
  displayName: string;
  code: string;
}

// Form schema for creating/editing templates
const templateFormSchema = z.object({
  acquirerId: z.number().min(1, 'Please select an acquirer'),
  templateName: z.string().min(1, 'Template name is required'),
  version: z.string().min(1, 'Version is required'),
  isActive: z.boolean().default(true),
  fieldConfiguration: z.object({
    sections: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(z.object({
        id: z.string(),
        type: z.enum(['text', 'email', 'tel', 'url', 'date', 'number', 'select', 'checkbox', 'textarea', 'radio', 'currency', 'zipcode', 'phone', 'ein', 'address']),
        label: z.string(),
        required: z.boolean().optional(),
        pattern: z.string().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        options: z.array(z.string()).optional(),
        sensitive: z.boolean().optional(),
        placeholder: z.string().optional(),
        description: z.string().optional()
      }))
    }))
  }),
  requiredFields: z.array(z.string()).default([]),
  conditionalFields: z.record(z.any()).optional()
});

type TemplateFormData = z.infer<typeof templateFormSchema>;

export default function ApplicationTemplatesPage() {
  const [selectedTemplate, setSelectedTemplate] = useState<AcquirerApplicationTemplate | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isFieldConfigOpen, setIsFieldConfigOpen] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Fetch application templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery<AcquirerApplicationTemplate[]>({
    queryKey: ['/api/acquirer-application-templates'],
    queryFn: async () => {
      const response = await fetch('/api/acquirer-application-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch application templates');
      return response.json();
    },
    staleTime: 0,
    gcTime: 0
  });

  // Fetch acquirers for the dropdown
  const { data: acquirers = [], isLoading: acquirersLoading } = useQuery<Acquirer[]>({
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

  // Fetch application counts per template
  const { data: applicationCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ['/api/acquirer-application-templates/application-counts'],
    queryFn: async () => {
      const response = await fetch('/api/acquirer-application-templates/application-counts', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch application counts');
      return response.json();
    },
    staleTime: 30000, // Cache for 30 seconds
    gcTime: 300000 // Keep in cache for 5 minutes
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: async (data: TemplateFormData & { pdfFile?: File }) => {
      let response;
      
      if (data.pdfFile) {
        // Use FormData for PDF upload
        const formData = new FormData();
        formData.append('pdf', data.pdfFile);
        formData.append('templateData', JSON.stringify({
          acquirerId: data.acquirerId,
          templateName: data.templateName,
          version: data.version,
          isActive: data.isActive,
          fieldConfiguration: data.fieldConfiguration,
          requiredFields: data.requiredFields,
          conditionalFields: data.conditionalFields
        }));
        
        response = await fetch('/api/acquirer-application-templates/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
      } else {
        // Regular JSON request for templates without PDF
        response = await fetch('/api/acquirer-application-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acquirerId: data.acquirerId,
            templateName: data.templateName,
            version: data.version,
            isActive: data.isActive,
            fieldConfiguration: data.fieldConfiguration,
            requiredFields: data.requiredFields,
            conditionalFields: data.conditionalFields
          })
        });
      }
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create template' }));
        throw new Error(error.error || 'Failed to create template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirer-application-templates'] });
      setIsCreateOpen(false);
      toast({
        title: 'Success',
        description: 'Application template created successfully'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create template',
        variant: 'destructive'
      });
    }
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: TemplateFormData }) => {
      const response = await fetch(`/api/acquirer-application-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update template' }));
        throw new Error(error.error || 'Failed to update template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirer-application-templates'] });
      setIsEditOpen(false);
      setSelectedTemplate(null);
      toast({
        title: 'Success',
        description: 'Application template updated successfully'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update template',
        variant: 'destructive'
      });
    }
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/acquirer-application-templates/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete template' }));
        throw new Error(error.error || 'Failed to delete template');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirer-application-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/acquirer-application-templates/application-counts'] });
      toast({
        title: 'Success',
        description: 'Application template deleted successfully'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete template',
        variant: 'destructive'
      });
    }
  });

  // Update field configuration mutation
  const updateFieldConfigMutation = useMutation({
    mutationFn: async ({ id, fieldConfiguration, requiredFields, conditionalFields }: { 
      id: number; 
      fieldConfiguration: any; 
      requiredFields: string[];
      conditionalFields?: Record<string, any>
    }) => {
      const response = await fetch(`/api/acquirer-application-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fieldConfiguration, 
          requiredFields,
          conditionalFields
        }),
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update field configuration' }));
        throw new Error(error.error || 'Failed to update field configuration');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/acquirer-application-templates'] });
      setIsFieldConfigOpen(false);
      setSelectedTemplate(null);
      toast({
        title: 'Success',
        description: 'Field configuration updated successfully'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update field configuration',
        variant: 'destructive'
      });
    }
  });

  const openCreateDialog = () => {
    setSelectedTemplate(null);
    setIsCreateOpen(true);
  };

  const openEditDialog = (template: AcquirerApplicationTemplate) => {
    setSelectedTemplate(template);
    setIsEditOpen(true);
  };

  const openViewDialog = (template: AcquirerApplicationTemplate) => {
    setSelectedTemplate(template);
    setIsViewOpen(true);
  };

  const openFieldConfigDialog = (template: AcquirerApplicationTemplate) => {
    setSelectedTemplate(template);
    setIsFieldConfigOpen(true);
  };

  const openTestPreview = (template: AcquirerApplicationTemplate) => {
    // Open the form in preview mode with the template ID
    const previewUrl = `/enhanced-pdf-wizard/1?preview=true&templateId=${template.id}`;
    window.open(previewUrl, '_blank');
    
    toast({
      title: 'Preview Opened',
      description: 'The application template has been opened in a new tab for testing.',
    });
  };

  const duplicateTemplate = async (template: AcquirerApplicationTemplate) => {
    const duplicateData: TemplateFormData = {
      acquirerId: template.acquirerId,
      templateName: `${template.templateName} (Copy)`,
      version: '1.0',
      isActive: false,
      fieldConfiguration: template.fieldConfiguration,
      requiredFields: template.requiredFields,
      conditionalFields: template.conditionalFields
    };
    
    try {
      await createTemplateMutation.mutateAsync(duplicateData);
    } catch (error) {
      // Error is handled in the mutation
    }
  };

  if (templatesLoading || acquirersLoading) {
    return (
      <div data-testid="page-application-templates" className="container mx-auto p-6 space-y-6">
        <div className="text-center">Loading application templates...</div>
      </div>
    );
  }

  return (
    <div data-testid="page-application-templates" className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 data-testid="text-page-title" className="text-3xl font-bold">Application Templates</h1>
          <p className="text-muted-foreground mt-2">
            Manage dynamic form templates for acquirer applications
          </p>
        </div>
        <Button 
          onClick={openCreateDialog}
          data-testid="button-create-template"
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Template
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((template) => (
          <Card key={template.id} data-testid={`card-template-${template.id}`} className="relative">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{template.templateName}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={template.isActive ? 'default' : 'secondary'}>
                    v{template.version}
                  </Badge>
                  {template.isActive && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      Active
                    </Badge>
                  )}
                </div>
              </div>
              <CardDescription>
                {template.acquirer.displayName} ({template.acquirer.code})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>Fields: {template.fieldConfiguration?.sections?.reduce((total: number, section: any) => total + section.fields.length, 0) || 0}</div>
                <div>Required: {template.requiredFields.length}</div>
                <div className="flex items-center gap-2">
                  <span>Applications: {applicationCounts[template.id] || 0}</span>
                  {(applicationCounts[template.id] || 0) > 0 && (
                    <Badge variant="outline" className="text-xs">
                      In Use
                    </Badge>
                  )}
                </div>
                <div>Created: {new Date(template.createdAt).toLocaleDateString()}</div>
              </div>
              
              <Separator className="my-4" />
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openViewDialog(template)}
                    data-testid={`button-view-template-${template.id}`}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openTestPreview(template)}
                    data-testid={`button-test-template-${template.id}`}
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    title="Test this template"
                  >
                    <FlaskConical className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(template)}
                    data-testid={`button-edit-template-${template.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => duplicateTemplate(template)}
                    data-testid={`button-duplicate-template-${template.id}`}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const applicationCount = applicationCounts[template.id] || 0;
                      if (applicationCount > 0) {
                        toast({
                          title: 'Cannot Delete Template',
                          description: `This template has ${applicationCount} application${applicationCount > 1 ? 's' : ''} and cannot be deleted. You must first remove all applications using this template.`,
                          variant: 'destructive'
                        });
                        return;
                      }
                      if (confirm(`Are you sure you want to delete the template "${template.templateName}"? This action cannot be undone.`)) {
                        deleteTemplateMutation.mutate(template.id);
                      }
                    }}
                    data-testid={`button-delete-template-${template.id}`}
                    className={`${(applicationCounts[template.id] || 0) > 0 
                      ? 'text-gray-400 hover:text-gray-500 hover:bg-gray-50 cursor-not-allowed' 
                      : 'text-red-600 hover:text-red-700 hover:bg-red-50'}`}
                    disabled={(applicationCounts[template.id] || 0) > 0}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openFieldConfigDialog(template)}
                    data-testid={`button-settings-template-${template.id}`}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {templates.length === 0 && (
        <Card data-testid="card-no-templates">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <h3 className="text-lg font-medium">No application templates</h3>
              <p className="text-muted-foreground mt-2 mb-4">
                Create your first application template to get started
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Template Dialog */}
      <CreateTemplateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        acquirers={acquirers}
        onSubmit={createTemplateMutation.mutate}
        isLoading={createTemplateMutation.isPending}
      />

      {/* Edit Template Dialog */}
      {selectedTemplate && (
        <EditTemplateDialog
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          template={selectedTemplate}
          acquirers={acquirers}
          onSubmit={(data) => updateTemplateMutation.mutate({ id: selectedTemplate.id, data })}
          isLoading={updateTemplateMutation.isPending}
        />
      )}

      {/* View Template Dialog */}
      {selectedTemplate && (
        <ViewTemplateDialog
          isOpen={isViewOpen}
          onClose={() => setIsViewOpen(false)}
          template={selectedTemplate}
        />
      )}

      {/* Field Configuration Dialog */}
      {selectedTemplate && (
        <FieldConfigurationDialog
          isOpen={isFieldConfigOpen}
          onClose={() => setIsFieldConfigOpen(false)}
          template={selectedTemplate}
          onSave={(fieldConfiguration, requiredFields, conditionalFields) => {
            updateFieldConfigMutation.mutate({
              id: selectedTemplate.id,
              fieldConfiguration,
              requiredFields,
              conditionalFields
            });
          }}
          isLoading={updateFieldConfigMutation.isPending}
        />
      )}
    </div>
  );
}

// Create Template Dialog Component
function CreateTemplateDialog({ 
  isOpen, 
  onClose, 
  acquirers, 
  onSubmit, 
  isLoading 
}: {
  isOpen: boolean;
  onClose: () => void;
  acquirers: Acquirer[];
  onSubmit: (data: TemplateFormData & { pdfFile?: File }) => void;
  isLoading: boolean;
}) {
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const { toast } = useToast();

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      acquirerId: 0,
      templateName: '',
      version: '1.0',
      isActive: true,
      fieldConfiguration: {
        sections: [
          {
            id: 'basic_info',
            title: 'Basic Information',
            description: 'Essential business information',
            fields: [
              {
                id: 'business_name',
                type: 'text',
                label: 'Business Name',
                required: true,
                placeholder: 'Enter business name'
              },
              {
                id: 'contact_email',
                type: 'email',
                label: 'Contact Email',
                required: true,
                placeholder: 'Enter email address'
              }
            ]
          }
        ]
      },
      requiredFields: ['business_name', 'contact_email']
    }
  });

  const handlePdfFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        toast({
          title: 'Invalid File Type',
          description: 'Please select a PDF file.',
          variant: 'destructive'
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        toast({
          title: 'File Too Large',
          description: 'PDF file must be less than 10MB.',
          variant: 'destructive'
        });
        return;
      }
      setSelectedPdfFile(file);
      // Auto-populate template name from filename if empty
      if (!form.getValues('templateName')) {
        const nameWithoutExtension = file.name.replace(/\.pdf$/i, '');
        form.setValue('templateName', nameWithoutExtension);
      }
    }
  };

  const handleSubmit = (data: TemplateFormData) => {
    onSubmit({ ...data, pdfFile: selectedPdfFile || undefined });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-create-template" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Application Template</DialogTitle>
          <DialogDescription>
            Create a new dynamic form template for acquirer applications
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="acquirerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Acquirer</FormLabel>
                    <Select
                      value={field.value.toString()}
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      data-testid="select-acquirer"
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select acquirer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {acquirers.map((acquirer) => (
                          <SelectItem key={acquirer.id} value={acquirer.id.toString()}>
                            {acquirer.displayName} ({acquirer.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="templateName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Standard Application"
                        data-testid="input-template-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="version"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Version</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., 1.0"
                        data-testid="input-version"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel>Active Template</FormLabel>
                      <FormDescription>
                        Enable this template for use in applications
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-is-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* PDF Upload Section */}
            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Upload className="h-5 w-5" />
                  <h3 className="font-medium">PDF Template Upload (Optional)</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Upload a PDF form to automatically generate field configuration. If no PDF is uploaded, a basic template will be created.
                </p>
                <div className="space-y-3">
                  <Input
                    type="file"
                    accept=".pdf"
                    onChange={handlePdfFileSelect}
                    data-testid="input-pdf-file"
                    className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  />
                  {selectedPdfFile && (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Selected: {selectedPdfFile.name} ({(selectedPdfFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading}
                data-testid="button-submit-create"
              >
                {isLoading ? 'Creating...' : 'Create Template'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Edit Template Dialog Component  
function EditTemplateDialog({ 
  isOpen, 
  onClose, 
  template, 
  acquirers, 
  onSubmit, 
  isLoading 
}: {
  isOpen: boolean;
  onClose: () => void;
  template: AcquirerApplicationTemplate;
  acquirers: Acquirer[];
  onSubmit: (data: TemplateFormData) => void;
  isLoading: boolean;
}) {
  // Ensure fieldConfiguration has the correct structure
  const normalizeFieldConfiguration = (config: any) => {
    if (!config || !config.sections || !Array.isArray(config.sections)) {
      return { sections: [] };
    }
    
    // Ensure each section has the required structure
    return {
      sections: config.sections.map((section: any) => ({
        id: section.id || '',
        title: section.title || '',
        description: section.description || '',
        fields: Array.isArray(section.fields) ? section.fields : []
      }))
    };
  };

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      acquirerId: template.acquirerId,
      templateName: template.templateName,
      version: template.version,
      isActive: template.isActive,
      fieldConfiguration: normalizeFieldConfiguration(template.fieldConfiguration),
      requiredFields: template.requiredFields || [],
      conditionalFields: template.conditionalFields || {}
    }
  });

  const handleSubmit = (data: TemplateFormData) => {
    onSubmit(data);
  };

  const handleInvalidSubmit = (errors: any) => {
    console.error('Form validation failed:', errors);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-edit-template" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Application Template</DialogTitle>
          <DialogDescription>
            Update the application template configuration
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="acquirerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Acquirer</FormLabel>
                    <Select
                      value={field.value.toString()}
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      data-testid="select-acquirer"
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select acquirer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {acquirers.map((acquirer) => (
                          <SelectItem key={acquirer.id} value={acquirer.id.toString()}>
                            {acquirer.displayName} ({acquirer.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="templateName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Standard Application"
                        data-testid="input-template-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="version"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Version</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., 1.0"
                        data-testid="input-version"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel>Active Template</FormLabel>
                      <FormDescription>
                        Enable this template for use in applications
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-is-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading}
                data-testid="button-submit-edit"
              >
                {isLoading ? 'Updating...' : 'Update Template'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// View Template Dialog Component
function ViewTemplateDialog({ 
  isOpen, 
  onClose, 
  template 
}: {
  isOpen: boolean;
  onClose: () => void;
  template: AcquirerApplicationTemplate;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent data-testid="dialog-view-template" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.templateName} v{template.version}</DialogTitle>
          <DialogDescription>
            {template.acquirer.displayName} ({template.acquirer.code}) application template
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Status</h4>
              <Badge variant={template.isActive ? 'default' : 'secondary'}>
                {template.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Version</h4>
              <p>{template.version}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Created</h4>
              <p>{new Date(template.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Updated</h4>
              <p>{new Date(template.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-medium mb-3">Field Configuration</h4>
            <div className="space-y-4">
              {template.fieldConfiguration?.sections?.map((section: any, index: number) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    {section.description && (
                      <CardDescription>{section.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {section.fields?.map((field: any, fieldIndex: number) => (
                        <div key={fieldIndex} className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0">
                          <div>
                            <span className="font-medium">{field.label}</span>
                            <Badge variant="outline" className="ml-2">{field.type}</Badge>
                            {field.required && (
                              <Badge variant="destructive" className="ml-1">Required</Badge>
                            )}
                          </div>
                          {field.description && (
                            <span className="text-sm text-muted-foreground">{field.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Sortable Field Component
function SortableField({
  field,
  sectionIndex,
  fieldIndex,
  requiredFields,
  onToggleRequired,
  onEdit,
  onRemove
}: {
  field: any;
  sectionIndex: number;
  fieldIndex: number;
  requiredFields: string[];
  onToggleRequired: (fieldId: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 999 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-3 border rounded-lg bg-white transition-opacity ${isDragging ? 'opacity-30' : 'opacity-100'}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="h-4 w-4 text-gray-400" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{field.label}</span>
          <Badge variant="outline">{field.type}</Badge>
          {requiredFields.includes(field.id) && (
            <Badge variant="destructive">Required</Badge>
          )}
        </div>
        {field.description && (
          <p className="text-sm text-muted-foreground mt-1">{field.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleRequired(field.id)}
          data-testid={`button-toggle-required-${sectionIndex}-${fieldIndex}`}
        >
          {requiredFields.includes(field.id) ? (
            <CheckCircle className="h-4 w-4 text-red-600" />
          ) : (
            <Circle className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          data-testid={`button-edit-field-${sectionIndex}-${fieldIndex}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-red-600 hover:text-red-700"
          data-testid={`button-remove-field-${sectionIndex}-${fieldIndex}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Sortable Section Component
function SortableSection({
  section,
  sectionIndex,
  isOpen,
  onToggleOpen,
  onUpdateTitle,
  onUpdateDescription,
  onRemove,
  onAddField,
  requiredFields,
  onToggleRequired,
  onEditField,
  onRemoveField,
  onReorderFields
}: {
  section: any;
  sectionIndex: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onUpdateTitle: (value: string) => void;
  onUpdateDescription: (value: string) => void;
  onRemove: () => void;
  onAddField: () => void;
  requiredFields: string[];
  onToggleRequired: (fieldId: string) => void;
  onEditField: (fieldIndex: number) => void;
  onRemoveField: (fieldIndex: number) => void;
  onReorderFields: (oldIndex: number, newIndex: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 0,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = section.fields.findIndex((f: any) => f.id === active.id);
      const newIndex = section.fields.findIndex((f: any) => f.id === over.id);
      onReorderFields(oldIndex, newIndex);
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Collapsible open={isOpen} onOpenChange={onToggleOpen}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start gap-2">
              <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing touch-none mt-1"
              >
                <GripVertical className="h-5 w-5 text-gray-400" />
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  value={section.title}
                  onChange={(e) => onUpdateTitle(e.target.value)}
                  className="font-medium"
                  placeholder="Section title"
                  data-testid={`input-section-title-${sectionIndex}`}
                  onClick={(e) => e.stopPropagation()}
                />
                <Textarea
                  value={section.description}
                  onChange={(e) => onUpdateDescription(e.target.value)}
                  placeholder="Section description (optional)"
                  data-testid={`input-section-description-${sectionIndex}`}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-toggle-section-${sectionIndex}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  className="text-red-600 hover:text-red-700"
                  data-testid={`button-remove-section-${sectionIndex}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Fields ({section.fields?.length || 0})</h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddField}
                    data-testid={`button-add-field-${sectionIndex}`}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Field
                  </Button>
                </div>

                {section.fields && section.fields.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={section.fields.map((f: any) => f.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {section.fields.map((field: any, fieldIndex: number) => (
                          <SortableField
                            key={field.id}
                            field={field}
                            sectionIndex={sectionIndex}
                            fieldIndex={fieldIndex}
                            requiredFields={requiredFields}
                            onToggleRequired={onToggleRequired}
                            onEdit={() => onEditField(fieldIndex)}
                            onRemove={() => onRemoveField(fieldIndex)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No fields in this section. Click "Add Field" to get started.
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

// Field Configuration Dialog Component
function FieldConfigurationDialog({
  isOpen,
  onClose,
  template,
  onSave,
  isLoading
}: {
  isOpen: boolean;
  onClose: () => void;
  template: AcquirerApplicationTemplate;
  onSave: (fieldConfiguration: any, requiredFields: string[], conditionalFields: Record<string, any>) => void;
  isLoading: boolean;
}) {
  // Normalize sections to ensure all fields have unique, stable IDs
  const normalizeFieldIds = (sectionsData: any[]) => {
    const seenIds = new Set<string>();
    return sectionsData.map((section: any) => ({
      ...section,
      fields: (section.fields || []).map((field: any) => {
        // If field has no ID or ID is duplicate, generate a new unique one
        let fieldId = field.id;
        if (!fieldId || seenIds.has(fieldId)) {
          fieldId = `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        seenIds.add(fieldId);
        return {
          ...field,
          id: fieldId
        };
      })
    }));
  };

  const [sections, setSections] = useState(() => 
    normalizeFieldIds(template.fieldConfiguration?.sections || [])
  );
  const [requiredFields, setRequiredFields] = useState<string[]>(template.requiredFields || []);
  const [editingField, setEditingField] = useState<any>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number>(-1);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number>(-1);
  const [openSections, setOpenSections] = useState<Set<string>>(() => 
    new Set(normalizeFieldIds(template.fieldConfiguration?.sections || []).map((s: any) => s.id))
  );

  // Re-normalize when template changes
  useEffect(() => {
    const normalized = normalizeFieldIds(template.fieldConfiguration?.sections || []);
    setSections(normalized);
    setOpenSections(new Set(normalized.map((s: any) => s.id)));
  }, [template.id]);

  const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'email', label: 'Email' },
    { value: 'tel', label: 'Phone' },
    { value: 'url', label: 'URL' },
    { value: 'date', label: 'Date' },
    { value: 'number', label: 'Number' },
    { value: 'percentage', label: 'Percentage' },
    { value: 'ssn', label: 'SSN (Social Security Number)' },
    { value: 'select', label: 'Select' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'boolean', label: 'Boolean (Yes/No)' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'radio', label: 'Radio' },
    { value: 'currency', label: 'Currency' },
    { value: 'zipcode', label: 'US Zip Code' },
    { value: 'phone', label: 'Phone (Formatted)' },
    { value: 'ein', label: 'EIN/Tax ID' },
    { value: 'address', label: 'Address (Google Autocomplete)' }
  ];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 0,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const toggleSection = (sectionId: string) => {
    const newOpenSections = new Set(openSections);
    if (newOpenSections.has(sectionId)) {
      newOpenSections.delete(sectionId);
    } else {
      newOpenSections.add(sectionId);
    }
    setOpenSections(newOpenSections);
  };

  const addSection = () => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: 'New Section',
      description: '',
      fields: []
    };
    setSections([...sections, newSection]);
    setOpenSections(new Set([...Array.from(openSections), newSection.id]));
  };

  const removeSection = (index: number) => {
    if (confirm('Are you sure you want to remove this section and all its fields?')) {
      const newSections = sections.filter((_: any, i: number) => i !== index);
      setSections(newSections);
    }
  };

  const addField = (sectionIndex: number) => {
    const newField = {
      id: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field',
      required: false,
      placeholder: '',
      description: ''
    };
    
    // Create deep copy to avoid mutation
    const newSections = sections.map((section: any, idx: number) => {
      if (idx === sectionIndex) {
        return {
          ...section,
          fields: [...section.fields, newField]
        };
      }
      return section;
    });
    setSections(newSections);
  };

  const removeField = (sectionIndex: number, fieldIndex: number) => {
    if (confirm('Are you sure you want to remove this field?')) {
      const fieldId = sections[sectionIndex].fields[fieldIndex].id;
      
      // Remove from required fields if present
      setRequiredFields(requiredFields.filter(id => id !== fieldId));
      
      // Create deep copy to avoid mutation
      const newSections = sections.map((section: any, idx: number) => {
        if (idx === sectionIndex) {
          return {
            ...section,
            fields: section.fields.filter((_: any, fIdx: number) => fIdx !== fieldIndex)
          };
        }
        return section;
      });
      setSections(newSections);
    }
  };

  const reorderFields = (sectionIndex: number, oldIndex: number, newIndex: number) => {
    // Create deep copy to avoid mutation
    const newSections = sections.map((section: any, idx: number) => {
      if (idx === sectionIndex) {
        return {
          ...section,
          fields: arrayMove([...section.fields], oldIndex, newIndex)
        };
      }
      return section;
    });
    setSections(newSections);
  };

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((s: any) => s.id === active.id);
      const newIndex = sections.findIndex((s: any) => s.id === over.id);
      setSections(arrayMove(sections, oldIndex, newIndex));
    }
  };

  const openFieldEditor = (sectionIndex: number, fieldIndex: number) => {
    setEditingSectionIndex(sectionIndex);
    setEditingFieldIndex(fieldIndex);
    setEditingField({ ...sections[sectionIndex].fields[fieldIndex] });
  };

  const saveFieldEdit = () => {
    if (editingSectionIndex >= 0 && editingFieldIndex >= 0 && editingField) {
      // Create deep copy to avoid mutation
      const newSections = sections.map((section: any, idx: number) => {
        if (idx === editingSectionIndex) {
          return {
            ...section,
            fields: section.fields.map((field: any, fIdx: number) => 
              fIdx === editingFieldIndex ? { ...editingField } : field
            )
          };
        }
        return section;
      });
      setSections(newSections);
      setEditingField(null);
      setEditingSectionIndex(-1);
      setEditingFieldIndex(-1);
    }
  };

  const toggleRequiredField = (fieldId: string) => {
    if (requiredFields.includes(fieldId)) {
      setRequiredFields(requiredFields.filter(id => id !== fieldId));
    } else {
      setRequiredFields([...requiredFields, fieldId]);
    }
  };

  const handleSave = () => {
    const fieldConfiguration = { sections };
    
    // Extract conditional rules from fields
    const conditionalFields: Record<string, any> = {};
    sections.forEach((section: any) => {
      section.fields.forEach((field: any) => {
        if (field.conditional) {
          conditionalFields[field.id] = field.conditional;
        }
      });
    });
    
    onSave(fieldConfiguration, requiredFields, conditionalFields);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Form Fields - {template.templateName}</DialogTitle>
          <DialogDescription>
            Design the application form structure that prospects will fill out
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Sections List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Form Sections</h3>
              <Button type="button" onClick={addSection} data-testid="button-add-section">
                <Plus className="h-4 w-4 mr-2" />
                Add Section
              </Button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSectionDragEnd}
            >
              <SortableContext
                items={sections.map((s: any) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((section: any, sectionIndex: number) => (
                  <SortableSection
                    key={section.id}
                    section={section}
                    sectionIndex={sectionIndex}
                    isOpen={openSections.has(section.id)}
                    onToggleOpen={() => toggleSection(section.id)}
                    onUpdateTitle={(value) => {
                      const newSections = [...sections];
                      newSections[sectionIndex].title = value;
                      setSections(newSections);
                    }}
                    onUpdateDescription={(value) => {
                      const newSections = [...sections];
                      newSections[sectionIndex].description = value;
                      setSections(newSections);
                    }}
                    onRemove={() => removeSection(sectionIndex)}
                    onAddField={() => addField(sectionIndex)}
                    requiredFields={requiredFields}
                    onToggleRequired={toggleRequiredField}
                    onEditField={(fieldIndex) => openFieldEditor(sectionIndex, fieldIndex)}
                    onRemoveField={(fieldIndex) => removeField(sectionIndex, fieldIndex)}
                    onReorderFields={(oldIndex, newIndex) => reorderFields(sectionIndex, oldIndex, newIndex)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {sections.length === 0 && (
              <Card>
                <CardContent className="text-center py-12">
                  <h3 className="font-medium mb-2">No sections defined</h3>
                  <p className="text-muted-foreground mb-4">
                    Create sections to organize your form fields
                  </p>
                  <Button type="button" onClick={addSection}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Section
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading} data-testid="button-save-field-config">
              {isLoading ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </div>

        {/* Field Editor Dialog */}
        {editingField && (
          <Dialog open={!!editingField} onOpenChange={() => setEditingField(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Field</DialogTitle>
                <DialogDescription>
                  Configure the field properties
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Field Label</label>
                  <Input
                    value={editingField.label}
                    onChange={(e) => setEditingField({ ...editingField, label: e.target.value })}
                    placeholder="Enter field label"
                    data-testid="input-edit-field-label"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Field Type</label>
                  <Select
                    value={editingField.type}
                    onValueChange={(value) => setEditingField({ ...editingField, type: value })}
                  >
                    <SelectTrigger data-testid="select-edit-field-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Placeholder Text</label>
                  <Input
                    value={editingField.placeholder || ''}
                    onChange={(e) => setEditingField({ ...editingField, placeholder: e.target.value })}
                    placeholder="Enter placeholder text"
                    data-testid="input-edit-field-placeholder"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={editingField.description || ''}
                    onChange={(e) => setEditingField({ ...editingField, description: e.target.value })}
                    placeholder="Field description or help text"
                    data-testid="textarea-edit-field-description"
                  />
                </div>

                {/* Conditional Visibility Section */}
                <div className="border-t pt-4">
                  <label className="text-sm font-medium mb-2 block">Conditional Visibility</label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Show this field only when certain conditions are met
                  </p>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!!editingField.conditional}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setEditingField({
                              ...editingField,
                              conditional: {
                                action: 'show',
                                when: {
                                  field: '',
                                  operator: 'equals',
                                  value: ''
                                }
                              }
                            });
                          } else {
                            const { conditional, ...rest } = editingField;
                            setEditingField(rest);
                          }
                        }}
                        data-testid="switch-conditional-visibility"
                      />
                      <span className="text-sm">Enable conditional visibility</span>
                    </div>

                    {editingField.conditional && (
                      <div className="ml-6 space-y-3 p-3 bg-muted/50 rounded-md">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Action</label>
                            <Select
                              value={editingField.conditional.action}
                              onValueChange={(value) => setEditingField({
                                ...editingField,
                                conditional: { ...editingField.conditional, action: value }
                              })}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="show">Show</SelectItem>
                                <SelectItem value="hide">Hide</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div>
                          <label className="text-xs text-muted-foreground">When Field</label>
                          <Select
                            value={editingField.conditional.when?.field || ''}
                            onValueChange={(value) => setEditingField({
                              ...editingField,
                              conditional: {
                                ...editingField.conditional,
                                when: { ...editingField.conditional.when, field: value }
                              }
                            })}
                          >
                            <SelectTrigger className="h-8" data-testid="select-conditional-field">
                              <SelectValue placeholder="Select field..." />
                            </SelectTrigger>
                            <SelectContent>
                              {sections.flatMap((section: any) => 
                                section.fields
                                  .filter((f: any) => f.id !== editingField.id)
                                  .map((field: any) => (
                                    <SelectItem key={field.id} value={field.id}>
                                      {field.label} ({section.title})
                                    </SelectItem>
                                  ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Operator</label>
                            <Select
                              value={editingField.conditional.when?.operator || 'equals'}
                              onValueChange={(value) => setEditingField({
                                ...editingField,
                                conditional: {
                                  ...editingField.conditional,
                                  when: { ...editingField.conditional.when, operator: value }
                                }
                              })}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="not_equals">Not Equals</SelectItem>
                                <SelectItem value="contains">Contains</SelectItem>
                                <SelectItem value="is_checked">Is Checked</SelectItem>
                                <SelectItem value="is_not_checked">Is Not Checked</SelectItem>
                                <SelectItem value="is_not_empty">Is Not Empty (Has Value)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <label className="text-xs text-muted-foreground">Value</label>
                            <Input
                              value={editingField.conditional.when?.value || ''}
                              onChange={(e) => setEditingField({
                                ...editingField,
                                conditional: {
                                  ...editingField.conditional,
                                  when: { ...editingField.conditional.when, value: e.target.value }
                                }
                              })}
                              placeholder="Enter value..."
                              className="h-8"
                              data-testid="input-conditional-value"
                            />
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground bg-background p-2 rounded border">
                          <strong>Preview:</strong> {editingField.conditional.action === 'show' ? 'Show' : 'Hide'} this field when{' '}
                          <strong>{editingField.conditional.when?.field ? 
                            sections.flatMap((s: any) => s.fields).find((f: any) => f.id === editingField.conditional.when?.field)?.label || editingField.conditional.when?.field
                            : '(select field)'}</strong>{' '}
                          {editingField.conditional.when?.operator === 'equals' && 'equals'}
                          {editingField.conditional.when?.operator === 'not_equals' && 'does not equal'}
                          {editingField.conditional.when?.operator === 'contains' && 'contains'}
                          {editingField.conditional.when?.operator === 'is_checked' && 'is checked'}
                          {editingField.conditional.when?.operator === 'is_not_checked' && 'is not checked'}
                          {editingField.conditional.when?.operator === 'is_not_empty' && 'is not empty (has any value)'}
                          {editingField.conditional.when?.operator !== 'is_not_empty' && <>{' '}<strong>"{editingField.conditional.when?.value || '(enter value)'}"</strong></>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Show options for select, radio, checkbox, boolean fields */}
                {(editingField.type === 'select' || editingField.type === 'radio' || editingField.type === 'checkbox' || editingField.type === 'boolean') && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Options</label>
                    <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3">
                      {editingField.options && Array.isArray(editingField.options) && editingField.options.length > 0 ? (
                        editingField.options.map((option: any, index: number) => {
                          // Check if option is structured (object) or simple (string)
                          const isStructured = typeof option === 'object' && option !== null;
                          const optionLabel = isStructured ? option.label : option;
                          const optionValue = isStructured ? option.value : option.toLowerCase().replace(/\s+/g, '_');
                          const pdfFieldId = isStructured ? option.pdfFieldId : undefined;
                          
                          const optionConditional = isStructured ? option.conditional : undefined;
                          
                          return (
                            <div key={index} className="p-3 bg-muted/50 rounded border border-border">
                              <div className="grid grid-cols-2 gap-2 items-center mb-2">
                                <div>
                                  <label className="text-xs text-muted-foreground">Label</label>
                                  <Input
                                    value={optionLabel}
                                    onChange={(e) => {
                                      const newOptions = [...editingField.options];
                                      if (isStructured) {
                                        newOptions[index] = { ...option, label: e.target.value };
                                      } else {
                                        newOptions[index] = e.target.value;
                                      }
                                      setEditingField({ ...editingField, options: newOptions });
                                    }}
                                    className="h-8"
                                    data-testid={`input-option-label-${index}`}
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Value</label>
                                  <Input
                                    value={optionValue}
                                    onChange={(e) => {
                                      const newOptions = [...editingField.options];
                                      if (isStructured) {
                                        newOptions[index] = { ...option, value: e.target.value };
                                      } else {
                                        newOptions[index] = e.target.value;
                                      }
                                      setEditingField({ ...editingField, options: newOptions });
                                    }}
                                    className="h-8"
                                    data-testid={`input-option-value-${index}`}
                                  />
                                </div>
                                {pdfFieldId && (
                                  <div className="col-span-2">
                                    <label className="text-xs text-muted-foreground">PDF Field ID (read-only)</label>
                                    <Input
                                      value={pdfFieldId}
                                      disabled
                                      className="h-7 text-xs bg-muted"
                                      title="PDF field binding - cannot be modified"
                                    />
                                  </div>
                                )}
                              </div>
                              
                              {/* Per-option conditional trigger */}
                              <div className="mt-2 pt-2 border-t border-border/50">
                                <div className="flex items-center gap-2 mb-2">
                                  <Switch
                                    checked={!!optionConditional}
                                    onCheckedChange={(checked) => {
                                      const newOptions = [...editingField.options];
                                      if (checked) {
                                        newOptions[index] = {
                                          ...option,
                                          conditional: {
                                            action: 'show',
                                            targetField: '',
                                          }
                                        };
                                      } else {
                                        const { conditional, ...rest } = option;
                                        newOptions[index] = rest;
                                      }
                                      setEditingField({ ...editingField, options: newOptions });
                                    }}
                                    data-testid={`switch-option-conditional-${index}`}
                                  />
                                  <span className="text-xs text-muted-foreground">Trigger field when selected</span>
                                </div>
                                
                                {optionConditional && (
                                  <div className="ml-6 space-y-2 p-2 bg-background rounded">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-xs text-muted-foreground">Action</label>
                                        <Select
                                          value={optionConditional.action}
                                          onValueChange={(value) => {
                                            const newOptions = [...editingField.options];
                                            newOptions[index] = {
                                              ...option,
                                              conditional: { ...optionConditional, action: value }
                                            };
                                            setEditingField({ ...editingField, options: newOptions });
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="show">Show</SelectItem>
                                            <SelectItem value="hide">Hide</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <label className="text-xs text-muted-foreground">Target Field</label>
                                        <Select
                                          value={optionConditional.targetField || ''}
                                          onValueChange={(value) => {
                                            const newOptions = [...editingField.options];
                                            newOptions[index] = {
                                              ...option,
                                              conditional: { ...optionConditional, targetField: value }
                                            };
                                            setEditingField({ ...editingField, options: newOptions });
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs">
                                            <SelectValue placeholder="Select field" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {sections.flatMap((s: any) => 
                                              s.fields
                                                .filter((f: any) => f.id !== editingField.id)
                                                .map((f: any) => (
                                                  <SelectItem key={f.id} value={f.id}>
                                                    {f.label} ({s.title})
                                                  </SelectItem>
                                                ))
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground bg-muted/50 p-1 rounded">
                                      {optionConditional.action === 'show' ? 'Show' : 'Hide'}{' '}
                                      <strong>
                                        {optionConditional.targetField ? 
                                          sections.flatMap((s: any) => s.fields).find((f: any) => f.id === optionConditional.targetField)?.label || optionConditional.targetField
                                          : '(select field)'}
                                      </strong>{' '}
                                      when this option is selected
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          No options defined
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const currentOptions = editingField.options || [];
                        // Always use structured format for consistency
                        const isStructured = currentOptions.length === 0 || typeof currentOptions[0] === 'object';
                        const newOptions = [...currentOptions];
                        
                        if (isStructured) {
                          newOptions.push({ label: '', value: '', pdfFieldId: '' });
                        } else {
                          // Convert old string format to structured format
                          newOptions.push('');
                        }
                        setEditingField({ ...editingField, options: newOptions });
                      }}
                      className="mt-2"
                      data-testid="button-add-option"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Option
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingField(null)}>
                  Cancel
                </Button>
                <Button onClick={saveFieldEdit} data-testid="button-save-field-edit">
                  Save Field
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}