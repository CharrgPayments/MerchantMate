import { PdfFormField } from '@shared/schema';
import { getWellsFargoMPAForm } from './wellsFargoMPA';
import * as fs from 'fs';

export type FieldType =
  | 'text' | 'email' | 'phone' | 'date' | 'url' | 'textarea'
  | 'number' | 'currency' | 'percentage'
  | 'ein' | 'ssn' | 'zipcode'
  | 'select' | 'checkbox' | 'radio' | 'boolean' | 'checkbox-list'
  | 'address' | 'signature' | 'mcc-select'
  | 'bank_account' | 'bank_routing'
  | 'disclosure' | 'owner_group';

export interface ParsedFormField {
  fieldName: string;
  fieldType: FieldType;
  fieldLabel: string;
  isRequired: boolean;
  options?: any[];
  defaultValue?: string;
  validation?: string;
  position: number;
  section?: string;
  pdfFieldId?: string;
  pdfFieldIds?: string[];
  rawPdfFieldName?: string;
  rawPdfFieldNames?: string[];
}

export interface ParsedFormSection {
  title: string;
  fields: ParsedFormField[];
  order: number;
}

export interface ParseWarning {
  field: string;
  issue: 'no_dot_notation' | 'all_caps' | 'unknown_section' | 'empty_name' | 'duplicate' | 'no_type_detected' | 'unnamed_field';
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
}

export interface ParseResult {
  sections: ParsedFormSection[];
  totalFields: number;
  rawFields: RawFieldInfo[];
  warnings: ParseWarning[];
  summary: {
    source: 'acroform' | 'text' | 'predefined';
    totalRawFields: number;
    properlyNamedFields: number;
    skippedFields: number;
    groupedFields: number;
    fieldsByType: Record<string, number>;
    fieldsBySection: Record<string, number>;
  };
}

export interface RawFieldInfo {
  pdfFieldId: string;
  fieldName: string;
  originalLabel: string;
  detectedType: string;
  required: boolean;
  section: string;
  position: number;
  rawLine: string;
  mappedToTemplateField: string;
  mappingStatus: 'auto' | 'manual' | 'unmapped';
  source: string;
}

const SECTION_MAP: Record<string, string> = {
  'merchant': 'Merchant Information',
  'business': 'Business Information',
  'transactionInformation': 'Transaction Information',
  'transaction': 'Transaction Information',
  'creditDebitAuth': 'Credit & Debit Authorization',
  'owners': 'Ownership Information',
  'ownership': 'Ownership Information',
  'owner': 'Ownership Information',
  'agent': 'Agent Information',
  'equipment': 'Equipment',
  'pricing': 'Pricing & Fees',
  'fees': 'Pricing & Fees',
  'bankInformation': 'Bank Information',
  'bank': 'Bank Information',
  'banking': 'Bank Information',
  'contact': 'Contact Information',
  'billing': 'Billing Information',
  'shipping': 'Shipping Information',
  'compliance': 'Compliance',
  'security': 'Security Information',
  'products': 'Products & Services',
  'services': 'Products & Services',
};

