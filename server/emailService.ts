import { MailService } from '@sendgrid/mail';
import { db } from './db';
import { emailActivity } from '@shared/schema';

if (!process.env.SENDGRID_API_KEY) {
  throw new Error("SENDGRID_API_KEY environment variable must be set");
}

if (!process.env.SENDGRID_FROM_EMAIL) {
  throw new Error("SENDGRID_FROM_EMAIL environment variable must be set");
}

const mailService = new MailService();
mailService.setApiKey(process.env.SENDGRID_API_KEY);

interface ProspectEmailData {
  firstName: string;
  lastName: string;
  email: string;
  validationToken: string;
  agentName: string;
  dbEnv?: string;
}

interface SignatureRequestData {
  ownerName: string;
  ownerEmail: string;
  companyName: string;
  ownershipPercentage: string;
  signatureToken: string;
  requesterName: string;
  agentName: string;
  dbEnv?: string;
}

interface ApplicationSubmissionData {
  companyName: string;
  applicantName: string;
  applicantEmail: string;
  agentName: string;
  agentEmail: string;
  submissionDate: string;
  applicationToken: string;
  dbEnv?: string;
}

interface PasswordResetEmailData {
  email: string;
  resetToken: string;
  dbEnv?: string;
}

export class EmailService {
  private getBaseUrl(): string {
    // Use the deployed domain or localhost for development
    // Prefer APP_URL but fall back to BASE_URL for backward compatibility
    return process.env.APP_URL || process.env.BASE_URL || 'http://localhost:5000';
  }

