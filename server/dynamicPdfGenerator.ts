import type { ProspectApplicationWithDetails, AcquirerApplicationTemplate, MerchantProspectWithAgent, Acquirer } from '../shared/schema';
import * as htmlPdf from 'html-pdf-node';

interface FieldConfiguration {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  validation?: any;
  section?: string;
}

export class DynamicPDFGenerator {
  async generateApplicationPDF(
    application: ProspectApplicationWithDetails,
    template: AcquirerApplicationTemplate,
    prospect: MerchantProspectWithAgent,
    acquirer: Acquirer
  ): Promise<Buffer> {
    console.log(`Generating dynamic PDF for application ${application.id} using template ${template.templateName}`);
    
    try {
      // Parse field configuration and application data
      const fieldConfig = template.fieldConfiguration as FieldConfiguration[];
      const applicationData = application.applicationData as Record<string, any>;
      
      // Generate HTML content using the template structure
      const htmlContent = this.generateHTMLContent(
        application,
        template,
        prospect,
        acquirer,
        fieldConfig,
        applicationData
      );
      
      // Convert HTML to PDF using html-pdf-node
      const options = {
        format: 'A4',
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        },
        printBackground: true
      };
      
      const file = { content: htmlContent };
      const pdfBuffer = await htmlPdf.generatePdf(file, options);
      
      console.log(`Successfully generated PDF for application ${application.id}`);
      return pdfBuffer;
      
    } catch (error) {
      console.error('Dynamic PDF generation failed:', error);
      // Fallback to minimal PDF
      return this.createMinimalPDF(prospect.firstName + ' ' + prospect.lastName, acquirer.name);
    }
  }

  private generateHTMLContent(
    application: ProspectApplicationWithDetails,
    template: AcquirerApplicationTemplate,
    prospect: MerchantProspectWithAgent,
    acquirer: Acquirer,
    fieldConfig: FieldConfiguration[],
    applicationData: Record<string, any>
  ): string {
    const cleanText = (text: string | null | undefined) => 
      (text || '').replace(/[<>&"']/g, (match) => {
        const entities: { [key: string]: string } = {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&#39;'
        };
        return entities[match];
      });

    const formatDate = (date: Date | string | null) => {
      if (!date) return 'Not provided';
      const d = new Date(date);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const getStatusBadge = (status: string) => {
      const statusColors = {
        draft: '#6b7280',
        in_progress: '#3b82f6',
        submitted: '#8b5cf6',
        approved: '#059669',
        rejected: '#ef4444'
      };
      const color = statusColors[status as keyof typeof statusColors] || '#6b7280';
      return `<span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600;">${status.replace('_', ' ').toUpperCase()}</span>`;
    };

    // Group fields by section
    const sections = this.groupFieldsBySection(fieldConfig, applicationData);
    const sectionsHTML = this.generateSectionsHTML(sections);

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${acquirer.name} Application - ${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif; 
          margin: 0; 
          padding: 0; 
          color: #111827; 
          background: #ffffff;
          line-height: 1.6;
          font-size: 13px;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          min-height: 100vh;
          padding: 40px;
        }
        .header-section { 
          margin-bottom: 32px; 
          padding-bottom: 24px;
          border-bottom: 2px solid #e5e7eb;
        }
        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }
        .applicant-name { 
          font-size: 28px; 
          font-weight: 700; 
          color: #111827; 
          margin: 0;
          line-height: 1.2;
        }
        .application-subtitle { 
          font-size: 16px; 
          color: #6b7280; 
          margin: 8px 0 0 0;
          font-weight: 400;
        }
        .acquirer-name {
          font-size: 18px;
          color: #059669;
          font-weight: 600;
          margin: 4px 0 0 0;
        }
        .status-badge {
          text-align: right;
        }
        .card { 
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          margin-bottom: 24px; 
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .card-header { 
          background: linear-gradient(to right, #f8fafc, #f1f5f9);
          padding: 20px 24px;
          border-bottom: 1px solid #e2e8f0;
        }
        .card-title { 
          font-size: 18px; 
          font-weight: 600; 
          color: #0f172a; 
          margin: 0;
          display: flex;
          align-items: center;
        }
        .card-content { 
          padding: 24px; 
        }
        .field-grid { 
          display: grid; 
          grid-template-columns: 1fr 1fr; 
          gap: 24px; 
        }
        .field-item { 
          margin-bottom: 20px; 
        }
        .field-label { 
          font-size: 11px; 
          color: #64748b; 
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
          display: block;
          font-weight: 600;
        }
        .field-value { 
          color: #0f172a; 
          font-weight: 500;
          font-size: 14px;
          word-wrap: break-word;
        }
        .field-value-large {
          font-size: 18px;
          font-weight: 600;
          color: #1e293b;
        }
        .field-value-empty {
          color: #9ca3af;
          font-style: italic;
        }
        .timeline-item { 
          display: flex; 
          justify-content: space-between; 
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid #f1f5f9;
        }
        .timeline-item:last-child {
          border-bottom: none;
        }
        .timeline-label { 
          font-size: 13px; 
          color: #64748b; 
          font-weight: 500;
        }
        .timeline-value { 
          font-size: 13px; 
          font-weight: 600;
          color: #0f172a;
        }
        .footer-section { 
          margin-top: 48px; 
          padding-top: 24px; 
          border-top: 2px solid #e5e7eb; 
          font-size: 12px; 
          color: #64748b;
          text-align: center;
        }
        .footer-section p {
          margin: 8px 0;
        }
        .page-break { 
          page-break-before: always; 
        }
        @media print {
          .container {
            background: white;
            box-shadow: none;
          }
          .card {
            box-shadow: none;
            border: 1px solid #d1d5db;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header Section -->
        <div class="header-section">
          <div class="header-top">
            <div>
              <h1 class="applicant-name">${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}</h1>
              <p class="application-subtitle">${cleanText(template.templateName)}</p>
              <p class="acquirer-name">${cleanText(acquirer.name)}</p>
            </div>
            <div class="status-badge">
              ${getStatusBadge(application.status)}
            </div>
          </div>
        </div>

        <!-- Application Timeline Card -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Application Timeline</h2>
          </div>
          <div class="card-content">
            <div class="timeline-item">
              <span class="timeline-label">Application Created</span>
              <span class="timeline-value">${formatDate(application.createdAt)}</span>
            </div>
            <div class="timeline-item">
              <span class="timeline-label">Last Updated</span>
              <span class="timeline-value">${formatDate(application.updatedAt)}</span>
            </div>
            ${application.submittedAt ? `
            <div class="timeline-item">
              <span class="timeline-label">Submitted</span>
              <span class="timeline-value">${formatDate(application.submittedAt)}</span>
            </div>` : ''}
            ${application.approvedAt ? `
            <div class="timeline-item">
              <span class="timeline-label">Approved</span>
              <span class="timeline-value">${formatDate(application.approvedAt)}</span>
            </div>` : ''}
            ${application.rejectedAt ? `
            <div class="timeline-item">
              <span class="timeline-label">Rejected</span>
              <span class="timeline-value">${formatDate(application.rejectedAt)}</span>
            </div>` : ''}
          </div>
        </div>

        <!-- Contact Information Card -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Contact Information</h2>
          </div>
          <div class="card-content">
            <div class="field-grid">
              <div class="field-item">
                <span class="field-label">Name</span>
                <div class="field-value field-value-large">${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}</div>
              </div>
              <div class="field-item">
                <span class="field-label">Email</span>
                <div class="field-value">${cleanText(prospect.email)}</div>
              </div>
              <div class="field-item">
                <span class="field-label">Phone</span>
                <div class="field-value">${cleanText(prospect.phone) || 'Not provided'}</div>
              </div>
              <div class="field-item">
                <span class="field-label">Assigned Agent</span>
                <div class="field-value">${cleanText(prospect.agent?.firstName || '')} ${cleanText(prospect.agent?.lastName || '')}</div>
              </div>
            </div>
          </div>
        </div>

        ${sectionsHTML}

        <!-- Footer Section -->
        <div class="footer-section">
          <p><strong>${cleanText(acquirer.name)} Application</strong></p>
          <p>Generated on ${formatDate(new Date())} | Template: ${cleanText(template.templateName)} v${cleanText(template.version)}</p>
          <p>Application ID: ${application.id} | Prospect ID: ${prospect.id}</p>
        </div>
      </div>
    </body>
    </html>`;
  }

  private groupFieldsBySection(
    fieldConfig: FieldConfiguration[], 
    applicationData: Record<string, any>
  ): Record<string, Array<{ field: FieldConfiguration; value: any }>> {
    const sections: Record<string, Array<{ field: FieldConfiguration; value: any }>> = {};
    
    fieldConfig.forEach(field => {
      const sectionName = field.section || 'General Information';
      if (!sections[sectionName]) {
        sections[sectionName] = [];
      }
      
      sections[sectionName].push({
        field,
        value: applicationData[field.id]
      });
    });
    
    return sections;
  }

  private generateSectionsHTML(sections: Record<string, Array<{ field: FieldConfiguration; value: any }>>): string {
    return Object.entries(sections).map(([sectionName, fields]) => {
      const fieldsHTML = fields.map(({ field, value }) => 
        this.generateFieldHTML(field, value)
      ).join('');
      
      return `
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${this.cleanText(sectionName)}</h2>
          </div>
          <div class="card-content">
            <div class="field-grid">
              ${fieldsHTML}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  private generateFieldHTML(field: FieldConfiguration, value: any): string {
    const cleanValue = this.formatFieldValue(field, value);
    const isEmpty = !value || (Array.isArray(value) && value.length === 0) || value === '';
    
    return `
      <div class="field-item">
        <span class="field-label">${this.cleanText(field.label)}</span>
        <div class="field-value ${isEmpty ? 'field-value-empty' : ''}">
          ${isEmpty ? 'Not provided' : cleanValue}
        </div>
      </div>
    `;
  }

  private formatFieldValue(field: FieldConfiguration, value: any): string {
    if (!value) return 'Not provided';
    
    switch (field.type) {
      case 'date':
        return new Date(value).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      case 'currency':
        const num = parseFloat(value.toString().replace(/[^0-9.]/g, ''));
        return isNaN(num) ? value : `$${num.toLocaleString()}`;
      case 'percentage':
        return `${value}%`;
      case 'checkbox':
        return value ? '✓ Yes' : '✗ No';
      case 'array':
        return Array.isArray(value) ? value.join(', ') : value;
      default:
        return this.cleanText(value.toString());
    }
  }

  private cleanText(text: string | null | undefined): string {
    return (text || '').replace(/[<>&"']/g, (match) => {
      const entities: { [key: string]: string } = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[match];
    });
  }

  private createMinimalPDF(applicantName: string, acquirerName: string): Buffer {
    const minimalHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Application PDF - ${applicantName}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        .header { text-align: center; margin-bottom: 40px; }
        .content { max-width: 600px; margin: 0 auto; }
      </style>
    </head>
    <body>
      <div class="content">
        <div class="header">
          <h1>${applicantName}</h1>
          <h2>${acquirerName} Application</h2>
          <p>PDF Generation Error - Minimal Version</p>
        </div>
        <p>There was an issue generating the detailed PDF. Please contact support for assistance.</p>
      </div>
    </body>
    </html>`;
    
    // Return a simple buffer for fallback
    return Buffer.from(minimalHTML, 'utf-8');
  }
}