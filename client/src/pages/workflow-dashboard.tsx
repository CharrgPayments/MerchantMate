import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { 
  GitBranch, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Play, Pause, User, Calendar, Search, Filter, RefreshCw,
  ArrowRight, Eye, MessageSquare, FileText, ChevronRight
} from "lucide-react";

type WorkflowStatus = 'submitted' | 'in_progress' | 'pending_review' | 'approved' | 'rejected' | 'on_hold';
type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface WorkflowStats {
  total: number;
  byStatus: Record<WorkflowStatus, number>;
  byPriority: Record<Priority, number>;
  myAssigned: number;
  awaitingReview: number;
}

interface WorkflowTicket {
  id: number;
  ticketNumber: string;
  workflowDefinitionId: number;
  entityType: string;
  entityId: number;
  status: WorkflowStatus;
  priority: Priority;
  currentStageId: number | null;
  assignedToId: string | null;
  submittedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, any>;
  createdAt: Date;
}

export default function WorkflowDashboard() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<WorkflowTicket | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<{ success: boolean; stats: WorkflowStats }>({
    queryKey: ['/api/workflow/stats'],
  });

  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } = useQuery<{ success: boolean; tickets: WorkflowTicket[] }>({
    queryKey: ['/api/workflow/tickets', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const response = await fetch(`/api/workflow/tickets${params}`, { credentials: 'include' });
      return response.json();
    },
  });

  const { data: definitions } = useQuery<{ success: boolean; definitions: any[] }>({
    queryKey: ['/api/workflow/definitions'],
  });

  const startProcessingMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/start`);
    },
    onSuccess: () => {
      toast({ title: "Processing Started", description: "Workflow processing has begun" });
      refetchTickets();
      queryClient.invalidateQueries({ queryKey: ['/api/workflow/stats'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const executeCurrentStageMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      return apiRequest('POST', `/api/workflow/tickets/${ticketId}/execute`);
    },
    onSuccess: () => {
      toast({ title: "Stage Executed", description: "Current stage has been executed" });
      refetchTickets();
      queryClient.invalidateQueries({ queryKey: ['/api/workflow/stats'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: WorkflowStatus) => {
    const variants: Record<WorkflowStatus, { className: string; icon: any }> = {
      submitted: { className: 'bg-blue-100 text-blue-800', icon: Clock },
      in_progress: { className: 'bg-yellow-100 text-yellow-800', icon: Play },
      pending_review: { className: 'bg-orange-100 text-orange-800', icon: AlertTriangle },
      approved: { className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
      rejected: { className: 'bg-red-100 text-red-800', icon: XCircle },
      on_hold: { className: 'bg-gray-100 text-gray-800', icon: Pause },
    };
    const config = variants[status] || variants.submitted;
    const Icon = config.icon;
    return (
      <Badge className={config.className} data-testid={`status-badge-${status}`}>
        <Icon className="w-3 h-3 mr-1" />
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: Priority) => {
    const variants: Record<Priority, string> = {
      low: 'bg-gray-100 text-gray-600',
      normal: 'bg-blue-100 text-blue-600',
      high: 'bg-orange-100 text-orange-600',
      urgent: 'bg-red-100 text-red-600',
    };
    return (
      <Badge className={variants[priority]} data-testid={`priority-badge-${priority}`}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const filteredTickets = ticketsData?.tickets?.filter(ticket => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return ticket.ticketNumber.toLowerCase().includes(query) ||
             ticket.entityType.toLowerCase().includes(query);
    }
    return true;
  }) || [];

  if (statsLoading || ticketsLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const workflowStats = stats?.stats;

  return (
    <div className="p-6 space-y-6" data-testid="workflow-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="w-7 h-7" />
            Workflow Management
          </h1>
          <p className="text-muted-foreground">Monitor and manage workflow tickets across all processes</p>
        </div>
        <Button onClick={() => refetchTickets()} variant="outline" data-testid="button-refresh">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card data-testid="stat-total">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Tickets</p>
                <p className="text-3xl font-bold">{workflowStats?.total || 0}</p>
              </div>
              <GitBranch className="w-10 h-10 text-gray-300" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-pending-review">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-3xl font-bold text-orange-600">{workflowStats?.awaitingReview || 0}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-orange-200" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-in-progress">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-3xl font-bold text-yellow-600">{workflowStats?.byStatus?.in_progress || 0}</p>
              </div>
              <Play className="w-10 h-10 text-yellow-200" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-approved">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-3xl font-bold text-green-600">{workflowStats?.byStatus?.approved || 0}</p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-my-assigned">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Assigned to Me</p>
                <p className="text-3xl font-bold text-blue-600">{workflowStats?.myAssigned || 0}</p>
              </div>
              <User className="w-10 h-10 text-blue-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workflow Tickets</CardTitle>
          <CardDescription>View and manage all workflow tickets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48" data-testid="select-status-filter">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="text-center py-12" data-testid="empty-state">
              <GitBranch className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">No Workflow Tickets</h3>
              <p className="text-muted-foreground">
                {statusFilter !== 'all' 
                  ? `No tickets with status "${statusFilter.replace('_', ' ')}" found`
                  : 'No workflow tickets have been created yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  data-testid={`ticket-row-${ticket.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium" data-testid={`ticket-number-${ticket.id}`}>
                          {ticket.ticketNumber}
                        </span>
                        {getStatusBadge(ticket.status)}
                        {getPriorityBadge(ticket.priority)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        <span className="capitalize">{ticket.entityType.replace('_', ' ')}</span>
                        <span className="mx-2">•</span>
                        <span>ID: {ticket.entityId}</span>
                        {ticket.submittedAt && (
                          <>
                            <span className="mx-2">•</span>
                            <Calendar className="w-3 h-3 inline mr-1" />
                            {new Date(ticket.submittedAt).toLocaleDateString()}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {ticket.status === 'submitted' && (
                      <Button
                        size="sm"
                        onClick={() => startProcessingMutation.mutate(ticket.id)}
                        disabled={startProcessingMutation.isPending}
                        data-testid={`button-start-${ticket.id}`}
                      >
                        <Play className="w-4 h-4 mr-1" />
                        Start
                      </Button>
                    )}
                    {ticket.status === 'in_progress' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => executeCurrentStageMutation.mutate(ticket.id)}
                        disabled={executeCurrentStageMutation.isPending}
                        data-testid={`button-execute-${ticket.id}`}
                      >
                        <ArrowRight className="w-4 h-4 mr-1" />
                        Execute Stage
                      </Button>
                    )}
                    <Link href={`/workflows/${ticket.id}`}>
                      <Button size="sm" variant="outline" data-testid={`button-view-${ticket.id}`}>
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {workflowStats?.byStatus && Object.entries(workflowStats.byStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{status.replace('_', ' ')}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${workflowStats.total ? ((count as number) / workflowStats.total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{count as number}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Priority Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {workflowStats?.byPriority && Object.entries(workflowStats.byPriority).map(([priority, count]) => (
                <div key={priority} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{priority}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          priority === 'urgent' ? 'bg-red-500' :
                          priority === 'high' ? 'bg-orange-500' :
                          priority === 'normal' ? 'bg-blue-500' : 'bg-gray-400'
                        }`}
                        style={{ width: `${workflowStats.total ? ((count as number) / workflowStats.total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{count as number}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {definitions?.definitions && definitions.definitions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Available Workflows</CardTitle>
            <CardDescription>Configured workflow definitions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {definitions.definitions.map((def: any) => (
                <div key={def.id} className="p-4 border rounded-lg">
                  <h4 className="font-medium">{def.name}</h4>
                  <p className="text-sm text-muted-foreground">{def.description}</p>
                  <Badge className="mt-2" variant="outline">{def.workflowCode}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