  private async logEmailActivity(
    templateName: string,
    recipientEmail: string,
    subject: string,
    status: 'sent' | 'failed',
    errorMessage?: string,
    triggerSource?: string,
    metadata?: any
  ): Promise<void> {
    try {
      await db.insert(emailActivity).values({
        templateName,
        recipientEmail,
        subject,
        status,
        errorMessage: errorMessage || null,
        triggerSource: triggerSource || 'api',
        triggeredBy: 'system',
        metadata: metadata || null,
        sentAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to log email activity:', error);
      // Don't throw error to prevent app crash - just log it
    }
  }

  async sendProspectValidationEmail(data: ProspectEmailData): Promise<boolean> {
    try {
      let validationUrl = `${this.getBaseUrl()}/prospect-validation?token=${data.validationToken}`;
      if (data.dbEnv && data.dbEnv !== 'production') {
        validationUrl += `&db=${data.dbEnv}`;
      }
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Merchant Application - Email Verification</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; background-color: #f9f9f9; }
            .button { display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background-color: #333; color: #ccc; padding: 20px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Merchant Processing Application</h1>
              <p>Email Verification Required</p>
            </div>
            
            <div class="content">
              <h2>Hello ${data.firstName} ${data.lastName},</h2>
              
              <p>Your assigned agent <strong>${data.agentName}</strong> has created a merchant processing application prospect for you.</p>
              
              <p>To proceed with your merchant application, please verify your email address by clicking the button below:</p>
              
              <div style="text-align: center;">
                <a href="${validationUrl}" class="button">Verify Email & Start Application</a>
              </div>
              
              <p>This verification link will expire in 7 days. If you didn't request this application, please ignore this email.</p>
              
              <p>After verification, you'll be directed to complete your merchant processing application with all the necessary forms and documentation.</p>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
              
              <p><strong>What happens next?</strong></p>
              <ul>
                <li>Click the verification link above</li>
                <li>Complete your merchant application forms</li>
                <li>Submit required documentation</li>
                <li>Your agent will review and process your application</li>
              </ul>
              
              <p>If you have any questions, please contact your assigned agent directly.</p>
            </div>
            
            <div class="footer">
              <p>Merchant Processing Services</p>
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Hello ${data.firstName} ${data.lastName},

Your assigned agent ${data.agentName} has created a merchant processing application prospect for you.

To proceed with your merchant application, please verify your email address by visiting:
${validationUrl}

This verification link will expire in 7 days. If you didn't request this application, please ignore this email.

After verification, you'll be directed to complete your merchant processing application with all the necessary forms and documentation.

What happens next?
- Click the verification link above
- Complete your merchant application forms  
- Submit required documentation
- Your agent will review and process your application

If you have any questions, please contact your assigned agent directly.

Merchant Processing Services
This is an automated message. Please do not reply to this email.
      `;

      await mailService.send({
        to: data.email,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: 'Merchant Application - Email Verification Required',
        text: textContent,
        html: htmlContent,
      });

      console.log(`Prospect validation email sent successfully to ${data.email}`);
      return true;
    } catch (error) {
      console.error('Failed to send prospect validation email:', error);
      return false;
    }
  }

  async sendSignatureRequestEmail(data: SignatureRequestData): Promise<boolean> {
    try {
      let signatureUrl = `${this.getBaseUrl()}/signature-request?token=${data.signatureToken}`;
      if (data.dbEnv && data.dbEnv !== 'production') {
        signatureUrl += `&db=${data.dbEnv}`;
      }
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Digital Signature Required - ${data.companyName}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; background-color: #f9f9f9; }
            .signature-box { background-color: white; border: 2px solid #2563eb; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .button { display: inline-block; background-color: #16a34a; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
            .footer { background-color: #333; color: #ccc; padding: 20px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Digital Signature Required</h1>
              <p>Merchant Application for ${data.companyName}</p>
            </div>
            
            <div class="content">
              <h2>Hello ${data.ownerName},</h2>
              
              <p>You are listed as a business owner with <strong>${data.ownershipPercentage}% ownership</strong> in ${data.companyName}. Your digital signature is required to complete the merchant application process.</p>
              
              <div class="signature-box">
                <h3 style="margin-top: 0; color: #2563eb;">What You Need to Do:</h3>
                <ol>
                  <li>Click the secure signature link below</li>
                  <li>Review the complete application details</li>
                  <li>Provide your digital signature to authorize the application</li>
                </ol>
              </div>
              
              <div style="text-align: center;">
                <a href="${signatureUrl}" class="button">Sign Application Now</a>
              </div>
              
              <div class="warning">
                <strong>Important:</strong> This signature request was initiated by ${data.requesterName}. 
                If you have questions about this application, contact your agent ${data.agentName} directly.
              </div>
              
              <p><strong>Security Note:</strong> This link is personalized and secure. It will expire in 7 days for your protection.</p>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
              
              <p style="font-size: 14px; color: #666;">
                This is a legally binding signature request for merchant processing services. 
                By signing, you acknowledge your ownership percentage and authorize the application on behalf of ${data.companyName}.
              </p>
            </div>
            
            <div class="footer">
              <p>Core CRM - Merchant Services Division</p>
              <p>This email was sent to ${data.ownerEmail}</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Digital Signature Required - ${data.companyName}

Hello ${data.ownerName},

You have been requested to provide a digital signature for the merchant application for ${data.companyName}.

Your ownership percentage: ${data.ownershipPercentage}%
Requested by: ${data.requesterName}
Agent: ${data.agentName}

Please click the link below to provide your digital signature:
${signatureUrl}

This link is secure and personalized for you. It will expire in 7 days for your protection.

By signing, you acknowledge your ownership percentage and authorize the application on behalf of ${data.companyName}.

Core CRM - Merchant Services Division
This email was sent to ${data.ownerEmail}
      `;

      await mailService.send({
        to: data.ownerEmail,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: `Signature Required: ${data.companyName} Merchant Application`,
        text: textContent,
        html: htmlContent,
      });

      // Log email activity
      await this.logEmailActivity(
        'signature_request',
        data.ownerEmail,
        `Signature Required: ${data.companyName} Merchant Application`,
        'sent',
        undefined,
        'signature_workflow',
        {
          companyName: data.companyName,
          ownerName: data.ownerName,
          ownershipPercentage: data.ownershipPercentage,
          requesterName: data.requesterName,
          agentName: data.agentName,
          signatureToken: data.signatureToken
        }
      );

      console.log(`Signature request email sent successfully to ${data.ownerEmail}`);
      return true;
    } catch (error: any) {
      console.error('Error sending signature request email:', error);
      if (error.response?.body?.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      
      // Log failed email activity
      await this.logEmailActivity(
        'signature_request',
        data.ownerEmail,
        `Signature Required: ${data.companyName} Merchant Application`,
        'failed',
        error.message || 'Unknown error',
        'signature_workflow',
        {
          companyName: data.companyName,
          ownerName: data.ownerName,
          ownershipPercentage: data.ownershipPercentage,
          requesterName: data.requesterName,
          agentName: data.agentName
        }
      );
      
      return false;
    }
  }

  async sendApplicationSubmissionNotification(data: ApplicationSubmissionData, pdfAttachment?: Buffer): Promise<boolean> {
    try {
      const baseUrl = this.getBaseUrl();
      let statusUrl = `${baseUrl}/application-status/${data.applicationToken}`;
      if (data.dbEnv && data.dbEnv !== 'production') {
        statusUrl += `?db=${data.dbEnv}`;
      }
      
      // Email to merchant with PDF attachment
      const merchantMsg = {
        to: data.applicantEmail,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: `Application Submitted Successfully - ${data.companyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">Application Successfully Submitted</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${data.companyName}</p>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Dear ${data.applicantName},</p>
              
              <p style="color: #555; line-height: 1.6;">
                Thank you for submitting your merchant application for <strong>${data.companyName}</strong>. 
                Your application has been received and is now under review.
              </p>
              
              <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #059669;">Next Steps</h3>
                <p style="margin: 5px 0; color: #555;">✓ Your application has been submitted</p>
                <p style="margin: 5px 0; color: #555;">• Your assigned agent will review your application</p>
                <p style="margin: 5px 0; color: #555;">• You will be contacted within 2-3 business days</p>
                <p style="margin: 5px 0; color: #555;">• Track your application status anytime using the link below</p>
              </div>
              
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #1e40af;">Application Details</h3>
                <p style="margin: 5px 0; color: #555;"><strong>Company:</strong> ${data.companyName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Submission Date:</strong> ${data.submissionDate}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Assigned Agent:</strong> ${data.agentName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Application ID:</strong> ${data.applicationToken}</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${statusUrl}" 
                   style="background: #3b82f6; color: white; padding: 15px 30px; text-decoration: none; 
                          border-radius: 8px; font-weight: bold; display: inline-block;">
                  Check Application Status
                </a>
              </div>
              
              <p style="color: #555; line-height: 1.6; margin-top: 20px;">
                A copy of your completed application is attached to this email for your records. 
                Please save this document as it contains your digital signatures and all submitted information.
              </p>
            </div>
            
            <div style="background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px;">
              <p style="margin: 0;">Keep this email for your records. Your application ID: ${data.applicationToken}</p>
              <p style="margin: 5px 0 0 0;">© ${new Date().getFullYear()} Core CRM. All rights reserved.</p>
            </div>
          </div>
        `,
        attachments: pdfAttachment ? [{
          content: pdfAttachment.toString('base64'),
          filename: `${data.companyName}_Application_${data.submissionDate.replace(/\//g, '-')}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment'
        }] : []
      };

      // Email to agent notification
      const agentMsg = {
        to: data.agentEmail,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: `New Application Submitted - ${data.companyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; padding: 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">New Application Submitted</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Requires Your Review</p>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Hello ${data.agentName},</p>
              
              <p style="color: #555; line-height: 1.6;">
                A new merchant application has been submitted and assigned to you for review.
              </p>
              
              <div style="background: #faf5ff; border-left: 4px solid #a855f7; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #7c3aed;">Application Details</h3>
                <p style="margin: 5px 0; color: #555;"><strong>Company:</strong> ${data.companyName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Applicant:</strong> ${data.applicantName}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Email:</strong> ${data.applicantEmail}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Submitted:</strong> ${data.submissionDate}</p>
                <p style="margin: 5px 0; color: #555;"><strong>Application ID:</strong> ${data.applicationToken}</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${baseUrl}/agent-dashboard" 
                   style="background: #7c3aed; color: white; padding: 15px 30px; text-decoration: none; 
                          border-radius: 8px; font-weight: bold; display: inline-block;">
                  Review Application
                </a>
              </div>
              
              <p style="color: #555; line-height: 1.6;">
                Please review this application promptly and contact the applicant within 2-3 business days 
                to proceed with the next steps in the approval process.
              </p>
            </div>
            
            <div style="background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px;">
              <p style="margin: 0;">This notification was sent automatically when the application was submitted.</p>
              <p style="margin: 5px 0 0 0;">© ${new Date().getFullYear()} Core CRM. All rights reserved.</p>
            </div>
          </div>
        `
      };

      // Send both emails
      await Promise.all([
        mailService.send(merchantMsg),
        mailService.send(agentMsg)
      ]);

      return true;
    } catch (error) {
      console.error('SendGrid application submission notification error:', error);
      return false;
    }
  }

  async sendPasswordResetEmail(data: PasswordResetEmailData): Promise<boolean> {
    try {
      let resetUrl = `${this.getBaseUrl()}/auth/reset-password?token=${data.resetToken}`;
      if (data.dbEnv && data.dbEnv !== 'production') {
        resetUrl += `&db=${data.dbEnv}`;
      }

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Password Reset - CoreCRM</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; background-color: #f9f9f9; }
            .button { display: inline-block; background-color: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { background-color: #333; color: #ccc; padding: 20px; text-align: center; font-size: 12px; }
            .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
              <p>CoreCRM Account Security</p>
            </div>
            
            <div class="content">
              <h2>Reset Your Password</h2>
              
              <p>You requested a password reset for your CoreCRM account.</p>
              
              <p>Click the button below to reset your password:</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              
              <div class="warning">
                <strong>Important:</strong> This link will expire in 1 hour for your security.
              </div>
              
              <p>If you didn't request this reset, please ignore this email and your password will remain unchanged.</p>
              
              ${data.dbEnv && data.dbEnv !== 'production' ? `<p><em>Note: This reset is for the ${data.dbEnv} database environment.</em></p>` : ''}
            </div>
            
            <div class="footer">
              <p>CoreCRM - Secure Payment Management Platform</p>
              <p>This email was sent to ${data.email}</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Password Reset Request - CoreCRM

You requested a password reset for your CoreCRM account.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour for your security.

If you didn't request this reset, please ignore this email and your password will remain unchanged.

${data.dbEnv && data.dbEnv !== 'production' ? `Note: This reset is for the ${data.dbEnv} database environment.` : ''}

CoreCRM - Secure Payment Management Platform
This email was sent to ${data.email}
      `;

      await mailService.send({
        to: data.email,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: 'CoreCRM Password Reset Request',
        text: textContent,
        html: htmlContent,
      });

      // Log email activity to database
      await this.logEmailActivity(
        'password_reset',
        data.email,
        'CoreCRM Password Reset Request',
        'sent',
        undefined,
        'password_reset_request',
        {
          resetToken: data.resetToken,
          dbEnv: data.dbEnv,
          resetUrl: resetUrl
        }
      );

      console.log(`Password reset email sent successfully to ${data.email}`);
      return true;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      
      // Log failed email activity
      await this.logEmailActivity(
        'password_reset',
        data.email,
        'CoreCRM Password Reset Request',
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
        'password_reset_request'
      );
      
      return false;
    }
  }
}

export const emailService = new EmailService();