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
  Loader2
} from "lucide-react";
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
  uploadedAt: string;
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

export default function ProspectPortal() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch prospect data
  const { data: prospectData, isLoading: prospectLoading } = useQuery<{ prospect: Prospect }>({
    queryKey: ['/api/prospects/me'],
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const prospect = prospectData?.prospect;

  // Fetch documents
  const { data: documentsData, isLoading: documentsLoading } = useQuery<{ documents: ProspectDocument[] }>({
    queryKey: ['/api/prospects', prospect?.id, 'documents'],
    enabled: !!prospect?.id,
  });

  // Fetch notifications
  const { data: notificationsData, isLoading: notificationsLoading } = useQuery<{ notifications: Notification[] }>({
    queryKey: ['/api/prospects', prospect?.id, 'notifications'],
    enabled: !!prospect?.id,
  });

  // Fetch unread count
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['/api/prospects', prospect?.id, 'notifications', 'unread-count'],
    enabled: !!prospect?.id,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

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
      // Step 1: Get upload URL
      const storageKey = `prospects/${prospect.id}/documents/${Date.now()}-${selectedFile.name}`;
      const urlResponse = await fetch(`/api/prospects/${prospect.id}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          storageKey
        })
      });
      const urlData = await urlResponse.json();

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

      // Step 3: Create document metadata
      await apiRequest("POST", `/api/prospects/${prospect.id}/documents`, {
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        storageKey,
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

      window.open(data.downloadUrl, '_blank');
    } catch (error: any) {
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
          <CardContent>
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

        <Tabs defaultValue="documents" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
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
                              Uploaded {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
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
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteDocumentMutation.mutate(doc.id)}
                            disabled={deleteDocumentMutation.isPending}
                            data-testid={`button-delete-${doc.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
