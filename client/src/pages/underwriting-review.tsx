import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  Clock, MinusCircle, FileText, ListChecks, MessageSquare, History, RefreshCw,
} from "lucide-react";
import { APP_STATUS, STATUS_TRANSITIONS, PHASES } from "@shared/underwriting";

interface Props { }

const PHASE_STATUS_ICON: Record<string, JSX.Element> = {
  pass: <CheckCircle className="h-4 w-4 text-green-600" />,
  warn: <AlertTriangle className="h-4 w-4 text-yellow-600" />,
  fail: <XCircle className="h-4 w-4 text-red-600" />,
  error: <XCircle className="h-4 w-4 text-red-600" />,
  skipped: <MinusCircle className="h-4 w-4 text-gray-400" />,
};

function tierBadge(tier?: string | null) {
  if (!tier) return <Badge variant="outline">No Score</Badge>;
  const cls = tier === "low" ? "bg-green-100 text-green-800"
    : tier === "medium" ? "bg-yellow-100 text-yellow-800"
    : "bg-red-100 text-red-800";
  return <Badge className={cls}>{tier.toUpperCase()}</Badge>;
}

export default function UnderwritingReview(_: Props) {
  const [, params] = useRoute("/underwriting-review/:id");
  const id = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/applications", id, "underwriting"],
    queryFn: async () => {
      const r = await fetch(`/api/applications/${id}/underwriting`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!id,
  });

  const { data: history } = useQuery<any[]>({
    queryKey: ["/api/applications", id, "underwriting/history"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/history`)).json(),
    enabled: !!id,
  });

  const { data: tasks } = useQuery<any[]>({
    queryKey: ["/api/applications", id, "underwriting/tasks"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/tasks`)).json(),
    enabled: !!id,
  });

  const { data: notes } = useQuery<any[]>({
    queryKey: ["/api/applications", id, "underwriting/notes"],
    queryFn: async () => (await fetch(`/api/applications/${id}/underwriting/notes`)).json(),
    enabled: !!id,
  });

  const runMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/applications/${id}/underwriting/run`),
    onSuccess: () => {
      toast({ title: "Underwriting run completed" });
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting"] });
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/history"] });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e?.message, variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async (vars: { toStatus: string; reason: string; rejectionReason?: string; toSubStatus?: string }) =>
      apiRequest("POST", `/api/applications/${id}/underwriting/transition`, vars),
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting"] });
      qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting/history"] });
    },
    onError: (e: any) => toast({ title: "Transition failed", description: e?.message, variant: "destructive" }),
  });

  const issueMutation = useMutation({
    mutationFn: async (vars: { id: number; status: string; note?: string }) =>
      apiRequest("PATCH", `/api/underwriting/issues/${vars.id}`, { status: vars.status, note: vars.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/applications", id, "underwriting"] }),
  });

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [pendingTo, setPendingTo] = useState<string>("");
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
  const phases: any[] = data.phases || [];
  const issues: any[] = data.issues || [];
  const allowedNext: string[] = STATUS_TRANSITIONS[app.status as keyof typeof STATUS_TRANSITIONS] || [];

  function openTransition(to: string) {
    setPendingTo(to);
    setReason("");
    setRejectionReason("");
    setTransitionOpen(true);
  }
  function submitTransition() {
    if (!reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    transitionMutation.mutate({
      toStatus: pendingTo, reason,
      rejectionReason: pendingTo === APP_STATUS.DECLINED ? rejectionReason : undefined,
    }, { onSuccess: () => setTransitionOpen(false) });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/underwriting-queue"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to Queue</Button></Link>
        <div className="flex items-center gap-2">
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
              <Badge variant="outline">{app.status.replace(/_/g, " ").toUpperCase()}</Badge>
              {tierBadge(app.riskTier)}
              {app.riskScore != null && <Badge variant="outline">Score {app.riskScore}</Badge>}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-gray-500">Type</div><div className="font-medium">{app.underwritingType}</div></div>
            <div><div className="text-gray-500">Sub-status</div><div className="font-medium">{app.subStatus || "—"}</div></div>
            <div><div className="text-gray-500">Submitted</div><div className="font-medium">{app.submittedAt ? new Date(app.submittedAt).toLocaleString() : "—"}</div></div>
            <div><div className="text-gray-500">Reviewer</div><div className="font-medium">{app.assignedReviewerId || "Unassigned"}</div></div>
          </div>
          {allowedNext.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {allowedNext.map(s => (
                <Button key={s} size="sm" variant={s === "approved" ? "default" : s === "declined" ? "destructive" : "outline"}
                  onClick={() => openTransition(s)}>
                  Move to {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="phases">
        <TabsList>
          <TabsTrigger value="phases"><ShieldCheck className="h-4 w-4 mr-2" />Phases</TabsTrigger>
          <TabsTrigger value="issues"><AlertTriangle className="h-4 w-4 mr-2" />Issues ({issues.filter(i => i.status === "open").length})</TabsTrigger>
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
                {PHASES.map(def => {
                  const p = phases.find(x => x.phaseKey === def.key);
                  return (
                    <div key={def.key} className="flex items-start gap-3 p-3 border rounded-md">
                      <div className="mt-1">{p ? PHASE_STATUS_ICON[p.status] : <Clock className="h-4 w-4 text-gray-400" />}</div>
                      <div className="flex-1">
                        <div className="font-medium">{def.order}. {def.label}</div>
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
                            {p.findings.map((f: any, i: number) => (
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
            <DialogTitle>Move to {pendingTo.replace(/_/g, " ")}</DialogTitle>
            <DialogDescription>This change will be recorded in the audit trail and status history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason (required)</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you making this change?" />
            </div>
            {pendingTo === APP_STATUS.DECLINED && (
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
