import type { MerchantProspect } from '../shared/schema';

interface FormData {
  assignedAgent: string;
  companyEmail: string;
  companyName: string;
  companyPhone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  addressLine2?: string;
  federalTaxId: string;
  businessType: string;
  yearsInBusiness: string;
  owners: Array<{
    name: string;
    email: string;
    percentage: string;
    signature?: string;
    signatureType?: string;
  }>;
  businessDescription: string;
  productsServices: string;
  processingMethod: string;
  monthlyVolume: string;
  averageTicket: string;
  highestTicket: string;
}

export class PDFGenerator {
  async generateApplicationPDF(prospect: MerchantProspect, formData: FormData): Promise<Buffer> {
    console.log('Generating beautiful application PDF for prospect:', prospect.id);
    
    try {
      // Use the existing working method with enhanced formatting
      const sections = this.createContentSections(prospect, formData);
      const pages = this.distributeContentAcrossPages(sections);
      const pdfContent = this.buildMultiPagePDF(pages);
      return Buffer.from(pdfContent, 'binary');
    } catch (error) {
      console.error('PDF generation failed:', error);
      return this.createMinimalPDF(formData.companyName);
    }
  }

  private createModernFormattedPDF(prospect: MerchantProspect, formData: FormData): string {
    const cleanText = (text: string) => text?.replace(/[()]/g, '') || '';
    const formatCurrency = (value: string) => {
      if (!value) return 'Not specified';
      const num = parseFloat(value.replace(/[^0-9.]/g, ''));
      return isNaN(num) ? value : `$${num.toLocaleString()}`;
    };
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    // Generate a beautiful card-based PDF layout
    return this.generateModernCardLayout(prospect, formData, cleanText, formatCurrency, formatDate);
  }

