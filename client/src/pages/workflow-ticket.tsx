import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Play, CheckCircle2, XCircle, AlertTriangle, Clock,
  ArrowRight, MessageSquare, FileText, User, Calendar, History,
  ChevronRight, Pause, Flag, Check, X, Plus
} from "lucide-react";

interface WorkflowTicketDetails {
  ticket: {
    id: number;
    ticketNumber: string;
    workflowDefinitionId: number;
    entityType: string;
    entityId: number;
    status: string;
    priority: string;
    currentStageId: number | null;
    assignedToId: string | null;
    submittedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    metadata: Record<string, any>;
    reviewCount: number;
    lastReviewedAt: Date | null;
    lastReviewedBy: string | null;
  };
  definition: {
    id: number;
    workflowCode: string;
    name: string;
    description: string;
    entityType: string;
  } | null;
  stages: Array<{
    id: number;
    workflowDefinitionId: number;
    stageCode: string;
    name: string;
    description: string;
    orderIndex: number;
    stageType: string;
    handlerKey: string | null;
    autoAdvance: boolean;
  }>;
  ticketStages: Array<{
    id: number;
    ticketId: number;
    stageId: number;
    status: string;
    result: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    executionCount: number;
    handlerResponse: Record<string, any>;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    reviewDecision: string | null;
    reviewNotes: string | null;
  }>;
  issues: Array<{
    id: number;
    ticketId: number;
    ticketStageId: number | null;
    issueCode: string;
    issueType: string;
    severity: string;
    title: string;
    description: string | null;
    status: string;
    resolution: string | null;
    overriddenBy: string | null;
    overriddenAt: Date | null;
    overrideReason: string | null;
  }>;
  tasks: Array<{
    id: number;
    ticketId: number;
    title: string;
    description: string | null;
    taskType: string;
    status: string;
    priority: string;
    assignedToId: string | null;
    assignedToRole: string | null;
    completedAt: Date | null;
  }>;
  transitions: Array<{
    id: number;
    ticketId: number;
    transitionType: string;
    fromValue: string | null;
    toValue: string | null;
    fromStageId: number | null;
    toStageId: number | null;
    reason: string | null;
    notes: string | null;
    triggeredBy: string | null;
    triggeredBySystem: boolean;
    createdAt: Date;
  }>;
  notes: Array<{
    id: number;
    ticketId: number;
    content: string;
    noteType: string;
    isInternal: boolean;
    createdBy: string;
    createdAt: Date;
  }>;
  currentStage: {
    id: number;
    name: string;
    stageCode: string;
  } | null;
}

