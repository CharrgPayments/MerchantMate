import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, Trash2, ExternalLink, Mail, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { formatDateInUserTimezone } from "@/lib/timezone";
import { Link } from "wouter";

interface Alert {
  id: number;
  userId: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  isRead: boolean;
  createdAt: string;
  readAt?: string | null;
  actionUrl?: string | null;
  actionActivityId?: number | null;
}

export default function AlertsPage() {
  const { user } = useAuth();

  const { data: unreadAlertsData, isLoading: isLoadingUnread } = useQuery<{ alerts: Alert[] }>({
    queryKey: ['/api/alerts'],
  });

  const { data: allAlertsData, isLoading: isLoadingAll } = useQuery<{ alerts: Alert[] }>({
    queryKey: ['/api/alerts?includeRead=true'],
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (alertId: number) => {
      return apiRequest('PATCH', `/api/alerts/${alertId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    }
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/alerts/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    }
  });

  const deleteAlertMutation = useMutation({
    mutationFn: async (alertId: number) => {
      return apiRequest('DELETE', `/api/alerts/${alertId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    }
  });

  const deleteAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', '/api/alerts/read/all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    }
  });

  const unreadAlerts = unreadAlertsData?.alerts || [];
  const allAlerts = allAlertsData?.alerts || [];

  const getAlertTypeStyles = (type: Alert['type']) => {
    switch (type) {
      case 'error':
        return 'bg-red-50 border-red-200 text-red-900';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-900';
      case 'success':
        return 'bg-green-50 border-green-200 text-green-900';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-900';
    }
  };

  const formatAlertDate = (dateStr: string) => {
    const timezone = user?.timezone || undefined;
    return formatDateInUserTimezone(dateStr, "MMM dd, yyyy 'at' hh:mm a", timezone);
  };

  const renderAlert = (alert: Alert) => (
    <Card 
      key={alert.id} 
      className={`p-4 mb-3 ${!alert.isRead ? 'bg-gray-50 border-l-4 border-l-blue-600' : ''}`}
      data-testid={`alert-card-${alert.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`inline-block px-2 py-1 rounded text-xs font-medium ${getAlertTypeStyles(alert.type)}`}>
              {alert.type.toUpperCase()}
            </div>
            {!alert.isRead && (
              <Badge variant="default" className="bg-blue-600">
                NEW
              </Badge>
            )}
          </div>
          <p className="text-sm mb-2">{alert.message}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{formatAlertDate(alert.createdAt)}</span>
            {alert.readAt && (
              <span className="text-green-600">Read: {formatAlertDate(alert.readAt)}</span>
            )}
          </div>
          {alert.actionUrl && (
            <Link href={alert.actionUrl}>
              <Button 
                variant="link" 
                size="sm" 
                className="p-0 h-auto mt-2 text-blue-600"
                data-testid={`button-view-details-${alert.id}`}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                View details
              </Button>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!alert.isRead && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAsReadMutation.mutate(alert.id)}
              disabled={markAsReadMutation.isPending}
              data-testid={`button-mark-read-${alert.id}`}
            >
              <Check className="w-4 h-4 mr-1" />
              Mark read
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteAlertMutation.mutate(alert.id)}
            disabled={deleteAlertMutation.isPending}
            data-testid={`button-delete-${alert.id}`}
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-sm text-gray-600">Manage your alerts and notifications</p>
          </div>
        </div>
        <div className="flex gap-2">
          {unreadAlerts.length > 0 && (
            <Button
              variant="outline"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              data-testid="button-mark-all-read-page"
            >
              <Check className="w-4 h-4 mr-2" />
              Mark all read
            </Button>
          )}
          {allAlerts.some(a => a.isRead) && (
            <Button
              variant="outline"
              onClick={() => deleteAllReadMutation.mutate()}
              disabled={deleteAllReadMutation.isPending}
              data-testid="button-delete-all-read"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete all read
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="unread" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="unread" data-testid="tab-unread">
            Unread
            {unreadAlerts.length > 0 && (
              <Badge variant="default" className="ml-2 bg-blue-600">
                {unreadAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">
            All Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unread" data-testid="content-unread">
          {isLoadingUnread ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading unread alerts...</p>
            </div>
          ) : unreadAlerts.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
                <p className="text-sm text-gray-600">You have no unread notifications</p>
              </div>
            </Card>
          ) : (
            <div>{unreadAlerts.map(renderAlert)}</div>
          )}
        </TabsContent>

        <TabsContent value="all" data-testid="content-all">
          {isLoadingAll ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading all alerts...</p>
            </div>
          ) : allAlerts.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No notifications</h3>
                <p className="text-sm text-gray-600">You don't have any notifications yet</p>
              </div>
            </Card>
          ) : (
            <div>{allAlerts.map(renderAlert)}</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
