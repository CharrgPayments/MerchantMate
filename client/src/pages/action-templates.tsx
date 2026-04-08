import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  Mail, 
  MessageSquare, 
  Webhook, 
  Bell, 
  MessageCircle,
  Users,
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Play,
  Database,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  ClipboardCopy,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VariablePicker } from "@/components/variable-picker";
import { WysiwygEditor } from "@/components/WysiwygEditor";
import { Send } from "lucide-react";

type ActionType = 'email' | 'sms' | 'webhook' | 'notification' | 'slack' | 'teams';
type Category = 'authentication' | 'application' | 'notification' | 'alert' | 'all' | 'welcome';

interface ActionTemplate {
  id: number;
  name: string;
  description: string | null;
  actionType: ActionType;
  category: string;
  config: any;
  variables: any;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface TemplateUsage {
  triggerId: number;
  triggerName: string;
  triggerKey: string;
  isActive: boolean;
}

// Form schemas for different action types
const emailConfigSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  htmlContent: z.string().min(1, "HTML content is required"),
  textContent: z.string().optional(),
  fromEmail: z.string().email().optional(),
  toEmail: z.string().optional(),
  ccEmails: z.string().optional(),
  bccEmails: z.string().optional(),
  useWrapper: z.boolean().optional(),
  wrapperType: z.enum(['notification', 'alert', 'marketing', 'transactional', 'custom']).optional(),
  headerGradient: z.string().optional(),
  headerSubtitle: z.string().optional(),
  ctaButtonText: z.string().optional(),
  ctaButtonUrl: z.string().optional(),
  ctaButtonColor: z.string().optional(),
  customFooter: z.string().optional(),
});

const smsConfigSchema = z.object({
  message: z.string().min(1, "Message is required"),
  toPhoneNumber: z.string().optional(),
});

const routeParamSchema = z.object({
  name: z.string(),
  defaultValue: z.string().optional(),
  description: z.string().optional(),
});

const webhookConfigSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.string().optional(),
  body: z.string().optional(),
  responseSchema: z.string().optional(),
  mockData: z.string().optional(),
  isDataSource: z.boolean().optional(),
  routeParams: z.array(routeParamSchema).optional(),
});

type RouteParam = z.infer<typeof routeParamSchema>;

const notificationConfigSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

const slackConfigSchema = z.object({
  channel: z.string().optional(),
  message: z.string().min(1, "Message is required"),
  webhookUrl: z.string().url().optional(),
});

const teamsConfigSchema = z.object({
  webhookUrl: z.string().url("Must be a valid URL"),
  message: z.string().min(1, "Message is required"),
  title: z.string().optional(),
});

// Base template schema
const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  actionType: z.enum(['email', 'sms', 'webhook', 'notification', 'slack', 'teams']),
  category: z.enum(['authentication', 'application', 'notification', 'alert', 'welcome']),
  config: z.any(),
  variables: z.string().optional(),
  isActive: z.boolean().default(true),
});

type TemplateFormData = z.infer<typeof templateFormSchema>;

const actionTypeIcons: Record<ActionType, any> = {
  email: Mail,
  sms: MessageSquare,
  webhook: Webhook,
  notification: Bell,
  slack: MessageCircle,
  teams: Users,
};

const actionTypeColors: Record<ActionType, string> = {
  email: "bg-blue-500",
  sms: "bg-green-500",
  webhook: "bg-purple-500",
  notification: "bg-orange-500",
  slack: "bg-pink-500",
  teams: "bg-indigo-500",
};

const categoryColors: Record<string, string> = {
  authentication: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  application: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  notification: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  alert: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  welcome: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  template?: ActionTemplate | null;
  mode: 'create' | 'edit';
}

