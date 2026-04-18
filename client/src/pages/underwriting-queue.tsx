import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, RefreshCw, Clock, AlertOctagon } from "lucide-react";
import { STATUS_LABEL, STATUS_FAMILY, type AppStatus } from "@shared/underwriting";

interface QueueRow {
  id: number;
  prospectId: number;
  status: AppStatus;
  subStatus: string | null;
  underwritingType: string;
  pathway: "traditional" | "payfac";
  slaDeadline: string | null;
  pipelineHaltedAtPhase: string | null;
  riskScore: number | null;
  riskTier: string | null;
  assignedReviewerId: string | null;
  submittedAt: string | null;
  updatedAt: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyName: string | null;
  acquirerName: string | null;
}

function tierBadge(tier: string | null) {
  if (!tier) return <Badge variant="outline">—</Badge>;
  const cls =
    tier === "low" ? "bg-green-100 text-green-800" :
    tier === "medium" ? "bg-yellow-100 text-yellow-800" :
    "bg-red-100 text-red-800";
  return <Badge className={cls}>{tier.toUpperCase()}</Badge>;
}

function statusBadge(s: AppStatus) {
  const family = STATUS_FAMILY[s];
  const cls =
    family === "approved" ? "bg-emerald-100 text-emerald-800" :
    family === "declined" ? "bg-red-100 text-red-800" :
    family === "pending"  ? "bg-amber-100 text-amber-800" :
    family === "in_review" ? "bg-blue-100 text-blue-800" :
    family === "withdrawn" ? "bg-gray-200 text-gray-700" :
    "bg-gray-100 text-gray-800";
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
  return <Badge className={cls}><Clock className="h-3 w-3 mr-1" />{hrs}h {mins}m</Badge>;
}

export default function UnderwritingQueue() {
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [pathway, setPathway] = useState("all");
  const [mode, setMode] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const pickupMut = useMutation({
    mutationFn: async (appId: number) => apiRequest("POST", `/api/applications/${appId}/underwriting/assign`, { reviewerId: "me" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/queue"] });
      toast({ title: "Picked up application" });
    },
    onError: (e: Error) => toast({ title: "Pickup failed", description: e.message, variant: "destructive" }),
  });

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (tier !== "all") params.set("tier", tier);
  if (pathway !== "all") params.set("pathway", pathway);
  if (mode !== "all") params.set("mode", mode);
  if (assignee !== "all") params.set("assignee", assignee);

  const { data: rows, isLoading, refetch, isFetching } = useQuery<QueueRow[]>({
    queryKey: ["/api/underwriting/queue", status, tier, pathway, mode, assignee],
    queryFn: async () => {
      const r = await fetch(`/api/underwriting/queue?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
  });

  // Epic F: surface unacknowledged SLA breaches in the queue.
  type SlaStatus = {
    overdueOpenCount: number;
    unacknowledgedBreaches: number;
    breaches: Array<{ id: number; applicationId: number; hoursOverdue: number; acknowledged: boolean }>;
  };
  const { data: slaStatus } = useQuery<SlaStatus>({
    queryKey: ["/api/applications/sla-status"],
    queryFn: async () => {
      const r = await fetch("/api/applications/sla-status");
      if (!r.ok) throw new Error("Failed to load SLA status");
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const breachByAppId = new Map<number, { hoursOverdue: number }>();
  for (const b of slaStatus?.breaches ?? []) {
    breachByAppId.set(b.applicationId, { hoursOverdue: b.hoursOverdue });
  }

  const filtered = (rows || []).filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.companyName || "").toLowerCase().includes(q)
      || (r.email || "").toLowerCase().includes(q)
      || `${r.firstName ?? ""} ${r.lastName ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
            Underwriting Queue
          </h1>
          <p className="text-sm text-gray-500">SUB → CUW → P1/P2/P3 → APPROVED or D1/D2/D3/D4</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <Input placeholder="Search company / name / email" value={search} onChange={e => setSearch(e.target.value)} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All open</SelectItem>
                <SelectItem value="submitted">Submitted (SUB)</SelectItem>
                <SelectItem value="in_review">In Review (CUW)</SelectItem>
                <SelectItem value="pending">Pending (P1/P2/P3)</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="declined">Declined (D1-D4)</SelectItem>
                <SelectItem value="withdrawn">Withdrawn (W1-W3)</SelectItem>
                <SelectItem value="P1">P1 — Info requested</SelectItem>
                <SelectItem value="P2">P2 — External response</SelectItem>
                <SelectItem value="P3">P3 — Senior review</SelectItem>
              </SelectContent>
            </Select>
            <Select value={pathway} onValueChange={setPathway}>
              <SelectTrigger><SelectValue placeholder="Pathway" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any pathway</SelectItem>
                <SelectItem value="traditional">Traditional</SelectItem>
                <SelectItem value="payfac">PayFac</SelectItem>
              </SelectContent>
            </Select>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue placeholder="Queue mode" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="checkpoint">Checkpoint halts</SelectItem>
                <SelectItem value="final">Final review (PayFac SLA)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger><SelectValue placeholder="Risk Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="me">Assigned to me</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App #</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Applicant</TableHead>
                <TableHead>Acquirer</TableHead>
                <TableHead>Pathway</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>SLA / Halt</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-gray-500">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-gray-500">No applications match your filters</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">#{r.id}</TableCell>
                  <TableCell className="font-medium">{r.companyName || "—"}</TableCell>
                  <TableCell>
                    <div>{r.firstName} {r.lastName}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </TableCell>
                  <TableCell>{r.acquirerName || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.pathway}</Badge></TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell>{tierBadge(r.riskTier)}</TableCell>
                  <TableCell>{r.riskScore ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {r.pipelineHaltedAtPhase ? (
                        <Badge className="bg-red-100 text-red-800"><AlertOctagon className="h-3 w-3 mr-1" />{r.pipelineHaltedAtPhase}</Badge>
                      ) : r.slaDeadline ? (
                        <SlaCountdown deadline={r.slaDeadline} />
                      ) : <span>—</span>}
                      {breachByAppId.has(r.id) && (
                        <Badge className="bg-red-600 text-white" data-testid={`sla-breach-${r.id}`}>
                          <AlertOctagon className="h-3 w-3 mr-1" />
                          SLA breach +{breachByAppId.get(r.id)!.hoursOverdue}h
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.assignedReviewerId ? (
                      <Badge className="bg-blue-100 text-blue-800"><UserCheck className="h-3 w-3 mr-1" />{r.assignedReviewerId.slice(0, 8)}…</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => pickupMut.mutate(r.id)} disabled={pickupMut.isPending}>
                        <UserCheck className="h-3 w-3 mr-1" />Pick up
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{new Date(r.updatedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Link href={`/underwriting-review/${r.id}`}>
                      <Button size="sm" variant="outline">Review</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
