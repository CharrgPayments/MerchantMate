import { Link, useLocation } from "wouter";
import { CreditCard, BarChart3, Store, Users, Receipt, FileText, LogOut, User, MapPin, Shield, Upload, UserPlus, DollarSign, ChevronLeft, ChevronRight, Monitor, ChevronDown, ChevronUp, Book, BookOpen, TestTube, Mail, Crown, Building2, Zap, ScrollText, KeyRound, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ACTIONS, getUserRoleCodes, ROLE_CODES, type Action, type RoleCode } from "@shared/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import type { LucideIcon } from "lucide-react";
import type { PdfForm } from "@shared/schema";

// Single source of truth for nav visibility — every item declares the action(s)
// it requires. Action defaults + DB overrides live in shared/permissions.ts and
// can be tweaked at runtime from /roles-permissions.
type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  requiresAction: Action;
  // Optional: also require the user to actually hold one of these roles, even
  // if they are super_admin. Used for role-specific surfaces like the agent
  // dashboard where being a super_admin doesn't mean the user *is* an agent.
  requiresAnyRole?: RoleCode[];
  subItems?: NavItem[];
};

// Dynamic PDF-form-driven items don't carry a registry action — visibility is
// scoped per-form by the form's `allowedRoles[]`.
type DynamicNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  subItems: NavItem[];
};
type RenderedNavItem = (NavItem | DynamicNavItem) & { subItems: NavItem[] };

const baseNavigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: BarChart3, requiresAction: ACTIONS.NAV_DASHBOARD },
  { name: "Agent Dashboard", href: "/agent-dashboard", icon: CreditCard, requiresAction: ACTIONS.NAV_AGENT_DASHBOARD, requiresAnyRole: [ROLE_CODES.AGENT] },
  { name: "Merchants", href: "/merchants", icon: Store, requiresAction: ACTIONS.NAV_MERCHANTS },
  { name: "Locations", href: "/locations", icon: MapPin, requiresAction: ACTIONS.NAV_LOCATIONS },
  {
    name: "Agents", href: "/agents", icon: Users, requiresAction: ACTIONS.NAV_AGENTS,
    subItems: [
      { name: "Commissions", href: "/commissions", icon: DollarSign, requiresAction: ACTIONS.NAV_COMMISSIONS },
    ],
  },
  { name: "Prospects", href: "/prospects", icon: UserPlus, requiresAction: ACTIONS.NAV_PROSPECTS },
  { name: "Underwriting", href: "/underwriting-queue", icon: Shield, requiresAction: ACTIONS.UNDERWRITING_VIEW_QUEUE },
  {
    name: "Campaigns", href: "/campaigns", icon: DollarSign, requiresAction: ACTIONS.NAV_CAMPAIGNS,
    subItems: [
      { name: "Equipment", href: "/equipment", icon: Monitor, requiresAction: ACTIONS.NAV_CAMPAIGNS },
      { name: "Assignment Rules", href: "/campaign-rules", icon: BookOpen, requiresAction: ACTIONS.NAV_CAMPAIGNS },
    ],
  },
  {
    name: "Acquirers", href: "/acquirers", icon: Building2, requiresAction: ACTIONS.NAV_ACQUIRERS,
    subItems: [
      { name: "Application Templates", href: "/application-templates", icon: FileText, requiresAction: ACTIONS.NAV_ACQUIRERS },
      { name: "PDF Naming Guide", href: "/pdf-naming-guide", icon: BookOpen, requiresAction: ACTIONS.NAV_ACQUIRERS },
      { name: "Disclosure Library", href: "/disclosure-library", icon: ScrollText, requiresAction: ACTIONS.NAV_ACQUIRERS },
      { name: "MCC Codes", href: "/mcc-codes", icon: CreditCard, requiresAction: ACTIONS.NAV_ACQUIRERS },
      { name: "MCC Policies", href: "/mcc-policies", icon: Shield, requiresAction: ACTIONS.NAV_ACQUIRERS },
    ],
  },
  { name: "Transactions", href: "/transactions", icon: Receipt, requiresAction: ACTIONS.NAV_TRANSACTIONS },
  {
    name: "Users", href: "/users", icon: User, requiresAction: ACTIONS.NAV_USERS,
    subItems: [
      { name: "Roles & Permissions", href: "/roles-permissions", icon: KeyRound, requiresAction: ACTIONS.NAV_PERMISSION_MATRIX },
    ],
  },
  { name: "Reports", href: "/reports", icon: FileText, requiresAction: ACTIONS.NAV_REPORTS },
  { name: "Security", href: "/security", icon: Shield, requiresAction: ACTIONS.NAV_SECURITY },
  { name: "Communications", href: "/communications", icon: Mail, requiresAction: ACTIONS.NAV_COMMUNICATIONS },
  { name: "Workflows", href: "/workflows", icon: Zap, requiresAction: ACTIONS.NAV_WORKFLOWS },
  { name: "API Documentation", href: "/api-documentation", icon: Book, requiresAction: ACTIONS.NAV_API_DOCS },
  { name: "Admin Operations", href: "/admin-operations", icon: Activity, requiresAction: ACTIONS.NAV_ADMIN_OPERATIONS },
  { name: "Testing Utilities", href: "/testing-utilities", icon: TestTube, requiresAction: ACTIONS.NAV_TESTING },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const { data: pdfForms = [] } = useQuery<PdfForm[]>({
    queryKey: ['/api/pdf-forms'],
    queryFn: async () => {
      const response = await fetch('/api/pdf-forms', { credentials: 'include' });
      if (!response.ok) return [] as PdfForm[];
      return response.json() as Promise<PdfForm[]>;
    },
    enabled: !!user,
  });

  const toggleExpanded = (itemName: string) =>
    setExpandedItems((prev) => prev.includes(itemName) ? prev.filter((n) => n !== itemName) : [...prev, itemName]);

  const { can } = usePermissions();

  const getFilteredNavigation = (): RenderedNavItem[] => {
    if (!user) return [];

    const userRoleCodes = getUserRoleCodes(user);
    const filteredBase: RenderedNavItem[] = baseNavigation
      .filter((item) => can(item.requiresAction))
      .filter((item) => !item.requiresAnyRole || item.requiresAnyRole.some((r) => userRoleCodes.includes(r)))
      .map((item) => ({
        ...item,
        subItems: item.subItems?.filter((sub) => can(sub.requiresAction)) ?? [],
      }));

    // Dynamic PDF-form-driven nav items still use the form-defined allowedRoles
    // because each form is user-owned data, not a permission registry concern.
    const userRoleList = getUserRoleCodes(user);
    const dynamicNavItems: RenderedNavItem[] = pdfForms
      .filter((form) =>
        form.showInNavigation && (form.allowedRoles ?? []).some((r) => userRoleList.includes(r)),
      )
      .map((form) => ({
        name: form.navigationTitle || form.name,
        href: `/form-application/${form.id}`,
        icon: FileText,
        subItems: [],
      }));

    return [...filteredBase, ...dynamicNavItems];
  };

  return (
    <div className={cn("corecrm-sidebar min-h-screen flex flex-col transition-all duration-300", isCollapsed ? "w-16" : "w-64")}>
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
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm"
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3 text-gray-600" /> : <ChevronLeft className="w-3 h-3 text-gray-600" />}
        </button>
      </div>

      <nav className={cn("flex-1 overflow-y-auto space-y-1", isCollapsed ? "p-2" : "p-4")}>
        {getFilteredNavigation().map((item) => {
          const isActive = location === item.href;
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const isExpanded = expandedItems.includes(item.name);
          const Icon = item.icon;

          return (
            <div key={item.name} className="relative group">
              <div className="flex items-center">
                <Link
                  href={item.href}
                  className={cn(
                    "corecrm-nav-item flex-1",
                    isActive && "active",
                    isCollapsed ? "justify-center px-3 py-3" : "px-4 py-2",
                    hasSubItems && !isCollapsed && "pr-2",
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {!isCollapsed && <span className="font-medium">{item.name}</span>}
                </Link>

                {hasSubItems && !isCollapsed && (
                  <button onClick={() => toggleExpanded(item.name)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </button>
                )}
              </div>

              {hasSubItems && !isCollapsed && isExpanded && (
                <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-4">
                  {item.subItems.map((subItem) => {
                    const isSubActive = location === subItem.href;
                    const SubIcon = subItem.icon;
                    return (
                      <Link
                        key={subItem.name}
                        href={subItem.href}
                        className={cn(
                          "flex items-center space-x-3 px-3 py-2 text-sm rounded-lg transition-colors",
                          isSubActive ? "bg-primary text-primary-foreground font-medium" : "text-gray-700 hover:bg-gray-100",
                        )}
                      >
                        <SubIcon className="w-4 h-4" />
                        <span>{subItem.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}

              {isCollapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
                  {item.name}
                  {hasSubItems && (
                    <div className="mt-1 text-xs text-gray-300">{item.subItems.map((sub) => sub.name).join(', ')}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

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
                    {user.firstName} {user.lastName}
                  </p>
                  {can(ACTIONS.SUPERADMIN_ONLY) && (
                    <Crown className="w-4 h-4 text-yellow-500" />
                  )}
                </div>
                <p className="text-xs text-gray-500 capitalize">
                  {(user.roles?.[0] || user.role || '')?.replace('_', ' ')}
                </p>
              </div>
            </div>
          )}

          <div className="relative group">
            <Button variant="outline" size="sm" onClick={logout} className={cn("transition-colors", isCollapsed ? "w-10 h-10 p-0" : "w-full")}>
              <LogOut className="w-4 h-4" />
              {!isCollapsed && <span className="ml-2">Sign Out</span>}
            </Button>
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
