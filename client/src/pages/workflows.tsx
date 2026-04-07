import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Zap, Plus, Edit, Trash2, Power, Globe, Settings2, ChevronRight, Play, Pause, Loader2 } from "lucide-react";

const workflowFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  trigger: z.enum(["manual", "webhook", "schedule", "event"]).default("manual"),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
  isEnabled: z.boolean().default(true),
});

const endpointFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  authType: z.enum(["none", "api_key", "bearer", "basic"]).default("none"),
});

type WorkflowFormValues = z.infer<typeof workflowFormSchema>;
type EndpointFormValues = z.infer<typeof endpointFormSchema>;

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  webhook: "Webhook",
  schedule: "Scheduled",
  event: "Event-driven",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  inactive: "bg-yellow-100 text-yellow-700",
};

export default function Workflows() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<any>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<any>(null);
  const [showEndpointDialog, setShowEndpointDialog] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const { data: workflows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows"],
  });

  const { data: workflowDetails } = useQuery<any>({
    queryKey: ["/api/admin/workflows", selectedWorkflow?.id],
    enabled: !!selectedWorkflow?.id,
  });

  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowFormSchema),
    defaultValues: { name: "", description: "", trigger: "manual", status: "draft", isEnabled: true },
  });

  const endpointForm = useForm<EndpointFormValues>({
    resolver: zodResolver(endpointFormSchema),
    defaultValues: { name: "", url: "", method: "POST", authType: "none" },
  });

  const createWorkflow = useMutation({
    mutationFn: (data: WorkflowFormValues) => apiRequest("POST", "/api/admin/workflows", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      setShowCreateDialog(false);
      form.reset();
      toast({ title: "Workflow created successfully" });
    },
    onError: () => toast({ title: "Failed to create workflow", variant: "destructive" }),
  });

  const updateWorkflow = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WorkflowFormValues> }) =>
      apiRequest("PUT", `/api/admin/workflows/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      setEditingWorkflow(null);
      toast({ title: "Workflow updated" });
    },
    onError: () => toast({ title: "Failed to update workflow", variant: "destructive" }),
  });

  const deleteWorkflow = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/workflows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      setSelectedWorkflow(null);
      toast({ title: "Workflow deleted" });
    },
    onError: () => toast({ title: "Failed to delete workflow", variant: "destructive" }),
  });

  const toggleWorkflow = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/admin/workflows/${id}/toggle`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows"] });
      if (selectedWorkflow) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", selectedWorkflow.id] });
      }
      toast({ title: "Workflow status updated" });
    },
    onError: () => toast({ title: "Failed to toggle workflow", variant: "destructive" }),
  });

  const createEndpoint = useMutation({
    mutationFn: (data: EndpointFormValues) =>
      apiRequest("POST", `/api/admin/workflows/${selectedWorkflow?.id}/endpoints`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", selectedWorkflow?.id] });
      setShowEndpointDialog(false);
      endpointForm.reset();
      toast({ title: "Endpoint added" });
    },
    onError: () => toast({ title: "Failed to add endpoint", variant: "destructive" }),
  });

  const deleteEndpoint = useMutation({
    mutationFn: (epId: number) => apiRequest("DELETE", `/api/admin/workflows/endpoints/${epId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", selectedWorkflow?.id] });
      toast({ title: "Endpoint removed" });
    },
    onError: () => toast({ title: "Failed to remove endpoint", variant: "destructive" }),
  });

  const openEdit = (wf: any) => {
    setEditingWorkflow(wf);
    form.reset({ name: wf.name, description: wf.description || "", trigger: wf.trigger, status: wf.status, isEnabled: wf.isEnabled });
  };

  const handleSubmit = (values: WorkflowFormValues) => {
    if (editingWorkflow) {
      updateWorkflow.mutate({ id: editingWorkflow.id, data: values });
    } else {
      createWorkflow.mutate(values);
    }
  };

  const displayedWorkflow = workflowDetails || selectedWorkflow;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel — workflow list */}
      <div className="w-80 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">Workflows</h2>
              <Badge variant="secondary">{workflows.length}</Badge>
            </div>
            <Button size="sm" onClick={() => { setShowCreateDialog(true); form.reset(); setEditingWorkflow(null); }}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {workflows.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <Zap className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No workflows yet</p>
              <p className="text-xs text-gray-400 mt-1">Create your first automation workflow</p>
            </div>
          ) : (
            workflows.map((wf: any) => (
              <div
                key={wf.id}
                onClick={() => setSelectedWorkflow(wf)}
                className={`p-4 border-b cursor-pointer hover:bg-gray-50 transition-colors ${selectedWorkflow?.id === wf.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{wf.name}</p>
                    {wf.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{wf.description}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[wf.status] || STATUS_COLORS.draft}`}>
                        {wf.status}
                      </span>
                      <span className="text-xs text-gray-400">{TRIGGER_LABELS[wf.trigger] || wf.trigger}</span>
                    </div>
                  </div>
                  <div className="flex items-center ml-2">
                    {wf.isEnabled ? (
                      <span className="w-2 h-2 rounded-full bg-green-400" title="Enabled" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-300" title="Disabled" />
                    )}
                    <ChevronRight className="h-4 w-4 text-gray-300 ml-1" />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel — workflow detail */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {!selectedWorkflow ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Zap className="h-16 w-16 mb-4 text-gray-200" />
            <p className="text-lg font-medium">Select a workflow</p>
            <p className="text-sm">Choose a workflow from the left panel to view its details</p>
          </div>
        ) : (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-gray-900">{displayedWorkflow?.name}</h1>
                  <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[displayedWorkflow?.status] || STATUS_COLORS.draft}`}>
                    {displayedWorkflow?.status}
                  </span>
                  <Badge variant={displayedWorkflow?.isEnabled ? "default" : "secondary"}>
                    {displayedWorkflow?.isEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                {displayedWorkflow?.description && (
                  <p className="text-gray-600">{displayedWorkflow.description}</p>
                )}
                <p className="text-sm text-gray-400 mt-1">
                  Trigger: {TRIGGER_LABELS[displayedWorkflow?.trigger] || displayedWorkflow?.trigger}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleWorkflow.mutate(selectedWorkflow.id)}
                  disabled={toggleWorkflow.isPending}
                >
                  {displayedWorkflow?.isEnabled ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                  {displayedWorkflow?.isEnabled ? "Disable" : "Enable"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(selectedWorkflow)}>
                  <Edit className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Delete this workflow?")) deleteWorkflow.mutate(selectedWorkflow.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="endpoints">
                  API Endpoints
                  {displayedWorkflow?.endpoints?.length > 0 && (
                    <Badge variant="secondary" className="ml-2">{displayedWorkflow.endpoints.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="environments">Environments</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-500">Trigger Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-lg font-semibold">{TRIGGER_LABELS[displayedWorkflow?.trigger] || displayedWorkflow?.trigger}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-500">Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-lg font-semibold capitalize">{displayedWorkflow?.status}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-500">API Endpoints</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-lg font-semibold">{displayedWorkflow?.endpoints?.length ?? 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-500">Environment Configs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-lg font-semibold">{displayedWorkflow?.environmentConfigs?.length ?? 0}</p>
                    </CardContent>
                  </Card>
                </div>
                {displayedWorkflow?.steps && Array.isArray(displayedWorkflow.steps) && displayedWorkflow.steps.length > 0 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-sm">Workflow Steps</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-48">
                        {JSON.stringify(displayedWorkflow.steps, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="endpoints">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">API Endpoints</h3>
                  <Button size="sm" onClick={() => { setShowEndpointDialog(true); endpointForm.reset(); setEditingEndpoint(null); }}>
                    <Plus className="h-4 w-4 mr-1" /> Add Endpoint
                  </Button>
                </div>
                {!displayedWorkflow?.endpoints?.length ? (
                  <Card>
                    <CardContent className="py-8 text-center text-gray-400">
                      <Globe className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                      <p className="text-sm">No endpoints configured</p>
                      <p className="text-xs mt-1">Add API endpoints this workflow calls</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {displayedWorkflow.endpoints.map((ep: any) => (
                      <Card key={ep.id}>
                        <CardContent className="py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="font-mono text-xs">{ep.method}</Badge>
                              <div>
                                <p className="font-medium text-sm">{ep.name}</p>
                                <p className="text-xs text-gray-500 font-mono truncate max-w-xs">{ep.url}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={ep.isActive ? "default" : "secondary"}>
                                {ep.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <span className="text-xs text-gray-400">{ep.authType}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteEndpoint.mutate(ep.id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="environments">
                <div className="space-y-4">
                  {["production", "development", "test"].map((env) => {
                    const config = displayedWorkflow?.environmentConfigs?.find((c: any) => c.environment === env);
                    return (
                      <Card key={env}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm capitalize flex items-center gap-2">
                              <Settings2 className="h-4 w-4" />
                              {env} environment
                            </CardTitle>
                            <Badge variant={config?.isActive ? "default" : "secondary"}>
                              {config ? (config.isActive ? "Configured" : "Inactive") : "Not configured"}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {config?.config ? (
                            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32">
                              {JSON.stringify(config.config, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-sm text-gray-400">No configuration overrides set for this environment</p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Create/Edit Workflow Dialog */}
      <Dialog open={showCreateDialog || !!editingWorkflow} onOpenChange={(open) => { if (!open) { setShowCreateDialog(false); setEditingWorkflow(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingWorkflow ? "Edit Workflow" : "New Workflow Definition"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Merchant Onboarding" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea placeholder="What does this workflow do?" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="trigger" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trigger</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="webhook">Webhook</SelectItem>
                        <SelectItem value="schedule">Schedule</SelectItem>
                        <SelectItem value="event">Event</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="isEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="cursor-pointer">Enable workflow</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <Separator />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); setEditingWorkflow(null); }}>Cancel</Button>
                <Button type="submit" disabled={createWorkflow.isPending || updateWorkflow.isPending}>
                  {(createWorkflow.isPending || updateWorkflow.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingWorkflow ? "Save Changes" : "Create Workflow"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Endpoint Dialog */}
      <Dialog open={showEndpointDialog} onOpenChange={setShowEndpointDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add API Endpoint</DialogTitle>
          </DialogHeader>
          <Form {...endpointForm}>
            <form onSubmit={endpointForm.handleSubmit((v) => createEndpoint.mutate(v))} className="space-y-4">
              <FormField control={endpointForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Endpoint Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Notify Compliance Team" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={endpointForm.control} name="url" render={({ field }) => (
                <FormItem>
                  <FormLabel>URL</FormLabel>
                  <FormControl><Input placeholder="https://api.example.com/notify" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={endpointForm.control} name="method" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={endpointForm.control} name="authType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auth Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="api_key">API Key</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="basic">Basic Auth</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEndpointDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={createEndpoint.isPending}>
                  {createEndpoint.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Endpoint
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
