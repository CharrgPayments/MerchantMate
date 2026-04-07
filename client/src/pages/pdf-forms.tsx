import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileText, CheckCircle, Clock, AlertCircle, Edit2, Check, X, Settings, Navigation, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface PdfForm {
  id: number;
  name: string;
  description: string;
  fileName: string;
  fileSize: number;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  uploadedBy: string;
  showInNavigation: boolean;
  navigationTitle: string | null;
  allowedRoles: string[];
}

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
}

interface PdfFormWithFields extends PdfForm {
  fields: FormField[];
}

export default function PdfFormsPage() {
  const [location] = useLocation();
  const { user } = useAuth();

  // Check if user has admin access
  const userRoles = (user as any)?.roles || [];
  const hasAdminAccess = userRoles.includes('admin') || userRoles.includes('super_admin');

  // If user doesn't have admin access, show access denied
  if (!hasAdminAccess) {
    return (
      <div className="container mx-auto py-8">
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center space-y-4">
              <Shield className="h-12 w-12 text-red-500" />
              <h2 className="text-xl font-semibold text-center">Access Denied</h2>
              <p className="text-sm text-muted-foreground text-center">
                You need administrator privileges to access PDF Forms management.
              </p>
              <Button onClick={() => window.history.back()} variant="outline">
                Go Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("upload");
  const [editingFormId, setEditingFormId] = useState<number | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [showNavSettings, setShowNavSettings] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Add error boundary for debugging
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch current user to check admin role
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: 3,
    staleTime: 5 * 60 * 1000,
  });

  // Check if current user is admin
  const isAdmin = currentUser?.role === 'admin' || 
                  currentUser?.role === 'super_admin' ||
                  (currentUser?.id && currentUser.id.includes('admin'));

  // Fetch all PDF forms with proper error handling
  const { data: pdfForms, isLoading: formsLoading, error: formsError, refetch } = useQuery<PdfForm[]>({
    queryKey: ['/api/pdf-forms'],
    queryFn: async () => {
      const response = await fetch('/api/pdf-forms', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response.json();
    },
    retry: 1,
    retryDelay: 1000
  });

  // Handle query effects and force refresh
  React.useEffect(() => {
    if (pdfForms) {
      console.log('PDF Forms data loaded:', pdfForms);
      console.log('Number of forms:', pdfForms.length);
      setHasError(false);
      setErrorMessage('');
    }
    if (formsError) {
      console.error('PDF Forms query error:', formsError);
      console.error('Error details:', formsError.message);
      setErrorMessage(`Failed to load PDF forms: ${formsError.message || 'Unknown error'}`);
      setHasError(true);
    }
  }, [pdfForms, formsError]);

  // Handle formId query parameter to auto-switch to forms tab
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const formId = urlParams.get('formId');
    if (formId) {
      setActiveTab('forms');
    }
  }, [location]);

  // Add refresh button for debugging
  const handleRefresh = () => {
    console.log('Manually refreshing PDF forms...');
    refetch();
  };

  // Upload PDF form mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('pdf', file);
      
      const response = await fetch('/api/pdf-forms/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "PDF Form Uploaded Successfully",
        description: `Converted ${data.totalFields} form fields into interactive wizard`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-forms'] });
      setSelectedFile(null);
      setUploadProgress(0);
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
      setUploadProgress(0);
    }
  });

  // Update form metadata mutation
  const updateFormMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: { name?: string; description?: string } }) => {
      const response = await apiRequest('PATCH', `/api/pdf-forms/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Form Updated",
        description: "Form title and description have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-forms'] });
      setEditingFormId(null);
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "There was an error updating the form.",
        variant: "destructive",
      });
    }
  });

  // Update navigation settings mutation
  const updateNavigationMutation = useMutation({
    mutationFn: async ({ 
      id, 
      showInNavigation, 
      navigationTitle, 
      allowedRoles 
    }: { 
      id: number; 
      showInNavigation: boolean; 
      navigationTitle: string | null; 
      allowedRoles: string[] 
    }) => {
      const response = await apiRequest('PATCH', `/api/pdf-forms/${id}`, {
        showInNavigation,
        navigationTitle,
        allowedRoles
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Navigation Updated",
        description: "Navigation settings have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-forms'] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "There was an error updating navigation settings.",
        variant: "destructive",
      });
    }
  });



  // Edit handlers
  const handleEdit = (form: PdfForm) => {
    setEditingFormId(form.id);
    setEditedTitle(form.name);
    setEditedDescription(form.description);
  };

  const handleSave = (formId: number) => {
    updateFormMutation.mutate({
      id: formId,
      updates: {
        name: editedTitle,
        description: editedDescription
      }
    });
  };

  const handleCancel = () => {
    setEditingFormId(null);
    setEditedTitle('');
    setEditedDescription('');
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else {
      toast({
        title: "Invalid File Type",
        description: "Please select a PDF file",
        variant: "destructive",
      });
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      setUploadProgress(10);
      uploadMutation.mutate(selectedFile);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'inactive':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Inactive</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" />Unknown</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="upload">Upload Wells Fargo MPA</TabsTrigger>
            <TabsTrigger value="forms">Application Forms</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  Upload Merchant Application PDF
                </CardTitle>
                <CardDescription>
                  Upload a PDF form (like Wells Fargo MPA) to automatically convert it into an interactive wizard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="pdf-upload">Select PDF File</Label>
                  <Input
                    id="pdf-upload"
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    className="cursor-pointer"
                  />
                  {selectedFile && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                </div>

                <Button 
                  onClick={handleUpload}
                  disabled={!selectedFile || uploadMutation.isPending}
                  className="w-full"
                >
                  {uploadMutation.isPending ? (
                    <>Processing PDF...</>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Convert to Interactive Form
                    </>
                  )}
                </Button>

                {uploadMutation.isPending && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                      <Clock className="w-4 h-4 animate-spin" />
                      <span className="font-medium">Processing PDF...</span>
                    </div>
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                      Analyzing form structure and extracting field definitions
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="forms">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">PDF Forms</h2>
                <Badge variant="outline">
                  {pdfForms ? pdfForms.length : 0} forms
                </Badge>
              </div>

              {formsLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader>
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                      </CardHeader>
                      <CardContent>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : pdfForms && Array.isArray(pdfForms) && pdfForms.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pdfForms.map((form: PdfForm) => (
                    <Card key={form.id} className="hover:shadow-md transition-shadow">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {editingFormId === form.id ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-5 h-5 flex-shrink-0" />
                                  <Input
                                    value={editedTitle}
                                    onChange={(e) => setEditedTitle(e.target.value)}
                                    className="text-lg font-semibold"
                                    placeholder="Form title"
                                  />
                                  <Button size="sm" variant="ghost" onClick={() => handleSave(form.id)}>
                                    <Check className="w-4 h-4 text-green-600" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={handleCancel}>
                                    <X className="w-4 h-4 text-red-600" />
                                  </Button>
                                </div>
                                <Textarea
                                  value={editedDescription}
                                  onChange={(e) => setEditedDescription(e.target.value)}
                                  className="text-sm"
                                  placeholder="Form description"
                                  rows={2}
                                />
                              </div>
                            ) : (
                              <div className="group">
                                <CardTitle className="text-lg flex items-center gap-2">
                                  <FileText className="w-5 h-5" />
                                  {form.name}
                                  {isAdmin && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleEdit(form)}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                  {form.description}
                                </CardDescription>
                              </div>
                            )}
                          </div>
                          {getStatusBadge(form.status)}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Original File:</span>
                            <span className="font-medium">{form.fileName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Created:</span>
                            <span className="font-medium">
                              {new Date(form.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {/* Navigation Settings (Admin Only) */}
                        {isAdmin && (
                          <div className="mt-4 p-3 border rounded-lg bg-gray-50 dark:bg-gray-800">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-medium flex items-center gap-2">
                                <Navigation className="w-4 h-4" />
                                Navigation Settings
                              </h4>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowNavSettings(showNavSettings === form.id ? null : form.id)}
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                            </div>
                            
                            {showNavSettings === form.id && (
                              <div className="space-y-3">
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`nav-${form.id}`}
                                    checked={form.showInNavigation || false}
                                    onCheckedChange={(checked) => {
                                      updateNavigationMutation.mutate({
                                        id: form.id,
                                        showInNavigation: checked as boolean,
                                        navigationTitle: form.navigationTitle,
                                        allowedRoles: form.allowedRoles || ['admin']
                                      });
                                    }}
                                  />
                                  <Label htmlFor={`nav-${form.id}`} className="text-sm">
                                    Show in sidebar navigation
                                  </Label>
                                </div>
                                
                                {form.showInNavigation && (
                                  <>
                                    <div>
                                      <Label htmlFor={`nav-title-${form.id}`} className="text-xs text-gray-600">
                                        Navigation Title (optional)
                                      </Label>
                                      <Input
                                        id={`nav-title-${form.id}`}
                                        placeholder={form.name}
                                        defaultValue={form.navigationTitle || ''}
                                        onBlur={(e) => {
                                          updateNavigationMutation.mutate({
                                            id: form.id,
                                            showInNavigation: form.showInNavigation,
                                            navigationTitle: e.target.value || null,
                                            allowedRoles: form.allowedRoles || ['admin']
                                          });
                                        }}
                                        className="mt-1"
                                      />
                                    </div>
                                    
                                    <div>
                                      <Label className="text-xs text-gray-600">
                                        Allowed Roles
                                      </Label>
                                      <Select
                                        defaultValue={form.allowedRoles?.join(',') || 'admin'}
                                        onValueChange={(value) => {
                                          const roles = value.split(',');
                                          updateNavigationMutation.mutate({
                                            id: form.id,
                                            showInNavigation: form.showInNavigation,
                                            navigationTitle: form.navigationTitle,
                                            allowedRoles: roles
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="mt-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="admin">Admin Only</SelectItem>
                                          <SelectItem value="admin,agent">Admin & Agent</SelectItem>
                                          <SelectItem value="admin,agent,merchant">Admin, Agent & Merchant</SelectItem>
                                          <SelectItem value="admin,agent,merchant,corporate">All Roles</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 space-y-2">
                          <Button 
                            className="w-full" 
                            onClick={() => window.location.href = `/enhanced-pdf-wizard/${form.id}`}
                          >
                            Open Form Wizard
                          </Button>
                          <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={() => window.location.href = `/pdf-forms/${form.id}/submissions`}
                          >
                            View Applications
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FileText className="w-12 h-12 text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                      No PDF Forms Yet
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 text-center mb-4">
                      Upload your first PDF form to get started with the interactive wizard
                    </p>
                    <Button onClick={() => document.querySelector('[value="upload"]')?.click()}>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Your First Form
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
    </div>
  );
}