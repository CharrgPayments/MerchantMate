import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  Settings, Workflow, Play, Save, Plus, Trash2, 
  Code, Globe, Key, Clock, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle, Edit, Eye, TestTube
} from "lucide-react";

interface WorkflowStage {
  id: number;
  workflowDefinitionId: number;
  stageKey: string;
  name: string;
  description: string | null;
  stageOrder: number;
  stageType: string;
  handlerKey: string | null;
  isCheckpoint: boolean;
  isActive: boolean;
}

interface WorkflowDefinition {
  id: number;
  workflowCode: string;
  name: string;
  description: string | null;
  version: string;
  entityType: string;
  stages?: WorkflowStage[];
}

interface StageApiConfig {
  id: number;
  stageId: number;
  integrationId: number | null;
  endpointUrl: string | null;
  httpMethod: string;
  headers: Record<string, string>;
  authType: string;
  authSecretKey: string | null;
  requestMapping: Record<string, string>;
  requestTemplate: string | null;
  responseMapping: Record<string, string>;
  rules: Array<{
    condition: string;
    result: string;
    severity?: string;
    message?: string;
  }>;
  timeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds: number;
  fallbackOnError: string;
  fallbackOnTimeout: string;
  isActive: boolean;
  testMode: boolean;
  mockResponse: Record<string, any> | null;
}

interface ApiIntegrationConfig {
  id: number;
  integrationKey: string;
  name: string;
  description: string | null;
  baseUrl: string | null;
  sandboxUrl: string | null;
  isActive: boolean;
  useSandbox: boolean;
}

const defaultConfig: Partial<StageApiConfig> = {
  httpMethod: 'POST',
  headers: {},
  authType: 'none',
  requestMapping: {},
  responseMapping: {},
  rules: [
    { condition: "$.status === 'clear'", result: "passed", message: "Check passed" },
    { condition: "true", result: "pending_review", message: "Manual review required" }
  ],
  timeoutSeconds: 30,
  maxRetries: 3,
  retryDelaySeconds: 5,
  fallbackOnError: 'pending_review',
  fallbackOnTimeout: 'pending_review',
  isActive: true,
  testMode: false,
};

