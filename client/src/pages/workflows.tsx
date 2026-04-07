import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Zap, ChevronRight, Loader2, CheckCircle2, Circle, Clock, AlertCircle,
  Bot, User, Globe, Settings2, FileText, Hash, Calendar, ArrowRight,
  XCircle, AlertTriangle, PlayCircle, PauseCircle, RefreshCw
} from "lucide-react";
import { format } from "date-fns";

// ─── Status / type helpers ────────────────────────────────────────────────────

const STAGE_TYPE_ICON: Record<string, JSX.Element> = {
  automated: <Bot className="h-3.5 w-3.5 text-blue-500" />,
  manual:    <User className="h-3.5 w-3.5 text-orange-500" />,
};

const TICKET_STATUS_CONFIG: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  submitted:       { label: "Submitted",       color: "bg-blue-100 text-blue-700",   icon: <Circle className="h-3 w-3" /> },
  pending_review:  { label: "Pending Review",  color: "bg-yellow-100 text-yellow-700", icon: <Clock className="h-3 w-3" /> },
  in_review:       { label: "In Review",       color: "bg-purple-100 text-purple-700", icon: <PlayCircle className="h-3 w-3" /> },
  approved:        { label: "Approved",        color: "bg-green-100 text-green-700",  icon: <CheckCircle2 className="h-3 w-3" /> },
  declined:        { label: "Declined",        color: "bg-red-100 text-red-700",      icon: <XCircle className="h-3 w-3" /> },
  on_hold:         { label: "On Hold",         color: "bg-gray-100 text-gray-600",    icon: <PauseCircle className="h-3 w-3" /> },
  cancelled:       { label: "Cancelled",       color: "bg-gray-100 text-gray-500",    icon: <XCircle className="h-3 w-3" /> },
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineView({ stages }: { stages: any[] }) {
  if (!stages.length) return (
    <div className="py-12 text-center text-gray-400">
      <Zap className="h-10 w-10 mx-auto mb-2 text-gray-200" />
      <p className="text-sm">No stages defined</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {stages.map((stage: any, idx: number) => (
        <div key={stage.id} className="flex items-start gap-3">
          {/* Step number + connector */}
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-xs font-bold text-blue-600">
              {idx + 1}
            </div>
            {idx < stages.length - 1 && <div className="w-0.5 h-4 bg-gray-200 my-0.5" />}
          </div>

          {/* Stage card */}
          <Card className="flex-1 mb-0">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {STAGE_TYPE_ICON[stage.stage_type] ?? <Circle className="h-3.5 w-3.5 text-gray-400" />}
                  <span className="font-medium text-sm text-gray-900">{stage.name}</span>
                  {stage.is_required && (
                    <Badge variant="outline" className="text-xs py-0 h-4">Required</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {stage.stage_type === "automated" ? (
                    <span className="flex items-center gap-1"><Bot className="h-3 w-3" /> Automated</span>
                  ) : (
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> Manual Review</span>
                  )}
                  {stage.timeout_minutes && (
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {stage.timeout_minutes}m</span>
                  )}
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
  );
}

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
        <Card
          key={t.id}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onSelect(t)}
        >
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

function TicketDetailPanel({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/workflow-tickets", ticket.id],
    queryFn: () => fetch(`/api/admin/workflow-tickets/${ticket.id}`).then(r => r.json()),
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
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800">{stageProgress.length}</div>
              <div className="text-xs text-gray-500">Stages Run</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-red-600">{issues.filter((i:any) => i.status !== "resolved").length}</div>
              <div className="text-xs text-gray-500">Open Issues</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className={`text-lg font-bold ${ticket.risk_score > 70 ? "text-red-600" : ticket.risk_score > 40 ? "text-yellow-600" : "text-green-600"}`}>
                {ticket.risk_score ?? "—"}
              </div>
              <div className="text-xs text-gray-500">Risk Score</div>
            </div>
          </div>

          {/* Stage progress */}
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

          {/* Issues */}
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

          {/* Notes */}
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Workflows() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<any>(null);
  const [selectedTicket, setSelectedTicket]     = useState<any>(null);
  const [activeTab, setActiveTab]               = useState("stages");

  const { data: workflows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows-list"],
    queryFn: () => fetch("/api/admin/workflows", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
  });

  const { data: stages = [], isLoading: stagesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflows", selectedWorkflow?.id, "stages"],
    queryFn: () => fetch(`/api/admin/workflows/${selectedWorkflow.id}/stages`).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
  });

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/workflow-tickets", selectedWorkflow?.id],
    queryFn: () => fetch(`/api/admin/workflow-tickets?workflowId=${selectedWorkflow.id}`).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
  });

  const { data: wfDetail } = useQuery<any>({
    queryKey: ["/api/admin/workflows", selectedWorkflow?.id],
    queryFn: () => fetch(`/api/admin/workflows/${selectedWorkflow.id}`).then(r => r.json()),
    enabled: !!selectedWorkflow?.id,
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
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/workflows-list"] })}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Automation workflow definitions</p>
        </div>

        <ScrollArea className="flex-1">
          {(workflows as any[]).length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              <Zap className="h-10 w-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No workflows configured</p>
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
          /* Ticket detail view */
          <div className="flex-1 overflow-hidden">
            <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
          </div>
        ) : (
          /* Workflow detail view */
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
                  </div>
                </div>
                <div className="flex items-center gap-4 text-center shrink-0">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{stages.length}</div>
                    <div className="text-xs text-gray-400">Stages</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-700">{tickets.length}</div>
                    <div className="text-xs text-gray-400">Tickets</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-600">
                      {(tickets as any[]).filter((t:any) => t.status === "pending_review").length}
                    </div>
                    <div className="text-xs text-gray-400">Pending</div>
                  </div>
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
                      {stagesLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                      ) : (
                        <PipelineView stages={stages} />
                      )}
                    </TabsContent>

                    <TabsContent value="tickets" className="mt-0">
                      {ticketsLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                      ) : (
                        <TicketsView tickets={tickets} onSelect={setSelectedTicket} />
                      )}
                    </TabsContent>

                    <TabsContent value="endpoints" className="mt-0">
                      {!wfDetail?.endpoints?.length ? (
                        <Card>
                          <CardContent className="py-8 text-center text-gray-400">
                            <Globe className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                            <p className="text-sm">No API endpoints configured</p>
                          </CardContent>
                        </Card>
                      ) : (
                        <div className="space-y-3">
                          {wfDetail.endpoints.map((ep: any) => (
                            <Card key={ep.id}>
                              <CardContent className="py-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <Badge variant="outline" className="font-mono text-xs">{ep.method}</Badge>
                                    <div>
                                      <p className="font-medium text-sm">{ep.name}</p>
                                      <p className="text-xs text-gray-500 font-mono truncate max-w-xs">{ep.url}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={ep.is_active ? "default" : "secondary"}>
                                      {ep.is_active ? "Active" : "Inactive"}
                                    </Badge>
                                    <span className="text-xs text-gray-400">{ep.auth_type}</span>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="environments" className="mt-0">
                      <div className="space-y-4">
                        {["production", "development", "test"].map((env) => {
                          const config = wfDetail?.environmentConfigs?.find((c: any) => c.environment === env);
                          return (
                            <Card key={env}>
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-sm capitalize flex items-center gap-2">
                                    <Settings2 className="h-4 w-4" /> {env} environment
                                  </CardTitle>
                                  <Badge variant={config?.is_active ? "default" : "secondary"}>
                                    {config ? (config.is_active ? "Configured" : "Inactive") : "Not configured"}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent>
                                {config?.config ? (
                                  <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32">
                                    {JSON.stringify(config.config, null, 2)}
                                  </pre>
                                ) : (
                                  <p className="text-sm text-gray-400">No configuration overrides set</p>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </TabsContent>

                  </div>
                </ScrollArea>
              </Tabs>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
