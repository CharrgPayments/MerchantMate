import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle, Edit2, Check, X, Settings, Navigation, Play, Calendar, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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

export default function MerchantApplicationPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [editingFormId, setEditingFormId] = useState<number | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [showNavSettings, setShowNavSettings] = useState<number | null>(null);
  const [formStarted, setFormStarted] = useState(false);
  const [fieldsInteracted, setFieldsInteracted] = useState(new Set<string>());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get form ID from URL parameter or default to form 1
  const formId = id ? parseInt(id) : 1;
  
  // Check for prospect validation token in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const prospectToken = urlParams.get('token');
  const isProspectMode = !!prospectToken;

  // Fetch prospect data if token is present
  const { data: prospectData } = useQuery({
    queryKey: ['/api/prospects/token', prospectToken],
    queryFn: async () => {
      if (!prospectToken) return null;
      const response = await fetch(`/api/prospects/token/${prospectToken}`);
      if (!response.ok) throw new Error('Invalid prospect token');
      return response.json();
    },
    enabled: !!prospectToken,
  });

  // Fetch current user to check admin role (only if not a prospect)
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: 3,
    staleTime: 5 * 60 * 1000,
    enabled: !isProspectMode, // Only fetch user data if not accessing as prospect
  });

  // Check if current user is admin
  const isAdmin = (currentUser as any)?.role === 'admin' || 
                  (currentUser as any)?.role === 'super_admin' ||
                  ((currentUser as any)?.id && (currentUser as any).id.includes('admin'));

  // Fetch the specific PDF form (only for authenticated users, not prospects)
  const { data: pdfForm, isLoading: formLoading, error: formError } = useQuery<PdfForm>({
    queryKey: ['/api/pdf-forms', formId],
    queryFn: async () => {
      const response = await fetch(`/api/pdf-forms/${formId}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch form');
      }
      return response.json();
    },
    enabled: false // Disable this query entirely for now since we're handling prospect mode
  });

  // Mutation to update prospect status to "in progress"
  const updateProspectStatusMutation = useMutation({
    mutationFn: async (prospectId: number) => {
      const response = await fetch(`/api/prospects/${prospectId}/start-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to update prospect status');
      }
      
      return response.json();
    },
  });

  // Update form mutation
  const updateFormMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<PdfForm> }) => {
      const response = await fetch(`/api/pdf-forms/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update form');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Form Updated",
        description: "Form details have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pdf-forms'] });
      setEditingFormId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = (form: PdfForm) => {
    setEditingFormId(form.id);
    setEditedTitle(form.name);
    setEditedDescription(form.description || '');
  };

  const handleSave = () => {
    if (editingFormId && editedTitle.trim()) {
      updateFormMutation.mutate({
        id: editingFormId,
        data: {
          name: editedTitle.trim(),
          description: editedDescription.trim()
        }
      });
    }
  };

  const handleCancel = () => {
    setEditingFormId(null);
    setEditedTitle('');
    setEditedDescription('');
  };

  const handleNavigationUpdate = (formId: number, settings: { showInNavigation: boolean; navigationTitle: string; allowedRoles: string[] }) => {
    updateFormMutation.mutate({
      id: formId,
      data: settings
    });
    setShowNavSettings(null);
  };

  // Track when user starts filling out the form and update prospect status
  const handleFieldInteraction = (fieldName: string) => {
    if (!prospectData?.prospect || formStarted) return;

    const newFieldsInteracted = new Set(fieldsInteracted);
    newFieldsInteracted.add(fieldName);
    setFieldsInteracted(newFieldsInteracted);

    // Check if user has interacted with the first 3 required fields
    const requiredFirstFields = ['companyName', 'federalTaxId', 'companyEmail'];
    const hasInteractedWithFirstThree = requiredFirstFields.every(field => 
      newFieldsInteracted.has(field)
    );

    if (hasInteractedWithFirstThree && !formStarted) {
      setFormStarted(true);
      updateProspectStatusMutation.mutate(prospectData.prospect.id);
    }
  };

  // For prospect mode, show simplified interface
  if (isProspectMode) {
    if (!prospectData) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full">
            <Card className="border-0 shadow-lg">
              <CardHeader className="text-center pb-6">
                <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <CardTitle className="text-xl font-semibold text-gray-900">
                  Loading Application
                </CardTitle>
                <p className="text-sm text-gray-600 mt-2">
                  Please wait while we prepare your merchant application...
                </p>
              </CardHeader>
            </Card>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Merchant Processing Application</h1>
            <p className="text-gray-600">
              Welcome {prospectData.prospect.firstName} {prospectData.prospect.lastName}! 
              Complete your merchant application below.
            </p>
          </div>
          
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Merchant Processing Application
              </CardTitle>
              <CardDescription>
                Please fill out all required fields to complete your merchant application.
              </CardDescription>
            </CardHeader>
            
            <CardContent className="p-6">
              <Button 
                onClick={() => setLocation(`/enhanced-pdf-wizard/1?token=${prospectToken}`)}
                className="w-full"
                size="lg"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Application
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (formLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="animate-pulse space-y-6">
          <div>
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
          </div>
          <Card>
            <CardHeader>
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            </CardHeader>
            <CardContent>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (formError || !pdfForm) {
    return (
      <div className="p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Merchant Application Not Found</h1>
          <p className="text-gray-600 mb-4">The requested merchant application form could not be found.</p>
          <Button onClick={() => setLocation('/pdf-forms')}>
            Go to All Forms
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {editingFormId === pdfForm.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 flex-shrink-0" />
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="text-lg font-semibold"
                        placeholder="Form title"
                      />
                    </div>
                    <Textarea
                      value={editedDescription}
                      onChange={(e) => setEditedDescription(e.target.value)}
                      placeholder="Form description"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSave}>
                        <Check className="w-4 h-4 mr-1" />
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleCancel}>
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                      <CardTitle className="text-lg font-semibold">Merchant Application</CardTitle>
                      {isAdmin && (
                        <Button size="sm" variant="ghost" onClick={() => handleEdit(pdfForm)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <CardDescription className="text-base">
                      {pdfForm.name} - {pdfForm.description}
                    </CardDescription>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                <Badge variant={pdfForm.status === 'active' ? 'default' : 'secondary'}>
                  {pdfForm.status}
                </Badge>
                {pdfForm.showInNavigation && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Navigation className="w-3 h-3 mr-1" />
                    In Navigation
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>Created: {new Date(pdfForm.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>Uploaded by: {pdfForm.uploadedBy}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>File: {pdfForm.fileName}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-4 border-t">
              <Button onClick={() => setLocation(`/enhanced-pdf-wizard/${pdfForm.id}`)}>
                <Play className="w-4 h-4 mr-2" />
                Start Application
              </Button>
              
              {isAdmin && (
                <>
                  <Dialog open={showNavSettings === pdfForm.id} onOpenChange={(open) => setShowNavSettings(open ? pdfForm.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Settings className="w-4 h-4 mr-2" />
                        Navigation Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Navigation Settings</DialogTitle>
                        <DialogDescription>
                          Configure how this form appears in the sidebar navigation.
                        </DialogDescription>
                      </DialogHeader>
                      <NavigationSettingsForm
                        form={pdfForm}
                        onSave={(settings) => handleNavigationUpdate(pdfForm.id, settings)}
                        onCancel={() => setShowNavSettings(null)}
                      />
                    </DialogContent>
                  </Dialog>
                  
                  <Button variant="outline" onClick={() => setLocation('/pdf-forms')}>
                    <FileText className="w-4 h-4 mr-2" />
                    Manage All Forms
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
    </div>
  );
}

// Navigation Settings Form Component
function NavigationSettingsForm({ 
  form, 
  onSave, 
  onCancel 
}: { 
  form: PdfForm; 
  onSave: (settings: { showInNavigation: boolean; navigationTitle: string; allowedRoles: string[] }) => void;
  onCancel: () => void;
}) {
  const [showInNavigation, setShowInNavigation] = useState(form.showInNavigation);
  const [navigationTitle, setNavigationTitle] = useState(form.navigationTitle || form.name);
  const [allowedRoles, setAllowedRoles] = useState<string[]>(form.allowedRoles || ['admin']);

  const availableRoles = ['admin', 'agent', 'merchant', 'corporate', 'super_admin'];

  const handleSave = () => {
    onSave({
      showInNavigation,
      navigationTitle: navigationTitle.trim(),
      allowedRoles
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="showInNavigation"
          checked={showInNavigation}
          onCheckedChange={(checked) => setShowInNavigation(checked as boolean)}
        />
        <label htmlFor="showInNavigation" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          Show in sidebar navigation
        </label>
      </div>

      {showInNavigation && (
        <>
          <div className="space-y-2">
            <label htmlFor="navigationTitle" className="text-sm font-medium">
              Navigation Title
            </label>
            <Input
              id="navigationTitle"
              value={navigationTitle}
              onChange={(e) => setNavigationTitle(e.target.value)}
              placeholder="Title shown in navigation"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Allowed Roles</label>
            <div className="space-y-2">
              {availableRoles.map((role) => (
                <div key={role} className="flex items-center space-x-2">
                  <Checkbox
                    id={`role-${role}`}
                    checked={allowedRoles.includes(role)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setAllowedRoles([...allowedRoles, role]);
                      } else {
                        setAllowedRoles(allowedRoles.filter(r => r !== role));
                      }
                    }}
                  />
                  <label htmlFor={`role-${role}`} className="text-sm capitalize">
                    {role.replace('_', ' ')}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          Save Settings
        </Button>
      </DialogFooter>
    </div>
  );
}