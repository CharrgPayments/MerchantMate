import { useState } from "react";
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
  Zap, ChevronRight, Loader2, CheckCircle2, Circle, Clock, AlertCircle,
  Bot, User, Globe, Settings2, FileText, Hash, Calendar, ArrowRight,
  XCircle, AlertTriangle, PlayCircle, PauseCircle, RefreshCw,
  Plus, Pencil, Trash2,
} from "lucide-react";
import { format } from "date-fns";

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
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const body = {
        ...data,
        handler_key: data.handler_key || null,
        timeout_minutes: data.timeout_minutes ? parseInt(data.timeout_minutes) : null,
      };
      if (isEdit) {
        return apiRequest("PUT", `/api/admin/workflows/${workflowId}/stages/${stage.id}`, body);
      }
      return apiRequest("POST", `/api/admin/workflows/${workflowId}/stages`, body);
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Stage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

function TicketDetailPanel({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/workflow-tickets", ticket.id],
    queryFn: () => fetch(`/api/admin/workflow-tickets/${ticket.id}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
    </div>
  );

  const stageProgress: any[] = detail?.stageProgress ?? [];
  const issues: any[] = detail?.issues ?? [];
  const notes: any[] = detail?.notes ?? [];

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
                <div className="space-y-1.5">
                  {stageProgress.map((sp: any) => {
                    const cfg = STAGE_STATUS_CONFIG[sp.status] ?? STAGE_STATUS_CONFIG.pending;
                    return (
                      <div key={sp.id} className="flex items-center gap-2 text-sm">
                        <span className={`p-1 rounded-full ${cfg.color}`}>{cfg.icon}</span>
                        <span className="flex-1 text-gray-700">{sp.stage_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.color}`}>{sp.status}</span>
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
                    <TabsTrigger value="endpoints" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-10">
                      <Globe className="h-3.5 w-3.5 mr-1.5" /> Endpoints ({wfDetail?.endpoints?.length ?? 0})
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

                    <TabsContent value="endpoints" className="mt-0">
                      <div className="py-12 text-center text-gray-400">
                        <Globe className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                        <p className="text-sm">No endpoints configured</p>
                      </div>
                    </TabsContent>

                    <TabsContent value="environments" className="mt-0">
                      <div className="py-12 text-center text-gray-400">
                        <Settings2 className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                        <p className="text-sm">No environment configs</p>
                      </div>
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
          onSaved={() => {}}
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
