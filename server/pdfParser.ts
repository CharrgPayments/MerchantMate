import { PdfFormField } from '@shared/schema';
import { getWellsFargoMPAForm } from './wellsFargoMPA';
import * as fs from 'fs';

interface ParsedFormField {
  fieldName: string;
  fieldType: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'phone' | 'email' | 'url';
  fieldLabel: string;
  isRequired: boolean;
  options?: string[];
  defaultValue?: string;
  validation?: string;
  position: number;
  section?: string;
}

interface ParsedFormSection {
  title: string;
  fields: ParsedFormField[];
  order: number;
}

export class PDFFormParser {
  async parsePDF(buffer: Buffer): Promise<{
    sections: ParsedFormSection[];
    totalFields: number;
  }> {
    // For now, we'll use the predefined Wells Fargo MPA structure
    // Future enhancement: actual PDF parsing with pdf-parse
    const sections = this.parseWellsFargoMPA("");
    
    const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
    
    return {
      sections,
      totalFields
    };
  }

  private parseWellsFargoMPA(text: string): ParsedFormSection[] {
    // Use the enhanced Wells Fargo form structure
    const enhancedSections = getWellsFargoMPAForm();
    
    // Convert enhanced sections to ParsedFormSection format
    return enhancedSections.map(section => ({
      title: section.title,
      order: section.order,
      fields: section.fields.map(field => ({
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        fieldLabel: field.fieldLabel,
        isRequired: field.isRequired,
        options: field.options,
        defaultValue: field.defaultValue,
        validation: field.validation,
        position: field.position,
        section: field.section
      }))
    }));
  }

