import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield, LogOut, MessageSquare, FolderOpen, CheckCircle, Clock, XCircle,
  Send, Upload, Download, AlertCircle, FileText, User
} from "lucide-react";

interface ProspectMe {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  validationToken: string | null;
  portalSetupAt: string | null;
  application: {
    id: number;
    status: string;
    templateName: string | null;
    createdAt: string;
    hasGeneratedPdf: boolean;
  } | null;
}

interface Message {
  id: number;
  prospectId: number;
  senderId: string;
  senderType: string;
  subject: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface FileRequest {
  id: number;
  label: string;
  description: string | null;
  required: boolean;
  status: string;
  fileName: string | null;
  mimeType: string | null;
  uploadedBy: string | null;
  createdAt: string;
  fulfilledAt: string | null;
}

export default function ProspectPortal() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messageBody, setMessageBody] = useState("");
  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  const urlParams = new URLSearchParams(window.location.search);
  const dbEnv = urlParams.get("db") || "";
  const apiBase = (path: string) => dbEnv ? `${path}?db=${dbEnv}` : path;

  // Fetch current prospect session
  const { data: me, isLoading: meLoading, error: meError } = useQuery<ProspectMe>({
    queryKey: ["/api/portal/me", dbEnv],
    queryFn: async () => {
      const res = await fetch(apiBase("/api/portal/me"), { credentials: "include" });
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    staleTime: 0,
    retry: false,
  });

  // Fetch messages
  const { data: messagesData } = useQuery<{ messages: Message[] }>({
    queryKey: ["/api/portal/messages", dbEnv],
    queryFn: async () => {
      const res = await fetch(apiBase("/api/portal/messages"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    staleTime: 0,
    enabled: !!me,
  });

  // Fetch file requests
  const { data: fileRequestsData } = useQuery<{ fileRequests: FileRequest[] }>({
    queryKey: ["/api/portal/file-requests", dbEnv],
    queryFn: async () => {
      const res = await fetch(apiBase("/api/portal/file-requests"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch file requests");
      return res.json();
    },
    staleTime: 0,
    enabled: !!me,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portal/logout", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Logout failed");
    },
    onSuccess: () => navigate(dbEnv ? `/portal/login?db=${dbEnv}` : "/portal/login"),
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiBase("/api/portal/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: messageBody }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      setMessageBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/messages"] });
      toast({ title: "Message sent" });
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ frId, file }: { frId: number; file: File }) => {
      const reader = new FileReader();
      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(apiBase(`/api/portal/file-requests/${frId}/upload`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileData }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/file-requests"] });
      toast({ title: "File uploaded successfully" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  // Redirect to login if not authenticated
  if (!meLoading && (meError || !me)) {
    navigate(dbEnv ? `/portal/login?db=${dbEnv}` : "/portal/login");
    return null;
  }

  if (meLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-500">Loading your portal...</p>
        </div>
      </div>
    );
  }

  const messages = messagesData?.messages ?? [];
  const fileRequests = fileRequestsData?.fileRequests ?? [];
  const unreadFromAgent = messages.filter(m => m.senderType === "agent" && !m.isRead).length;
  const pendingUploads = fileRequests.filter(f => f.status === "pending").length;

  const statusColor = (s: string) => {
    switch (s) {
      case "approved": return "bg-green-100 text-green-800";
      case "rejected": return "bg-red-100 text-red-800";
      case "submitted":
      case "applied": return "bg-indigo-100 text-indigo-800";
      case "in_progress": return "bg-purple-100 text-purple-800";
      case "contacted": return "bg-blue-100 text-blue-800";
      default: return "bg-yellow-100 text-yellow-800";
    }
  };

  const fileStatusIcon = (s: string) => {
    if (s === "uploaded" || s === "approved") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (s === "rejected") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-yellow-500" />;
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Applicant Portal</p>
              <p className="text-xs text-gray-500">{me!.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
            <LogOut className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Welcome + status */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome, {me!.firstName}!</h1>
          <p className="text-gray-500 mt-1">Here's the current status of your application.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-gray-900">{me!.firstName} {me!.lastName}</span>
                </div>
                <p className="text-sm text-gray-500">{me!.email}</p>
                {me!.application?.templateName && (
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {me!.application.templateName}
                  </p>
                )}
              </div>
              <div className="text-right space-y-2">
                <Badge className={`${statusColor(me!.status)} text-sm px-3 py-1`}>
                  {me!.status.replace(/_/g, " ").toUpperCase()}
                </Badge>
                {me!.application?.hasGeneratedPdf && (
                  <div>
                    <a href={`/api/prospects/download-filled-pdf/${me!.validationToken}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download PDF
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next steps banner */}
        {me!.status === "pending" && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800">Your application has been received. Our team will review it and reach out soon.</p>
          </div>
        )}
        {me!.status === "approved" && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <p className="text-sm text-green-800">Congratulations! Your application has been approved. We'll be in touch with next steps.</p>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="messages">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="messages" className="relative">
              <MessageSquare className="w-4 h-4 mr-1.5" />
              Messages
              {unreadFromAgent > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{unreadFromAgent}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents" className="relative">
              <FolderOpen className="w-4 h-4 mr-1.5" />
              Documents
              {pendingUploads > 0 && (
                <span className="ml-1.5 bg-yellow-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{pendingUploads}</span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Messages tab */}
          <TabsContent value="messages" className="space-y-4">
            {/* Send message */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Send a Message</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Type your message here..."
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  rows={3}
                />
                <Button
                  type="button"
                  onClick={() => sendMessageMutation.mutate()}
                  disabled={sendMessageMutation.isPending || !messageBody.trim()}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {sendMessageMutation.isPending ? "Sending..." : "Send Message"}
                </Button>
              </CardContent>
            </Card>

            {/* Message thread */}
            <div className="space-y-3">
              {messages.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No messages yet. Send us a message above!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.senderType === "prospect" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.senderType === "prospect"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-white border border-gray-200 text-gray-900 rounded-bl-sm"
                    }`}>
                      <p className={`text-xs font-medium mb-1 ${msg.senderType === "prospect" ? "text-blue-100" : "text-gray-500"}`}>
                        {msg.senderType === "prospect" ? "You" : "CoreCRM Team"}
                        {msg.subject && ` · ${msg.subject}`}
                      </p>
                      <p className="text-sm leading-relaxed">{msg.message}</p>
                      <p className={`text-xs mt-1.5 ${msg.senderType === "prospect" ? "text-blue-200" : "text-gray-400"}`}>
                        {formatDate(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Documents tab */}
          <TabsContent value="documents" className="space-y-4">
            {fileRequests.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No document requests yet. Your agent will request files here when needed.</p>
              </div>
            ) : (
              fileRequests.map((fr) => (
                <Card key={fr.id} className={fr.status === "pending" ? "border-yellow-200 bg-yellow-50/30" : ""}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {fileStatusIcon(fr.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-gray-900">{fr.label}</p>
                            {fr.required && <Badge variant="secondary" className="text-xs">Required</Badge>}
                            <Badge className={`text-xs ${
                              fr.status === "uploaded" || fr.status === "approved"
                                ? "bg-green-100 text-green-800"
                                : fr.status === "rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}>
                              {fr.status}
                            </Badge>
                          </div>
                          {fr.description && <p className="text-sm text-gray-500 mt-0.5">{fr.description}</p>}
                          {fr.fileName && (
                            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {fr.fileName} · uploaded {formatDate(fr.fulfilledAt!)}
                            </p>
                          )}
                        </div>
                      </div>

                      {(fr.status === "pending" || fr.status === "rejected") && (
                        <div>
                          <input
                            type="file"
                            ref={(el) => { fileInputRefs.current[fr.id] = el; }}
                            className="hidden"
                            accept="image/*,.pdf,.doc,.docx"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) uploadMutation.mutate({ frId: fr.id, file });
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => fileInputRefs.current[fr.id]?.click()}
                            disabled={uploadMutation.isPending}
                          >
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                            {fr.status === "rejected" ? "Re-upload" : "Upload"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
