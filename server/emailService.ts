import { MailService } from '@sendgrid/mail';

const SENDGRID_ENABLED = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);

if (!SENDGRID_ENABLED) {
  console.warn("Warning: SENDGRID_API_KEY or SENDGRID_FROM_EMAIL not set. Email sending will be disabled.");
}

const mailService = new MailService();
if (SENDGRID_ENABLED) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY!);
}

interface ProspectEmailData {
  firstName: string;
  lastName: string;
  email: string;
  validationToken: string;
  agentName: string;
}

interface SignatureRequestData {
  ownerName: string;
  ownerEmail: string;
  companyName: string;
  ownershipPercentage: string;
  signatureToken: string;
  requesterName: string;
  agentName: string;
}

interface ApplicationSubmissionData {
  companyName: string;
  applicantName: string;
  applicantEmail: string;
  agentName: string;
  agentEmail: string;
  submissionDate: string;
  applicationToken: string;
}

export class EmailService {
  private getBaseUrl(): string {
    // Use the current domain or localhost for development
    return process.env.BASE_URL || 'http://localhost:5000';
  }

  async sendProspectValidationEmail(data: ProspectEmailData): Promise<boolean> {
    try {
      const validationUrl = `${this.getBaseUrl()}/prospect-validation?token=${data.validationToken}`;
      
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

      if (!SENDGRID_ENABLED) {
        console.log(`[Email disabled] Would send prospect validation email to ${data.email}`);
        return false;
      }

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
      const signatureUrl = `${this.getBaseUrl()}/signature-request?token=${data.signatureToken}`;
      
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
              
              <p><strong>Security Note:</strong> This link is personalized and secure. It will expire in 30 days for your protection.</p>
              
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

This link is secure and personalized for you. It will expire in 30 days for your protection.

By signing, you acknowledge your ownership percentage and authorize the application on behalf of ${data.companyName}.

Core CRM - Merchant Services Division
This email was sent to ${data.ownerEmail}
      `;

      if (!SENDGRID_ENABLED) {
        console.log(`[Email disabled] Would send signature request email to ${data.ownerEmail}`);
        return false;
      }

      await mailService.send({
        to: data.ownerEmail,
        from: process.env.SENDGRID_FROM_EMAIL!,
        subject: `Signature Required: ${data.companyName} Merchant Application`,
        text: textContent,
        html: htmlContent,
      });

      return true;
    } catch (error: any) {
      console.error('Error sending signature request email:', error);
      if (error.response?.body?.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      return false;
    }
  }

  async sendApplicationSubmissionNotification(data: ApplicationSubmissionData, pdfAttachment?: Buffer): Promise<boolean> {
    try {
      const baseUrl = this.getBaseUrl();
      const statusUrl = `${baseUrl}/application-status/${data.applicationToken}`;
      
      // Email to merchant with PDF attachment
      const merchantMsg = {
        to: data.applicantEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@corecrm.com',
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
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@corecrm.com',
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

      if (!SENDGRID_ENABLED) {
        console.log(`[Email disabled] Would send application submission notifications for ${data.companyName}`);
        return false;
      }

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

  async sendPortalInviteEmail(data: { firstName: string; lastName: string; email: string; statusUrl: string; agentName: string }): Promise<boolean> {
    const { firstName, lastName, email, statusUrl, agentName } = data;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">Your Applicant Portal is Ready</h1>
        </div>
        <div style="padding: 30px; background: #ffffff;">
          <p>Hi ${firstName} ${lastName},</p>
          <p>Your advisor <strong>${agentName}</strong> has invited you to set up your applicant portal account. The portal lets you:</p>
          <ul>
            <li>Track your application status in real time</li>
            <li>Message your advisor directly</li>
            <li>Upload requested documents securely</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${statusUrl}" style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">Set Up My Portal Account</a>
          </div>
          <p style="color: #6b7280; font-size: 13px;">This link is tied to your application and will take you directly to the setup form. If you have questions, reply to your advisor directly.</p>
        </div>
        <div style="background: #f9fafb; padding: 16px; text-align: center; color: #6b7280; font-size: 12px;">
          © ${new Date().getFullYear()} Core CRM. Secure applicant portal.
        </div>
      </div>`;
    const text = `Hi ${firstName} ${lastName},\n\n${agentName} has invited you to set up your applicant portal account.\n\nVisit: ${statusUrl}\n\nCore CRM`;
    if (!SENDGRID_ENABLED) { console.log(`[Email disabled] Portal invite to ${email}`); return false; }
    try {
      await mailService.send({ to: email, from: process.env.SENDGRID_FROM_EMAIL!, subject: 'Your Applicant Portal Invitation', html, text });
      return true;
    } catch (err) { console.error('Portal invite email error:', err); return false; }
  }

  async sendNewMessageNotification(data: { firstName: string; lastName: string; email: string; portalUrl: string; agentName: string; subject?: string }): Promise<boolean> {
    const { firstName, email, portalUrl, agentName, subject } = data;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2563eb; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">New Message from Your Advisor</h1>
        </div>
        <div style="padding: 28px; background: #ffffff;">
          <p>Hi ${firstName},</p>
          <p><strong>${agentName}</strong> sent you a message${subject ? ` regarding <em>${subject}</em>` : ''} on your application portal.</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${portalUrl}" style="background: #2563eb; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Message &amp; Reply</a>
          </div>
        </div>
        <div style="padding: 14px; text-align: center; color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} Core CRM</div>
      </div>`;
    const text = `Hi ${firstName},\n\n${agentName} sent you a message on your application portal.\n\nLog in to reply: ${portalUrl}\n\nCore CRM`;
    if (!SENDGRID_ENABLED) { console.log(`[Email disabled] Message notification to ${email}`); return false; }
    try {
      await mailService.send({ to: email, from: process.env.SENDGRID_FROM_EMAIL!, subject: `New message from ${agentName}`, html, text });
      return true;
    } catch (err) { console.error('Message notification email error:', err); return false; }
  }

  async sendFileRequestNotification(data: { firstName: string; lastName: string; email: string; portalUrl: string; agentName: string; label: string }): Promise<boolean> {
    const { firstName, email, portalUrl, agentName, label } = data;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #7c3aed; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">Document Requested</h1>
        </div>
        <div style="padding: 28px; background: #ffffff;">
          <p>Hi ${firstName},</p>
          <p><strong>${agentName}</strong> has requested a document from you: <strong>${label}</strong></p>
          <p>Please log in to your portal to upload it at your earliest convenience.</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${portalUrl}" style="background: #7c3aed; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">Upload Document</a>
          </div>
        </div>
        <div style="padding: 14px; text-align: center; color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} Core CRM</div>
      </div>`;
    const text = `Hi ${firstName},\n\n${agentName} has requested: ${label}\n\nUpload it here: ${portalUrl}\n\nCore CRM`;
    if (!SENDGRID_ENABLED) { console.log(`[Email disabled] File request notification to ${email}`); return false; }
    try {
      await mailService.send({ to: email, from: process.env.SENDGRID_FROM_EMAIL!, subject: `Document requested: ${label}`, html, text });
      return true;
    } catch (err) { console.error('File request notification email error:', err); return false; }
  }

  async sendMagicLinkEmail(data: { firstName: string; email: string; magicUrl: string }): Promise<boolean> {
    const { firstName, email, magicUrl } = data;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); color: white; padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">One-Click Sign In</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Applicant Portal</p>
        </div>
        <div style="padding: 30px; background: #ffffff;">
          <p>Hi ${firstName},</p>
          <p>Click the button below to sign in to your applicant portal instantly — no password required. This link is valid for 24 hours and can only be used once.</p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${magicUrl}" style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Sign In to My Portal</a>
          </div>
          <p style="color: #dc2626; font-size: 13px;"><strong>Security notice:</strong> If you didn't request this link, you can ignore this email. Do not share this link with anyone.</p>
        </div>
        <div style="padding: 14px; text-align: center; color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} Core CRM · Secure applicant portal</div>
      </div>`;
    const text = `Hi ${firstName},\n\nClick to sign in (valid 24h, single use):\n${magicUrl}\n\nIf you didn't request this, ignore this email.\n\nCore CRM`;
    if (!SENDGRID_ENABLED) { console.log(`[Email disabled] Magic link to ${email}: ${magicUrl}`); return false; }
    try {
      await mailService.send({ to: email, from: process.env.SENDGRID_FROM_EMAIL!, subject: 'Your applicant portal sign-in link', html, text });
      return true;
    } catch (err) { console.error('Magic link email error:', err); return false; }
  }

