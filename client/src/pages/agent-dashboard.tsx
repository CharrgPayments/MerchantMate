import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Users, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle,
  TrendingUp,
  Calendar,
  Phone,
  Mail
} from 'lucide-react';
import { Link } from 'wouter';

interface Application {
  id: number;
  prospectName: string;
  companyName: string;
  email: string;
  phone: string;
  status: 'pending' | 'contacted' | 'in_progress' | 'submitted' | 'applied' | 'approved' | 'rejected';
  createdAt: string;
  lastUpdated: string;
  completionPercentage: number;
  assignedAgent: string;
  signatureStatus?: {
    required: number;
    completed: number;
    pending: number;
    isComplete: boolean;
    needsAttention: boolean;
  };
}

interface DashboardStats {
  totalApplications: number;
  pendingApplications: number;
  contactedApplications: number;
  inProgressApplications: number;
  appliedApplications: number;
  completedApplications: number;
  approvedApplications: number;
  rejectedApplications: number;
  conversionRate: number;
  averageProcessingTime: number;
}

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  contacted: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-purple-100 text-purple-800',
  submitted: 'bg-indigo-100 text-indigo-800',
  applied: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const statusIcons = {
  pending: AlertCircle,
  contacted: Phone,
  in_progress: Clock,
  submitted: FileText,
  applied: FileText,
  approved: CheckCircle,
  rejected: XCircle,
};

type DownlineScope = 'me' | 'downline' | 'all';