const FIELD_TYPE_RULES: Array<{
  pattern: RegExp;
  type: FieldType;
}> = [
  { pattern: /\.address\./i, type: 'address' },
  { pattern: /\.radio\./i, type: 'radio' },
  { pattern: /\.checkbox\./i, type: 'checkbox-list' },
  { pattern: /\.bool\./i, type: 'boolean' },

  { pattern: /e[\-_]?mail$/i, type: 'email' },
  { pattern: /companyemail$/i, type: 'email' },
  { pattern: /emailaddress$/i, type: 'email' },

  { pattern: /phone$/i, type: 'phone' },
  { pattern: /fax$/i, type: 'phone' },
  { pattern: /faxnumber$/i, type: 'phone' },
  { pattern: /tel$/i, type: 'phone' },
  { pattern: /telephone$/i, type: 'phone' },
  { pattern: /mobile$/i, type: 'phone' },
  { pattern: /mobilephone$/i, type: 'phone' },
  { pattern: /cellphone$/i, type: 'phone' },
  { pattern: /companyphone$/i, type: 'phone' },
  { pattern: /descriptorphone$/i, type: 'phone' },

  { pattern: /date$/i, type: 'date' },
  { pattern: /dob$/i, type: 'date' },
  { pattern: /dateofbirth$/i, type: 'date' },
  { pattern: /startdate$/i, type: 'date' },
  { pattern: /enddate$/i, type: 'date' },
  { pattern: /businessstartdate$/i, type: 'date' },
  { pattern: /expirationdate$/i, type: 'date' },

  { pattern: /url$/i, type: 'url' },
  { pattern: /website$/i, type: 'url' },
  { pattern: /companyurl$/i, type: 'url' },
  { pattern: /webaddress$/i, type: 'url' },

  { pattern: /taxid$/i, type: 'ein' },
  { pattern: /ein$/i, type: 'ein' },
  { pattern: /employerid$/i, type: 'ein' },
  { pattern: /federaltaxid$/i, type: 'ein' },

  { pattern: /ssn$/i, type: 'ssn' },
  { pattern: /socialsecurity$/i, type: 'ssn' },
  { pattern: /socialsecuritynumber$/i, type: 'ssn' },

  { pattern: /postalcode$/i, type: 'zipcode' },
  { pattern: /zip$/i, type: 'zipcode' },
  { pattern: /zipcode$/i, type: 'zipcode' },

  { pattern: /bankaccountnumber$/i, type: 'bank_account' },
  { pattern: /accountnumber$/i, type: 'bank_account' },

  { pattern: /bankroutingnumber$/i, type: 'bank_routing' },
  { pattern: /routingnumber$/i, type: 'bank_routing' },
  { pattern: /abanumber$/i, type: 'bank_routing' },

  { pattern: /signature$/i, type: 'signature' },

  { pattern: /mcccode$/i, type: 'mcc-select' },
  { pattern: /mcc$/i, type: 'mcc-select' },
  { pattern: /sellsproductsservices$/i, type: 'mcc-select' },
  { pattern: /merchantcategorycode$/i, type: 'mcc-select' },

  { pattern: /percentage$/i, type: 'percentage' },
  { pattern: /percent$/i, type: 'percentage' },
  { pattern: /rate$/i, type: 'percentage' },
  { pattern: /swipedpercentage$/i, type: 'percentage' },
  { pattern: /keyedpercentage$/i, type: 'percentage' },
  { pattern: /internetpercentage$/i, type: 'percentage' },
  { pattern: /motopercentage$/i, type: 'percentage' },

  { pattern: /amount$/i, type: 'currency' },
  { pattern: /volume$/i, type: 'currency' },
  { pattern: /ticket$/i, type: 'currency' },
  { pattern: /ticketamount$/i, type: 'currency' },
  { pattern: /price$/i, type: 'currency' },
  { pattern: /fee$/i, type: 'currency' },
  { pattern: /cost$/i, type: 'currency' },
  { pattern: /monthlyvolume$/i, type: 'currency' },
  { pattern: /annualvolume$/i, type: 'currency' },
  { pattern: /averagemonthlyvolume$/i, type: 'currency' },
  { pattern: /averageticket$/i, type: 'currency' },
  { pattern: /highestticket$/i, type: 'currency' },

  { pattern: /description$/i, type: 'textarea' },
  { pattern: /comment$/i, type: 'textarea' },
  { pattern: /comments$/i, type: 'textarea' },
  { pattern: /notes?$/i, type: 'textarea' },
  { pattern: /detail$/i, type: 'textarea' },
  { pattern: /details$/i, type: 'textarea' },
  { pattern: /explain$/i, type: 'textarea' },
  { pattern: /explanation$/i, type: 'textarea' },
  { pattern: /businessdescription$/i, type: 'textarea' },
];

