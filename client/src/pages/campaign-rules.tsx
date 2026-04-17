import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { CampaignAssignmentRule, Campaign, Agent } from "@shared/schema";

interface RuleForm {
  id?: number;
  mcc: string;
  acquirerId: string;
  agentId: string;
  campaignId: string;
  priority: string;
  isActive: boolean;
  notes: string;
}

const emptyForm: RuleForm = {
  mcc: "",
  acquirerId: "",
  agentId: "",
  campaignId: "",
  priority: "100",
  isActive: true,
  notes: "",
};

export default function CampaignRulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);

  const { data: rules = [], isLoading } = useQuery<CampaignAssignmentRule[]>({
    queryKey: ["/api/campaign-rules"],
  });
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });
  const { data: acquirers = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/acquirers"],
  });

  const upsertMutation = useMutation({
    mutationFn: async (f: RuleForm) => {
      const body = {
        mcc: f.mcc.trim() || null,
        acquirerId: f.acquirerId ? parseInt(f.acquirerId) : null,
        agentId: f.agentId ? parseInt(f.agentId) : null,
        campaignId: parseInt(f.campaignId),
        priority: parseInt(f.priority || "100"),
        isActive: f.isActive,
        notes: f.notes.trim() || null,
      };
      const res = await apiRequest(
        f.id ? "PATCH" : "POST",
        f.id ? `/api/campaign-rules/${f.id}` : "/api/campaign-rules",
        body,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Rule saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-rules"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Save failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/campaign-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Rule deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-rules"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Delete failed", variant: "destructive" }),
  });

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (r: CampaignAssignmentRule) => {
    setForm({
      id: r.id,
      mcc: r.mcc ?? "",
      acquirerId: r.acquirerId ? String(r.acquirerId) : "",
      agentId: r.agentId ? String(r.agentId) : "",
      campaignId: String(r.campaignId),
      priority: String(r.priority ?? 100),
      isActive: r.isActive ?? true,
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const campaignName = (id: number) => campaigns.find((c) => c.id === id)?.name ?? `#${id}`;
  const agentName = (id: number | null) => {
    if (!id) return "Any";
    const a = agents.find((x) => x.id === id);
    return a ? `${a.firstName} ${a.lastName}` : `#${id}`;
  };
  const acquirerName = (id: number | null) => {
    if (!id) return "Any";
    return acquirers.find((x) => x.id === id)?.name ?? `#${id}`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campaign Assignment Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            When no campaign is explicitly chosen and the agent has no default, the most-specific matching rule wins (ties broken by lowest priority number).
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-rule">
          <Plus className="w-4 h-4 mr-2" /> New Rule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rules ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : rules.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No rules yet. Click "New Rule" to create one.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-3">Priority</th>
                    <th className="py-2 px-3">MCC</th>
                    <th className="py-2 px-3">Acquirer</th>
                    <th className="py-2 px-3">Agent</th>
                    <th className="py-2 px-3">Campaign</th>
                    <th className="py-2 px-3">Active</th>
                    <th className="py-2 px-3">Notes</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30" data-testid={`rule-row-${r.id}`}>
                      <td className="py-2 px-3">{r.priority}</td>
                      <td className="py-2 px-3">{r.mcc ?? <span className="text-muted-foreground italic">Any</span>}</td>
                      <td className="py-2 px-3">{acquirerName(r.acquirerId)}</td>
                      <td className="py-2 px-3">{agentName(r.agentId)}</td>
                      <td className="py-2 px-3 font-medium">{campaignName(r.campaignId)}</td>
                      <td className="py-2 px-3">
                        <Badge variant={r.isActive ? "default" : "secondary"}>
                          {r.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs max-w-xs truncate">{r.notes ?? "—"}</td>
                      <td className="py-2 px-3 text-right space-x-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} data-testid={`button-edit-rule-${r.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm("Delete this rule?")) deleteMutation.mutate(r.id);
                          }}
                          data-testid={`button-delete-rule-${r.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Rule" : "New Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>MCC (optional)</Label>
                <Input
                  value={form.mcc}
                  onChange={(e) => setForm({ ...form, mcc: e.target.value })}
                  placeholder="e.g. 5812"
                  data-testid="input-rule-mcc"
                />
              </div>
              <div>
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  data-testid="input-rule-priority"
                />
              </div>
            </div>

            <div>
              <Label>Acquirer (optional)</Label>
              <Select value={form.acquirerId || "__any__"} onValueChange={(v) => setForm({ ...form, acquirerId: v === "__any__" ? "" : v })}>
                <SelectTrigger data-testid="select-rule-acquirer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any acquirer</SelectItem>
                  {acquirers.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Agent (optional)</Label>
              <Select value={form.agentId || "__any__"} onValueChange={(v) => setForm({ ...form, agentId: v === "__any__" ? "" : v })}>
                <SelectTrigger data-testid="select-rule-agent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any agent</SelectItem>
                  {agents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.firstName} {a.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Campaign *</Label>
              <Select value={form.campaignId} onValueChange={(v) => setForm({ ...form, campaignId: v })}>
                <SelectTrigger data-testid="select-rule-campaign"><SelectValue placeholder="Choose a campaign" /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                data-testid="input-rule-notes"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                data-testid="checkbox-rule-active"
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => upsertMutation.mutate(form)}
              disabled={!form.campaignId || upsertMutation.isPending}
              data-testid="button-save-rule"
            >
              {upsertMutation.isPending ? "Saving..." : "Save Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
