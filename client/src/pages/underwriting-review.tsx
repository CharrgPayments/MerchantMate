import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ShieldCheck, Play, CheckCircle, XCircle, AlertTriangle,
  Clock, MinusCircle, ListChecks, MessageSquare, History, AlertOctagon, Wrench, Upload,
} from "lucide-react";
import {
  STATUS_LABEL, STATUS_FAMILY, PHASES, PATHWAYS,
  type AppStatus, type Pathway,
} from "@shared/underwriting";

interface PhaseRow {
  id: number; runId: number; phaseKey: string; phaseOrder: number;
  status: "pass" | "warn" | "fail" | "skipped" | "error";
  score: number; findings: { severity: string; message: string; code?: string; fieldPath?: string }[];
  durationMs: number | null; completedAt: string | null;
}
interface ApplicationRow {
  id: number; status: AppStatus; subStatus: string | null; pathway: Pathway;
  underwritingType: string; riskScore: number | null; riskTier: string | null;
  assignedReviewerId: string | null; submittedAt: string | null;
  slaDeadline: string | null; pipelineHaltedAtPhase: string | null;
  rejectionReason: string | null;
}
interface ReviewData {
  application: ApplicationRow;
  latestRun: { id: number; startedAt: string; status: string } | null;
  phases: PhaseRow[];
  allPhases: { underwriting_phase_results: PhaseRow }[];
  issues: { id: number; severity: string; message: string; phaseKey: string; code: string;
    fieldPath: string | null; status: string; resolutionNote: string | null }[];
  transitions: { to: AppStatus; requires: string; requireReason: boolean; description: string }[];
}

const PHASE_STATUS_ICON: Record<string, JSX.Element> = {
  pass:    <CheckCircle    className="h-4 w-4 text-green-600" />,
  warn:    <AlertTriangle  className="h-4 w-4 text-yellow-600" />,
  fail:    <XCircle        className="h-4 w-4 text-red-600" />,
  error:   <XCircle        className="h-4 w-4 text-red-600" />,
  skipped: <MinusCircle    className="h-4 w-4 text-gray-400" />,
};

function tierBadge(tier?: string | null) {
  if (!tier) return <Badge variant="outline">No Score</Badge>;
  const cls = tier === "low" ? "bg-green-100 text-green-800"
    : tier === "medium" ? "bg-yellow-100 text-yellow-800"
    : "bg-red-100 text-red-800";
  return <Badge className={cls}>{tier.toUpperCase()}</Badge>;
}
function statusBadge(s: AppStatus) {
  const family = STATUS_FAMILY[s];
  const cls =
    family === "approved" ? "bg-emerald-100 text-emerald-800" :
    family === "declined" ? "bg-red-100 text-red-800" :
    family === "pending"  ? "bg-amber-100 text-amber-800" :
    family === "in_review" ? "bg-blue-100 text-blue-800" :
    family === "withdrawn" ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-800";
  return <Badge className={cls}>{s} · {STATUS_LABEL[s]}</Badge>;
}

function SlaCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <Badge className="bg-red-200 text-red-900"><Clock className="h-3 w-3 mr-1" />SLA breached</Badge>;
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const cls = hrs < 4 ? "bg-red-100 text-red-800" : hrs < 12 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  return <Badge className={cls}><Clock className="h-3 w-3 mr-1" />SLA {hrs}h {mins}m</Badge>;
}

interface UnderwritingFile {
  id: number; fileName: string; contentType: string | null; size: number | null;
  category: string | null; description: string | null; uploadedBy: string | null; uploadedAt: string;
}

