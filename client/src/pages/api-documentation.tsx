import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Eye, EyeOff, Key, Plus, Trash2, AlertTriangle, CheckCircle, Clock, Activity, Book, Code, Shield, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ApiKey {
  id: number;
  name: string;
  keyId: string;
  organizationName?: string;
  contactEmail: string;
  permissions: string[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

interface ApiUsageStats {
  totalRequests: number;
  successfulRequests: number;
  errorRequests: number;
  averageResponseTime: number;
}

export default function ApiDocumentation() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState<Record<number, boolean>>({});
  const [formData, setFormData] = useState({
    name: "",
    organizationName: "",
    contactEmail: "",
    permissions: [] as string[],
    rateLimit: 1000,
    expiresAt: "",
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch API keys
  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['/api/admin/api-keys'],
    queryFn: async () => {
      const response = await fetch('/api/admin/api-keys', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch API keys');
      return response.json();
    }
  });

  // Available permissions
  const availablePermissions = [
    { value: 'merchants:read', label: 'Read merchant information' },
    { value: 'merchants:write', label: 'Create and update merchants' },
    { value: 'merchants:delete', label: 'Delete merchant records' },
    { value: 'agents:read', label: 'Read agent information' },
    { value: 'agents:write', label: 'Create and update agents' },
    { value: 'agents:delete', label: 'Delete agent records' },
    { value: 'transactions:read', label: 'Read transaction data' },
    { value: 'transactions:write', label: 'Create and update transactions' },
    { value: 'transactions:delete', label: 'Delete transaction records' },
    { value: 'locations:read', label: 'Read location information' },
    { value: 'locations:write', label: 'Create and update locations' },
    { value: 'locations:delete', label: 'Delete location records' },
    { value: 'prospects:read', label: 'Read prospect information' },
    { value: 'prospects:write', label: 'Create and update prospects' },
    { value: 'prospects:delete', label: 'Delete prospect records' },
    { value: 'campaigns:read', label: 'Read campaign information' },
    { value: 'campaigns:write', label: 'Create and update campaigns' },
    { value: 'campaigns:delete', label: 'Delete campaign records' },
    { value: 'equipment:read', label: 'Read equipment information' },
    { value: 'equipment:write', label: 'Create and update equipment' },
    { value: 'equipment:delete', label: 'Delete equipment records' },
    { value: '*', label: 'Full access to all endpoints' },
  ];

  // Create API key mutation
  const createApiKeyMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to create API key');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/api-keys'] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({ 
        title: "API Key Created", 
        description: `API key created successfully. Make sure to copy it now - you won't be able to see it again!`,
      });
      // Show the full API key in a modal or alert
      alert(`Your new API key: ${data.fullKey}\n\nMake sure to copy this now - you won't be able to see it again!`);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create API key", 
        variant: "destructive" 
      });
    }
  });

  // Delete API key mutation
  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/api-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete API key');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/api-keys'] });
      toast({ title: "Success", description: "API key deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete API key", variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      organizationName: "",
      contactEmail: "",
      permissions: [],
      rateLimit: 1000,
      expiresAt: "",
    });
  };

  const handlePermissionChange = (permission: string, checked: boolean) => {
    if (checked) {
      setFormData(prev => ({
        ...prev,
        permissions: [...prev.permissions, permission]
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        permissions: prev.permissions.filter(p => p !== permission)
      }));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "API key copied to clipboard" });
  };

  const toggleApiKeyVisibility = (id: number) => {
    setShowApiKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Book className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="authentication" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Authentication
          </TabsTrigger>
          <TabsTrigger value="endpoints" className="flex items-center gap-2">
            <Code className="w-4 h-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>CoreCRM API Documentation</CardTitle>
              <CardDescription>
                Comprehensive API for integrating with CoreCRM merchant management platform
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Base URL</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                      https://your-domain.replit.app/api/v1
                    </code>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Authentication</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="secondary">Bearer Token</Badge>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Response Format</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="outline">JSON</Badge>
                  </CardContent>
                </Card>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This API requires authentication via API keys. Contact your administrator to obtain API access.
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Getting Started</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Request an API key from your administrator</li>
                  <li>Include the API key in the Authorization header: <code>Bearer your_api_key</code></li>
                  <li>Make requests to the documented endpoints</li>
                  <li>Handle responses and errors appropriately</li>
                </ol>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Rate Limiting</h3>
                <p className="text-sm text-gray-600">
                  API requests are limited based on your API key configuration. Default limits apply per hour.
                  Rate limit information is included in response headers.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authentication" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Authentication</CardTitle>
              <CardDescription>
                Secure authentication using API keys with granular permissions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Authentication Method</h3>
                <p className="text-sm text-gray-600">
                  CoreCRM API uses Bearer token authentication. Include your API key in the Authorization header of every request.
                </p>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <code className="text-sm">
                    Authorization: Bearer ak_1234567890abcdef.secret_key_part
                  </code>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">API Key Format</h3>
                <p className="text-sm text-gray-600">
                  API keys consist of two parts: a public key identifier and a secret key, separated by a dot.
                </p>
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Example</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Key ID</TableCell>
                      <TableCell>Public identifier starting with "ak_"</TableCell>
                      <TableCell><code>ak_1234567890abcdef</code></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Secret</TableCell>
                      <TableCell>Private secret key for authentication</TableCell>
                      <TableCell><code>secret_key_part</code></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Permissions</h3>
                <p className="text-sm text-gray-600">
                  Each API key has specific permissions that control which endpoints and operations are allowed.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium">Read Permissions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-xs space-y-1">
                        <li>• merchants:read</li>
                        <li>• agents:read</li>
                        <li>• transactions:read</li>
                        <li>• locations:read</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium">Write Permissions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-xs space-y-1">
                        <li>• merchants:write</li>
                        <li>• agents:write</li>
                        <li>• transactions:write</li>
                        <li>• locations:write</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium">Admin Permissions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-xs space-y-1">
                        <li>• *:delete</li>
                        <li>• * (full access)</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Keep your API keys secure and never expose them in client-side code. API keys should only be used from secure server environments.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="endpoints" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Endpoints</CardTitle>
              <CardDescription>
                Complete reference for all available API endpoints
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Merchants Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Merchants</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/v1/merchants</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all merchants</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/v1/merchants/:id</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve a specific merchant by ID</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/v1/merchants</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new merchant</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">PUT</Badge>
                        <code className="text-sm">/api/v1/merchants/:id</code>
                      </div>
                      <p className="text-sm text-gray-600">Update an existing merchant</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-red-50 text-red-700">DELETE</Badge>
                        <code className="text-sm">/api/v1/merchants/:id</code>
                      </div>
                      <p className="text-sm text-gray-600">Delete a merchant</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:delete</p>
                    </div>
                  </div>
                </div>

                {/* Agents Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Agents</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/v1/agents</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all agents</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: agents:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/v1/agents/:id</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve a specific agent by ID</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: agents:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/v1/agents</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new agent</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: agents:write</p>
                    </div>
                  </div>
                </div>

                {/* Transactions Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Transactions</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/v1/transactions</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all transactions</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: transactions:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/v1/transactions</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new transaction</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: transactions:write</p>
                    </div>
                  </div>
                </div>

                {/* Campaign Management Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Campaign Management</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/campaigns</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all campaigns</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: campaigns:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/campaigns</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new campaign</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: campaigns:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/fee-groups</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all fee groups with associated fee items</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: campaigns:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/fee-items</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all fee items</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: campaigns:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/pricing-types</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all pricing types</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: campaigns:read</p>
                    </div>
                  </div>
                </div>

                {/* Dashboard Analytics Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Dashboard & Analytics</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/dashboard/metrics</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve dashboard metrics and KPIs</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/dashboard/revenue</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve revenue analytics</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: transactions:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/dashboard/recent-activity</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve recent system activity</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/dashboard/widgets</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve user's dashboard widget preferences</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                  </div>
                </div>

                {/* Location Management Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Locations</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/merchants/:merchantId/locations</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all locations for a merchant</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: locations:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/merchants/:merchantId/locations</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new location for a merchant</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: locations:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">PUT</Badge>
                        <code className="text-sm">/api/locations/:locationId</code>
                      </div>
                      <p className="text-sm text-gray-600">Update an existing location</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: locations:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-red-50 text-red-700">DELETE</Badge>
                        <code className="text-sm">/api/locations/:locationId</code>
                      </div>
                      <p className="text-sm text-gray-600">Delete a location</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: locations:delete</p>
                    </div>
                  </div>
                </div>

                {/* User Management Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">User Management</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/users</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all users</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-orange-50 text-orange-700">PATCH</Badge>
                        <code className="text-sm">/api/users/:id/role</code>
                      </div>
                      <p className="text-sm text-gray-600">Update user role</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: * (super_admin only)</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/users/:id/reset-password</code>
                      </div>
                      <p className="text-sm text-gray-600">Reset user password</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: merchants:write</p>
                    </div>
                  </div>
                </div>

                {/* Prospect Management Endpoints */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Prospects</h3>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700">GET</Badge>
                        <code className="text-sm">/api/prospects</code>
                      </div>
                      <p className="text-sm text-gray-600">Retrieve all prospects</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: prospects:read</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/prospects</code>
                      </div>
                      <p className="text-sm text-gray-600">Create a new prospect</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: prospects:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">PUT</Badge>
                        <code className="text-sm">/api/prospects/:id</code>
                      </div>
                      <p className="text-sm text-gray-600">Update an existing prospect</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: prospects:write</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">POST</Badge>
                        <code className="text-sm">/api/prospects/:id/resend-invitation</code>
                      </div>
                      <p className="text-sm text-gray-600">Resend invitation to prospect</p>
                      <p className="text-xs text-gray-500 mt-1">Required permission: prospects:write</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">API Keys</h2>
              <p className="text-gray-600">Manage API keys for external integrations</p>
            </div>
            
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create API Key
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New API Key</DialogTitle>
                  <DialogDescription>
                    Generate a new API key for external integrations
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Key Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Production Integration"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="organizationName">Organization</Label>
                      <Input
                        id="organizationName"
                        value={formData.organizationName}
                        onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })}
                        placeholder="e.g., ACME Corp"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contactEmail">Contact Email *</Label>
                      <Input
                        id="contactEmail"
                        type="email"
                        value={formData.contactEmail}
                        onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                        placeholder="contact@example.com"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="rateLimit">Rate Limit (per hour)</Label>
                      <Input
                        id="rateLimit"
                        type="number"
                        value={formData.rateLimit}
                        onChange={(e) => setFormData({ ...formData, rateLimit: parseInt(e.target.value) || 1000 })}
                        placeholder="1000"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="expiresAt">Expiry Date (optional)</Label>
                    <Input
                      id="expiresAt"
                      type="date"
                      value={formData.expiresAt}
                      onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Permissions</Label>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-lg p-3">
                      {availablePermissions.map((permission) => (
                        <div key={permission.value} className="flex items-center space-x-2">
                          <Checkbox
                            id={permission.value}
                            checked={formData.permissions.includes(permission.value)}
                            onCheckedChange={(checked) => handlePermissionChange(permission.value, !!checked)}
                          />
                          <label htmlFor={permission.value} className="text-sm">
                            {permission.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createApiKeyMutation.mutate(formData)}
                    disabled={createApiKeyMutation.isPending || !formData.name || !formData.contactEmail}
                  >
                    Create API Key
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Active API Keys</CardTitle>
              <CardDescription>
                Manage and monitor API keys for external integrations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading API keys...</div>
              ) : apiKeys.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No API keys found. Create your first API key to get started.
                </div>
              ) : (
                <div className="space-y-4">
                  {apiKeys.map((apiKey: ApiKey) => (
                    <div key={apiKey.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{apiKey.name}</h3>
                            {apiKey.isActive ? (
                              <Badge variant="default" className="bg-green-100 text-green-800">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </div>
                          
                          <div className="text-sm text-gray-600">
                            <p>Organization: {apiKey.organizationName || 'N/A'}</p>
                            <p>Contact: {apiKey.contactEmail}</p>
                            <p>Rate Limit: {apiKey.rateLimit} requests/hour</p>
                            {apiKey.lastUsedAt && (
                              <p>Last Used: {new Date(apiKey.lastUsedAt).toLocaleDateString()}</p>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                              {showApiKey[apiKey.id] ? `${apiKey.keyId}.*****` : `${apiKey.keyId.substring(0, 8)}...`}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleApiKeyVisibility(apiKey.id)}
                            >
                              {showApiKey[apiKey.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(apiKey.keyId)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                          
                          <div className="flex flex-wrap gap-1">
                            {apiKey.permissions.map((permission) => (
                              <Badge key={permission} variant="outline" className="text-xs">
                                {permission}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteApiKeyMutation.mutate(apiKey.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Analytics</CardTitle>
              <CardDescription>
                Monitor API usage and performance metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>API analytics and usage statistics will be displayed here.</p>
                <p className="text-sm">Coming soon...</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}