  async sendUnderwritingTransitionEmail(data: {
    to: string; firstName?: string; applicationId: number;
    fromStatus: string | null; toStatus: string; statusLabel: string;
    reason?: string; reviewUrl: string;
  }): Promise<boolean> {
    const { to, firstName, applicationId, fromStatus, toStatus, statusLabel, reason, reviewUrl } = data;
    const subject = `Application #${applicationId} status: ${toStatus} · ${statusLabel}`;
    const greeting = firstName ? `Hi ${firstName},` : "Hello,";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background:#1f2937;color:white;padding:24px;text-align:center;">
          <h1 style="margin:0;font-size:20px;">Underwriting Update</h1>
        </div>
        <div style="padding:24px;background:#fff;">
          <p>${greeting}</p>
          <p>Application <strong>#${applicationId}</strong> moved
            ${fromStatus ? `from <strong>${fromStatus}</strong> ` : ""}
            to <strong>${toStatus}</strong> (${statusLabel}).</p>
          ${reason ? `<p style="background:#f3f4f6;padding:12px;border-radius:6px;">${reason}</p>` : ""}
          <div style="text-align:center;margin:24px 0;">
            <a href="${reviewUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">Open Review</a>
          </div>
        </div>
        <div style="padding:12px;text-align:center;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} Core CRM</div>
      </div>`;
    const text = `${greeting}\n\nApplication #${applicationId} moved ${fromStatus ? `from ${fromStatus} ` : ""}to ${toStatus} (${statusLabel}).\n${reason ? `\nReason: ${reason}\n` : ""}\nOpen review: ${reviewUrl}`;
    if (!SENDGRID_ENABLED) { console.log(`[Email disabled] Underwriting transition to ${to}: app #${applicationId} → ${toStatus}`); return false; }
    try {
      await mailService.send({ to, from: process.env.SENDGRID_FROM_EMAIL!, subject, html, text });
      return true;
    } catch (err) { console.error("Underwriting transition email error:", err); return false; }
  }
}

export const emailService = new EmailService();