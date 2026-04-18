import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, Play, RotateCcw, AlertTriangle, CheckCircle2, RefreshCw, History, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Env = "development" | "test" | "production";
type Risk = "safe" | "risky" | "ambiguous";

interface PlanStatement {
  index: number;
  sql: string;
  kind: string;
  risk: Risk;
  description: string;
}
interface Plan {
  planId: string;
  targetEnv: Env;
  generatedAt: string;
  statements: PlanStatement[];
  hasAmbiguous: boolean;
  warnings: string[];
  sha?: string;
  certifiedFromTest?: boolean;
  certification?: { certifiedAt: string; certifiedBy?: string } | null;
}
interface SnapshotItem {
  file: string;
  name: string;
  sizeBytes: number;
  mtime: string;
}

const riskColor: Record<Risk, string> = {
  safe: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  risky: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  ambiguous: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

export default function SchemaSyncPanel() {
  const { toast } = useToast();
  const [targetEnv, setTargetEnv] = useState<Env>("development");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [prodConfirmText, setProdConfirmText] = useState("");
  const [renameAnswers, setRenameAnswers] = useState<string>("");
  const logRef = useRef<HTMLDivElement>(null);

  const snapshotsQ = useQuery<{ success: boolean; snapshots: SnapshotItem[] }>({
    queryKey: ["/api/admin/schema-sync/snapshots", targetEnv],
    queryFn: async () => {
      const r = await fetch(`/api/admin/schema-sync/snapshots?env=${targetEnv}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load snapshots");
      return r.json();
    },
  });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const appendLog = (line: string) =>
    setEvents((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const generate = async () => {
    setPlanning(true);
    setPlan(null);
    setEvents([]);
    try {
      const answers = renameAnswers
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((s) => Number(s) || 0);
      const r = await fetch("/api/admin/schema-sync/plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEnv, renameAnswers: answers }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.message || "Plan failed");
      setPlan(data.plan);
      appendLog(`Plan generated: ${data.plan.statements.length} statement(s)`);
      if (data.plan.statements.length === 0) {
        toast({ title: "No drift detected", description: `${targetEnv} matches schema.ts` });
      }
    } catch (e: any) {
      toast({ title: "Plan failed", description: e.message, variant: "destructive" });
      appendLog(`ERROR: ${e.message}`);
    } finally {
      setPlanning(false);
    }
  };

  const streamSse = async (url: string, body: any, onDone: () => void) => {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() || "";
      for (const block of lines) {
        const m = block.match(/^data:\s*(.*)$/m);
        if (!m) continue;
        try {
          const ev = JSON.parse(m[1]);
          if (ev.type === "stmt-start") {
            appendLog(`▶ [${ev.index! + 1}] ${ev.message}`);
          } else if (ev.type === "stmt-ok") {
            appendLog(`✓ [${ev.index! + 1}] ${ev.message ?? "ok"}`);
          } else if (ev.type === "stmt-error") {
            appendLog(`✗ [${ev.index! + 1}] ${ev.error}`);
          } else if (ev.type === "done") {
            appendLog(`DONE: ${ev.ok ? "success" : "failed"}`);
          } else if (ev.type === "info") {
            appendLog(`• ${ev.message}`);
          } else if (ev.type === "error") {
            appendLog(`ERROR: ${ev.error}`);
          }
        } catch {}
      }
    }
    onDone();
  };

  const apply = async (confirmProd: boolean) => {
    if (!plan) return;
    setApplying(true);
    try {
      await streamSse(
        "/api/admin/schema-sync/apply",
        { planId: plan.planId, confirmProd },
        () => {
          toast({ title: "Apply finished", description: "See live log for details" });
          snapshotsQ.refetch();
        },
      );
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
      appendLog(`ERROR: ${e.message}`);
    } finally {
      setApplying(false);
      setConfirmOpen(false);
      setProdConfirmText("");
    }
  };

  const onApplyClick = () => {
    if (!plan) return;
    if (plan.targetEnv === "production") {
      setConfirmOpen(true);
    } else {
      apply(false);
    }
  };

  const rollback = async (snapshotFile?: string) => {
    if (!confirm(`Rollback ${targetEnv} to ${snapshotFile ?? "latest snapshot"}?`)) return;
    setRolling(true);
    setEvents([]);
    try {
      await streamSse(
        "/api/admin/schema-sync/rollback",
        { targetEnv, snapshotFile },
        () => {
          toast({ title: "Rollback finished" });
          snapshotsQ.refetch();
        },
      );
    } catch (e: any) {
      toast({ title: "Rollback failed", description: e.message, variant: "destructive" });
      appendLog(`ERROR: ${e.message}`);
    } finally {
      setRolling(false);
    }
  };

  const stats = plan
    ? {
        total: plan.statements.length,
        safe: plan.statements.filter((s) => s.risk === "safe").length,
        risky: plan.statements.filter((s) => s.risk === "risky").length,
        ambiguous: plan.statements.filter((s) => s.risk === "ambiguous").length,
      }
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Schema Sync
          </CardTitle>
          <CardDescription>
            Generate a migration plan from drift between <code>shared/schema.ts</code> and the target database,
            review each statement's risk, then apply transactionally with a snapshot for rollback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Target environment</label>
              <Select value={targetEnv} onValueChange={(v) => setTargetEnv(v as Env)}>
                <SelectTrigger className="w-48" data-testid="select-target-env">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">development</SelectItem>
                  <SelectItem value="test">test</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-sm font-medium">
                Rename answers (optional, e.g. <code>0,1,0</code>)
              </label>
              <Input
                placeholder="0 = create new, 1 = rename"
                value={renameAnswers}
                onChange={(e) => setRenameAnswers(e.target.value)}
                data-testid="input-rename-answers"
              />
            </div>
            <Button onClick={generate} disabled={planning} data-testid="button-generate-plan">
              {planning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Generate Plan
            </Button>
          </div>

          {plan && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  Plan <code>{plan.planId.slice(0, 8)}</code> for <strong>{plan.targetEnv}</strong>:
                </span>
                <Badge variant="secondary">{stats!.total} total</Badge>
                <Badge className={riskColor.safe}>{stats!.safe} safe</Badge>
                <Badge className={riskColor.risky}>{stats!.risky} risky</Badge>
                <Badge className={riskColor.ambiguous}>{stats!.ambiguous} ambiguous</Badge>
                {plan.hasAmbiguous && (
                  <span className="text-amber-700 dark:text-amber-300">
                    ⚠ Provide rename answers above and regenerate to resolve.
                  </span>
                )}
                {plan.targetEnv === "production" && (
                  plan.certifiedFromTest ? (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                      ✓ Certified by Test {plan.certification?.certifiedAt
                        ? `at ${new Date(plan.certification.certifiedAt).toLocaleString()}`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                      ✗ Not certified by Test — apply to Test first
                    </Badge>
                  )
                )}
              </AlertDescription>
            </Alert>
          )}

          {plan && plan.targetEnv === "production" && !plan.certifiedFromTest && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Promotion policy:</strong> changes flow Development → Test → Production.
                This plan has not been certified by a successful apply against Test, so Production
                apply is blocked. Switch the target to <strong>test</strong>, apply there, then
                regenerate the plan for <strong>production</strong>.
              </AlertDescription>
            </Alert>
          )}

          {plan && plan.warnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {plan && plan.statements.length > 0 && (
            <>
              <div className="border rounded-md max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-24">Risk</TableHead>
                      <TableHead className="w-40">Kind</TableHead>
                      <TableHead>Description / SQL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.statements.map((s) => (
                      <TableRow key={s.index} data-testid={`row-stmt-${s.index}`}>
                        <TableCell>{s.index + 1}</TableCell>
                        <TableCell>
                          <Badge className={riskColor[s.risk]}>{s.risk}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{s.kind}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{s.description}</div>
                          <pre className="mt-1 text-xs bg-muted/50 rounded p-2 whitespace-pre-wrap break-all">
                            {s.sql}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={onApplyClick}
                  disabled={
                    applying ||
                    plan.hasAmbiguous ||
                    (plan.targetEnv === "production" && !plan.certifiedFromTest)
                  }
                  variant={plan.targetEnv === "production" ? "destructive" : "default"}
                  data-testid="button-apply-plan"
                  title={
                    plan.targetEnv === "production" && !plan.certifiedFromTest
                      ? "Apply to Test first to certify this plan"
                      : undefined
                  }
                >
                  {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Apply to {plan.targetEnv}
                </Button>
                <Button variant="outline" onClick={() => rollback()} disabled={rolling} data-testid="button-rollback-latest">
                  {rolling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  Rollback to latest snapshot
                </Button>
              </div>
            </>
          )}

          {events.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1">Live log</div>
              <div
                ref={logRef}
                className="bg-black text-green-300 font-mono text-xs rounded p-3 h-48 overflow-auto"
                data-testid="schema-sync-log"
              >
                {events.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Snapshots ({targetEnv})
          </CardTitle>
          <CardDescription>Pre-apply schema snapshots used for rollback.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshotsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (snapshotsQ.data?.snapshots ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No snapshots yet.</div>
          ) : (
            <ScrollArea className="max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshotsQ.data!.snapshots.map((s) => (
                    <TableRow key={s.file} data-testid={`row-snapshot-${s.name}`}>
                      <TableCell className="font-mono text-xs">{s.name}</TableCell>
                      <TableCell>{(s.sizeBytes / 1024).toFixed(1)} KB</TableCell>
                      <TableCell>{new Date(s.mtime).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rollback(s.file)}
                          disabled={rolling}
                          data-testid={`button-rollback-${s.name}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Rollback
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm production apply
            </DialogTitle>
            <DialogDescription>
              You are about to alter the <strong>production</strong> database. Type{" "}
              <code className="font-mono">APPLY PRODUCTION</code> to proceed.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={prodConfirmText}
            onChange={(e) => setProdConfirmText(e.target.value)}
            placeholder="APPLY PRODUCTION"
            data-testid="input-prod-confirm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={prodConfirmText !== "APPLY PRODUCTION" || applying}
              onClick={() => apply(true)}
              data-testid="button-confirm-prod-apply"
            >
              {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Apply to production
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