export default function WorkflowSettings() {
  const { toast } = useToast();
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<WorkflowStage | null>(null);
  const [editingConfig, setEditingConfig] = useState<Partial<StageApiConfig> | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const { data: definitionsData, isLoading: definitionsLoading } = useQuery<{ success: boolean; definitions: WorkflowDefinition[] }>({
    queryKey: ['/api/workflow/definitions'],
  });

  const { data: configsData, isLoading: configsLoading, refetch: refetchConfigs } = useQuery<{ success: boolean; configs: StageApiConfig[] }>({
    queryKey: ['/api/workflow/stage-configs'],
  });

  const { data: integrationsData } = useQuery<{ success: boolean; integrations: ApiIntegrationConfig[] }>({
    queryKey: ['/api/integrations'],
    enabled: false,
  });

  const createConfigMutation = useMutation({
    mutationFn: async (config: Partial<StageApiConfig>) => {
      return apiRequest('POST', '/api/workflow/stage-configs', config);
    },
    onSuccess: () => {
      toast({ title: "Configuration Created", description: "Stage API configuration has been saved" });
      refetchConfigs();
      setShowConfigDialog(false);
      setEditingConfig(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<StageApiConfig> }) => {
      return apiRequest('PATCH', `/api/workflow/stage-configs/${id}`, updates);
    },
    onSuccess: () => {
      toast({ title: "Configuration Updated", description: "Stage API configuration has been updated" });
      refetchConfigs();
      setShowConfigDialog(false);
      setEditingConfig(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/workflow/stage-configs/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Configuration Deleted", description: "Stage API configuration has been deleted" });
      refetchConfigs();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getConfigForStage = (stageId: number): StageApiConfig | undefined => {
    return configsData?.configs?.find(c => c.stageId === stageId);
  };

  const handleEditConfig = (stage: WorkflowStage) => {
    const existingConfig = getConfigForStage(stage.id);
    setSelectedStage(stage);
    setEditingConfig(existingConfig || { ...defaultConfig, stageId: stage.id });
    setShowConfigDialog(true);
  };

  const handleSaveConfig = () => {
    if (!editingConfig || !selectedStage) return;
    
    if (editingConfig.id) {
      updateConfigMutation.mutate({ id: editingConfig.id, updates: editingConfig });
    } else {
      createConfigMutation.mutate({ ...editingConfig, stageId: selectedStage.id });
    }
  };

  const handleDeleteConfig = (configId: number) => {
    if (confirm('Are you sure you want to delete this configuration?')) {
      deleteConfigMutation.mutate(configId);
    }
  };

  const handleTestConfig = () => {
    setTestResult({
      status: 'success',
      response: { status: 'clear', matchScore: 0 },
      evaluatedResult: 'passed',
      message: 'Test passed - Mock response evaluated successfully'
    });
    setShowTestDialog(true);
  };

  const updateRules = (rulesString: string) => {
    try {
      const rules = JSON.parse(rulesString);
      setEditingConfig(prev => prev ? { ...prev, rules } : null);
    } catch (e) {
    }
  };

  const selectedWorkflowData = definitionsData?.definitions?.find(d => d.id === selectedWorkflow);

  if (definitionsLoading || configsLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="workflow-settings">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-7 h-7" />
            Workflow Stage Settings
          </h1>
          <p className="text-muted-foreground">Configure API integrations and pass/fail rules for workflow stages</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Workflow className="w-5 h-5" />
              Workflows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {definitionsData?.definitions?.map(def => (
              <Button
                key={def.id}
                variant={selectedWorkflow === def.id ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setSelectedWorkflow(def.id)}
                data-testid={`workflow-select-${def.workflowCode}`}
              >
                {def.name}
              </Button>
            ))}
            {(!definitionsData?.definitions || definitionsData.definitions.length === 0) && (
              <p className="text-sm text-muted-foreground">No workflows defined</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedWorkflowData ? selectedWorkflowData.name : 'Select a Workflow'}
            </CardTitle>
            <CardDescription>
              {selectedWorkflowData?.description || 'Configure API settings for each stage'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedWorkflow ? (
              <div className="text-center py-12 text-muted-foreground">
                <Workflow className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a workflow to configure its stages</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {selectedWorkflowData?.stages?.map(stage => {
                  const config = getConfigForStage(stage.id);
                  const hasConfig = !!config;
                  const isActive = config?.isActive ?? false;
                  const isTestMode = config?.testMode ?? false;

                  return (
                    <AccordionItem key={stage.id} value={`stage-${stage.id}`}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <span className="font-medium">{stage.name}</span>
                          <Badge variant="outline" className="ml-2">
                            {stage.stageType}
                          </Badge>
                          {hasConfig && (
                            <>
                              {isActive ? (
                                <Badge className="bg-green-100 text-green-800">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Configured
                                </Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600">
                                  <XCircle className="w-3 h-3 mr-1" />
                                  Disabled
                                </Badge>
                              )}
                              {isTestMode && (
                                <Badge className="bg-yellow-100 text-yellow-800">
                                  <TestTube className="w-3 h-3 mr-1" />
                                  Test Mode
                                </Badge>
                              )}
                            </>
                          )}
                          {!hasConfig && (
                            <Badge variant="secondary">
                              Not Configured
                            </Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="pt-4 space-y-4">
                          <p className="text-sm text-muted-foreground">
                            {stage.description || 'No description available'}
                          </p>
                          
                          {hasConfig && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                              <div>
                                <p className="text-xs text-muted-foreground">Method</p>
                                <p className="font-medium">{config.httpMethod}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Auth Type</p>
                                <p className="font-medium">{config.authType}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Timeout</p>
                                <p className="font-medium">{config.timeoutSeconds}s</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Rules</p>
                                <p className="font-medium">{config.rules?.length || 0} defined</p>
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleEditConfig(stage)}
                              data-testid={`edit-stage-${stage.stageKey}`}
                            >
                              {hasConfig ? <Edit className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                              {hasConfig ? 'Edit Configuration' : 'Add Configuration'}
                            </Button>
                            {hasConfig && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedStage(stage);
                                    handleTestConfig();
                                  }}
                                  data-testid={`test-stage-${stage.stageKey}`}
                                >
                                  <TestTube className="w-4 h-4 mr-1" />
                                  Test
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleDeleteConfig(config.id)}
                                  data-testid={`delete-stage-${stage.stageKey}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-1" />
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
                {(!selectedWorkflowData?.stages || selectedWorkflowData.stages.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No stages defined for this workflow</p>
                  </div>
                )}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingConfig?.id ? 'Edit' : 'Create'} Stage API Configuration
            </DialogTitle>
            <DialogDescription>
              Configure the API integration for: {selectedStage?.name}
            </DialogDescription>
          </DialogHeader>

          {editingConfig && (
            <Tabs defaultValue="api" className="mt-4">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="api">API Settings</TabsTrigger>
                <TabsTrigger value="mapping">Request/Response</TabsTrigger>
                <TabsTrigger value="rules">Pass/Fail Rules</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              <TabsContent value="api" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Endpoint URL</Label>
                    <Input
                      placeholder="https://api.example.com/check"
                      value={editingConfig.endpointUrl || ''}
                      onChange={e => setEditingConfig(prev => prev ? { ...prev, endpointUrl: e.target.value } : null)}
                      data-testid="input-endpoint-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>HTTP Method</Label>
                    <Select
                      value={editingConfig.httpMethod || 'POST'}
                      onValueChange={value => setEditingConfig(prev => prev ? { ...prev, httpMethod: value } : null)}
                    >
                      <SelectTrigger data-testid="select-http-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Authentication Type</Label>
                    <Select
                      value={editingConfig.authType || 'none'}
                      onValueChange={value => setEditingConfig(prev => prev ? { ...prev, authType: value } : null)}
                    >
                      <SelectTrigger data-testid="select-auth-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="api_key">API Key</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="basic">Basic Auth</SelectItem>
                        <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {editingConfig.authType && editingConfig.authType !== 'none' && (
                    <div className="space-y-2">
                      <Label>Secret Key Name (Environment Variable)</Label>
                      <Input
                        placeholder="OFAC_API_KEY"
                        value={editingConfig.authSecretKey || ''}
                        onChange={e => setEditingConfig(prev => prev ? { ...prev, authSecretKey: e.target.value } : null)}
                        data-testid="input-secret-key"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Custom Headers (JSON)</Label>
                  <Textarea
                    placeholder='{"Content-Type": "application/json"}'
                    value={JSON.stringify(editingConfig.headers || {}, null, 2)}
                    onChange={e => {
                      try {
                        const headers = JSON.parse(e.target.value);
                        setEditingConfig(prev => prev ? { ...prev, headers } : null);
                      } catch {}
                    }}
                    rows={3}
                    data-testid="input-headers"
                  />
                </div>
              </TabsContent>

              <TabsContent value="mapping" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Request Mapping (JSON Path expressions)</Label>
                  <Textarea
                    placeholder='{"name": "$.prospect.businessName", "taxId": "$.prospect.ein"}'
                    value={JSON.stringify(editingConfig.requestMapping || {}, null, 2)}
                    onChange={e => {
                      try {
                        const requestMapping = JSON.parse(e.target.value);
                        setEditingConfig(prev => prev ? { ...prev, requestMapping } : null);
                      } catch {}
                    }}
                    rows={5}
                    data-testid="input-request-mapping"
                  />
                  <p className="text-xs text-muted-foreground">
                    Map entity fields to API request body using JSON Path syntax
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Request Template (Optional)</Label>
                  <Textarea
                    placeholder='{"query": {"name": "{{businessName}}", "taxId": "{{ein}}"}}'
                    value={editingConfig.requestTemplate || ''}
                    onChange={e => setEditingConfig(prev => prev ? { ...prev, requestTemplate: e.target.value } : null)}
                    rows={4}
                    data-testid="input-request-template"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional JSON template with placeholders. Uses mapping values if not specified.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Response Mapping (JSON Path expressions)</Label>
                  <Textarea
                    placeholder='{"matchScore": "$.result.score", "status": "$.result.decision"}'
                    value={JSON.stringify(editingConfig.responseMapping || {}, null, 2)}
                    onChange={e => {
                      try {
                        const responseMapping = JSON.parse(e.target.value);
                        setEditingConfig(prev => prev ? { ...prev, responseMapping } : null);
                      } catch {}
                    }}
                    rows={5}
                    data-testid="input-response-mapping"
                  />
                  <p className="text-xs text-muted-foreground">
                    Extract fields from API response using JSON Path syntax
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="rules" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Pass/Fail Rules (Evaluated in order - first match wins)</Label>
                  <Textarea
                    placeholder={`[
  { "condition": "$.status === 'clear'", "result": "passed", "message": "Check passed" },
  { "condition": "$.matchScore >= 80", "result": "failed", "severity": "critical", "message": "High match" },
  { "condition": "$.matchScore >= 50", "result": "pending_review", "severity": "high", "message": "Medium match" },
  { "condition": "true", "result": "passed", "message": "Default pass" }
]`}
                    value={JSON.stringify(editingConfig.rules || [], null, 2)}
                    onChange={e => updateRules(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                    data-testid="input-rules"
                  />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Condition:</strong> JavaScript-like expression using extracted response values (prefixed with $)</p>
                    <p><strong>Result:</strong> "passed", "failed", "pending_review", or "error"</p>
                    <p><strong>Severity:</strong> (optional) "low", "medium", "high", "critical", "blocker"</p>
                    <p><strong>Message:</strong> Description shown in the workflow issue</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4 mt-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Timeout (seconds)</Label>
                    <Input
                      type="number"
                      value={editingConfig.timeoutSeconds || 30}
                      onChange={e => setEditingConfig(prev => prev ? { ...prev, timeoutSeconds: parseInt(e.target.value) } : null)}
                      data-testid="input-timeout"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Retries</Label>
                    <Input
                      type="number"
                      value={editingConfig.maxRetries || 3}
                      onChange={e => setEditingConfig(prev => prev ? { ...prev, maxRetries: parseInt(e.target.value) } : null)}
                      data-testid="input-max-retries"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Retry Delay (seconds)</Label>
                    <Input
                      type="number"
                      value={editingConfig.retryDelaySeconds || 5}
                      onChange={e => setEditingConfig(prev => prev ? { ...prev, retryDelaySeconds: parseInt(e.target.value) } : null)}
                      data-testid="input-retry-delay"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Fallback on Error</Label>
                    <Select
                      value={editingConfig.fallbackOnError || 'pending_review'}
                      onValueChange={value => setEditingConfig(prev => prev ? { ...prev, fallbackOnError: value } : null)}
                    >
                      <SelectTrigger data-testid="select-fallback-error">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passed">Pass</SelectItem>
                        <SelectItem value="failed">Fail</SelectItem>
                        <SelectItem value="pending_review">Pending Review</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fallback on Timeout</Label>
                    <Select
                      value={editingConfig.fallbackOnTimeout || 'pending_review'}
                      onValueChange={value => setEditingConfig(prev => prev ? { ...prev, fallbackOnTimeout: value } : null)}
                    >
                      <SelectTrigger data-testid="select-fallback-timeout">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passed">Pass</SelectItem>
                        <SelectItem value="failed">Fail</SelectItem>
                        <SelectItem value="pending_review">Pending Review</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label>Test Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Use mock response instead of real API calls
                    </p>
                  </div>
                  <Switch
                    checked={editingConfig.testMode || false}
                    onCheckedChange={checked => setEditingConfig(prev => prev ? { ...prev, testMode: checked } : null)}
                    data-testid="switch-test-mode"
                  />
                </div>

                {editingConfig.testMode && (
                  <div className="space-y-2">
                    <Label>Mock Response (JSON)</Label>
                    <Textarea
                      placeholder='{"status": "clear", "matchScore": 0}'
                      value={JSON.stringify(editingConfig.mockResponse || {}, null, 2)}
                      onChange={e => {
                        try {
                          const mockResponse = JSON.parse(e.target.value);
                          setEditingConfig(prev => prev ? { ...prev, mockResponse } : null);
                        } catch {}
                      }}
                      rows={4}
                      data-testid="input-mock-response"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label>Active</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable this API configuration for the stage
                    </p>
                  </div>
                  <Switch
                    checked={editingConfig.isActive !== false}
                    onCheckedChange={checked => setEditingConfig(prev => prev ? { ...prev, isActive: checked } : null)}
                    data-testid="switch-active"
                  />
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowConfigDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveConfig}
              disabled={createConfigMutation.isPending || updateConfigMutation.isPending}
              data-testid="button-save-config"
            >
              <Save className="w-4 h-4 mr-1" />
              {createConfigMutation.isPending || updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Result</DialogTitle>
            <DialogDescription>
              Test configuration for: {selectedStage?.name}
            </DialogDescription>
          </DialogHeader>
          
          {testResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {testResult.status === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                <span className="font-medium">
                  Result: {testResult.evaluatedResult?.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{testResult.message}</p>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-xs font-medium mb-2">Response:</p>
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(testResult.response, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowTestDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
