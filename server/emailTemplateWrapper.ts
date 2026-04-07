/**
 * Email Template Wrapper Utility
 * 
 * Provides consistent, professional email templates for all automated emails
 * with customizable headers, content, and styling.
 */

export interface EmailTemplateOptions {
  headerTitle: string;
  headerSubtitle?: string;
  headerGradient?: string; // Default: green gradient
  recipientName?: string;
  content: string; // Main HTML content
  callToAction?: {
    text: string;
    url: string;
    color?: string; // Default: blue
  };
  infoBoxes?: Array<{
    title: string;
    items: Array<{ label: string; value: string }>;
    color?: 'green' | 'purple' | 'blue' | 'gray';
  }>;
  footer?: string;
}

/**
 * Wrap email content in a professional, branded template
 */
export function wrapEmailTemplate(options: EmailTemplateOptions): string {
  const {
    headerTitle,
    headerSubtitle,
    headerGradient = 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    recipientName,
    content,
    callToAction,
    infoBoxes = [],
    footer
  } = options;

  // Color schemes for info boxes
  const colorSchemes = {
    green: {
      background: '#f0fdf4',
      border: '#10b981',
      titleColor: '#059669'
    },
    purple: {
      background: '#faf5ff',
      border: '#a855f7',
      titleColor: '#7c3aed'
    },
    blue: {
      background: '#eff6ff',
      border: '#3b82f6',
      titleColor: '#1e40af'
    },
    gray: {
      background: '#f8fafc',
      border: '#e2e8f0',
      titleColor: '#1e40af'
    }
  };

  const greeting = recipientName ? `<p style="font-size: 16px; color: #333; margin-bottom: 20px;">Dear ${recipientName},</p>` : '';
  
  const infoBoxesHtml = infoBoxes.map(box => {
    const scheme = colorSchemes[box.color || 'gray'];
    const itemsHtml = box.items.map(item => 
      `<p style="margin: 5px 0; color: #555;"><strong>${item.label}:</strong> ${item.value}</p>`
    ).join('');
    
    return `
      <div style="background: ${scheme.background}; border-left: 4px solid ${scheme.border}; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 10px 0; color: ${scheme.titleColor};">${box.title}</h3>
        ${itemsHtml}
      </div>
    `;
  }).join('');

  const ctaHtml = callToAction ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${callToAction.url}" 
         style="background: ${callToAction.color || '#3b82f6'}; color: white; padding: 15px 30px; text-decoration: none; 
                border-radius: 8px; font-weight: bold; display: inline-block;">
        ${callToAction.text}
      </a>
    </div>
  ` : '';

  const footerHtml = footer || `
    <div style="background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px;">
      <p style="margin: 0;">This email was sent by Core CRM automated notification system.</p>
      <p style="margin: 5px 0 0 0;">© ${new Date().getFullYear()} Core CRM. All rights reserved.</p>
    </div>
  `;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${headerGradient}; color: white; padding: 30px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">${headerTitle}</h1>
        ${headerSubtitle ? `<p style="margin: 10px 0 0 0; opacity: 0.9;">${headerSubtitle}</p>` : ''}
      </div>
      
      <div style="padding: 30px; background: #ffffff;">
        ${greeting}
        ${content}
        ${infoBoxesHtml}
        ${ctaHtml}
      </div>
      
      ${footerHtml}
    </div>
  `;
}

/**
 * Pre-configured templates for common email types
 */
export const EmailTemplates = {
  /**
   * Welcome email template with green gradient
   */
  welcome(options: Omit<EmailTemplateOptions, 'headerGradient'>) {
    return wrapEmailTemplate({
      ...options,
      headerGradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
    });
  },

  /**
   * Agent notification template with purple gradient
   */
  agentNotification(options: Omit<EmailTemplateOptions, 'headerGradient'>) {
    return wrapEmailTemplate({
      ...options,
      headerGradient: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)'
    });
  },

  /**
   * Security/Alert template with blue gradient
   */
  security(options: Omit<EmailTemplateOptions, 'headerGradient'>) {
    return wrapEmailTemplate({
      ...options,
      headerGradient: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)'
    });
  },

  /**
   * Notification template with teal gradient
   */
  notification(options: Omit<EmailTemplateOptions, 'headerGradient'>) {
    return wrapEmailTemplate({
      ...options,
      headerGradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)'
    });
  }
};

/**
 * Gradient presets for wrapper types
 */
const WRAPPER_GRADIENTS: Record<string, string> = {
  welcome: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
  agentNotification: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
  security: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
  notification: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
  custom: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)' // Default for custom
};

/**
 * Email template configuration from database
 */
export interface EmailTemplateConfig {
  subject: string;
  htmlContent: string;
  useWrapper: boolean;
  wrapperType: string;
  headerGradient?: string | null;
  headerSubtitle?: string | null;
  ctaButtonText?: string | null;
  ctaButtonUrl?: string | null;
  ctaButtonColor?: string | null;
  customFooter?: string | null;
}

/**
 * Apply email wrapper to template content based on configuration
 */
export function applyEmailWrapper(
  template: EmailTemplateConfig,
  variables: Record<string, string> = {}
): string {
  // If wrapper is disabled, return content as-is
  if (!template.useWrapper) {
    return template.htmlContent;
  }

  // Replace variables in content
  let content = template.htmlContent;
  Object.entries(variables).forEach(([key, value]) => {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });

  // Determine header gradient
  const gradient = template.wrapperType === 'custom' && template.headerGradient
    ? template.headerGradient
    : WRAPPER_GRADIENTS[template.wrapperType] || WRAPPER_GRADIENTS.notification;

  // Build wrapper options
  const wrapperOptions: EmailTemplateOptions = {
    headerTitle: template.subject,
    headerSubtitle: template.headerSubtitle || undefined,
    headerGradient: gradient,
    recipientName: variables.firstName && variables.lastName 
      ? `${variables.firstName} ${variables.lastName}`
      : variables.firstName || undefined,
    content: content
  };

  // Add call-to-action if configured
  if (template.ctaButtonText && template.ctaButtonUrl) {
    wrapperOptions.callToAction = {
      text: template.ctaButtonText,
      url: template.ctaButtonUrl,
      color: template.ctaButtonColor || undefined
    };
  }

  // Add custom footer if configured
  if (template.customFooter) {
    wrapperOptions.footer = template.customFooter;
  }

  return wrapEmailTemplate(wrapperOptions);
}
