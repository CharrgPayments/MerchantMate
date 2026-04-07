import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, Building2 } from 'lucide-react';
import DynamicFormRenderer, { type FormConfiguration, type ConditionalFields } from '@/components/forms/DynamicFormRenderer';
import { useToast } from '@/hooks/use-toast';
import type { Acquirer, AcquirerApplicationTemplate } from '@shared/schema';

export default function FormDemoPage() {
  const [selectedAcquirerId, setSelectedAcquirerId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const { toast } = useToast();

  // Fetch acquirers
  const { data: acquirers, isLoading: loadingAcquirers } = useQuery({
    queryKey: ['/api/acquirers'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch application templates for selected acquirer
  const { data: templates, isLoading: loadingTemplates } = useQuery({
    queryKey: ['/api/acquirer-application-templates', selectedAcquirerId],
    queryFn: async () => {
      if (!selectedAcquirerId) return [];
      const response = await fetch(`/api/acquirer-application-templates?acquirerId=${selectedAcquirerId}`, {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedAcquirerId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch specific template
  const { data: templateData, isLoading: loadingTemplate } = useQuery({
    queryKey: ['/api/acquirer-application-templates', selectedTemplateId],
    queryFn: async () => {
      if (!selectedTemplateId) return null;
      const response = await fetch(`/api/acquirer-application-templates/${selectedTemplateId}`, {
        credentials: 'include'
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!selectedTemplateId,
    staleTime: 5 * 60 * 1000,
  });

  // Form submission mutation
  const submitMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      // This would normally create a prospect application
      console.log('Form submission data:', formData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return { success: true, message: 'Application submitted successfully!' };
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Application submitted successfully!',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to submit application',
        variant: 'destructive',
      });
    },
  });

  // Save draft mutation
  const saveMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      console.log('Saving draft:', formData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: 'Draft Saved',
        description: 'Your progress has been saved successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save draft',
        variant: 'destructive',
      });
    },
  });

  const handleFormSubmit = (data: Record<string, any>) => {
    submitMutation.mutate(data);
  };

  const handleSaveDraft = (data: Record<string, any>) => {
    saveMutation.mutate(data);
  };

  const selectedAcquirer = (acquirers as Acquirer[])?.find((a: Acquirer) => a.id.toString() === selectedAcquirerId);
  const selectedTemplate = (templates as AcquirerApplicationTemplate[])?.find((t: AcquirerApplicationTemplate) => t.id.toString() === selectedTemplateId);

  if (loadingAcquirers) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading acquirers...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="page-form-demo">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Dynamic Form Demo
        </h1>
        <p className="text-muted-foreground">
          Test the dynamic form renderer with real acquirer application templates
        </p>
      </div>

      {/* Acquirer Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Acquirer & Template
          </CardTitle>
          <CardDescription>
            Choose an acquirer and application template to render the dynamic form
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-2 block">Acquirer</label>
              <Select 
                value={selectedAcquirerId} 
                onValueChange={setSelectedAcquirerId}
                data-testid="select-acquirer"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an acquirer" />
                </SelectTrigger>
                <SelectContent>
                  {(acquirers as Acquirer[])?.map((acquirer: Acquirer) => (
                    <SelectItem key={acquirer.id} value={acquirer.id.toString()}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{acquirer.code}</Badge>
                        {acquirer.displayName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Application Template</label>
              <Select 
                value={selectedTemplateId} 
                onValueChange={setSelectedTemplateId}
                disabled={!selectedAcquirerId || loadingTemplates}
                data-testid="select-template"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {(templates as AcquirerApplicationTemplate[])?.map((template: AcquirerApplicationTemplate) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {template.templateName} v{template.version}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedAcquirer && selectedTemplate && (
            <div className="bg-muted/50 p-4 rounded-lg">
              <h4 className="font-medium mb-2">Selected Configuration</h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  <span className="font-medium">Acquirer:</span> {selectedAcquirer.displayName}
                </div>
                <div>
                  <span className="font-medium">Template:</span> {selectedTemplate.templateName} v{selectedTemplate.version}
                </div>
                <div>
                  <span className="font-medium">Required Fields:</span> {selectedTemplate.requiredFields?.length || 0}
                </div>
                <div>
                  <span className="font-medium">Status:</span> 
                  <Badge variant={selectedTemplate.isActive ? "default" : "secondary"} className="ml-1">
                    {selectedTemplate.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dynamic Form */}
      {selectedTemplateId && (
        <div data-testid="dynamic-form-container">
          {loadingTemplate ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="ml-2">Loading template...</span>
                </div>
              </CardContent>
            </Card>
          ) : (templateData as any)?.fieldConfiguration ? (
            <div>
              <div className="mb-4">
                <h2 className="text-xl font-semibold">
                  {selectedAcquirer?.displayName} - {selectedTemplate?.templateName}
                </h2>
                <p className="text-muted-foreground">
                  Complete the application form below. Fields marked with * are required.
                </p>
              </div>
              
              <DynamicFormRenderer
                configuration={(templateData as any).fieldConfiguration as FormConfiguration}
                conditionalFields={(templateData as any).conditionalFields as ConditionalFields}
                requiredFields={(templateData as any).requiredFields || []}
                onSubmit={handleFormSubmit}
                onSave={handleSaveDraft}
                isSubmitting={submitMutation.isPending}
                isSaving={saveMutation.isPending}
                submitLabel="Submit Application"
                saveLabel="Save Draft"
                allowSave={true}
                className="max-w-6xl"
              />
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Template Configuration</h3>
                <p className="text-muted-foreground">
                  The selected template doesn't have a valid field configuration.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Instructions */}
      {!selectedTemplateId && (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Getting Started</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Select an acquirer and application template above to see the dynamic form renderer in action. 
              The form will be generated based on the field configuration JSON.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}