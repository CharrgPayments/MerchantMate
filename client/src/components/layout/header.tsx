import { Search, Bell, Clock, MapPin, Database, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDateInUserTimezone, getTimezoneAbbreviation } from "@/lib/timezone";

interface HeaderProps {
  title: string;
  onSearch?: (query: string) => void;
}

export function Header({ title, onSearch }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDbParam, setCurrentDbParam] = useState<string | null>(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Watch for URL changes and database environment changes
  useEffect(() => {
    const updateDbParam = () => {
      const urlParams = new URLSearchParams(window.location.search);
      let dbParam = urlParams.get('db');
      
      // If no URL parameter, check localStorage for persistent environment
      if (!dbParam) {
        const storedEnv = localStorage.getItem('selectedDbEnvironment');
        if (storedEnv && ['test', 'dev'].includes(storedEnv)) {
          dbParam = storedEnv;
        }
      }
      
      if (dbParam !== currentDbParam) {
        setCurrentDbParam(dbParam);
        // Invalidate the database environment query to force refetch
        queryClient.invalidateQueries({ queryKey: ['/api/admin/db-environment'] });
      }
    };
    
    // Listen for custom database environment change events
    const handleDbEnvChange = (event: CustomEvent) => {
      const newEnv = event.detail.environment;
      const dbParam = newEnv === 'default' ? null : newEnv;
      setCurrentDbParam(dbParam);
      // Invalidate the database environment query to force refetch
      queryClient.invalidateQueries({ queryKey: ['/api/admin/db-environment'] });
    };
    
    // Initial check
    updateDbParam();
    
    // Listen for custom events from Testing Utilities
    window.addEventListener('dbEnvironmentChanged', handleDbEnvChange as EventListener);
    
    // Check URL parameters periodically as backup (reduced frequency)
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
        
      const response = await fetch(url, {
        credentials: 'include'
      });
      if (!response.ok) return { environment: 'production', version: '1.0' };
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
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
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full"></span>
          </Button>
        </div>
      </div>
    </header>
  );
}
