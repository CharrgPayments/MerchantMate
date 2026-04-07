import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import TestingDashboard from "@/components/TestingDashboard";
import { Trash2, RefreshCw, Database, CheckCircle, X, Server, Shield, ShieldCheck, TestTube, Settings, Play, Pause, BarChart3, FileText, AlertCircle, Clock, Copy, Terminal, ArrowLeftRight, Download, Upload, Eye, List, Bell, ClipboardCheck, FileCode, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ResetResult {
  success: boolean;
  cleared: string[];
  counts: Record<string, number>;
  message?: string;
}

interface DataSyncComparison {
  table: string;
  status: 'identical' | 'different';
  env1Count: number;
  env2Count: number;
  difference: number;
}

interface DataSyncResult {
  success: boolean;
  exportName?: string;
  tables?: number;
  totalRows?: number;
  sourceEnvironment?: string;
  targetEnvironment?: string;
  importedTables?: Array<{ table: string; rows: number }>;
  dryRun?: boolean;
  comparisons?: DataSyncComparison[];
  env1?: string;
  env2?: string;
  output?: string;
  error?: string;
}

interface ColumnInfo {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  position: number;
}

interface SchemaDriftResult {
  success: boolean;
  hasDrift: boolean;
  env1: string;
  env2: string;
  totalTables: number;
  totalColumnsEnv1: number;
  totalColumnsEnv2: number;
  missingInEnv2: ColumnInfo[];
  extraInEnv2: ColumnInfo[];
}

export default function TestingUtilities() {
  const [selectedOptions, setSelectedOptions] = useState({
    prospects: false,
    campaigns: false,
    equipment: false,
    signatures: false,
    formData: false,
  });
  const [lastResult, setLastResult] = useState<ResetResult | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [schemaData, setSchemaData] = useState<any>(null);
  
  // Data Sync State
  const [dataSyncResult, setDataSyncResult] = useState<DataSyncResult | null>(null);
  const [showDataSyncModal, setShowDataSyncModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('development');
  const [selectedTarget, setSelectedTarget] = useState<string>('test');
  const [selectedExport, setSelectedExport] = useState<string>('');
  const [dryRun, setDryRun] = useState(true);
  const [clearFirst, setClearFirst] = useState(false);

  // Schema Drift State
  const [driftResult, setDriftResult] = useState<SchemaDriftResult | null>(null);
  const [showDriftModal, setShowDriftModal] = useState(false);
  const [driftEnv1, setDriftEnv1] = useState<string>('development');
  const [driftEnv2, setDriftEnv2] = useState<string>('test');

  // Manual Test Cases State
  const [checkedTests, setCheckedTests] = useState<Record<string, boolean>>({});

  // Helper function to copy text to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Query to get current database environment
  const { data: dbEnvironment } = useQuery({
    queryKey: ["/api/admin/db-environment"],
    queryFn: async () => {
      const response = await fetch("/api/admin/db-environment", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch database environment");
      return response.json();
    },
  });


  // Reset testing data mutation
  const resetDataMutation = useMutation({
    mutationFn: async (options: Record<string, boolean>) => {
      const url = "/api/admin/reset-testing-data";
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(options),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || "Failed to reset testing data");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setLastResult(data);
      setShowAuditModal(true);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
    },
  });

  // Test alerts mutation
  const testAlertsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/alerts/test', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to create test alerts');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
      toast({
        title: 'Test Alerts Created',
        description: `${data.message || '4 test alerts created successfully'}. Check the bell icon in the header to view them.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to create test alerts. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Clear all prospects mutation (legacy method)
  const clearProspectsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/clear-prospects", {
        method: "DELETE",
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || "Failed to clear prospects");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setLastResult({
        success: true,
        cleared: ["prospects", "owners", "signatures"],
        counts: { prospects: data.deleted?.prospects || 0 },
        message: data.message
      });
      setShowAuditModal(true);
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
    },
  });

  // Data Sync Queries and Mutations
  
  // Get available exports
  const { data: availableExports, refetch: refetchExports } = useQuery({
    queryKey: ["/api/testing/data-sync/exports"],
    queryFn: async () => {
      const response = await fetch("/api/testing/data-sync/exports", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch exports");
      return response.json();
    },
  });

  // Compare environments mutation
  const compareEnvironmentsMutation = useMutation({
    mutationFn: async ({ env1, env2 }: { env1: string; env2: string }) => {
      const response = await fetch(`/api/testing/data-sync/compare/${env1}/${env2}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to compare environments");
      return response.json();
    },
    onSuccess: (data) => {
      setDataSyncResult(data);
      setShowDataSyncModal(true);
    },
  });

  // Export data mutation
  const exportDataMutation = useMutation({
    mutationFn: async ({ env, tables }: { env: string; tables?: string[] }) => {
      const response = await fetch(`/api/testing/data-sync/export/${env}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tables }),
      });
      if (!response.ok) throw new Error("Failed to export data");
      return response.json();
    },
    onSuccess: (data) => {
      setDataSyncResult(data);
      setShowDataSyncModal(true);
      refetchExports();
    },
  });

  // Import data mutation
  const importDataMutation = useMutation({
    mutationFn: async ({ env, exportName, dryRun, clearFirst }: { env: string; exportName: string; dryRun: boolean; clearFirst: boolean }) => {
      const response = await fetch(`/api/testing/data-sync/import/${env}/${exportName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun, clearFirst }),
      });
      if (!response.ok) throw new Error("Failed to import data");
      return response.json();
    },
    onSuccess: (data) => {
      setDataSyncResult(data);
      setShowDataSyncModal(true);
    },
  });

  // Schema drift detection mutation
  const detectDriftMutation = useMutation({
    mutationFn: async ({ env1, env2 }: { env1: string; env2: string }) => {
      const response = await fetch(`/api/admin/schema-drift/${env1}/${env2}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to detect drift");
      return response.json() as Promise<SchemaDriftResult>;
    },
    onSuccess: (data) => {
      setDriftResult(data);
      setShowDriftModal(true);
      if (!data.hasDrift) {
        toast({
          title: "No Drift Detected",
          description: `${data.env1} and ${data.env2} schemas are perfectly synchronized!`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error Detecting Drift",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Generate fix SQL mutation
  const generateFixSQLMutation = useMutation({
    mutationFn: async ({ env1, env2 }: { env1: string; env2: string }) => {
      const response = await fetch('/api/admin/schema-drift/generate-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ env1, env2 }),
      });
      if (!response.ok) throw new Error("Failed to generate fix SQL");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Fix SQL Generated",
        description: data.migrationFile ? `Created: ${data.migrationFile}` : "SQL migration created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error Generating Fix SQL",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-sync mutation
  const autoSyncMutation = useMutation({
    mutationFn: async ({ env1, env2, includeData }: { env1: string; env2: string; includeData: boolean }) => {
      const response = await fetch('/api/admin/schema-drift/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ env1, env2, includeData }),
      });
      if (!response.ok) throw new Error("Failed to auto-sync environments");
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${variables.env1} to ${variables.env2}`,
      });
      // Re-detect drift to verify sync
      detectDriftMutation.mutate({ env1: variables.env1, env2: variables.env2 });
    },
    onError: (error) => {
      toast({
        title: "Error Syncing Environments",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOptionChange = (option: string, checked: boolean) => {
    setSelectedOptions(prev => ({
      ...prev,
      [option]: checked
    }));
  };

  const handleResetData = () => {
    const filteredOptions = Object.fromEntries(
      Object.entries(selectedOptions).filter(([_, value]) => value)
    );
    
    if (Object.keys(filteredOptions).length === 0) {
      alert("Please select at least one option to reset.");
      return;
    }
    
    resetDataMutation.mutate(filteredOptions);
  };

  const handleClearAllProspects = () => {
    if (confirm("Are you sure you want to clear ALL prospect data? This cannot be undone.")) {
      clearProspectsMutation.mutate();
    }
  };

  const resetOptions = [
    {
      key: "prospects",
      label: "Clear All Prospects",
      description: "Completely removes all prospect records from database",
      danger: true
    },
    {
      key: "signatures",
      label: "Clear Signatures Only",
      description: "Removes all prospect signatures while keeping prospects",
      danger: false
    },
    {
      key: "formData",
      label: "Reset Form Data",
      description: "Clears form data and resets all prospects to pending status",
      danger: false
    },
    {
      key: "campaigns",
      label: "Clear Campaign Assignments",
      description: "Removes prospect-campaign links while keeping campaigns",
      danger: false
    },
    {
      key: "equipment",
      label: "Clear Equipment Assignments",
      description: "Removes campaign-equipment links while keeping equipment",
      danger: false
    }
  ];

  return (
    <div className="space-y-6">
      {/* Main Tabs for Testing Features */}
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <TestTube className="h-4 w-4" />
            Test Dashboard
          </TabsTrigger>
          <TabsTrigger value="utilities" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data Utilities
          </TabsTrigger>
          <TabsTrigger value="drift" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Schema Drift
          </TabsTrigger>
          <TabsTrigger value="manual-tests" className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Manual Tests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <TestingDashboard />
        </TabsContent>

        <TabsContent value="utilities" className="space-y-6">

      {/* Current Database Environment - Read Only Display */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Database Environment
          </CardTitle>
          <CardDescription>
            Current database environment for this session. Switch environments at login screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dbEnvironment && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Current Environment: {dbEnvironment.environment}</p>
                  <p className="text-sm text-muted-foreground">{dbEnvironment.message}</p>
                </div>
                <Badge variant={dbEnvironment.isUsingCustomDB ? "secondary" : "default"}>
                  {dbEnvironment.isUsingCustomDB ? "Custom DB" : "Default"}
                </Badge>
              </div>
            </div>
          )}
          
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={async () => {
                try {
                  const response = await fetch('/api/admin/db-diagnostics', {
                    credentials: 'include',
                    mode: 'cors',
                  });
                  
                  if (response.ok) {
                    const diagnostics = await response.json();
                    console.log('🔍 Database Connection Diagnostics:');
                    console.log('Environment:', diagnostics.environment);
                    console.log('Requested:', diagnostics.requestedEnv);
                    console.log('URLs:', diagnostics.databaseUrls);
                    console.log('Current Connection:', diagnostics.currentConnection);
                    
                    alert(`Database Diagnostics:
Environment: ${diagnostics.environment}
User Count: ${diagnostics.currentConnection.userCount}
URL: ${diagnostics.currentConnection.url}

Check console for full details.`);
                  } else {
                    console.error('Failed to fetch diagnostics:', response.status);
                  }
                } catch (error) {
                  console.error('Error fetching diagnostics:', error);
                }
              }}
            >
              <Database className="mr-2 h-4 w-4" />
              Database Diagnostics
            </Button>
            
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={async () => {
                try {
                  const response = await fetch('/api/admin/schema-compare', {
                    credentials: 'include',
                    mode: 'cors',
                  });
                  
                  if (response.ok) {
                    const schemaComparison = await response.json();
                    console.log('📊 Schema Comparison Results:');
                    console.log('Available Environments:', schemaComparison.summary.availableEnvironments);
                    console.log('Unavailable Environments:', schemaComparison.summary.unavailableEnvironments);
                    console.log('Full Comparison:', schemaComparison);
                    
                    setSchemaData(schemaComparison);
                    setShowComparisonModal(true);
                    
                  } else {
                    console.error('Failed to fetch schema comparison:', response.status);
                    alert('Failed to fetch schema comparison. Check console for details.');
                  }
                } catch (error) {
                  console.error('Error fetching schema comparison:', error);
                  alert('Error fetching schema comparison. Check console for details.');
                }
              }}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Compare Schemas
            </Button>
          </div>
          
          <div className="text-xs text-muted-foreground">
            Environment selection is available at the login screen.
          </div>
        </CardContent>
      </Card>

      {/* Production warning if database environment switching is attempted */}
      {import.meta.env.PROD && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Production Database
            </CardTitle>
            <CardDescription>
              In production deployments, the application always uses the production database for security and consistency.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <ShieldCheck className="h-4 w-4" />
                <p className="font-medium">Production Mode Active</p>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Database environment switching is disabled in production builds for security. All operations use the production database.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Selective Reset Tool */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Selective Data Reset
            </CardTitle>
            <CardDescription>
              Choose specific data types to reset for targeted testing scenarios.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {resetOptions.map((option) => (
                <div key={option.key} className="flex items-start space-x-3">
                  <Checkbox
                    id={option.key}
                    checked={selectedOptions[option.key as keyof typeof selectedOptions]}
                    onCheckedChange={(checked) => 
                      handleOptionChange(option.key, checked as boolean)
                    }
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor={option.key}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                    >
                      {option.label}
                      {option.danger && <Badge variant="destructive">Destructive</Badge>}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Button 
              onClick={handleResetData}
              disabled={resetDataMutation.isPending || Object.values(selectedOptions).every(v => !v)}
              className="w-full"
            >
              {resetDataMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Resetting Data...
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Reset Selected Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Quick Actions
            </CardTitle>
            <CardDescription>
              Common testing scenarios with pre-configured options.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Button
                variant="destructive"
                onClick={handleClearAllProspects}
                disabled={clearProspectsMutation.isPending}
                className="w-full"
              >
                {clearProspectsMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear All Prospect Data
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setSelectedOptions({
                    prospects: false,
                    campaigns: false,
                    equipment: false,
                    signatures: true,
                    formData: true,
                  });
                }}
                className="w-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset for Fresh Applications
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setSelectedOptions({
                    prospects: false,
                    campaigns: true,
                    equipment: true,
                    signatures: false,
                    formData: false,
                  });
                }}
                className="w-full"
              >
                <Database className="mr-2 h-4 w-4" />
                Reset Campaign Assignments
              </Button>

              <Button
                variant="outline"
                onClick={() => testAlertsMutation.mutate()}
                disabled={testAlertsMutation.isPending}
                className="w-full"
                data-testid="button-test-alerts"
              >
                {testAlertsMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Creating Alerts...
                  </>
                ) : (
                  <>
                    <Bell className="mr-2 h-4 w-4" />
                    Create Test Alerts
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Sync Manager */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Lookup Data Synchronization
          </CardTitle>
          <CardDescription>
            Synchronize lookup table data (fee groups, equipment, email templates) between environments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="compare" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="compare" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Compare
              </TabsTrigger>
              <TabsTrigger value="export" className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Export
              </TabsTrigger>
              <TabsTrigger value="import" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Import
              </TabsTrigger>
              <TabsTrigger value="exports" className="flex items-center gap-2">
                <List className="h-4 w-4" />
                Exports
              </TabsTrigger>
            </TabsList>

            {/* Compare Tab */}
            <TabsContent value="compare" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Source Environment</label>
                  <Select value={selectedSource} onValueChange={setSelectedSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Target Environment</label>
                  <Select value={selectedTarget} onValueChange={setSelectedTarget}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={() => compareEnvironmentsMutation.mutate({ env1: selectedSource, env2: selectedTarget })}
                disabled={compareEnvironmentsMutation.isPending}
                className="w-full"
              >
                {compareEnvironmentsMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Compare Data
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Export Tab */}
            <TabsContent value="export" className="space-y-4">
              <div>
                <label className="text-sm font-medium">Source Environment</label>
                <Select value={selectedSource} onValueChange={setSelectedSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => exportDataMutation.mutate({ env: selectedSource })}
                disabled={exportDataMutation.isPending}
                className="w-full"
              >
                {exportDataMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Export Data
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Import Tab */}
            <TabsContent value="import" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Target Environment</label>
                  <Select value={selectedTarget} onValueChange={setSelectedTarget}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Export to Import</label>
                  <Select value={selectedExport} onValueChange={setSelectedExport}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select export..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableExports?.exports?.map((exportName: string) => (
                        <SelectItem key={exportName} value={exportName}>
                          {exportName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox id="dry-run" checked={dryRun} onCheckedChange={(checked) => setDryRun(checked as boolean)} />
                  <label htmlFor="dry-run" className="text-sm font-medium">
                    Dry Run (Preview changes only)
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="clear-first" checked={clearFirst} onCheckedChange={(checked) => setClearFirst(checked as boolean)} />
                  <label htmlFor="clear-first" className="text-sm font-medium">
                    Clear existing data first
                  </label>
                </div>
              </div>

              <Button
                onClick={() => importDataMutation.mutate({ 
                  env: selectedTarget, 
                  exportName: selectedExport, 
                  dryRun, 
                  clearFirst 
                })}
                disabled={importDataMutation.isPending || !selectedExport}
                className="w-full"
              >
                {importDataMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {dryRun ? 'Previewing...' : 'Importing...'}
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {dryRun ? 'Preview Import' : 'Import Data'}
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Exports List Tab */}
            <TabsContent value="exports" className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium">Available Exports</h4>
                {availableExports?.exports?.length ? (
                  <div className="grid gap-2">
                    {availableExports.exports.map((exportName: string) => (
                      <div key={exportName} className="flex items-center justify-between p-3 border rounded-lg">
                        <span className="font-mono text-sm">{exportName}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedExport(exportName)}
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No exports available</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Result Display */}
      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Last Operation Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">{lastResult.message || "Operation completed successfully"}</p>
                  {lastResult.cleared.length > 0 && (
                    <div>
                      <p className="text-sm font-medium">Data cleared:</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lastResult.cleared.map((item) => (
                          <Badge key={item} variant="outline">{item}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.keys(lastResult.counts).length > 0 && (
                    <div>
                      <p className="text-sm font-medium">Records affected:</p>
                      <div className="text-xs text-muted-foreground">
                        {Object.entries(lastResult.counts).map(([key, value]) => (
                          <span key={key} className="mr-3">{key}: {value}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Audit Modal */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Data Reset Complete
            </DialogTitle>
            <DialogDescription>
              The following data has been successfully removed from the database:
            </DialogDescription>
          </DialogHeader>
          
          {lastResult && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-center">
                  {lastResult.message || "Operation completed successfully"}
                </p>
              </div>

              {/* Audit Table */}
              {Object.keys(lastResult.counts).length > 0 && (
                <div>
                  <h4 className="font-medium mb-3">Records Removed:</h4>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Table Name</TableHead>
                          <TableHead className="text-right">Rows Deleted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(lastResult.counts).map(([tableName, count]) => (
                          <TableRow key={tableName}>
                            <TableCell className="font-medium">{tableName}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline">{count}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Categories Cleared */}
              {lastResult.cleared.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Data Categories Cleared:</h4>
                  <div className="flex flex-wrap gap-1">
                    {lastResult.cleared.map((item) => (
                      <Badge key={item} variant="secondary">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => setShowAuditModal(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Schema Comparison Modal */}
      <Dialog open={showComparisonModal} onOpenChange={setShowComparisonModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Schema Comparison
            </DialogTitle>
            <DialogDescription>
              Compare database schemas across environments to identify differences
            </DialogDescription>
          </DialogHeader>
          
          {schemaData && (
            <div className="space-y-6">
              {/* Environment Status */}
              <div className="grid grid-cols-3 gap-4">
                {['production', 'development', 'test'].map((env) => {
                  const schema = schemaData.schemas[env];
                  const tableCount = schema?.available ? 
                    Array.from(new Set(schema.tables.map((t: any) => t.table_name))).length : 0;
                  
                  return (
                    <div key={env} className="p-4 border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${schema?.available ? 'bg-green-500' : 'bg-red-500'}`} />
                        <h3 className="font-medium capitalize">{env}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {schema?.available ? `${tableCount} tables` : 'Unavailable'}
                      </p>
                      {schema?.error && (
                        <p className="text-xs text-red-600 mt-1">{schema.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Migration Workflow Notice */}
              <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="font-medium text-blue-900 dark:text-blue-100">Schema Management</h3>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Schema synchronization has been replaced with a bulletproof migration workflow. 
                  Use the migration commands to safely manage schema changes across environments.
                </p>
                <div className="bg-gray-900 dark:bg-gray-800 p-3 rounded font-mono text-sm text-green-400 overflow-x-auto">
                  tsx scripts/migration-manager.ts status
                </div>
              </div>

              {/* Schema Differences */}
              <div className="space-y-4">
                <h3 className="font-medium">Schema Differences</h3>
                {Object.entries(schemaData.comparisons).map(([comparison, differences]) => {
                  if (!differences) return null;
                  
                  const diff = differences as any;
                  const totalDiffs = diff.missingTables.length + diff.extraTables.length + diff.columnDifferences.length;
                  
                  if (totalDiffs === 0) return null;
                  
                  return (
                    <div key={comparison} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-2 capitalize">
                        {comparison.replace('-vs-', ' vs ').replace('-', ' ')}
                      </h4>
                      
                      {diff.missingTables.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-medium text-orange-600 mb-2">Missing Tables:</p>
                          <div className="space-y-3">
                            {diff.missingTables.map((tableItem: any, index: number) => {
                              const tableName = typeof tableItem === 'string' ? tableItem : tableItem.table;
                              const commands = tableItem.recommendedCommands || [];
                              
                              return (
                                <div key={index} className="border rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
                                  <div className="flex items-center justify-between mb-2">
                                    <Badge variant="destructive">{tableName}</Badge>
                                    <Badge variant="outline" className="text-xs">Missing Table</Badge>
                                  </div>
                                  
                                  {commands.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                                        Recommended Commands:
                                      </p>
                                      <div className="space-y-1">
                                        {commands.map((cmd: any, cmdIndex: number) => (
                                          <div key={cmdIndex} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border text-xs">
                                            <Terminal className="h-3 w-3 text-gray-500" />
                                            <code className="flex-1 font-mono text-xs">{cmd.command}</code>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-6 w-6 p-0"
                                              onClick={() => copyToClipboard(cmd.command)}
                                              title="Copy command"
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {diff.extraTables.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-medium text-blue-600 mb-2">Extra Tables:</p>
                          <div className="space-y-3">
                            {diff.extraTables.map((tableItem: any, index: number) => {
                              const tableName = typeof tableItem === 'string' ? tableItem : tableItem.table;
                              const commands = tableItem.recommendedCommands || [];
                              
                              return (
                                <div key={index} className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-900/20">
                                  <div className="flex items-center justify-between mb-2">
                                    <Badge variant="secondary">{tableName}</Badge>
                                    <Badge variant="outline" className="text-xs">Extra Table</Badge>
                                  </div>
                                  
                                  {commands.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                                        Recommended Commands:
                                      </p>
                                      <div className="space-y-1">
                                        {commands.map((cmd: any, cmdIndex: number) => (
                                          <div key={cmdIndex} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border text-xs">
                                            <Terminal className="h-3 w-3 text-gray-500" />
                                            <code className="flex-1 font-mono text-xs">{cmd.command}</code>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-6 w-6 p-0"
                                              onClick={() => copyToClipboard(cmd.command)}
                                              title="Copy command"
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {diff.columnDifferences.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-yellow-600 mb-3">
                            Column Differences ({diff.columnDifferences.length}):
                          </p>
                          <div className="space-y-3">
                            {diff.columnDifferences.map((colDiff: any, index: number) => (
                              <div key={index} className="border rounded-lg p-3 bg-yellow-50 dark:bg-yellow-900/20">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex-1">
                                    <div className="font-mono text-sm">
                                      <span className="font-medium">{colDiff.table}</span>
                                      <span className="text-gray-500">.</span>
                                      <span className="text-blue-600 dark:text-blue-400">{colDiff.column}</span>
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                      {colDiff.details.data_type}
                                      {colDiff.details.is_nullable === 'NO' && (
                                        <span className="ml-2 text-red-600">NOT NULL</span>
                                      )}
                                      {colDiff.details.column_default && (
                                        <span className="ml-2 text-green-600">DEFAULT: {colDiff.details.column_default}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="ml-2">
                                    {colDiff.type === 'missing_in_target' && (
                                      <Badge variant="destructive" className="text-xs">Missing in Dev</Badge>
                                    )}
                                    {colDiff.type === 'extra_in_target' && (
                                      <Badge variant="secondary" className="text-xs">Extra in Dev</Badge>
                                    )}
                                    {colDiff.type === 'different_in_target' && (
                                      <Badge variant="outline" className="text-xs">Different</Badge>
                                    )}
                                  </div>
                                </div>
                                
                                {colDiff.recommendedCommands && colDiff.recommendedCommands.length > 0 && (
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                                      Recommended Commands:
                                    </p>
                                    <div className="space-y-1">
                                      {colDiff.recommendedCommands.map((cmd: any, cmdIndex: number) => (
                                        <div key={cmdIndex} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border text-xs">
                                          <Terminal className="h-3 w-3 text-gray-500" />
                                          <code className="flex-1 font-mono text-xs">{cmd.command}</code>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0"
                                            onClick={() => copyToClipboard(cmd.command)}
                                            title="Copy command"
                                          >
                                            <Copy className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>



              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  onClick={() => setShowComparisonModal(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>



      {/* Audit Modal */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Data Reset Complete
            </DialogTitle>
            <DialogDescription>
              The following data has been successfully removed from the database:
            </DialogDescription>
          </DialogHeader>
          
          {lastResult && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-center">
                  {lastResult.message || "Operation completed successfully"}
                </p>
              </div>

              {/* Audit Table */}
              {Object.keys(lastResult.counts).length > 0 && (
                <div>
                  <h4 className="font-medium mb-3">Records Removed:</h4>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Table Name</TableHead>
                          <TableHead className="text-right">Rows Deleted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(lastResult.counts).map(([tableName, count]) => (
                          <TableRow key={tableName}>
                            <TableCell className="font-medium">{tableName}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline">{count}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Categories Cleared */}
              {lastResult.cleared.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Data Categories Cleared:</h4>
                  <div className="flex flex-wrap gap-1">
                    {lastResult.cleared.map((item) => (
                      <Badge key={item} variant="secondary">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => setShowAuditModal(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Data Sync Results Modal */}
      <Dialog open={showDataSyncModal} onOpenChange={setShowDataSyncModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Data Sync Results
            </DialogTitle>
            <DialogDescription>
              Results from your data synchronization operation.
            </DialogDescription>
          </DialogHeader>
          
          {dataSyncResult && (
            <div className="space-y-4">
              {/* Operation Summary */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {dataSyncResult.success ? '✅ Operation Successful' : '❌ Operation Failed'}
                  </p>
                  {dataSyncResult.dryRun && (
                    <Badge variant="outline">Dry Run</Badge>
                  )}
                </div>
                {dataSyncResult.error && (
                  <p className="text-sm text-red-600 mt-2">{dataSyncResult.error}</p>
                )}
              </div>

              {/* Export Results */}
              {dataSyncResult.exportName && (
                <div>
                  <h4 className="font-medium mb-2">Export Details</h4>
                  <div className="space-y-2 text-sm">
                    <p><strong>Export Name:</strong> {dataSyncResult.exportName}</p>
                    <p><strong>Source:</strong> {dataSyncResult.sourceEnvironment}</p>
                    <p><strong>Tables:</strong> {dataSyncResult.tables}</p>
                    <p><strong>Total Rows:</strong> {dataSyncResult.totalRows}</p>
                  </div>
                </div>
              )}

              {/* Import Results */}
              {dataSyncResult.importedTables && (
                <div>
                  <h4 className="font-medium mb-2">Import Details</h4>
                  <div className="space-y-2 text-sm">
                    <p><strong>Target:</strong> {dataSyncResult.targetEnvironment}</p>
                    <p><strong>Total Rows:</strong> {dataSyncResult.totalRows}</p>
                    {dataSyncResult.importedTables.length > 0 && (
                      <div>
                        <p className="font-medium mt-2">Imported Tables:</p>
                        <div className="grid gap-2 mt-1">
                          {dataSyncResult.importedTables.map((table) => (
                            <div key={table.table} className="flex justify-between items-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
                              <span>{table.table}</span>
                              <Badge variant="outline">{table.rows} rows</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Comparison Results */}
              {dataSyncResult.comparisons && (
                <div>
                  <h4 className="font-medium mb-2">Environment Comparison</h4>
                  <div className="space-y-2 text-sm">
                    <p><strong>Comparing:</strong> {dataSyncResult.env1} vs {dataSyncResult.env2}</p>
                    <div className="grid gap-2 mt-2">
                      {dataSyncResult.comparisons.map((comp) => (
                        <div key={comp.table} className="flex justify-between items-center p-2 border rounded">
                          <span>{comp.table}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{comp.env1Count} | {comp.env2Count}</span>
                            <Badge variant={comp.status === 'identical' ? 'secondary' : 'destructive'}>
                              {comp.status === 'identical' ? 'Identical' : `Diff: ${comp.difference}`}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={() => setShowDataSyncModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

        </TabsContent>

        {/* Schema Drift Detection Tab */}
        <TabsContent value="drift" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Schema Drift Detection
              </CardTitle>
              <CardDescription>
                Compare database schemas across environments to detect and resolve drift
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Environment Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Source Environment</label>
                  <Select value={driftEnv1} onValueChange={setDriftEnv1}>
                    <SelectTrigger data-testid="select-drift-env1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Target Environment</label>
                  <Select value={driftEnv2} onValueChange={setDriftEnv2}>
                    <SelectTrigger data-testid="select-drift-env2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="development">Development</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Detect Drift Button */}
              <Button
                onClick={() => detectDriftMutation.mutate({ env1: driftEnv1, env2: driftEnv2 })}
                disabled={detectDriftMutation.isPending || driftEnv1 === driftEnv2}
                className="w-full"
                data-testid="button-detect-drift"
              >
                {detectDriftMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Detecting Drift...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Detect Schema Drift
                  </>
                )}
              </Button>

              {driftEnv1 === driftEnv2 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Please select different environments to compare
                  </AlertDescription>
                </Alert>
              )}

              {/* Quick Info Card */}
              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">What is Schema Drift?</h3>
                <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                  Schema drift occurs when database structures don't match across environments. This can happen when:
                </p>
                <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                  <li>Changes are made directly in the database instead of through schema.ts</li>
                  <li>Environments are out of sync due to failed promotions</li>
                  <li>Manual SQL commands are run bypassing the standard workflow</li>
                </ul>
                <div className="mt-3 p-3 bg-gray-900 dark:bg-gray-800 rounded font-mono text-xs text-green-400">
                  tsx scripts/schema-drift-simple.ts
                </div>
              </div>

              {/* Current Status Summary */}
              {driftResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {driftResult.hasDrift ? (
                        <>
                          <AlertCircle className="h-5 w-5 text-orange-500" />
                          Drift Detected
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          No Drift
                        </>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold">{driftResult.totalTables}</div>
                        <div className="text-sm text-muted-foreground">Total Tables</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold">{driftResult.totalColumnsEnv1}</div>
                        <div className="text-sm text-muted-foreground capitalize">{driftResult.env1} Columns</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold">{driftResult.totalColumnsEnv2}</div>
                        <div className="text-sm text-muted-foreground capitalize">{driftResult.env2} Columns</div>
                      </div>
                    </div>
                    
                    {driftResult.hasDrift && (
                      <div className="mt-4 space-y-3">
                        <div className="flex gap-2">
                          <Badge variant="destructive" className="flex-1 justify-center">
                            {driftResult.missingInEnv2.length} Missing in {driftResult.env2}
                          </Badge>
                          <Badge variant="outline" className="flex-1 justify-center">
                            {driftResult.extraInEnv2.length} Extra in {driftResult.env2}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => generateFixSQLMutation.mutate({ env1: driftResult.env1, env2: driftResult.env2 })}
                            disabled={generateFixSQLMutation.isPending}
                            data-testid="button-generate-fix-sql"
                          >
                            {generateFixSQLMutation.isPending ? (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <FileCode className="mr-1 h-3 w-3" />
                                Generate Fix SQL
                              </>
                            )}
                          </Button>
                          
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Auto-sync will copy schema from ${driftResult.env1} to ${driftResult.env2}. Continue?`)) {
                                autoSyncMutation.mutate({ 
                                  env1: driftResult.env1, 
                                  env2: driftResult.env2, 
                                  includeData: false 
                                });
                              }
                            }}
                            disabled={autoSyncMutation.isPending}
                            data-testid="button-auto-sync"
                          >
                            {autoSyncMutation.isPending ? (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                Syncing...
                              </>
                            ) : (
                              <>
                                <ArrowRightLeft className="mr-1 h-3 w-3" />
                                Auto-Sync
                              </>
                            )}
                          </Button>
                        </div>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDriftModal(true)}
                          className="w-full"
                          data-testid="button-view-drift-details"
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          View Detailed Analysis
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Test Cases Tab */}
        <TabsContent value="manual-tests" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Communication Management Test Cases
              </CardTitle>
              <CardDescription>
                Complete these manual tests before deployment to verify all communication features
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Email Templates Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Email Templates (Action Templates - Email Type)</h3>
                
                <div className="space-y-2 border-l-2 border-blue-500 pl-4">
                  <h4 className="font-medium">Test Case 1: Create Email Template</h4>
                  {['Navigate to Communication Management → Email Templates tab',
                    'Click "New Template" button',
                    'Fill in template name (e.g., "Welcome Email")',
                    'Select category (e.g., "welcome")',
                    'Enter subject line with variables (e.g., "Welcome {{firstName}} {{lastName}}")',
                    'Add HTML content using the editor',
                    'Select wrapper type (notification, transactional, marketing, system, or none)',
                    'Click "Create" to save',
                    'Verify template appears in the list',
                    'Verify template shows as actionType "email"'
                  ].map((step, idx) => (
                    <div key={`tc1-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc1-${idx}`}
                        checked={checkedTests[`tc1-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc1-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-1-step-${idx}`}
                      />
                      <label htmlFor={`tc1-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-blue-500 pl-4">
                  <h4 className="font-medium">Test Case 2: Send Test Email</h4>
                  {['Find the email template you created',
                    'Click the "Test Email" button (envelope icon)',
                    'Enter your email address in the recipient field',
                    'Click "Send Test Email"',
                    'Check your inbox for the test email',
                    'Verify subject line and content are correct',
                    'Verify wrapper styling is applied'
                  ].map((step, idx) => (
                    <div key={`tc2-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc2-${idx}`}
                        checked={checkedTests[`tc2-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc2-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-2-step-${idx}`}
                      />
                      <label htmlFor={`tc2-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-blue-500 pl-4">
                  <h4 className="font-medium">Test Case 3: Edit Email Template</h4>
                  {['Click the edit button (pencil icon) on an email template',
                    'Modify the template content',
                    'Save changes',
                    'Verify changes appear in the template list',
                    'Send a test email to confirm changes'
                  ].map((step, idx) => (
                    <div key={`tc3-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc3-${idx}`}
                        checked={checkedTests[`tc3-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc3-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-3-step-${idx}`}
                      />
                      <label htmlFor={`tc3-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notification Templates Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Notification Templates (Action Templates - Notification Type)</h3>
                
                <div className="space-y-2 border-l-2 border-purple-500 pl-4">
                  <h4 className="font-medium">Test Case 4: Create Notification Template</h4>
                  {['Navigate to Communication Management → Notifications tab',
                    'Click "New Notification Template"',
                    'Enter template name (e.g., "Security Alert")',
                    'Select category (e.g., "security")',
                    'Select notification type (info, success, warning, or error)',
                    'Enter message content with variables (e.g., "Alert: {{alertType}} detected")',
                    'Add optional action URL (e.g., "/security")',
                    'Enter available variables as JSON array (e.g., ["alertType", "userName"])',
                    'Set Active to "Yes"',
                    'Click "Create Template"',
                    'Verify template appears in notifications list',
                    'Verify purple Bell icon is displayed'
                  ].map((step, idx) => (
                    <div key={`tc4-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc4-${idx}`}
                        checked={checkedTests[`tc4-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc4-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-4-step-${idx}`}
                      />
                      <label htmlFor={`tc4-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-purple-500 pl-4">
                  <h4 className="font-medium">Test Case 5: Verify Notification Template Configuration</h4>
                  {['Click edit on a notification template',
                    'Verify all fields are populated correctly',
                    'Verify notification type is saved',
                    'Verify variables are properly formatted',
                    'Make a change and save',
                    'Verify changes persist'
                  ].map((step, idx) => (
                    <div key={`tc5-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc5-${idx}`}
                        checked={checkedTests[`tc5-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc5-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-5-step-${idx}`}
                      />
                      <label htmlFor={`tc5-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Email Wrappers Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Email Wrappers</h3>
                
                <div className="space-y-2 border-l-2 border-green-500 pl-4">
                  <h4 className="font-medium">Test Case 6: Create Email Wrapper</h4>
                  {['Navigate to Communication Management → Email Wrappers tab',
                    'Click "New Wrapper"',
                    'Enter wrapper name (e.g., "Security Wrapper")',
                    'Select wrapper type (welcome, agentNotification, security, notification, or custom)',
                    'Enter description',
                    'Add header gradient CSS (e.g., "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)")',
                    'Enter header subtitle',
                    'Configure CTA button (text, URL, color)',
                    'Add custom footer HTML',
                    'Ensure "Active" is checked',
                    'Click "Save Wrapper"',
                    'Verify wrapper appears in the table'
                  ].map((step, idx) => (
                    <div key={`tc6-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc6-${idx}`}
                        checked={checkedTests[`tc6-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc6-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-6-step-${idx}`}
                      />
                      <label htmlFor={`tc6-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-green-500 pl-4">
                  <h4 className="font-medium">Test Case 7: Test Wrapper with Email</h4>
                  {['Create or edit an email template',
                    'Select the wrapper you just created',
                    'Send a test email',
                    'Verify the email uses the wrapper styling',
                    'Check header gradient, subtitle, CTA button, and footer'
                  ].map((step, idx) => (
                    <div key={`tc7-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc7-${idx}`}
                        checked={checkedTests[`tc7-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc7-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-7-step-${idx}`}
                      />
                      <label htmlFor={`tc7-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Triggers Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">System Triggers</h3>
                
                <div className="space-y-2 border-l-2 border-orange-500 pl-4">
                  <h4 className="font-medium">Test Case 8: Create System Trigger</h4>
                  {['Navigate to Communication Management → System Triggers tab',
                    'Click "New Trigger"',
                    'Select trigger event from dropdown (e.g., "user_registered")',
                    'Enter trigger name (e.g., "User Registration Flow")',
                    'Add description',
                    'Select category (user, application, merchant, agent, or system)',
                    'Set status to "Active"',
                    'Click "Create Trigger"',
                    'Verify trigger appears in the list'
                  ].map((step, idx) => (
                    <div key={`tc8-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc8-${idx}`}
                        checked={checkedTests[`tc8-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc8-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-8-step-${idx}`}
                      />
                      <label htmlFor={`tc8-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-orange-500 pl-4">
                  <h4 className="font-medium">Test Case 9: Add Sequenced Actions to Trigger</h4>
                  {['Click on the trigger you created to select it',
                    'Click "Add Action" button',
                    'Select an email template from dropdown (should show blue Mail icon)',
                    'Set sequence order to 1',
                    'Set delay to 0 seconds',
                    'Leave preferences unchecked for testing',
                    'Click "Add Action"',
                    'Verify action appears with sequence badge "1"'
                  ].map((step, idx) => (
                    <div key={`tc9-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc9-${idx}`}
                        checked={checkedTests[`tc9-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc9-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-9-step-${idx}`}
                      />
                      <label htmlFor={`tc9-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-orange-500 pl-4">
                  <h4 className="font-medium">Test Case 10: Add Multiple Action Types (Email → Notification → Email)</h4>
                  {['With a trigger selected, click "Add Action" again',
                    'Select a notification template (should show purple Bell icon)',
                    'Set sequence order to 2',
                    'Set delay to 5 seconds',
                    'Click "Add Action"',
                    'Verify action appears with sequence badge "2"',
                    'Click "Add Action" again',
                    'Select a different email template',
                    'Set sequence order to 3',
                    'Set delay to 10 seconds',
                    'Click "Add Action"',
                    'Verify action appears with sequence badge "3"',
                    'Verify all 3 actions are displayed in correct order (1, 2, 3)',
                    'Verify visual differentiation (email = blue Mail, notification = purple Bell)'
                  ].map((step, idx) => (
                    <div key={`tc10-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc10-${idx}`}
                        checked={checkedTests[`tc10-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc10-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-10-step-${idx}`}
                      />
                      <label htmlFor={`tc10-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-orange-500 pl-4">
                  <h4 className="font-medium">Test Case 11: Test Action Preferences and Retry Settings</h4>
                  {['Edit an existing trigger action',
                    'Check "Requires email preference"',
                    'Check "Retry on failure"',
                    'Set max retries to 5',
                    'Save changes',
                    'Verify settings are saved correctly'
                  ].map((step, idx) => (
                    <div key={`tc11-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc11-${idx}`}
                        checked={checkedTests[`tc11-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc11-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-11-step-${idx}`}
                      />
                      <label htmlFor={`tc11-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* New Trigger Events Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">New Trigger Events</h3>
                
                <div className="space-y-2 border-l-2 border-indigo-500 pl-4">
                  <h4 className="font-medium">Test Case 12: Verify New Trigger Events in Template Guide</h4>
                  {['Navigate to Communication Management → Template Guide tab',
                    'Scroll to "Available Trigger Events" section',
                    'Verify "email_verification_requested" is documented',
                    'Confirm it shows "Security Events" badge',
                    'Verify description: "Fired when a user needs to verify their email address"',
                    'Check available variables: email, verificationLink, firstName, lastName, userName',
                    'Verify "two_factor_requested" is documented',
                    'Confirm it shows "Security Events" badge',
                    'Verify description: "Fired when a user requests two-factor authentication code"',
                    'Check available variables: email, twoFactorCode, firstName, lastName, userName, expiresIn'
                  ].map((step, idx) => (
                    <div key={`tc12-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc12-${idx}`}
                        checked={checkedTests[`tc12-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc12-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-12-step-${idx}`}
                      />
                      <label htmlFor={`tc12-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-l-2 border-indigo-500 pl-4">
                  <h4 className="font-medium">Test Case 13: Use New Trigger Events</h4>
                  {['Navigate to System Triggers tab',
                    'Click "New Trigger"',
                    'Open trigger event dropdown',
                    'Verify "Email Verification Requested" appears in options',
                    'Verify "Two Factor Requested" appears in options',
                    'Select "Email Verification Requested"',
                    'Complete trigger creation',
                    'Verify trigger is created with correct event'
                  ].map((step, idx) => (
                    <div key={`tc13-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc13-${idx}`}
                        checked={checkedTests[`tc13-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc13-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-13-step-${idx}`}
                      />
                      <label htmlFor={`tc13-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Communication Activity Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Communication Activity</h3>
                
                <div className="space-y-2 border-l-2 border-teal-500 pl-4">
                  <h4 className="font-medium">Test Case 14: View Communication Activity</h4>
                  {['Navigate to Communication Management → Communication Activity tab',
                    'Verify activity log is displayed',
                    'Check email delivery status (pending, sent, delivered, opened, clicked, failed)',
                    'Test filtering by status',
                    'Test searching by recipient email',
                    'Verify sent timestamps are displayed',
                    'Check for opened/clicked timestamps if available'
                  ].map((step, idx) => (
                    <div key={`tc14-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc14-${idx}`}
                        checked={checkedTests[`tc14-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc14-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-14-step-${idx}`}
                      />
                      <label htmlFor={`tc14-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Template Usage Tracking Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Template Usage Tracking</h3>
                
                <div className="space-y-2 border-l-2 border-pink-500 pl-4">
                  <h4 className="font-medium">Test Case 15: Verify Template Usage Indicators</h4>
                  {['Create an email template',
                    'Associate it with a trigger action',
                    'Navigate back to Email Templates tab',
                    'Find the template in the list',
                    'Verify "Used in Triggers" column shows the trigger name(s)',
                    'Hover over the badge to see trigger details',
                    'Try to delete a template that\'s in use',
                    'Verify warning message appears listing triggers using the template'
                  ].map((step, idx) => (
                    <div key={`tc15-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc15-${idx}`}
                        checked={checkedTests[`tc15-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc15-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-15-step-${idx}`}
                      />
                      <label htmlFor={`tc15-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* End-to-End Integration Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Integration Testing</h3>
                
                <div className="space-y-2 border-l-2 border-red-500 pl-4">
                  <h4 className="font-medium">Test Case 16: End-to-End Communication Flow</h4>
                  {['Create an email wrapper',
                    'Create an email template using that wrapper',
                    'Create a notification template',
                    'Create a system trigger (e.g., "user_registered")',
                    'Add sequenced actions: Email → Notification → Email',
                    'Verify entire flow is configured correctly',
                    'Check Template Guide for correct variable documentation',
                    'Send test email to verify wrapper and template work together'
                  ].map((step, idx) => (
                    <div key={`tc16-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`tc16-${idx}`}
                        checked={checkedTests[`tc16-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`tc16-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-test-case-16-step-${idx}`}
                      />
                      <label htmlFor={`tc16-${idx}`} className="text-sm cursor-pointer">{step}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary Checklist */}
              <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                <h3 className="text-lg font-semibold mb-3">✅ Communication Management Test Summary</h3>
                <p className="text-sm text-muted-foreground mb-3">Before deploying communication features, ensure:</p>
                <div className="space-y-2">
                  {[
                    'All email templates create successfully and send test emails',
                    'All notification templates save with correct configuration',
                    'Email wrappers apply styling correctly to emails',
                    'System triggers can be created with all available events',
                    'Trigger actions can be sequenced in correct order (1, 2, 3...)',
                    'Different action types can be mixed (email, notification)',
                    'Visual indicators work (blue Mail icon for email, purple Bell for notification)',
                    'New trigger events (email_verification_requested, two_factor_requested) are documented',
                    'Template Guide shows all available variables for each trigger event',
                    'Communication Activity tab displays email tracking correctly',
                    'Template usage indicators prevent accidental deletion of active templates',
                    'Page title shows "Communication Management" instead of "Email Management"'
                  ].map((item, idx) => (
                    <div key={`summary-${idx}`} className="flex items-center gap-2">
                      <Checkbox 
                        id={`summary-${idx}`}
                        checked={checkedTests[`summary-${idx}`] || false}
                        onCheckedChange={(checked) => setCheckedTests({...checkedTests, [`summary-${idx}`]: checked as boolean})}
                        data-testid={`checkbox-summary-${idx}`}
                      />
                      <label htmlFor={`summary-${idx}`} className="text-sm cursor-pointer">{item}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Progress Indicator */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Overall Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {Object.values(checkedTests).filter(Boolean).length} / {Object.keys(checkedTests).length} completed
                  </span>
                </div>
                <Progress 
                  value={(Object.values(checkedTests).filter(Boolean).length / Object.keys(checkedTests).length) * 100 || 0} 
                  className="h-2"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Schema Drift Details Modal */}
      <Dialog open={showDriftModal} onOpenChange={setShowDriftModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Schema Drift Analysis
            </DialogTitle>
            <DialogDescription>
              Detailed comparison of database schemas between {driftResult?.env1} and {driftResult?.env2}
            </DialogDescription>
          </DialogHeader>

          {driftResult && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold">{driftResult.totalTables}</div>
                    <div className="text-sm text-muted-foreground mt-1">Tables</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold">{driftResult.totalColumnsEnv1}</div>
                    <div className="text-sm text-muted-foreground mt-1 capitalize">{driftResult.env1}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-bold">{driftResult.totalColumnsEnv2}</div>
                    <div className="text-sm text-muted-foreground mt-1 capitalize">{driftResult.env2}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className={`text-3xl font-bold ${driftResult.hasDrift ? 'text-orange-500' : 'text-green-500'}`}>
                      {driftResult.hasDrift ? 'DRIFT' : 'SYNCED'}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Status</div>
                  </CardContent>
                </Card>
              </div>

              {/* Missing Columns (in env1 but not in env2) */}
              {driftResult.missingInEnv2.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-orange-500" />
                    Missing in {driftResult.env2} ({driftResult.missingInEnv2.length} columns)
                  </h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-orange-50 dark:bg-orange-950/30">
                          <TableHead>Table</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Nullable</TableHead>
                          <TableHead>Default</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          // Group by table
                          const byTable = driftResult.missingInEnv2.reduce((acc, col) => {
                            if (!acc[col.tableName]) acc[col.tableName] = [];
                            acc[col.tableName].push(col);
                            return acc;
                          }, {} as Record<string, ColumnInfo[]>);

                          return Object.entries(byTable).map(([tableName, columns]) => (
                            columns.map((col, idx) => (
                              <TableRow key={`${tableName}-${col.columnName}`}>
                                <TableCell className="font-medium">
                                  {idx === 0 ? tableName : ''}
                                </TableCell>
                                <TableCell>{col.columnName}</TableCell>
                                <TableCell><Badge variant="outline">{col.dataType}</Badge></TableCell>
                                <TableCell>
                                  {col.isNullable === 'YES' ? (
                                    <Badge variant="secondary">NULL</Badge>
                                  ) : (
                                    <Badge>NOT NULL</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{col.columnDefault || '-'}</TableCell>
                              </TableRow>
                            ))
                          ));
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Extra Columns (in env2 but not in env1) */}
              {driftResult.extraInEnv2.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <X className="h-5 w-5 text-red-500" />
                    Extra in {driftResult.env2} ({driftResult.extraInEnv2.length} columns)
                  </h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-red-50 dark:bg-red-950/30">
                          <TableHead>Table</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Nullable</TableHead>
                          <TableHead>Default</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          // Group by table
                          const byTable = driftResult.extraInEnv2.reduce((acc, col) => {
                            if (!acc[col.tableName]) acc[col.tableName] = [];
                            acc[col.tableName].push(col);
                            return acc;
                          }, {} as Record<string, ColumnInfo[]>);

                          return Object.entries(byTable).map(([tableName, columns]) => (
                            columns.map((col, idx) => (
                              <TableRow key={`${tableName}-${col.columnName}`}>
                                <TableCell className="font-medium">
                                  {idx === 0 ? tableName : ''}
                                </TableCell>
                                <TableCell>{col.columnName}</TableCell>
                                <TableCell><Badge variant="outline">{col.dataType}</Badge></TableCell>
                                <TableCell>
                                  {col.isNullable === 'YES' ? (
                                    <Badge variant="secondary">NULL</Badge>
                                  ) : (
                                    <Badge>NOT NULL</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{col.columnDefault || '-'}</TableCell>
                              </TableRow>
                            ))
                          ));
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* No Drift Message */}
              {!driftResult.hasDrift && (
                <div className="p-6 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800 text-center">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-2">
                    Perfect Synchronization!
                  </h3>
                  <p className="text-green-800 dark:text-green-200">
                    {driftResult.env1} and {driftResult.env2} have identical schemas with {driftResult.totalColumnsEnv1} columns across {driftResult.totalTables} tables.
                  </p>
                </div>
              )}

              {/* Recommended Actions */}
              {driftResult.hasDrift && (
                <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Recommended Actions</h3>
                  <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-2 list-decimal list-inside">
                    <li>Update <code className="bg-blue-900/20 px-1 rounded">shared/schema.ts</code> to match {driftResult.env1}</li>
                    <li>Run <code className="bg-blue-900/20 px-1 rounded">npm run db:push</code> to apply changes</li>
                    <li>Sync to {driftResult.env2}: <code className="bg-blue-900/20 px-1 rounded">tsx scripts/sync-environments.ts {driftResult.env1.substring(0, 3)}-to-{driftResult.env2.substring(0, 4)}</code></li>
                    <li>Verify: <code className="bg-blue-900/20 px-1 rounded">tsx scripts/schema-drift-simple.ts</code></li>
                  </ol>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}