export default function UnderwritingReview() {
  const [, params] = useRoute("/underwriting-review/:id");
  const id = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ReviewData>({
    queryKey: ["/api/applications", id, "underwriting"],
    queryFn: async () => {
      const r = await fetch(`/api/applications/${id}/underwriting`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!id,
  });
  const { data: history } = useQuery<{ id: number; fromStatus: string | null; toStatus: string;
    toSubStatus: string | null; reason: string | null; changedBy: string | null; createdAt: string }[]>({
    queryKey: ["/api/applications", id, "underwriting/history"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/history`)).json(),
    enabled: !!id,
  });
  const { data: tasks } = useQuery<{ id: number; title: string; description: string | null; status: string; createdAt: string }[]>({
    queryKey: ["/api/applications", id, "underwriting/tasks"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/tasks`)).json(),
    enabled: !!id,
  });
  const { data: notes } = useQuery<{ id: number; body: string; visibility: string; authorUserId: string | null; createdAt: string }[]>({
    queryKey: ["/api/applications", id, "underwriting/notes"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/notes`)).json(),
    enabled: !!id,
  });

  // Underwriting application files.
  const { data: files } = useQuery<UnderwritingFile[]>({
    queryKey: ["/api/applications", id, "underwriting/files"],
    queryFn: async () => {
      const r = await fetch(`/api/applications/${id}/underwriting/files`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  const [uploadCategory, setUploadCategory] = useState("supporting_doc");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (uploadCategory) fd.append("category", uploadCategory);
      if (uploadDescription) fd.append("description", uploadDescription);
      const r = await fetch(`/api/applications/${id}/underwriting/files`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Upload failed");
      setUploadDescription("");
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/files"] });
      toast({ title: "File uploaded" });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleFileDelete(fileId: number) {
    if (!confirm("Delete this file?")) return;
    const r = await fetch(`/api/underwriting/files/${fileId}`, { method: "DELETE" });
    if (r.ok) {
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/files"] });
      toast({ title: "File deleted" });
    } else {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  const runMutation = useMutation<{ haltedAtPhase: string | null; recommendedDecline: string | null }, Error, void>({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/applications/${id}/underwriting/run`);
      return r.json();
    },
    onSuccess: (resp) => {
      toast({
        title: resp.haltedAtPhase ? `Pipeline halted at ${resp.haltedAtPhase}` : "Underwriting run completed",
        description: resp.recommendedDecline ? `Recommended decline: ${resp.recommendedDecline}` : undefined,
      });
      invalidateAll();
    },
    onError: (e) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async (vars: { toStatus: AppStatus; reason: string; rejectionReason?: string }) =>
      apiRequest("POST", `/api/applications/${id}/underwriting/transition`, vars),
    onSuccess: () => { toast({ title: "Status updated" }); invalidateAll(); },
    onError: (e: Error) => toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });

  const issueMutation = useMutation({
    mutationFn: async (vars: { id: number; status: string; note?: string }) =>
      apiRequest("PATCH", `/api/underwriting/issues/${vars.id}`, { status: vars.status, note: vars.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting"] }),
  });

  const manualMutation = useMutation({
    mutationFn: async (phaseKey: "derogatory_check" | "g2_check") =>
      apiRequest("POST", `/api/applications/${id}/underwriting/manual-phase`, { phaseKey }),
    onSuccess: () => { toast({ title: "Manual check completed" }); invalidateAll(); },
    onError: (e: Error) => toast({ title: "Manual check failed", description: e.message, variant: "destructive" }),
  });

  const pathwayMutation = useMutation({
    mutationFn: async (pathway: Pathway) =>
      apiRequest("POST", `/api/applications/${id}/underwriting/pathway`, { pathway }),
    onSuccess: () => { toast({ title: "Pathway updated" }); invalidateAll(); },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting"] });
    qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/history"] });
    qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/tasks"] });
    qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/notes"] });
  }

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [pendingTo, setPendingTo] = useState<AppStatus | "">("");
  const [reason, setReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const taskMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/applications/${id}/underwriting/tasks`, { title: taskTitle, description: taskDesc }),
    onSuccess: () => {
      setTaskTitle(""); setTaskDesc("");
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/tasks"] });
      toast({ title: "Task created" });
    },
  });
  const taskUpd = useMutation({
    mutationFn: async (v: { id: number; status: string }) => apiRequest("PATCH", `/api/underwriting/tasks/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/tasks"] }),
  });

  const [noteBody, setNoteBody] = useState("");
  const [noteVis, setNoteVis] = useState("internal");
  const noteMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/applications/${id}/underwriting/notes`, { body: noteBody, visibility: noteVis }),
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/notes"] });
    },
  });

  if (!id) return <div className="p-6">Invalid application id</div>;
  if (isLoading || !data) return <div className="p-6">Loading…</div>;

  const app = data.application;
  const latestRun = data.latestRun;
  const phases: PhaseRow[] = data.phases || [];
  const issues = data.issues || [];
  const transitions = data.transitions || [];
  const isTraditional = app.pathway === PATHWAYS.TRADITIONAL;

  function openTransition(to: AppStatus) {
    setPendingTo(to);
    setReason("");
    setRejectionReason("");
    setTransitionOpen(true);
  }
  function submitTransition() {
    const rule = transitions.find(t => t.to === pendingTo);
    if (!pendingTo) return;
    if (rule?.requireReason && !reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    transitionMutation.mutate({
      toStatus: pendingTo as AppStatus, reason,
      rejectionReason: pendingTo.startsWith("D") ? rejectionReason : undefined,
    }, { onSuccess: () => setTransitionOpen(false) });
  }

  function transitionVariant(to: AppStatus): "default" | "destructive" | "outline" {
    const fam = STATUS_FAMILY[to];
    if (fam === "approved") return "default";
    if (fam === "declined") return "destructive";
    return "outline";
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/underwriting-queue"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to Queue</Button></Link>
        <div className="flex items-center gap-2">
          <Select value={app.pathway} onValueChange={v => pathwayMutation.mutate(v as Pathway)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="traditional">Traditional</SelectItem>
              <SelectItem value="payfac">PayFac</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <Play className={`h-4 w-4 mr-2 ${runMutation.isPending ? "animate-pulse" : ""}`} />
            {runMutation.isPending ? "Running…" : latestRun ? "Re-run Pipeline" : "Run Underwriting"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /> Application #{app.id}</span>
            <div className="flex items-center gap-2 text-sm">
              {statusBadge(app.status)}
              {tierBadge(app.riskTier)}
              {app.riskScore != null && <Badge variant="outline">Score {app.riskScore}</Badge>}
              {app.slaDeadline && <SlaCountdown deadline={app.slaDeadline} />}
              {app.pipelineHaltedAtPhase && (
                <Badge className="bg-red-100 text-red-800"><AlertOctagon className="h-3 w-3 mr-1" />Halted: {app.pipelineHaltedAtPhase}</Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-gray-500">Pathway</div><div className="font-medium">{app.pathway}</div></div>
            <div><div className="text-gray-500">Type</div><div className="font-medium">{app.underwritingType}</div></div>
            <div><div className="text-gray-500">Submitted</div><div className="font-medium">{app.submittedAt ? new Date(app.submittedAt).toLocaleString() : "—"}</div></div>
            <div><div className="text-gray-500">Reviewer</div><div className="font-medium">{app.assignedReviewerId || "Unassigned"}</div></div>
          </div>
          {transitions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {transitions.map(t => (
                <Button key={t.to} size="sm" variant={transitionVariant(t.to)} onClick={() => openTransition(t.to)} title={t.description}>
                  {t.to} · {STATUS_LABEL[t.to]}
                </Button>
              ))}
            </div>
          )}
          {transitions.length === 0 && (
            <div className="mt-4 text-xs text-gray-500">No transitions available — either you don't hold the required permissions, or the application is in a terminal state.</div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="phases">
        <TabsList>
          <TabsTrigger value="phases"><ShieldCheck className="h-4 w-4 mr-2" />Phases</TabsTrigger>
          <TabsTrigger value="issues"><AlertTriangle className="h-4 w-4 mr-2" />Issues ({issues.filter(i => i.status === "open").length})</TabsTrigger>
          <TabsTrigger value="manual" disabled={!isTraditional}><Wrench className="h-4 w-4 mr-2" />Manual Checks</TabsTrigger>
          <TabsTrigger value="files"><Upload className="h-4 w-4 mr-2" />Files ({(files || []).length})</TabsTrigger>
          <TabsTrigger value="tasks"><ListChecks className="h-4 w-4 mr-2" />Tasks ({(tasks || []).filter(t => t.status !== "done" && t.status !== "cancelled").length})</TabsTrigger>
          <TabsTrigger value="notes"><MessageSquare className="h-4 w-4 mr-2" />Notes ({(notes || []).length})</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4 mr-2" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="phases" className="space-y-2">
          {!latestRun ? (
            <Card><CardContent className="py-8 text-center text-gray-500">No underwriting runs yet. Click "Run Underwriting" above.</CardContent></Card>
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base">Latest Run · {new Date(latestRun.startedAt).toLocaleString()} · {latestRun.status}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {PHASES.filter(def => !def.manual && !def.skipPaths.includes(app.pathway)).map(def => {
                  const p = phases.find(x => x.phaseKey === def.key);
                  return (
                    <div key={def.key} className="flex items-start gap-3 p-3 border rounded-md">
                      <div className="mt-1">{p ? PHASE_STATUS_ICON[p.status] : <Clock className="h-4 w-4 text-gray-400" />}</div>
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {def.order}. {def.label}
                          {def.checkpoint && <Badge variant="outline" className="text-xs">checkpoint</Badge>}
                        </div>
                        <div className="text-xs text-gray-500">{def.description}</div>
                        {p && (
                          <div className="text-xs mt-1 flex items-center gap-3">
                            <span>Status: <strong>{p.status}</strong></span>
                            <span>Score: <strong>{p.score}</strong></span>
                            {p.durationMs != null && <span>{p.durationMs}ms</span>}
                          </div>
                        )}
                        {p && Array.isArray(p.findings) && p.findings.length > 0 && (
                          <ul className="text-xs mt-2 space-y-1">
                            {p.findings.map((f, i) => (
                              <li key={i} className="text-gray-700">• <span className="font-medium">[{f.severity}]</span> {f.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="issues">
          <Card>
            <CardContent className="p-0">
              {issues.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No issues raised</div>
              ) : (
                <div className="divide-y">
                  {issues.map(i => (
                    <div key={i.id} className="p-4 flex items-start gap-3">
                      <Badge className={
                        i.severity === "critical" ? "bg-red-200 text-red-900" :
                        i.severity === "error" ? "bg-red-100 text-red-800" :
                        i.severity === "warning" ? "bg-yellow-100 text-yellow-800" :
                        "bg-gray-100 text-gray-700"
                      }>{i.severity}</Badge>
                      <div className="flex-1">
                        <div className="font-medium">{i.message}</div>
                        <div className="text-xs text-gray-500">{i.phaseKey} · {i.code}{i.fieldPath ? ` · ${i.fieldPath}` : ""}</div>
                        {i.resolutionNote && <div className="text-xs text-green-700 mt-1">Resolution: {i.resolutionNote}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{i.status}</Badge>
                        {i.status === "open" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => issueMutation.mutate({ id: i.id, status: "acknowledged" })}>Ack</Button>
                            <Button size="sm" variant="outline" onClick={() => issueMutation.mutate({ id: i.id, status: "resolved" })}>Resolve</Button>
                            <Button size="sm" variant="outline" onClick={() => issueMutation.mutate({ id: i.id, status: "waived" })}>Waive</Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader><CardTitle className="text-base">Manual Checks (Traditional)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-gray-600">
                These checks are not part of the automatic pipeline. Run them when you need additional diligence.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => manualMutation.mutate("derogatory_check")} disabled={manualMutation.isPending}>
                  <Wrench className="h-4 w-4 mr-2" /> Run Derogatory Check
                </Button>
                <Button onClick={() => manualMutation.mutate("g2_check")} disabled={manualMutation.isPending}>
                  <Wrench className="h-4 w-4 mr-2" /> Run G2 Check
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {(data.allPhases || []).filter(p =>
                  p.underwriting_phase_results.phaseKey === "derogatory_check" ||
                  p.underwriting_phase_results.phaseKey === "g2_check"
                ).map((row, idx) => {
                  const p = row.underwriting_phase_results;
                  return (
                    <div key={`${p.id}-${idx}`} className="flex items-start gap-3 p-3 border rounded-md">
                      <div className="mt-1">{PHASE_STATUS_ICON[p.status]}</div>
                      <div className="flex-1">
                        <div className="font-medium">{p.phaseKey === "derogatory_check" ? "Derogatory Check" : "G2 Check"}</div>
                        <div className="text-xs text-gray-500">{p.completedAt ? new Date(p.completedAt).toLocaleString() : ""} · {p.status}</div>
                        {Array.isArray(p.findings) && p.findings.map((f, i) => (
                          <div key={i} className="text-xs mt-1">• [{f.severity}] {f.message}</div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Upload File</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <Label>Category</Label>
                  <Select value={uploadCategory} onValueChange={setUploadCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_statement">Bank statement</SelectItem>
                      <SelectItem value="voided_check">Voided check</SelectItem>
                      <SelectItem value="business_license">Business license</SelectItem>
                      <SelectItem value="drivers_license">Driver's license</SelectItem>
                      <SelectItem value="processing_statement">Processing statement</SelectItem>
                      <SelectItem value="supporting_doc">Supporting document</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} />
                </div>
              </div>
              <Input
                type="file"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = "";
                }}
              />
              {uploading && <div className="text-xs text-gray-500">Uploading…</div>}
              <div className="text-xs text-gray-500">Max 25 MB per file. Uploads are recorded in the audit trail.</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {(files || []).length === 0 ? (
                <div className="py-8 text-center text-gray-500">No files uploaded yet</div>
              ) : (
                <div className="divide-y">
                  {(files || []).map(f => (
                    <div key={f.id} className="p-4 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{f.fileName}</div>
                        <div className="text-xs text-gray-500">
                          {f.category && <Badge variant="outline" className="mr-2">{f.category}</Badge>}
                          {f.contentType || "—"} · {f.size != null ? `${Math.round(f.size / 1024)} KB · ` : ""}{new Date(f.uploadedAt).toLocaleString()}
                        </div>
                        {f.description && <div className="text-xs text-gray-600 mt-1">{f.description}</div>}
                      </div>
                      <div className="flex gap-2">
                        <a href={`/api/underwriting/files/${f.id}/download`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline">Download</Button>
                        </a>
                        <Button size="sm" variant="outline" onClick={() => handleFileDelete(f.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">New Task</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Title" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
              <Textarea placeholder="Description (optional)" value={taskDesc} onChange={e => setTaskDesc(e.target.value)} />
              <Button onClick={() => taskMut.mutate()} disabled={!taskTitle.trim() || taskMut.isPending}>Create Task</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {(tasks || []).length === 0 ? (
                <div className="py-8 text-center text-gray-500">No tasks yet</div>
              ) : (
                <div className="divide-y">
                  {(tasks || []).map(t => (
                    <div key={t.id} className="p-4 flex items-start gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{t.title}</div>
                        {t.description && <div className="text-sm text-gray-600">{t.description}</div>}
                        <div className="text-xs text-gray-500 mt-1">Created {new Date(t.createdAt).toLocaleString()}</div>
                      </div>
                      <Select value={t.status} onValueChange={v => taskUpd.mutate({ id: t.id, status: v })}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Add Note</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea placeholder="Your note…" value={noteBody} onChange={e => setNoteBody(e.target.value)} />
              <div className="flex items-center gap-2">
                <Select value={noteVis} onValueChange={setNoteVis}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal only</SelectItem>
                    <SelectItem value="external">Visible to applicant</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => noteMut.mutate()} disabled={!noteBody.trim() || noteMut.isPending}>Save Note</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {(notes || []).length === 0 ? (
                <div className="py-8 text-center text-gray-500">No notes yet</div>
              ) : (
                <div className="divide-y">
                  {(notes || []).map(n => (
                    <div key={n.id} className="p-4">
                      <div className="text-xs text-gray-500 mb-1">
                        <Badge variant="outline" className="mr-2">{n.visibility}</Badge>
                        {new Date(n.createdAt).toLocaleString()} · {n.authorUserId || "system"}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">{n.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              {(history || []).length === 0 ? (
                <div className="py-8 text-center text-gray-500">No status changes yet</div>
              ) : (
                <div className="divide-y">
                  {(history || []).map(h => (
                    <div key={h.id} className="p-4 text-sm">
                      <div className="font-medium">
                        {h.fromStatus || "(initial)"} → <span className="text-blue-700">{h.toStatus}</span>
                        {h.toSubStatus && <span className="text-gray-500"> · {h.toSubStatus}</span>}
                      </div>
                      <div className="text-xs text-gray-500">{new Date(h.createdAt).toLocaleString()} · {h.changedBy || "system"}</div>
                      {h.reason && <div className="mt-1 text-gray-700">{h.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={transitionOpen} onOpenChange={setTransitionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to {pendingTo} · {pendingTo ? STATUS_LABEL[pendingTo as AppStatus] : ""}</DialogTitle>
            <DialogDescription>This change will be recorded in the audit trail and status history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason {transitions.find(t => t.to === pendingTo)?.requireReason ? "(required)" : "(optional)"}</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you making this change?" />
            </div>
            {pendingTo && pendingTo.startsWith("D") && (
              <div>
                <Label>Decline reason (shown to applicant)</Label>
                <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionOpen(false)}>Cancel</Button>
            <Button onClick={submitTransition} disabled={transitionMutation.isPending}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
