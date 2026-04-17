import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, RefreshCw } from "lucide-react";

interface QueueRow {
  id: number;
  prospectId: number;
  status: string;
  subStatus: string | null;
  underwritingType: string;
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

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  in_review: "In Review",
  pending_info: "Pending Info",
  approved: "Approved",
  declined: "Declined",
};

function tierBadge(tier: string | null) {
  if (!tier) return <Badge variant="outline">—</Badge>;
  const cls =
    tier === "low" ? "bg-green-100 text-green-800" :
    tier === "medium" ? "bg-yellow-100 text-yellow-800" :
    "bg-red-100 text-red-800";
  return <Badge className={cls}>{tier.toUpperCase()}</Badge>;
}

function statusBadge(s: string) {
  const cls =
    s === "approved" ? "bg-emerald-100 text-emerald-800" :
    s === "declined" ? "bg-red-100 text-red-800" :
    s === "pending_info" ? "bg-amber-100 text-amber-800" :
    s === "in_review" ? "bg-blue-100 text-blue-800" :
    "bg-gray-100 text-gray-800";
  return <Badge className={cls}>{STATUS_LABEL[s] || s}</Badge>;
}

export default function UnderwritingQueue() {
  const [status, setStatus] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [assignee, setAssignee] = useState<string>("all");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (tier !== "all") params.set("tier", tier);
  if (assignee !== "all") params.set("assignee", assignee);

  const { data: rows, isLoading, refetch, isFetching } = useQuery<QueueRow[]>({
    queryKey: ["/api/underwriting/queue", status, tier, assignee],
    queryFn: async () => {
      const r = await fetch(`/api/underwriting/queue?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
  });

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
          <p className="text-sm text-gray-500">Applications awaiting review and decision</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input placeholder="Search company, name, email" value={search} onChange={e => setSearch(e.target.value)} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All open</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="pending_info">Pending Info</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
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
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">No applications match your filters</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">#{r.id}</TableCell>
                  <TableCell className="font-medium">{r.companyName || "—"}</TableCell>
                  <TableCell>
                    <div>{r.firstName} {r.lastName}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </TableCell>
                  <TableCell>{r.acquirerName || "—"}</TableCell>
                  <TableCell>
                    {statusBadge(r.status)}
                    {r.subStatus && <div className="text-xs text-gray-500 mt-1">{r.subStatus.replace(/_/g, " ")}</div>}
                  </TableCell>
                  <TableCell>{tierBadge(r.riskTier)}</TableCell>
                  <TableCell>{r.riskScore ?? "—"}</TableCell>
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