function TemplateModal({ open, onClose, template, mode }: TemplateModalProps) {
  const { toast } = useToast();
  const [configFields, setConfigFields] = useState<any>({});
  const [activeFieldRef, setActiveFieldRef] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sampleData, setSampleData] = useState<Record<string, string>>({});
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const webhookUrlRef = useRef<HTMLInputElement>(null);
  const webhookHeadersRef = useRef<HTMLTextAreaElement>(null);
  const webhookBodyRef = useRef<HTMLTextAreaElement>(null);
  // Which webhook field is currently focused for secret insertion
  const [focusedWebhookField, setFocusedWebhookField] = useState<'url' | 'headers' | 'body' | null>(null);
  const [secretsExpanded, setSecretsExpanded] = useState(false);

  // Fetch available secret names (for admin/super_admin users)
  const { data: secretsData } = useQuery<{ secrets: string[] }>({
    queryKey: ['/api/admin/available-secrets'],
    staleTime: 60_000,
    retry: false,
  });
  
  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: template?.name || '',
      description: template?.description || '',
      actionType: template?.actionType || 'email',
      category: (template?.category as 'authentication' | 'application' | 'notification' | 'alert') || 'notification',
      config: template?.config || {},
      variables: template?.variables ? JSON.stringify(template.variables, null, 2) : '',
      isActive: template?.isActive ?? true,
    },
  });

  const actionType = form.watch('actionType');

  // Reset form when template changes or modal opens
  useEffect(() => {
    if (open) {
      form.reset({
        name: template?.name || '',
        description: template?.description || '',
        actionType: template?.actionType || 'email',
        category: (template?.category as 'authentication' | 'application' | 'notification' | 'alert') || 'notification',
        config: template?.config || {},
        variables: template?.variables ? JSON.stringify(template.variables, null, 2) : '',
        isActive: template?.isActive ?? true,
      });
      
      if (template?.config) {
        setConfigFields(template.config);
      } else {
        setConfigFields({});
      }
    }
  }, [open, template, form]);

  // Reset config fields when action type changes in create mode
  useEffect(() => {
    if (open && !template) {
      setConfigFields({});
    }
  }, [actionType, open, template]);

  const validateConfig = (actionType: string, config: any) => {
    try {
      switch (actionType) {
        case 'email':
          return emailConfigSchema.parse(config);
        case 'sms':
          return smsConfigSchema.parse(config);
        case 'webhook':
          return webhookConfigSchema.parse(config);
        case 'notification':
          return notificationConfigSchema.parse(config);
        case 'slack':
          return slackConfigSchema.parse(config);
        case 'teams':
          return teamsConfigSchema.parse(config);
        default:
          return config;
      }
    } catch (error: any) {
      throw new Error(`Invalid configuration: ${error.message}`);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: TemplateFormData) => {
      // Validate config
      const validatedConfig = validateConfig(data.actionType, configFields);
      
      // Parse variables safely
      let parsedVariables = null;
      if (data.variables) {
        try {
          parsedVariables = JSON.parse(data.variables);
        } catch (error) {
          throw new Error("Invalid JSON in variables field");
        }
      }
      
      const payload = {
        ...data,
        config: validatedConfig,
        variables: parsedVariables,
      };
      return apiRequest('POST', '/api/action-templates', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/action-templates'] });
      toast({
        title: "Success",
        description: "Template created successfully",
      });
      onClose();
      form.reset();
      setConfigFields({});
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create template",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: TemplateFormData) => {
      // Validate config
      const validatedConfig = validateConfig(data.actionType, configFields);
      
      // Parse variables safely
      let parsedVariables = null;
      if (data.variables) {
        try {
          parsedVariables = JSON.parse(data.variables);
        } catch (error) {
          throw new Error("Invalid JSON in variables field");
        }
      }
      
      const payload = {
        ...data,
        config: validatedConfig,
        variables: parsedVariables,
      };
      return apiRequest('PATCH', `/api/action-templates/${template?.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/action-templates'] });
      toast({
        title: "Success",
        description: "Template updated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update template",
        variant: "destructive",
      });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async ({ templateId, recipientEmail }: { templateId: number; recipientEmail: string }) => {
      return apiRequest('POST', `/api/action-templates/${templateId}/test`, { recipientEmail });
    },
    onSuccess: () => {
      toast({
        title: "Test email sent",
        description: `Test email sent to ${testEmail}`,
      });
      setShowTestDialog(false);
      setTestEmail('');
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send test email",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TemplateFormData) => {
    if (mode === 'create') {
      createMutation.mutate(data);
    } else {
      updateMutation.mutate(data);
    }
  };

  const handleTestEmail = () => {
    if (!testEmail) {
      toast({
        title: "Email required",
        description: "Please enter a recipient email address",
        variant: "destructive",
      });
      return;
    }
    if (template?.id) {
      testEmailMutation.mutate({ templateId: template.id, recipientEmail: testEmail });
    }
  };

  const handleVariableInsert = (variable: string, fieldName: string) => {
    const currentValue = configFields[fieldName] || '';
    const ref = activeFieldRef;
    
    if (ref) {
      const cursorPos = ref.selectionStart ?? currentValue.length;
      const cursorEnd = ref.selectionEnd ?? cursorPos;
      const newValue = 
        currentValue.substring(0, cursorPos) + 
        variable + 
        currentValue.substring(cursorEnd);
      
      setConfigFields({ ...configFields, [fieldName]: newValue });
      
      // Set cursor position after inserted variable
      setTimeout(() => {
        ref.focus();
        const newPos = cursorPos + variable.length;
        ref.setSelectionRange(newPos, newPos);
      }, 0);
    } else {
      // Fallback: append to end
      setConfigFields({ ...configFields, [fieldName]: currentValue + variable });
    }
  };

  // Insert {{$SECRET_NAME}} into the currently focused webhook field at cursor position
  const insertSecretRef = (secretName: string) => {
    const token = `{{$${secretName}}}`;
    type FieldEntry = { el: HTMLInputElement | HTMLTextAreaElement | null; field: string };
    const fieldMap: Record<string, FieldEntry> = {
      url: { el: webhookUrlRef.current, field: 'url' },
      headers: { el: webhookHeadersRef.current, field: 'headers' },
      body: { el: webhookBodyRef.current, field: 'body' },
    };
    const target = focusedWebhookField ? fieldMap[focusedWebhookField] : null;
    if (target?.el) {
      const el = target.el;
      const currentValue = configFields[target.field] || '';
      const cursorPos = el.selectionStart ?? currentValue.length;
      const cursorEnd = el.selectionEnd ?? cursorPos;
      const newValue = currentValue.substring(0, cursorPos) + token + currentValue.substring(cursorEnd);
      setConfigFields({ ...configFields, [target.field]: newValue });
      setTimeout(() => {
        el.focus();
        const newPos = cursorPos + token.length;
        el.setSelectionRange(newPos, newPos);
      }, 0);
    } else {
      // No focused field — copy to clipboard as fallback
      navigator.clipboard.writeText(token).then(() => {
        toast({ title: 'Copied to clipboard', description: `${token} — paste it into a field`, duration: 2000 });
      });
    }
  };

  // Detect if a string contains any {{$...}} secret references
  const containsSecretRef = (val: string | undefined): boolean => !!val && /\{\{\$[A-Z0-9_]+\}\}/.test(val);

  const renderTemplateWithData = (text: string, data: Record<string, string>): string => {
    if (!text) return '';
    
    return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedVar = varName.trim();
      return data[trimmedVar] || match;
    });
  };

  const extractVariables = (): string[] => {
    const vars = new Set<string>();
    const regex = /\{\{([^}]+)\}\}/g;
    
    Object.values(configFields).forEach(value => {
      if (typeof value === 'string') {
        let match;
        while ((match = regex.exec(value)) !== null) {
          vars.add(match[1].trim());
        }
      }
    });
    
    return Array.from(vars);
  };

  // Strip {{...}} double-brace tokens (secrets + template vars) before scanning for single-brace route params
  const stripDoubleBraceTokens = (url: string): string => url.replace(/\{\{[^{}]*\}\}/g, '');

  const extractRouteParamNames = (url: string): string[] => {
    const names: string[] = [];
    // Work on a version of the URL with all {{...}} tokens removed so they don't yield false route params
    const stripped = stripDoubleBraceTokens(url);
    const regex = /\{([^{}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(stripped)) !== null) {
      const inner = m[1].trim();
      if (inner && !names.includes(inner)) names.push(inner);
    }
    return names;
  };

  // Replace {paramName} tokens in a URL with their configured default values.
  // Double-brace tokens like {{$SECRET}} and {{variable}} are left untouched.
  const resolveUrlWithParams = (url: string, params: RouteParam[]): string => {
    if (!url || !params?.length) return url;
    // Replace only single-brace {param} patterns, not {{...}}
    return url.replace(/(?<!\{)\{(?!\{)([^{}]+)\}(?!\})/g, (_match, name: string) => {
      const p = params.find((rp) => rp.name === name.trim());
      return p?.defaultValue !== undefined && p.defaultValue !== '' ? p.defaultValue : `{${name}}`;
    });
  };

  // Keep routeParams in sync whenever the URL field changes.
  useEffect(() => {
    if (actionType !== 'webhook') return;
    const url = configFields.url || '';
    const detected = extractRouteParamNames(url);
    const existing: RouteParam[] = configFields.routeParams || [];

    // Merge: keep existing values for params that still exist; add new ones; drop removed ones
    const merged: RouteParam[] = detected.map((name) => {
      const prev = existing.find((p) => p.name === name);
      return prev ?? { name, defaultValue: '', description: '' };
    });

    // Only update state if the param list actually changed to avoid infinite loops
    const same =
      merged.length === existing.length &&
      merged.every((p, i) => p.name === existing[i]?.name);
    if (!same) {
      setConfigFields((prev: any) => ({ ...prev, routeParams: merged }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configFields.url, actionType]);

  const handlePreview = () => {
    const variables = extractVariables();
    const initialData: Record<string, string> = {};
    
    variables.forEach(v => {
      initialData[v] = sampleData[v] || `[${v}]`;
    });
    
    setSampleData(initialData);
    setShowPreview(true);
  };

  const getFieldsFromData = (data: any, prefix = ''): { key: string; type: string; preview: string }[] => {
    if (!data || typeof data !== 'object') return [];
    const fields: { key: string; type: string; preview: string }[] = [];
    for (const [k, v] of Object.entries(data)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        fields.push({ key: fullKey, type: `array[${v.length}]`, preview: v.length > 0 ? JSON.stringify(v[0]).slice(0, 60) : '[]' });
      } else if (v !== null && typeof v === 'object') {
        fields.push({ key: fullKey, type: 'object', preview: `{${Object.keys(v as object).join(', ')}}` });
      } else {
        fields.push({ key: fullKey, type: typeof v, preview: String(v).slice(0, 60) });
      }
    }
    return fields;
  };

  const runWebhookTest = async (mode: 'live' | 'mock') => {
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);
    try {
      if (mode === 'mock') {
        if (!configFields.mockData) throw new Error('No mock data configured. Add Mock Response Data and save first.');
        const parsed = JSON.parse(configFields.mockData);
        setTestResult({ data: parsed, status: 200, mode: 'mock' });
      } else {
        if (!configFields.url) throw new Error('No URL configured.');
        const resolvedUrl = resolveUrlWithParams(configFields.url, configFields.routeParams || []);
        // Warn if any unresolved single-brace {param} remain — but ignore {{$SECRET}} and {{variable}} double-brace tokens
        if (/\{[^{}]+\}/.test(stripDoubleBraceTokens(resolvedUrl))) {
          throw new Error(`URL still contains unresolved route parameters: ${resolvedUrl}. Provide default values for each parameter.`);
        }
        const response = await fetch(`/api/action-templates/${template?.id || 'preview'}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            mode: 'live',
            config: {
              url: resolvedUrl,
              method: configFields.method || 'GET',
              headers: configFields.headers,
              body: configFields.body,
            },
          }),
        });
        const json = await response.json();
        // Proxy route itself failed (auth, config error) — not the upstream
        if (!response.ok) throw new Error(json.message || `HTTP ${response.status}`);
        // Always show the result — including 4xx/5xx — so users can see the response body and debug
        setTestResult(json);
      }
    } catch (err: any) {
      setTestError(err.message || 'Unknown error');
    } finally {
      setTestLoading(false);
    }
  };

  const renderConfigFields = () => {
    switch (actionType) {
      case 'email':
        return (
          <>
            <FormItem>
              <div className="flex items-center justify-between mb-2">
                <FormLabel>Subject</FormLabel>
                <VariablePicker
                  onInsert={(v) => handleVariableInsert(v, 'subject')}
                  variables={template?.variables || undefined}
                />
              </div>
              <FormControl>
                <Input
                  ref={subjectRef}
                  value={configFields.subject || ''}
                  onChange={(e) => setConfigFields({ ...configFields, subject: e.target.value })}
                  onFocus={() => setActiveFieldRef(subjectRef.current)}
                  placeholder="Email subject (use {{variables}})"
                  data-testid="input-email-subject"
                />
              </FormControl>
            </FormItem>

            <FormItem>
              <div className="flex items-center justify-between mb-2">
                <FormLabel>HTML Content</FormLabel>
              </div>
              <FormControl>
                <WysiwygEditor
                  value={configFields.htmlContent || ''}
                  onChange={(value) => setConfigFields({ ...configFields, htmlContent: value })}
                  placeholder="Enter your email HTML content..."
                />
              </FormControl>
              <FormDescription className="text-xs">
                Design your email using the visual editor or switch to HTML mode for direct editing. Use {'{{variables}}'} for dynamic content.
              </FormDescription>
            </FormItem>

            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Use Email Wrapper</FormLabel>
                <FormDescription>
                  Wrap content in a professional email template with header and footer
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={configFields.useWrapper ?? true}
                  onCheckedChange={(checked) => setConfigFields({ ...configFields, useWrapper: checked })}
                  data-testid="switch-use-wrapper"
                />
              </FormControl>
            </FormItem>

            {configFields.useWrapper !== false && (
              <>
                <FormItem>
                  <FormLabel>Wrapper Type</FormLabel>
                  <Select
                    value={configFields.wrapperType || 'notification'}
                    onValueChange={(value) => setConfigFields({ ...configFields, wrapperType: value })}
                  >
                    <SelectTrigger data-testid="select-wrapper-type">
                      <SelectValue placeholder="Select wrapper type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notification">Notification</SelectItem>
                      <SelectItem value="alert">Alert</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="transactional">Transactional</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Choose a pre-defined color scheme for the email header
                  </FormDescription>
                </FormItem>

                <FormItem>
                  <FormLabel>Header Subtitle (optional)</FormLabel>
                  <FormControl>
                    <Input
                      value={configFields.headerSubtitle || ''}
                      onChange={(e) => setConfigFields({ ...configFields, headerSubtitle: e.target.value })}
                      placeholder="Subtitle text for email header"
                      data-testid="input-header-subtitle"
                    />
                  </FormControl>
                </FormItem>

                <div className="grid grid-cols-2 gap-4">
                  <FormItem>
                    <FormLabel>CTA Button Text (optional)</FormLabel>
                    <FormControl>
                      <Input
                        value={configFields.ctaButtonText || ''}
                        onChange={(e) => setConfigFields({ ...configFields, ctaButtonText: e.target.value })}
                        placeholder="Get Started"
                        data-testid="input-cta-text"
                      />
                    </FormControl>
                  </FormItem>

                  <FormItem>
                    <FormLabel>CTA Button URL (optional)</FormLabel>
                    <FormControl>
                      <Input
                        value={configFields.ctaButtonUrl || ''}
                        onChange={(e) => setConfigFields({ ...configFields, ctaButtonUrl: e.target.value })}
                        placeholder="https://example.com/action"
                        data-testid="input-cta-url"
                      />
                    </FormControl>
                  </FormItem>
                </div>
              </>
            )}

            <FormItem>
              <FormLabel>From Email (optional)</FormLabel>
              <FormControl>
                <Input
                  value={configFields.fromEmail || ''}
                  onChange={(e) => setConfigFields({ ...configFields, fromEmail: e.target.value })}
                  placeholder="sender@example.com"
                  type="email"
                  data-testid="input-email-from"
                />
              </FormControl>
            </FormItem>
          </>
        );
      
      case 'sms':
        return (
          <>
            <FormItem>
              <div className="flex items-center justify-between mb-2">
                <FormLabel>Message</FormLabel>
                <VariablePicker
                  onInsert={(v) => handleVariableInsert(v, 'message')}
                  variables={template?.variables || undefined}
                />
              </div>
              <FormControl>
                <Textarea
                  ref={messageRef}
                  value={configFields.message || ''}
                  onChange={(e) => setConfigFields({ ...configFields, message: e.target.value })}
                  onFocus={() => setActiveFieldRef(messageRef.current)}
                  placeholder="SMS message (use {{variables}})"
                  rows={4}
                  data-testid="textarea-sms-message"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>To Phone Number (optional)</FormLabel>
              <FormControl>
                <Input
                  value={configFields.toPhoneNumber || ''}
                  onChange={(e) => setConfigFields({ ...configFields, toPhoneNumber: e.target.value })}
                  placeholder="+1234567890 or {{phoneVariable}}"
                  data-testid="input-sms-phone"
                />
              </FormControl>
            </FormItem>
          </>
        );
      
      case 'webhook':
        // eslint-disable-next-line no-case-declarations
        const routeParams: RouteParam[] = configFields.routeParams || [];
        // eslint-disable-next-line no-case-declarations
        const resolvedPreviewUrl = resolveUrlWithParams(configFields.url || '', routeParams);
        return (
          <>
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>URL</FormLabel>
                {containsSecretRef(configFields.url) && (
                  <Badge variant="secondary" className="text-xs gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                    <Lock className="h-3 w-3" /> contains secrets
                  </Badge>
                )}
              </div>
              <FormControl>
                <Input
                  ref={webhookUrlRef}
                  value={configFields.url || ''}
                  onChange={(e) => setConfigFields({ ...configFields, url: e.target.value })}
                  onFocus={() => setFocusedWebhookField('url')}
                  placeholder="https://api.example.com/merchants/{merchantId}/transactions"
                  data-testid="input-webhook-url"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Use <code className="font-mono bg-muted px-1 rounded">{'{paramName}'}</code> for route params. Use <code className="font-mono bg-muted px-1 rounded">{'{{$SECRET_NAME}}'}</code> for secrets. Use <code className="font-mono bg-muted px-1 rounded">{'{{variable}}'}</code> for template variables.
              </FormDescription>
            </FormItem>

            {/* Route Parameters — auto-rendered when {param} tokens are detected */}
            {routeParams.length > 0 && (
              <div className="space-y-2" data-testid="route-params-section">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Route Parameters</span>
                  <Badge variant="secondary" className="text-xs">{routeParams.length} detected</Badge>
                </div>

                {/* Param rows */}
                <div className="rounded-md border divide-y text-sm" data-testid="route-params-table">
                  {/* Header */}
                  <div className="grid grid-cols-[140px_1fr_1fr] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <span>Parameter</span>
                    <span>Default Value</span>
                    <span>Description</span>
                  </div>
                  {routeParams.map((param, idx) => (
                    <div key={param.name} className="grid grid-cols-[140px_1fr_1fr] gap-2 px-3 py-2 items-center" data-testid={`route-param-row-${param.name}`}>
                      <code className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400 truncate">
                        {'{' + param.name + '}'}
                      </code>
                      <Input
                        value={param.defaultValue || ''}
                        onChange={(e) => {
                          const updated = routeParams.map((p, i) => i === idx ? { ...p, defaultValue: e.target.value } : p);
                          setConfigFields({ ...configFields, routeParams: updated });
                        }}
                        placeholder="Enter default value"
                        className="h-7 text-xs"
                        data-testid={`route-param-default-${param.name}`}
                      />
                      <Input
                        value={param.description || ''}
                        onChange={(e) => {
                          const updated = routeParams.map((p, i) => i === idx ? { ...p, description: e.target.value } : p);
                          setConfigFields({ ...configFields, routeParams: updated });
                        }}
                        placeholder="e.g. Merchant ID"
                        className="h-7 text-xs"
                        data-testid={`route-param-desc-${param.name}`}
                      />
                    </div>
                  ))}
                </div>

                {/* Resolved URL preview */}
                <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs" data-testid="resolved-url-preview">
                  <span className="text-muted-foreground font-medium mr-2">Resolved URL:</span>
                  <span className="font-mono break-all">
                    {resolvedPreviewUrl.split(/(\{[^{}]+\})/g).map((part, i) =>
                      /^\{[^{}]+\}$/.test(part)
                        ? <span key={i} className="text-destructive font-semibold">{part}</span>
                        : <span key={i}>{part}</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            <FormItem>
              <FormLabel>Method</FormLabel>
              <Select
                value={configFields.method || 'POST'}
                onValueChange={(value) => setConfigFields({ ...configFields, method: value })}
              >
                <SelectTrigger data-testid="select-webhook-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
            {/* Secrets Reference Panel */}
            {secretsData && secretsData.secrets.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setSecretsExpanded(v => !v)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                    <ShieldCheck className="h-4 w-4" />
                    Secrets Reference
                    <Badge variant="outline" className="text-xs border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400">
                      {secretsData.secrets.length} available
                    </Badge>
                  </div>
                  {secretsExpanded
                    ? <ChevronUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    : <ChevronDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  }
                </button>

                {secretsExpanded && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Click a secret to insert <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">{'{{$SECRET_NAME}}'}</code> at your cursor in the URL, Headers, or Body field.
                      {focusedWebhookField
                        ? <span className="ml-1 font-medium">Inserting into: <span className="capitalize">{focusedWebhookField}</span></span>
                        : <span className="ml-1 text-amber-600 dark:text-amber-500"> (focus a field first, or the token will be copied to clipboard)</span>
                      }
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {secretsData.secrets.map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => insertSecretRef(name)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
                          title={`Insert {{$${name}}}`}
                        >
                          <Lock className="h-3 w-3 opacity-60" />
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Headers (JSON, optional)</FormLabel>
                {containsSecretRef(configFields.headers) && (
                  <Badge variant="secondary" className="text-xs gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                    <Lock className="h-3 w-3" /> contains secrets
                  </Badge>
                )}
              </div>
              <FormControl>
                <Textarea
                  ref={webhookHeadersRef}
                  value={configFields.headers || ''}
                  onChange={(e) => setConfigFields({ ...configFields, headers: e.target.value })}
                  onFocus={() => setFocusedWebhookField('headers')}
                  placeholder='{"Authorization": "Bearer {{$API_TOKEN}}", "X-Api-Key": "{{$API_KEY}}"}'
                  rows={3}
                  data-testid="textarea-webhook-headers"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Body (optional)</FormLabel>
                {containsSecretRef(configFields.body) && (
                  <Badge variant="secondary" className="text-xs gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                    <Lock className="h-3 w-3" /> contains secrets
                  </Badge>
                )}
              </div>
              <FormControl>
                <Textarea
                  ref={webhookBodyRef}
                  value={configFields.body || ''}
                  onChange={(e) => setConfigFields({ ...configFields, body: e.target.value })}
                  onFocus={() => setFocusedWebhookField('body')}
                  placeholder='{"data": "{{variable}}"}'
                  rows={4}
                  data-testid="textarea-webhook-body"
                />
              </FormControl>
            </FormItem>

            <FormItem>
              <FormLabel>Expected Response Schema (optional)</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.responseSchema || ''}
                  onChange={(e) => setConfigFields({ ...configFields, responseSchema: e.target.value })}
                  placeholder={'{\n  "merchants": [\n    { "id": 1, "name": "Acme Corp", "status": "active" }\n  ]\n}'}
                  rows={5}
                  data-testid="textarea-webhook-response-schema"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Paste a sample JSON response from this endpoint so you can explore its fields and map them to dashboards.
              </FormDescription>
            </FormItem>

            <FormItem>
              <FormLabel>Mock Response Data (optional)</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.mockData || ''}
                  onChange={(e) => setConfigFields({ ...configFields, mockData: e.target.value })}
                  placeholder={'{\n  "merchants": [\n    { "id": 1, "name": "Test Merchant" }\n  ]\n}'}
                  rows={5}
                  data-testid="textarea-webhook-mock-data"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Sample data to use when testing UI integration without hitting the live endpoint.
              </FormDescription>
            </FormItem>

            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <FormLabel>Use as Data Source</FormLabel>
                <FormDescription className="text-xs">
                  Mark this template as a reusable data provider that can feed dashboards and tables.
                </FormDescription>
              </div>
              <Switch
                checked={!!configFields.isDataSource}
                onCheckedChange={(checked) => setConfigFields({ ...configFields, isDataSource: checked })}
                data-testid="switch-is-data-source"
              />
            </FormItem>
          </>
        );
      
      case 'notification':
        return (
          <>
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  value={configFields.title || ''}
                  onChange={(e) => setConfigFields({ ...configFields, title: e.target.value })}
                  placeholder="Notification title"
                  data-testid="input-notification-title"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.message || ''}
                  onChange={(e) => setConfigFields({ ...configFields, message: e.target.value })}
                  placeholder="Notification message (use {{variables}})"
                  rows={4}
                  data-testid="textarea-notification-message"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Priority</FormLabel>
              <Select
                value={configFields.priority || 'medium'}
                onValueChange={(value) => setConfigFields({ ...configFields, priority: value })}
              >
                <SelectTrigger data-testid="select-notification-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          </>
        );
      
      case 'slack':
        return (
          <>
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.message || ''}
                  onChange={(e) => setConfigFields({ ...configFields, message: e.target.value })}
                  placeholder="Slack message (use {{variables}})"
                  rows={4}
                  data-testid="textarea-slack-message"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Channel (optional)</FormLabel>
              <FormControl>
                <Input
                  value={configFields.channel || ''}
                  onChange={(e) => setConfigFields({ ...configFields, channel: e.target.value })}
                  placeholder="#general or {{channelVariable}}"
                  data-testid="input-slack-channel"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Webhook URL (optional)</FormLabel>
              <FormControl>
                <Input
                  value={configFields.webhookUrl || ''}
                  onChange={(e) => setConfigFields({ ...configFields, webhookUrl: e.target.value })}
                  placeholder="https://hooks.slack.com/services/..."
                  data-testid="input-slack-webhook"
                />
              </FormControl>
            </FormItem>
          </>
        );
      
      case 'teams':
        return (
          <>
            <FormItem>
              <FormLabel>Webhook URL</FormLabel>
              <FormControl>
                <Input
                  value={configFields.webhookUrl || ''}
                  onChange={(e) => setConfigFields({ ...configFields, webhookUrl: e.target.value })}
                  placeholder="https://outlook.office.com/webhook/..."
                  data-testid="input-teams-webhook"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Title (optional)</FormLabel>
              <FormControl>
                <Input
                  value={configFields.title || ''}
                  onChange={(e) => setConfigFields({ ...configFields, title: e.target.value })}
                  placeholder="Message title"
                  data-testid="input-teams-title"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.message || ''}
                  onChange={(e) => setConfigFields({ ...configFields, message: e.target.value })}
                  placeholder="Teams message (use {{variables}})"
                  rows={4}
                  data-testid="textarea-teams-message"
                />
              </FormControl>
            </FormItem>
          </>
        );
      
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Action Template' : 'Edit Action Template'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' 
              ? 'Create a new action template for use in triggers'
              : 'Update the action template configuration'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Template Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Welcome Email" data-testid="input-template-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Template description" rows={2} data-testid="textarea-template-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="actionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-action-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="webhook">Webhook</SelectItem>
                        <SelectItem value="notification">Notification</SelectItem>
                        <SelectItem value="slack">Slack</SelectItem>
                        <SelectItem value="teams">Teams</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-category">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="authentication">Authentication</SelectItem>
                        <SelectItem value="application">Application</SelectItem>
                        <SelectItem value="notification">Notification</SelectItem>
                        <SelectItem value="alert">Alert</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
              <h3 className="text-sm font-medium">Configuration Fields</h3>
              {renderConfigFields()}
            </div>

            <FormField
              control={form.control}
              name="variables"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Available Variables (JSON, optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder='{"userName": "User name", "email": "User email"}' 
                      rows={3}
                      data-testid="textarea-variables"
                    />
                  </FormControl>
                  <FormDescription>
                    Define variables that can be used in this template (JSON format)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active</FormLabel>
                    <FormDescription>
                      Template is active and can be used in triggers
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-is-active"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Test Request Panel — only for webhook templates */}
            {actionType === 'webhook' && (
              <div className="border rounded-lg overflow-hidden" data-testid="test-request-panel">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-sm font-medium"
                  onClick={() => setShowTestPanel(!showTestPanel)}
                  data-testid="button-toggle-test-panel"
                >
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-muted-foreground" />
                    Test Request
                  </div>
                  {showTestPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {showTestPanel && (
                  <div className="p-4 space-y-4">
                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => runWebhookTest('live')}
                        disabled={testLoading || !configFields.url}
                        data-testid="button-run-live-request"
                      >
                        {testLoading ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Play className="h-3 w-3 mr-2" />}
                        Run Live Request
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => runWebhookTest('mock')}
                        disabled={testLoading || !configFields.mockData}
                        data-testid="button-use-mock-data"
                      >
                        Use Mock Data
                      </Button>
                    </div>

                    {/* Error State */}
                    {testError && (
                      <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="test-error">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        {testError}
                      </div>
                    )}

                    {/* Result */}
                    {testResult && !testError && (() => {
                      const isMock = testResult.mode === 'mock';
                      const status = testResult.status as number | undefined;
                      const isSuccess = isMock || (status !== undefined && status >= 200 && status < 300);
                      const isRedirect = !isMock && status !== undefined && status >= 300 && status < 400;

                      const statusColor = isSuccess
                        ? 'text-green-600 dark:text-green-400'
                        : isRedirect
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400';
                      const StatusIcon = isSuccess ? CheckCircle2 : AlertCircle;

                      return (
                        <div className="space-y-3" data-testid="test-result">
                          {/* Status line */}
                          <div className={`flex items-center gap-2 text-sm ${statusColor}`}>
                            <StatusIcon className="h-4 w-4 shrink-0" />
                            {isMock
                              ? 'Mock data loaded'
                              : `HTTP ${status} ${testResult.statusText || ''}`}
                            {testResult.elapsed !== undefined && (
                              <span className="text-muted-foreground text-xs font-normal ml-auto">{testResult.elapsed}ms</span>
                            )}
                          </div>

                          {/* Raw JSON */}
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Response Body</div>
                            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48 whitespace-pre-wrap break-all" data-testid="test-response-json">
                              {JSON.stringify(testResult.data, null, 2)}
                            </pre>
                          </div>

                          {/* Field Explorer — only for successful 2xx responses with object data */}
                          {isSuccess && testResult.data && typeof testResult.data === 'object' && (
                            <div className="space-y-1" data-testid="field-explorer">
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Field Explorer</div>
                              <div className="rounded-md border divide-y text-xs max-h-48 overflow-auto">
                                {getFieldsFromData(testResult.data).map((field) => (
                                  <div key={field.key} className="flex items-center justify-between px-3 py-2 hover:bg-muted/40">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <code className="font-mono font-semibold truncate">{field.key}</code>
                                      <Badge variant="outline" className="text-[10px] shrink-0 py-0">
                                        {field.type}
                                      </Badge>
                                    </div>
                                    <span className="text-muted-foreground truncate max-w-[200px] ml-4">{field.preview}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              {actionType === 'email' && mode === 'edit' && template?.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowTestDialog(true)}
                  data-testid="button-test-email"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Test Email
                </Button>
              )}
              {actionType === 'webhook' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowTestPanel(!showTestPanel)}
                  data-testid="button-open-test-panel"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Test Request
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={handlePreview}
                data-testid="button-preview-template"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-template"
              >
                {mode === 'create' ? 'Create Template' : 'Update Template'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
            <DialogDescription>
              Enter sample data to preview how your template will look
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Sample Data Inputs */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Sample Variable Values</h3>
              <div className="grid grid-cols-2 gap-4">
                {extractVariables().map((varName) => (
                  <div key={varName} className="space-y-2">
                    <label className="text-sm font-medium">{varName}</label>
                    <Input
                      value={sampleData[varName] || ''}
                      onChange={(e) => setSampleData({ ...sampleData, [varName]: e.target.value })}
                      placeholder={`Enter ${varName}`}
                      data-testid={`input-sample-${varName}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Rendered Preview */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Preview Output</h3>
              <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800 space-y-4">
                {actionType === 'email' && (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</div>
                      <div className="text-sm font-medium" data-testid="preview-email-subject">
                        {renderTemplateWithData(configFields.subject || '', sampleData)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body</div>
                      <div 
                        className="text-sm border rounded p-3 bg-gray-50 dark:bg-gray-900" 
                        data-testid="preview-email-body"
                        dangerouslySetInnerHTML={{ 
                          __html: renderTemplateWithData(configFields.htmlContent || configFields.textContent || '', sampleData) 
                        }}
                      />
                    </div>
                    {configFields.fromEmail && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</div>
                        <div className="text-sm" data-testid="preview-email-from">
                          {configFields.fromEmail}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {actionType === 'sms' && (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Message</div>
                      <div className="text-sm whitespace-pre-wrap" data-testid="preview-sms-message">
                        {renderTemplateWithData(configFields.message || '', sampleData)}
                      </div>
                    </div>
                    {configFields.toPhone && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</div>
                        <div className="text-sm" data-testid="preview-sms-to">
                          {configFields.toPhone}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {actionType === 'webhook' && (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">URL</div>
                      <div className="text-sm font-mono break-all" data-testid="preview-webhook-url">
                        {configFields.url || ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Method</div>
                      <div className="text-sm" data-testid="preview-webhook-method">
                        {configFields.method || 'POST'}
                      </div>
                    </div>
                    {configFields.body && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body</div>
                        <div className="text-sm font-mono whitespace-pre-wrap" data-testid="preview-webhook-body">
                          {renderTemplateWithData(configFields.body, sampleData)}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {actionType === 'notification' && (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title</div>
                      <div className="text-sm font-medium" data-testid="preview-notification-title">
                        {renderTemplateWithData(configFields.title || '', sampleData)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Message</div>
                      <div className="text-sm" data-testid="preview-notification-message">
                        {renderTemplateWithData(configFields.message || '', sampleData)}
                      </div>
                    </div>
                  </>
                )}

                {actionType === 'slack' && (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Message</div>
                      <div className="text-sm whitespace-pre-wrap" data-testid="preview-slack-message">
                        {renderTemplateWithData(configFields.message || '', sampleData)}
                      </div>
                    </div>
                    {configFields.channel && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Channel</div>
                        <div className="text-sm" data-testid="preview-slack-channel">
                          {renderTemplateWithData(configFields.channel, sampleData)}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {actionType === 'teams' && (
                  <>
                    {configFields.title && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title</div>
                        <div className="text-sm font-medium" data-testid="preview-teams-title">
                          {renderTemplateWithData(configFields.title, sampleData)}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Message</div>
                      <div className="text-sm whitespace-pre-wrap" data-testid="preview-teams-message">
                        {renderTemplateWithData(configFields.message || '', sampleData)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPreview(false)}
              data-testid="button-close-preview"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Email Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Send a test email to verify how this template looks
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Recipient Email
              </label>
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Enter email address"
                data-testid="input-test-email-recipient"
              />
              <p className="text-xs text-muted-foreground">
                The test email will use sample data for variables
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowTestDialog(false);
                setTestEmail('');
              }}
              data-testid="button-cancel-test"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleTestEmail}
              disabled={testEmailMutation.isPending || !testEmail}
              data-testid="button-send-test-email"
            >
              <Send className="w-4 h-4 mr-2" />
              {testEmailMutation.isPending ? 'Sending...' : 'Send Test Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

export default function ActionTemplates() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<ActionType | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [showDataSourcesOnly, setShowDataSourcesOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedTemplate, setSelectedTemplate] = useState<ActionTemplate | null>(null);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageTemplate, setUsageTemplate] = useState<ActionTemplate | null>(null);

  // Fetch all action templates
  // Note: Custom queryFn with aggressive refetch settings to avoid stale data from pre-auth 401 responses
  const { data: templates = [], isLoading } = useQuery<ActionTemplate[]>({
    queryKey: ['/api/action-templates'],
    queryFn: async () => {
      const response = await fetch('/api/action-templates', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Fetch template usage data
  const { data: usageData = {} } = useQuery<Record<number, TemplateUsage[]>>({
    queryKey: ['/api/action-templates/usage'],
    queryFn: async () => {
      const response = await fetch('/api/action-templates/usage', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch usage');
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/action-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/action-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/action-templates/usage'] });
      toast({
        title: "Success",
        description: "Template deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete template",
        variant: "destructive",
      });
    },
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async (template: ActionTemplate) => {
      const duplicateData = {
        name: `${template.name} (Copy)`,
        description: template.description,
        actionType: template.actionType,
        category: template.category,
        config: template.config,
        variables: template.variables,
        isActive: false, // Start duplicates as inactive
      };
      return apiRequest('POST', '/api/action-templates', duplicateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/action-templates'] });
      toast({
        title: "Success",
        description: "Template duplicated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate template",
        variant: "destructive",
      });
    },
  });

  // Filter templates
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (template.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === 'all' || template.actionType === selectedType;
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    const matchesDataSource = !showDataSourcesOnly || !!(template.config as any)?.isDataSource;
    
    return matchesSearch && matchesType && matchesCategory && matchesDataSource;
  });

  // Group templates by action type
  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    if (!acc[template.actionType]) {
      acc[template.actionType] = [];
    }
    acc[template.actionType].push(template);
    return acc;
  }, {} as Record<ActionType, ActionTemplate[]>);

  const getTemplateStats = () => {
    const stats = {
      total: templates.length,
      active: templates.filter(t => t.isActive).length,
      byType: {} as Record<ActionType, number>,
    };

    templates.forEach(t => {
      stats.byType[t.actionType] = (stats.byType[t.actionType] || 0) + 1;
    });

    return stats;
  };

  const stats = getTemplateStats();

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header Section */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Action Templates</h1>
          <p className="text-muted-foreground mt-1">
            Manage reusable action templates for triggers
          </p>
        </div>
        <Button 
          onClick={() => {
            setModalMode('create');
            setSelectedTemplate(null);
            setModalOpen(true);
          }}
          data-testid="button-create-template"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total Templates</CardDescription>
            <CardTitle className="text-3xl" data-testid="text-total-templates">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Active Templates</CardDescription>
            <CardTitle className="text-3xl" data-testid="text-active-templates">{stats.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Action Types</CardDescription>
            <CardTitle className="text-3xl" data-testid="text-action-types">{Object.keys(stats.byType).length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>In Use</CardDescription>
            <CardTitle className="text-3xl" data-testid="text-templates-in-use">
              {Object.values(usageData).filter(u => u.length > 0).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters Section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-templates"
                />
              </div>
            </div>
            <Select value={selectedType} onValueChange={(value) => setSelectedType(value as ActionType | 'all')}>
              <SelectTrigger className="w-full md:w-[180px]" data-testid="select-action-type">
                <SelectValue placeholder="Action Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="notification">Notification</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="teams">Teams</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as Category)}>
              <SelectTrigger className="w-full md:w-[180px]" data-testid="select-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="authentication">Authentication</SelectItem>
                <SelectItem value="application">Application</SelectItem>
                <SelectItem value="notification">Notification</SelectItem>
                <SelectItem value="alert">Alert</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={showDataSourcesOnly ? "default" : "outline"}
              className="gap-2 shrink-0"
              onClick={() => setShowDataSourcesOnly(!showDataSourcesOnly)}
              data-testid="button-filter-data-sources"
            >
              <Database className="h-4 w-4" />
              Data Sources
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Templates Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading templates...</div>
      ) : filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Filter className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No templates found</h3>
            <p className="text-muted-foreground">
              {searchQuery || selectedType !== 'all' || selectedCategory !== 'all' 
                ? 'Try adjusting your filters'
                : 'Create your first action template to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedTemplates).map(([type, typeTemplates]) => {
            const Icon = actionTypeIcons[type as ActionType];
            const color = actionTypeColors[type as ActionType];

            return (
              <div key={type} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`${color} p-2 rounded-lg`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <h2 className="text-xl font-semibold capitalize">{type} Templates</h2>
                  <Badge variant="secondary">{typeTemplates.length}</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {typeTemplates.map((template) => {
                    const usage = usageData[template.id] || [];
                    const isInUse = usage.length > 0;

                    return (
                      <Card 
                        key={template.id} 
                        className="hover:shadow-lg transition-shadow"
                        data-testid={`card-template-${template.id}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg flex items-center gap-2">
                                {template.name}
                                {!template.isActive && (
                                  <Badge variant="outline" className="text-xs">Inactive</Badge>
                                )}
                              </CardTitle>
                              <CardDescription className="mt-1 line-clamp-2">
                                {template.description || 'No description'}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={categoryColors[template.category] || ''}>
                              {template.category}
                            </Badge>
                            <Badge variant="outline">v{template.version}</Badge>
                            {(template.config as any)?.isDataSource && (
                              <Badge className="gap-1 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" data-testid={`badge-data-source-${template.id}`}>
                                <Database className="h-3 w-3" />
                                Data Source
                              </Badge>
                            )}
                            {isInUse && (
                              <Badge 
                                variant="secondary" 
                                className="gap-1 cursor-pointer hover:bg-secondary/80"
                                onClick={() => {
                                  setUsageTemplate(template);
                                  setUsageDialogOpen(true);
                                }}
                                data-testid={`badge-usage-${template.id}`}
                              >
                                <ExternalLink className="h-3 w-3" />
                                {usage.length} trigger{usage.length > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>

                          {template.variables && Object.keys(template.variables).length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              Variables: {Object.keys(template.variables).join(', ')}
                            </div>
                          )}

                          <div className="flex gap-2 pt-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1"
                              onClick={() => {
                                setModalMode('edit');
                                setSelectedTemplate(template);
                                setModalOpen(true);
                              }}
                              data-testid={`button-edit-${template.id}`}
                            >
                              <Edit className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                duplicateMutation.mutate(template);
                              }}
                              disabled={duplicateMutation.isPending}
                              data-testid={`button-duplicate-${template.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                const usage = usageData[template.id] || [];
                                if (usage.length > 0) {
                                  toast({
                                    title: "Cannot Delete Template",
                                    description: `This template is used by ${usage.length} trigger(s): ${usage.map(u => u.triggerName).join(', ')}`,
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                
                                if (confirm(`Are you sure you want to delete "${template.name}"?`)) {
                                  deleteMutation.mutate(template.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-${template.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Usage Dialog */}
      <Dialog open={usageDialogOpen} onOpenChange={setUsageDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Template Usage</DialogTitle>
            <DialogDescription>
              {usageTemplate ? `Triggers using "${usageTemplate.name}"` : 'Template usage details'}
            </DialogDescription>
          </DialogHeader>

          {usageTemplate && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className={`${actionTypeColors[usageTemplate.actionType]} p-2 rounded-lg`}>
                  {actionTypeIcons[usageTemplate.actionType]({ className: "h-5 w-5 text-white" })}
                </div>
                <div>
                  <h3 className="font-semibold">{usageTemplate.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {usageTemplate.actionType} • {usageTemplate.category}
                  </p>
                </div>
              </div>

              {usageData[usageTemplate.id] && usageData[usageTemplate.id].length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">
                    Used by {usageData[usageTemplate.id].length} trigger{usageData[usageTemplate.id].length > 1 ? 's' : ''}:
                  </h4>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {usageData[usageTemplate.id].map((usage) => (
                      <Card key={usage.triggerId} data-testid={`usage-trigger-${usage.triggerId}`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="font-medium">{usage.triggerName}</h5>
                              <p className="text-sm text-muted-foreground">
                                Key: {usage.triggerKey}
                              </p>
                            </div>
                            <Badge variant={usage.isActive ? "default" : "outline"}>
                              {usage.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ExternalLink className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>This template is not currently used by any triggers</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUsageDialogOpen(false);
                setUsageTemplate(null);
              }}
              data-testid="button-close-usage"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Modal */}
      <TemplateModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedTemplate(null);
        }}
        template={selectedTemplate}
        mode={modalMode}
      />
    </div>
  );
}
