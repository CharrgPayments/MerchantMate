import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { 
  canAccessUserManagement,
  canAccessMerchantManagement, 
  canAccessAgentManagement,
  canAccessTransactionManagement,
  canAccessLocationManagement,
  canAccessAnalytics,
  canAccessReports,
  canAccessSecurityDashboard
} from "@/lib/rbac";
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
import EmailManagement from "@/pages/email-management";
import ApiDocumentation from "@/pages/api-documentation";
import TestingUtilities from "@/pages/testing-utilities";
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
      case "/email-management":
        return {
          title: "Email Management",
          subtitle: "Manage email templates and track communication activity"
        };
      case "/pdf-forms":
        return {
          title: "PDF Forms",
          subtitle: "Upload and manage merchant application forms"
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
              return canAccessAnalytics(user) ? (
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
              if (!canAccessMerchantManagement(user)) return <NotFound />;
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
              if (!canAccessLocationManagement(user)) return <NotFound />;
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
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
              if (!canAccessTransactionManagement(user)) return <NotFound />;
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
              if (!canAccessUserManagement(user)) return <NotFound />;
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
              if (!canAccessReports(user)) return <NotFound />;
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
              if (!canAccessSecurityDashboard(user)) return <NotFound />;
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
          <Route path="/email-management">
            {() => {
              if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return <NotFound />;
              const pageInfo = getPageInfo("/email-management");
              return (
                <>
                  <Header 
                    title={pageInfo.title} 
                    onSearch={setGlobalSearch}
                  />
                  <main className="flex-1 overflow-auto bg-gray-50">
                    <EmailManagement />
                  </main>
                </>
              );
            }}
          </Route>
          <Route path="/pdf-forms">
            {() => {
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
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
          <Route path="/campaigns">
            {() => {
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
              if (!canAccessAgentManagement(user)) return <NotFound />;
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
          <Route path="/api-documentation">
            {() => {
              if (!canAccessSecurityDashboard(user)) return <NotFound />;
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
          <Route path="/testing-utilities">
            {() => {
              if (!canAccessSecurityDashboard(user)) return <NotFound />;
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