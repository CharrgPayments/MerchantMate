import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Save, Send, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PdfFormField {
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
  status: string;
}

interface PdfFormSubmission {
  id: number;
  formId: number;
  submissionToken: string;
  applicantEmail: string | null;
  data: string;
  status: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SubmissionResponse {
  submission: PdfFormSubmission;
  form: PdfForm;
}

export default function PublicForm() {
  const { token } = useParams<{ token: string }>();
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [currentSection, setCurrentSection] = useState(0);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch submission data and form details
  const { data: submissionData, isLoading, error } = useQuery<SubmissionResponse>({
    queryKey: ['/api/submissions', token],
    enabled: !!token,
  });

  // Fetch form fields
  const { data: fields = [] } = useQuery<PdfFormField[]>({
    queryKey: ['/api/pdf-forms', submissionData?.form.id, 'fields'],
    enabled: !!submissionData?.form.id,
  });

  // Auto-save mutation
  const autoSaveMutation = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/submissions/${token}`, 'PUT', { data, status: 'draft' }),
    onSuccess: () => {
      setIsAutoSaving(false);
    },
    onError: () => {
      setIsAutoSaving(false);
      toast({
        title: "Auto-save failed",
        description: "Your changes couldn't be saved automatically.",
        variant: "destructive",
      });
    }
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/submissions/${token}`, 'PUT', { data, status: 'submitted' }),
    onSuccess: () => {
      toast({
        title: "Form submitted successfully",
        description: "Thank you for your submission. We'll review it and get back to you soon.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/submissions', token] });
    },
    onError: () => {
      toast({
        title: "Submission failed",
        description: "Please try again or contact support if the problem persists.",
        variant: "destructive",
      });
    }
  });

  // Initialize form data from submission
  useEffect(() => {
    if (submissionData?.submission?.data) {
      try {
        const parsedData = JSON.parse(submissionData.submission.data);
        setFormData(parsedData);
      } catch (e) {
        console.error("Error parsing submission data:", e);
      }
    }
  }, [submissionData]);

  // Auto-save on form data changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (Object.keys(formData).length > 0 && submissionData?.submission.status === 'draft') {
        setIsAutoSaving(true);
        autoSaveMutation.mutate(formData);
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [formData]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = () => {
    submitMutation.mutate(formData);
  };

  // Group fields by section
  const sections = fields.reduce((acc, field) => {
    const section = field.section || 'General Information';
    if (!acc[section]) acc[section] = [];
    acc[section].push(field);
    return acc;
  }, {} as Record<string, PdfFormField[]>);

  const sectionNames = Object.keys(sections);
  const currentSectionName = sectionNames[currentSection] || 'General Information';
  const currentFields = sections[currentSectionName] || [];

  // Calculate progress
  const totalFields = fields.length;
  const filledFields = fields.filter(field => 
    formData[field.fieldName] && formData[field.fieldName] !== ''
  ).length;
  const progress = totalFields > 0 ? (filledFields / totalFields) * 100 : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading form...</p>
        </div>
      </div>
    );
  }

  if (error || !submissionData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center text-red-600">
              <AlertCircle className="mr-2 h-5 w-5" />
              Form Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              The form submission link you're looking for doesn't exist or has expired.
            </p>
            <p className="text-sm text-gray-500">
              Please contact the sender for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSubmitted = submissionData.submission.status === 'submitted';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {submissionData.form.name}
              </h1>
              <p className="text-gray-600 mt-1">
                {submissionData.form.description}
              </p>
            </div>
            <Badge variant={isSubmitted ? "default" : "secondary"}>
              {isSubmitted ? "Submitted" : "Draft"}
            </Badge>
          </div>
          
          {!isSubmitted && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Progress</span>
                <span>{Math.round(progress)}% complete</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {submissionData.submission.applicantEmail && (
            <p className="text-sm text-gray-500">
              Form for: {submissionData.submission.applicantEmail}
            </p>
          )}
        </div>

        {isSubmitted ? (
          <Card>
            <CardContent className="p-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Form Submitted Successfully
              </h2>
              <p className="text-gray-600 mb-4">
                Thank you for your submission. We'll review your application and get back to you soon.
              </p>
              <p className="text-sm text-gray-500">
                Submitted on {new Date(submissionData.submission.updatedAt).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Section Navigation */}
            {sectionNames.length > 1 && (
              <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <div className="flex space-x-2 overflow-x-auto">
                  {sectionNames.map((sectionName, index) => (
                    <Button
                      key={sectionName}
                      variant={index === currentSection ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentSection(index)}
                      className="whitespace-nowrap"
                    >
                      {sectionName}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Form Fields */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {currentSectionName}
                  {isAutoSaving && (
                    <div className="flex items-center text-sm text-gray-500">
                      <Save className="h-4 w-4 mr-1 animate-pulse" />
                      Saving...
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {currentFields.map((field) => (
                  <div key={field.id} className="space-y-2">
                    <Label htmlFor={field.fieldName} className="text-sm font-medium">
                      {field.fieldLabel}
                      {field.isRequired && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    
                    {field.fieldType === 'text' && (
                      <Input
                        id={field.fieldName}
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                        placeholder={field.defaultValue || ''}
                      />
                    )}
                    
                    {field.fieldType === 'email' && (
                      <Input
                        id={field.fieldName}
                        type="email"
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                        placeholder={field.defaultValue || ''}
                      />
                    )}
                    
                    {field.fieldType === 'phone' && (
                      <Input
                        id={field.fieldName}
                        type="tel"
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                        placeholder={field.defaultValue || ''}
                      />
                    )}
                    
                    {field.fieldType === 'number' && (
                      <Input
                        id={field.fieldName}
                        type="number"
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                        placeholder={field.defaultValue || ''}
                      />
                    )}
                    
                    {field.fieldType === 'date' && (
                      <Input
                        id={field.fieldName}
                        type="date"
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                      />
                    )}
                    
                    {field.fieldType === 'textarea' && (
                      <Textarea
                        id={field.fieldName}
                        value={formData[field.fieldName] || ''}
                        onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                        placeholder={field.defaultValue || ''}
                        rows={4}
                      />
                    )}
                    
                    {field.fieldType === 'select' && field.options && (
                      <Select
                        value={formData[field.fieldName] || ''}
                        onValueChange={(value) => handleFieldChange(field.fieldName, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an option" />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    
                    {field.fieldType === 'checkbox' && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={field.fieldName}
                          checked={formData[field.fieldName] || false}
                          onCheckedChange={(checked) => handleFieldChange(field.fieldName, checked)}
                        />
                        <Label htmlFor={field.fieldName} className="text-sm">
                          {field.fieldLabel}
                        </Label>
                      </div>
                    )}
                  </div>
                ))}

                {/* Navigation and Submit */}
                <div className="flex justify-between pt-6 border-t">
                  <div className="flex space-x-2">
                    {currentSection > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => setCurrentSection(currentSection - 1)}
                      >
                        Previous
                      </Button>
                    )}
                  </div>
                  
                  <div className="flex space-x-2">
                    {currentSection < sectionNames.length - 1 ? (
                      <Button
                        onClick={() => setCurrentSection(currentSection + 1)}
                      >
                        Next
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSubmit}
                        disabled={submitMutation.isPending}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {submitMutation.isPending ? 'Submitting...' : 'Submit Form'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}