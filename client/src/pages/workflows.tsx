import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, ChevronRight, ChevronDown, Loader2, CheckCircle2, Circle, Clock, AlertCircle,
  Bot, User, Globe, Settings2, FileText, Hash, Calendar, ArrowRight,
  XCircle, AlertTriangle, PlayCircle, PauseCircle, RefreshCw,
  Plus, Pencil, Trash2, Eye, EyeOff, Server,
} from "lucide-react";
import { format } from "date-fns";
import { EndpointEditorDialog, type EndpointShape } from "@/components/endpoint-editor-dialog";

// ─── Status / type helpers ────────────────────────────────────────────────────

const TICKET_STATUS_CONFIG: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  submitted:      { label: "Submitted",      color: "bg-blue-100 text-blue-700",    icon: <Circle className="h-3 w-3" /> },
  pending_review: { label: "Pending Review", color: "bg-yellow-100 text-yellow-700",icon: <Clock className="h-3 w-3" /> },
  in_review:      { label: "In Review",      color: "bg-purple-100 text-purple-700",icon: <PlayCircle className="h-3 w-3" /> },
  approved:       { label: "Approved",       color: "bg-green-100 text-green-700",  icon: <CheckCircle2 className="h-3 w-3" /> },
  declined:       { label: "Declined",       color: "bg-red-100 text-red-700",      icon: <XCircle className="h-3 w-3" /> },
  on_hold:        { label: "On Hold",        color: "bg-gray-100 text-gray-600",    icon: <PauseCircle className="h-3 w-3" /> },
  cancelled:      { label: "Cancelled",      color: "bg-gray-100 text-gray-500",    icon: <XCircle className="h-3 w-3" /> },
};