function humanizeFieldName(dotName: string): string {
  const lastPart = dotName.split('.').pop() || dotName;
  return lastPart
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function deriveSectionFromFieldName(fieldId: string): string {
  const parts = fieldId.split('.');
  if (parts.length < 2) return 'Form Fields';
  const sectionKey = parts[0];
  return SECTION_MAP[sectionKey] || humanizeFieldName(sectionKey);
}

function inferFieldTypeFromName(fieldName: string): FieldType {
  const lastPart = fieldName.split('.').pop()?.toLowerCase() || '';

  for (const rule of FIELD_TYPE_RULES) {
    if (rule.pattern.test(lastPart) || rule.pattern.test(fieldName)) {
      return rule.type;
    }
  }

  return 'text';
}

function inferFieldTypeFromLabel(label: string): FieldType {
  const lower = label.toLowerCase();
  if (/e[\-_\s]?mail/i.test(lower)) return 'email';
  if (/phone|fax|tel(?:ephone)?|mobile|cell/i.test(lower)) return 'phone';
  if (/date|dob|d\.o\.b|birth/i.test(lower)) return 'date';
  if (/url|website|web\s*site/i.test(lower)) return 'url';
  if (/signature/i.test(lower)) return 'signature';
  if (/ssn|social\s*security/i.test(lower)) return 'ssn';
  if (/ein|tax\s*id|federal\s*id/i.test(lower)) return 'ein';
  if (/routing|aba/i.test(lower)) return 'bank_routing';
  if (/account\s*#|account\s*number|acct\s*num/i.test(lower)) return 'bank_account';
  if (/zip\s*code|postal/i.test(lower)) return 'zipcode';
  if (/percent|%/i.test(lower)) return 'percentage';
  if (/amount|volume|ticket|price|\$|revenue|sales|fee|cost/i.test(lower)) return 'currency';
  if (/description|comment|note|detail|explain|reason/i.test(lower)) return 'textarea';
  if (/yes.*no|no.*yes/i.test(lower)) return 'select';
  return 'text';
}

function isProperlyNamed(name: string): boolean {
  if (!name || name.trim() === '') return false;
  if (!name.includes('.')) return false;
  const firstSegment = name.split('.')[0];
  if (firstSegment === 'undefined' || firstSegment === '') return false;
  if (/^[A-Z\s_\d]+$/.test(firstSegment)) return false;
  if (/[a-z]/.test(firstSegment)) return true;
  return false;
}

function toCamelCase(str: string): string {
  return str
    .replace(/[\s_-]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, c => c.toLowerCase());
}

function guessSection(name: string): string {
  const lower = name.toLowerCase().replace(/[\s_-]+/g, '');
  if (/bank|routing|aba|account/i.test(lower)) return 'bankInformation';
  if (/owner|principal|signer|officer|guarantor|partner/i.test(lower)) return 'owners';
  if (/transaction|volume|ticket|swiped|keyed|internet|moto/i.test(lower)) return 'transactionInformation';
  if (/equip|terminal|device|gateway|pos/i.test(lower)) return 'equipment';
  if (/pric|fee|rate|discount|markup|interchange/i.test(lower)) return 'pricing';
  if (/agent|rep|sales|iso/i.test(lower)) return 'agent';
  if (/contact|phone|fax|mobile/i.test(lower)) return 'contact';
  if (/billing/i.test(lower)) return 'billing';
  if (/shipping/i.test(lower)) return 'shipping';
  return 'merchant';
}

function suggestFieldName(rawName: string): string {
  const cleaned = rawName
    .replace(/^(TEXT|FIELD|INPUT|CHK|CB|RB|COMBO|DROPDOWN|EDIT|BTN|BUTTON|LBL|LABEL|TXT|FLD|NUM)\s*/i, '')
    .replace(/[\[\](){}#]/g, '')
    .replace(/^\d+\s*[-_.]\s*/, '')
    .trim();

  if (!cleaned) return 'merchant.fieldName';

  const words = cleaned
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .split('_')
    .filter(w => w.length > 0);

  if (words.length === 0) return 'merchant.fieldName';

  const fieldPart = words.map((w, i) => 
    i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join('');

  const section = guessSection(cleaned);
  return `${section}.${fieldPart}`;
}

function classifySkippedField(name: string): ParseWarning {
  if (!name || name.trim() === '') {
    return {
      field: name || '(empty)',
      issue: 'empty_name',
      message: 'Field has no name. It cannot be parsed.',
      severity: 'warning',
      suggestion: 'Give this field a name in your PDF editor using dot notation, e.g. merchant.legalBusinessName',
    };
  }

  const suggested = suggestFieldName(name);

  if (!name.includes('.')) {
    const detectedType = inferFieldTypeFromName(suggested);
    return {
      field: name,
      issue: 'no_dot_notation',
      message: `Field "${name}" is missing dot notation (section.fieldName). It was skipped.`,
      severity: 'warning',
      suggestion: `Rename to "${suggested}" in your PDF editor. This will be detected as type "${detectedType}" in the "${guessSection(name)}" section.`,
    };
  }

  const firstSegment = name.split('.')[0];
  if (/^[A-Z\s_\d]+$/.test(firstSegment)) {
    const camelSection = toCamelCase(firstSegment);
    const knownSection = SECTION_MAP[camelSection] ? camelSection : guessSection(firstSegment);
    const rest = name.split('.').slice(1).join('.');
    const fixedName = `${knownSection}.${rest}`;
    return {
      field: name,
      issue: 'all_caps',
      message: `Section prefix "${firstSegment}" is ALL CAPS. The parser expects camelCase.`,
      severity: 'warning',
      suggestion: `Rename to "${fixedName}" in your PDF editor. Section "${knownSection}" maps to "${SECTION_MAP[knownSection] || humanizeFieldName(knownSection)}".`,
    };
  }

  return {
    field: name,
    issue: 'unnamed_field',
    message: `Field "${name}" could not be classified.`,
    severity: 'info',
    suggestion: `Try renaming to "${suggested}" in your PDF editor.`,
  };
}

interface GroupedField {
  fieldId: string;
  fieldType: FieldType;
  fieldLabel: string;
  options: string[];
  rawPdfFieldNames: string[];
  section: string;
}

function groupAcroFormFields(properFields: string[], skippedNames: string[]): { groups: Map<string, GroupedField>; warnings: ParseWarning[] } {
  const groups = new Map<string, GroupedField>();
  const warnings: ParseWarning[] = [];

  for (const name of skippedNames) {
    warnings.push(classifySkippedField(name));
  }

  for (const rawName of properFields) {
    const radioMatch = rawName.match(/^(.+?)\.radio\.(.+)$/);
    if (radioMatch) {
      const groupId = radioMatch[1];
      const optionValue = radioMatch[2];
      const existing = groups.get(groupId);
      if (existing) {
        existing.options.push(optionValue);
        existing.rawPdfFieldNames.push(rawName);
      } else {
        groups.set(groupId, {
          fieldId: groupId,
          fieldType: 'radio',
          fieldLabel: humanizeFieldName(groupId),
          options: [optionValue],
          rawPdfFieldNames: [rawName],
          section: deriveSectionFromFieldName(groupId),
        });
      }
      continue;
    }

    const boolMatch = rawName.match(/^(.+?)\.bool\.(yes|no)$/i);
    if (boolMatch) {
      const groupId = boolMatch[1];
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          fieldId: groupId,
          fieldType: 'boolean',
          fieldLabel: humanizeFieldName(groupId),
          options: ['Yes', 'No'],
          rawPdfFieldNames: [rawName],
          section: deriveSectionFromFieldName(groupId),
        });
      } else {
        groups.get(groupId)!.rawPdfFieldNames.push(rawName);
      }
      continue;
    }

    const checkboxMatch = rawName.match(/^(.+?)\.checkbox\.(.+)$/);
    if (checkboxMatch) {
      const groupId = checkboxMatch[1];
      const optionValue = checkboxMatch[2];
      const existing = groups.get(groupId);
      if (existing) {
        existing.options.push(optionValue);
        existing.rawPdfFieldNames.push(rawName);
      } else {
        groups.set(groupId, {
          fieldId: groupId,
          fieldType: 'checkbox-list',
          fieldLabel: humanizeFieldName(groupId),
          options: [optionValue],
          rawPdfFieldNames: [rawName],
          section: deriveSectionFromFieldName(groupId),
        });
      }
      continue;
    }

    const addressMatch = rawName.match(/^(.+?)\.(address)\.(street1|street2|city|state|postalCode|zip|zipCode|country)$/i);
    if (addressMatch) {
      const groupId = `${addressMatch[1]}.${addressMatch[2]}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          fieldId: groupId,
          fieldType: 'address',
          fieldLabel: humanizeFieldName(addressMatch[1]) + ' Address',
          options: [],
          rawPdfFieldNames: [rawName],
          section: deriveSectionFromFieldName(addressMatch[1]),
        });
      } else {
        groups.get(groupId)!.rawPdfFieldNames.push(rawName);
      }
      continue;
    }

    const fieldType = inferFieldTypeFromName(rawName);
    groups.set(rawName, {
      fieldId: rawName,
      fieldType,
      fieldLabel: humanizeFieldName(rawName),
      options: [],
      rawPdfFieldNames: [rawName],
      section: deriveSectionFromFieldName(rawName),
    });
  }

  return { groups, warnings };
}

function groupsToParseResult(
  groups: Map<string, GroupedField>,
  warnings: ParseWarning[],
  source: 'acroform' | 'text' | 'predefined',
  totalRawFields: number,
  properCount: number,
  skippedCount: number,
): ParseResult {
  const seenFieldNames = new Set<string>();
  const rawFields: RawFieldInfo[] = [];
  const sectionMap = new Map<string, ParsedFormField[]>();
  const fieldsByType: Record<string, number> = {};
  let position = 0;
  let groupedCount = 0;

  for (const [, group] of groups) {
    if (seenFieldNames.has(group.fieldId)) {
      warnings.push({ field: group.fieldId, issue: 'duplicate', message: `Duplicate field "${group.fieldId}" — only the first occurrence is used.`, severity: 'info' });
      continue;
    }
    seenFieldNames.add(group.fieldId);
    position++;

    if (group.rawPdfFieldNames.length > 1) groupedCount++;

    const optionLabels = group.options.map(opt =>
      opt.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
    );

    const pdfFieldId = `acro_${group.fieldId}`;
    const section = group.section;

    const parsedField: ParsedFormField = {
      fieldName: group.fieldId,
      fieldType: group.fieldType,
      fieldLabel: group.fieldLabel,
      isRequired: false,
      position,
      section,
      pdfFieldId,
      pdfFieldIds: group.rawPdfFieldNames,
      rawPdfFieldName: group.rawPdfFieldNames[0],
      rawPdfFieldNames: group.rawPdfFieldNames,
      ...(optionLabels.length > 0 && group.fieldType !== 'address'
        ? { options: optionLabels.map((label, i) => ({ label, value: group.options[i] })) }
        : {}),
    };

    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section)!.push(parsedField);

    fieldsByType[group.fieldType] = (fieldsByType[group.fieldType] || 0) + 1;

    rawFields.push({
      pdfFieldId,
      fieldName: group.fieldId,
      originalLabel: group.fieldLabel,
      detectedType: group.fieldType,
      required: false,
      section,
      position,
      rawLine: group.rawPdfFieldNames[0],
      mappedToTemplateField: group.fieldId,
      mappingStatus: 'auto',
      source,
    });
  }

  let sectionOrder = 0;
  const sections: ParsedFormSection[] = [];
  const fieldsBySection: Record<string, number> = {};
  for (const [title, fields] of sectionMap.entries()) {
    sections.push({ title, fields, order: ++sectionOrder });
    fieldsBySection[title] = fields.length;
  }

  const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0);

  return {
    sections,
    totalFields,
    rawFields,
    warnings,
    summary: {
      source,
      totalRawFields,
      properlyNamedFields: properCount,
      skippedFields: skippedCount,
      groupedFields: groupedCount,
      fieldsByType,
      fieldsBySection,
    },
  };
}

export class PDFFormParser {
  async parsePDF(buffer: Buffer): Promise<{
    sections: ParsedFormSection[];
    totalFields: number;
  }> {
    const sections = this.parseWellsFargoMPA("");
    const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
    return { sections, totalFields };
  }

  private parseWellsFargoMPA(text: string): ParsedFormSection[] {
    const enhancedSections = getWellsFargoMPAForm();
    return enhancedSections.map(section => ({
      title: section.title,
      order: section.order,
      fields: section.fields.map(field => ({
        fieldName: field.fieldName,
        fieldType: field.fieldType as FieldType,
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

  async parsePDFForm(filePathOrBuffer: string | Buffer): Promise<ParseResult> {
    try {
      const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;

      const acroResult = await this.extractAcroFormFields(buffer);

      if (acroResult.sections.length > 0) {
        console.log(`PDF parsing complete: acroform extraction, ${acroResult.totalFields} fields (${acroResult.summary.properlyNamedFields} properly named, ${acroResult.summary.skippedFields} skipped, ${acroResult.warnings.length} warnings)`);
        return acroResult;
      }

      const textResult = await this.extractTextBasedFields(buffer);
      if (textResult.sections.length > 0) {
        console.log(`PDF parsing complete: text extraction, ${textResult.totalFields} fields`);
        return textResult;
      }

      const fallback = await this.parsePDF(buffer);
      return {
        ...fallback,
        rawFields: [],
        warnings: [{ field: '(document)', issue: 'unnamed_field', message: 'No form fields found in PDF. Using predefined template as fallback.', severity: 'warning' }],
        summary: {
          source: 'predefined',
          totalRawFields: 0,
          properlyNamedFields: 0,
          skippedFields: 0,
          groupedFields: 0,
          fieldsByType: {},
          fieldsBySection: {},
        },
      };
    } catch (error) {
      console.error('PDF form parsing error:', error);
      try {
        const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;
        const fallback = await this.parsePDF(buffer);
        return {
          ...fallback,
          rawFields: [],
          warnings: [{ field: '(document)', issue: 'unnamed_field', message: `PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}. Using predefined template.`, severity: 'error' }],
          summary: {
            source: 'predefined',
            totalRawFields: 0,
            properlyNamedFields: 0,
            skippedFields: 0,
            groupedFields: 0,
            fieldsByType: {},
            fieldsBySection: {},
          },
        };
      } catch (fallbackError) {
        console.error('PDF fallback parsing also failed:', fallbackError);
        return {
          sections: [],
          totalFields: 0,
          rawFields: [],
          warnings: [{ field: '(document)', issue: 'unnamed_field', message: 'All PDF parsing methods failed.', severity: 'error' }],
          summary: {
            source: 'predefined',
            totalRawFields: 0,
            properlyNamedFields: 0,
            skippedFields: 0,
            groupedFields: 0,
            fieldsByType: {},
            fieldsBySection: {},
          },
        };
      }
    }
  }

  private async extractAcroFormFields(buffer: Buffer): Promise<ParseResult> {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const pdfFields = form.getFields();

      if (pdfFields.length === 0) {
        return {
          sections: [],
          totalFields: 0,
          rawFields: [],
          warnings: [],
          summary: { source: 'acroform', totalRawFields: 0, properlyNamedFields: 0, skippedFields: 0, groupedFields: 0, fieldsByType: {}, fieldsBySection: {} },
        };
      }

      const rawNames: string[] = [];
      for (const pdfField of pdfFields) {
        const name = pdfField.getName();
        if (name) rawNames.push(name);
      }

      console.log(`AcroForm: ${rawNames.length} raw PDF fields found`);

      const properFields = rawNames.filter(isProperlyNamed);
      const skippedNames = rawNames.filter(n => !isProperlyNamed(n));

      if (skippedNames.length > 0) {
        console.log(`AcroForm: skipped ${skippedNames.length} fields without proper naming convention`);
      }

      const { groups, warnings } = groupAcroFormFields(properFields, skippedNames);

      const result = groupsToParseResult(
        groups,
        warnings,
        'acroform',
        rawNames.length,
        properFields.length,
        skippedNames.length,
      );

      console.log(`AcroForm: grouped ${properFields.length} properly-named fields into ${result.totalFields} logical fields (${skippedNames.length} unnamed/legacy fields skipped)`);

      return result;
    } catch (error) {
      console.error('AcroForm extraction error (non-fatal):', error);
      return {
        sections: [],
        totalFields: 0,
        rawFields: [],
        warnings: [{ field: '(document)', issue: 'unnamed_field', message: `AcroForm extraction failed: ${error instanceof Error ? error.message : 'Unknown'}`, severity: 'error' }],
        summary: { source: 'acroform', totalRawFields: 0, properlyNamedFields: 0, skippedFields: 0, groupedFields: 0, fieldsByType: {}, fieldsBySection: {} },
      };
    }
  }

  private async extractTextBasedFields(buffer: Buffer): Promise<ParseResult> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);

      const fields: ParsedFormField[] = [];
      const lines = pdfData.text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

      let currentSection = 'General Information';
      const sectionMap = new Map<string, ParsedFormField[]>();
      let position = 0;
      const fieldsByType: Record<string, number> = {};

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

        const fieldName = fieldLabel
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 80);
        const fieldType = inferFieldTypeFromLabel(fieldLabel);
        const isRequired = /required|\*/i.test(fieldLabel);
        position++;

        const parsedField: ParsedFormField = {
          fieldName,
          fieldType,
          fieldLabel: fieldLabel.replace(/\s*\*\s*$/, '').replace(/\s*\(required\)\s*$/i, ''),
          isRequired,
          position,
          section: currentSection,
          ...(defaultValue ? { defaultValue } : {}),
          ...(fieldType === 'select' && /yes.*no|no.*yes/i.test(fieldLabel.toLowerCase()) ? { options: ['Yes', 'No'] } : {}),
        };

        fields.push(parsedField);
        if (!sectionMap.has(currentSection)) sectionMap.set(currentSection, []);
        sectionMap.get(currentSection)!.push(parsedField);
        fieldsByType[fieldType] = (fieldsByType[fieldType] || 0) + 1;
      }

      let sectionOrder = 0;
      const sections: ParsedFormSection[] = [];
      const fieldsBySection: Record<string, number> = {};
      for (const [title, sectionFields] of sectionMap.entries()) {
        sections.push({ title, fields: sectionFields, order: ++sectionOrder });
        fieldsBySection[title] = sectionFields.length;
      }

      const rawFields: RawFieldInfo[] = fields.map(f => ({
        pdfFieldId: `text_${f.fieldName}_${f.position}`,
        fieldName: f.fieldName,
        originalLabel: f.fieldLabel,
        detectedType: f.fieldType,
        required: f.isRequired,
        section: f.section || 'General Information',
        position: f.position,
        rawLine: f.fieldLabel,
        mappedToTemplateField: f.fieldName,
        mappingStatus: 'auto' as const,
        source: 'text',
      }));

      return {
        sections,
        totalFields: fields.length,
        rawFields,
        warnings: [],
        summary: {
          source: 'text',
          totalRawFields: fields.length,
          properlyNamedFields: fields.length,
          skippedFields: 0,
          groupedFields: 0,
          fieldsByType,
          fieldsBySection,
        },
      };
    } catch (error) {
      console.error('Text-based extraction error (non-fatal):', error);
      return {
        sections: [],
        totalFields: 0,
        rawFields: [],
        warnings: [{ field: '(document)', issue: 'unnamed_field', message: `Text extraction failed: ${error instanceof Error ? error.message : 'Unknown'}`, severity: 'error' }],
        summary: { source: 'text', totalRawFields: 0, properlyNamedFields: 0, skippedFields: 0, groupedFields: 0, fieldsByType: {}, fieldsBySection: {} },
      };
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

export {
  humanizeFieldName,
  deriveSectionFromFieldName,
  inferFieldTypeFromName,
  inferFieldTypeFromLabel,
  isProperlyNamed,
  classifySkippedField,
  groupAcroFormFields,
  suggestFieldName,
  guessSection,
  SECTION_MAP,
  FIELD_TYPE_RULES,
};