export default function AgentDashboard() {
  const [selectedTab, setSelectedTab] = useState('overview');
  const [scope, setScope] = useState<DownlineScope>('me');

  // Fetch dashboard statistics
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<DashboardStats>({
    queryKey: ['/api/agent/dashboard/stats', scope],
    queryFn: async () => {
      const response = await fetch(`/api/agent/dashboard/stats?scope=${scope}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: 3,
  });

  // Fetch applications
  const { data: applications, isLoading: applicationsLoading, error: applicationsError } = useQuery<Application[]>({
    queryKey: ['/api/agent/applications', scope],
    queryFn: async () => {
      const response = await fetch(`/api/agent/applications?scope=${scope}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    refetchInterval: 30000,
    retry: 3,
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusIcon = (status: string) => {
    const Icon = statusIcons[status as keyof typeof statusIcons] || AlertCircle;
    return <Icon className="h-4 w-4" />;
  };

  const getCompletionColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const filteredApplications = (status?: string) => {
    if (!applications || !Array.isArray(applications)) return [];
    if (!status) return applications;
    
    // Special filter for applications needing signature attention
    if (status === 'signatures') {
      return applications.filter((app: Application) => 
        app.signatureStatus?.needsAttention === true
      );
    }
    
    return applications.filter((app: Application) => app.status === status);
  };

  if (statsLoading || applicationsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (statsError || applicationsError) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to load dashboard data</h2>
            <p className="text-gray-600 mb-4">
              {statsError?.message || applicationsError?.message || 'Authentication required'}
            </p>
            <Button onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Agent Dashboard</h1>
          <p className="text-gray-600">Manage your merchant applications and track progress</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border bg-white shadow-sm" role="group" aria-label="Downline scope">
            {([
              { v: 'me', label: 'Just me', title: 'Only your own prospects' },
              { v: 'downline', label: 'My downline', title: 'You plus every sub-agent reporting to you' },
              { v: 'all', label: 'All', title: 'Admins/corporate see every agent. Non-admins see their downline.' },
            ] as { v: DownlineScope; label: string; title: string }[]).map(({ v, label, title }) => (
              <button
                key={v}
                type="button"
                onClick={() => setScope(v)}
                aria-pressed={scope === v}
                title={title}
                data-testid={`scope-${v}`}
                className={`px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md border-r last:border-r-0 ${
                  scope === v ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Link href="/prospects">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Users className="h-4 w-4 mr-2" />
              Manage Prospects
            </Button>
          </Link>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalApplications ?? 0}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.inProgressApplications ?? 0}</div>
            <p className="text-xs text-muted-foreground">Active applications</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.approvedApplications ?? 0}</div>
            <p className="text-xs text-muted-foreground">Successfully approved</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.conversionRate?.toFixed(1) ?? 0}%</div>
            <p className="text-xs text-muted-foreground">Approval rate</p>
          </CardContent>
        </Card>

        {/* Signature Monitoring Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Signatures Pending</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {applications?.filter(app => app.signatureStatus?.needsAttention).length ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting signatures</p>
          </CardContent>
        </Card>
      </div>

      {/* Applications Management */}
      <Card>
        <CardHeader>
          <CardTitle>Merchant Applications</CardTitle>
          <CardDescription>Track and manage your merchant application pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="overview">All</TabsTrigger>
              <TabsTrigger value="signatures">
                <div className="flex items-center space-x-1">
                  <Clock className="h-3 w-3" />
                  <span>Signatures</span>
                </div>
              </TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="in_progress">In Progress</TabsTrigger>
              <TabsTrigger value="applied">Applied</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <ApplicationsList applications={filteredApplications()} />
            </TabsContent>

            <TabsContent value="signatures" className="space-y-4">
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 text-yellow-600 mr-2" />
                  <span className="text-sm text-yellow-800 font-medium">
                    Applications requiring signature collection
                  </span>
                </div>
              </div>
              <ApplicationsList applications={filteredApplications('signatures')} />
            </TabsContent>

            <TabsContent value="pending" className="space-y-4">
              <ApplicationsList applications={filteredApplications('pending')} />
            </TabsContent>

            <TabsContent value="in_progress" className="space-y-4">
              <ApplicationsList applications={filteredApplications('in_progress')} />
            </TabsContent>

            <TabsContent value="applied" className="space-y-4">
              <ApplicationsList applications={filteredApplications('applied')} />
            </TabsContent>

            <TabsContent value="approved" className="space-y-4">
              <ApplicationsList applications={filteredApplications('approved')} />
            </TabsContent>

            <TabsContent value="rejected" className="space-y-4">
              <ApplicationsList applications={filteredApplications('rejected')} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function ApplicationsList({ applications }: { applications: Application[] }) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusIcon = (status: string) => {
    const Icon = statusIcons[status as keyof typeof statusIcons] || AlertCircle;
    return <Icon className="h-4 w-4" />;
  };

  const getCompletionColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (!applications || applications.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No applications found</h3>
        <p className="text-gray-500">Applications will appear here when prospects start their merchant applications.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {applications.map((application) => (
        <div key={application.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                {getStatusIcon(application.status)}
                <Badge className={statusColors[application.status]}>
                  {application.status.replace('_', ' ').toUpperCase()}
                </Badge>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{application.prospectName}</h3>
                <p className="text-sm text-gray-600">{application.companyName}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Created {formatDate(application.createdAt)}</p>
              <p className="text-sm text-gray-500">Updated {formatDate(application.lastUpdated)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1 text-sm text-gray-600">
                <Mail className="h-4 w-4" />
                <span>{application.email}</span>
              </div>
              <div className="flex items-center space-x-1 text-sm text-gray-600">
                <Phone className="h-4 w-4" />
                <span>{application.phone}</span>
              </div>
              
              {/* Signature Status Indicator */}
              {application.signatureStatus && application.signatureStatus.required > 0 && (
                <div className="flex items-center space-x-1 text-sm">
                  {application.signatureStatus.isComplete ? (
                    <div className="flex items-center text-green-700 bg-green-50 px-2 py-1 rounded-md">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      <span className="font-medium">Signatures Complete</span>
                      <span className="ml-1 text-gray-600">({application.signatureStatus.completed}/{application.signatureStatus.required})</span>
                    </div>
                  ) : application.signatureStatus.needsAttention ? (
                    <div className="flex items-center text-yellow-700 bg-yellow-50 px-2 py-1 rounded-md">
                      <Clock className="h-3 w-3 mr-1" />
                      <span className="font-medium">Signatures Pending</span>
                      <span className="ml-1 text-gray-600">({application.signatureStatus.completed}/{application.signatureStatus.required})</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Link href={`/application-view/${application.id}`}>
                <Button variant="outline" size="sm">
                  View Application
                </Button>
              </Link>
              {(application.status === 'submitted' || application.status === 'applied' || application.status === 'approved' || application.status === 'rejected') && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.open(`/application-print/${application.id}`, '_blank')}
                >
                  Print PDF
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Completion Progress</span>
              <span className="font-medium">{application.completionPercentage}%</span>
            </div>
            <Progress 
              value={application.completionPercentage} 
              className="h-2"
            />
          </div>
        </div>
      ))}
    </div>
  );
}