const STAGE_STATUS_CONFIG: Record<string, { color: string; icon: JSX.Element }> = {
  pending:    { color: "bg-gray-100 text-gray-500",   icon: <Circle className="h-3.5 w-3.5" /> },
  in_progress:{ color: "bg-blue-100 text-blue-600",   icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  completed:  { color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  blocked:    { color: "bg-red-100 text-red-600",     icon: <AlertCircle className="h-3.5 w-3.5" /> },
  skipped:    { color: "bg-gray-100 text-gray-400",   icon: <ArrowRight className="h-3.5 w-3.5" /> },
  failed:     { color: "bg-red-100 text-red-700",     icon: <XCircle className="h-3.5 w-3.5" /> },
};

function ticketStatusBadge(status: string) {
  const cfg = TICKET_STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600", icon: <Circle className="h-3 w-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Workflow Form Dialog ─────────────────────────────────────────────────────

function WorkflowFormDialog({
  open, onClose, workflow, onSaved,
}: { open: boolean; onClose: () => void; workflow?: any; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = !!workflow;

  const form = useForm({
    defaultValues: {
      code: workflow?.code ?? "",
      name: workflow?.name ?? "",
      description: workflow?.description ?? "",
      version: workflow?.version ?? "1.0",
      category: workflow?.category ?? "underwriting",
      entity_type: workflow?.entity_type ?? "prospect_application",
      initial_status: workflow?.initial_status ?? "submitted",
      final_statuses: (workflow?.final_statuses ?? ["approved", "rejected"]).join(", "),
      is_active: workflow?.is_active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const body = {
        ...data,
        final_statuses: data.final_statuses.split(",").map((s: string) => s.trim()).filter(Boolean),
      };
      if (isEdit) {
        return apiRequest("PUT", `/api/admin/workflows/${workflow.id}`, body);
      }
      return apiRequest("POST", "/api/admin/workflows", body);
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Workflow updated" : "Workflow created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows-list"] });
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = form.handleSubmit((data) => mutation.mutate(data));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Workflow" : "New Workflow"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Code <span className="text-red-500">*</span></Label>
              <Input {...form.register("code")} placeholder="merchant_underwriting" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Version</Label>
              <Input {...form.register("version")} placeholder="1.0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input {...form.register("name")} placeholder="Merchant Application Underwriting" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea {...form.register("description")} placeholder="Optional description…" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category <span className="text-red-500">*</span></Label>
              <Input {...form.register("category")} placeholder="underwriting" />
            </div>
            <div className="space-y-1.5">
              <Label>Entity Type <span className="text-red-500">*</span></Label>
              <Input {...form.register("entity_type")} placeholder="prospect_application" className="font-mono text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Initial Status</Label>
              <Input {...form.register("initial_status")} placeholder="submitted" />
            </div>
            <div className="space-y-1.5">
              <Label>Final Statuses (comma-separated)</Label>
              <Input {...form.register("final_statuses")} placeholder="approved, rejected" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.watch("is_active")}
              onCheckedChange={(v) => form.setValue("is_active", v)}
            />
            <Label>Active</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stage Form Dialog ────────────────────────────────────────────────────────

function StageFormDialog({
  open, onClose, workflowId, stage, onSaved,
}: { open: boolean; onClose: () => void; workflowId: number; stage?: any; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = !!stage;
  const [showApiSection, setShowApiSection] = useState(false);

  // Load existing api config when editing
  const { data: existingApiConfig } = useQuery<any>({
    queryKey: ["/api/admin/workflows", workflowId, "stages", stage?.id, "api-config"],
    queryFn: () => fetch(`/api/admin/workflows/${workflowId}/stages/${stage.id}/api-config`, { credentials: "include" }).then(r => r.json()),
    enabled: isEdit && !!stage?.id && open,
    staleTime: 0,
    gcTime: 0,
  });

  // Task #43: the shared external_endpoints registry is now the only source
  // of transport for stages — the legacy per-workflow workflow_endpoints
  // table and the inline endpoint_url/http_method columns on
  // stage_api_configs were retired.
  const { data: registryEndpoints = [] } = useQuery<EndpointShape[]>({
    queryKey: ["/api/external-endpoints"],
    staleTime: 30_000,
    enabled: open,
  });
  const [endpointId, setEndpointId] = useState<number | null>(null);
  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointShape | null>(null);

  const form = useForm({
    defaultValues: {
      code: stage?.code ?? "",
      name: stage?.name ?? "",
      description: stage?.description ?? "",
      stage_type: stage?.stage_type ?? "automated",
      handler_key: stage?.handler_key ?? "",
      is_required: stage?.is_required ?? true,
      requires_review: stage?.requires_review ?? false,
      auto_advance: stage?.auto_advance ?? false,
      timeout_minutes: stage?.timeout_minutes ?? "",
      is_active: stage?.is_active ?? true,
      // API config fields
      api_request_mapping: "",
      api_response_mapping: "",
      api_timeout_seconds: "",
      api_max_retries: "3",
      api_retry_delay_seconds: "5",
      api_test_mode: false,
      api_mock_response: "",
    },
  });

  // Pre-populate api config fields when existing config loads
  useEffect(() => {
    if (existingApiConfig) {
      setShowApiSection(true);
      setEndpointId(existingApiConfig.endpoint_id ?? null);
      form.setValue("api_request_mapping", existingApiConfig.request_mapping
        ? JSON.stringify(existingApiConfig.request_mapping, null, 2) : "");
      form.setValue("api_response_mapping", existingApiConfig.response_mapping
        ? JSON.stringify(existingApiConfig.response_mapping, null, 2) : "");
      form.setValue("api_timeout_seconds", existingApiConfig.timeout_seconds ?? "");
      form.setValue("api_max_retries", existingApiConfig.max_retries ?? 3);
      form.setValue("api_retry_delay_seconds", existingApiConfig.retry_delay_seconds ?? 5);
      form.setValue("api_test_mode", existingApiConfig.test_mode ?? false);
      form.setValue("api_mock_response", existingApiConfig.mock_response
        ? JSON.stringify(existingApiConfig.mock_response, null, 2) : "");
    }
  }, [existingApiConfig]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const stageBody = {
        code: data.code, name: data.name, description: data.description,
        stage_type: data.stage_type, handler_key: data.handler_key || null,
        is_required: data.is_required, requires_review: data.requires_review,
        auto_advance: data.auto_advance, is_active: data.is_active,
        timeout_minutes: data.timeout_minutes ? parseInt(data.timeout_minutes) : null,
      };
      let savedStage: any;
      if (isEdit) {
        savedStage = await apiRequest("PUT", `/api/admin/workflows/${workflowId}/stages/${stage.id}`, stageBody);
      } else {
        savedStage = await apiRequest("POST", `/api/admin/workflows/${workflowId}/stages`, stageBody);
      }
      // Save api config if a registry endpoint is selected
      const stageId = savedStage?.id ?? stage?.id;
      if (stageId && endpointId) {
        let reqMap: any = undefined;
        let resMap: any = undefined;
        let mockRes: any = undefined;
        try { reqMap = data.api_request_mapping ? JSON.parse(data.api_request_mapping) : undefined; } catch {}
        try { resMap = data.api_response_mapping ? JSON.parse(data.api_response_mapping) : undefined; } catch {}
        try { mockRes = data.api_mock_response ? JSON.parse(data.api_mock_response) : undefined; } catch {}
        await apiRequest("PUT", `/api/admin/workflows/${workflowId}/stages/${stageId}/api-config`, {
          endpoint_id: endpointId,
          request_mapping: reqMap,
          response_mapping: resMap,
          timeout_seconds: data.api_timeout_seconds ? parseInt(data.api_timeout_seconds) : null,
          max_retries: parseInt(data.api_max_retries) || 3,
          retry_delay_seconds: parseInt(data.api_retry_delay_seconds) || 5,
          test_mode: data.api_test_mode,
          mock_response: mockRes,
          is_active: true,
        });
      } else if (stageId && !endpointId && existingApiConfig) {
        // Remove existing api config if the registry endpoint was cleared
        await apiRequest("DELETE", `/api/admin/workflows/${workflowId}/stages/${stageId}/api-config`);
      }
      return savedStage;
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Stage updated" : "Stage added" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", workflowId, "stages"] });
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = form.handleSubmit((data) => mutation.mutate(data));
  const stageType = form.watch("stage_type");
  const testMode = form.watch("api_test_mode");
  const selectedEndpoint = endpointId ? registryEndpoints.find(ep => ep.id === endpointId) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Stage" : "Add Stage"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Code <span className="text-red-500">*</span></Label>
              <Input {...form.register("code")} placeholder="mcc_screening" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Type <span className="text-red-500">*</span></Label>
              <Select value={stageType} onValueChange={(v) => form.setValue("stage_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automated">
                    <span className="flex items-center gap-2"><Bot className="h-3.5 w-3.5 text-blue-500" /> Automated</span>
                  </SelectItem>
                  <SelectItem value="manual">
                    <span className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-orange-500" /> Manual</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input {...form.register("name")} placeholder="MCC Screening" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea {...form.register("description")} placeholder="Optional description…" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Handler Key</Label>
              <Input {...form.register("handler_key")} placeholder="mcc_screening" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Timeout (minutes)</Label>
              <Input {...form.register("timeout_minutes")} type="number" placeholder="—" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.watch("is_required")} onCheckedChange={(v) => form.setValue("is_required", v)} />
              <span className="text-sm">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.watch("requires_review")} onCheckedChange={(v) => form.setValue("requires_review", v)} />
              <span className="text-sm">Requires Review</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.watch("auto_advance")} onCheckedChange={(v) => form.setValue("auto_advance", v)} />
              <span className="text-sm">Auto-advance</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={form.watch("is_active")} onCheckedChange={(v) => form.setValue("is_active", v)} />
              <span className="text-sm">Active</span>
            </label>
          </div>

          {/* API Endpoint Configuration */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
              onClick={() => setShowApiSection(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">API Endpoint</span>
                {selectedEndpoint && (
                  <Badge variant="secondary" className="text-xs font-mono truncate max-w-[220px]">
                    {selectedEndpoint.method} {selectedEndpoint.name}
                  </Badge>
                )}
              </div>
              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${showApiSection ? "rotate-180" : ""}`} />
            </button>

            {showApiSection && (
              <div className="p-4 space-y-4 border-t">
                {/* Registry-backed endpoint picker. Mirrors the Action
                    Template editor — selecting a registry endpoint moves
                    URL/method/headers/auth onto the shared external_endpoints
                    row. */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Globe className="w-4 h-4" /> External Endpoint
                    </Label>
                    {endpointId && (() => {
                      const sel = registryEndpoints.find(ep => ep.id === endpointId);
                      return sel ? (
                        <Badge variant="outline" className="text-xs">{sel.method} • registered</Badge>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select
                        value={endpointId ? String(endpointId) : "__none__"}
                        onValueChange={(v) => {
                          if (v === "__none__") setEndpointId(null);
                          else setEndpointId(parseInt(v, 10));
                        }}
                      >
                        <SelectTrigger data-testid="select-stage-endpoint">
                          <SelectValue placeholder="Choose an endpoint" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No endpoint</SelectItem>
                          {registryEndpoints.filter(ep => ep.isActive).map(ep => (
                            <SelectItem key={ep.id} value={String(ep.id)}>
                              <span className="flex items-center gap-2">
                                <span className={`text-xs font-bold px-1 rounded ${METHOD_COLORS[ep.method] ?? "bg-gray-100 text-gray-700"}`}>{ep.method}</span>
                                <span className="font-medium">{ep.name}</span>
                                <span className="text-gray-400 font-mono text-xs truncate max-w-[160px]">{ep.url}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {endpointId && (() => {
                      const sel = registryEndpoints.find(ep => ep.id === endpointId);
                      return sel ? (
                        <Button
                          type="button" variant="outline" size="sm"
                          onClick={() => { setEditingEndpoint(sel); setEndpointDialogOpen(true); }}
                          data-testid="button-edit-stage-endpoint"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                      ) : null;
                    })()}
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setEditingEndpoint(null); setEndpointDialogOpen(true); }}
                      data-testid="button-new-stage-endpoint"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> New
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    URL, method, headers and auth live on the shared external_endpoints registry. Request/response mapping, retries, and test mode below stay on this stage.
                  </p>
                </div>

                {/* Request / Response Mapping */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Request Mapping <span className="text-gray-400 font-normal">(JSON)</span></Label>
                    <Textarea
                      {...form.register("api_request_mapping")}
                      placeholder={'{\n  "merchant_id": "{{merchant.id}}"\n}'}
                      rows={4}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Response Mapping <span className="text-gray-400 font-normal">(JSON)</span></Label>
                    <Textarea
                      {...form.register("api_response_mapping")}
                      placeholder={'{\n  "status": "$.result.status"\n}'}
                      rows={4}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Retry settings */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Timeout (seconds)</Label>
                    <Input {...form.register("api_timeout_seconds")} type="number" placeholder="30" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max Retries</Label>
                    <Input {...form.register("api_max_retries")} type="number" placeholder="3" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Retry Delay (seconds)</Label>
                    <Input {...form.register("api_retry_delay_seconds")} type="number" placeholder="5" />
                  </div>
                </div>

                {/* Test mode */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={testMode} onCheckedChange={(v) => form.setValue("api_test_mode", v)} />
                    <span className="text-sm font-medium">Test Mode</span>
                    <span className="text-xs text-gray-400">Use mock response instead of calling the real endpoint</span>
                  </label>
                  {testMode && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mock Response <span className="text-gray-400 font-normal">(JSON)</span></Label>
                      <Textarea
                        {...form.register("api_mock_response")}
                        placeholder={'{\n  "status": "approved",\n  "score": 95\n}'}
                        rows={3}
                        className="font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Stage"}
            </Button>
          </DialogFooter>
        </form>
        {/* Inline editor for the registry-backed picker (Task #33). */}
        <EndpointEditorDialog
          open={endpointDialogOpen}
          onOpenChange={setEndpointDialogOpen}
          editing={editingEndpoint}
          onSaved={(id) => {
            setEndpointId(id);
            queryClient.invalidateQueries({ queryKey: ["/api/external-endpoints"] });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-green-100 text-green-800 border-green-200",
  POST:   "bg-blue-100 text-blue-800 border-blue-200",
  PUT:    "bg-yellow-100 text-yellow-800 border-yellow-200",
  PATCH:  "bg-orange-100 text-orange-800 border-orange-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};
const ENV_COLORS: Record<string, string> = {
  development: "bg-purple-100 text-purple-800 border-purple-200",
  test:        "bg-blue-100 text-blue-800 border-blue-200",
  production:  "bg-green-100 text-green-800 border-green-200",
};
const ENVIRONMENTS = ["development", "test", "production"];

function prettyJson(value: any): string {
  if (!value) return "";
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}
function parseJsonField(raw: string): any {
  if (!raw?.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Environment Config Row ───────────────────────────────────────────────────

function EnvConfigRow({ env, workflowId, config, onSaved }: {
  env: string; workflowId: number; config?: any; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [form, setForm] = useState({
    base_url:           config?.config?.base_url ?? "",
    bearer_token:       config?.config?.bearer_token ?? "",
    additional_headers: config?.config?.additional_headers ? prettyJson(config.config.additional_headers) : "",
    is_active:          config?.is_active !== false,
  });

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/admin/workflows/${workflowId}/env-configs/${env}`, {
      config: {
        base_url: form.base_url,
        bearer_token: form.bearer_token || undefined,
        additional_headers: parseJsonField(form.additional_headers),
      },
      is_active: form.is_active,
    }),
    onSuccess: () => {
      toast({ title: `${env} config saved` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", workflowId, "env-configs"] });
      onSaved();
      setEditing(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/workflows/${workflowId}/env-configs/${env}`),
    onSuccess: () => {
      toast({ title: `${env} config removed` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", workflowId, "env-configs"] });
      onSaved();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className={`border rounded-lg overflow-hidden ${config?.is_active === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 p-3 bg-gray-50">
        <Badge className={`text-xs border px-2 py-0.5 capitalize shrink-0 ${ENV_COLORS[env] || "bg-gray-100 text-gray-700"}`}>
          <Server className="w-3 h-3 mr-1 inline" />{env}
        </Badge>
        {config ? (
          <>
            <code className="text-sm font-mono text-gray-700 flex-1 truncate">{config.config?.base_url || "—"}</code>
            <Badge variant={config.is_active ? "default" : "secondary"} className="text-xs shrink-0">
              {config.is_active ? "Active" : "Inactive"}
            </Badge>
          </>
        ) : (
          <span className="text-sm text-gray-400 flex-1 italic">Not configured</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} className="h-7 px-2 text-xs">
            <Pencil className="w-3.5 h-3.5 mr-1" />{config ? "Edit" : "Configure"}
          </Button>
          {config && (
            <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate()} className="h-7 w-7 p-0 text-red-600 hover:text-red-700">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="p-4 border-t space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Base URL</Label>
            <Input
              value={form.base_url}
              onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
              placeholder={`https://api.${env === "production" ? "" : env + "."}example.com`}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Bearer Token</Label>
            <div className="flex gap-2">
              <Input
                type={showToken ? "text" : "password"}
                value={form.bearer_token}
                onChange={e => setForm(f => ({ ...f, bearer_token: e.target.value }))}
                placeholder="Enter Bearer token…"
                className="font-mono text-sm flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => setShowToken(!showToken)} className="px-3">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-400">Sent as: <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code></p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Additional Headers (JSON)</Label>
            <Textarea
              value={form.additional_headers}
              onChange={e => setForm(f => ({ ...f, additional_headers: e.target.value }))}
              placeholder={'{\n  "X-Client-Id": "crm-v1"\n}'}
              className="font-mono text-xs h-20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label className="text-sm">Active</Label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.base_url}>
              {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save Config
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Environments Tab ─────────────────────────────────────────────────────────

function EnvironmentsTab({ workflowId }: { workflowId: number }) {
  const { data: configs = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows", workflowId, "env-configs"],
    queryFn: () => fetch(`/api/admin/workflows/${workflowId}/env-configs`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;

  const configByEnv: Record<string, any> = {};
  (configs as any[]).forEach((c: any) => { configByEnv[c.environment] = c; });

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        Configure the base URL and Bearer token for each deployment environment. Tokens are stored securely.
      </p>
      <div className="space-y-3">
        {ENVIRONMENTS.map(env => (
          <EnvConfigRow
            key={env}
            env={env}
            workflowId={workflowId}
            config={configByEnv[env]}
            onSaved={() => refetch()}
          />
        ))}
      </div>
    </>
  );
}

// ─── Pipeline View ────────────────────────────────────────────────────────────

function PipelineView({
  stages, workflowId, onStageChanged,
}: { stages: any[]; workflowId: number; onStageChanged: () => void }) {
  const { toast } = useToast();
  const [editingStage, setEditingStage] = useState<any>(null);
  const [deletingStage, setDeletingStage] = useState<any>(null);

  const deleteMutation = useMutation({
    mutationFn: (stageId: number) =>
      apiRequest("DELETE", `/api/admin/workflows/${workflowId}/stages/${stageId}`),
    onSuccess: () => {
      toast({ title: "Stage deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", workflowId, "stages"] });
      onStageChanged();
      setDeletingStage(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!stages.length) return (
    <div className="py-12 text-center text-gray-400">
      <Zap className="h-10 w-10 mx-auto mb-2 text-gray-200" />
      <p className="text-sm">No stages defined yet</p>
    </div>
  );

  return (
    <>
      <div className="space-y-2">
        {stages.map((stage: any, idx: number) => (
          <div key={stage.id} className="flex items-start gap-3 group">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-xs font-bold text-blue-600">
                {idx + 1}
              </div>
              {idx < stages.length - 1 && <div className="w-0.5 h-4 bg-gray-200 my-0.5" />}
            </div>

            <Card className="flex-1 mb-0">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {stage.stage_type === "automated"
                      ? <Bot className="h-3.5 w-3.5 text-blue-500" />
                      : <User className="h-3.5 w-3.5 text-orange-500" />}
                    <span className="font-medium text-sm text-gray-900">{stage.name}</span>
                    {stage.is_required && (
                      <Badge variant="outline" className="text-xs py-0 h-4">Required</Badge>
                    )}
                    {stage.endpoint_url && (
                      <Badge className="text-xs py-0 h-4 bg-blue-50 text-blue-600 border border-blue-200 gap-1">
                        <Globe className="h-2.5 w-2.5" />
                        {stage.http_method} API
                      </Badge>
                    )}
                    {!stage.is_active && (
                      <Badge variant="secondary" className="text-xs py-0 h-4 text-gray-400">Inactive</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-2 text-xs text-gray-400 mr-2">
                      {stage.stage_type === "automated"
                        ? <span className="flex items-center gap-1"><Bot className="h-3 w-3" /> Automated</span>
                        : <span className="flex items-center gap-1"><User className="h-3 w-3" /> Manual</span>}
                      {stage.timeout_minutes && (
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {stage.timeout_minutes}m</span>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingStage(stage)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit stage"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingStage(stage)}
                      className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete stage"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {stage.description && (
                  <p className="text-xs text-gray-500 mt-1">{stage.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                  <span className="font-mono">{stage.code}</span>
                  {stage.handler_key && <span>→ {stage.handler_key}</span>}
                  {stage.requires_review && <Badge variant="secondary" className="py-0 h-4 text-xs">Requires Review</Badge>}
                  {stage.auto_advance && <Badge variant="secondary" className="py-0 h-4 text-xs">Auto-advance</Badge>}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {editingStage && (
        <StageFormDialog
          open={!!editingStage}
          onClose={() => setEditingStage(null)}
          workflowId={workflowId}
          stage={editingStage}
          onSaved={onStageChanged}
        />
      )}

      <AlertDialog open={!!deletingStage} onOpenChange={() => setDeletingStage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stage</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the stage <strong>{deletingStage?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMutation.mutate(deletingStage.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Tickets View ─────────────────────────────────────────────────────────────

function TicketsView({ tickets, onSelect }: { tickets: any[]; onSelect: (t: any) => void }) {
  if (!tickets.length) return (
    <div className="py-12 text-center text-gray-400">
      <FileText className="h-10 w-10 mx-auto mb-2 text-gray-200" />
      <p className="text-sm">No tickets found</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {tickets.map((t: any) => (
        <Card key={t.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onSelect(t)}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{t.ticket_number}</span>
                {ticketStatusBadge(t.status)}
                {t.priority && t.priority !== "normal" && (
                  <Badge variant="outline" className="text-xs py-0 h-5">{t.priority}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {t.risk_score != null && (
                  <span className={`font-medium ${t.risk_score > 70 ? "text-red-500" : t.risk_score > 40 ? "text-yellow-500" : "text-green-500"}`}>
                    Risk: {t.risk_score}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" /> Entity #{t.entity_id} ({t.entity_type?.replace("_", " ")})
              </span>
              {t.current_stage_name && (
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-blue-400" /> {t.current_stage_name}
                </span>
              )}
              {t.submitted_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> {format(new Date(t.submitted_at), "MMM d, yyyy")}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Ticket Detail Panel ──────────────────────────────────────────────────────

const ACTIONABLE_STATUSES = ["blocked", "pending", "in_progress"];

function TicketDetailPanel({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const { toast } = useToast();
  const [actionState, setActionState] = useState<{ ticketStageId: number; stageName: string; action: "approve" | "reject" | "unblock" } | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  const { data: detail, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/admin/workflow-tickets", ticket.id],
    queryFn: () => fetch(`/api/admin/workflow-tickets/${ticket.id}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  const { data: rawStaffUsers } = useQuery<any[]>({
    queryKey: ["/api/admin/workflow-users"],
    queryFn: async () => {
      const r = await fetch("/api/admin/workflow-users", { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60000,
  });
  const staffUsers: any[] = Array.isArray(rawStaffUsers) ? rawStaffUsers : [];

  const actionMutation = useMutation({
    mutationFn: ({ ticketStageId, action, notes }: { ticketStageId: number; action: string; notes: string }) =>
      apiRequest("PATCH", `/api/admin/workflow-tickets/${ticket.id}/stages/${ticketStageId}`, { action, notes }),
    onSuccess: (_, vars) => {
      const labels: Record<string, string> = { approve: "approved", reject: "rejected", unblock: "unblocked and advanced" };
      toast({ title: `Stage ${labels[vars.action] ?? vars.action}` });
      setActionState(null);
      setActionNotes("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflow-tickets"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: (userId: string | null) =>
      apiRequest("PATCH", `/api/admin/workflow-tickets/${ticket.id}/assign`, { assigned_to_id: userId }),
    onSuccess: (_, userId) => {
      toast({ title: userId ? "Ticket assigned" : "Ticket unassigned" });
      setShowAssignDialog(false);
      setSelectedUserId("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflow-tickets"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
    </div>
  );

  const stageProgress: any[] = detail?.stageProgress ?? [];
  const issues: any[] = detail?.issues ?? [];
  const notes: any[] = detail?.notes ?? [];
  const assignee = detail?.assigned_to_username;

  const openAction = (sp: any, action: "approve" | "reject" | "unblock") => {
    setActionNotes("");
    setActionState({ ticketStageId: sp.id, stageName: sp.stage_name, action });
  };

  const openAssign = () => {
    setSelectedUserId(detail?.assigned_to_id ?? "");
    setShowAssignDialog(true);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-gray-700">{ticket.ticket_number}</span>
            {ticketStatusBadge(ticket.status)}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {ticket.entity_type?.replace(/_/g, " ")} #{ticket.entity_id}
            {ticket.metadata?.businessName && ` — ${ticket.metadata.businessName}`}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">← Back</button>
      </div>

      {/* Assignment bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-gray-400" />
          {assignee ? (
            <span className="text-xs text-gray-700">
              Assigned to <span className="font-semibold">{assignee}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-400 italic">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={openAssign}>
            {assignee ? "Reassign" : "Assign"}
          </Button>
          {assignee && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
              onClick={() => assignMutation.mutate(null)}
              disabled={assignMutation.isPending}
            >
              Unassign
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800">{stageProgress.length}</div>
              <div className="text-xs text-gray-500">Stages Run</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-red-600">{issues.filter((i: any) => i.status !== "resolved").length}</div>
              <div className="text-xs text-gray-500">Open Issues</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className={`text-lg font-bold ${ticket.risk_score > 70 ? "text-red-600" : ticket.risk_score > 40 ? "text-yellow-600" : "text-green-600"}`}>
                {ticket.risk_score ?? "—"}
              </div>
              <div className="text-xs text-gray-500">Risk Score</div>
            </div>
          </div>

          {stageProgress.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Stage Progress</h4>
                <div className="space-y-2">
                  {stageProgress.map((sp: any) => {
                    const cfg = STAGE_STATUS_CONFIG[sp.status] ?? STAGE_STATUS_CONFIG.pending;
                    const isActionable = ACTIONABLE_STATUSES.includes(sp.status);
                    const needsReview = sp.requires_review;
                    return (
                      <div key={sp.id} className={`rounded-lg border ${isActionable ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-white"} p-2.5`}>
                        <div className="flex items-center gap-2">
                          <span className={`p-0.5 rounded-full ${cfg.color}`}>{cfg.icon}</span>
                          <span className="flex-1 text-sm font-medium text-gray-800">{sp.stage_name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{sp.status}</span>
                        </div>
                        {sp.error_message && (
                          <p className="text-xs text-red-500 mt-1 pl-6">{sp.error_message}</p>
                        )}
                        {sp.review_notes && (
                          <p className="text-xs text-gray-500 mt-1 pl-6 italic">"{sp.review_notes}"</p>
                        )}
                        {isActionable && (
                          <div className="flex items-center gap-2 mt-2 pl-6">
                            {sp.status === "blocked" ? (
                              <Button
                                size="sm"
                                className="h-6 text-xs bg-blue-600 hover:bg-blue-700"
                                onClick={() => openAction(sp, "unblock")}
                              >
                                <ArrowRight className="h-3 w-3 mr-1" /> Unblock & Advance
                              </Button>
                            ) : needsReview ? (
                              <>
                                <Button
                                  size="sm"
                                  className="h-6 text-xs bg-green-600 hover:bg-green-700"
                                  onClick={() => openAction(sp, "approve")}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs text-red-600 border-red-300 hover:bg-red-50"
                                  onClick={() => openAction(sp, "reject")}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                className="h-6 text-xs bg-green-600 hover:bg-green-700"
                                onClick={() => openAction(sp, "approve")}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Complete & Advance
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {issues.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Issues ({issues.length})</h4>
                <div className="space-y-2">
                  {issues.map((issue: any) => (
                    <div key={issue.id} className="flex items-start gap-2 text-sm bg-red-50 rounded-lg p-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 text-xs">{issue.title}</span>
                          <Badge variant="outline" className="text-xs py-0 h-4">{issue.severity}</Badge>
                        </div>
                        {issue.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{issue.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {notes.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes ({notes.length})</h4>
                <div className="space-y-2">
                  {notes.map((note: any) => (
                    <div key={note.id} className="bg-gray-50 rounded-lg p-2.5 text-sm">
                      <p className="text-gray-700 text-xs">{note.content}</p>
                      <p className="text-gray-400 text-xs mt-1">
                        {note.created_by} · {format(new Date(note.created_at), "MMM d, h:mm a")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Stage Action Confirmation Dialog */}
      <Dialog open={!!actionState} onOpenChange={() => { setActionState(null); setActionNotes(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionState?.action === "approve" && "Approve Stage"}
              {actionState?.action === "reject" && "Reject Stage"}
              {actionState?.action === "unblock" && "Unblock & Advance Stage"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {actionState?.action === "reject"
                ? <>Rejecting <strong>{actionState?.stageName}</strong> will mark this ticket as declined.</>
                : <>Completing <strong>{actionState?.stageName}</strong> will advance the ticket to the next stage.</>
              }
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes <span className="text-gray-400">(optional)</span></Label>
              <Textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add a note about this decision…"
                rows={3}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setActionState(null); setActionNotes(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className={actionState?.action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
              disabled={actionMutation.isPending}
              onClick={() => actionState && actionMutation.mutate({
                ticketStageId: actionState.ticketStageId,
                action: actionState.action,
                notes: actionNotes,
              })}
            >
              {actionMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {actionState?.action === "approve" && "Approve"}
              {actionState?.action === "reject" && "Reject"}
              {actionState?.action === "unblock" && "Unblock & Advance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { if (!open) { setShowAssignDialog(false); setSelectedUserId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Select a team member to assign <strong>{ticket.ticket_number}</strong> to for review.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Assignee</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent>
                  {staffUsers.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.username}</span>
                        <span className="text-xs text-gray-400">{u.email}</span>
                        <Badge variant="outline" className="text-xs py-0 h-4 ml-auto">
                          {(u.roles?.[0] ?? "").replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowAssignDialog(false); setSelectedUserId(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!selectedUserId || assignMutation.isPending}
              onClick={() => assignMutation.mutate(selectedUserId)}
            >
              {assignMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Workflows() {
  const { toast } = useToast();
  const [selectedWorkflow, setSelectedWorkflow] = useState<any>(null);
  const [selectedTicket, setSelectedTicket]     = useState<any>(null);
  const [activeTab, setActiveTab]               = useState("stages");

  const [showNewWorkflow,  setShowNewWorkflow]  = useState(false);
  const [showEditWorkflow, setShowEditWorkflow] = useState(false);
  const [showDeleteWorkflow, setShowDeleteWorkflow] = useState(false);
  const [showAddStage, setShowAddStage]         = useState(false);

  const { data: workflows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows-list"],
    queryFn: () => fetch("/api/admin/workflows", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
  });

  const { data: stages = [], isLoading: stagesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows", selectedWorkflow?.id, "stages"],
    queryFn: () => fetch(`/api/admin/workflows/${selectedWorkflow.id}/stages`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
    staleTime: 0,
  });

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflow-tickets", selectedWorkflow?.id],
    queryFn: () => fetch(`/api/admin/workflow-tickets?workflowId=${selectedWorkflow.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
    staleTime: 0,
  });

  const { data: wfDetail } = useQuery<any>({
    queryKey: ["/api/admin/workflows", selectedWorkflow?.id],
    queryFn: () => fetch(`/api/admin/workflows/${selectedWorkflow.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
    staleTime: 0,
  });

  const deleteWorkflowMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/workflows/${selectedWorkflow.id}`),
    onSuccess: () => {
      toast({ title: "Workflow deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows-list"] });
      setSelectedWorkflow(null);
      setShowDeleteWorkflow(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/workflows/${selectedWorkflow.id}/toggle`, {}),
    onSuccess: async (res) => {
      const updated = await res.json();
      setSelectedWorkflow(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows-list"] });
      toast({ title: updated.is_active ? "Workflow activated" : "Workflow deactivated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: workflow list ── */}
      <div className="w-72 border-r bg-white flex flex-col shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">Workflows</h2>
              <Badge variant="secondary">{(workflows as any[]).length}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows-list"] })}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setShowNewWorkflow(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">Automation workflow definitions</p>
        </div>

        <ScrollArea className="flex-1">
          {(workflows as any[]).length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              <Zap className="h-10 w-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No workflows yet</p>
              <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setShowNewWorkflow(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create First Workflow
              </Button>
            </div>
          ) : (
            (workflows as any[]).map((wf: any) => (
              <div
                key={wf.id}
                onClick={() => { setSelectedWorkflow(wf); setSelectedTicket(null); setActiveTab("stages"); }}
                className={`p-4 border-b cursor-pointer hover:bg-gray-50 transition-colors ${selectedWorkflow?.id === wf.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{wf.name}</p>
                    {wf.category && <p className="text-xs text-gray-400 mt-0.5 capitalize">{wf.category}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${wf.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {wf.is_active ? "Active" : "Inactive"}
                      </span>
                      <span className="text-xs text-gray-400">{wf.stage_count ?? 0} stages</span>
                      <span className="text-xs text-gray-400">{wf.ticket_count ?? 0} tickets</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 ml-2 shrink-0 mt-1" />
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-hidden bg-gray-50 flex">

        {!selectedWorkflow ? (
          <div className="flex flex-col items-center justify-center flex-1 text-gray-400">
            <Zap className="h-16 w-16 mb-4 text-gray-200" />
            <p className="text-lg font-medium">Select a workflow</p>
            <p className="text-sm">Choose a workflow from the left to view its details</p>
          </div>
        ) : selectedTicket ? (
          <div className="flex-1 overflow-hidden">
            <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">

            {/* Header */}
            <div className="bg-white border-b px-6 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-gray-900">{selectedWorkflow.name}</h1>
                    <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${selectedWorkflow.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {selectedWorkflow.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {selectedWorkflow.description && (
                    <p className="text-sm text-gray-500 mt-1">{selectedWorkflow.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    {selectedWorkflow.category && <span className="capitalize">{selectedWorkflow.category}</span>}
                    {selectedWorkflow.entity_type && <span className="font-mono bg-gray-100 px-1.5 rounded">{selectedWorkflow.entity_type}</span>}
                    {selectedWorkflow.code && <span className="font-mono text-blue-400">{selectedWorkflow.code}</span>}
                    {selectedWorkflow.version && <span>v{selectedWorkflow.version}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Stats */}
                  <div className="flex items-center gap-4 text-center mr-2">
                    <div>
                      <div className="text-2xl font-bold text-blue-600">{stages.length}</div>
                      <div className="text-xs text-gray-400">Stages</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-700">{tickets.length}</div>
                      <div className="text-xs text-gray-400">Tickets</div>
                    </div>
                  </div>
                  {/* Actions */}
                  <Button
                    size="sm" variant="outline"
                    onClick={() => toggleMutation.mutate()}
                    disabled={toggleMutation.isPending}
                    className="text-xs"
                  >
                    {selectedWorkflow.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowEditWorkflow(true)} className="text-xs">
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setShowDeleteWorkflow(true)}
                    className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex-1 overflow-hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                <div className="bg-white border-b px-6">
                  <TabsList className="h-10 bg-transparent border-0 p-0 gap-0">
                    <TabsTrigger value="stages" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-10">
                      <Zap className="h-3.5 w-3.5 mr-1.5" /> Stages ({stages.length})
                    </TabsTrigger>
                    <TabsTrigger value="tickets" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-10">
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Tickets ({tickets.length})
                    </TabsTrigger>
                    <TabsTrigger value="environments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-10">
                      <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Environments
                    </TabsTrigger>
                  </TabsList>
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-6">

                    <TabsContent value="stages" className="mt-0">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-gray-500">
                          {stages.length} stage{stages.length !== 1 ? "s" : ""} in this workflow
                        </p>
                        <Button size="sm" onClick={() => setShowAddStage(true)}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Stage
                        </Button>
                      </div>
                      {stagesLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                      ) : (
                        <PipelineView
                          stages={stages}
                          workflowId={selectedWorkflow.id}
                          onStageChanged={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", selectedWorkflow.id, "stages"] })}
                        />
                      )}
                    </TabsContent>

                    <TabsContent value="tickets" className="mt-0">
                      {ticketsLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                      ) : (
                        <TicketsView tickets={tickets as any[]} onSelect={setSelectedTicket} />
                      )}
                    </TabsContent>

                    <TabsContent value="environments" className="mt-0">
                      <EnvironmentsTab workflowId={selectedWorkflow.id} />
                    </TabsContent>

                  </div>
                </ScrollArea>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}

      {showNewWorkflow && (
        <WorkflowFormDialog
          open={showNewWorkflow}
          onClose={() => setShowNewWorkflow(false)}
          onSaved={() => {}}
        />
      )}

      {showEditWorkflow && selectedWorkflow && (
        <WorkflowFormDialog
          open={showEditWorkflow}
          onClose={() => setShowEditWorkflow(false)}
          workflow={selectedWorkflow}
          onSaved={() => setSelectedWorkflow(null)}
        />
      )}

      {showAddStage && selectedWorkflow && (
        <StageFormDialog
          open={showAddStage}
          onClose={() => setShowAddStage(false)}
          workflowId={selectedWorkflow.id}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows", selectedWorkflow.id, "stages"] });
            setShowAddStage(false);
          }}
        />
      )}

      <AlertDialog open={showDeleteWorkflow} onOpenChange={setShowDeleteWorkflow}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedWorkflow?.name}</strong>?
              All stages will also be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteWorkflowMutation.mutate()}
            >
              Delete Workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
