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
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WysiwygEditor } from '@/components/WysiwygEditor';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Eye, Copy, Download, Upload, Trash2, Settings, Circle, CheckCircle, ChevronDown, ChevronRight, GripVertical, FlaskConical, HelpCircle, Map, Link2, AlertTriangle, BookOpen, FileText, Hash, Type, Mail, Phone, Calendar, DollarSign, Percent, MapPin, PenTool, Users, Building, CreditCard, ToggleLeft, ListChecks, AlignLeft, Globe, Lock, Fingerprint, Navigation, RefreshCw } from 'lucide-react';
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
        type: z.enum(['text', 'email', 'tel', 'url', 'date', 'number', 'select', 'checkbox', 'textarea', 'radio', 'currency', 'zipcode', 'phone', 'ein', 'address', 'user_account']),
        label: z.string(),
        required: z.boolean().optional(),
        pattern: z.string().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        options: z.array(z.union([
          z.string(),
          z.object({
            label: z.string(),
            value: z.string(),
            pdfFieldId: z.string().optional(),
            conditional: z.object({
              action: z.enum(['show', 'hide']),
              targetField: z.string()
            }).optional()
          })
        ])).optional(),
        sensitive: z.boolean().optional(),
        placeholder: z.string().optional(),
        description: z.string().optional(),
        validation: z.any().optional()
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
  const [isDocumentationOpen, setIsDocumentationOpen] = useState(false);
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
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
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
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={() => setIsDocumentationOpen(true)}
            data-testid="button-documentation"
            className="flex items-center gap-2"
          >
            <BookOpen className="h-4 w-4" />
            PDF Field Guide
          </Button>
          <Button 
            onClick={openCreateDialog}
            data-testid="button-create-template"
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Template
          </Button>
        </div>
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

      {/* PDF Field Naming Documentation Dialog */}
      <PdfFieldNamingDocumentation
        isOpen={isDocumentationOpen}
        onClose={() => setIsDocumentationOpen(false)}
      />
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

