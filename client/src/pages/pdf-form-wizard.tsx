import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Save, FileText, CheckCircle, Building, Clock, Users, Edit2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface FormField {
  id: number;
  fieldName: string;
  fieldType: string;
  fieldLabel: string;
  isRequired: boolean;
  options: string[] | null;
  defaultValue: string | null;
  validation: string | null;
  position: number;
  section: string | null;
}

interface PdfForm {
  id: number;
  name: string;
  description: string;
  fileName: string;
  fields: FormField[];
}

interface FormSection {
  name: string;
  fields: FormField[];
  icon: any;
  description: string;
}

export default function PdfFormWizard() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [currentSection, setCurrentSection] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Current user (shared cache via useAuth)
  const { user: currentUser, isLoading: isUserLoading } = useAuth();

  // Fetch PDF form with fields
  const { data: pdfForm, isLoading, error } = useQuery<PdfForm>({
    queryKey: ['/api/pdf-forms', id, 'with-fields'],
    enabled: !!id,
  });

  // Auto-save mutation
  const autoSaveMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await apiRequest('POST', `/api/pdf-forms/${id}/submissions`, {
        data: JSON.stringify(data),
        status: 'draft'
      });
      return response.json();
    },
    onSuccess: () => {
      setLastSaved(new Date());
    },
    onError: (error) => {
      console.error('Auto-save failed:', error);
    }
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await apiRequest('POST', `/api/pdf-forms/${id}/submissions`, {
        data: JSON.stringify(data),
        status: 'submitted'
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Form Submitted",
        description: "Your form has been submitted successfully.",
      });
      setLocation('/pdf-forms');
    },
    onError: (error) => {
      toast({
        title: "Submission Failed",
        description: "There was an error submitting your form.",
        variant: "destructive",
      });
    }
  });

  // Update form metadata mutation
  const updateFormMutation = useMutation({
    mutationFn: async (updates: { name?: string; description?: string }) => {
      const response = await apiRequest('PATCH', `/api/pdf-forms/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Form Updated",
        description: "Form title and description have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-forms', id, 'with-fields'] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "There was an error updating the form.",
        variant: "destructive",
      });
    }
  });

  // Group fields by section with icons and descriptions
  const sections: FormSection[] = pdfForm?.fields ? [
    {
      name: 'Merchant Information',
      description: 'Basic business details and contact information',
      icon: Building,
      fields: (pdfForm.fields as any).filter((f: any) => f.section === 'Merchant Information').sort((a: any, b: any) => a.position - b.position)
    },
    {
      name: 'Business Type & Tax Information',
      description: 'Business structure and tax identification details',
      icon: FileText,
      fields: (pdfForm.fields as any).filter((f: any) => f.section === 'Business Type & Tax Information').sort((a: any, b: any) => a.position - b.position)
    },
    {
      name: 'Products, Services & Processing',
      description: 'Business operations and processing requirements',
      icon: Users,
      fields: (pdfForm.fields as any).filter((f: any) => f.section === 'Products, Services & Processing').sort((a: any, b: any) => a.position - b.position)
    },
    {
      name: 'Transaction Information',
      description: 'Financial data and transaction processing details',
      icon: CheckCircle,
      fields: (pdfForm.fields as any).filter((f: any) => f.section === 'Transaction Information').sort((a: any, b: any) => a.position - b.position)
    }
  ].filter(section => section.fields.length > 0) : [];

  // Check if current user is admin - handle different user data structures
  const isAdmin = currentUser?.role === 'admin' || 
                  currentUser?.role === 'super_admin' ||
                  (currentUser?.id && currentUser.id.includes('admin'));

  // Initialize edit states when form loads
  useEffect(() => {
    if (pdfForm) {
      setEditedTitle(pdfForm.name);
      setEditedDescription(pdfForm.description);
    }
  }, [pdfForm]);

  // Handle field changes with auto-save
  const handleFieldChange = (fieldName: string, value: any) => {
    const newFormData = { ...formData, [fieldName]: value };
    setFormData(newFormData);
    
    // Debounced auto-save
    setTimeout(() => {
      autoSaveMutation.mutate(newFormData);
    }, 1000);
  };

  // Handle title editing
  const handleTitleEdit = () => {
    setIsEditingTitle(true);
    setEditedTitle(pdfForm?.name || '');
  };

  const handleTitleSave = () => {
    if (editedTitle.trim() && editedTitle !== pdfForm?.name) {
      updateFormMutation.mutate({ name: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setEditedTitle(pdfForm?.name || '');
    setIsEditingTitle(false);
  };

  // Handle description editing
  const handleDescriptionEdit = () => {
    setIsEditingDescription(true);
    setEditedDescription(pdfForm?.description || '');
  };

  const handleDescriptionSave = () => {
    if (editedDescription.trim() && editedDescription !== pdfForm?.description) {
      updateFormMutation.mutate({ description: editedDescription.trim() });
    }
    setIsEditingDescription(false);
  };

  const handleDescriptionCancel = () => {
    setEditedDescription(pdfForm?.description || '');
    setIsEditingDescription(false);
  };

  const handleNext = () => {
    if (currentSection < sections.length - 1) {
      setCurrentSection(currentSection + 1);
    }
  };

  const handlePrevious = () => {
    if (currentSection > 0) {
      setCurrentSection(currentSection - 1);
    }
  };

  const handleSubmit = () => {
    submitMutation.mutate(formData);
  };

  const renderField = (field: FormField) => {
    const value = formData[field.fieldName] || field.defaultValue || '';

    const fieldComponent = (() => {
      switch (field.fieldType) {
        case 'text':
        case 'email':
        case 'phone':
        case 'number':
          return (
            <Input
              type={field.fieldType === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              required={field.isRequired}
              placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
              className="w-full"
            />
          );
        
        case 'textarea':
          return (
            <Textarea
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              required={field.isRequired}
              placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
              rows={3}
              className="w-full"
            />
          );
        
        case 'select':
          const options = (field.options || []).filter(option => option && option.trim() !== '');
          return (
            <Select value={value} onValueChange={(val) => handleFieldChange(field.fieldName, val)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={`Select ${field.fieldLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option, index) => (
                  <SelectItem key={index} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        
        case 'checkbox':
          return (
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={value === true || value === 'true'}
                onCheckedChange={(checked) => handleFieldChange(field.fieldName, checked)}
              />
              <Label className="text-sm font-normal">{field.fieldLabel}</Label>
            </div>
          );
        
        case 'date':
          return (
            <Input
              type="date"
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              required={field.isRequired}
              className="w-full"
            />
          );
        
        default:
          return (
            <Input
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              required={field.isRequired}
              placeholder={field.fieldLabel}
              className="w-full"
            />
          );
      }
    })();

    if (field.fieldType === 'checkbox') {
      return fieldComponent;
    }

    return (
      <div className="space-y-2">
        <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.fieldLabel}
          {field.isRequired && <span className="text-red-500 ml-1">*</span>}
        </Label>
        {fieldComponent}
      </div>
    );
  };

  const currentSectionData = sections[currentSection];
  const progress = sections.length > 0 ? ((currentSection + 1) / sections.length) * 100 : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading form wizard...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfForm) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              Form Not Found
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              The requested PDF form could not be found.
            </p>
            <Button onClick={() => setLocation('/pdf-forms')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to PDF Forms
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              {/* Editable Title */}
              <div className="flex items-center space-x-2 group">
                {isEditingTitle ? (
                  <div className="flex items-center space-x-2 flex-1">
                    <Input
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      className="text-3xl font-bold border-none shadow-none p-0 h-auto focus-visible:ring-0"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTitleSave();
                        if (e.key === 'Escape') handleTitleCancel();
                      }}
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" onClick={handleTitleSave}>
                      <Check className="w-4 h-4 text-green-600" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleTitleCancel}>
                      <X className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <h1 className="text-3xl font-bold">
                      {pdfForm.name}
                    </h1>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleTitleEdit}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Editable Description */}
              <div className="flex items-center space-x-2 group mt-1">
                {isEditingDescription ? (
                  <div className="flex items-center space-x-2 flex-1">
                    <Textarea
                      value={editedDescription}
                      onChange={(e) => setEditedDescription(e.target.value)}
                      className="border-none shadow-none p-0 resize-none focus-visible:ring-0 min-h-0"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.ctrlKey) handleDescriptionSave();
                        if (e.key === 'Escape') handleDescriptionCancel();
                      }}
                      autoFocus
                    />
                    <div className="flex flex-col space-y-1">
                      <Button size="sm" variant="ghost" onClick={handleDescriptionSave}>
                        <Check className="w-4 h-4 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleDescriptionCancel}>
                        <X className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <p className="text-muted-foreground">
                      {pdfForm.description}
                    </p>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDescriptionEdit}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500 dark:text-gray-400">Progress</div>
            <div className="text-2xl font-bold text-blue-600">
              {Math.round(progress)}%
            </div>
          </div>
        </div>
        
        <Progress value={progress} className="h-2" />

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Form Sections</CardTitle>
                <CardDescription>Navigate through different sections</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {sections.map((section, index) => {
                  const IconComponent = section.icon;
                  return (
                    <button
                      key={index}
                      onClick={() => setCurrentSection(index)}
                      className={`w-full text-left p-3 rounded-lg transition-colors border ${
                        currentSection === index
                          ? 'bg-primary/5 border-primary/20 text-primary'
                          : 'bg-muted/50 border-border hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          currentSection === index 
                            ? 'bg-primary/10' 
                            : 'bg-muted'
                        }`}>
                          <IconComponent className={`w-4 h-4 ${
                            currentSection === index 
                              ? 'text-primary' 
                              : 'text-muted-foreground'
                          }`} />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{section.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {section.fields.length} fields
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Auto-save Status */}
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="flex items-center text-sm">
                    {autoSaveMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
                        <span className="text-primary">Saving...</span>
                      </>
                    ) : lastSaved ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          Saved {lastSaved.toLocaleTimeString()}
                        </span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 text-muted-foreground mr-2" />
                        <span className="text-muted-foreground">No changes yet</span>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Form Content */}
          <div className="lg:col-span-3">
            {currentSectionData && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl">{currentSectionData.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {currentSectionData.description}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">
                      Section {currentSection + 1} of {sections.length}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {currentSectionData.fields.map((field) => (
                      <div 
                        key={field.id} 
                        className={field.fieldType === 'textarea' ? 'md:col-span-2' : ''}
                      >
                        {renderField(field)}
                      </div>
                    ))}
                  </div>

                  {/* Navigation */}
                  <div className="flex justify-between items-center pt-6 border-t border-gray-200 dark:border-gray-700">
                    <Button
                      variant="outline"
                      onClick={handlePrevious}
                      disabled={currentSection === 0}
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Previous
                    </Button>

                    <div className="flex space-x-4">
                      {currentSection < sections.length - 1 ? (
                        <Button onClick={handleNext}>
                          Next Section
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      ) : (
                        <Button 
                          onClick={handleSubmit}
                          disabled={submitMutation.isPending}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {submitMutation.isPending ? 'Submitting...' : 'Submit Form'}
                          <CheckCircle className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}