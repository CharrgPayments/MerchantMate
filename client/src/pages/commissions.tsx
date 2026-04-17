import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DollarSign, RefreshCw, Plus, Trash2, CheckCircle2, XOctagon, Calculator } from "lucide-react";
import type { Agent } from "@shared/schema";

type CommissionEvent = {
  id: number;
  transactionId: number;
  merchantId: number;
  beneficiaryAgentId: number;
  sourceAgentId: number | null;
  depth: number;
  basisAmount: string;
  ratePct: string;
  amount: string;
  status: "pending" | "payable" | "paid" | "reversed";
  payoutId: number | null;
  createdAt: string;
};

type Statement = {
  totals: { total: number; pending: number; payable: number; paid: number; reversed: number };
  events: CommissionEvent[];
  byAgent: { agentId: number; total: number; pending: number; payable: number; paid: number; reversed: number }[];
};

type AgentOverride = {
  id: number;
  parentAgentId: number;
  childAgentId: number;
  percent: string;
  notes: string | null;
};

type Payout = {
  id: number;
  agentId: number;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  netAmount: string;
  method: string;
  status: "draft" | "processing" | "paid" | "void";
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
};

const statusBadge = (s: string) => {
  switch (s) {
    case "paid": return "bg-green-100 text-green-800";
    case "payable": return "bg-blue-100 text-blue-800";
    case "pending": return "bg-yellow-100 text-yellow-800";
    case "reversed": case "void": return "bg-red-100 text-red-800";
    case "draft": return "bg-gray-100 text-gray-800";
    case "processing": return "bg-purple-100 text-purple-800";
    default: return "bg-gray-100 text-gray-800";
  }
};

const fmtCurrency = (v: number | string) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(typeof v === "number" ? v : parseFloat(v || "0"));

