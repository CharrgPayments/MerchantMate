import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  FileText, 
  Upload, 
  Download, 
  Trash2, 
  Bell, 
  CheckCircle, 
  Clock, 
  User, 
  LogOut,
  AlertCircle,
  Loader2,
  ClipboardList,
  Eye,
  EyeOff
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface Prospect {
  id: number;
  businessName: string;
  email: string;
  status: string;
  applicationStatus: string;
  userId: string | null;
}

interface ProspectDocument {
  id: number;
  prospectId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  createdAt: string;
  storageKey: string;
}

interface Notification {
  id: number;
  prospectId: number;
  subject: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

interface ApplicationField {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  sensitive?: boolean;
}

interface ApplicationSection {
  id: string;
  title: string;
  description?: string;
  fields: ApplicationField[];
}

interface ProspectApplication {
  id: number;
  prospectId: number;
  acquirerId: number;
  templateId: number;
  applicationData: Record<string, any>;
  status: string;
  submittedAt: string;
  template?: {
    templateName: string;
    formSections?: ApplicationSection[];
  };
}

export default function ProspectPortal() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [visibleSensitiveFields, setVisibleSensitiveFields] = useState<Record<string, boolean>>({});

  // Fetch prospect data
  const { data: prospectData, isLoading: prospectLoading, error: prospectError } = useQuery<{ prospect: Prospect }>({
    queryKey: ['/api/prospects/me'],
    queryFn: async () => {
      const res = await fetch('/api/prospects/me', {
        credentials: 'include',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch prospect data');
      }
      return res.json();
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: false, // Don't retry on failure
  });

  const prospect = prospectData?.prospect;

  // Fetch documents
  const { data: documentsData, isLoading: documentsLoading } = useQuery<{ documents: ProspectDocument[] }>({
    queryKey: ['/api/prospects', prospect?.id, 'documents'],
    enabled: !!prospect?.id,
    queryFn: async () => {
      const res = await fetch(`/api/prospects/${prospect?.id}/documents`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch documents');
      }
      return res.json();
    },
  });

  // Fetch notifications
  const { data: notificationsData, isLoading: notificationsLoading } = useQuery<{ notifications: Notification[] }>({
    queryKey: ['/api/prospects', prospect?.id, 'notifications'],
    enabled: !!prospect?.id,
    queryFn: async () => {
      const res = await fetch(`/api/prospects/${prospect?.id}/notifications`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch notifications');
      }
      return res.json();
    },
  });

  // Fetch unread count
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['/api/prospects', prospect?.id, 'notifications', 'unread-count'],
    enabled: !!prospect?.id,
    refetchInterval: 10000, // Refresh every 10 seconds
    queryFn: async () => {
      const res = await fetch(`/api/prospects/${prospect?.id}/notifications/unread-count`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch unread count');
      }
      return res.json();
    },
  });

  // Fetch application data
  const { data: applicationData, isLoading: applicationLoading } = useQuery<{ application: ProspectApplication | null }>({
    queryKey: ['/api/prospects', prospect?.id, 'application'],
    enabled: !!prospect?.id,
    queryFn: async () => {
      const res = await fetch(`/api/prospects/${prospect?.id}/application`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch application');
      }
      return res.json();
    },
  });

