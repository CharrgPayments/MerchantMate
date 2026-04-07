import { db } from './db';
import { 
  triggerCatalog, 
  actionTemplates, 
  triggerActions, 
  actionActivity,
  users,
  userAlerts,
  type TriggerCatalog,
  type ActionTemplate,
  type TriggerAction,
  type User,
  emailActionConfigSchema,
  smsActionConfigSchema,
  webhookActionConfigSchema,
  notificationActionConfigSchema,
  slackActionConfigSchema,
} from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { EmailService } from './emailService';
import { wrapEmailTemplate } from './emailTemplateWrapper';

// Base Action Executor Interface
export interface IActionExecutor {
  execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>,
    user?: User
  ): Promise<ActionExecutionResult>;
}

export interface ActionExecutionResult {
  success: boolean;
  status: 'sent' | 'failed' | 'pending' | 'delivered';
  statusMessage?: string;
  responseData?: any;
}

// Email Action Executor
export class EmailExecutor implements IActionExecutor {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>,
    user?: User
  ): Promise<ActionExecutionResult> {
    try {
      const config = emailActionConfigSchema.parse(template.config);
      
      // Replace variables in template
      const subject = this.replaceVariables(config.subject, context);
      let htmlContent = this.replaceVariables(config.htmlContent, context);
      const textContent = config.textContent 
        ? this.replaceVariables(config.textContent, context) 
        : undefined;

      // Wrap content in professional template if not already wrapped
      if (!htmlContent.includes('max-width: 600px')) {
        htmlContent = this.wrapEmailContent(htmlContent, subject, context);
      }

      // Send email using existing EmailService
      const success = await this.sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        text: textContent,
        from: config.fromEmail,
        fromName: config.fromName,
        replyTo: config.replyTo,
      });

      return {
        success,
        status: success ? 'sent' : 'failed',
        statusMessage: success ? 'Email sent successfully' : 'Failed to send email',
      };
    } catch (error) {
      console.error('Email executor error:', error);
      return {
        success: false,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private wrapEmailContent(content: string, subject: string, context: Record<string, any>): string {
    // Determine recipient name from context
    const recipientName = context.firstName && context.lastName 
      ? `${context.firstName} ${context.lastName}`
      : context.firstName || context.recipientName || undefined;

    // Determine header gradient based on trigger type
    const triggerEvent = context.triggerEvent || '';
    let headerGradient = 'linear-gradient(135deg, #059669 0%, #10b981 100%)'; // Default green
    
    if (triggerEvent.includes('agent') || triggerEvent.includes('notification')) {
      headerGradient = 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)'; // Purple for agent/notifications
    } else if (triggerEvent.includes('security') || triggerEvent.includes('password') || triggerEvent.includes('login')) {
      headerGradient = 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)'; // Blue for security
    } else if (triggerEvent.includes('alert') || triggerEvent.includes('warning')) {
      headerGradient = 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)'; // Red for alerts
    }

    return wrapEmailTemplate({
      headerTitle: subject,
      headerGradient,
      recipientName,
      content,
    });
  }

  private async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
    fromName?: string;
    replyTo?: string;
  }): Promise<boolean> {
    // Use existing email service infrastructure
    const mailService = (await import('@sendgrid/mail')).default;
    mailService.setApiKey(process.env.SENDGRID_API_KEY!);

    try {
      await mailService.send({
        to: params.to,
        from: params.from || process.env.SENDGRID_FROM_EMAIL!,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return true;
    } catch (error) {
      console.error('SendGrid error:', error);
      return false;
    }
  }

  private replaceVariables(template: string, context: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    }
    return result;
  }
}