// Sortable Option Item Wrapper Component for reordering options in field editor
function SortableOptionItemWrapper({
  id,
  index,
  option,
  optionLabel,
  optionValue,
  pdfFieldId,
  optionConditional,
  isStructured,
  onRemove,
  onUpdateLabel,
  onUpdateValue,
  onMoveUp,
  onMoveDown,
  onUpdateConditional,
  isFirst,
  isLast,
  sections,
  editingFieldId
}: {
  id: string;
  index: number;
  option: any;
  optionLabel: string;
  optionValue: string;
  pdfFieldId: string | undefined;
  optionConditional: any;
  isStructured: boolean;
  onRemove: () => void;
  onUpdateLabel: (value: string) => void;
  onUpdateValue: (value: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdateConditional: (conditional: any) => void;
  isFirst: boolean;
  isLast: boolean;
  sections: any[];
  editingFieldId: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="p-3 bg-muted/50 rounded border border-border">
      <div className="flex items-center gap-2 mb-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:cursor-grabbing p-1 hover:bg-muted rounded"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={isFirst}
            className="h-4 w-4 p-0"
            title="Move up"
          >
            <ChevronDown className="h-3 w-3 rotate-180" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveDown}
            disabled={isLast}
            className="h-4 w-4 p-0"
            title="Move down"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          data-testid={`button-delete-option-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 items-center mb-2">
        <div>
          <label className="text-xs text-muted-foreground">Label</label>
          <Input
            value={optionLabel}
            onChange={(e) => onUpdateLabel(e.target.value)}
            className="h-8"
            data-testid={`input-option-label-${index}`}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Value</label>
          <Input
            value={optionValue}
            onChange={(e) => onUpdateValue(e.target.value)}
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
              if (checked) {
                onUpdateConditional({ action: 'show', targetField: '' });
              } else {
                onUpdateConditional(null);
              }
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
                    onUpdateConditional({ ...optionConditional, action: value });
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
                    onUpdateConditional({ ...optionConditional, targetField: value });
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.flatMap((s: any) => 
                      s.fields
                        .filter((f: any) => f.id !== editingFieldId)
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
  const [linkedFieldSearch, setLinkedFieldSearch] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(() => 
    new Set(normalizeFieldIds(template.fieldConfiguration?.sections || []).map((s: any) => s.id))
  );

  // Fetch disclosures from the disclosure library for the picker
  const { data: disclosuresData } = useQuery<{ success: boolean; disclosures: Array<{ id: number; slug: string; displayName: string; isActive: boolean; currentVersion?: { id: number; version: string; title: string } }> }>({
    queryKey: ['/api/disclosures'],
    staleTime: 60000,
  });
  const availableDisclosures = disclosuresData?.disclosures?.filter(d => d.isActive) || [];

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
    { value: 'checkbox-list', label: 'Checkbox List (Multiple Selection)' },
    { value: 'boolean', label: 'Boolean (Yes/No)' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'radio', label: 'Radio' },
    { value: 'currency', label: 'Currency' },
    { value: 'zipcode', label: 'US Zip Code' },
    { value: 'phone', label: 'Phone (Formatted)' },
    { value: 'ein', label: 'EIN/Tax ID' },
    { value: 'address', label: 'Address (Google Autocomplete)' },
    { value: 'mcc-select', label: 'MCC Code (Business Category)' },
    { value: 'user_account', label: 'User Account (Auto-create)' },
    { value: 'signature', label: 'Signature (Digital Capture)' },
    { value: 'bank_routing', label: 'Bank Routing Number (Masked)' },
    { value: 'bank_account', label: 'Bank Account Number (Masked)' },
    { value: 'disclosure', label: 'Disclosure (Scrollable with Signature)' },
    { value: 'owner_group', label: 'Owner Group (Beneficial Owners & Control Persons)' }
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
    setLinkedFieldSearch(''); // Reset search when opening editor
    
    const field = { ...sections[sectionIndex].fields[fieldIndex] };
    
    // Hydrate user account config from validation field if this is a user_account field
    if (field.type === 'user_account' && field.validation) {
      try {
        const validationObj = typeof field.validation === 'string' 
          ? JSON.parse(field.validation) 
          : field.validation;
        
        if (validationObj.userAccount) {
          field.userAccountConfig = validationObj.userAccount;
        }
      } catch (e) {
        console.error('Failed to parse user account config:', e);
      }
    }
    
    // Normalize options to ensure stable _sortId for drag-and-drop reordering
    if (field.options && Array.isArray(field.options)) {
      field.options = field.options.map((opt: any) => {
        if (typeof opt === 'object' && opt !== null) {
          if (!opt._sortId) {
            return { ...opt, _sortId: crypto.randomUUID() };
          }
          return opt;
        }
        // Convert string options to structured format with _sortId
        return { 
          label: opt, 
          value: String(opt).toLowerCase().replace(/\s+/g, '_'), 
          _sortId: crypto.randomUUID() 
        };
      });
    }
    
    setEditingField(field);
  };

  const saveFieldEdit = () => {
    if (editingSectionIndex >= 0 && editingFieldIndex >= 0 && editingField) {
      // Serialize user account config into validation field before saving
      const fieldToSave = { ...editingField };
      if (fieldToSave.type === 'user_account' && fieldToSave.userAccountConfig) {
        // Parse existing validation if it's a string, or use as object
        let validationObj = {};
        if (typeof fieldToSave.validation === 'string') {
          try {
            validationObj = JSON.parse(fieldToSave.validation);
          } catch (e) {
            validationObj = {};
          }
        } else if (fieldToSave.validation && typeof fieldToSave.validation === 'object') {
          validationObj = fieldToSave.validation;
        }
        
        // Merge user account config into validation
        fieldToSave.validation = JSON.stringify({
          ...validationObj,
          userAccount: fieldToSave.userAccountConfig
        });
        
        // Remove transient UI-only property
        delete fieldToSave.userAccountConfig;
      }
      
      // Strip _sortId from options before saving (UI-only property for drag-and-drop)
      if (fieldToSave.options && Array.isArray(fieldToSave.options)) {
        fieldToSave.options = fieldToSave.options.map((opt: any) => {
          if (typeof opt === 'object' && opt !== null) {
            const { _sortId, ...rest } = opt;
            return rest;
          }
          return opt;
        });
      }
      
      // Create deep copy to avoid mutation
      const newSections = sections.map((section: any, idx: number) => {
        if (idx === editingSectionIndex) {
          return {
            ...section,
            fields: section.fields.map((field: any, fIdx: number) => 
              fIdx === editingFieldIndex ? fieldToSave : field
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
    
    // Extract conditional rules from fields using fieldName as the key
    // This matches how enhanced-pdf-wizard.tsx evaluates conditionals using field.fieldName
    const conditionalFields: Record<string, any> = {};
    sections.forEach((section: any) => {
      section.fields.forEach((field: any) => {
        if (field.conditional && field.id) {
          // Use fieldName (the field's id) as the key for conditional lookup
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

        <Tabs defaultValue="design" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="design" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Form Design
            </TabsTrigger>
            <TabsTrigger value="mappings" className="flex items-center gap-2" data-testid="tab-field-mappings">
              <Link2 className="h-4 w-4" />
              Field Mappings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="design" className="space-y-6">
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
          </TabsContent>

          <TabsContent value="mappings" className="space-y-6">
            <FieldMappingsVisualization sections={sections} templateName={template.templateName} />
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading} data-testid="button-save-field-config">
            {isLoading ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>

        {/* Field Editor Dialog */}
        {editingField && (
          <Dialog open={!!editingField} onOpenChange={() => setEditingField(null)}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
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

                {/* Custom Validation Text */}
                <div>
                  <label className="text-sm font-medium">Custom Validation Message</label>
                  <Input
                    value={editingField.validationText || ''}
                    onChange={(e) => setEditingField({ ...editingField, validationText: e.target.value })}
                    placeholder="e.g., Please enter a valid business name"
                    data-testid="input-edit-field-validation-text"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Custom error message shown when this field fails validation. Leave empty to use the default message.
                  </p>
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

                        {/* Required When Visible Option */}
                        {editingField.conditional.action === 'show' && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={!!editingField.conditional.requiredWhenVisible}
                                onCheckedChange={(checked) => {
                                  setEditingField({
                                    ...editingField,
                                    conditional: {
                                      ...editingField.conditional,
                                      requiredWhenVisible: checked
                                    }
                                  });
                                }}
                                data-testid="switch-required-when-visible"
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium">Required When Visible</span>
                                <p className="text-xs text-muted-foreground">
                                  Make this field required when it's shown by the condition
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Show options for select, radio, checkbox, checkbox-list, boolean fields */}
                {(editingField.type === 'select' || editingField.type === 'radio' || editingField.type === 'checkbox' || editingField.type === 'checkbox-list' || editingField.type === 'boolean') && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Options</label>
                    <p className="text-xs text-muted-foreground mb-2">Drag options to reorder, or use the arrow buttons</p>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event: DragEndEvent) => {
                        const { active, over } = event;
                        if (over && active.id !== over.id) {
                          const options = editingField.options || [];
                          const oldIndex = options.findIndex((opt: any) => opt._sortId === active.id);
                          const newIndex = options.findIndex((opt: any) => opt._sortId === over.id);
                          if (oldIndex !== -1 && newIndex !== -1) {
                            const newOptions = arrayMove(options, oldIndex, newIndex);
                            setEditingField({ ...editingField, options: newOptions });
                          }
                        }
                      }}
                    >
                      <SortableContext
                        items={(editingField.options || []).map((opt: any) => opt._sortId)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3">
                          {editingField.options && editingField.options.length > 0 ? (
                            editingField.options.map((option: any, index: number) => {
                              return (
                                <SortableOptionItemWrapper
                                  key={option._sortId}
                                  id={option._sortId}
                                  index={index}
                                  option={option}
                                  optionLabel={option.label || ''}
                                  optionValue={option.value || ''}
                                  pdfFieldId={option.pdfFieldId}
                                  optionConditional={option.conditional}
                                  isStructured={true}
                                  isFirst={index === 0}
                                  isLast={index === editingField.options.length - 1}
                                  onRemove={() => {
                                    const newOptions = editingField.options.filter((opt: any) => opt._sortId !== option._sortId);
                                    setEditingField({ ...editingField, options: newOptions });
                                  }}
                                  onUpdateLabel={(value: string) => {
                                    const newOptions = [...editingField.options];
                                    newOptions[index] = { ...option, label: value };
                                    setEditingField({ ...editingField, options: newOptions });
                                  }}
                                  onUpdateValue={(value: string) => {
                                    const newOptions = [...editingField.options];
                                    newOptions[index] = { ...option, value: value };
                                    setEditingField({ ...editingField, options: newOptions });
                                  }}
                                  onMoveUp={() => {
                                    if (index > 0) {
                                      const newOptions = arrayMove(editingField.options, index, index - 1);
                                      setEditingField({ ...editingField, options: newOptions });
                                    }
                                  }}
                                  onMoveDown={() => {
                                    if (index < editingField.options.length - 1) {
                                      const newOptions = arrayMove(editingField.options, index, index + 1);
                                      setEditingField({ ...editingField, options: newOptions });
                                    }
                                  }}
                                  onUpdateConditional={(conditional: any) => {
                                    const newOptions = [...editingField.options];
                                    if (conditional === null) {
                                      const { conditional: _, ...rest } = option;
                                      newOptions[index] = rest;
                                    } else {
                                      newOptions[index] = { ...option, conditional };
                                    }
                                    setEditingField({ ...editingField, options: newOptions });
                                  }}
                                  sections={sections}
                                  editingFieldId={editingField.id}
                                />
                              );
                            })
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-2">
                              No options defined
                            </p>
                          )}
                        </div>
                      </SortableContext>
                    </DndContext>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const currentOptions = editingField.options || [];
                        const newOptions = [...currentOptions];
                        // Always add as structured option with stable _sortId for drag-and-drop
                        newOptions.push({ label: '', value: '', pdfFieldId: '', _sortId: crypto.randomUUID() });
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

                {/* Layout selector for checkbox-list and radio fields */}
                {(editingField.type === 'checkbox-list' || editingField.type === 'radio') && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Layout</label>
                    <Select
                      value={editingField.layout || 'horizontal'}
                      onValueChange={(value) => setEditingField({ ...editingField, layout: value })}
                    >
                      <SelectTrigger data-testid="select-checkbox-list-layout">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="horizontal">Horizontal (Grid - multiple per row)</SelectItem>
                        <SelectItem value="vertical">Vertical (Stacked - one per row)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Horizontal displays options in a responsive grid. Vertical stacks them one per row.
                    </p>
                  </div>
                )}

                {/* Date Field Configuration */}
                {editingField.type === 'date' && (
                  <div className="space-y-4 border rounded-lg p-4 bg-blue-50/50">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-blue-600" />
                      <label className="text-sm font-medium">Date Field Configuration</label>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={editingField.allowFutureDates !== false}
                          onCheckedChange={(checked) => setEditingField({ 
                            ...editingField, 
                            allowFutureDates: checked 
                          })}
                          data-testid="switch-allow-future-dates"
                        />
                        <div>
                          <span className="text-sm font-medium">Allow Future Dates</span>
                          <p className="text-xs text-muted-foreground">
                            When disabled, dates after today will show a validation error
                          </p>
                        </div>
                      </div>
                      
                      {editingField.allowFutureDates === false && (
                        <div>
                          <label className="text-sm font-medium mb-1 block">Future Date Error Message</label>
                          <Input
                            value={editingField.futureDateErrorMessage || ''}
                            onChange={(e) => setEditingField({ 
                              ...editingField, 
                              futureDateErrorMessage: e.target.value 
                            })}
                            placeholder="e.g., Date cannot be in the future"
                            data-testid="input-future-date-error-message"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Custom error message when a future date is entered. Leave empty for default.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Currency Field Configuration */}
                {editingField.type === 'currency' && (
                  <div className="space-y-4 border rounded-lg p-4 bg-green-50/50">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-green-600" />
                      <label className="text-sm font-medium">Currency Field Configuration</label>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={editingField.allowNegativeValues !== false}
                          onCheckedChange={(checked) => setEditingField({ 
                            ...editingField, 
                            allowNegativeValues: checked 
                          })}
                          data-testid="switch-allow-negative-values"
                        />
                        <div>
                          <span className="text-sm font-medium">Allow Negative Values</span>
                          <p className="text-xs text-muted-foreground">
                            When disabled, negative amounts will show a validation error
                          </p>
                        </div>
                      </div>
                      
                      {editingField.allowNegativeValues === false && (
                        <div>
                          <label className="text-sm font-medium mb-1 block">Negative Value Error Message</label>
                          <Input
                            value={editingField.negativeValueErrorMessage || ''}
                            onChange={(e) => setEditingField({ 
                              ...editingField, 
                              negativeValueErrorMessage: e.target.value 
                            })}
                            placeholder="e.g., Amount cannot be negative"
                            data-testid="input-negative-value-error-message"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Custom error message when a negative value is entered. Leave empty for default.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* User Account Field Configuration */}
                {editingField.type === 'user_account' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-sm font-medium">User Account Configuration</label>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 gap-1"
                            data-testid="button-user-account-help"
                          >
                            <HelpCircle className="h-4 w-4" />
                            <span className="text-xs">Help</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>User Account Field Configuration Guide</DialogTitle>
                            <DialogDescription>
                              Understand how to configure automatic user account creation for your application templates.
                            </DialogDescription>
                          </DialogHeader>
                          
                          <div className="space-y-6 py-4">
                            {/* Overview */}
                            <div>
                              <h3 className="font-semibold text-sm mb-2">Overview</h3>
                              <p className="text-sm text-muted-foreground">
                                The User Account field automatically creates user accounts when someone submits your application form. 
                                You can configure it for full automation, semi-automation, or manual user input.
                              </p>
                            </div>

                            <Separator />

                            {/* Username Generation */}
                            <div>
                              <h3 className="font-semibold text-sm mb-2">Username Generation</h3>
                              <div className="space-y-3">
                                <div className="pl-3 border-l-2 border-green-500">
                                  <p className="text-sm font-medium">From Email Address</p>
                                  <p className="text-xs text-muted-foreground">Auto-generates username from email prefix (before @)</p>
                                  <p className="text-xs text-muted-foreground mt-1">Example: john.doe@example.com → username: john.doe</p>
                                </div>
                                <div className="pl-3 border-l-2 border-blue-500">
                                  <p className="text-sm font-medium">First + Last Name</p>
                                  <p className="text-xs text-muted-foreground">Auto-generates username from first and last name fields</p>
                                  <p className="text-xs text-muted-foreground mt-1">Example: John Doe → username: john.doe</p>
                                </div>
                                <div className="pl-3 border-l-2 border-orange-500">
                                  <p className="text-sm font-medium">Manual Entry</p>
                                  <p className="text-xs text-muted-foreground">User chooses their own username during form submission</p>
                                  <p className="text-xs text-muted-foreground mt-1">Form displays: Username input field</p>
                                </div>
                              </div>
                            </div>

                            <Separator />

                            {/* Password Setup */}
                            <div>
                              <h3 className="font-semibold text-sm mb-2">Password Setup</h3>
                              <div className="space-y-3">
                                <div className="pl-3 border-l-2 border-green-500">
                                  <p className="text-sm font-medium">Send Reset Email (Recommended)</p>
                                  <p className="text-xs text-muted-foreground">Most secure option - creates account and emails password reset link</p>
                                  <p className="text-xs text-muted-foreground mt-1">User receives: Email with link to set their own password</p>
                                  <p className="text-xs font-semibold mt-1 text-green-600">✓ Best for prospect self-registration</p>
                                </div>
                                <div className="pl-3 border-l-2 border-blue-500">
                                  <p className="text-sm font-medium">User Sets Password</p>
                                  <p className="text-xs text-muted-foreground">User enters password directly during form submission</p>
                                  <p className="text-xs text-muted-foreground mt-1">Form displays: Password and Confirm Password fields</p>
                                  <p className="text-xs text-muted-foreground mt-1">Requirements: 8+ characters, uppercase, lowercase, number, special character</p>
                                </div>
                                <div className="pl-3 border-l-2 border-orange-500">
                                  <p className="text-sm font-medium">Auto-Generate Password</p>
                                  <p className="text-xs text-muted-foreground">System generates random secure password</p>
                                  <p className="text-xs text-muted-foreground mt-1">Password is logged to server console (requires admin access to retrieve)</p>
                                  <p className="text-xs font-semibold mt-1 text-orange-600">⚠ Consider sending reset email instead</p>
                                </div>
                              </div>
                            </div>

                            <Separator />

                            {/* Role Assignment */}
                            <div>
                              <h3 className="font-semibold text-sm mb-2">Role Assignment</h3>
                              <div className="space-y-3">
                                <div>
                                  <p className="text-sm font-medium">Roles to Assign</p>
                                  <p className="text-xs text-muted-foreground">Automatically assigned roles (always applied)</p>
                                  <p className="text-xs text-muted-foreground mt-1">Example: prospect, merchant</p>
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Allowed Roles (Manual Selection)</p>
                                  <p className="text-xs text-muted-foreground">If specified, user can choose from these roles during submission</p>
                                  <p className="text-xs text-muted-foreground mt-1">Leave empty to hide role selection field</p>
                                  <p className="text-xs text-muted-foreground mt-1">Security: User can only select from allowed roles</p>
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Default Role</p>
                                  <p className="text-xs text-muted-foreground">Pre-selected role when manual selection is enabled</p>
                                </div>
                              </div>
                            </div>

                            <Separator />

                            {/* Common Scenarios */}
                            <div>
                              <h3 className="font-semibold text-sm mb-2">Common Scenarios</h3>
                              <div className="space-y-4">
                                <div className="bg-green-50 dark:bg-green-950 p-3 rounded-md">
                                  <p className="text-sm font-medium text-green-900 dark:text-green-100">Prospect Self-Registration (Recommended)</p>
                                  <ul className="text-xs text-green-800 dark:text-green-200 mt-2 space-y-1 list-disc list-inside">
                                    <li>Username: From Email Address</li>
                                    <li>Password: Send Reset Email</li>
                                    <li>Roles to Assign: prospect</li>
                                    <li>Allowed Roles: Leave empty</li>
                                  </ul>
                                  <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                                    Result: Fully automatic, user receives email to set password
                                  </p>
                                </div>

                                <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md">
                                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Custom User Registration</p>
                                  <ul className="text-xs text-blue-800 dark:text-blue-200 mt-2 space-y-1 list-disc list-inside">
                                    <li>Username: Manual Entry</li>
                                    <li>Password: User Sets Password</li>
                                    <li>Roles to Assign: Leave empty</li>
                                    <li>Allowed Roles: prospect, merchant, agent</li>
                                  </ul>
                                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                                    Result: User controls everything during form submission
                                  </p>
                                </div>

                                <div className="bg-orange-50 dark:bg-orange-950 p-3 rounded-md">
                                  <p className="text-sm font-medium text-orange-900 dark:text-orange-100">Admin Bulk Import</p>
                                  <ul className="text-xs text-orange-800 dark:text-orange-200 mt-2 space-y-1 list-disc list-inside">
                                    <li>Username: First + Last Name</li>
                                    <li>Password: Auto-Generate Password</li>
                                    <li>Roles to Assign: merchant</li>
                                    <li>Allowed Roles: Leave empty</li>
                                  </ul>
                                  <p className="text-xs text-orange-700 dark:text-orange-300 mt-2">
                                    Result: Fully automatic, passwords logged to console
                                  </p>
                                </div>
                              </div>
                            </div>

                            <Separator />

                            {/* Security Notes */}
                            <div className="bg-yellow-50 dark:bg-yellow-950 p-3 rounded-md">
                              <h3 className="font-semibold text-sm mb-2 text-yellow-900 dark:text-yellow-100">Security Notes</h3>
                              <ul className="text-xs text-yellow-800 dark:text-yellow-200 space-y-1 list-disc list-inside">
                                <li>All passwords are bcrypt hashed before storage</li>
                                <li>Manual passwords require: 8+ chars, uppercase, lowercase, number, special character</li>
                                <li>Role validation prevents privilege escalation</li>
                                <li>Reset tokens expire after 24 hours</li>
                                <li>Email uniqueness is enforced</li>
                              </ul>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="space-y-4 border rounded-md p-4">
                      {/* Roles to Assign */}
                      <div>
                        <label className="text-xs text-muted-foreground">Roles to Assign</label>
                        <Input
                          value={(editingField.userAccountConfig?.roles || []).join(', ')}
                          onChange={(e) => {
                            const roles = e.target.value.split(',').map(r => r.trim()).filter(r => r);
                            setEditingField({ 
                              ...editingField, 
                              userAccountConfig: { 
                                ...(editingField.userAccountConfig || {}), 
                                roles 
                              } 
                            });
                          }}
                          placeholder="e.g., prospect, merchant"
                          className="text-xs"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Comma-separated list of roles</p>
                      </div>

                      {/* Username Generation */}
                      <div>
                        <label className="text-xs text-muted-foreground">Username Generation</label>
                        <Select
                          value={editingField.userAccountConfig?.usernameGeneration || 'email'}
                          onValueChange={(value) => {
                            setEditingField({ 
                              ...editingField, 
                              userAccountConfig: { 
                                ...(editingField.userAccountConfig || {}), 
                                usernameGeneration: value 
                              } 
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email">From Email Address</SelectItem>
                            <SelectItem value="firstLastName">First + Last Name</SelectItem>
                            <SelectItem value="manual">Manual Entry</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Password Type */}
                      <div>
                        <label className="text-xs text-muted-foreground">Password Setup</label>
                        <Select
                          value={editingField.userAccountConfig?.passwordType || 'reset_token'}
                          onValueChange={(value) => {
                            setEditingField({ 
                              ...editingField, 
                              userAccountConfig: { 
                                ...(editingField.userAccountConfig || {}), 
                                passwordType: value 
                              } 
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="reset_token">Send Reset Email</SelectItem>
                            <SelectItem value="manual">User Sets Password</SelectItem>
                            <SelectItem value="auto">Auto-Generate Password</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Initial Status */}
                      <div>
                        <label className="text-xs text-muted-foreground">Initial User Status</label>
                        <Input
                          value={editingField.userAccountConfig?.status || 'pending_password'}
                          onChange={(e) => {
                            setEditingField({ 
                              ...editingField, 
                              userAccountConfig: { 
                                ...(editingField.userAccountConfig || {}), 
                                status: e.target.value 
                              } 
                            });
                          }}
                          placeholder="e.g., active, pending_password"
                          className="text-xs"
                        />
                      </div>

                      {/* Allowed Roles for Manual Selection */}
                      <div>
                        <label className="text-xs text-muted-foreground">Allowed Roles (Manual Selection)</label>
                        <Input
                          value={(editingField.userAccountConfig?.allowedRoles || []).join(', ')}
                          onChange={(e) => {
                            const allowedRoles = e.target.value.split(',').map(r => r.trim()).filter(r => r);
                            setEditingField({ 
                              ...editingField, 
                              userAccountConfig: { 
                                ...(editingField.userAccountConfig || {}), 
                                allowedRoles: allowedRoles.length > 0 ? allowedRoles : undefined
                              } 
                            });
                          }}
                          placeholder="e.g., prospect, merchant, agent"
                          className="text-xs"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Leave empty to hide role selection. Comma-separated list.</p>
                      </div>

                      {/* Default Role */}
                      {editingField.userAccountConfig?.allowedRoles && editingField.userAccountConfig.allowedRoles.length > 0 && (
                        <div>
                          <label className="text-xs text-muted-foreground">Default Role</label>
                          <Select
                            value={editingField.userAccountConfig?.defaultRole || ''}
                            onValueChange={(value) => {
                              setEditingField({ 
                                ...editingField, 
                                userAccountConfig: { 
                                  ...(editingField.userAccountConfig || {}), 
                                  defaultRole: value || undefined
                                } 
                              });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select default role" />
                            </SelectTrigger>
                            <SelectContent>
                              {editingField.userAccountConfig.allowedRoles.map((role: string) => (
                                <SelectItem key={role} value={role}>{role}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Email Notification Options */}
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="notifyUser"
                            checked={editingField.userAccountConfig?.notifyUser !== false}
                            onCheckedChange={(checked) => {
                              setEditingField({ 
                                ...editingField, 
                                userAccountConfig: { 
                                  ...(editingField.userAccountConfig || {}), 
                                  notifyUser: checked as boolean 
                                } 
                              });
                            }}
                          />
                          <label htmlFor="notifyUser" className="text-xs text-muted-foreground cursor-pointer">
                            Send welcome email to user
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="requireEmailValidation"
                            checked={editingField.userAccountConfig?.requireEmailValidation === true}
                            onCheckedChange={(checked) => {
                              setEditingField({ 
                                ...editingField, 
                                userAccountConfig: { 
                                  ...(editingField.userAccountConfig || {}), 
                                  requireEmailValidation: checked as boolean 
                                } 
                              });
                            }}
                          />
                          <label htmlFor="requireEmailValidation" className="text-xs text-muted-foreground cursor-pointer">
                            Require email validation
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Disclosure Field Configuration */}
                {editingField.type === 'disclosure' && (
                  <div className="space-y-4 border rounded-lg p-4 bg-indigo-50/50">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-indigo-600" />
                      <label className="text-sm font-medium">Disclosure Configuration</label>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      Configure the disclosure text that users must read and acknowledge before signing.
                    </p>

                    {/* Disclosure Library Picker */}
                    <div>
                      <label className="text-sm font-medium mb-2 block">Select from Disclosure Library</label>
                      <Select
                        value={editingField.disclosureDefinitionId?.toString() || 'custom'}
                        onValueChange={(value) => {
                          if (value === 'custom') {
                            setEditingField({ 
                              ...editingField, 
                              disclosureDefinitionId: undefined 
                            });
                          } else {
                            const selectedDisclosure = availableDisclosures.find(d => d.id.toString() === value);
                            setEditingField({ 
                              ...editingField, 
                              disclosureDefinitionId: parseInt(value),
                              disclosureTitle: selectedDisclosure?.currentVersion?.title || selectedDisclosure?.displayName || editingField.disclosureTitle
                            });
                          }
                        }}
                      >
                        <SelectTrigger data-testid="select-disclosure-library">
                          <SelectValue placeholder="Choose a disclosure or enter custom content" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">
                            <span className="flex items-center gap-2">
                              <Type className="h-4 w-4" />
                              Custom Content (enter below)
                            </span>
                          </SelectItem>
                          {availableDisclosures.map((disclosure) => (
                            <SelectItem key={disclosure.id} value={disclosure.id.toString()}>
                              <span className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-indigo-600" />
                                {disclosure.displayName}
                                {disclosure.currentVersion && (
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    v{disclosure.currentVersion.version}
                                  </Badge>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Select a disclosure from the library for automatic version tracking, or enter custom content below.
                      </p>
                    </div>

                    {/* Show library disclosure info when selected */}
                    {editingField.disclosureDefinitionId && (
                      <div className="bg-indigo-100 border border-indigo-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-indigo-700">
                          <BookOpen className="h-4 w-4" />
                          <span className="text-sm font-medium">Using Library Disclosure</span>
                        </div>
                        <p className="text-xs text-indigo-600 mt-1">
                          Content will be fetched from the Disclosure Library. Updates to the library will automatically apply to this form.
                        </p>
                      </div>
                    )}

                    {/* Disclosure Content - only show for custom content */}
                    {!editingField.disclosureDefinitionId && (
                      <div>
                        <label className="text-sm font-medium mb-2 block">Disclosure Content</label>
                        <WysiwygEditor
                          value={editingField.disclosureContent || ''}
                          onChange={(content) => setEditingField({ ...editingField, disclosureContent: content })}
                          placeholder="Enter the disclosure text that users must read and agree to..."
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Users must scroll through 100% of this content before they can sign and acknowledge.
                        </p>
                      </div>
                    )}

                    {/* Disclosure Version - only show for custom content */}
                    {!editingField.disclosureDefinitionId && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Version</label>
                          <Input
                            value={editingField.disclosureVersion || '1.0'}
                            onChange={(e) => setEditingField({ ...editingField, disclosureVersion: e.target.value })}
                            placeholder="1.0"
                            data-testid="input-disclosure-version"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Version number for tracking disclosure changes.
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Display Title</label>
                          <Input
                            value={editingField.disclosureTitle || editingField.label || ''}
                            onChange={(e) => setEditingField({ ...editingField, disclosureTitle: e.target.value })}
                            placeholder="Terms of Service"
                            data-testid="input-disclosure-title"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Title shown in the disclosure header.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Requires Signature Toggle */}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="requiresSignature"
                        checked={editingField.requiresSignature !== false}
                        onCheckedChange={(checked) => setEditingField({ 
                          ...editingField, 
                          requiresSignature: checked as boolean 
                        })}
                      />
                      <label htmlFor="requiresSignature" className="text-sm cursor-pointer">
                        Requires signature after reading
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-2 ml-6">
                      When enabled, users must sign (draw or type) after scrolling through the disclosure.
                    </p>

                    {/* Multi-Signer Configuration - only show when signature is required */}
                    {editingField.requiresSignature && (
                      <div className="ml-6 mt-3 space-y-3 border-l-2 border-indigo-200 pl-4">
                        <div>
                          <label className="text-sm font-medium mb-1 block">Maximum Signers</label>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={editingField.maxSigners || 1}
                            onChange={(e) => setEditingField({
                              ...editingField,
                              maxSigners: Math.min(10, Math.max(1, parseInt(e.target.value) || 1))
                            })}
                            className="w-24 h-8"
                            data-testid="input-max-signers"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            How many people can sign this field? (e.g., 2 for personal guarantors)
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Signature Group Key</label>
                          <Input
                            type="text"
                            placeholder="e.g., guarantor, owner, witness"
                            value={editingField.linkedSignatureGroupKey || ''}
                            onChange={(e) => setEditingField({
                              ...editingField,
                              linkedSignatureGroupKey: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')
                            })}
                            className="h-8"
                            data-testid="input-signature-group-key"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Unique identifier for the signature group (e.g., "guarantor" creates guarantor1, guarantor2, etc.)
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Signer Label</label>
                          <Input
                            type="text"
                            placeholder="e.g., Merchant Processing Application Signer"
                            value={editingField.signerLabel || ''}
                            onChange={(e) => setEditingField({
                              ...editingField,
                              signerLabel: e.target.value
                            })}
                            className="h-8"
                            data-testid="input-signer-label"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Display label for signers (e.g., "Merchant Processing Application Signer 1", "...Signer 2", etc.)
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Requires Initials Toggle */}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="requiresInitials"
                        checked={editingField.requiresInitials === true}
                        onCheckedChange={(checked) => setEditingField({ 
                          ...editingField, 
                          requiresInitials: checked as boolean 
                        })}
                      />
                      <label htmlFor="requiresInitials" className="text-sm cursor-pointer">
                        Requires initials after reading
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-2 ml-6">
                      When enabled, users must provide their initials after scrolling through the disclosure. Can be used alone or with signature.
                    </p>
                  </div>
                )}

                {/* Signature Field - Linked Fields Configuration */}
                {editingField.type === 'signature' && (
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium mb-2 block">Linked Fields</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Select fields that this signature acknowledges or is associated with. This is used for compliance tracking.
                    </p>
                    <div className="mb-2">
                      <Input
                        placeholder="Search fields..."
                        value={linkedFieldSearch}
                        onChange={(e) => setLinkedFieldSearch(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-muted/30">
                      {(() => {
                        const searchTerm = linkedFieldSearch.toLowerCase().trim();
                        const allAvailableFields = sections.flatMap((section: any) => 
                          section.fields
                            .filter((f: any) => f.id !== editingField.id)
                            .map((field: any) => ({ ...field, sectionTitle: section.title }))
                        );
                        const filteredFields = searchTerm 
                          ? allAvailableFields.filter((field: any) => 
                              field.label?.toLowerCase().includes(searchTerm) ||
                              field.type?.toLowerCase().includes(searchTerm) ||
                              field.sectionTitle?.toLowerCase().includes(searchTerm)
                            )
                          : allAvailableFields;

                        if (filteredFields.length === 0) {
                          return (
                            <p className="text-sm text-muted-foreground text-center py-2">
                              {searchTerm ? 'No fields match your search' : 'No other fields available to link'}
                            </p>
                          );
                        }

                        return filteredFields.map((field: any) => {
                          const linkedFields = editingField.linkedFields || [];
                          const isLinked = linkedFields.includes(field.id);
                          return (
                            <div key={field.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`link-field-${field.id}`}
                                checked={isLinked}
                                onCheckedChange={(checked) => {
                                  const newLinkedFields = checked
                                    ? [...linkedFields, field.id]
                                    : linkedFields.filter((id: string) => id !== field.id);
                                  setEditingField({ ...editingField, linkedFields: newLinkedFields });
                                }}
                              />
                              <label
                                htmlFor={`link-field-${field.id}`}
                                className="text-sm cursor-pointer flex-1"
                              >
                                <span className="font-medium">{field.label}</span>
                                <span className="text-xs text-muted-foreground ml-2">({field.sectionTitle} - {field.type})</span>
                              </label>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {(editingField.linkedFields || []).length} field(s) linked
                    </p>
                  </div>
                )}

                {/* Owner Group Field Configuration */}
                {editingField.type === 'owner_group' && (
                  <div className="space-y-4 border rounded-lg p-4 bg-green-50/50">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-green-600" />
                      <label className="text-sm font-medium">Owner Group Configuration</label>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      Configure settings for collecting beneficial owner and control person information.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Maximum Owners</label>
                        <Select
                          value={(editingField.ownerGroupConfig?.maxOwners || 5).toString()}
                          onValueChange={(v) => setEditingField({ 
                            ...editingField, 
                            ownerGroupConfig: { 
                              ...(editingField.ownerGroupConfig || {}), 
                              maxOwners: parseInt(v) 
                            } 
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3 owners</SelectItem>
                            <SelectItem value="4">4 owners</SelectItem>
                            <SelectItem value="5">5 owners</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Maximum number of beneficial owners that can be added.
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Signature Threshold</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            value={editingField.ownerGroupConfig?.signatureThreshold || 25}
                            onChange={(e) => setEditingField({ 
                              ...editingField, 
                              ownerGroupConfig: { 
                                ...(editingField.ownerGroupConfig || {}), 
                                signatureThreshold: Math.min(100, Math.max(1, parseInt(e.target.value) || 25))
                              } 
                            })}
                            className="w-20"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Owners with ≥ this ownership % require signature.
                        </p>
                      </div>
                    </div>

                    <div className="bg-green-100 border border-green-200 rounded-lg p-3 mt-3">
                      <div className="flex items-center gap-2 text-green-700 text-sm">
                        <CheckCircle className="h-4 w-4" />
                        <span className="font-medium">Built-in Features</span>
                      </div>
                      <ul className="text-xs text-green-600 mt-2 space-y-1 ml-6 list-disc">
                        <li>Automatic ownership tracking (must total 100%)</li>
                        <li>Beneficial owner identification (≥{editingField.ownerGroupConfig?.signatureThreshold || 25}%)</li>
                        <li>Control person designation option</li>
                        <li>Auto-signature fields for beneficial owners</li>
                        <li>Full owner information: name, title, SSN, DOB, address, contact</li>
                      </ul>
                    </div>
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

// Field Mappings Visualization Component - helps debug field associations
function FieldMappingsVisualization({ 
  sections, 
  templateName 
}: { 
  sections: any[];
  templateName: string;
}) {
  // Generate canonical field name for address groups (matches enhanced-pdf-wizard logic)
  const generateCanonicalName = (fieldId: string, subField: string) => {
    const groupType = fieldId.replace(/_/g, '').toLowerCase();
    return `${groupType}Address.${subField}`;
  };

  // Check if a field is an address-related field
  const isAddressField = (field: any) => {
    return field.type === 'address' || field.id?.includes('address') || field.id?.includes('Address');
  };

  // Group fields by their type for better visualization
  const fieldGroups = {
    address: [] as any[],
    standard: [] as any[],
    special: [] as any[] // user_account, signature, etc.
  };

  sections.forEach((section: any, sectionIndex: number) => {
    (section.fields || []).forEach((field: any, fieldIndex: number) => {
      const fieldWithContext = {
        ...field,
        sectionTitle: section.title,
        sectionIndex,
        fieldIndex
      };

      if (isAddressField(field)) {
        fieldGroups.address.push(fieldWithContext);
      } else if (field.type === 'user_account' || field.type === 'signature') {
        fieldGroups.special.push(fieldWithContext);
      } else {
        fieldGroups.standard.push(fieldWithContext);
      }
    });
  });

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Field Mapping Reference - {templateName}
        </h3>
        <p className="text-sm text-blue-700 mt-1">
          This view shows how each field ID maps to storage keys. Use this for debugging data persistence issues.
        </p>
      </div>

      {/* Address Fields Section */}
      {fieldGroups.address.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Map className="h-4 w-4 text-green-600" />
              Address Fields ({fieldGroups.address.length})
            </CardTitle>
            <CardDescription>
              Address fields use dual naming: Template ID + Canonical Name
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {fieldGroups.address.map((field: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 bg-green-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-green-900">{field.label}</span>
                    <Badge variant="outline" className="bg-white">
                      Section: {field.sectionTitle}
                    </Badge>
                  </div>
                  
                  <div className="text-sm space-y-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-gray-500">Template Field ID:</span>
                        <code className="ml-2 px-2 py-1 bg-white rounded text-xs font-mono">
                          {field.id}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-500">Field Type:</span>
                        <code className="ml-2 px-2 py-1 bg-white rounded text-xs font-mono">
                          {field.type}
                        </code>
                      </div>
                    </div>

                    {/* Show sub-field mappings for address groups */}
                    <div className="mt-3 pt-3 border-t border-green-200">
                      <span className="text-xs font-semibold text-green-800 uppercase mb-2 block">Sub-field Mappings:</span>
                      <div className="bg-white rounded-lg border border-green-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-green-100">
                            <tr>
                              <th className="text-left py-2 px-3 font-medium text-green-800">Field</th>
                              <th className="text-left py-2 px-3 font-medium text-green-800">Template Key</th>
                              <th className="text-left py-2 px-3 font-medium text-green-800">Canonical Key</th>
                            </tr>
                          </thead>
                          <tbody>
                            {['street1', 'street2', 'city', 'state', 'postalcode'].map((subField, i) => (
                              <tr key={subField} className={i % 2 === 0 ? 'bg-white' : 'bg-green-50'}>
                                <td className="py-2 px-3 text-gray-700 font-medium">{subField}</td>
                                <td className="py-2 px-3">
                                  <code className="text-green-700 font-mono">{field.id}.{subField}</code>
                                </td>
                                <td className="py-2 px-3">
                                  <code className="text-green-800 font-mono">{generateCanonicalName(field.id, subField)}</code>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standard Fields Section */}
      {fieldGroups.standard.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Circle className="h-4 w-4 text-blue-600" />
              Standard Fields ({fieldGroups.standard.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Section</th>
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-left py-2 px-2">Field ID</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldGroups.standard.map((field: any, idx: number) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 text-gray-600">{field.sectionTitle}</td>
                      <td className="py-2 px-2 font-medium">{field.label}</td>
                      <td className="py-2 px-2">
                        <code className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                          {field.id}
                        </code>
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="secondary">{field.type}</Badge>
                      </td>
                      <td className="py-2 px-2">
                        {field.required ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Circle className="h-4 w-4 text-gray-300" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Special Fields Section */}
      {fieldGroups.special.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-purple-600" />
              Special Fields ({fieldGroups.special.length})
            </CardTitle>
            <CardDescription>
              User accounts, signatures, and other complex field types
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="bg-white rounded-lg border border-purple-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-purple-100">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-purple-800">Section</th>
                    <th className="text-left py-2 px-3 font-medium text-purple-800">Label</th>
                    <th className="text-left py-2 px-3 font-medium text-purple-800">Field ID</th>
                    <th className="text-left py-2 px-3 font-medium text-purple-800">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldGroups.special.map((field: any, idx: number) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-purple-50'}>
                      <td className="py-2 px-3 text-gray-600">{field.sectionTitle}</td>
                      <td className="py-2 px-3 font-medium text-purple-900">{field.label}</td>
                      <td className="py-2 px-3">
                        <code className="text-purple-700 font-mono text-xs">{field.id}</code>
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className="bg-white text-purple-700 border-purple-300">
                          {field.type}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Statistics */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-green-50">
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-green-700">{fieldGroups.address.length}</div>
            <div className="text-sm text-green-600">Address Fields</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-blue-700">{fieldGroups.standard.length}</div>
            <div className="text-sm text-blue-600">Standard Fields</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50">
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-purple-700">{fieldGroups.special.length}</div>
            <div className="text-sm text-purple-600">Special Fields</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// PDF Field Naming Documentation Dialog Component
function PdfFieldNamingDocumentation({ 
  isOpen, 
  onClose 
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState('naming');

  // Field type dictionary with comprehensive information
  const fieldTypes = [
    { type: 'text', icon: Type, description: 'Standard text input field', example: 'business.legalName, contact.name', detection: 'Default type for text fields', masking: 'None' },
    { type: 'textarea', icon: AlignLeft, description: 'Multi-line text input', example: 'business.description, notes', detection: 'Multi-line PDF fields or _textarea suffix', masking: 'None' },
    { type: 'email', icon: Mail, description: 'Email address with validation', example: 'contact.email, owners.1.email', detection: 'Field name contains "email"', masking: 'None' },
    { type: 'phone', icon: Phone, description: 'Phone number with formatting', example: 'business.phone, owners.1.mobile', detection: 'Field name contains "phone"', masking: 'None' },
    { type: 'tel', icon: Phone, description: 'Telephone number (alias for phone)', example: 'location.tel, fax.number', detection: 'Field name contains "tel" or "fax"', masking: 'None' },
    { type: 'date', icon: Calendar, description: 'Date picker input', example: 'business.startDate, owners.1.dateOfBirth', detection: 'Field name contains "date"', masking: 'None' },
    { type: 'number', icon: Hash, description: 'Numeric input', example: 'business.employeeCount, processing.avgTicket', detection: 'Numeric PDF fields or _number suffix', masking: 'None' },
    { type: 'currency', icon: DollarSign, description: 'Currency/money input', example: 'processing.monthlyVolume, fees.discount', detection: 'Field name contains "amount", "volume", "fee"', masking: 'None' },
    { type: 'percentage', icon: Percent, description: 'Percentage input (0-100)', example: 'owners.1.ownershipPercent, rates.visaPercent', detection: 'Field name contains "percent" or "ownership"', masking: 'None' },
    { type: 'ssn', icon: Fingerprint, description: 'Social Security Number', example: 'owners.1.ssn, owners.2.ssn', detection: 'Field name contains "ssn" or "social"', sensitive: true, masking: 'Shows ***-**-1234' },
    { type: 'ein', icon: Building, description: 'Employer Identification Number', example: 'business.ein, business.taxId', detection: 'Field name contains "ein" or "taxid"', sensitive: true, masking: 'Shows **-***1234' },
    { type: 'tin', icon: Building, description: 'Tax Identification Number', example: 'business.tin, owners.1.tin', detection: 'Field name contains "tin"', sensitive: true, masking: 'Shows ******1234' },
    { type: 'zipcode', icon: MapPin, description: 'ZIP/Postal code with validation', example: 'location.address.postalcode', detection: 'Field name contains "zip" or "postal"', masking: 'None' },
    { type: 'url', icon: Globe, description: 'Website URL with validation', example: 'business.website, company.url', detection: 'Field name contains "url" or "website"', masking: 'None' },
    { type: 'select', icon: ListChecks, description: 'Dropdown selection list', example: 'business.entityType, location.address.state', detection: 'PDF dropdown fields', masking: 'None' },
    { type: 'radio', icon: Circle, description: 'Radio button group', example: 'business.entityType.radio.llc', detection: 'Dot notation: section.field.radio.option or PDF radio groups', masking: 'None' },
    { type: 'checkbox', icon: CheckCircle, description: 'Checkbox input', example: 'terms.accepted, processing.acceptsCredit', detection: 'PDF checkbox fields', masking: 'None' },
    { type: 'boolean', icon: ToggleLeft, description: 'Yes/No toggle', example: 'business.isSeasonal.bool.yes', detection: 'Dot notation: section.field.bool.yes/no or _bool suffix', masking: 'None' },
    { type: 'address', icon: MapPin, description: 'Address autocomplete with Google Maps', example: 'location.address, owners.1.address', detection: 'Field name contains "address" or "street"', complex: true, masking: 'None' },
    { type: 'mcc-select', icon: CreditCard, description: 'Merchant Category Code selector', example: 'business.mcc, merchant.mccCode', detection: 'Field name contains "mcc"', complex: true, masking: 'None' },
    { type: 'signature', icon: PenTool, description: 'Digital signature capture', example: 'owners.1.signature, agent.signature', detection: 'Signature group pattern', complex: true, masking: 'Stored securely' },
    { type: 'user_account', icon: Users, description: 'Automatic user account creation', example: 'prospect.account', detection: 'Special field type for account creation', complex: true, masking: 'Password masked' },
    { type: 'disclosure', icon: FileText, description: 'Scrollable disclosure with signature', example: 'disclosures.termsOfService, disclosures.eSignConsent', detection: 'Field in disclosures section', complex: true, masking: 'Audit trail' },
    { type: 'owner_group', icon: Users, description: 'Beneficial owners & control persons with auto-signatures', example: 'business.owners', detection: 'Owner/beneficial owner collection', complex: true, masking: 'SSN masked' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <BookOpen className="h-5 w-5 text-primary" />
            PDF Field Naming Guide
          </DialogTitle>
          <DialogDescription>
            Comprehensive guide for naming PDF form fields to ensure maximum compatibility with the application template system
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="naming" className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              Naming Convention
            </TabsTrigger>
            <TabsTrigger value="fieldtypes" className="flex items-center gap-1">
              <Type className="h-4 w-4" />
              Field Types
            </TabsTrigger>
            <TabsTrigger value="complex" className="flex items-center gap-1">
              <Settings className="h-4 w-4" />
              Complex Controls
            </TabsTrigger>
            <TabsTrigger value="examples" className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              Examples
            </TabsTrigger>
          </TabsList>

          {/* Naming Convention Tab */}
          <TabsContent value="naming" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Hash className="h-5 w-5 text-blue-600" />
                  Field Naming Convention
                </CardTitle>
                <CardDescription>
                  Use period (.) as the delimiter for hierarchical field names
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2">Format</h4>
                  <code className="text-blue-700 font-mono text-lg">section.subsection.fieldName</code>
                  <p className="text-sm text-blue-600 mt-2">or for numbered items:</p>
                  <code className="text-blue-700 font-mono text-lg">section.index.fieldName</code>
                </div>

                <div className="space-y-3">
                  <h4 className="font-semibold">Standard Sections</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { section: 'business', desc: 'Business/company information', examples: ['business.legalName', 'business.dbaName', 'business.entityType'] },
                      { section: 'location', desc: 'Business location details', examples: ['location.address.street1', 'location.phone', 'location.email'] },
                      { section: 'mailing', desc: 'Mailing address (if different)', examples: ['mailing.address.street1', 'mailing.address.city'] },
                      { section: 'owners', desc: 'Owner/principal information', examples: ['owners.1.firstName', 'owners.1.ssn', 'owners.2.email'] },
                      { section: 'banking', desc: 'Bank account information', examples: ['banking.routingNumber', 'banking.accountNumber'] },
                      { section: 'agent', desc: 'Agent/sales rep information', examples: ['agent.name', 'agent.email', 'agent.phone'] },
                    ].map((item) => (
                      <div key={item.section} className="bg-gray-50 p-3 rounded-lg border">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono">{item.section}</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{item.desc}</p>
                        <div className="space-y-1">
                          {item.examples.map((ex) => (
                            <code key={ex} className="block text-xs font-mono text-gray-500">{ex}</code>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-semibold">Owner Fields (Numbered)</h4>
                  <p className="text-sm text-gray-600">
                    Owner fields use numeric indices (1, 2, 3, etc.) to identify each owner/principal:
                  </p>
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="font-medium text-green-800 mb-2">Owner 1</h5>
                        <div className="space-y-1 font-mono text-sm text-green-700">
                          <div>owners.1.firstName</div>
                          <div>owners.1.lastName</div>
                          <div>owners.1.title</div>
                          <div>owners.1.ownershipPercent</div>
                          <div>owners.1.ssn</div>
                          <div>owners.1.dateOfBirth</div>
                          <div>owners.1.address.street1</div>
                          <div>owners.1.address.city</div>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium text-green-800 mb-2">Owner 2</h5>
                        <div className="space-y-1 font-mono text-sm text-green-700">
                          <div>owners.2.firstName</div>
                          <div>owners.2.lastName</div>
                          <div>owners.2.title</div>
                          <div>owners.2.ownershipPercent</div>
                          <div>owners.2.ssn</div>
                          <div>owners.2.dateOfBirth</div>
                          <div>owners.2.address.street1</div>
                          <div>owners.2.address.city</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Field Types Tab */}
          <TabsContent value="fieldtypes" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Type className="h-5 w-5 text-purple-600" />
                  Field Type Dictionary
                </CardTitle>
                <CardDescription>
                  Complete list of supported field types and how they are detected
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium">Type</th>
                        <th className="text-left py-2 px-3 font-medium">Description</th>
                        <th className="text-left py-2 px-3 font-medium">Detection Keywords</th>
                        <th className="text-left py-2 px-3 font-medium">Example Names</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldTypes.map((field, idx) => {
                        const IconComponent = field.icon;
                        return (
                          <tr key={field.type} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <IconComponent className={`h-4 w-4 ${field.sensitive ? 'text-red-500' : field.complex ? 'text-purple-500' : 'text-gray-500'}`} />
                                <Badge variant={field.sensitive ? 'destructive' : field.complex ? 'secondary' : 'outline'} className="font-mono">
                                  {field.type}
                                </Badge>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-gray-600">{field.description}</td>
                            <td className="py-2 px-3 text-xs text-gray-500">{field.detection}</td>
                            <td className="py-2 px-3">
                              <code className="text-xs font-mono text-gray-600">{field.example}</code>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-red-700">
                  <Lock className="h-5 w-5" />
                  Sensitive Fields (Masked)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-red-600 mb-3">
                  These field types are automatically masked after entry, showing only the last 4 digits:
                </p>
                <div className="flex gap-4">
                  <div className="bg-white p-3 rounded border border-red-200">
                    <Badge variant="destructive" className="font-mono mb-2">ssn</Badge>
                    <p className="text-xs text-gray-600">Social Security Number</p>
                    <p className="text-xs font-mono mt-1">Display: ***-**-1234</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-red-200">
                    <Badge variant="destructive" className="font-mono mb-2">ein</Badge>
                    <p className="text-xs text-gray-600">Employer ID Number</p>
                    <p className="text-xs font-mono mt-1">Display: **-***1234</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Complex Controls Tab */}
          <TabsContent value="complex" className="space-y-4 mt-4">
            {/* Address Autocomplete */}
            <Card className="border-green-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Navigation className="h-5 w-5 text-green-600" />
                  Address Autocomplete
                </CardTitle>
                <CardDescription>
                  Google Maps-powered address autocomplete with automatic field population
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h4 className="font-semibold text-green-800 mb-2">Required Field Pattern</h4>
                  <p className="text-sm text-green-700 mb-3">
                    Address groups are automatically detected when fields follow this naming pattern:
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h5 className="font-medium text-green-700 mb-2">Address Fields</h5>
                      <div className="space-y-1 font-mono text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-white">required</Badge>
                          <span>prefix.address.street1</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="bg-white">optional</Badge>
                          <span>prefix.address.street2</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-white">required</Badge>
                          <span>prefix.address.city</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-white">required</Badge>
                          <span>prefix.address.state</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-white">required</Badge>
                          <span>prefix.address.postalcode</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="bg-white">optional</Badge>
                          <span>prefix.address.country</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h5 className="font-medium text-green-700 mb-2">Example Prefixes</h5>
                      <div className="space-y-2">
                        <div className="bg-white p-2 rounded border">
                          <code className="text-sm font-mono">location.address.*</code>
                          <p className="text-xs text-gray-500 mt-1">Business location address</p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                          <code className="text-sm font-mono">mailing.address.*</code>
                          <p className="text-xs text-gray-500 mt-1">Mailing/correspondence address</p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                          <code className="text-sm font-mono">owners.1.address.*</code>
                          <p className="text-xs text-gray-500 mt-1">Owner 1 home address</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Radio Buttons and Boolean Fields */}
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Circle className="h-5 w-5 text-amber-600" />
                  Radio Buttons &amp; Boolean Fields
                </CardTitle>
                <CardDescription>
                  Multi-option selection and Yes/No toggle fields using dot notation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <h4 className="font-semibold text-amber-800 mb-2">Naming Convention</h4>
                  <p className="text-sm text-amber-700 mb-3">
                    Use full dot notation with the field type keyword followed by the option value:
                  </p>
                  <code className="block bg-white p-2 rounded border border-amber-200 font-mono text-amber-700 mb-2">
                    section.fieldName.type.optionValue
                  </code>
                  <p className="text-xs text-amber-600">
                    The parser detects the type keyword (radio, bool, boolean, checkbox) and groups all fields with the same prefix together.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-lg border">
                    <h5 className="font-medium text-amber-700 mb-3 flex items-center gap-2">
                      <Circle className="h-4 w-4" />
                      Radio Button Groups
                    </h5>
                    <p className="text-sm text-gray-600 mb-3">
                      Each option is a separate PDF field. Fields with the same section.fieldName.radio prefix are grouped together.
                    </p>
                    <div className="space-y-2">
                      <div className="bg-amber-50 p-2 rounded text-sm">
                        <div className="font-medium text-amber-800 mb-1">Entity Type Selection:</div>
                        <div className="font-mono text-xs space-y-1 text-amber-700">
                          <div>business.entityType.radio.sole_proprietorship</div>
                          <div>business.entityType.radio.partnership</div>
                          <div>business.entityType.radio.llc</div>
                          <div>business.entityType.radio.corporation</div>
                          <div>business.entityType.radio.non_profit</div>
                        </div>
                      </div>
                      <div className="bg-amber-50 p-2 rounded text-sm">
                        <div className="font-medium text-amber-800 mb-1">Owner Type (per owner):</div>
                        <div className="font-mono text-xs space-y-1 text-amber-700">
                          <div>owners.1.type.radio.individual</div>
                          <div>owners.1.type.radio.business</div>
                          <div>owners.2.type.radio.individual</div>
                          <div>owners.2.type.radio.business</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-lg border">
                    <h5 className="font-medium text-amber-700 mb-3 flex items-center gap-2">
                      <ToggleLeft className="h-4 w-4" />
                      Boolean (Yes/No) Fields
                    </h5>
                    <p className="text-sm text-gray-600 mb-3">
                      Yes/No toggles using <code className="bg-gray-100 px-1 rounded">bool</code> or <code className="bg-gray-100 px-1 rounded">boolean</code> as the type keyword.
                    </p>
                    <div className="space-y-2">
                      <div className="bg-amber-50 p-2 rounded text-sm">
                        <div className="font-medium text-amber-800 mb-1">Accept Credit Cards:</div>
                        <div className="font-mono text-xs space-y-1 text-amber-700">
                          <div>business.acceptsCreditCards.bool.yes</div>
                          <div>business.acceptsCreditCards.bool.no</div>
                        </div>
                      </div>
                      <div className="bg-amber-50 p-2 rounded text-sm">
                        <div className="font-medium text-amber-800 mb-1">Has DBA Name:</div>
                        <div className="font-mono text-xs space-y-1 text-amber-700">
                          <div>business.hasDba.boolean.yes</div>
                          <div>business.hasDba.boolean.no</div>
                        </div>
                      </div>
                      <div className="bg-amber-50 p-2 rounded text-sm">
                        <div className="font-medium text-amber-800 mb-1">Seasonal Business:</div>
                        <div className="font-mono text-xs space-y-1 text-amber-700">
                          <div>business.isSeasonal.bool.yes</div>
                          <div>business.isSeasonal.bool.no</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-100 p-3 rounded-lg border border-amber-300">
                  <h5 className="font-medium text-amber-800 mb-2">How Grouping Works</h5>
                  <p className="text-sm text-amber-700">
                    The parser automatically groups PDF fields that share the same <code className="bg-white px-1 rounded">section.fieldName.type</code> prefix.
                    Each grouped set becomes one logical form field with multiple options. The option values after the type keyword become the selectable choices.
                  </p>
                </div>

                <div className="bg-gray-100 p-3 rounded-lg border">
                  <h5 className="font-medium text-gray-800 mb-2">Backward Compatibility</h5>
                  <p className="text-sm text-gray-600">
                    The parser also supports legacy formats for backward compatibility:
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-white p-2 rounded">
                      <span className="text-gray-500">Hybrid:</span> business.entityType_radio_llc
                    </div>
                    <div className="bg-white p-2 rounded">
                      <span className="text-gray-500">Legacy:</span> merchant_entity_type_radio_llc
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Signature Groups */}
            <Card className="border-purple-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PenTool className="h-5 w-5 text-purple-600" />
                  Signature Groups
                </CardTitle>
                <CardDescription>
                  Digital signature capture with signer information and audit trail
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                  <h4 className="font-semibold text-purple-800 mb-2">Signature Field Pattern</h4>
                  <p className="text-sm text-purple-700 mb-3">
                    Signature groups are detected using this pattern:
                  </p>
                  <code className="block bg-white p-2 rounded border border-purple-200 font-mono text-purple-700">
                    prefix.signature.fieldType
                  </code>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <h5 className="font-medium text-purple-700 mb-2">Signature Fields</h5>
                      <div className="space-y-1 font-mono text-sm">
                        <div>owners.1.signature.signerName</div>
                        <div>owners.1.signature.signature</div>
                        <div>owners.1.signature.initials</div>
                        <div>owners.1.signature.email</div>
                        <div>owners.1.signature.dateSigned</div>
                        <div>owners.1.signature.ipAddress</div>
                      </div>
                    </div>
                    <div>
                      <h5 className="font-medium text-purple-700 mb-2">Captured Data</h5>
                      <div className="space-y-1 text-sm text-purple-600">
                        <div>• Signer full name</div>
                        <div>• Digital signature (canvas/typed)</div>
                        <div>• Initials</div>
                        <div>• Email address</div>
                        <div>• Timestamp</div>
                        <div>• IP address (audit trail)</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-purple-100 p-3 rounded-lg border border-purple-300">
                  <h5 className="font-medium text-purple-800 mb-2">Signature Data Storage & PDF Rehydration</h5>
                  <p className="text-sm text-purple-700">
                    Signature data is stored in the database with all captured metadata. When generating final PDFs, 
                    the signature image is automatically embedded at the correct position with signer details and timestamp.
                    This ensures legal compliance and audit trail integrity.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Conditional Field Visibility */}
            <Card className="border-orange-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-orange-600" />
                  Conditional Field Visibility
                </CardTitle>
                <CardDescription>
                  Show or hide fields based on other field values
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                  <h4 className="font-semibold text-orange-800 mb-2">Conditional Rules</h4>
                  <p className="text-sm text-orange-700 mb-3">
                    Fields can be configured to appear only when specific conditions are met. 
                    Conditions are defined in the template's Field Configuration and support:
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="bg-white p-2 rounded border">
                      <strong>equals:</strong> Show field when another field equals a specific value
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <strong>notEquals:</strong> Show field when another field does not equal a value
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <strong>contains:</strong> Show field when another field contains a substring
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <strong>greaterThan / lessThan:</strong> Numeric comparisons
                    </div>
                  </div>
                  <p className="text-xs text-orange-600 mt-3">
                    Example: Show "DBA Name" only when "Has DBA" checkbox is checked
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Application Locking & Prospect Portal */}
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-red-600" />
                  Post-Submission Locking & Prospect Portal
                </CardTitle>
                <CardDescription>
                  Application data protection and portal editing rules
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                  <h4 className="font-semibold text-red-800 mb-2">Application Lifecycle</h4>
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-green-100 text-green-800">Draft</Badge>
                        <span className="text-sm font-medium">Fully Editable</span>
                      </div>
                      <p className="text-xs text-gray-600">Prospects can edit all fields through the application wizard or prospect portal</p>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>
                        <span className="text-sm font-medium">Locked for Review</span>
                      </div>
                      <p className="text-xs text-gray-600">All fields become read-only. Prospect portal shows view-only mode.</p>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-amber-100 text-amber-800">Returned</Badge>
                        <span className="text-sm font-medium">Portal-Only Edits</span>
                      </div>
                      <p className="text-xs text-gray-600">If returned for corrections, prospect can edit only via their portal (not wizard)</p>
                    </div>
                  </div>
                </div>
                <div className="bg-red-100 p-3 rounded-lg border border-red-300">
                  <h5 className="font-medium text-red-800 mb-2">Locked After Submission</h5>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 text-red-500" />
                      <span>Form fields become read-only</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 text-red-500" />
                      <span>Signatures cannot be modified or re-signed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 text-red-500" />
                      <span>Sensitive fields (SSN/EIN/TIN) remain permanently masked</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 text-red-500" />
                      <span>Document uploads cannot be deleted</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sensitive Field Masking */}
            <Card className="border-rose-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Fingerprint className="h-5 w-5 text-rose-600" />
                  Sensitive Field Masking Flow
                </CardTitle>
                <CardDescription>
                  How SSN, EIN, and TIN fields are protected throughout the system
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-rose-50 p-4 rounded-lg border border-rose-200 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white p-3 rounded border text-center">
                      <div className="text-xs text-gray-500 mb-1">1. User Input</div>
                      <div className="font-mono text-sm">123-45-6789</div>
                      <div className="text-xs text-green-600 mt-1">Full value entered</div>
                    </div>
                    <div className="bg-white p-3 rounded border text-center">
                      <div className="text-xs text-gray-500 mb-1">2. Database Storage</div>
                      <div className="font-mono text-sm">Encrypted</div>
                      <div className="text-xs text-blue-600 mt-1">Full value stored securely</div>
                    </div>
                    <div className="bg-white p-3 rounded border text-center">
                      <div className="text-xs text-gray-500 mb-1">3. Display/API</div>
                      <div className="font-mono text-sm">***-**-6789</div>
                      <div className="text-xs text-rose-600 mt-1">Only last 4 shown</div>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Badge variant="destructive" className="text-xs">ssn</Badge>
                      <span>Format: <code className="bg-white px-1 rounded">***-**-1234</code></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Badge variant="destructive" className="text-xs">ein</Badge>
                      <span>Format: <code className="bg-white px-1 rounded">**-***1234</code></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Badge variant="destructive" className="text-xs">tin</Badge>
                      <span>Format: <code className="bg-white px-1 rounded">******1234</code></span>
                    </div>
                  </div>
                  <p className="text-xs text-rose-600">
                    <strong>Important:</strong> Masked fields cannot be re-entered after initial save. 
                    If correction is needed, the field must be cleared and fully re-entered.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* MCC Select */}
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  MCC Select (Merchant Category Code)
                </CardTitle>
                <CardDescription>
                  Searchable dropdown for selecting merchant category codes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2">Detection</h4>
                  <p className="text-sm text-blue-700 mb-3">
                    Fields containing "mcc" in the name are automatically converted to MCC selectors:
                  </p>
                  <div className="space-y-2 font-mono text-sm text-blue-600">
                    <div>business.mcc</div>
                    <div>merchant_mcc</div>
                    <div>primary_mcc_code</div>
                  </div>
                  <p className="text-sm text-blue-600 mt-3">
                    The selector includes all standard MCC codes with descriptions and is searchable.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* User Account */}
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-amber-600" />
                  User Account (Auto-Creation)
                </CardTitle>
                <CardDescription>
                  Automatically creates user accounts during form submission
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <p className="text-sm text-amber-700 mb-3">
                    This special field type creates a user account when the form is submitted. 
                    It requires an email field for the username and can optionally set a password.
                  </p>
                  <div className="bg-white p-3 rounded border border-amber-200">
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 mb-2">user_account</Badge>
                    <p className="text-xs text-gray-600">
                      Used for prospect portal access and automatic merchant account creation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Disclosure Fields */}
            <Card className="border-indigo-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  Disclosure Fields
                </CardTitle>
                <CardDescription>
                  Scrollable disclosures with mandatory read-through and signature acknowledgment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                  <h4 className="font-semibold text-indigo-800 mb-2">How Disclosures Work</h4>
                  <p className="text-sm text-indigo-700 mb-3">
                    Disclosure fields ensure prospects read important legal documents before signing.
                    The system tracks scroll position and only enables the signature after complete reading.
                  </p>
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-indigo-600">1</Badge>
                        <span className="text-sm font-medium">Scroll Tracking</span>
                      </div>
                      <p className="text-xs text-gray-600">Prospect must scroll through the entire disclosure content. Progress is tracked as a percentage.</p>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-indigo-600">2</Badge>
                        <span className="text-sm font-medium">Signature Unlock</span>
                      </div>
                      <p className="text-xs text-gray-600">After reading 100%, the signature area becomes enabled for signing.</p>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-indigo-600">3</Badge>
                        <span className="text-sm font-medium">Audit Trail</span>
                      </div>
                      <p className="text-xs text-gray-600">System captures: scroll start time, completion time, duration, IP address, and signature data.</p>
                    </div>
                  </div>
                </div>
                <div className="bg-indigo-100 p-3 rounded-lg border border-indigo-300">
                  <h5 className="font-medium text-indigo-800 mb-2">Disclosure Field Pattern</h5>
                  <div className="space-y-1 font-mono text-sm">
                    <div>disclosures.termsOfService.scrolledAt</div>
                    <div>disclosures.termsOfService.scrollDurationMs</div>
                    <div>disclosures.termsOfService.acknowledged</div>
                    <div>disclosures.termsOfService.signature.signerName</div>
                    <div>disclosures.termsOfService.signature.data</div>
                    <div>disclosures.termsOfService.signature.dateSigned</div>
                  </div>
                </div>
                <div className="p-3 bg-white rounded border border-indigo-200">
                  <p className="text-xs text-indigo-600">
                    <strong>Common Disclosures:</strong> Terms of Service, E-Sign Consent, Privacy Policy, 
                    Processing Agreement, Equipment Lease Terms
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Examples Tab */}
          <TabsContent value="examples" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Complete Field Name Examples</CardTitle>
                <CardDescription>
                  Reference examples for common merchant application fields
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Business Section */}
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <Building className="h-4 w-4" />
                      Business Information
                    </h4>
                    <div className="bg-gray-50 p-3 rounded-lg font-mono text-sm space-y-1">
                      <div><span className="text-gray-500">business.legalName</span> <span className="text-gray-400">// Legal business name</span></div>
                      <div><span className="text-gray-500">business.dbaName</span> <span className="text-gray-400">// Doing business as</span></div>
                      <div><span className="text-gray-500">business.entityType</span> <span className="text-gray-400">// LLC, Corp, Sole Prop, etc.</span></div>
                      <div><span className="text-gray-500">business.ein</span> <span className="text-gray-400">// Employer ID (masked)</span></div>
                      <div><span className="text-gray-500">business.stateOfIncorporation</span></div>
                      <div><span className="text-gray-500">business.dateEstablished</span></div>
                      <div><span className="text-gray-500">business.mcc</span> <span className="text-gray-400">// Merchant category code</span></div>
                      <div><span className="text-gray-500">business.website</span></div>
                    </div>
                  </div>

                  {/* Location Section */}
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Location & Contact
                    </h4>
                    <div className="bg-gray-50 p-3 rounded-lg font-mono text-sm space-y-1">
                      <div><span className="text-gray-500">location.address.street1</span></div>
                      <div><span className="text-gray-500">location.address.street2</span></div>
                      <div><span className="text-gray-500">location.address.city</span></div>
                      <div><span className="text-gray-500">location.address.state</span></div>
                      <div><span className="text-gray-500">location.address.postalcode</span></div>
                      <div><span className="text-gray-500">location.phone</span></div>
                      <div><span className="text-gray-500">location.email</span></div>
                    </div>
                  </div>

                  {/* Owner Section */}
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Owner/Principal Information
                    </h4>
                    <div className="bg-gray-50 p-3 rounded-lg font-mono text-sm space-y-1">
                      <div><span className="text-gray-500">owners.1.firstName</span></div>
                      <div><span className="text-gray-500">owners.1.lastName</span></div>
                      <div><span className="text-gray-500">owners.1.title</span></div>
                      <div><span className="text-gray-500">owners.1.ownershipPercent</span></div>
                      <div><span className="text-gray-500">owners.1.ssn</span> <span className="text-gray-400">// Masked after entry</span></div>
                      <div><span className="text-gray-500">owners.1.dateOfBirth</span></div>
                      <div><span className="text-gray-500">owners.1.email</span></div>
                      <div><span className="text-gray-500">owners.1.phone</span></div>
                      <div><span className="text-gray-500">owners.1.address.street1</span></div>
                      <div><span className="text-gray-500">owners.1.address.city</span></div>
                      <div><span className="text-gray-500">owners.1.address.state</span></div>
                      <div><span className="text-gray-500">owners.1.address.postalcode</span></div>
                      <div><span className="text-gray-500">owners.1.signature.signerName</span></div>
                      <div><span className="text-gray-500">owners.1.signature.signature</span></div>
                      <div><span className="text-gray-500">owners.1.signature.dateSigned</span></div>
                    </div>
                  </div>

                  {/* Banking Section */}
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      Banking Information
                    </h4>
                    <div className="bg-gray-50 p-3 rounded-lg font-mono text-sm space-y-1">
                      <div><span className="text-gray-500">banking.bankName</span></div>
                      <div><span className="text-gray-500">banking.routingNumber</span></div>
                      <div><span className="text-gray-500">banking.accountNumber</span></div>
                      <div><span className="text-gray-500">banking.accountType</span> <span className="text-gray-400">// Checking, Savings</span></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5" />
                  Legacy Format Support
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-amber-700 mb-3">
                  The system also supports legacy underscore-delimited field names for backward compatibility:
                </p>
                <div className="bg-white p-3 rounded border border-amber-200 font-mono text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500">owners_owner1_firstName</span>
                    <span className="text-amber-600">→</span>
                    <span className="text-green-600">owners.1.firstName</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500">merchant_location_address_city</span>
                    <span className="text-amber-600">→</span>
                    <span className="text-green-600">location.address.city</span>
                  </div>
                </div>
                <p className="text-xs text-amber-600 mt-2">
                  Legacy names are automatically converted to the new format during import.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}