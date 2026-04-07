import { Link, useLocation } from "wouter";
import { CreditCard, BarChart3, Store, Users, Receipt, FileText, LogOut, User, MapPin, Shield, Upload, UserPlus, DollarSign, ChevronLeft, ChevronRight, Monitor, ChevronDown, ChevronUp, Book, TestTube, Mail, Crown, Building2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { canAccessAnalytics, canAccessMerchants, canAccessAgents, canAccessTransactions } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const baseNavigation = [
  { name: "Dashboard", href: "/", icon: BarChart3, requiresRole: ['merchant', 'agent', 'admin', 'corporate', 'super_admin'] },
  { name: "Agent Dashboard", href: "/agent-dashboard", icon: CreditCard, requiresRole: ['agent'] },
  { name: "Merchants", href: "/merchants", icon: Store, requiresRole: ['agent', 'admin', 'corporate', 'super_admin'] },
  { name: "Locations", href: "/locations", icon: MapPin, requiresRole: ['merchant'] },
  { name: "Agents", href: "/agents", icon: Users, requiresRole: ['admin', 'corporate', 'super_admin'] },
  { name: "Prospects", href: "/prospects", icon: UserPlus, requiresRole: ['admin', 'corporate', 'super_admin'] },
  { 
    name: "Campaigns", 
    href: "/campaigns", 
    icon: DollarSign, 
    requiresRole: ['admin', 'super_admin'],
    subItems: [
      { name: "Equipment", href: "/equipment", icon: Monitor, requiresRole: ['admin', 'super_admin'] }
    ]
  },
  { 
    name: "Acquirers", 
    href: "/acquirers", 
    icon: Building2, 
    requiresRole: ['admin', 'super_admin'],
    subItems: [
      { name: "Application Templates", href: "/application-templates", icon: FileText, requiresRole: ['admin', 'super_admin'] }
    ]
  },
  { name: "Transactions", href: "/transactions", icon: Receipt, requiresRole: ['merchant', 'agent', 'admin', 'corporate', 'super_admin'] },
  { name: "PDF Forms", href: "/pdf-forms", icon: Upload, requiresRole: ['admin', 'super_admin'] },
  { name: "Users", href: "/users", icon: User, requiresRole: ['admin', 'corporate', 'super_admin'] },
  { name: "Reports", href: "/reports", icon: FileText, requiresRole: ['admin', 'corporate', 'super_admin'] },
  { name: "Security", href: "/security", icon: Shield, requiresRole: ['admin', 'super_admin'] },
  { name: "Communications", href: "/communications", icon: Mail, requiresRole: ['admin', 'super_admin'] },
  { name: "API Documentation", href: "/api-documentation", icon: Book, requiresRole: ['admin', 'super_admin'] },
  { name: "Testing Utilities", href: "/testing-utilities", icon: TestTube, requiresRole: ['super_admin'] },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Fetch PDF forms that should appear in navigation
  const { data: pdfForms = [] } = useQuery({
    queryKey: ['/api/pdf-forms'],
    queryFn: async () => {
      const response = await fetch('/api/pdf-forms', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user
  });

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => 
      prev.includes(itemName) 
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    );
  };

  const getFilteredNavigation = () => {
    if (!user) return [];
    
    const userRoles = (user as any)?.roles || [];
    
    // Helper function to check if user has any of the required roles
    const hasRequiredRole = (requiredRoles: string[]) => {
      return userRoles.some((userRole: string) => requiredRoles.includes(userRole));
    };
    
    // Filter base navigation with sub-items
    const filteredBase = baseNavigation.filter(item => {
      return hasRequiredRole(item.requiresRole);
    }).map(item => ({
      ...item,
      subItems: (item as any).subItems?.filter((subItem: any) => 
        hasRequiredRole(subItem.requiresRole)
      ) || []
    }));

    // Add dynamic PDF form navigation items - automatically creates dedicated pages
    const dynamicNavItems = pdfForms
      .filter((form: any) => 
        form.showInNavigation && 
        hasRequiredRole(form.allowedRoles)
      )
      .map((form: any) => ({
        name: form.navigationTitle || form.name,
        href: `/form-application/${form.id}`,
        icon: FileText,
        requiresRole: form.allowedRoles,
        subItems: []
      }));

    return [...filteredBase, ...dynamicNavItems];
  };

  return (
    <div className={cn("corecrm-sidebar h-screen flex flex-col transition-all duration-300", isCollapsed ? "w-16" : "w-64")}>
      {/* Logo */}
      <div className={cn("border-b border-gray-200 relative flex-shrink-0", isCollapsed ? "p-4" : "p-6")}>
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-white" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-xl font-bold text-gray-900">CoreCRM</h1>
              <p className="text-sm text-gray-500">Payment Management</p>
            </div>
          )}
        </div>
        
        {/* Collapse Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm"
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3 text-gray-600" />
          ) : (
            <ChevronLeft className="w-3 h-3 text-gray-600" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 overflow-y-auto space-y-2", isCollapsed ? "p-2" : "p-4")}>
        {getFilteredNavigation().map((item: any) => {
          const isActive = location === item.href;
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const isExpanded = expandedItems.includes(item.name);
          const Icon = item.icon;
          
          return (
            <div key={item.name} className="relative group">
              {/* Main Navigation Item */}
              <div className="flex items-center">
                <Link 
                  href={item.href} 
                  className={cn(
                    "corecrm-nav-item flex-1", 
                    isActive && "active",
                    isCollapsed ? "justify-center px-3 py-3" : "px-4 py-2",
                    hasSubItems && !isCollapsed && "pr-2"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {!isCollapsed && <span className="font-medium">{item.name}</span>}
                </Link>
                
                {/* Expand/Collapse Button */}
                {hasSubItems && !isCollapsed && (
                  <button
                    onClick={() => toggleExpanded(item.name)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                )}
              </div>
              
              {/* Sub-items */}
              {hasSubItems && !isCollapsed && isExpanded && (
                <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-4">
                  {item.subItems.map((subItem: any) => {
                    const isSubActive = location === subItem.href;
                    const SubIcon = subItem.icon;
                    
                    return (
                      <Link
                        key={subItem.name}
                        href={subItem.href}
                        className={cn(
                          "flex items-center space-x-3 px-3 py-2 text-sm rounded-lg transition-colors",
                          isSubActive 
                            ? "bg-primary text-primary-foreground font-medium" 
                            : "text-gray-700 hover:bg-gray-100"
                        )}
                      >
                        <SubIcon className="w-4 h-4" />
                        <span>{subItem.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
              
              {/* Tooltip for collapsed state */}
              {isCollapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
                  {item.name}
                  {hasSubItems && (
                    <div className="mt-1 text-xs text-gray-300">
                      {item.subItems.map((sub: any) => sub.name).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User Profile & Logout */}
      {user && (
        <div className={cn("border-t border-gray-200 flex-shrink-0", isCollapsed ? "p-2" : "p-4")}>
          {!isCollapsed && (
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {(user as any)?.firstName} {(user as any)?.lastName}
                  </p>
                  {/* Super Admin Crown Badge */}
                  {(user as any)?.roles?.includes('super_admin') && (
                    <Crown className="w-4 h-4 text-yellow-500" title="Super Administrator" />
                  )}
                </div>
                <p className="text-xs text-gray-500 capitalize">
                  {(user as any)?.roles?.[0]?.replace('_', ' ') || 'User'}
                </p>
              </div>
            </div>
          )}
          
          <div className="relative group">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={logout}
              className={cn(
                "transition-colors",
                isCollapsed ? "w-10 h-10 p-0" : "w-full"
              )}
            >
              <LogOut className="w-4 h-4" />
              {!isCollapsed && <span className="ml-2">Sign Out</span>}
            </Button>
            
            {/* Tooltip for collapsed logout button */}
            {isCollapsed && (
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
                Sign Out
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