  // Helper to mask sensitive values (show only last 4 digits)
  const maskSensitiveValue = (value: string, fieldType: string): string => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    if (cleanValue.length >= 4) {
      return `***-**-${cleanValue.slice(-4)}`;
    }
    return '***';
  };

  // Helper to format field value for display
  const formatFieldValue = (value: any, field: ApplicationField): string => {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    
    // Handle sensitive fields
    if (field.sensitive && !visibleSensitiveFields[field.id]) {
      return maskSensitiveValue(String(value), field.type);
    }

    // Handle boolean values
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    // Handle objects (like addresses)
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      // Try to format as address
      if (value.street || value.city || value.state) {
        const parts = [value.street, value.street2, value.city, value.state, value.zipCode].filter(Boolean);
        return parts.join(', ');
      }
      return JSON.stringify(value);
    }

    return String(value);
  };

  // Toggle sensitive field visibility
  const toggleSensitiveField = (fieldId: string) => {
    setVisibleSensitiveFields(prev => ({
      ...prev,
      [fieldId]: !prev[fieldId]
    }));
  };

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Logged Out",
        description: "You have been successfully logged out",
      });
      window.location.href = "/";
    },
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      await apiRequest("PATCH", `/api/prospects/${prospect?.id}/notifications/${notificationId}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospect?.id, 'notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospect?.id, 'notifications', 'unread-count'] });
    },
  });

  // File upload handler
  const handleFileUpload = async () => {
    if (!selectedFile || !prospect) return;

    setIsUploading(true);
    try {
      // Step 1: Get upload URL (server generates the storageKey)
      const urlResponse = await fetch(`/api/prospects/${prospect.id}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileType: selectedFile.type
        })
      });
      const urlData = await urlResponse.json();
      
      if (!urlData.success || !urlData.uploadUrl) {
        throw new Error(urlData.message || "Failed to get upload URL");
      }

      // Step 2: Upload file to presigned URL
      const uploadResponse = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": selectedFile.type,
        },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }

      // Step 3: Create document metadata using the server-generated storageKey
      await apiRequest("POST", `/api/prospects/${prospect.id}/documents`, {
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        storageKey: urlData.storageKey,
        category: "general",
      });

      toast({
        title: "Upload Successful",
        description: `${selectedFile.name} has been uploaded`,
      });

      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospect.id, 'documents'] });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Download document handler
  const handleDownload = async (doc: ProspectDocument) => {
    if (!prospect) return;

    try {
      const response = await fetch(`/api/prospects/${prospect.id}/documents/${doc.id}/download-url`, {
        credentials: "include"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to get download URL");
      }

      if (!data.downloadUrl) {
        throw new Error("Download URL not available");
      }

      // Use location.href for direct download instead of window.open
      window.location.href = data.downloadUrl;
    } catch (error: any) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download file",
        variant: "destructive",
      });
    }
  };

  // Delete document mutation
  const deleteDocumentMutation = useMutation({
    mutationFn: async (docId: number) => {
      await apiRequest("DELETE", `/api/prospects/${prospect?.id}/documents/${docId}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Document Deleted",
        description: "The document has been removed",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospect?.id, 'documents'] });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Get status badge
  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Under Review", variant: "secondary" },
      approved: { label: "Approved", variant: "default" },
      denied: { label: "Denied", variant: "destructive" },
      submitted: { label: "Submitted", variant: "outline" },
    };

    const config = statusMap[status] || { label: status, variant: "outline" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (prospectLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-yellow-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your portal...</p>
        </div>
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Unable to load your application</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {prospectError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Error: {prospectError instanceof Error ? prospectError.message : 'Unknown error'}
                </AlertDescription>
              </Alert>
            )}
            {!prospectError && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No prospect record found for your account. Please contact support.
                </AlertDescription>
              </Alert>
            )}
            <Button onClick={() => window.location.href = "/"} className="w-full">
              Back to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 to-orange-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="text-portal-title">Prospect Portal</h1>
              <p className="text-sm text-gray-600">{prospect.businessName}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setLocation("/prospect-profile")} data-testid="button-profile">
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Application Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Current Status</p>
                {getStatusBadge(prospect.applicationStatus || prospect.status)}
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Business Name</p>
                <p className="font-medium" data-testid="text-business-name">{prospect.businessName}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="application" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="application" data-testid="tab-application">
              <ClipboardList className="w-4 h-4 mr-2" />
              Application
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-documents">
              <FileText className="w-4 h-4 mr-2" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">
              <Bell className="w-4 h-4 mr-2" />
              Notifications
              {(unreadData?.count ?? 0) > 0 && (
                <Badge variant="destructive" className="ml-2">{unreadData?.count}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Application Tab */}
          <TabsContent value="application" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  Submitted Application
                </CardTitle>
                <CardDescription>
                  Review your submitted application details below. This information has been locked and cannot be edited.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {applicationLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
                    <p className="text-sm text-gray-500 mt-2">Loading application...</p>
                  </div>
                ) : applicationData?.application ? (
                  <div className="space-y-4">
                    {/* Application metadata */}
                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Template</p>
                          <p className="font-medium">{applicationData.application.template?.templateName || 'Standard Application'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Status</p>
                          <Badge variant="outline">{applicationData.application.status}</Badge>
                        </div>
                        <div>
                          <p className="text-gray-500">Submitted</p>
                          <p className="font-medium">
                            {applicationData.application.submittedAt 
                              ? format(new Date(applicationData.application.submittedAt), 'MMM d, yyyy h:mm a')
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Application ID</p>
                          <p className="font-medium">#{applicationData.application.id}</p>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Application data by sections */}
                    {applicationData.application.template?.formSections && applicationData.application.template.formSections.length > 0 ? (
                      <Accordion type="multiple" defaultValue={applicationData.application.template.formSections.map(s => s.id)} className="w-full">
                        {applicationData.application.template.formSections.map((section) => (
                          <AccordionItem key={section.id} value={section.id}>
                            <AccordionTrigger className="text-left">
                              <div>
                                <h3 className="font-semibold">{section.title}</h3>
                                {section.description && (
                                  <p className="text-sm text-gray-500 font-normal">{section.description}</p>
                                )}
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                                {section.fields.map((field) => {
                                  const value = applicationData.application?.applicationData?.[field.id];
                                  const displayValue = formatFieldValue(value, field);
                                  
                                  return (
                                    <div key={field.id} className="space-y-1" data-testid={`field-${field.id}`}>
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium text-gray-600">{field.label}</p>
                                        {field.sensitive && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0"
                                            onClick={() => toggleSensitiveField(field.id)}
                                            data-testid={`toggle-${field.id}`}
                                          >
                                            {visibleSensitiveFields[field.id] ? (
                                              <EyeOff className="w-3 h-3" />
                                            ) : (
                                              <Eye className="w-3 h-3" />
                                            )}
                                          </Button>
                                        )}
                                      </div>
                                      <p className="text-sm bg-gray-50 rounded px-3 py-2" data-testid={`value-${field.id}`}>
                                        {displayValue}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : (
                      /* Fallback: display raw data without template structure */
                      <div className="space-y-4">
                        <p className="text-sm text-gray-500 mb-4">Application data:</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {Object.entries(applicationData.application.applicationData || {}).map(([key, value]) => (
                            <div key={key} className="space-y-1">
                              <p className="text-sm font-medium text-gray-600">{key.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' ').trim()}</p>
                              <p className="text-sm bg-gray-50 rounded px-3 py-2">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value || '—')}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardList className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No application data available</p>
                    <p className="text-sm mt-1">Your application details will appear here after submission.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-4">
            {/* Upload Section */}
            <Card>
              <CardHeader>
                <CardTitle>Upload Document</CardTitle>
                <CardDescription>Upload supporting documents for your application</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <input
                      type="file"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="flex-1 text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-yellow-50 file:text-yellow-700 hover:file:bg-yellow-100"
                      data-testid="input-file-upload"
                    />
                    <Button
                      onClick={handleFileUpload}
                      disabled={!selectedFile || isUploading}
                      data-testid="button-upload"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </div>
                  {selectedFile && (
                    <p className="text-sm text-gray-600">
                      Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Documents List */}
            <Card>
              <CardHeader>
                <CardTitle>Your Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {documentsLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
                  </div>
                ) : documentsData?.documents && documentsData.documents.length > 0 ? (
                  <div className="space-y-2">
                    {documentsData.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                        data-testid={`document-${doc.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-gray-600" />
                          <div>
                            <p className="font-medium text-sm">{doc.fileName}</p>
                            <p className="text-xs text-gray-500">
                              Uploaded {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(doc)}
                            data-testid={`button-download-${doc.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {/* Don't allow deleting application PDFs */}
                          {!doc.storageKey.startsWith('applications/') && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteDocumentMutation.mutate(doc.id)}
                              disabled={deleteDocumentMutation.isPending}
                              data-testid={`button-delete-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No documents uploaded yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>Messages from your agent and underwriters</CardDescription>
              </CardHeader>
              <CardContent>
                {notificationsLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
                  </div>
                ) : notificationsData?.notifications && notificationsData.notifications.length > 0 ? (
                  <div className="space-y-3">
                    {notificationsData.notifications.map((notification) => (
                      <Alert
                        key={notification.id}
                        className={`cursor-pointer transition ${
                          notification.isRead ? 'bg-gray-50' : 'bg-blue-50 border-blue-200'
                        }`}
                        onClick={() => !notification.isRead && markAsReadMutation.mutate(notification.id)}
                        data-testid={`notification-${notification.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {!notification.isRead && (
                                <Badge variant="default" className="text-xs">New</Badge>
                              )}
                              <p className="font-medium">{notification.subject}</p>
                            </div>
                            <AlertDescription className="text-sm">
                              {notification.message}
                            </AlertDescription>
                            <p className="text-xs text-gray-500 mt-2">
                              {format(new Date(notification.createdAt), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                        </div>
                      </Alert>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Bell className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No notifications yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