export default function WorkflowTicketPage() {
  const [, params] = useRoute<{ id: string }>("/workflows/:id");
  const ticketId = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  
  const [showCheckpointDialog, setShowCheckpointDialog] = useState(false);
  const [checkpointNotes, setCheckpointNotes] = useState('');
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [newNote, setNewNote] = useState('');

  const { data, isLoading, refetch } = useQuery<{ success: boolean } & WorkflowTicketDetails>({
    queryKey: ['/api/workflow/tickets', ticketId],
    queryFn: async () => {
      const response = await fetch(`/api/workflow/tickets/${ticketId}`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch ticket details');
      }
      return response.json();
    },
    enabled: !!ticketId,
  });

  const startProcessingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/start`);
    },
    onSuccess: () => {
      toast({ title: "Processing Started", description: "Workflow processing has begun" });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const executeCurrentStageMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/execute`);
    },
    onSuccess: () => {
      toast({ title: "Stage Executed", description: "Current stage has been executed" });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resolveCheckpointMutation = useMutation({
    mutationFn: async (decision: 'approve' | 'reject') => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/resolve-checkpoint`, { decision, notes: checkpointNotes });
    },
    onSuccess: (_, decision) => {
      toast({ title: `Checkpoint ${decision === 'approve' ? 'Approved' : 'Rejected'}` });
      setShowCheckpointDialog(false);
      setCheckpointNotes('');
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/notes`, { content: newNote, noteType: 'general', isInternal: true });
    },
    onSuccess: () => {
      toast({ title: "Note Added" });
      setShowAddNoteDialog(false);
      setNewNote('');
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateIssueMutation = useMutation({
    mutationFn: async ({ issueId, status, overrideReason }: { issueId: number; status: string; overrideReason?: string }) => {
      return apiRequest('PATCH', `/api/workflow/issues/${issueId}`, { status, overrideReason });
    },
    onSuccess: () => {
      toast({ title: "Issue Updated" });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: string }) => {
      return apiRequest('PATCH', `/api/workflow/tasks/${taskId}`, { status });
    },
    onSuccess: () => {
      toast({ title: "Task Updated" });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { className: string; icon: any }> = {
      submitted: { className: 'bg-blue-100 text-blue-800', icon: Clock },
      in_progress: { className: 'bg-yellow-100 text-yellow-800', icon: Play },
      pending_review: { className: 'bg-orange-100 text-orange-800', icon: AlertTriangle },
      approved: { className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
      rejected: { className: 'bg-red-100 text-red-800', icon: XCircle },
      on_hold: { className: 'bg-gray-100 text-gray-800', icon: Pause },
      pending: { className: 'bg-gray-100 text-gray-600', icon: Clock },
      completed: { className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
      failed: { className: 'bg-red-100 text-red-800', icon: XCircle },
      blocked: { className: 'bg-orange-100 text-orange-800', icon: AlertTriangle },
      open: { className: 'bg-red-100 text-red-800', icon: AlertTriangle },
      resolved: { className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
      dismissed: { className: 'bg-gray-100 text-gray-600', icon: X },
      overridden: { className: 'bg-purple-100 text-purple-800', icon: Check },
    };
    const config = variants[status] || variants.pending;
    const Icon = config.icon;
    return (
      <Badge className={config.className}>
        <Icon className="w-3 h-3 mr-1" />
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-600',
      medium: 'bg-yellow-100 text-yellow-600',
      high: 'bg-orange-100 text-orange-600',
      critical: 'bg-red-100 text-red-800',
      blocker: 'bg-red-200 text-red-900',
    };
    return <Badge className={variants[severity] || variants.medium}>{severity.toUpperCase()}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data?.ticket) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold">Ticket Not Found</h2>
          <p className="text-muted-foreground">The requested workflow ticket does not exist.</p>
          <Link href="/workflows">
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Workflows
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { ticket, definition, stages, ticketStages, issues, tasks, transitions, notes, currentStage } = data;
  const openIssues = issues.filter(i => i.status === 'open');

  return (
    <div className="p-6 space-y-6" data-testid="workflow-ticket-page">
      <div className="flex items-center gap-4">
        <Link href="/workflows">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" data-testid="ticket-number">{ticket.ticketNumber}</h1>
            {getStatusBadge(ticket.status)}
            <Badge variant="outline">{ticket.priority.toUpperCase()}</Badge>
          </div>
          <p className="text-muted-foreground">
            {definition?.name} • {ticket.entityType.replace('_', ' ')} #{ticket.entityId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ticket.status === 'submitted' && (
            <Button onClick={() => startProcessingMutation.mutate()} disabled={startProcessingMutation.isPending} data-testid="button-start-processing">
              <Play className="w-4 h-4 mr-2" />
              Start Processing
            </Button>
          )}
          {ticket.status === 'in_progress' && currentStage && (
            <Button onClick={() => executeCurrentStageMutation.mutate()} disabled={executeCurrentStageMutation.isPending} data-testid="button-execute-stage">
              <ArrowRight className="w-4 h-4 mr-2" />
              Execute: {currentStage.name}
            </Button>
          )}
          {ticket.status === 'pending_review' && (
            <Button onClick={() => setShowCheckpointDialog(true)} data-testid="button-resolve-checkpoint">
              <Flag className="w-4 h-4 mr-2" />
              Resolve Checkpoint
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowAddNoteDialog(true)} data-testid="button-add-note">
            <Plus className="w-4 h-4 mr-2" />
            Add Note
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stage Progress</CardTitle>
              <CardDescription>
                {currentStage ? `Currently at: ${currentStage.name}` : 'Workflow completed'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
                <div className="space-y-4">
                  {stages.map((stage, index) => {
                    const ticketStage = ticketStages.find(ts => ts.stageId === stage.id);
                    const isCurrentStage = currentStage?.id === stage.id;
                    const isCompleted = ticketStage?.status === 'completed';
                    const isFailed = ticketStage?.status === 'failed';
                    const isBlocked = ticketStage?.status === 'blocked';

                    return (
                      <div key={stage.id} className="relative pl-10" data-testid={`stage-${stage.id}`}>
                        <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${
                          isCompleted ? 'bg-green-500' :
                          isFailed ? 'bg-red-500' :
                          isBlocked ? 'bg-orange-500' :
                          isCurrentStage ? 'bg-blue-500' : 'bg-gray-300'
                        }`}>
                          {isCompleted && <Check className="w-3 h-3 text-white" />}
                          {isFailed && <X className="w-3 h-3 text-white" />}
                          {isBlocked && <AlertTriangle className="w-3 h-3 text-white" />}
                          {isCurrentStage && !isCompleted && !isFailed && !isBlocked && (
                            <div className="w-2 h-2 bg-white rounded-full" />
                          )}
                        </div>
                        <div className={`p-3 rounded-lg border ${isCurrentStage ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium">{stage.name}</h4>
                              <p className="text-sm text-muted-foreground">{stage.description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {stage.stageType === 'automated' ? 'Auto' : 'Manual'}
                              </Badge>
                              {ticketStage && getStatusBadge(ticketStage.status)}
                            </div>
                          </div>
                          {ticketStage?.result && (
                            <div className="mt-2 text-sm">
                              <span className="text-muted-foreground">Result: </span>
                              <span className={`font-medium ${
                                ticketStage.result === 'pass' ? 'text-green-600' :
                                ticketStage.result === 'fail' ? 'text-red-600' :
                                ticketStage.result === 'warning' ? 'text-orange-600' : 'text-gray-600'
                              }`}>
                                {ticketStage.result.toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="issues">
            <TabsList>
              <TabsTrigger value="issues" data-testid="tab-issues">
                Issues ({issues.length})
              </TabsTrigger>
              <TabsTrigger value="tasks" data-testid="tab-tasks">
                Tasks ({tasks.length})
              </TabsTrigger>
              <TabsTrigger value="notes" data-testid="tab-notes">
                Notes ({notes.length})
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="issues" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {issues.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-300" />
                      No issues detected
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {issues.map(issue => (
                        <div key={issue.id} className="p-4 border rounded-lg" data-testid={`issue-${issue.id}`}>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{issue.title}</span>
                                {getSeverityBadge(issue.severity)}
                                {getStatusBadge(issue.status)}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Code: {issue.issueCode} • Type: {issue.issueType}
                              </p>
                            </div>
                            {issue.status === 'open' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => updateIssueMutation.mutate({ issueId: issue.id, status: 'resolved' })}
                                  data-testid={`button-resolve-issue-${issue.id}`}
                                >
                                  <Check className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => updateIssueMutation.mutate({ 
                                    issueId: issue.id, 
                                    status: 'overridden', 
                                    overrideReason: 'Manually overridden' 
                                  })}
                                  data-testid={`button-override-issue-${issue.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {tasks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      No tasks assigned
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tasks.map(task => (
                        <div key={task.id} className="p-4 border rounded-lg" data-testid={`task-${task.id}`}>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{task.title}</span>
                                {getStatusBadge(task.status)}
                                <Badge variant="outline">{task.priority}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                              {task.assignedToRole && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Assigned to: {task.assignedToRole}
                                </p>
                              )}
                            </div>
                            {task.status !== 'completed' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: 'completed' })}
                                data-testid={`button-complete-task-${task.id}`}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Complete
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {notes.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      No notes yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {notes.map(note => (
                        <div key={note.id} className="p-4 border rounded-lg" data-testid={`note-${note.id}`}>
                          <div className="flex items-start justify-between">
                            <p className="text-sm">{note.content}</p>
                            {note.isInternal && (
                              <Badge variant="outline" className="text-xs">Internal</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                            <User className="w-3 h-3" />
                            <span>{note.createdBy}</span>
                            <span>•</span>
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(note.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {transitions.map(transition => (
                        <div key={transition.id} className="flex items-start gap-3 p-3 border-b last:border-0">
                          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <History className="w-4 h-4 text-gray-500" />
                          </div>
                          <div>
                            <p className="text-sm">
                              <span className="font-medium capitalize">{transition.transitionType.replace('_', ' ')}</span>
                              {transition.fromValue && transition.toValue && (
                                <span className="text-muted-foreground">
                                  : {transition.fromValue} → {transition.toValue}
                                </span>
                              )}
                            </p>
                            {transition.notes && (
                              <p className="text-sm text-muted-foreground">{transition.notes}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(transition.createdAt).toLocaleString()}
                              {transition.triggeredBySystem && ' • System'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ticket Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Status</Label>
                <div className="mt-1">{getStatusBadge(ticket.status)}</div>
              </div>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <div className="mt-1">
                  <Badge variant="outline">{ticket.priority.toUpperCase()}</Badge>
                </div>
              </div>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground">Entity</Label>
                <p className="text-sm capitalize">{ticket.entityType.replace('_', ' ')} #{ticket.entityId}</p>
              </div>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground">Submitted</Label>
                <p className="text-sm">
                  {ticket.submittedAt ? new Date(ticket.submittedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              {ticket.startedAt && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-xs text-muted-foreground">Started</Label>
                    <p className="text-sm">{new Date(ticket.startedAt).toLocaleString()}</p>
                  </div>
                </>
              )}
              {ticket.completedAt && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-xs text-muted-foreground">Completed</Label>
                    <p className="text-sm">{new Date(ticket.completedAt).toLocaleString()}</p>
                  </div>
                </>
              )}
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground">Review Count</Label>
                <p className="text-sm">{ticket.reviewCount || 0}</p>
              </div>
            </CardContent>
          </Card>

          {openIssues.length > 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-orange-700">
                  <AlertTriangle className="w-5 h-5" />
                  Open Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-orange-600">
                  {openIssues.length} issue(s) require attention before proceeding.
                </p>
                <ul className="mt-2 space-y-1">
                  {openIssues.slice(0, 3).map(issue => (
                    <li key={issue.id} className="text-sm flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        issue.severity === 'critical' || issue.severity === 'blocker' ? 'bg-red-500' :
                        issue.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                      }`} />
                      {issue.title}
                    </li>
                  ))}
                  {openIssues.length > 3 && (
                    <li className="text-sm text-muted-foreground">
                      ...and {openIssues.length - 3} more
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={showCheckpointDialog} onOpenChange={setShowCheckpointDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Checkpoint</DialogTitle>
            <DialogDescription>
              Review open issues and make a decision on how to proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {openIssues.length > 0 && (
              <div className="p-3 bg-orange-50 rounded border border-orange-200">
                <p className="text-sm font-medium text-orange-700">
                  {openIssues.length} open issue(s) will be affected:
                </p>
                <ul className="mt-1 text-sm text-orange-600">
                  {openIssues.map(issue => (
                    <li key={issue.id}>• {issue.title}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Label htmlFor="checkpoint-notes">Notes (Optional)</Label>
              <Textarea
                id="checkpoint-notes"
                value={checkpointNotes}
                onChange={(e) => setCheckpointNotes(e.target.value)}
                placeholder="Add any notes about this decision..."
                data-testid="input-checkpoint-notes"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => resolveCheckpointMutation.mutate('reject')}
              disabled={resolveCheckpointMutation.isPending}
              data-testid="button-reject-checkpoint"
            >
              <XCircle className="w-4 h-4 mr-2" />
              Reject
            </Button>
            <Button
              onClick={() => resolveCheckpointMutation.mutate('approve')}
              disabled={resolveCheckpointMutation.isPending}
              data-testid="button-approve-checkpoint"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Approve & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddNoteDialog} onOpenChange={setShowAddNoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="new-note">Note Content</Label>
            <Textarea
              id="new-note"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Enter your note..."
              rows={4}
              data-testid="input-new-note"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddNoteDialog(false)}>Cancel</Button>
            <Button
              onClick={() => addNoteMutation.mutate()}
              disabled={!newNote.trim() || addNoteMutation.isPending}
              data-testid="button-save-note"
            >
              Add Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
