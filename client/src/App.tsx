import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { ACTIONS } from "@shared/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import Dashboard from "@/pages/dashboard";
import Merchants from "@/pages/merchants";
import Locations from "@/pages/locations";
import Agents from "@/pages/agents";
import Transactions from "@/pages/transactions";
import Users from "@/pages/users";
import Reports from "@/pages/reports";
import Security from "@/pages/security";
import PdfForms from "@/pages/pdf-forms";
import PdfFormWizard from "@/pages/pdf-form-wizard";
import EnhancedPdfWizard from "@/pages/enhanced-pdf-wizard";
import PublicForm from "@/pages/public-form";
import MerchantApplication from "@/pages/merchant-application";
import FormApplication from "@/pages/form-application";
import Prospects from "@/pages/prospects";
import ProspectValidation from "@/pages/prospect-validation";
import SignatureRequest from "@/pages/signature-request";
import ApplicationStatus from "@/pages/application-status";
import ApplicationView from "@/pages/application-view";
import ApplicationPrint from "@/pages/application-print";
import AgentDashboard from "@/pages/agent-dashboard";
import Campaigns from "@/pages/campaigns";
import Equipment from "@/pages/equipment";
import ApiDocumentation from "@/pages/api-documentation";
import TestingUtilities from "@/pages/testing-utilities";
import RolesPermissionsPage from "@/pages/roles-permissions";
import UnderwritingQueue from "@/pages/underwriting-queue";
import UnderwritingReview from "@/pages/underwriting-review";
import Workflows from "@/pages/workflows";
import ApplicationTemplates from "@/pages/application-templates";
import CampaignView from "@/pages/campaign-view";
import CampaignRulesPage from "@/pages/campaign-rules";
import Acquirers from "@/pages/acquirers";
import MccCodes from "@/pages/mcc-codes";
import MccPolicies from "@/pages/mcc-policies";
import DisclosureLibrary from "@/pages/disclosure-library";
import PdfNamingGuide from "@/pages/pdf-naming-guide";
import FormDemo from "@/pages/form-demo";
import ActionTemplates from "@/pages/action-templates";
import DataView from "@/pages/data-view";
import CommunicationsManagement from "@/pages/communications-management";
import AlertsPage from "@/pages/AlertsPage";
import ProfilePage from "@/pages/profile";
import PortalLogin from "@/pages/portal-login";
import ProspectPortal from "@/pages/portal";
import PortalMagicLogin from "@/pages/portal-magic-login";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Auth from "@/pages/auth";
import { useState, useEffect, createContext, useContext } from "react";
import { useToast } from "@/hooks/use-toast";

// Create auth context for immediate state updates
const AuthContext = createContext<{
  user: any;
  setUser: (user: any) => void;
  isLoading: boolean;
}>({
  user: null,
  setUser: () => {},
  isLoading: false,
});

// Update query client to handle auth errors
queryClient.setDefaultOptions({
  queries: {
    retry: (failureCount, error) => {
      if (isUnauthorizedError(error as Error)) {
        return false;
      }
      return failureCount < 3;
    },
  },
});