// SMS Action Executor
export class SmsExecutor implements IActionExecutor {
  async execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>
  ): Promise<ActionExecutionResult> {
    try {
      const config = smsActionConfigSchema.parse(template.config);
      const message = this.replaceVariables(config.message, context);

      // TODO: Integrate with SMS provider (Twilio, etc.)
      console.log(`SMS to ${recipient}: ${message}`);

      return {
        success: true,
        status: 'sent',
        statusMessage: 'SMS sent (simulated)',
        responseData: { message, recipient },
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private replaceVariables(template: string, context: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    }
    return result;
  }
}

// Webhook Action Executor
export class WebhookExecutor implements IActionExecutor {
  async execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>
  ): Promise<ActionExecutionResult> {
    try {
      const config = webhookActionConfigSchema.parse(template.config);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      // Add authentication headers if configured
      if (config.authentication) {
        switch (config.authentication.type) {
          case 'bearer':
            headers['Authorization'] = `Bearer ${config.authentication.credentials?.token}`;
            break;
          case 'basic':
            const encoded = Buffer.from(
              `${config.authentication.credentials?.username}:${config.authentication.credentials?.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${encoded}`;
            break;
          case 'api_key':
            headers[config.authentication.credentials?.headerName || 'X-API-Key'] = 
              config.authentication.credentials?.apiKey || '';
            break;
        }
      }

      const body = this.replaceVariables(JSON.stringify(config.body || context), context);

      const response = await fetch(config.url, {
        method: config.method,
        headers,
        body: config.method !== 'GET' ? body : undefined,
      });

      const responseData = await response.text();

      return {
        success: response.ok,
        status: response.ok ? 'delivered' : 'failed',
        statusMessage: `HTTP ${response.status}`,
        responseData: { status: response.status, body: responseData },
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private replaceVariables(template: string, context: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    }
    return result;
  }
}

// Notification Action Executor (In-app notifications)
export class NotificationExecutor implements IActionExecutor {
  async execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>
  ): Promise<ActionExecutionResult> {
    try {
      const config = notificationActionConfigSchema.parse(template.config);
      
      const message = this.replaceVariables(config.message, context);
      const actionUrl = config.actionUrl ? this.replaceVariables(config.actionUrl, context) : undefined;

      // Create alert in database
      const [alert] = await db.insert(userAlerts).values({
        userId: recipient, // recipient should be user ID for notifications
        message,
        type: config.type,
        actionUrl: actionUrl || null,
        isRead: false,
      }).returning();

      return {
        success: true,
        status: 'sent',
        statusMessage: 'Alert created successfully',
        responseData: { 
          alertId: alert.id,
          message, 
          type: config.type 
        },
      };
    } catch (error) {
      console.error('Notification executor error:', error);
      return {
        success: false,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private replaceVariables(template: string, context: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    }
    return result;
  }
}

// Slack Action Executor
export class SlackExecutor implements IActionExecutor {
  async execute(
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>
  ): Promise<ActionExecutionResult> {
    try {
      const config = slackActionConfigSchema.parse(template.config);
      
      const message = this.replaceVariables(config.message, context);

      // TODO: Integrate with Slack API
      console.log(`Slack to ${config.channel}: ${message}`);

      return {
        success: true,
        status: 'sent',
        statusMessage: 'Slack message sent (simulated)',
        responseData: { channel: config.channel, message },
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private replaceVariables(template: string, context: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    }
    return result;
  }
}

// Main Trigger Service
export class TriggerService {
  private executors: Map<string, IActionExecutor>;

  constructor() {
    this.executors = new Map<string, IActionExecutor>();
    this.executors.set('email', new EmailExecutor());
    this.executors.set('sms', new SmsExecutor());
    this.executors.set('webhook', new WebhookExecutor());
    this.executors.set('notification', new NotificationExecutor());
    this.executors.set('slack', new SlackExecutor());
  }

  /**
   * Fire a trigger event with context data
   */
  async fireTrigger(
    triggerKey: string,
    context: Record<string, any>,
    options?: {
      userId?: string;
      triggerSource?: string;
      dbEnv?: string;
    }
  ): Promise<void> {
    try {
      // 1. Find the trigger in catalog
      const trigger = await db.query.triggerCatalog.findFirst({
        where: and(
          eq(triggerCatalog.triggerKey, triggerKey),
          eq(triggerCatalog.isActive, true)
        ),
      });

      if (!trigger) {
        console.log(`Trigger not found or inactive: ${triggerKey}`);
        return;
      }

      // 2. Get user if userId provided (for communication preference checks)
      let user: User | undefined;
      if (options?.userId) {
        user = await db.query.users.findFirst({
          where: eq(users.id, options.userId),
        });
      }

      // 3. Get all trigger actions for this trigger (ordered by sequence)
      const actions = await db
        .select({
          triggerAction: triggerActions,
          template: actionTemplates,
        })
        .from(triggerActions)
        .innerJoin(actionTemplates, eq(triggerActions.actionTemplateId, actionTemplates.id))
        .where(
          and(
            eq(triggerActions.triggerId, trigger.id),
            eq(triggerActions.isActive, true),
            eq(actionTemplates.isActive, true)
          )
        )
        .orderBy(triggerActions.sequenceOrder);

      // 4. Execute each action
      for (const { triggerAction, template } of actions) {
        // Check communication preferences
        if (!this.checkCommunicationPreference(triggerAction, user)) {
          console.log(`Skipping action ${template.name} - communication preference not met`);
          continue;
        }

        // Evaluate conditions
        if (!this.evaluateConditions(triggerAction.conditions, context)) {
          console.log(`Skipping action ${template.name} - conditions not met`);
          continue;
        }

        // Determine recipient
        const recipient = this.determineRecipient(template.actionType, context, user);
        if (!recipient) {
          console.log(`No recipient for action ${template.name}`);
          continue;
        }

        // Execute action
        await this.executeAction(
          triggerAction,
          trigger,
          template,
          recipient,
          context,
          user,
          options
        );
      }
    } catch (error) {
      console.error(`Error firing trigger ${triggerKey}:`, error);
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    triggerAction: TriggerAction,
    trigger: TriggerCatalog,
    template: ActionTemplate,
    recipient: string,
    context: Record<string, any>,
    user: User | undefined,
    options?: {
      userId?: string;
      triggerSource?: string;
    }
  ): Promise<void> {
    const executor = this.executors.get(template.actionType);
    if (!executor) {
      console.error(`No executor found for action type: ${template.actionType}`);
      return;
    }

    try {
      // Execute the action
      const result = await executor.execute(template, recipient, context, user);

      // Log action activity
      await db.insert(actionActivity).values({
        triggerActionId: triggerAction.id,
        triggerId: trigger.id,
        actionTemplateId: template.id,
        actionType: template.actionType,
        recipient,
        recipientName: user ? `${user.firstName} ${user.lastName}` : undefined,
        status: result.status,
        statusMessage: result.statusMessage,
        triggerSource: options?.triggerSource || 'api',
        triggeredBy: options?.userId || 'system',
        contextData: context,
        responseData: result.responseData,
        executedAt: new Date(),
        deliveredAt: result.success ? new Date() : undefined,
        failedAt: !result.success ? new Date() : undefined,
        retryCount: 0,
      });

      console.log(`Action executed: ${template.name} (${result.status})`);
    } catch (error) {
      console.error(`Error executing action ${template.name}:`, error);
      
      // Log failed execution
      await db.insert(actionActivity).values({
        triggerActionId: triggerAction.id,
        triggerId: trigger.id,
        actionTemplateId: template.id,
        actionType: template.actionType,
        recipient,
        recipientName: user ? `${user.firstName} ${user.lastName}` : undefined,
        status: 'failed',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
        triggerSource: options?.triggerSource || 'api',
        triggeredBy: options?.userId || 'system',
        contextData: context,
        executedAt: new Date(),
        failedAt: new Date(),
        retryCount: 0,
      });
    }
  }

  /**
   * Check if user's communication preference allows this action
   */
  private checkCommunicationPreference(triggerAction: TriggerAction, user?: User): boolean {
    if (!user) return true; // No user, no preference check

    const userPref = user.communicationPreference || 'email';

    if (triggerAction.requiresEmailPreference && !['email', 'both'].includes(userPref)) {
      return false;
    }

    if (triggerAction.requiresSmsPreference && !['sms', 'both'].includes(userPref)) {
      return false;
    }

    return true;
  }

  /**
   * Evaluate action conditions
   */
  private evaluateConditions(
    conditions: any,
    context: Record<string, any>
  ): boolean {
    if (!conditions) return true;

    // Simple JSON logic evaluation
    // TODO: Implement more sophisticated condition evaluation
    try {
      const conditionObj = typeof conditions === 'string' 
        ? JSON.parse(conditions) 
        : conditions;

      for (const [key, value] of Object.entries(conditionObj)) {
        if (Array.isArray(value)) {
          if (!value.includes(context[key])) return false;
        } else if (context[key] !== value) {
          return false;
        }
      }

      return true;
    } catch {
      return true; // If conditions are invalid, allow execution
    }
  }

  /**
   * Determine recipient based on action type and context
   */
  private determineRecipient(
    actionType: string,
    context: Record<string, any>,
    user?: User
  ): string | null {
    switch (actionType) {
      case 'email':
        return context.recipientEmail || context.email || user?.email || null;
      case 'sms':
        return context.recipientPhone || context.phone || user?.phone || null;
      case 'webhook':
        return context.webhookUrl || 'webhook';
      case 'notification':
        return context.userId || user?.id || null;
      case 'slack':
        return context.slackUserId || 'slack';
      default:
        return null;
    }
  }
}

// Export singleton instance
export const triggerService = new TriggerService();
