import { Search, Bell, Clock, MapPin, Database, AlertTriangle, CheckCheck, ExternalLink, Info, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDateInUserTimezone, getTimezoneAbbreviation } from "@/lib/timezone";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface HeaderProps {
  title: string;
  onSearch?: (query: string) => void;
}

interface Alert {
  id: number;
  userId: string;
  message: string;
  type: string;
  isRead: boolean;
  readAt: string | null;
  actionUrl: string | null;
  actionActivityId: number | null;
  createdAt: string;
}

export function Header({ title, onSearch }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDbParam, setCurrentDbParam] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Watch for URL changes and database environment changes
  useEffect(() => {
    const updateDbParam = () => {
      const urlParams = new URLSearchParams(window.location.search);
      let dbParam = urlParams.get('db');

      if (!dbParam) {
        const storedEnv = localStorage.getItem('selectedDbEnvironment');
        if (storedEnv && ['test', 'dev'].includes(storedEnv)) {
          dbParam = storedEnv;
        }
      }

      if (dbParam !== currentDbParam) {
        setCurrentDbParam(dbParam);
        queryClient.invalidateQueries({ queryKey: ['/api/admin/db-environment'] });
      }
    };

    const handleDbEnvChange = (event: CustomEvent) => {
      const newEnv = event.detail.environment;
      const dbParam = newEnv === 'default' ? null : newEnv;
      setCurrentDbParam(dbParam);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/db-environment'] });
    };

    updateDbParam();
    window.addEventListener('dbEnvironmentChanged', handleDbEnvChange as EventListener);
    const intervalId = setInterval(updateDbParam, 30000);

    return () => {
      window.removeEventListener('dbEnvironmentChanged', handleDbEnvChange as EventListener);
      clearInterval(intervalId);
    };
  }, [currentDbParam, queryClient]);

  // Fetch current database environment
  const { data: dbEnvironment } = useQuery({
    queryKey: ['/api/admin/db-environment'],
    queryFn: async () => {
      const url = currentDbParam
        ? `/api/admin/db-environment?db=${currentDbParam}`
        : '/api/admin/db-environment';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return { environment: 'production', version: '1.0' };
      return response.json();
    },
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // Fetch unread alert count for badge
  const { data: alertCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/alerts/count'],
    queryFn: async () => {
      const res = await fetch('/api/alerts/count', { credentials: 'include' });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  // Fetch recent unread alerts for the popover
  const { data: alertsData } = useQuery<{ alerts: Alert[] }>({
    queryKey: ['/api/alerts'],
    queryFn: async () => {
      const res = await fetch('/api/alerts', { credentials: 'include' });
      if (!res.ok) return { alerts: [] };
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
    enabled: bellOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (alertId: number) => apiRequest('PATCH', `/api/alerts/${alertId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/alerts/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    },
  });

  const unreadCount = alertCountData?.count ?? 0;
  const recentAlerts = (alertsData?.alerts ?? []).slice(0, 5);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    onSearch?.(query);
  };

  const formatLastLogin = (lastLoginAt: string | Date | null, lastLoginIp: string | null, userTimezone?: string | null) => {
    if (!lastLoginAt) return null;
    try {
      const timezone = userTimezone || user?.timezone || undefined;
      const formattedDateTime = formatDateInUserTimezone(lastLoginAt, "MMM dd, yyyy 'at' hh:mm a", timezone);
      const timezoneAbbr = getTimezoneAbbreviation(timezone);
      if (!formattedDateTime) return null;
      return { dateTime: formattedDateTime, timezone: timezoneAbbr, ip: lastLoginIp || "Unknown" };
    } catch {
      return null;
    }
  };

  const lastLoginInfo = formatLastLogin(
    user?.lastLoginAt ? (typeof user.lastLoginAt === 'string' ? user.lastLoginAt : user.lastLoginAt.toISOString()) : null,
    user?.lastLoginIp || null
  );

  const getDatabaseBadge = () => {
    if (import.meta.env.PROD) return null;
    if (!dbEnvironment || dbEnvironment.environment === 'production') return null;
    const isDevEnvironment = dbEnvironment.environment === 'development' || dbEnvironment.environment === 'dev';
    const isTestEnvironment = dbEnvironment.environment === 'test';
    return (
      <div className="flex items-center space-x-2 border-r border-gray-200 pr-4">
        <Badge
          variant={isTestEnvironment ? "destructive" : "secondary"}
          className={`flex items-center space-x-1 ${
            isTestEnvironment ? 'bg-orange-100 text-orange-800 border-orange-200' :
            isDevEnvironment ? 'bg-blue-100 text-blue-800 border-blue-200' : ''
          }`}
        >
          <Database className="w-3 h-3" />
          <span className="font-medium">{dbEnvironment.environment.toUpperCase()} DB</span>
        </Badge>
        {(isDevEnvironment || isTestEnvironment) && (
          <div className="flex items-center space-x-1 text-xs text-orange-600">
            <AlertTriangle className="w-3 h-3" />
            <span>Non-Production</span>
          </div>
        )}
      </div>
    );
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'warning': return <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
      default: return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex-1 p-6 max-w-lg">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        </div>
        <div className="flex items-center space-x-4 px-6 py-4">
          {/* Database Environment Indicator */}
          {getDatabaseBadge()}

          {/* Last Login Info */}
          {lastLoginInfo && (
            <div className="flex items-center space-x-3 text-xs text-gray-500 border-r border-gray-200 pr-4">
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>Last login: {lastLoginInfo.dateTime} ({lastLoginInfo.timezone})</span>
              </div>
              <div className="flex items-center space-x-1">
                <MapPin className="w-3 h-3" />
                <span>{lastLoginInfo.ip}</span>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search merchants, agents, or transactions..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-80 pl-10"
            />
          </div>

          {/* Notifications Bell */}
          <Popover open={bellOpen} onOpenChange={setBellOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-gray-600" />
                  <span className="font-semibold text-sm text-gray-900">Notifications</span>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="text-xs px-1.5 py-0.5 h-5">
                      {unreadCount}
                    </Badge>
                  )}
                </div>
                {unreadCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 text-blue-600 hover:text-blue-700"
                    onClick={() => markAllReadMutation.mutate()}
                    disabled={markAllReadMutation.isPending}
                  >
                    <CheckCheck className="w-3 h-3 mr-1" />
                    Mark all read
                  </Button>
                )}
              </div>

              {/* Alerts list */}
              <div className="max-h-72 overflow-y-auto">
                {recentAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <Bell className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-sm">No new notifications</p>
                  </div>
                ) : (
                  recentAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                        !alert.isRead ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div className="pt-0.5">{getAlertIcon(alert.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug ${!alert.isRead ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                          {alert.message}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">{formatRelativeTime(alert.createdAt)}</span>
                          <div className="flex items-center gap-1">
                            {alert.actionUrl && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1 text-xs text-blue-600"
                                onClick={() => { navigate(alert.actionUrl!); setBellOpen(false); }}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            )}
                            {!alert.isRead && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1 text-xs text-gray-400 hover:text-gray-600"
                                onClick={() => markReadMutation.mutate(alert.id)}
                                disabled={markReadMutation.isPending}
                              >
                                <CheckCheck className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-gray-100">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm text-blue-600 hover:text-blue-700 h-8"
                  onClick={() => { navigate('/alerts'); setBellOpen(false); }}
                >
                  View all notifications
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}
