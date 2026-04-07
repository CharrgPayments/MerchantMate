import { Search, Bell, Clock, MapPin, Database, AlertTriangle, Check, Trash2, Mail, ExternalLink, User, LogOut, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { formatDateInUserTimezone, getTimezoneAbbreviation } from "@/lib/timezone";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

function AlertsButton() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  const { data: alertCount } = useQuery<{ count: number }>({
    queryKey: ['/api/alerts/count'],
    queryFn: async () => {
      const res = await fetch('/api/alerts/count', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch alert count');
      return res.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: alertsData, isLoading } = useQuery<{ alerts: Alert[] }>({
    queryKey: ['/api/alerts'],
    queryFn: async () => {
      const res = await fetch('/api/alerts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch alerts');
      return res.json();
    },
    enabled: open, // Only fetch when dropdown is open
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

  const unreadCount = alertCount?.count || 0;
  const hasUnread = unreadCount > 0;
  const alerts = alertsData?.alerts || [];

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

  const handleAlertClick = (alert: Alert) => {
    if (!alert.isRead) {
      markAsReadMutation.mutate(alert.id);
    }
  };

  const formatAlertDate = (dateStr: string) => {
    const timezone = user?.timezone || undefined;
    return formatDateInUserTimezone(dateStr, "MMM dd, yyyy 'at' hh:mm a", timezone);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative"
          data-testid="button-alerts"
        >
          <Bell 
            className="w-5 h-5" 
            style={{ 
              stroke: hasUnread ? '#dc2626' : '#10b981', // Red if unread, green if all read
              strokeWidth: hasUnread ? 2.5 : 2
            }} 
          />
          {hasUnread && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center px-1 bg-red-500 text-white text-xs"
              data-testid="badge-alert-count"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" data-testid="popover-alerts">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {hasUnread && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <Check className="w-4 h-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        
        <ScrollArea className="h-96">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-gray-500">Loading alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center">
              <Mail className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-500">No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-4 ${!alert.isRead ? 'bg-gray-50' : ''} hover:bg-gray-100 transition-colors cursor-pointer`}
                  onClick={() => handleAlertClick(alert)}
                  data-testid={`alert-item-${alert.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className={`inline-block px-2 py-1 rounded text-xs font-medium mb-2 ${getAlertTypeStyles(alert.type)}`}>
                        {alert.type.toUpperCase()}
                      </div>
                      <p className="text-sm mb-2">{alert.message}</p>
                      <p className="text-xs text-gray-500">
                        {formatAlertDate(alert.createdAt)}
                      </p>
                      {alert.actionUrl && (
                        <Link href={alert.actionUrl}>
                          <Button 
                            variant="link" 
                            size="sm" 
                            className="p-0 h-auto mt-2 text-blue-600"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`button-alert-action-${alert.id}`}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            View details
                          </Button>
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!alert.isRead && (
                        <div className="w-2 h-2 bg-blue-600 rounded-full" data-testid={`badge-unread-${alert.id}`}></div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAlertMutation.mutate(alert.id);
                        }}
                        disabled={deleteAlertMutation.isPending}
                        data-testid={`button-delete-alert-${alert.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-gray-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <Separator />
        
        <div className="p-2">
          <Link href="/alerts">
            <Button 
              variant="ghost" 
              className="w-full justify-center text-sm" 
              onClick={() => setOpen(false)}
              data-testid="button-view-all-alerts"
            >
              View all notifications
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface HeaderProps {
  title: string;
  onSearch?: (query: string) => void;
}

export function Header({ title, onSearch }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  
  // Global environment system - listen for environment changes
  useEffect(() => {
    const handleEnvChange = (event: CustomEvent) => {
      // Invalidate all queries when environment changes globally
      queryClient.invalidateQueries();
    };
    
    // Listen for global environment change events
    window.addEventListener('globalEnvironmentChanged', handleEnvChange as EventListener);
    
    return () => {
      window.removeEventListener('globalEnvironmentChanged', handleEnvChange as EventListener);
    };
  }, [queryClient]);
  
  // Fetch global environment status
  const { data: dbEnvironment } = useQuery({
    queryKey: ['/api/environment'],
    queryFn: async () => {
      const response = await fetch('/api/environment', {
        credentials: 'include'
      });
      if (!response.ok) return { environment: 'production', globalEnvironment: 'production', isProduction: true };
      return response.json();
    },
    staleTime: 30000, // Cache for 30 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
    refetchInterval: false, // Disable automatic refetching
    refetchOnWindowFocus: false, // Disable refetch on window focus
  });

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
      
      return {
        dateTime: formattedDateTime,
        timezone: timezoneAbbr,
        ip: lastLoginIp || "Unknown"
      };
    } catch (error) {
      return null;
    }
  };

  const lastLoginInfo = formatLastLogin(
    user?.lastLoginAt ? (typeof user.lastLoginAt === 'string' ? user.lastLoginAt : user.lastLoginAt.toISOString()) : null, 
    user?.lastLoginIp || null
  );

  const getDatabaseBadge = () => {
    // Never show database environment indicator in production builds
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
          <span className="font-medium">
            {dbEnvironment.environment.toUpperCase()} DB
          </span>
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

          {/* Notifications */}
          <AlertsButton />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-user-menu">
                <User className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div>
                  <p className="font-medium">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile" className="flex items-center cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={logout}
                className="cursor-pointer text-red-600 focus:text-red-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
