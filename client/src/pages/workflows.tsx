import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Eye, EyeOff, Plus, Trash2, Edit, ChevronRight, Globe, Key, Code, Zap, Settings, Copy, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowEndpoint {
  id: number;
  workflowId: number;
  name: string;
  description?: string;
  method: string;
  path: string;
  requestSchema?: any;
  responseSchema?: any;
  defaultHeaders?: any;
  queryParams?: any;
  sortOrder: number;
}

interface WorkflowEnvironmentConfig {
  id: number;
  workflowId: number;
  environment: string;
  baseUrl: string;
  bearerToken?: string;
  additionalHeaders?: any;
  isActive: boolean;
}

interface WorkflowDefinition {
  id: number;
  name: string;
  description?: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  endpoints: WorkflowEndpoint[];
  environmentConfigs: WorkflowEnvironmentConfig[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-100 text-green-800 border-green-200",
  POST: "bg-blue-100 text-blue-800 border-blue-200",
  PUT: "bg-yellow-100 text-yellow-800 border-yellow-200",
  PATCH: "bg-orange-100 text-orange-800 border-orange-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

const ENV_COLORS: Record<string, string> = {
  development: "bg-purple-100 text-purple-800 border-purple-200",
  test: "bg-blue-100 text-blue-800 border-blue-200",
  production: "bg-green-100 text-green-800 border-green-200",
};

const CATEGORIES = ["merchant", "transaction", "reporting", "location", "agent", "general"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ENVIRONMENTS = ["development", "test", "production"];

function prettyJson(value: any): string {
  if (!value) return "";
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}

function parseJsonField(raw: string): any {
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EndpointCard({ endpoint, workflowId, onEdit, onDelete }: {
  endpoint: WorkflowEndpoint;
  workflowId: number;
  onEdit: (ep: WorkflowEndpoint) => void;
  onDelete: (ep: WorkflowEndpoint) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Badge className={`font-mono text-xs border px-2 py-0.5 ${METHOD_COLORS[endpoint.method] || "bg-gray-100 text-gray-700"}`}>
          {endpoint.method}
        </Badge>
        <code className="text-sm font-mono text-gray-700 flex-1">{endpoint.path}</code>
        <span className="text-sm text-gray-500 hidden sm:block">{endpoint.name}</span>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(endpoint); }} className="h-7 w-7 p-0">
            <Edit className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(endpoint); }} className="h-7 w-7 p-0 text-red-600 hover:text-red-700">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4 border-t">
          {endpoint.description && <p className="text-sm text-gray-600">{endpoint.description}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {endpoint.requestSchema && (
              <div>
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Request Schema</Label>
                <pre className="text-xs bg-gray-950 text-green-400 p-3 rounded overflow-auto max-h-48">{prettyJson(endpoint.requestSchema)}</pre>
              </div>
            )}
            {endpoint.responseSchema && (
              <div>
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Response Schema</Label>
                <pre className="text-xs bg-gray-950 text-blue-400 p-3 rounded overflow-auto max-h-48">{prettyJson(endpoint.responseSchema)}</pre>
              </div>
            )}
          </div>

          {endpoint.queryParams && (
            <div>
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Query Parameters</Label>
              <pre className="text-xs bg-gray-950 text-yellow-400 p-3 rounded overflow-auto max-h-32">{prettyJson(endpoint.queryParams)}</pre>
            </div>
          )}

          {endpoint.defaultHeaders && (
            <div>
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Default Headers</Label>
              <pre className="text-xs bg-gray-950 text-gray-400 p-3 rounded overflow-auto max-h-32">{prettyJson(endpoint.defaultHeaders)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnvConfigRow({ config, env, workflowId, onSave, onDelete }: {
  config?: WorkflowEnvironmentConfig;
  env: string;
  workflowId: number;
  onSave: (env: string, data: Partial<WorkflowEnvironmentConfig>) => void;
  onDelete: (env: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [form, setForm] = useState({
    baseUrl: config?.baseUrl || "",
    bearerToken: config?.bearerToken || "",
    isActive: config?.isActive !== false,
    additionalHeaders: config?.additionalHeaders ? prettyJson(config.additionalHeaders) : "",
  });

  const handleSave = () => {
    onSave(env, {
      baseUrl: form.baseUrl,
      bearerToken: form.bearerToken || undefined,
      isActive: form.isActive,
      additionalHeaders: parseJsonField(form.additionalHeaders),
    });
    setEditing(false);
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${config?.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 p-3 bg-gray-50">
        <Badge className={`text-xs border px-2 py-0.5 capitalize ${ENV_COLORS[env] || "bg-gray-100 text-gray-700"}`}>
          <Server className="w-3 h-3 mr-1 inline" />
          {env}
        </Badge>
        {config ? (
          <>
            <code className="text-sm font-mono text-gray-700 flex-1 truncate">{config.baseUrl}</code>
            <Badge variant={config.isActive ? "default" : "secondary"} className="text-xs">
              {config.isActive ? "Active" : "Inactive"}
            </Badge>
          </>
        ) : (
          <span className="text-sm text-gray-400 flex-1 italic">Not configured</span>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-7 px-2 text-xs">
            <Edit className="w-3.5 h-3.5 mr-1" />{config ? "Edit" : "Configure"}
          </Button>
          {config && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(env)} className="h-7 w-7 p-0 text-red-600 hover:text-red-700">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="p-4 border-t space-y-4">
          <div className="space-y-1">
            <Label className="text-sm">Base URL</Label>
            <Input
              value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
              placeholder={`https://api.${env}.example.com`}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm">Bearer Token</Label>
            <div className="flex gap-2">
              <Input
                type={showToken ? "text" : "password"}
                value={form.bearerToken}
                onChange={e => setForm(f => ({ ...f, bearerToken: e.target.value }))}
                placeholder="Enter Bearer token..."
                className="font-mono text-sm flex-1"
              />
              <Button variant="outline" size="sm" onClick={() => setShowToken(!showToken)} className="px-3">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-500">Token is sent as: <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code></p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">Additional Headers (JSON)</Label>
            <Textarea
              value={form.additionalHeaders}
              onChange={e => setForm(f => ({ ...f, additionalHeaders: e.target.value }))}
              placeholder={'{\n  "X-Client-Id": "crm-v1"\n}'}
              className="font-mono text-xs h-24"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            <Label className="text-sm">Active</Label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.baseUrl}>Save Config</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function WorkflowDialog({ open, onClose, onSave, initial }: {
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  initial?: Partial<WorkflowDefinition>;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    description: initial?.description || "",
    category: initial?.category || "merchant",
    isActive: initial?.isActive !== false,
  });

  const isEdit = !!initial?.id;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Workflow" : "New Workflow"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update workflow details." : "Create a new workflow definition to group related API endpoints."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Merchant Data Sync" />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this workflow do?" className="h-20" />
          </div>

          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            <Label>Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSave(form); onClose(); }} disabled={!form.name}>
            {isEdit ? "Save Changes" : "Create Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndpointDialog({ open, onClose, onSave, initial }: {
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  initial?: Partial<WorkflowEndpoint>;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    description: initial?.description || "",
    method: initial?.method || "GET",
    path: initial?.path || "",
    requestSchema: initial?.requestSchema ? prettyJson(initial.requestSchema) : "",
    responseSchema: initial?.responseSchema ? prettyJson(initial.responseSchema) : "",
    defaultHeaders: initial?.defaultHeaders ? prettyJson(initial.defaultHeaders) : "",
    queryParams: initial?.queryParams ? prettyJson(initial.queryParams) : "",
    sortOrder: initial?.sortOrder || 0,
  });

  const isEdit = !!initial?.id;

  const handleSave = () => {
    onSave({
      ...form,
      requestSchema: parseJsonField(form.requestSchema),
      responseSchema: parseJsonField(form.responseSchema),
      defaultHeaders: parseJsonField(form.defaultHeaders),
      queryParams: parseJsonField(form.queryParams),
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Endpoint" : "Add Endpoint"}</DialogTitle>
          <DialogDescription>Define the HTTP endpoint including request and response structure.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Get Merchant Details" />
            </div>
            <div className="space-y-1">
              <Label>Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-16" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Method <span className="text-red-500">*</span></Label>
              <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map(m => (
                    <SelectItem key={m} value={m}>
                      <span className={`font-mono text-xs font-bold`}>{m}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Path <span className="text-red-500">*</span></Label>
              <Input value={form.path} onChange={e => setForm(f => ({ ...f, path: e.target.value }))} placeholder="/merchants/{merchantId}" className="font-mono text-sm" />
              <p className="text-xs text-gray-500">Use {"{paramName}"} for path variables. Base URL comes from environment config.</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="flex items-center gap-1"><Code className="w-3.5 h-3.5" /> Request Schema (JSON)</Label>
              <Textarea
                value={form.requestSchema}
                onChange={e => setForm(f => ({ ...f, requestSchema: e.target.value }))}
                placeholder={'{\n  "merchantId": "string",\n  "includeLocations": "boolean"\n}'}
                className="font-mono text-xs h-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1"><Code className="w-3.5 h-3.5" /> Response Schema (JSON)</Label>
              <Textarea
                value={form.responseSchema}
                onChange={e => setForm(f => ({ ...f, responseSchema: e.target.value }))}
                placeholder={'{\n  "id": "string",\n  "businessName": "string",\n  "status": "active | suspended"\n}'}
                className="font-mono text-xs h-36"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Query Parameters (JSON)</Label>
              <Textarea
                value={form.queryParams}
                onChange={e => setForm(f => ({ ...f, queryParams: e.target.value }))}
                placeholder={'{\n  "page": "number",\n  "limit": "number"\n}'}
                className="font-mono text-xs h-28"
              />
            </div>
            <div className="space-y-1">
              <Label>Default Headers (JSON)</Label>
              <Textarea
                value={form.defaultHeaders}
                onChange={e => setForm(f => ({ ...f, defaultHeaders: e.target.value }))}
                placeholder={'{\n  "X-Api-Version": "v2"\n}'}
                className="font-mono text-xs h-28"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.name || !form.path}>
            {isEdit ? "Save Changes" : "Add Endpoint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workflow Detail ───────────────────────────────────────────────────────────

function WorkflowDetail({ workflow, onRefresh }: { workflow: WorkflowDefinition; onRefresh: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [endpointDialog, setEndpointDialog] = useState<{ open: boolean; initial?: WorkflowEndpoint }>({ open: false });
  const [deleteEndpoint, setDeleteEndpoint] = useState<WorkflowEndpoint | null>(null);

  const createEndpoint = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/admin/workflows/${workflow.id}/endpoints`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); toast({ title: "Endpoint added" }); },
    onError: () => toast({ title: "Failed to add endpoint", variant: "destructive" }),
  });

  const updateEndpoint = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/admin/workflows/${workflow.id}/endpoints/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); toast({ title: "Endpoint updated" }); },
    onError: () => toast({ title: "Failed to update endpoint", variant: "destructive" }),
  });

  const deleteEndpointMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/workflows/${workflow.id}/endpoints/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); setDeleteEndpoint(null); toast({ title: "Endpoint deleted" }); },
    onError: () => toast({ title: "Failed to delete endpoint", variant: "destructive" }),
  });

  const upsertEnvConfig = useMutation({
    mutationFn: ({ env, data }: { env: string; data: any }) => apiRequest("PUT", `/api/admin/workflows/${workflow.id}/env-configs/${env}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); toast({ title: "Environment config saved" }); },
    onError: () => toast({ title: "Failed to save environment config", variant: "destructive" }),
  });

  const deleteEnvConfig = useMutation({
    mutationFn: (env: string) => apiRequest("DELETE", `/api/admin/workflows/${workflow.id}/env-configs/${env}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); toast({ title: "Environment config removed" }); },
    onError: () => toast({ title: "Failed to remove config", variant: "destructive" }),
  });

  const configByEnv = Object.fromEntries((workflow.environmentConfigs || []).map(c => [c.environment, c]));

  return (
    <div className="space-y-6">
      <Tabs defaultValue="endpoints">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="endpoints" className="flex items-center gap-1.5">
            <Code className="w-4 h-4" /> Endpoints ({workflow.endpoints.length})
          </TabsTrigger>
          <TabsTrigger value="environments" className="flex items-center gap-1.5">
            <Globe className="w-4 h-4" /> Environments ({workflow.environmentConfigs.length})
          </TabsTrigger>
        </TabsList>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Define the HTTP endpoints for this workflow. The base URL is set per environment.</p>
            <Button size="sm" onClick={() => setEndpointDialog({ open: true })} className="gap-1.5">
              <Plus className="w-4 h-4" /> Add Endpoint
            </Button>
          </div>

          {workflow.endpoints.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <Code className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No endpoints defined yet</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setEndpointDialog({ open: true })}>
                Add your first endpoint
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {workflow.endpoints.map(ep => (
                <EndpointCard
                  key={ep.id}
                  endpoint={ep}
                  workflowId={workflow.id}
                  onEdit={(ep) => setEndpointDialog({ open: true, initial: ep })}
                  onDelete={setDeleteEndpoint}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Environment Config Tab */}
        <TabsContent value="environments" className="space-y-3 mt-4">
          <p className="text-sm text-gray-500">Configure the base URL and Bearer token for each deployment environment. Tokens are stored securely and masked after saving.</p>
          <div className="space-y-3">
            {ENVIRONMENTS.map(env => (
              <EnvConfigRow
                key={env}
                env={env}
                workflowId={workflow.id}
                config={configByEnv[env]}
                onSave={(env, data) => upsertEnvConfig.mutate({ env, data })}
                onDelete={(env) => deleteEnvConfig.mutate(env)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Endpoint Dialog */}
      <EndpointDialog
        open={endpointDialog.open}
        onClose={() => setEndpointDialog({ open: false })}
        initial={endpointDialog.initial}
        onSave={(data) => {
          if (endpointDialog.initial?.id) {
            updateEndpoint.mutate({ id: endpointDialog.initial.id, data });
          } else {
            createEndpoint.mutate(data);
          }
        }}
      />

      {/* Delete Endpoint Confirm */}
      <AlertDialog open={!!deleteEndpoint} onOpenChange={() => setDeleteEndpoint(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteEndpoint?.method} {deleteEndpoint?.path}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteEndpoint && deleteEndpointMutation.mutate(deleteEndpoint.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Workflows() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [workflowDialog, setWorkflowDialog] = useState<{ open: boolean; initial?: Partial<WorkflowDefinition> }>({ open: false });
  const [deleteWorkflow, setDeleteWorkflow] = useState<WorkflowDefinition | null>(null);

  const { data: workflows = [], isLoading } = useQuery<WorkflowDefinition[]>({
    queryKey: ['/api/admin/workflows'],
    queryFn: async () => {
      const res = await fetch('/api/admin/workflows', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch workflows');
      return res.json();
    },
  });

  const selectedWorkflow = workflows.find(w => w.id === selectedId) || (workflows.length > 0 ? workflows[0] : null);

  const createWorkflow = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/workflows", data),
    onSuccess: (newWf: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] });
      setSelectedId(newWf.id);
      toast({ title: "Workflow created" });
    },
    onError: () => toast({ title: "Failed to create workflow", variant: "destructive" }),
  });

  const updateWorkflow = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/admin/workflows/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] }); toast({ title: "Workflow updated" }); },
    onError: () => toast({ title: "Failed to update workflow", variant: "destructive" }),
  });

  const deleteWorkflowMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/workflows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] });
      setDeleteWorkflow(null);
      setSelectedId(null);
      toast({ title: "Workflow deleted" });
    },
    onError: () => toast({ title: "Failed to delete workflow", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" /> Workflows
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Define and manage API integration workflows for merchant data. Configure endpoints with request/response schemas and Bearer token authentication per environment.
          </p>
        </div>
        <Button onClick={() => setWorkflowDialog({ open: true })} className="gap-1.5 shrink-0">
          <Plus className="w-4 h-4" /> New Workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed rounded-lg">
          <Zap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-500">No workflows yet</h3>
          <p className="text-sm text-gray-400 mb-4">Create a workflow to start defining API integrations.</p>
          <Button onClick={() => setWorkflowDialog({ open: true })} className="gap-1.5">
            <Plus className="w-4 h-4" /> Create First Workflow
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: Workflow List */}
          <div className="space-y-2">
            {workflows.map(wf => (
              <div
                key={wf.id}
                onClick={() => setSelectedId(wf.id)}
                className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-sm ${
                  (selectedWorkflow?.id === wf.id) ? "border-primary bg-primary/5 shadow-sm" : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 truncate">{wf.name}</span>
                      {!wf.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                    </div>
                    {wf.description && <p className="text-xs text-gray-500 line-clamp-2">{wf.description}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs capitalize">{wf.category}</Badge>
                      <span className="text-xs text-gray-400">{wf.endpoints.length} endpoint{wf.endpoints.length !== 1 ? "s" : ""}</span>
                      <span className="text-xs text-gray-400">{wf.environmentConfigs.length} env{wf.environmentConfigs.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setWorkflowDialog({ open: true, initial: wf }); }}
                      className="h-7 w-7 p-0"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setDeleteWorkflow(wf); }}
                      className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Detail Panel */}
          <div className="lg:col-span-2">
            {selectedWorkflow ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{selectedWorkflow.name}</CardTitle>
                      {selectedWorkflow.description && <CardDescription>{selectedWorkflow.description}</CardDescription>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{selectedWorkflow.category}</Badge>
                      <Badge variant={selectedWorkflow.isActive ? "default" : "secondary"}>
                        {selectedWorkflow.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <WorkflowDetail workflow={selectedWorkflow} onRefresh={() => queryClient.invalidateQueries({ queryKey: ['/api/admin/workflows'] })} />
                </CardContent>
              </Card>
            ) : (
              <div className="border-2 border-dashed rounded-lg flex items-center justify-center h-64">
                <p className="text-gray-400 text-sm">Select a workflow to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Workflow Create/Edit Dialog */}
      <WorkflowDialog
        open={workflowDialog.open}
        onClose={() => setWorkflowDialog({ open: false })}
        initial={workflowDialog.initial}
        onSave={(data) => {
          if (workflowDialog.initial?.id) {
            updateWorkflow.mutate({ id: workflowDialog.initial.id, data });
          } else {
            createWorkflow.mutate(data);
          }
        }}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteWorkflow} onOpenChange={() => setDeleteWorkflow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteWorkflow?.name}</strong> and all its endpoints and environment configs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteWorkflow && deleteWorkflowMutation.mutate(deleteWorkflow.id)}>
              Delete Workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