function AuthenticatedApp() {
  const { user } = useContext(AuthContext);
  const { can } = usePermissions();
  const { toast } = useToast();
  const [globalSearch, setGlobalSearch] = useState("");

  useEffect(() => {
    if (user && (user as any).firstName) {
      toast({
        title: "Welcome to CoreCRM",
        description: `Logged in as ${(user as any).firstName} ${(user as any).lastName} (${(user as any).role})`,
      });
    }
  }, [user, toast]);

  if (!user) return null;

  const getPageInfo = (pathname: string) => {
    switch (pathname) {
      case "/":
        return {
          title: "Dashboard",
          subtitle: "Overview of your payment operations"
        };
      case "/merchants":
        return {
          title: "Merchants",
          subtitle: "Manage merchant profiles and settings"
        };
      case "/locations":
        return {
          title: "Locations",
          subtitle: "Manage your business locations and addresses"
        };
      case "/agents":
        return {
          title: "Agents",
          subtitle: "Manage agent accounts and permissions"
        };
      case "/transactions":
        return {
          title: "Transactions",
          subtitle: "View and track all payment transactions"
        };
      case "/users":
        return {
          title: "User Management",
          subtitle: "Manage user accounts, roles, and permissions"
        };
      case "/reports":
        return {
          title: "Reports",
          subtitle: "Generate detailed analytics and reports"
        };
      case "/security":
        return {
          title: "Security Dashboard",
          subtitle: "Monitor login attempts and security metrics"
        };
      case "/workflows":
        return {
          title: "Workflow Definitions",
          subtitle: "Configure and manage automation workflows"
        };
      case "/pdf-forms":
        return {
          title: "PDF Forms",
          subtitle: "Upload and manage merchant application forms"
        };
      case "/application-templates":
        return {
          title: "Application Templates",
          subtitle: "Manage merchant application templates by acquirer"
        };
      case "/pdf-naming-guide":
        return {
          title: "PDF Field Naming Guide",
          subtitle: "How to name PDF form fields for automatic wizard generation"
        };
      case "/pdf-form-wizard":
        return {
          title: "Form Wizard",
          subtitle: "Complete merchant application step by step"
        };
      case "/campaigns":
        return {
          title: "Campaign Management",
          subtitle: "Manage pricing campaigns and merchant assignments"
        };
      case "/equipment":
        return {
          title: "Equipment Management",
          subtitle: "Manage payment equipment and processing devices"
        };
      case "/acquirers":
        return {
          title: "Acquirers",
          subtitle: "Manage acquirer configurations and application templates"
        };
      case "/mcc-codes":
        return {
          title: "MCC Codes",
          subtitle: "Manage merchant category codes and risk classifications"
        };
      case "/mcc-policies":
        return {
          title: "MCC Policies",
          subtitle: "Manage acquirer-specific MCC policies and restrictions"
        };
      case "/disclosure-library":
        return {
          title: "Disclosure Library",
          subtitle: "Manage disclosure definitions and versioned content"
        };
      case "/action-templates":
        return {
          title: "Action Templates",
          subtitle: "Manage email, SMS, and webhook action templates"
        };
      case "/communications":
        return {
          title: "Communications",
          subtitle: "Unified hub for managing multi-channel communications: email, SMS, webhooks, and notifications"
        };
      case "/form-demo":
        return {
          title: "Form Demo",
          subtitle: "Test the dynamic form renderer with real acquirer templates"
        };
      case "/alerts":
        return {
          title: "Alerts",
          subtitle: "System alerts and notifications"
        };
      case "/profile":
        return {
          title: "Profile",
          subtitle: "Manage your account and preferences"
        };
      case "/api-documentation":
        return {
          title: "API Documentation",
          subtitle: "Comprehensive API reference for external integrations"
        };
      default:
        return {
          title: "Dashboard",
          subtitle: "Overview of your payment operations"
        };
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/">
            {() => {
              const pageInfo = getPageInfo("/");
              return can(ACTIONS.NAV_DASHBOARD) ? (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Dashboard />
                  </main>
                </>
              ) : (
                <>
                  <Header 
                    title="Merchants" 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Merchants />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/merchants">
            {() => {
              if (!can(ACTIONS.NAV_MERCHANTS)) return <NotFound />;
              const pageInfo = getPageInfo("/merchants");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Merchants />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/locations">
            {() => {
              if (!can(ACTIONS.NAV_LOCATIONS)) return <NotFound />;
              const pageInfo = getPageInfo("/locations");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Locations />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/agents">
            {() => {
              if (!can(ACTIONS.NAV_AGENTS)) return <NotFound />;
              const pageInfo = getPageInfo("/agents");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Agents />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/transactions">
            {() => {
              if (!can(ACTIONS.NAV_TRANSACTIONS)) return <NotFound />;
              const pageInfo = getPageInfo("/transactions");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Transactions />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/users">
            {() => {
              if (!can(ACTIONS.NAV_USERS)) return <NotFound />;
              const pageInfo = getPageInfo("/users");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Users />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/reports">
            {() => {
              if (!can(ACTIONS.NAV_REPORTS)) return <NotFound />;
              const pageInfo = getPageInfo("/reports");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Reports />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/security">
            {() => {
              if (!can(ACTIONS.NAV_SECURITY)) return <NotFound />;
              const pageInfo = getPageInfo("/security");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Security />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/pdf-forms">
            {() => {
              if (!can(ACTIONS.NAV_PDF_FORMS)) return <NotFound />;
              const pageInfo = getPageInfo("/pdf-forms");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <PdfForms />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/application-templates">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/application-templates");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50 p-6">
                    <ApplicationTemplates />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/pdf-naming-guide">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/pdf-naming-guide");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50 p-6">
                    <PdfNamingGuide />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/pdf-form-wizard/:id">
            {(params) => {
              const pageInfo = getPageInfo("/pdf-form-wizard");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <PdfFormWizard />
                  </main>
                </>
              );
            }}
          </Route>

          <Route path="/form-wizard/:id">
            {(params) => {
              return (
                <main className="flex-1 overflow-hidden">
                  <EnhancedPdfWizard />
                </main>
              );
            }}
          </Route>

          <Route path="/form-application/:id">
            {(params) => {
              const pageInfo = { title: "Application Form" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <FormApplication />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/prospects">
            {() => {
              if (!can(ACTIONS.NAV_PROSPECTS)) return <NotFound />;
              const pageInfo = { title: "Merchant Prospects" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Prospects />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/agent-dashboard">
            {() => {
              if (!can(ACTIONS.NAV_AGENT_DASHBOARD)) return <NotFound />;
              const pageInfo = { title: "Agent Dashboard" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <AgentDashboard />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/application-view/:id">
            {() => {
              const pageInfo = { title: "Application View" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <ApplicationView />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/campaign-rules">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              return (
                <>
                  <Header title="Campaign Assignment Rules" onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <CampaignRulesPage />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/campaigns">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              const pageInfo = getPageInfo("/campaigns");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Campaigns />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/campaigns/:id">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              const pageInfo = { title: "Campaign Details" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Campaigns />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/campaigns/:id/edit">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              const pageInfo = { title: "Edit Campaign" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Campaigns />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/equipment">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              const pageInfo = getPageInfo("/equipment");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Equipment />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/workflows">
            {() => {
              if (!can(ACTIONS.NAV_WORKFLOWS)) return <NotFound />;
              const pageInfo = getPageInfo("/workflows");
              return (
                <>
                  <Header
                    title={pageInfo.title}
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-hidden bg-white">
                    <Workflows />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/api-documentation">
            {() => {
              if (!can(ACTIONS.NAV_API_DOCS)) return <NotFound />;
              const pageInfo = getPageInfo("/api-documentation");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <ApiDocumentation />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/underwriting-queue">
            {() => (
              <>
                <Header title="Underwriting Queue" onSearch={setGlobalSearch} />
                <main className="flex-1 overflow-auto bg-gray-50">
                  <UnderwritingQueue />
                </main>
              </>
            )}
          </Route>
          <Route path="/underwriting-review/:id">
            {() => (
              <>
                <Header title="Underwriting Review" onSearch={setGlobalSearch} />
                <main className="flex-1 overflow-auto bg-gray-50">
                  <UnderwritingReview />
                </main>
              </>
            )}
          </Route>
          <Route path="/roles-permissions">
            {() => {
              if (!can(ACTIONS.NAV_PERMISSION_MATRIX)) return <NotFound />;
              return (
                <>
                  <Header title="Roles & Permissions" onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <RolesPermissionsPage />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/testing-utilities">
            {() => {
              if (!can(ACTIONS.NAV_TESTING)) return <NotFound />;
              const pageInfo = { title: "Testing Utilities" };
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <div className="container mx-auto p-6">
                      <TestingUtilities />
                    </div>
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/acquirers">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/acquirers");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <Acquirers />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/mcc-codes">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/mcc-codes");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <MccCodes />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/mcc-policies">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/mcc-policies");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <MccPolicies />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/disclosure-library">
            {() => {
              if (!can(ACTIONS.NAV_ACQUIRERS)) return <NotFound />;
              const pageInfo = getPageInfo("/disclosure-library");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <DisclosureLibrary />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/action-templates">
            {() => {
              if (!can(ACTIONS.NAV_ACTION_TEMPLATES)) return <NotFound />;
              const pageInfo = getPageInfo("/action-templates");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <ActionTemplates />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/data-view/:templateId">
            {() => {
              if (!can(ACTIONS.NAV_DATA_VIEW)) return <NotFound />;
              return (
                <>
                  <Header title="Data View" onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <DataView />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/communications">
            {() => {
              if (!can(ACTIONS.NAV_COMMUNICATIONS)) return <NotFound />;
              const pageInfo = getPageInfo("/communications");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <CommunicationsManagement />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/form-demo">
            {() => {
              if (!can(ACTIONS.NAV_AGENTS)) return <NotFound />;
              const pageInfo = getPageInfo("/form-demo");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <FormDemo />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/alerts">
            {() => {
              const pageInfo = getPageInfo("/alerts");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <AlertsPage />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/profile">
            {() => {
              const pageInfo = getPageInfo("/profile");
              return (
                <>
                  <Header title={pageInfo.title} onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <div className="container mx-auto p-6">
                      <ProfilePage />
                    </div>
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/campaign-view/:id">
            {() => {
              if (!can(ACTIONS.NAV_CAMPAIGNS)) return <NotFound />;
              return (
                <>
                  <Header title="Campaign Details" onSearch={setGlobalSearch} />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <CampaignView />
                  </main>
                </>
              );
            }}
          </Route>
          <Route>
            <div className="flex-1">
              <NotFound />
            </div>
          </Route>
        </Switch>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser: () => {}, isLoading }}>
      <div className="min-h-screen bg-gray-50">
        <Switch>
          <Route path="/form/:token">
            {(params) => <PublicForm />}
          </Route>
          <Route path="/prospect-validation">
            {() => (
              <main className="flex-1 overflow-hidden">
                <ProspectValidation />
              </main>
            )}
          </Route>
          <Route path="/signature-request">
            {() => (
              <main className="flex-1 overflow-hidden">
                <SignatureRequest />
              </main>
            )}
          </Route>
          <Route path="/merchant-application">
            {() => (
              <main className="flex-1 overflow-hidden">
                <MerchantApplication />
              </main>
            )}
          </Route>
          <Route path="/enhanced-pdf-wizard/:id">
            {() => (
              <main className="flex-1 overflow-hidden">
                <EnhancedPdfWizard />
              </main>
            )}
          </Route>
          <Route path="/application-status/:token">
            {() => (
              <main className="flex-1 overflow-hidden">
                <ApplicationStatus />
              </main>
            )}
          </Route>
          <Route path="/portal/login">
            {() => <PortalLogin />}
          </Route>
          <Route path="/portal/magic-login">
            {() => <PortalMagicLogin />}
          </Route>
          <Route path="/portal">
            {() => <ProspectPortal />}
          </Route>
          <Route path="/application-print/:id">
            {() => <ApplicationPrint />}
          </Route>
          <Route>
            {isAuthenticated ? <AuthenticatedApp /> : <Auth />}
          </Route>
        </Switch>
      </div>
    </AuthContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;