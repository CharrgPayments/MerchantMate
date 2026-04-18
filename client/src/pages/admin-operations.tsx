import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Clock, FileText, Play, RefreshCw, Trash2, Eye, ShieldAlert, CheckCircle2, Database, Archive } from "lucide-react";
import { ROLE_CODES, getUserRoleCodes } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";

type SlaApplication = {
  id: number;
  prospectId: number;
  pathway: string | null;
  status: string;
  slaDeadline: string | null;
  hoursOverdue: number;
};

type SlaBreach = {
  id: number;
  applicationId: number;
  pathway: string;
  status: string;
  hoursOverdue: number;
  detectedAt: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  notes: string | null;
};

type SlaStatusResponse = {
  overdueOpenCount: number;
  unacknowledgedBreaches: number;
  breaches: SlaBreach[];
  overdueApplications: SlaApplication[];
};

type ScheduledReport = {
  id: number;
  name: string;
  template: string;
  cadence: string;
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

type ScheduledReportRun = {
  id: number;
  reportId: number;
  status: string;
  rowCount: number;
  errorMessage: string | null;
  ranAt: string;
};

type SchemaDriftAlert = {
  id: number;
  detectedAt: string;
  baseEnvironment: string;
  targetEnvironment: string;
  differenceCount: number;
  differences: unknown;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
};

type ArchivedApplication = {
  id: number;
  originalApplicationId: number;
  prospectId: number | null;
  finalStatus: string;
  archivedAt: string;
  archivedReason: string;
  applicationSnapshot: unknown;
};

const TEMPLATES = [
  { value: "sla_summary", label: "SLA Breach Summary" },
  { value: "underwriting_pipeline", label: "Underwriting Throughput" },
  { value: "prospect_funnel", label: "Prospect Funnel" },
  { value: "residual_summary", label: "Residual Summary (6mo)" },
  { value: "commission_payouts", label: "Commission Payouts (30-day)" },
];

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function SlaTab() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<SlaStatusResponse | null>({
    queryKey: ["/api/applications/sla-status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/applications/sla-breaches/scan"),
    onSuccess: () => {
      toast({ title: "SLA scan complete", description: "Breach list refreshed." });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/sla-status"] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const ackMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/applications/sla-breaches/${id}/acknowledge`, { notes: "" }),
    onSuccess: () => {
      toast({ title: "Breach acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/sla-status"] });
    },
    onError: (e: any) => toast({ title: "Acknowledge failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const overdueOpenCount = data?.overdueOpenCount ?? 0;
  const unackCount = data?.unacknowledgedBreaches ?? 0;
  const breaches = data?.breaches ?? [];
  const overdueApps = data?.overdueApplications ?? [];

  return (
    <div className="space-y-4" data-testid="tab-sla">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 gap-4 flex-1 max-w-xl">
          <Card data-testid="card-overdue-count">
            <CardHeader className="pb-2">
              <CardDescription>Overdue Open Applications</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <Clock className="w-6 h-6 text-amber-500" />
                {overdueOpenCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card data-testid="card-unack-count">
            <CardHeader className="pb-2">
              <CardDescription>Unacknowledged Breaches</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-red-500" />
                {unackCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading} data-testid="button-refresh-sla">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} data-testid="button-scan-sla">
            <Play className="w-4 h-4 mr-2" /> {scanMutation.isPending ? "Scanning…" : "Run Scan"}
          </Button>
        </div>
      </div>

      {error && (
        <Card><CardContent className="py-6 text-sm text-red-600">Failed to load SLA status. <Button variant="link" onClick={() => refetch()}>Retry</Button></CardContent></Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Currently Overdue Applications</CardTitle>
          <CardDescription>PayFac applications past their SLA deadline.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>
          ) : overdueApps.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No overdue applications.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App ID</TableHead>
                  <TableHead>Prospect</TableHead>
                  <TableHead>Pathway</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueApps.map((a) => (
                  <TableRow key={a.id} data-testid={`row-overdue-${a.id}`}>
                    <TableCell className="font-mono">{a.id}</TableCell>
                    <TableCell className="font-mono">{a.prospectId}</TableCell>
                    <TableCell><Badge variant="outline">{a.pathway ?? "—"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                    <TableCell>{fmtDate(a.slaDeadline)}</TableCell>
                    <TableCell><Badge variant="destructive">{a.hoursOverdue}h</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Unacknowledged Breach Records</CardTitle>
          <CardDescription>Detected by the breach scanner. Acknowledge after triage.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>
          ) : breaches.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No unacknowledged breaches.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Pathway</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breaches.map((b) => (
                  <TableRow key={b.id} data-testid={`row-breach-${b.id}`}>
                    <TableCell className="font-mono">{b.applicationId}</TableCell>
                    <TableCell><Badge variant="outline">{b.pathway}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{b.status}</Badge></TableCell>
                    <TableCell><Badge variant="destructive">{b.hoursOverdue}h</Badge></TableCell>
                    <TableCell>{fmtDate(b.detectedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => ackMutation.mutate(b.id)} disabled={ackMutation.isPending} data-testid={`button-ack-${b.id}`}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Acknowledge
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsTab() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);
  const [runsForReport, setRunsForReport] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [template, setTemplate] = useState("sla_summary");
  const [cadence, setCadence] = useState("daily");
  const [recipients, setRecipients] = useState("");

  const reportsQuery = useQuery<ScheduledReport[] | null>({
    queryKey: ["/api/admin/scheduled-reports"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const reports = reportsQuery.data ?? [];

  const previewQuery = useQuery<{ subject: string; html: string; text: string; rowCount: number } | null>({
    queryKey: ["/api/admin/report-templates", previewTemplate, "preview"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/report-templates/${previewTemplate}/preview`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!previewTemplate,
  });

  const runsQuery = useQuery<ScheduledReportRun[] | null>({
    queryKey: ["/api/admin/scheduled-reports", runsForReport, "runs"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: runsForReport !== null,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const recipientList = recipients.split(",").map((r) => r.trim()).filter(Boolean);
      return apiRequest("POST", "/api/admin/scheduled-reports", {
        name, template, cadence, recipients: recipientList, enabled: true,
      });
    },
    onSuccess: () => {
      toast({ title: "Scheduled report created" });
      setCreateOpen(false);
      setName(""); setRecipients(""); setTemplate("sla_summary"); setCadence("daily");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-reports"] });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/scheduled-reports/${id}`),
    onSuccess: () => {
      toast({ title: "Report deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-reports"] });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/scheduled-reports/${id}/run-now`),
    onSuccess: () => {
      toast({ title: "Report dispatched" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-reports"] });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="tab-reports">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Scheduled Reports</h3>
          <p className="text-sm text-gray-500">Email-delivered SLA, pipeline-funnel, and commission digests.</p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-preview-templates"><Eye className="w-4 h-4 mr-2" /> Preview Templates</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Template Preview</DialogTitle>
                <DialogDescription>Render the report template against current data without sending email.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 mb-4">
                {TEMPLATES.map((t) => (
                  <Button key={t.value} size="sm" variant={previewTemplate === t.value ? "default" : "outline"} onClick={() => setPreviewTemplate(t.value)} data-testid={`button-preview-${t.value}`}>
                    {t.label}
                  </Button>
                ))}
              </div>
              {previewTemplate && (
                previewQuery.isLoading ? (
                  <div className="text-sm text-gray-500">Loading preview…</div>
                ) : previewQuery.data ? (
                  <div className="space-y-2">
                    <div className="text-sm"><strong>Subject:</strong> {previewQuery.data.subject}</div>
                    <div className="text-sm"><strong>Rows:</strong> {previewQuery.data.rowCount}</div>
                    <div className="border rounded p-3 max-h-96 overflow-auto bg-white" dangerouslySetInnerHTML={{ __html: previewQuery.data.html }} />
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">Failed to load preview.</div>
                )
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-report"><FileText className="w-4 h-4 mr-2" /> New Scheduled Report</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Scheduled Report</DialogTitle>
                <DialogDescription>Emails the rendered template on the chosen cadence.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily SLA digest" data-testid="input-report-name" />
                </div>
                <div>
                  <Label>Template</Label>
                  <Select value={template} onValueChange={setTemplate}>
                    <SelectTrigger data-testid="select-report-template"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cadence</Label>
                  <Select value={cadence} onValueChange={setCadence}>
                    <SelectTrigger data-testid="select-report-cadence"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CADENCES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Recipients (comma-separated emails)</Label>
                  <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@example.com, risk@example.com" data-testid="input-report-recipients" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate()} disabled={!name || !recipients || createMutation.isPending} data-testid="button-create-report">
                  {createMutation.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {reportsQuery.isLoading ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No scheduled reports yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} data-testid={`row-report-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.template}</Badge></TableCell>
                    <TableCell><Badge>{r.cadence}</Badge></TableCell>
                    <TableCell className="text-xs">{(r.recipients ?? []).join(", ")}</TableCell>
                    <TableCell className="text-xs">{fmtDate(r.lastRunAt)}</TableCell>
                    <TableCell className="text-xs">{fmtDate(r.nextRunAt)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setRunsForReport(r.id)} data-testid={`button-runs-${r.id}`}><Eye className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => runNowMutation.mutate(r.id)} disabled={runNowMutation.isPending} data-testid={`button-run-${r.id}`}><Play className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(r.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-${r.id}`}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={runsForReport !== null} onOpenChange={(o) => !o && setRunsForReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recent Runs</DialogTitle>
          </DialogHeader>
          {runsQuery.isLoading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (runsQuery.data ?? []).length === 0 ? (
            <div className="text-sm text-gray-500">No runs yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ran At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runsQuery.data ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{fmtDate(run.ranAt)}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === "success" ? "default" : "destructive"}>{run.status}</Badge>
                    </TableCell>
                    <TableCell>{run.rowCount}</TableCell>
                    <TableCell className="text-xs text-red-600">{run.errorMessage ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchemaDriftTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuper = getUserRoleCodes(user ?? null).includes(ROLE_CODES.SUPER_ADMIN);

  const driftQuery = useQuery<SchemaDriftAlert[] | null>({
    queryKey: ["/api/admin/schema-drift-alerts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isSuper,
  });

  const scanMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/schema-drift/scan"),
    onSuccess: () => {
      toast({ title: "Schema drift scan complete" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/schema-drift-alerts"] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const ackMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/schema-drift-alerts/${id}/acknowledge`),
    onSuccess: () => {
      toast({ title: "Alert acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/schema-drift-alerts"] });
    },
  });

  if (!isSuper) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-gray-500">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          Schema-drift monitoring is restricted to super-admins.
        </CardContent>
      </Card>
    );
  }

  const alerts = driftQuery.data ?? [];
  const unacked = alerts.filter((a) => !a.acknowledged);

  return (
    <div className="space-y-4" data-testid="tab-drift">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 gap-4 flex-1 max-w-xl">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Alerts (recent)</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <Database className="w-6 h-6 text-blue-500" />
                {alerts.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unacknowledged</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-red-500" />
                {unacked.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
        <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} data-testid="button-scan-drift">
          <Play className="w-4 h-4 mr-2" /> {scanMutation.isPending ? "Scanning…" : "Run Scan"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Drift Alerts</CardTitle>
          <CardDescription>Production database schema vs Development &amp; Test environments.</CardDescription>
        </CardHeader>
        <CardContent>
          {driftQuery.isLoading ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>
          ) : alerts.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-500" />
              No drift detected. Run a scan to refresh.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((a) => (
                <div key={a.id} className="border rounded p-3 space-y-2" data-testid={`row-drift-${a.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.acknowledged ? "outline" : "destructive"}>
                        {a.acknowledged ? "Acknowledged" : "Open"}
                      </Badge>
                      <span className="text-sm font-medium">{a.baseEnvironment} ⇄ {a.targetEnvironment}</span>
                      <span className="text-xs text-gray-500">{fmtDate(a.detectedAt)}</span>
                    </div>
                    {!a.acknowledged && (
                      <Button size="sm" variant="outline" onClick={() => ackMutation.mutate(a.id)} disabled={ackMutation.isPending} data-testid={`button-ack-drift-${a.id}`}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Acknowledge
                      </Button>
                    )}
                  </div>
                  <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-48">
                    {JSON.stringify(a.differences, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ArchiveTab() {
  const archiveQuery = useQuery<ArchivedApplication[] | null>({
    queryKey: ["/api/admin/archived-applications"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const statsQuery = useQuery<{ total: number } | null>({
    queryKey: ["/api/admin/archived-applications/stats"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const rows = archiveQuery.data ?? [];
  const total = statsQuery.data?.total ?? rows.length;

  return (
    <div className="space-y-4" data-testid="tab-archive">
      <div className="grid grid-cols-2 gap-4 max-w-xl">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total archived</CardDescription>
            <CardTitle className="text-3xl flex items-center gap-2" data-testid="card-archive-total">
              <Archive className="w-6 h-6 text-blue-500" />
              {total}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Showing</CardDescription>
            <CardTitle className="text-3xl">{rows.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Archived Applications</CardTitle>
          <CardDescription>Read-only — declined and withdrawn applications moved here by the retention policy.</CardDescription>
        </CardHeader>
        <CardContent>
          {archiveQuery.isLoading ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No archived applications yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Original ID</TableHead>
                  <TableHead>Prospect</TableHead>
                  <TableHead>Final Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Archived At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid={`row-archive-${r.id}`}>
                    <TableCell>{r.originalApplicationId}</TableCell>
                    <TableCell>{r.prospectId ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.finalStatus}</Badge></TableCell>
                    <TableCell className="text-xs text-gray-600">{r.archivedReason}</TableCell>
                    <TableCell className="text-xs text-gray-500">{fmtDate(r.archivedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminOperations() {
  return (
    <div className="p-6 space-y-4" data-testid="page-admin-operations">
      <div>
        <h2 className="text-2xl font-bold">Admin Operations</h2>
        <p className="text-sm text-gray-500">Monitor SLA breaches, schedule reports, and watch for production schema drift.</p>
      </div>

      <Tabs defaultValue="sla" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sla" data-testid="tab-trigger-sla"><Clock className="w-4 h-4 mr-2" /> SLA Monitor</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-trigger-reports"><FileText className="w-4 h-4 mr-2" /> Scheduled Reports</TabsTrigger>
          <TabsTrigger value="drift" data-testid="tab-trigger-drift"><Database className="w-4 h-4 mr-2" /> Schema Drift</TabsTrigger>
          <TabsTrigger value="archive" data-testid="tab-trigger-archive"><Archive className="w-4 h-4 mr-2" /> Archived Applications</TabsTrigger>
        </TabsList>
        <TabsContent value="sla"><SlaTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
        <TabsContent value="drift"><SchemaDriftTab /></TabsContent>
        <TabsContent value="archive"><ArchiveTab /></TabsContent>
      </Tabs>
    </div>
  );
}