  private parseWellsFargoMPALegacy(text: string): ParsedFormSection[] {
    const sections: ParsedFormSection[] = [
      {
        title: "Merchant Information",
        order: 1,
        fields: [
          {
            fieldName: 'legalBusinessName',
            fieldType: 'text',
            fieldLabel: 'Legal Name of Business / IRS Filing Name',
            isRequired: true,
            position: 1,
            validation: JSON.stringify({ minLength: 2, maxLength: 100 })
          },
          {
            fieldName: 'dbaName',
            fieldType: 'text',
            fieldLabel: 'DBA (Doing Business As)',
            isRequired: false,
            position: 2,
            validation: JSON.stringify({ maxLength: 100 })
          },
          {
            fieldName: 'locationAddress',
            fieldType: 'text',
            fieldLabel: 'Location / Site Address',
            isRequired: true,
            position: 3,
            validation: JSON.stringify({ minLength: 5, maxLength: 200 })
          },
          {
            fieldName: 'locationCity',
            fieldType: 'text',
            fieldLabel: 'City',
            isRequired: true,
            position: 4,
            validation: JSON.stringify({ minLength: 2, maxLength: 50 })
          },
          {
            fieldName: 'locationState',
            fieldType: 'select',
            fieldLabel: 'State',
            isRequired: true,
            position: 5,
            options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
          },
          {
            fieldName: 'locationZipCode',
            fieldType: 'text',
            fieldLabel: 'ZIP Code',
            isRequired: true,
            position: 6,
            validation: JSON.stringify({ pattern: '^\\d{5}(-\\d{4})?$' })
          },
          {
            fieldName: 'companyWebsite',
            fieldType: 'url',
            fieldLabel: 'Company Website Address (URL)',
            isRequired: false,
            position: 7,
            validation: JSON.stringify({ pattern: '^https?://.*' })
          },
          {
            fieldName: 'mailingAddress',
            fieldType: 'text',
            fieldLabel: 'Mailing Address (if different from location)',
            isRequired: false,
            position: 8,
            validation: JSON.stringify({ maxLength: 200 })
          },
          {
            fieldName: 'mailingCity',
            fieldType: 'text',
            fieldLabel: 'Mailing City',
            isRequired: false,
            position: 9,
            validation: JSON.stringify({ maxLength: 50 })
          },
          {
            fieldName: 'mailingState',
            fieldType: 'select',
            fieldLabel: 'Mailing State',
            isRequired: false,
            position: 10,
            options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
          },
          {
            fieldName: 'mailingZipCode',
            fieldType: 'text',
            fieldLabel: 'Mailing ZIP Code',
            isRequired: false,
            position: 11,
            validation: JSON.stringify({ pattern: '^\\d{5}(-\\d{4})?$' })
          },
          {
            fieldName: 'companyEmail',
            fieldType: 'email',
            fieldLabel: 'Company E-mail Address',
            isRequired: true,
            position: 12,
            validation: JSON.stringify({ pattern: '^[^@]+@[^@]+\\.[^@]+$' })
          },
          {
            fieldName: 'companyPhone',
            fieldType: 'phone',
            fieldLabel: 'Company Phone #',
            isRequired: true,
            position: 13,
            validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}$' })
          },
          {
            fieldName: 'descriptorPhone',
            fieldType: 'phone',
            fieldLabel: 'Descriptor Phone # (E-commerce or MOTO)',
            isRequired: false,
            position: 14,
            validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}$' })
          },
          {
            fieldName: 'mobilePhone',
            fieldType: 'phone',
            fieldLabel: 'Mobile Phone #',
            isRequired: false,
            position: 15,
            validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}$' })
          },
          {
            fieldName: 'faxNumber',
            fieldType: 'phone',
            fieldLabel: 'Fax #',
            isRequired: false,
            position: 16,
            validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}$' })
          },
          {
            fieldName: 'contactName',
            fieldType: 'text',
            fieldLabel: 'Contact Name',
            isRequired: true,
            position: 17,
            validation: JSON.stringify({ minLength: 2, maxLength: 100 })
          },
          {
            fieldName: 'contactTitle',
            fieldType: 'text',
            fieldLabel: 'Contact Title',
            isRequired: false,
            position: 18,
            validation: JSON.stringify({ maxLength: 50 })
          },
          {
            fieldName: 'taxId',
            fieldType: 'text',
            fieldLabel: 'Tax ID',
            isRequired: true,
            position: 19,
            validation: JSON.stringify({ pattern: '^\\d{2}-\\d{7}$|^\\d{3}-\\d{2}-\\d{4}$' })
          },
          {
            fieldName: 'foreignEntity',
            fieldType: 'checkbox',
            fieldLabel: 'I certify that I\'m a foreign entity/nonresident alien',
            isRequired: false,
            position: 20
          }
        ]
      },
      {
        title: "Business Type & History",
        order: 2,
        fields: [
          {
            fieldName: 'businessType',
            fieldType: 'select',
            fieldLabel: 'Business Type',
            isRequired: true,
            position: 21,
            options: ['Partnership', 'Sole Proprietorship', 'Public Corp.', 'Private Corp.', 'Tax Exempt Corp.', 'Limited Liability Company']
          },
          {
            fieldName: 'stateFiled',
            fieldType: 'select',
            fieldLabel: 'State Filed',
            isRequired: false,
            position: 22,
            options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
          },
          {
            fieldName: 'businessStartDate',
            fieldType: 'date',
            fieldLabel: 'Business Start Date',
            isRequired: true,
            position: 23,
            validation: JSON.stringify({ maxDate: new Date().toISOString() })
          },
          {
            fieldName: 'previouslyTerminated',
            fieldType: 'select',
            fieldLabel: 'Has this business or any associated principal been terminated as a Visa/MasterCard/Amex/Discover network merchant?',
            isRequired: true,
            position: 24,
            options: ['Yes', 'No']
          },
          {
            fieldName: 'currentlyAccepting',
            fieldType: 'select',
            fieldLabel: 'Do you currently accept Visa/MC/Amex/Discover Network?',
            isRequired: true,
            position: 25,
            options: ['Yes', 'No']
          },
          {
            fieldName: 'previousProcessor',
            fieldType: 'text',
            fieldLabel: 'Your Previous Card Processor',
            isRequired: false,
            position: 26,
            validation: JSON.stringify({ maxLength: 100 })
          },
          {
            fieldName: 'reasonToChange',
            fieldType: 'select',
            fieldLabel: 'Reason to Change',
            isRequired: false,
            position: 27,
            options: ['Rates', 'Service', 'Other']
          },
          {
            fieldName: 'filedBankruptcy',
            fieldType: 'select',
            fieldLabel: 'Has merchant or any associated principal filed bankruptcy or been subject to an involuntary bankruptcy?',
            isRequired: true,
            position: 28,
            options: ['Yes', 'No']
          }
        ]
      },
      {
        title: "Products & Services",
        order: 3,
        fields: [
          {
            fieldName: 'merchantSells',
            fieldType: 'textarea',
            fieldLabel: 'Merchant Sells (specify product, service and/or information)',
            isRequired: true,
            position: 29,
            validation: JSON.stringify({ minLength: 10, maxLength: 500 })
          },
          {
            fieldName: 'thirdPartyDataStorage',
            fieldType: 'select',
            fieldLabel: 'Do you use any third party to store, process or transmit cardholder\'s data?',
            isRequired: true,
            position: 30,
            options: ['Yes', 'No']
          },
          {
            fieldName: 'thirdPartyCompanyName',
            fieldType: 'text',
            fieldLabel: 'Third Party Company Name, Address and Phone',
            isRequired: false,
            position: 31,
            validation: JSON.stringify({ maxLength: 200 })
          },
          {
            fieldName: 'refundPolicy',
            fieldType: 'select',
            fieldLabel: 'Refund Policy for Visa/MasterCard/Amex/Discover Network Sales',
            isRequired: true,
            position: 32,
            options: ['No Refund. All Sales Final', 'Refund will be granted to a customer as follows']
          },
          {
            fieldName: 'creditExchangeTimeframe',
            fieldType: 'select',
            fieldLabel: 'Visa/MC/Amex/Discover Network Credit Exchange Timeframe',
            isRequired: false,
            position: 33,
            options: ['0-3 Days', '4-7 Days', '8-14 Days', 'Over 14 Days']
          }
        ]
      },
      {
        title: "Transaction Information",
        order: 4,
        fields: [
          {
            fieldName: 'averageMonthlyVolume',
            fieldType: 'number',
            fieldLabel: 'Average Combined Monthly Visa/MC/Discover/Amex Volume ($)',
            isRequired: true,
            position: 34,
            validation: JSON.stringify({ min: 0, max: 99999999 })
          },
          {
            fieldName: 'averageTicket',
            fieldType: 'number',
            fieldLabel: 'Average Visa/MC/Amex/Discover Network Ticket ($)',
            isRequired: true,
            position: 35,
            validation: JSON.stringify({ min: 0, max: 99999 })
          },
          {
            fieldName: 'highestTicket',
            fieldType: 'number',
            fieldLabel: 'Highest Ticket Amount ($)',
            isRequired: true,
            position: 36,
            validation: JSON.stringify({ min: 0, max: 99999 })
          },
          {
            fieldName: 'seasonal',
            fieldType: 'select',
            fieldLabel: 'Seasonal Business?',
            isRequired: true,
            position: 37,
            options: ['Yes', 'No']
          },
          {
            fieldName: 'merchantType',
            fieldType: 'select',
            fieldLabel: 'Merchant Type',
            isRequired: true,
            position: 38,
            options: ['Retail Outlet', 'Restaurant/Food', 'Lodging', 'Home Business, Trade Fairs', 'Outside Sales/Service, Other, etc.', 'Mail/Telephone Order Only', 'Internet', 'Health Care']
          },
          {
            fieldName: 'swipedCreditCards',
            fieldType: 'number',
            fieldLabel: 'Swiped Credit Cards (%)',
            isRequired: true,
            position: 39,
            validation: JSON.stringify({ min: 0, max: 100 })
          },
          {
            fieldName: 'keyedCreditCards',
            fieldType: 'number',
            fieldLabel: 'Keyed Credit Cards (%)',
            isRequired: true,
            position: 40,
            validation: JSON.stringify({ min: 0, max: 100 })
          },
          {
            fieldName: 'motoPercentage',
            fieldType: 'number',
            fieldLabel: 'MO/TO (%)',
            isRequired: false,
            position: 41,
            validation: JSON.stringify({ min: 0, max: 100 })
          },
          {
            fieldName: 'internetPercentage',
            fieldType: 'number',
            fieldLabel: 'Internet (%)',
            isRequired: false,
            position: 42,
            validation: JSON.stringify({ min: 0, max: 100 })
          }
        ]
      }
    ];

    return sections;
  }

  private inferFieldType(label: string): ParsedFormField['fieldType'] {
    const lower = label.toLowerCase();
    if (/e[\-_\s]?mail/i.test(lower)) return 'email';
    if (/phone|fax|tel(?:ephone)?|mobile|cell/i.test(lower)) return 'phone';
    if (/date|dob|d\.o\.b|birth/i.test(lower)) return 'date';
    if (/url|website|web\s*site/i.test(lower)) return 'url';
    if (/amount|volume|ticket|price|\$|revenue|sales|fee|cost|rate/i.test(lower)) return 'number';
    if (/yes.*no|no.*yes/i.test(lower)) return 'select';
    if (/description|comment|note|detail|explain|reason/i.test(lower)) return 'textarea';
    if (/zip\s*code|postal/i.test(lower)) return 'text';
    if (/ssn|social\s*security/i.test(lower)) return 'text';
    if (/ein|tax\s*id|federal/i.test(lower)) return 'text';
    if (/routing|aba/i.test(lower)) return 'text';
    if (/account\s*#|account\s*number|acct/i.test(lower)) return 'text';
    return 'text';
  }

  private labelToFieldName(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);
  }

  async parsePDFForm(filePathOrBuffer: string | Buffer): Promise<{
    sections: ParsedFormSection[];
    totalFields: number;
    rawFields: any[];
  }> {
    try {
      const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;

      const acroFormFields = await this.extractAcroFormFields(buffer);

      const fieldsToProcess = acroFormFields.length > 0
        ? acroFormFields
        : await this.extractTextBasedFields(buffer);

      const source = acroFormFields.length > 0 ? 'acroform' : 'text';
      console.log(`PDF parsing: using ${source} extraction (${fieldsToProcess.length} fields found)`);

      const seenFieldNames = new Set<string>();
      const rawFields: any[] = [];
      const sectionMap = new Map<string, ParsedFormField[]>();
      let position = 0;

      for (const field of fieldsToProcess) {
        const key = field.fieldName;
        if (seenFieldNames.has(key)) continue;
        seenFieldNames.add(key);
        position++;

        const pdfFieldId = field.pdfFieldId || `pdf_${key}_${position}`;
        const section = field.section || 'Form Fields';

        const parsedField: any = {
          fieldName: key,
          fieldType: field.fieldType,
          fieldLabel: field.fieldLabel,
          isRequired: field.isRequired,
          position,
          section,
          pdfFieldId,
          ...(field.defaultValue ? { defaultValue: field.defaultValue } : {}),
          ...(field.options ? { options: field.options } : {}),
        };

        if (!sectionMap.has(section)) sectionMap.set(section, []);
        sectionMap.get(section)!.push(parsedField);

        rawFields.push({
          pdfFieldId,
          fieldName: key,
          originalLabel: field.fieldLabel,
          detectedType: field.fieldType,
          required: field.isRequired,
          section,
          position,
          rawLine: field.rawPdfFieldName || field.rawLine || field.fieldLabel,
          mappedToTemplateField: key,
          mappingStatus: 'auto',
          source,
        });
      }

      let sectionOrder = 0;
      const sections: ParsedFormSection[] = [];
      for (const [title, fields] of sectionMap.entries()) {
        sections.push({ title, fields, order: ++sectionOrder });
      }

      if (sections.length === 0) {
        const fallback = await this.parsePDF(buffer);
        return { ...fallback, rawFields: [] };
      }

      const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0);
      console.log(`PDF parsing complete: ${source} extraction, ${totalFields} total fields (${rawFields.length} unique)`);
      return { sections, totalFields, rawFields };
    } catch (error) {
      console.error('PDF form parsing error:', error);
      try {
        const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;
        const fallback = await this.parsePDF(buffer);
        return { ...fallback, rawFields: [] };
      } catch (fallbackError) {
        console.error('PDF fallback parsing also failed:', fallbackError);
        return { sections: [], totalFields: 0, rawFields: [] };
      }
    }
  }

  private async extractAcroFormFields(buffer: Buffer): Promise<any[]> {
    try {
      const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const pdfFields = form.getFields();

      if (pdfFields.length === 0) return [];

      const results: any[] = [];

      for (const pdfField of pdfFields) {
        const rawName = pdfField.getName();
        if (!rawName) continue;

        const cleanLabel = rawName
          .replace(/^(topmostSubform\[0\]\.Page\d+\[0\]\.|form1\[0\]\.|data\[0\]\.)/i, '')
          .replace(/\[\d+\]/g, '')
          .replace(/\./g, ' - ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/_/g, ' ')
          .trim();

        const fieldLabel = cleanLabel.length > 0 ? cleanLabel : rawName;
        const fieldName = this.labelToFieldName(fieldLabel);
        if (!fieldName || fieldName.length < 1) continue;

        let fieldType: ParsedFormField['fieldType'] = 'text';
        let options: string[] | undefined;
        let defaultValue: string | undefined;

        if (pdfField instanceof PDFTextField) {
          fieldType = this.inferFieldType(fieldLabel);
          try { defaultValue = pdfField.getText() || undefined; } catch {}
        } else if (pdfField instanceof PDFCheckBox) {
          fieldType = 'checkbox';
          try { defaultValue = pdfField.isChecked() ? 'yes' : 'no'; } catch {}
        } else if (pdfField instanceof PDFDropdown) {
          fieldType = 'select';
          try { options = pdfField.getOptions(); } catch {}
          try { const sel = pdfField.getSelected(); if (sel.length > 0) defaultValue = sel[0]; } catch {}
        } else if (pdfField instanceof PDFRadioGroup) {
          fieldType = 'select';
          try { options = pdfField.getOptions(); } catch {}
          try { defaultValue = pdfField.getSelected() || undefined; } catch {}
        } else if (pdfField instanceof PDFOptionList) {
          fieldType = 'select';
          try { options = pdfField.getOptions(); } catch {}
        }

        let section = 'Form Fields';
        const nameParts = rawName.split('.');
        if (nameParts.length > 2) {
          const sectionPart = nameParts.slice(0, -1)
            .filter((p: string) => !p.match(/^(topmostSubform|Page\d+|form1|data)\[\d+\]$/i))
            .map((p: string) => p.replace(/\[\d+\]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '))
            .filter((p: string) => p.length > 0);
          if (sectionPart.length > 0) {
            section = sectionPart[0].charAt(0).toUpperCase() + sectionPart[0].slice(1);
          }
        }

        results.push({
          fieldName,
          fieldType,
          fieldLabel,
          isRequired: false,
          section,
          pdfFieldId: `acro_${fieldName}`,
          rawPdfFieldName: rawName,
          ...(defaultValue ? { defaultValue } : {}),
          ...(options && options.length > 0 ? { options } : {}),
        });
      }

      return results;
    } catch (error) {
      console.error('AcroForm extraction error (non-fatal):', error);
      return [];
    }
  }

  private async extractTextBasedFields(buffer: Buffer): Promise<any[]> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);

      const results: any[] = [];
      const lines = pdfData.text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

      let currentSection = 'General Information';

      const sectionPatterns = [
        /^(section|part|article)\s+[\dIVXivx]+[\.:]/i,
        /^[\dIVXivx]+[\.\)]\s+[A-Z]/,
        /^[A-Z][A-Z\s&\/]{3,}$/,
      ];

      for (const line of lines) {
        const isSectionHeader = sectionPatterns.some(p => p.test(line));
        if (isSectionHeader && line.length < 80) {
          currentSection = line.replace(/^(section|part|article)\s+[\dIVXivx]+[\.:]\s*/i, '').trim();
          if (!currentSection) currentSection = line;
          continue;
        }

        const colonMatch = line.match(/^(.+?):\s*(.*)$/);
        const underscoreField = line.match(/^(.+?)_{3,}/);
        const bracketField = line.match(/^(.+?)\[.*\]/);

        let fieldLabel = '';
        let defaultValue = '';

        if (colonMatch) {
          fieldLabel = colonMatch[1].trim();
          defaultValue = colonMatch[2].trim();
        } else if (underscoreField) {
          fieldLabel = underscoreField[1].trim();
        } else if (bracketField) {
          fieldLabel = bracketField[1].trim();
        }

        if (!fieldLabel || fieldLabel.length < 2 || fieldLabel.length > 100) continue;
        if (/^(page|©|copyright|www\.|http)/i.test(fieldLabel)) continue;

        const fieldName = this.labelToFieldName(fieldLabel);
        const fieldType = this.inferFieldType(fieldLabel);
        const isRequired = /required|\*/i.test(fieldLabel);

        results.push({
          fieldName,
          fieldType,
          fieldLabel: fieldLabel.replace(/\s*\*\s*$/, '').replace(/\s*\(required\)\s*$/i, ''),
          isRequired,
          section: currentSection,
          rawLine: line.slice(0, 200),
          ...(defaultValue ? { defaultValue } : {}),
          ...(fieldType === 'select' && /yes.*no|no.*yes/i.test(fieldLabel.toLowerCase()) ? { options: ['Yes', 'No'] } : {}),
        });
      }

      return results;
    } catch (error) {
      console.error('Text-based extraction error (non-fatal):', error);
      return [];
    }
  }

  convertToDbFields(sections: ParsedFormSection[], formId: number): Omit<PdfFormField, 'id' | 'createdAt'>[] {
    const fields: Omit<PdfFormField, 'id' | 'createdAt'>[] = [];
    
    sections.forEach(section => {
      section.fields.forEach(field => {
        fields.push({
          formId,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          fieldLabel: field.fieldLabel,
          isRequired: field.isRequired,
          options: field.options || null,
          defaultValue: field.defaultValue || null,
          validation: field.validation || null,
          position: field.position
        });
      });
    });

    return fields;
  }
}

export const pdfFormParser = new PDFFormParser();