export default function CommissionsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("statement");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [filterAgentId, setFilterAgentId] = useState<string>("all");

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, `${a.firstName} ${a.lastName}`])), [agents]);
  const nameOf = (id: number | null | undefined) => (id ? agentMap.get(id) || `Agent #${id}` : "—");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterAgentId !== "all") p.set("agentId", filterAgentId);
    if (periodStart) p.set("periodStart", new Date(periodStart).toISOString());
    if (periodEnd) p.set("periodEnd", new Date(periodEnd).toISOString());
    return p.toString();
  }, [filterAgentId, periodStart, periodEnd]);

  const { data: statement, isLoading: stmtLoading } = useQuery<Statement>({
    queryKey: ["/api/commissions/statement", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/commissions/statement?${queryParams}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load statement");
      return r.json();
    },
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery<CommissionEvent[]>({
    queryKey: ["/api/commissions/events", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/commissions/events?${queryParams}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load events");
      return r.json();
    },
  });

  const { data: overrides = [] } = useQuery<AgentOverride[]>({
    queryKey: ["/api/commissions/overrides"],
    queryFn: async () => {
      const r = await fetch(`/api/commissions/overrides`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: payouts = [] } = useQuery<Payout[]>({
    queryKey: ["/api/payouts", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/payouts${filterAgentId !== "all" ? `?agentId=${filterAgentId}` : ""}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: settings } = useQuery<{ defaultOverridePct: number; basis: string }>({
    queryKey: ["/api/commissions/settings"],
    queryFn: async () => {
      const r = await fetch(`/api/commissions/settings`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load settings");
      return r.json();
    },
  });

  const recalcAll = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/commissions/recalculate-all", { sinceDays: 90 }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      toast({ title: "Recalculated", description: `Processed ${json.processed} transactions.` });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/events"] });
    },
    onError: (e: any) => toast({ title: "Recalc failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6" /> Commissions & Residuals</h1>
          <p className="text-gray-500 text-sm">Track earnings across the agent hierarchy and manage payouts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => recalcAll.mutate()} disabled={recalcAll.isPending} data-testid="button-recalc-all">
            <Calculator className="w-4 h-4 mr-2" />
            {recalcAll.isPending ? "Recalculating…" : "Recalculate (last 90d)"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Agent</Label>
            <Select value={filterAgentId} onValueChange={setFilterAgentId}>
              <SelectTrigger data-testid="select-agent-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scoped agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Period start</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label>Period end</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Totals header */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {([
          ["Total", statement?.totals.total],
          ["Pending", statement?.totals.pending],
          ["Payable", statement?.totals.payable],
          ["Paid", statement?.totals.paid],
          ["Reversed", statement?.totals.reversed],
        ] as [string, number | undefined][]).map(([label, val]) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-xs uppercase text-gray-500">{label}</div>
            <div className="text-2xl font-bold mt-1">
              {stmtLoading ? <Skeleton className="h-7 w-24" /> : fmtCurrency(val ?? 0)}
            </div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="overrides">Overrides</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="statement">
          <Card><CardHeader><CardTitle>By beneficiary agent</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Agent</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Reversed</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(statement?.byAgent ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-gray-500">No commission activity for the selected filters.</TableCell></TableRow>
                ) : statement!.byAgent.map((row) => (
                  <TableRow key={row.agentId} data-testid={`statement-row-${row.agentId}`}>
                    <TableCell>{nameOf(row.agentId)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtCurrency(row.total)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(row.pending)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(row.payable)}</TableCell>
                    <TableCell className="text-right text-green-700">{fmtCurrency(row.paid)}</TableCell>
                    <TableCell className="text-right text-red-700">{fmtCurrency(row.reversed)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="events">
          <EventsTable events={events} loading={eventsLoading} nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="overrides">
          <OverridesPanel overrides={overrides} agents={agents} nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="payouts">
          <PayoutsPanel payouts={payouts} agents={agents} nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsPanel settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EventsTable({ events, loading, nameOf }: {
  events: CommissionEvent[]; loading: boolean; nameOf: (id?: number | null) => string;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const ids = Array.from(selected);

  const promote = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/commissions/events/mark-payable", { eventIds: ids }),
    onSuccess: async (res: any) => {
      const j = await res.json();
      toast({ title: `Promoted ${j.updated} events to payable` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const payNow = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/commissions/events/mark-paid", { eventIds: ids }),
    onSuccess: async (res: any) => {
      const j = await res.json();
      toast({ title: `Marked ${j.updated} events paid` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card><CardContent className="p-4 space-y-3">
      {ids.length > 0 && (
        <div className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded p-2">
          <span className="font-medium">{ids.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => promote.mutate()} disabled={promote.isPending} data-testid="button-bulk-promote">
            Promote to payable
          </Button>
          <Button size="sm" variant="outline" onClick={() => payNow.mutate()} disabled={payNow.isPending} data-testid="button-bulk-pay">
            <CheckCircle2 className="w-4 h-4 mr-1" /> Mark paid
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Tx ID</TableHead>
          <TableHead>Beneficiary</TableHead>
          <TableHead>Source agent</TableHead>
          <TableHead className="text-right">Depth</TableHead>
          <TableHead className="text-right">Basis</TableHead>
          <TableHead className="text-right">Rate %</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading ? Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}><TableCell colSpan={10}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
          )) : events.length === 0 ? (
            <TableRow><TableCell colSpan={10} className="text-center py-8 text-gray-500">No commission events.</TableCell></TableRow>
          ) : events.map((e) => {
            const selectable = e.status === "pending" || e.status === "payable";
            return (
              <TableRow key={e.id} data-testid={`event-row-${e.id}`}>
                <TableCell>
                  {selectable && (
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)}
                           data-testid={`checkbox-event-${e.id}`} />
                  )}
                </TableCell>
                <TableCell className="text-xs">{new Date(e.createdAt).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">#{e.transactionId}</TableCell>
                <TableCell>{nameOf(e.beneficiaryAgentId)}</TableCell>
                <TableCell className="text-gray-500">{nameOf(e.sourceAgentId)}</TableCell>
                <TableCell className="text-right">{e.depth}</TableCell>
                <TableCell className="text-right">{fmtCurrency(e.basisAmount)}</TableCell>
                <TableCell className="text-right">{Number(e.ratePct).toFixed(3)}</TableCell>
                <TableCell className="text-right font-semibold">{fmtCurrency(e.amount)}</TableCell>
                <TableCell><Badge className={statusBadge(e.status)}>{e.status}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function OverridesPanel({ overrides, agents, nameOf }: {
  overrides: AgentOverride[]; agents: Agent[]; nameOf: (id?: number | null) => string;
}) {
  const { toast } = useToast();
  const [parentId, setParentId] = useState<string>("");
  const [childId, setChildId] = useState<string>("");
  const [percent, setPercent] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/commissions/overrides", {
      parentAgentId: Number(parentId), childAgentId: Number(childId),
      percent: Number(percent), notes: notes || null,
    }),
    onSuccess: () => {
      toast({ title: "Override saved" });
      setParentId(""); setChildId(""); setPercent(""); setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/overrides"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/commissions/overrides/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/commissions/overrides"] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Add / update an override</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <Label>Parent (upline) agent</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger data-testid="select-parent-agent"><SelectValue placeholder="Select parent" /></SelectTrigger>
              <SelectContent>{agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Child agent</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger data-testid="select-child-agent"><SelectValue placeholder="Select child" /></SelectTrigger>
              <SelectContent>{agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Percent (%)</Label>
            <Input type="number" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="0.50" />
          </div>
          <div className="md:col-span-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
          </div>
          <Button onClick={() => create.mutate()} disabled={!parentId || !childId || !percent || create.isPending} data-testid="button-save-override">
            <Plus className="w-4 h-4 mr-1" /> Save
          </Button>
        </CardContent>
      </Card>

      <Card><CardContent className="p-4">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Parent</TableHead><TableHead>Child</TableHead>
            <TableHead className="text-right">Percent</TableHead><TableHead>Notes</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {overrides.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-500">No edge overrides — defaults apply.</TableCell></TableRow>
            ) : overrides.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{nameOf(o.parentAgentId)}</TableCell>
                <TableCell>{nameOf(o.childAgentId)}</TableCell>
                <TableCell className="text-right">{Number(o.percent).toFixed(2)}%</TableCell>
                <TableCell className="text-gray-500 text-sm">{o.notes || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(o.id)} data-testid={`button-delete-override-${o.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

function PayoutsPanel({ payouts, agents, nameOf }: {
  payouts: Payout[]; agents: Agent[]; nameOf: (id?: number | null) => string;
}) {
  const { toast } = useToast();
  const [agentId, setAgentId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [method, setMethod] = useState<string>("ach");
  const [notes, setNotes] = useState<string>("");

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/payouts", {
      agentId: Number(agentId),
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
      method, notes: notes || null,
    }),
    onSuccess: () => {
      toast({ title: "Payout created" });
      setAgentId(""); setPeriodStart(""); setPeriodEnd(""); setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const markPaid = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/payouts/${id}/mark-paid`, { reference: `manual-${Date.now()}` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
    },
  });

  const voidIt = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/payouts/${id}/void`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/statement"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Create payout from payable events</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger data-testid="select-payout-agent"><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>{agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div><Label>Period start</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
          <div><Label>Period end</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ach">ACH</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="wire">Wire</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button onClick={() => create.mutate()} disabled={!agentId || !periodStart || !periodEnd || create.isPending} data-testid="button-create-payout">
            <Plus className="w-4 h-4 mr-1" /> Create
          </Button>
        </CardContent>
      </Card>

      <Card><CardContent className="p-4">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Created</TableHead><TableHead>Agent</TableHead><TableHead>Period</TableHead>
            <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Net</TableHead>
            <TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {payouts.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-6 text-gray-500">No payouts yet.</TableCell></TableRow>
            ) : payouts.map((p) => (
              <TableRow key={p.id} data-testid={`payout-row-${p.id}`}>
                <TableCell className="text-xs">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>{nameOf(p.agentId)}</TableCell>
                <TableCell className="text-xs">
                  {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">{fmtCurrency(p.grossAmount)}</TableCell>
                <TableCell className="text-right font-semibold">{fmtCurrency(p.netAmount)}</TableCell>
                <TableCell className="uppercase text-xs">{p.method}</TableCell>
                <TableCell><Badge className={statusBadge(p.status)}>{p.status}</Badge></TableCell>
                <TableCell className="text-right space-x-1">
                  {p.status === "draft" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => markPaid.mutate(p.id)} data-testid={`button-mark-paid-${p.id}`}>
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => voidIt.mutate(p.id)} data-testid={`button-void-${p.id}`}>
                        <XOctagon className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

function SettingsPanel({ settings }: { settings?: { defaultOverridePct: number; basis: string } }) {
  const { toast } = useToast();
  const [pct, setPct] = useState<string>("");
  const [basis, setBasis] = useState<string>("");

  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/commissions/settings", {
      defaultOverridePct: pct ? Number(pct) : undefined,
      basis: basis || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/settings"] });
      setPct(""); setBasis("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Engine defaults</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <Label>Default override %</Label>
          <Input type="number" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)}
                 placeholder={settings ? String(settings.defaultOverridePct) : "0.5"} />
          <div className="text-xs text-gray-500 mt-1">Current: {settings?.defaultOverridePct ?? "—"}%</div>
        </div>
        <div>
          <Label>Commission basis</Label>
          <Select value={basis || settings?.basis || ""} onValueChange={setBasis}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="processing_fee">Processing fee</SelectItem>
              <SelectItem value="amount">Transaction amount</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-gray-500 mt-1">Current: {settings?.basis ?? "—"}</div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings">
          <RefreshCw className="w-4 h-4 mr-1" /> Save
        </Button>
      </CardContent>
    </Card>
  );
}
