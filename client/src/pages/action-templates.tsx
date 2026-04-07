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
  ExternalLink
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

const webhookConfigSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.string().optional(),
  body: z.string().optional(),
});

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
  
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  
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

  const handlePreview = () => {
    const variables = extractVariables();
    const initialData: Record<string, string> = {};
    
    variables.forEach(v => {
      initialData[v] = sampleData[v] || `[${v}]`;
    });
    
    setSampleData(initialData);
    setShowPreview(true);
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
        return (
          <>
            <FormItem>
              <FormLabel>URL</FormLabel>
              <FormControl>
                <Input
                  value={configFields.url || ''}
                  onChange={(e) => setConfigFields({ ...configFields, url: e.target.value })}
                  placeholder="https://api.example.com/webhook"
                  data-testid="input-webhook-url"
                />
              </FormControl>
            </FormItem>
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
            <FormItem>
              <FormLabel>Headers (JSON, optional)</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.headers || ''}
                  onChange={(e) => setConfigFields({ ...configFields, headers: e.target.value })}
                  placeholder='{"Authorization": "Bearer {{token}}"}'
                  rows={3}
                  data-testid="textarea-webhook-headers"
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Body (optional)</FormLabel>
              <FormControl>
                <Textarea
                  value={configFields.body || ''}
                  onChange={(e) => setConfigFields({ ...configFields, body: e.target.value })}
                  placeholder='{"data": "{{variable}}"}'
                  rows={4}
                  data-testid="textarea-webhook-body"
                />
              </FormControl>
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
    
    return matchesSearch && matchesType && matchesCategory;
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