  private generateModernCardLayout(prospect: MerchantProspect, formData: FormData, cleanText: Function, formatCurrency: Function, formatDate: Function): string {
    // Create PDF header with proper structure
    let pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Resources <<
  /Font <<
    /F1 4 0 R
    /F2 5 0 R
  >>
>>
/Contents 6 0 R
>>
endobj

4 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica-Bold
>>
endobj

6 0 obj
<<
/Length 7 0 R
>>
stream
BT
/F2 24 Tf
50 720 Td
(${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}) Tj

/F1 12 Tf
0 -25 Td
(Merchant Application Review) Tj

/F1 10 Tf
350 25 Td
(Status: ${prospect.status.replace('_', ' ').toUpperCase()}) Tj

% Application Timeline Card
50 650 m
550 650 l
550 580 l
50 580 l
h
S

/F2 14 Tf
-350 -45 Td
(Application Timeline) Tj

/F1 11 Tf
0 -20 Td
(Created: ${formatDate(prospect.createdAt)}) Tj
0 -15 Td
(Updated: ${formatDate(prospect.updatedAt)}) Tj
${prospect.validatedAt ? `0 -15 Td (Validated: ${formatDate(prospect.validatedAt)}) Tj` : ''}

% Contact Information Card
0 -50 Td
50 520 m
550 520 l
550 460 l
50 460 l
h
S

/F2 14 Tf
10 40 Td
(Contact Information) Tj

/F1 11 Tf
0 -20 Td
(Email: ${cleanText(prospect.email)}) Tj
${formData.companyPhone ? `0 -15 Td (Phone: ${cleanText(formData.companyPhone)}) Tj` : ''}
0 -15 Td
(Agent: ${cleanText(formData.assignedAgent)}) Tj

% Business Information Card
${formData.companyName ? `
0 -50 Td
50 420 m
550 420 l
550 320 l
50 320 l
h
S

/F2 14 Tf
10 80 Td
(Business Information) Tj

/F2 16 Tf
0 -25 Td
(${cleanText(formData.companyName)}) Tj

/F1 11 Tf
0 -20 Td
${formData.businessType ? `(Type: ${cleanText(formData.businessType)}) Tj 0 -15 Td` : ''}
${formData.stateFiled ? `(State Filed: ${cleanText(formData.stateFiled)}) Tj 0 -15 Td` : ''}
${formData.businessStartDate ? `(Start Date: ${cleanText(formData.businessStartDate)}) Tj 0 -15 Td` : ''}
${formData.yearsInBusiness ? `(Years: ${cleanText(formData.yearsInBusiness)}) Tj 0 -15 Td` : ''}
${formData.federalTaxId ? `(Tax ID: ${cleanText(formData.federalTaxId)}) Tj 0 -15 Td` : ''}
` : ''}

% Address Information
${formData.address || formData.city ? `
0 -50 Td
50 280 m
550 280 l
550 230 l
50 230 l
h
S

/F2 14 Tf
10 30 Td
(Business Address) Tj

/F1 11 Tf
0 -15 Td
${formData.address ? `(${cleanText(formData.address)}) Tj 0 -12 Td` : ''}
(${formData.city ? cleanText(formData.city) + ', ' : ''}${formData.state ? cleanText(formData.state) + ' ' : ''}${formData.zipCode ? cleanText(formData.zipCode) : ''}) Tj
` : ''}

% Business Ownership
${formData.owners && formData.owners.length > 0 ? `
0 -60 Td
50 190 m
550 190 l
550 ${130 - (formData.owners.length * 25)} l
50 ${130 - (formData.owners.length * 25)} l
h
S

/F2 14 Tf
10 ${40 + (formData.owners.length * 25)} Td
(Business Ownership) Tj

/F1 11 Tf
${formData.owners.map((owner: any) => `
0 -20 Td
(${cleanText(owner.name)} - ${cleanText(owner.percentage)}%) Tj
0 -12 Td
(${cleanText(owner.email)}) Tj
${owner.signature ? `0 -10 Td (Signature: Yes) Tj` : ''}
`).join('')}
` : ''}

% Transaction Information
${formData.monthlyVolume || formData.averageTicket ? `
0 -80 Td
50 ${90 - (formData.owners?.length || 0) * 25} m
550 ${90 - (formData.owners?.length || 0) * 25} l
550 ${40 - (formData.owners?.length || 0) * 25} l
50 ${40 - (formData.owners?.length || 0) * 25} l
h
S

/F2 14 Tf
10 ${30 + (formData.owners?.length || 0) * 25} Td
(Transaction Information) Tj

/F1 11 Tf
${formData.monthlyVolume ? `0 -15 Td (Monthly Volume: ${formatCurrency(formData.monthlyVolume)}) Tj` : ''}
${formData.averageTicket ? `0 -15 Td (Average Ticket: ${formatCurrency(formData.averageTicket)}) Tj` : ''}
${formData.highestTicket ? `0 -15 Td (Highest Ticket: ${formatCurrency(formData.highestTicket)}) Tj` : ''}
` : ''}

ET
endstream
endobj

7 0 obj
${this.calculateStreamLength()}
endobj

xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
0000000334 00000 n 
0000000399 00000 n 
0000002000 00000 n 
trailer
<<
/Size 8
/Root 1 0 R
>>
startxref
2020
%%EOF`;

    return pdfContent;
  }

  private calculateStreamLength(): number {
    // Return approximate stream length for PDF structure
    return 1500;
  }

  private createBeautifulPDF(prospect: MerchantProspect, formData: FormData, cleanText: Function, formatCurrency: Function, formatDate: Function): string {
    const statusColors = {
      pending: 'background: #fbbf24; color: white;',
      contacted: 'background: #3b82f6; color: white;',
      in_progress: 'background: #8b5cf6; color: white;',
      applied: 'background: #10b981; color: white;',
      approved: 'background: #059669; color: white;',
      rejected: 'background: #ef4444; color: white;'
    };
    
    const statusStyle = statusColors[prospect.status as keyof typeof statusColors] || 'background: #6b7280; color: white;';
    
    const sections = [];
    
    // Header Section with beautiful card design
    sections.push({
      title: `${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}`,
      content: `
        BT
        /F1 24 Tf
        50 720 Td
        (${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}) Tj
        
        /F1 12 Tf
        0 -20 Td
        (Merchant Application Review) Tj
        
        /F1 10 Tf
        350 20 Td
        (Status: ${prospect.status.replace('_', ' ').toUpperCase()}) Tj
        ET
        
        % Timeline Card
        50 670 m
        550 670 l
        550 600 l
        50 600 l
        h
        S
        
        BT
        /F2 14 Tf
        60 650 Td
        (Application Timeline) Tj
        
        /F1 11 Tf
        0 -20 Td
        (Application Created: ${formatDate(prospect.createdAt)}) Tj
        0 -15 Td
        (Last Updated: ${formatDate(prospect.updatedAt)}) Tj
        ${prospect.validatedAt ? `0 -15 Td (Email Validated: ${formatDate(prospect.validatedAt)}) Tj` : ''}
        ET
      `,
      height: 150
    });

    // Contact Information Card
    sections.push({
      title: 'Contact Information',
      content: `
        % Contact Card
        50 580 m
        550 580 l
        550 510 l
        50 510 l
        h
        S
        
        BT
        /F2 14 Tf
        60 560 Td
        (Contact Information) Tj
        
        /F1 11 Tf
        0 -20 Td
        (Email: ${cleanText(prospect.email)}) Tj
        ${formData.companyPhone ? `0 -15 Td (Phone: ${cleanText(formData.companyPhone)}) Tj` : ''}
        0 -15 Td
        (Assigned Agent: ${cleanText(formData.assignedAgent)}) Tj
        ET
      `,
      height: 90
    });

    // Business Information Card
    if (formData.companyName) {
      sections.push({
        title: 'Business Information',
        content: `
          % Business Card
          50 490 m
          550 490 l
          550 360 l
          50 360 l
          h
          S
          
          BT
          /F2 14 Tf
          60 470 Td
          (Business Information) Tj
          
          /F2 16 Tf
          0 -25 Td
          (${cleanText(formData.companyName)}) Tj
          
          /F1 11 Tf
          0 -20 Td
          ${formData.businessType ? `(Business Type: ${cleanText(formData.businessType)}) Tj 0 -15 Td` : ''}
          ${formData.stateFiled ? `(State Filed: ${cleanText(formData.stateFiled)}) Tj 0 -15 Td` : ''}
          ${formData.businessStartDate ? `(Business Start Date: ${cleanText(formData.businessStartDate)}) Tj 0 -15 Td` : ''}
          ${formData.yearsInBusiness ? `(Years in Business: ${cleanText(formData.yearsInBusiness)}) Tj 0 -15 Td` : ''}
          ${formData.federalTaxId ? `(Federal Tax ID: ${cleanText(formData.federalTaxId)}) Tj 0 -15 Td` : ''}
          ${formData.businessDescription ? `(Description: ${cleanText(formData.businessDescription).substring(0, 60)}...) Tj 0 -15 Td` : ''}
          ET
        `,
        height: 150
      });
    }

    // Address Information Card
    if (formData.address || formData.city) {
      sections.push({
        title: 'Business Address',
        content: `
          % Address Card
          50 340 m
          550 340 l
          550 280 l
          50 280 l
          h
          S
          
          BT
          /F2 14 Tf
          60 320 Td
          (Business Address) Tj
          
          /F1 11 Tf
          0 -20 Td
          ${formData.address ? `(${cleanText(formData.address)}) Tj 0 -15 Td` : ''}
          (${formData.city ? cleanText(formData.city) + ', ' : ''}${formData.state ? cleanText(formData.state) + ' ' : ''}${formData.zipCode ? cleanText(formData.zipCode) : ''}) Tj
          ET
        `,
        height: 80
      });
    }

    // Business Ownership Card
    if (formData.owners && formData.owners.length > 0) {
      const ownerContent = formData.owners.map((owner: any, index: number) => `
        0 -20 Td
        (${cleanText(owner.name)} - ${cleanText(owner.percentage)}% ownership) Tj
        0 -12 Td
        (${cleanText(owner.email)}) Tj
        ${owner.signature ? `0 -12 Td (✓ Signature provided) Tj` : ''}
      `).join('');

      sections.push({
        title: 'Business Ownership',
        content: `
          % Ownership Card
          50 260 m
          550 260 l
          550 ${160 - (formData.owners.length * 40)} l
          50 ${160 - (formData.owners.length * 40)} l
          h
          S
          
          BT
          /F2 14 Tf
          60 240 Td
          (Business Ownership) Tj
          
          /F1 11 Tf
          ${ownerContent}
          ET
        `,
        height: 100 + (formData.owners.length * 40)
      });
    }

    // Transaction Information Card
    if (formData.monthlyVolume || formData.averageTicket) {
      sections.push({
        title: 'Transaction Information',
        content: `
          % Transaction Card
          50 ${120 - (formData.owners?.length || 0) * 40} m
          550 ${120 - (formData.owners?.length || 0) * 40} l
          550 ${60 - (formData.owners?.length || 0) * 40} l
          50 ${60 - (formData.owners?.length || 0) * 40} l
          h
          S
          
          BT
          /F2 14 Tf
          60 ${100 - (formData.owners?.length || 0) * 40} Td
          (Transaction Information) Tj
          
          /F1 11 Tf
          0 -20 Td
          ${formData.monthlyVolume ? `(Monthly Volume: ${formatCurrency(formData.monthlyVolume)}) Tj 0 -15 Td` : ''}
          ${formData.averageTicket ? `(Average Ticket: ${formatCurrency(formData.averageTicket)}) Tj 0 -15 Td` : ''}
          ${formData.highestTicket ? `(Highest Ticket: ${formatCurrency(formData.highestTicket)}) Tj 0 -15 Td` : ''}
          ${formData.processingMethod ? `(Processing Method: ${cleanText(formData.processingMethod)}) Tj` : ''}
          ET
        `,
        height: 80
      });
    }

    return this.buildModernPDF(sections);
  }

  private buildModernPDF(sections: any[]): string {
    const pageHeight = 792;
    const pages = [];
    let currentPage = '';
    let currentY = pageHeight - 50;

    // Start first page
    currentPage += 'BT\n';

    for (const section of sections) {
      // Check if section fits on current page
      if (currentY - section.height < 50 && currentPage !== 'BT\n') {
        // Finish current page and start new one
        currentPage += 'ET\n';
        pages.push(currentPage);
        
        // Start new page
        currentPage = 'BT\n';
        currentY = pageHeight - 50;
      }

      // Add section content
      currentPage += section.content + '\n';
      currentY -= section.height;
    }

    // Finish last page
    currentPage += 'ET\n';
    pages.push(currentPage);

    return this.buildMultiPagePDF(pages);
  }

  private createModernApplicationPDF(prospect: MerchantProspect, formData: FormData): string {
    const cleanText = (text: string) => text.replace(/[<>&"']/g, (match) => {
      const entities: { [key: string]: string } = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[match];
    });

    const formatCurrency = (value: string) => {
      if (!value) return 'Not specified';
      const num = parseFloat(value.replace(/[^0-9.]/g, ''));
      return isNaN(num) ? value : `$${num.toLocaleString()}`;
    };

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const getStatusBadge = (status: string) => {
      const statusColors = {
        pending: '#fbbf24',
        contacted: '#3b82f6',
        in_progress: '#8b5cf6',
        applied: '#10b981',
        approved: '#059669',
        rejected: '#ef4444'
      };
      const color = statusColors[status as keyof typeof statusColors] || '#6b7280';
      return `<span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 16px; font-size: 11px; font-weight: 600;">${status.replace('_', ' ').toUpperCase()}</span>`;
    };

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Merchant Application - ${cleanText(prospect.firstName)} ${cleanText(prospect.lastName)}</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif; 
          margin: 0; 
          padding: 0; 
          color: #111827; 
          background: #f9fafb;
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
          font-size: 32px; 
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
        .card-icon {
          font-size: 20px;
          margin-right: 12px;
          color: #475569;
        }
        .card-content { 
          padding: 24px; 
        }
        .info-grid { 
          display: grid; 
          grid-template-columns: 1fr 1fr; 
          gap: 24px; 
        }
        .info-item { 
          margin-bottom: 20px; 
        }
        .info-label { 
          font-size: 11px; 
          color: #64748b; 
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
          display: block;
          font-weight: 600;
        }
        .info-value { 
          color: #0f172a; 
          font-weight: 500;
          font-size: 14px;
          word-wrap: break-word;
        }
        .info-value-large {
          font-size: 20px;
          font-weight: 600;
          color: #1e293b;
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
        .owner-card { 
          border: 1px solid #e2e8f0; 
          border-radius: 8px;
          padding: 20px; 
          margin-bottom: 16px; 
          background: #fafafa;
        }
        .owner-header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 12px;
        }
        .owner-name { 
          font-weight: 600; 
          font-size: 16px;
          color: #0f172a;
        }
        .ownership-badge { 
          background: #e0e7ff; 
          color: #3730a3; 
          padding: 6px 16px; 
          border-radius: 20px; 
          font-size: 12px; 
          font-weight: 600;
        }
        .owner-email { 
          color: #64748b; 
          font-size: 13px; 
          margin-bottom: 12px;
        }
        .signature-status { 
          color: #059669; 
          font-size: 12px;
          display: flex;
          align-items: center;
          font-weight: 500;
        }
        .signature-check {
          margin-right: 6px;
          font-size: 14px;
        }
        .address-section {
          line-height: 1.6;
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
              <p class="application-subtitle">Merchant Application Review</p>
            </div>
            <div class="status-badge">
              ${getStatusBadge(prospect.status)}
            </div>
          </div>
        </div>

        <!-- Application Timeline Card -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">📅</span> Application Timeline</h2>
          </div>
          <div class="card-content">
            <div class="timeline-item">
              <span class="timeline-label">Application Created</span>
              <span class="timeline-value">${formatDate(prospect.createdAt.toISOString())}</span>
            </div>
            ${prospect.validatedAt ? `
            <div class="timeline-item">
              <span class="timeline-label">Email Validated</span>
              <span class="timeline-value">${formatDate(prospect.validatedAt.toISOString())}</span>
            </div>
            ` : ''}
            <div class="timeline-item">
              <span class="timeline-label">Last Updated</span>
              <span class="timeline-value">${formatDate(prospect.updatedAt.toISOString())}</span>
            </div>
          </div>
        </div>

        <!-- Contact Information Card -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">👤</span> Contact Information</h2>
          </div>
          <div class="card-content">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Email</span>
                <div class="info-value">${cleanText(prospect.email)}</div>
              </div>
              ${formData.companyPhone ? `
              <div class="info-item">
                <span class="info-label">Phone</span>
                <div class="info-value">${cleanText(formData.companyPhone)}</div>
              </div>
              ` : ''}
              <div class="info-item">
                <span class="info-label">Assigned Agent</span>
                <div class="info-value">${cleanText(formData.assignedAgent)}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Business Information Card -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">🏢</span> Business Information</h2>
          </div>
          <div class="card-content">
            ${formData.companyName ? `
            <div class="info-item">
              <span class="info-label">Company Name</span>
              <div class="info-value info-value-large">${cleanText(formData.companyName)}</div>
            </div>
            ` : ''}
            
            <div class="info-grid">
              ${formData.businessType ? `
              <div class="info-item">
                <span class="info-label">Business Type</span>
                <div class="info-value">${cleanText(formData.businessType)}</div>
              </div>
              ` : ''}
              ${formData.stateFiled ? `
              <div class="info-item">
                <span class="info-label">State Filed</span>
                <div class="info-value">${cleanText(formData.stateFiled)}</div>
              </div>
              ` : ''}
              ${formData.businessStartDate ? `
              <div class="info-item">
                <span class="info-label">Business Start Date</span>
                <div class="info-value">${cleanText(formData.businessStartDate)}</div>
              </div>
              ` : ''}
              ${formData.yearsInBusiness ? `
              <div class="info-item">
                <span class="info-label">Years in Business</span>
                <div class="info-value">${cleanText(formData.yearsInBusiness)}</div>
              </div>
              ` : ''}
              ${formData.federalTaxId ? `
              <div class="info-item">
                <span class="info-label">Federal Tax ID</span>
                <div class="info-value">${cleanText(formData.federalTaxId)}</div>
              </div>
              ` : ''}
              ${formData.companyEmail ? `
              <div class="info-item">
                <span class="info-label">Company Email</span>
                <div class="info-value">${cleanText(formData.companyEmail)}</div>
              </div>
              ` : ''}
            </div>

            ${formData.businessDescription || formData.productsServices ? `
            <div style="margin-top: 24px;">
              ${formData.businessDescription ? `
              <div class="info-item">
                <span class="info-label">Business Description</span>
                <div class="info-value">${cleanText(formData.businessDescription)}</div>
              </div>
              ` : ''}
              ${formData.productsServices ? `
              <div class="info-item">
                <span class="info-label">Products & Services</span>
                <div class="info-value">${cleanText(formData.productsServices)}</div>
              </div>
              ` : ''}
            </div>
            ` : ''}
          </div>
        </div>

        <!-- Business Address Card -->
        ${formData.address || formData.city || formData.state ? `
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">📍</span> Business Address</h2>
          </div>
          <div class="card-content">
            <div class="address-section">
              ${formData.address ? `<div class="info-value">${cleanText(formData.address)}</div>` : ''}
              ${formData.addressLine2 ? `<div class="info-value">${cleanText(formData.addressLine2)}</div>` : ''}
              <div class="info-value">
                ${formData.city ? `${cleanText(formData.city)}, ` : ''}
                ${formData.state ? `${cleanText(formData.state)} ` : ''}
                ${formData.zipCode ? cleanText(formData.zipCode) : ''}
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Business Ownership Card -->
        ${formData.owners && formData.owners.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">👥</span> Business Ownership</h2>
          </div>
          <div class="card-content">
            ${formData.owners.map((owner: any) => `
              <div class="owner-card">
                <div class="owner-header">
                  <div class="owner-name">${cleanText(owner.name)}</div>
                  <div class="ownership-badge">${cleanText(owner.percentage)}% ownership</div>
                </div>
                <div class="owner-email">${cleanText(owner.email)}</div>
                ${owner.signature ? `
                <div class="signature-status">
                  <span class="signature-check">✓</span>
                  Signature provided (${owner.signatureType || 'digital'})
                </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Transaction Information Card -->
        ${formData.monthlyVolume || formData.averageTicket || formData.processingMethod ? `
        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><span class="card-icon">💰</span> Transaction Information</h2>
          </div>
          <div class="card-content">
            <div class="info-grid">
              ${formData.monthlyVolume ? `
              <div class="info-item">
                <span class="info-label">Monthly Volume</span>
                <div class="info-value">${formatCurrency(formData.monthlyVolume)}</div>
              </div>
              ` : ''}
              ${formData.averageTicket ? `
              <div class="info-item">
                <span class="info-label">Average Ticket</span>
                <div class="info-value">${formatCurrency(formData.averageTicket)}</div>
              </div>
              ` : ''}
              ${formData.highestTicket ? `
              <div class="info-item">
                <span class="info-label">Highest Ticket</span>
                <div class="info-value">${formatCurrency(formData.highestTicket)}</div>
              </div>
              ` : ''}
              ${formData.processingMethod ? `
              <div class="info-item">
                <span class="info-label">Processing Method</span>
                <div class="info-value">${cleanText(formData.processingMethod)}</div>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer-section">
          <p><strong>Application submitted on ${new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}</strong></p>
          <p>Generated from CoreCRM Merchant Processing System</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }

  private createProfessionalFormPDF(prospect: MerchantProspect, formData: FormData): string {
    const sections = this.createContentSections(prospect, formData);
    const pages = this.distributeContentAcrossPages(sections);
    
    return this.buildMultiPagePDF(pages);
  }

  private buildMultiPagePDF(pages: string[]): string {
    const pageCount = pages.length;
    let objectCounter = 1;
    
    // Catalog object
    let pdf = `%PDF-1.4
${objectCounter} 0 obj
<<
/Type /Catalog
/Pages ${objectCounter + 1} 0 R
>>
endobj

`;
    objectCounter++;

    // Pages object
    const pageRefs = [];
    for (let i = 0; i < pageCount; i++) {
      pageRefs.push(`${objectCounter + 1 + i} 0 R`);
    }
    
    pdf += `${objectCounter} 0 obj
<<
/Type /Pages
/Kids [${pageRefs.join(' ')}]
/Count ${pageCount}
>>
endobj

`;
    objectCounter++;

    // Page objects
    const contentObjectStart = objectCounter + pageCount;
    for (let i = 0; i < pageCount; i++) {
      pdf += `${objectCounter} 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents ${contentObjectStart + i} 0 R
/Resources <<
/Font <<
/F1 ${contentObjectStart + pageCount} 0 R
/F2 ${contentObjectStart + pageCount + 1} 0 R
>>
>>
>>
endobj

`;
      objectCounter++;
    }

    // Content objects
    for (let i = 0; i < pageCount; i++) {
      const content = pages[i];
      pdf += `${objectCounter} 0 obj
<<
/Length ${content.length}
>>
stream
${content}
endstream
endobj

`;
      objectCounter++;
    }

    // Font objects
    pdf += `${objectCounter} 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

`;
    objectCounter++;

    pdf += `${objectCounter} 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica-Bold
>>
endobj

`;
    objectCounter++;

    // Xref table
    const totalObjects = objectCounter;
    pdf += `xref
0 ${totalObjects}
0000000000 65535 f `;
    
    for (let i = 1; i < totalObjects; i++) {
      pdf += `\n${(i * 100).toString().padStart(10, '0')} 00000 n `;
    }

    pdf += `

trailer
<<
/Size ${totalObjects}
/Root 1 0 R
>>
startxref
${totalObjects * 100}
%%EOF`;

    return pdf;
  }



  private createContentSections(prospect: MerchantProspect, formData: FormData) {
    const cleanText = (text: string) => text.replace(/[()\\]/g, '\\$&');
    
    const sections = [];

    // Header section
    sections.push({
      type: 'header',
      content: this.createHeaderSection(formData, cleanText),
      height: 130
    });

    // Section 1: Merchant Information
    sections.push({
      type: 'section',
      title: '1. MERCHANT INFORMATION',
      content: this.createMerchantInfoSection(formData, cleanText),
      height: 450
    });

    // Section 2: Business Ownership
    sections.push({
      type: 'section',
      title: '2. BUSINESS OWNERSHIP',
      content: this.createOwnershipSection(formData, cleanText),
      height: formData.owners ? formData.owners.length * 120 + 60 : 80
    });

    // Section 3: Business Description
    sections.push({
      type: 'section',
      title: '3. BUSINESS DESCRIPTION',
      content: this.createDescriptionSection(formData, cleanText),
      height: 80
    });

    // Section 4: Products & Services
    sections.push({
      type: 'section',
      title: '4. PRODUCTS & SERVICES',
      content: this.createServicesSection(formData, cleanText),
      height: 80
    });

    // Section 5: Transaction Information
    sections.push({
      type: 'section',
      title: '5. TRANSACTION INFORMATION',
      content: this.createTransactionSection(formData, cleanText),
      height: 150
    });

    // Footer section
    sections.push({
      type: 'footer',
      content: this.createFooterSection(prospect, cleanText),
      height: 60
    });

    return sections;
  }

  private distributeContentAcrossPages(sections: any[]): string[] {
    const pages = [];
    let currentPage = '';
    let currentY = 620; // Start lower to account for header space
    let pageNum = 1;

    for (const section of sections) {
      // Check if section fits on current page
      if (currentY - section.height < 80 && currentPage !== '') {
        // Finish current page and start new one
        currentPage += 'ET\n';
        pages.push(currentPage);
        
        // Start new page
        currentPage = 'BT\n';
        currentPage += '50 720 Td\n';
        currentPage += '/F1 12 Tf\n';
        currentPage += '(MERCHANT APPLICATION - Page ' + (++pageNum) + ') Tj\n';
        currentPage += '0 -20 Td\n';
        currentPage += '/F1 8 Tf\n';
        currentPage += '(________________________________________________________________) Tj\n';
        currentPage += '0 -25 Td\n';
        currentY = 650;
      }

      if (currentPage === '') {
        currentPage = 'BT\n';
      }

      currentPage += section.content;
      currentY -= section.height;
    }

    // Add final page
    if (currentPage !== '') {
      currentPage += 'ET\n';
      pages.push(currentPage);
    }

    return pages;
  }

  private createHeaderSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Start with proper positioning from top
    content += '50 720 Td\n';
    content += '/F2 14 Tf\n';
    content += '(CORE CRM MERCHANT CENTER) Tj\n';
    
    // Agent info on same line
    content += '300 0 Td\n';
    content += '/F1 10 Tf\n';
    content += '(AGENT: ' + cleanText(formData.assignedAgent || 'N/A') + ') Tj\n';
    content += '-300 0 Td\n';
    
    // Main title - centered
    content += '0 -25 Td\n';
    content += '/F2 14 Tf\n';
    content += '80 0 Td\n';
    content += '(MERCHANT PROCESSING APPLICATION & AGREEMENT) Tj\n';
    content += '-80 0 Td\n';
    
    // Company name and date
    content += '0 -20 Td\n';
    content += '/F2 12 Tf\n';
    content += '(Company: ' + cleanText(formData.companyName || 'COMPANY NAME') + ') Tj\n';
    content += '250 0 Td\n';
    content += '/F1 10 Tf\n';
    content += '(Date: ' + new Date().toLocaleDateString() + ') Tj\n';
    content += '-250 0 Td\n';
    
    // Separator line
    content += '0 -15 Td\n';
    content += '/F1 8 Tf\n';
    content += '(________________________________________________________________) Tj\n';
    
    content += '0 -25 Td\n';
    return content;
  }

  private createMerchantInfoSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Section header with box styling
    content += '/F2 11 Tf\n';
    content += '(  1. MERCHANT INFORMATION) Tj\n';
    content += '0 -20 Td\n';
    
    // Legal name field (full width)
    content += '/F2 8 Tf\n';
    content += '(LEGAL NAME OF BUSINESS / IRS FILING NAME) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.companyName || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(_____________________________________________) Tj\n';
    content += '0 -15 Td\n';
    
    // Address section
    content += '/F2 8 Tf\n';
    content += '(LOCATION / SITE ADDRESS) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.address || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(____________________________________________________) Tj\n';
    content += '0 -15 Td\n';
    
    // City, State, ZIP on separate lines for clarity
    content += '/F2 8 Tf\n';
    content += '(CITY) Tj\n';
    content += '200 0 Td\n';
    content += '(STATE) Tj\n';
    content += '100 0 Td\n';
    content += '(ZIP CODE) Tj\n';
    content += '-300 0 Td\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.city || '') + ') Tj\n';
    content += '200 0 Td\n';
    content += '(' + cleanText(formData.state || '') + ') Tj\n';
    content += '100 0 Td\n';
    content += '(' + cleanText(formData.zipCode || '') + ') Tj\n';
    content += '-300 0 Td\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(___________________) Tj\n';
    content += '200 0 Td\n';
    content += '(__________) Tj\n';
    content += '100 0 Td\n';
    content += '(__________) Tj\n';
    content += '-300 0 Td\n';
    
    // Contact information section
    content += '0 -15 Td\n';
    content += '/F2 8 Tf\n';
    content += '(COMPANY PHONE #) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.companyPhone || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(_____________________) Tj\n';
    content += '0 -15 Td\n';
    
    content += '/F2 8 Tf\n';
    content += '(COMPANY E-MAIL ADDRESS) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.companyEmail || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(____________________________________________) Tj\n';
    
    // Tax ID line
    content += '0 -15 Td\n';
    content += '/F2 8 Tf\n';
    content += '(TAX ID) Tj\n';
    content += '0 -10 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.federalTaxId || '') + ') Tj\n';
    content += '0 -5 Td\n';
    content += '/F1 7 Tf\n';
    content += '(______________) Tj\n';
    
    // Business type section
    content += '0 -15 Td\n';
    content += '/F2 8 Tf\n';
    content += '(BUSINESS TYPE) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.businessType || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(____________________) Tj\n';
    content += '0 -15 Td\n';
    
    // Years in business
    content += '/F2 8 Tf\n';
    content += '(YEARS IN BUSINESS) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.yearsInBusiness || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(______________) Tj\n';
    
    content += '0 -20 Td\n';
    return content;
  }

  private createOwnershipSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Section header
    content += '/F2 11 Tf\n';
    content += '(  2. BUSINESS OWNERSHIP & PRINCIPAL INFORMATION) Tj\n';
    content += '0 -18 Td\n';

    if (formData.owners && formData.owners.length > 0) {
      formData.owners.forEach((owner, index) => {
        // Owner header
        content += '/F2 9 Tf\n';
        content += '(PRINCIPAL ' + (index + 1) + ' INFORMATION) Tj\n';
        content += '0 -12 Td\n';
        
        // Owner name and percentage on same line
        content += '/F2 8 Tf\n';
        content += '(FULL NAME) Tj\n';
        content += '250 0 Td\n';
        content += '(OWNERSHIP PERCENTAGE) Tj\n';
        content += '150 0 Td\n';
        content += '(TITLE) Tj\n';
        content += '-400 0 Td\n';
        content += '0 -10 Td\n';
        content += '/F1 10 Tf\n';
        content += '(' + cleanText(owner.name || '') + ') Tj\n';
        content += '250 0 Td\n';
        content += '(' + cleanText((owner.percentage || '0') + '%') + ') Tj\n';
        content += '-250 0 Td\n';
        content += '0 -5 Td\n';
        content += '/F1 7 Tf\n';
        content += '(____________________________) Tj\n';
        content += '250 0 Td\n';
        content += '(___________) Tj\n';
        content += '150 0 Td\n';
        content += '(_______________) Tj\n';
        content += '-400 0 Td\n';
        
        // Email address
        content += '0 -12 Td\n';
        content += '/F2 8 Tf\n';
        content += '(EMAIL ADDRESS) Tj\n';
        content += '0 -10 Td\n';
        content += '/F1 10 Tf\n';
        content += '(' + cleanText(owner.email || '') + ') Tj\n';
        content += '0 -5 Td\n';
        content += '/F1 7 Tf\n';
        content += '(___________________________________________) Tj\n';

        // Digital signature section
        if (owner.signature) {
          content += '0 -15 Td\n';
          content += '/F2 8 Tf\n';
          content += '(DIGITAL SIGNATURE ACKNOWLEDGMENT) Tj\n';
          content += '0 -10 Td\n';
          content += '/F1 9 Tf\n';
          const sigType = owner.signatureType === 'type' ? 'Electronically Typed' : 'Digitally Drawn';
          content += '(Signature: ' + cleanText(owner.signature) + ' \\(' + sigType + '\\)) Tj\n';
          content += '0 -8 Td\n';
          content += '/F2 7 Tf\n';
          content += '(By providing this digital signature, I acknowledge and agree to the terms of this application.) Tj\n';
        } else {
          content += '0 -15 Td\n';
          content += '/F2 8 Tf\n';
          content += '(SIGNATURE REQUIRED \\(25% or greater ownership\\)) Tj\n';
          content += '0 -10 Td\n';
          content += '/F1 7 Tf\n';
          content += '(___________________________________________) Tj\n';
        }
        
        content += '0 -20 Td\n';
      });
    } else {
      content += '/F2 9 Tf\n';
      content += '(PRINCIPAL INFORMATION NOT PROVIDED) Tj\n';
      content += '0 -15 Td\n';
    }

    return content;
  }

  private createDescriptionSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Business description with proper form styling
    content += '/F2 8 Tf\n';
    content += '(MERCHANT SELLS: \\(SPECIFY PRODUCT, SERVICE AND/OR INFORMATION\\)) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.businessDescription || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(_______________________________________________________________________) Tj\n';
    content += '0 -5 Td\n';
    content += '(_______________________________________________________________________) Tj\n';
    
    content += '0 -15 Td\n';
    return content;
  }

  private createServicesSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Products and services with checkboxes
    content += '/F2 8 Tf\n';
    content += '(PRODUCTS & SERVICES OFFERED:) Tj\n';
    content += '0 -12 Td\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.productsServices || '') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(_______________________________________________________________________) Tj\n';
    content += '0 -5 Td\n';
    content += '(_______________________________________________________________________) Tj\n';
    
    // Refund policy section
    content += '0 -15 Td\n';
    content += '/F2 8 Tf\n';
    content += '(REFUND POLICY FOR VISA / MASTERCARD / AMEX / DISCOVER NETWORK SALES) Tj\n';
    content += '0 -10 Td\n';
    content += '(□ REFUND WILL BE GRANTED TO A CUSTOMER AS FOLLOWS) Tj\n';
    content += '250 0 Td\n';
    content += '(□ NO REFUND. ALL SALES FINAL) Tj\n';
    content += '-250 0 Td\n';
    content += '0 -8 Td\n';
    content += '(□ EXCHANGE) Tj\n';
    content += '100 0 Td\n';
    content += '(□ STORE CREDIT) Tj\n';
    content += '-100 0 Td\n';
    
    content += '0 -20 Td\n';
    return content;
  }

  private createTransactionSection(formData: FormData, cleanText: Function): string {
    let content = '';
    
    // Section header
    content += '/F2 11 Tf\n';
    content += '(  3. TRANSACTION INFORMATION) Tj\n';
    content += '0 -18 Td\n';
    
    // Financial data subheader
    content += '/F2 9 Tf\n';
    content += '(FINANCIAL DATA) Tj\n';
    content += '300 0 Td\n';
    content += '(VISA / MASTERCARD / AMEX / DISCOVER NETWORK INFORMATION) Tj\n';
    content += '-300 0 Td\n';
    content += '0 -15 Td\n';
    
    // Monthly volume line
    content += '/F2 8 Tf\n';
    content += '(  AVERAGE COMBINED MONTHLY VISA/MC/DISCOVER/AMEX VOLUME) Tj\n';
    content += '280 0 Td\n';
    content += '($) Tj\n';
    content += '50 0 Td\n';
    content += '(MERCHANT TYPE) Tj\n';
    content += '-330 0 Td\n';
    content += '0 -10 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.monthlyVolume || '') + ') Tj\n';
    content += '280 0 Td\n';
    content += '(' + cleanText(formData.processingMethod || '') + ') Tj\n';
    content += '-280 0 Td\n';
    content += '0 -5 Td\n';
    content += '/F1 7 Tf\n';
    content += '(__________________) Tj\n';
    content += '280 0 Td\n';
    content += '(__________________) Tj\n';
    content += '-280 0 Td\n';
    
    // Average ticket line
    content += '0 -12 Td\n';
    content += '/F2 8 Tf\n';
    content += '(  AVERAGE VISA / MC / AMEX / DISCOVER NETWORK TICKET) Tj\n';
    content += '280 0 Td\n';
    content += '($) Tj\n';
    content += '50 0 Td\n';
    content += '(RESTAURANT/FOOD) Tj\n';
    content += '-330 0 Td\n';
    content += '0 -10 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.averageTicket || '') + ') Tj\n';
    content += '0 -5 Td\n';
    content += '/F1 7 Tf\n';
    content += '(__________________) Tj\n';
    content += '280 0 Td\n';
    content += '(__________________) Tj\n';
    content += '-280 0 Td\n';
    
    // Highest ticket line
    content += '0 -12 Td\n';
    content += '/F2 8 Tf\n';
    content += '(  HIGHEST TICKET AMOUNT) Tj\n';
    content += '280 0 Td\n';
    content += '($) Tj\n';
    content += '50 0 Td\n';
    content += '(LODGING) Tj\n';
    content += '-330 0 Td\n';
    content += '0 -10 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(formData.highestTicket || '') + ') Tj\n';
    content += '0 -5 Td\n';
    content += '/F1 7 Tf\n';
    content += '(__________________) Tj\n';
    content += '280 0 Td\n';
    content += '(__________________) Tj\n';
    content += '-280 0 Td\n';
    
    // Processing method details
    content += '0 -15 Td\n';
    content += '/F2 8 Tf\n';
    content += '(PROCESSING METHOD: ) Tj\n';
    content += '/F1 9 Tf\n';
    content += '(' + cleanText(formData.processingMethod || 'RETAIL OUTLET') + ') Tj\n';
    content += '0 -8 Td\n';
    content += '/F2 8 Tf\n';
    content += '(□ RETAIL OUTLET    □ RESTAURANT/FOOD    □ LODGING    □ INTERNET    □ MAIL/TELEPHONE ORDER) Tj\n';
    
    content += '0 -20 Td\n';
    return content;
  }

  private createFooterSection(prospect: MerchantProspect, cleanText: Function): string {
    let content = '';
    
    // Merchant acknowledgment section
    content += '/F2 8 Tf\n';
    content += '(Print Client\'s Business Legal Name:) Tj\n';
    content += '0 -10 Td\n';
    content += '/F1 10 Tf\n';
    content += '(' + cleanText(prospect.firstName + ' ' + prospect.lastName) + ') Tj\n';
    content += '0 -5 Td\n';
    content += '/F1 7 Tf\n';
    content += '(_______________________________________________________________________) Tj\n';
    
    // Acknowledgment text
    content += '0 -15 Td\n';
    content += '/F2 7 Tf\n';
    content += '(By its signature below, Client acknowledges that it received the complete Program Guide consisting of multiple) Tj\n';
    content += '0 -8 Td\n';
    content += '(pages including this confirmation. Client further acknowledges reading and agreeing to all terms in the) Tj\n';
    content += '0 -8 Td\n';
    content += '(Program Guide, which shall be incorporated into Client\'s Agreement. Upon receipt of a signed copy of this) Tj\n';
    content += '0 -8 Td\n';
    content += '(Application by us, Client\'s Application will be processed.) Tj\n';
    
    // Warning text
    content += '0 -12 Td\n';
    content += '/F2 8 Tf\n';
    content += '(NO ALTERATIONS OR STRIKE-OUTS TO THE PROGRAM GUIDE WILL BE ACCEPTED AND, IF MADE,) Tj\n';
    content += '0 -8 Td\n';
    content += '(ANY SUCH ALTERATIONS OR STRIKE-OUTS SHALL NOT APPLY.) Tj\n';
    
    // Signature lines
    content += '0 -20 Td\n';
    content += '/F2 8 Tf\n';
    content += '(CLIENTS BUSINESS PRINCIPAL SIGNATURE) Tj\n';
    content += '300 0 Td\n';
    content += '(TITLE) Tj\n';
    content += '100 0 Td\n';
    content += '(DATE) Tj\n';
    content += '-400 0 Td\n';
    content += '0 -15 Td\n';
    content += '/F1 7 Tf\n';
    content += '(___________________________________________) Tj\n';
    content += '300 0 Td\n';
    content += '(______________) Tj\n';
    content += '100 0 Td\n';
    content += '(______________) Tj\n';
    content += '-400 0 Td\n';
    
    // Print name line
    content += '0 -10 Td\n';
    content += '/F2 8 Tf\n';
    content += '(PRINT NAME) Tj\n';
    content += '0 -8 Td\n';
    content += '/F1 7 Tf\n';
    content += '(___________________________________________) Tj\n';
    
    // Copyright and reference info
    content += '0 -20 Td\n';
    content += '/F2 6 Tf\n';
    content += '(© COPYRIGHT 2025 CORE CRM MERCHANT CENTER. ALL RIGHTS RESERVED.) Tj\n';
    content += '250 0 Td\n';
    content += '(MERCHANT PROCESSING APPLICATION & AGREEMENT) Tj\n';
    content += '-250 0 Td\n';
    content += '0 -8 Td\n';
    content += '(Application Reference: ' + cleanText(prospect.validationToken || 'N/A') + ') Tj\n';
    content += '200 0 Td\n';
    content += '(Submitted: ' + new Date().toLocaleDateString() + ') Tj\n';
    content += '100 0 Td\n';
    content += '(PAGE 1 OF 2) Tj\n';
    content += '-300 0 Td\n';
    
    return content;
  }

  private createMinimalPDF(companyName: string): Buffer {
    const cleanCompany = companyName.replace(/[()\\]/g, '\\$&');
    
    const content = `BT
/F1 12 Tf
50 750 Td
(MERCHANT APPLICATION) Tj
0 -20 Td
(Company: ${cleanCompany}) Tj
0 -20 Td
(Generated: ${new Date().toLocaleDateString()}) Tj
0 -20 Td
(Status: Application Submitted) Tj
ET`;

    const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${content.length}>>stream
${content}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000053 00000 n 
0000000100 00000 n 
0000000200 00000 n 
0000000300 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
350
%%EOF`;
    
    return Buffer.from(pdf, 'binary');
  }

  async generateMappedApplicationPDF(
    applicationData: Record<string, any>,
    fieldConfiguration: any,
    pdfMappingConfiguration: any[],
    templateName: string
  ): Promise<Buffer> {
    try {
      const sections: { title: string; fields: { label: string; value: string; pdfFieldId?: string }[] }[] = [];

      if (Array.isArray(fieldConfiguration?.sections)) {
        for (const section of fieldConfiguration.sections) {
          const sectionFields: { label: string; value: string; pdfFieldId?: string }[] = [];
          if (Array.isArray(section.fields)) {
            for (const field of section.fields) {
              const rawValue = applicationData[field.id];
              let displayValue = '';
              if (rawValue === undefined || rawValue === null || rawValue === '') {
                displayValue = '';
              } else if (Array.isArray(rawValue)) {
                displayValue = rawValue.join(', ');
              } else if (typeof rawValue === 'object') {
                displayValue = JSON.stringify(rawValue);
              } else {
                displayValue = String(rawValue);
              }
              sectionFields.push({
                label: field.label || field.id,
                value: displayValue,
                pdfFieldId: field.pdfFieldId || undefined,
              });
            }
          }
          if (sectionFields.length > 0) {
            sections.push({ title: section.title, fields: sectionFields });
          }
        }
      }

      const mappingStats = {
        totalFields: sections.reduce((sum, s) => sum + s.fields.length, 0),
        mappedFields: sections.reduce((sum, s) => sum + s.fields.filter(f => f.pdfFieldId).length, 0),
        totalPdfFields: Array.isArray(pdfMappingConfiguration) ? pdfMappingConfiguration.length : 0,
      };

      const pages = this.buildMappedPages(sections, templateName, mappingStats);
      const pdfContent = this.buildMultiPagePDF(pages);
      return Buffer.from(pdfContent, 'binary');
    } catch (error) {
      console.error('Mapped PDF generation failed:', error);
      return this.createMinimalPDF(templateName);
    }
  }

  private buildMappedPages(
    sections: { title: string; fields: { label: string; value: string; pdfFieldId?: string }[] }[],
    templateName: string,
    stats: { totalFields: number; mappedFields: number; totalPdfFields: number }
  ): string[][] {
    const pages: string[][] = [];
    let currentPage: string[] = [];
    let y = 750;
    const lineHeight = 14;
    const pageHeight = 792;
    const margin = 50;
    const bottomMargin = 60;

    currentPage.push(`BT /F2 16 Tf ${margin} ${y} Td (${this.escapePdfText(templateName)}) Tj ET`);
    y -= 24;
    currentPage.push(`BT /F1 9 Tf ${margin} ${y} Td (Fields: ${stats.totalFields} | Mapped to PDF: ${stats.mappedFields} | PDF Fields: ${stats.totalPdfFields}) Tj ET`);
    y -= 20;
    currentPage.push(`${margin} ${y} m ${562} ${y} l S`);
    y -= 16;

    for (const section of sections) {
      if (y < bottomMargin + 40) {
        pages.push(currentPage);
        currentPage = [];
        y = pageHeight - margin;
      }
      currentPage.push(`BT /F2 12 Tf ${margin} ${y} Td (${this.escapePdfText(section.title)}) Tj ET`);
      y -= 4;
      currentPage.push(`${margin} ${y} m ${562} ${y} l S`);
      y -= lineHeight;

      for (const field of section.fields) {
        if (y < bottomMargin) {
          pages.push(currentPage);
          currentPage = [];
          y = pageHeight - margin;
        }
        const label = this.escapePdfText(field.label);
        const value = this.escapePdfText(field.value || '—');
        currentPage.push(`BT /F2 9 Tf ${margin} ${y} Td (${label}:) Tj ET`);
        currentPage.push(`BT /F1 9 Tf 220 ${y} Td (${value}) Tj ET`);
        if (field.pdfFieldId) {
          currentPage.push(`BT /F1 7 Tf 450 ${y} Td ([${this.escapePdfText(field.pdfFieldId)}]) Tj ET`);
        }
        y -= lineHeight;
      }
      y -= 8;
    }

    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
  }

  private escapePdfText(text: string): string {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]/g, ' ');
  }
}

export const pdfGenerator = new PDFGenerator();