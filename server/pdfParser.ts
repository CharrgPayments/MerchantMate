import { PdfFormField } from '@shared/schema';
import { getWellsFargoMPAForm } from './wellsFargoMPA';
import { PDFDocument, PDFTextField, PDFDropdown, PDFCheckBox, PDFRadioGroup, PDFButton } from 'pdf-lib';
import { buildFieldName } from '@shared/fieldNaming';

interface ParsedFormField {
  fieldName: string;
  fieldType: 'text' | 'number' | 'percentage' | 'ssn' | 'date' | 'select' | 'checkbox' | 'textarea' | 'phone' | 'email' | 'url' | 'mcc-select' | 'zipcode' | 'ein' | 'radio' | 'boolean' | 'address';
  fieldLabel: string;
  isRequired: boolean;
  options?: Array<{
    label: string;
    value: string;
    pdfFieldId: string;
  }>;
  defaultValue?: string;
  validation?: string;
  position: number;
  section?: string;
  pdfFieldId?: string; // The immutable PDF field identifier (for simple fields)
  pdfFieldIds?: string[]; // Array of PDF field IDs (for grouped fields like radio buttons)
}

interface FieldNameParts {
  section: string;
  fieldName: string;
  optionType: string | null;
  optionValue: string | null;
  isStructured: boolean; // Whether it follows the convention
  groupPath: string; // Unique path for grouping (everything before optionValue)
}

interface ParsedFormSection {
  title: string;
  fields: ParsedFormField[];
  order: number;
}

export class PDFFormParser {
  /**
   * Build a field name using the new period-delimited convention
   * Handles special patterns like owner fields:
   * - section=owners, fieldName=owner1_firstName -> owners.1.firstName
   * - section=owners, fieldName=owner1_address_city -> owners.1.address.city
   * - section=merchant, fieldName=email -> merchant.email
   */
  private buildNewFieldName(section: string, fieldName: string): string {
    // Check for owner pattern: owner1_firstName, owner2_ssn, etc.
    const ownerMatch = fieldName.match(/^owner(\d+)_?(.*)$/);
    if (ownerMatch) {
      const ownerNum = ownerMatch[1];
      const restOfField = ownerMatch[2] || '';
      
      // Check for signature pattern: owner1_signature_owner_signerName
      const sigMatch = restOfField.match(/^signature_owner[_.]?(.*)$/);
      if (sigMatch) {
        const sigField = sigMatch[1] || '';
        if (sigField) {
          return buildFieldName('owners', ownerNum, 'signature', sigField);
        }
        return buildFieldName('owners', ownerNum, 'signature');
      }
      
      // Check for signature pattern without "owner" suffix: owner1_signature_signerName
      const sigMatch2 = restOfField.match(/^signature[_.](.+)$/);
      if (sigMatch2) {
        return buildFieldName('owners', ownerNum, 'signature', sigMatch2[1]);
      }
      
      // Check for address pattern within owner: owner1_address_city -> owners.1.address.city
      const ownerAddressMatch = restOfField.match(/^address_(.+)$/);
      if (ownerAddressMatch) {
        // The captured group is already just the field name (e.g., "city" from "address_city")
        return buildFieldName('owners', ownerNum, 'address', ownerAddressMatch[1]);
      }
      
      // Check for mailing address: owner1_mailing_address_city -> owners.1.mailing.address.city
      const mailingMatch = restOfField.match(/^mailing_address_(.+)$/);
      if (mailingMatch) {
        return buildFieldName('owners', ownerNum, 'mailing', 'address', mailingMatch[1]);
      }
      
      // Regular owner field
      if (restOfField) {
        return buildFieldName('owners', ownerNum, restOfField);
      }
      return buildFieldName('owners', ownerNum);
    }
    
    // Check for address pattern: address_city, address_street1, etc.
    const addressMatch = fieldName.match(/^address_(.+)$/);
    if (addressMatch) {
      return buildFieldName(section, 'address', addressMatch[1]);
    }
    
    // Default: section.fieldName
    return buildFieldName(section, fieldName);
  }

  /**
   * Convert legacy string[] options to new structured format
   */
  private convertOptionsToStructured(options: string[] | undefined, fieldName: string): ParsedFormField['options'] {
    if (!options || options.length === 0) return undefined;
    
    return options.map(opt => ({
      label: opt,
      value: opt.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      pdfFieldId: `${fieldName}_${opt.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`
    }));
  }

  /**
   * Parse field name according to convention:
   * - New format (dot notation): section.fieldName or section.subsection.fieldName
   * - Legacy format (underscore): section_fieldname_optiontype_optionvalue
   * 
   * Examples (new format):
   * - business.legalName
   * - owners.1.firstName
   * - location.address.street
   * 
   * Examples (legacy format):
   * - merchant_business_entity_radio_partnership
   * - merchant_company_email_text
   * - agent_name_text
   */
  private parseFieldName(fieldName: string): FieldNameParts {
    // First check for dot notation (new format)
    // A field is in dot notation if it contains dots and the first part is a valid section name
    if (fieldName.includes('.')) {
      const dotParts = fieldName.split('.');
      if (dotParts.length >= 2 && dotParts[0].length > 0) {
        const section = dotParts[0];
        const restOfName = dotParts.slice(1).join('.');
        
        // Check for type in dot parts (e.g., merchant.businessEntity.radio.partnership)
        // Format: section.fieldName.type.optionValue or section.subsection.fieldName.type.optionValue
        const knownTypes = ['radio', 'checkbox', 'select', 'bool', 'boolean', 'text', 'textarea', 'email', 'phone', 'zipcode', 'ein', 'date', 'address'];
        
        // Find the type keyword in the dot parts
        let typeIndex = -1;
        for (let i = 1; i < dotParts.length; i++) {
          if (knownTypes.includes(dotParts[i])) {
            typeIndex = i;
            break;
          }
        }
        
        if (typeIndex >= 1) {
          // Dot notation with type keyword found
          // Handles both:
          // - section.type.optionValue (e.g., transactionInformation.checkbox.seasonal_jan)
          // - section.fieldName.type.optionValue (e.g., merchant.businessEntity.radio.partnership)
          const optionType = dotParts[typeIndex];
          
          // Get option value - handle both dot notation and underscore notation after type
          let optionValue: string | null = null;
          if (typeIndex + 1 < dotParts.length) {
            // Option value is after type in dot notation (e.g., section.field.radio.partnership)
            optionValue = dotParts.slice(typeIndex + 1).join('.');
          }
          // Also check if the last dot part after type contains underscore-delimited options
          // e.g., transactionInformation.checkbox.seasonal_jan -> optionValue = "seasonal_jan"
          
          // Field name is everything between section and type
          const fieldNameParts = dotParts.slice(1, typeIndex);
          
          // If type is at index 1 (immediately after section), use the option value as the field name
          // e.g., transactionInformation.checkbox.seasonal_jan -> fieldName = "seasonal", optionValue extracted from underscore
          let fieldName = fieldNameParts.join('.');
          
          // Handle underscore in option value to extract logical field name and option
          // e.g., "seasonal_jan" -> fieldName = "seasonal", optionValue = "jan"
          if (fieldName === '' && optionValue && optionValue.includes('_')) {
            const underscoreParts = optionValue.split('_');
            fieldName = underscoreParts[0]; // First part is the field name
            optionValue = underscoreParts.slice(1).join('_'); // Rest is the option value
            console.log(`  → Extracted from underscore: fieldName="${fieldName}", optionValue="${optionValue}"`);
          } else if (fieldName === '' && optionValue) {
            // No underscore, use the option value as the field name
            fieldName = optionValue;
            optionValue = null;
          }
          
          // groupPath is everything up to and including the type (but not optionValue)
          const groupPath = dotParts.slice(0, typeIndex + 1).join('.');
          
          return {
            section: dotParts[0],
            fieldName,
            optionType,
            optionValue,
            isStructured: true,
            groupPath
          };
        }
        
        // Also support hybrid format: section.fieldName_type_optionValue (for backward compatibility)
        const lastPart = dotParts[dotParts.length - 1];
        const underscoreParts = lastPart.split('_');
        let underscoreTypeIndex = -1;
        for (let i = 0; i < underscoreParts.length; i++) {
          if (knownTypes.includes(underscoreParts[i])) {
            underscoreTypeIndex = i;
            break;
          }
        }
        
        if (underscoreTypeIndex > 0) {
          // Has type suffix like _radio, _checkbox, possibly with option value after
          const optionType = underscoreParts[underscoreTypeIndex];
          const fieldNamePart = underscoreParts.slice(0, underscoreTypeIndex).join('_');
          const optionValue = underscoreTypeIndex + 1 < underscoreParts.length 
            ? underscoreParts.slice(underscoreTypeIndex + 1).join('_') 
            : null;
          
          // Reconstruct the field name with section prefix
          const sectionPrefix = dotParts.slice(0, -1).join('.');
          const cleanFieldName = sectionPrefix ? `${sectionPrefix}.${fieldNamePart}` : fieldNamePart;
          
          // groupPath: dot parts + underscore parts up to and including type
          const groupPath = `${dotParts.slice(0, -1).join('.')}.${underscoreParts.slice(0, underscoreTypeIndex + 1).join('_')}`;
          
          return {
            section: dotParts[0],
            fieldName: sectionPrefix.length > dotParts[0].length 
              ? cleanFieldName.substring(dotParts[0].length + 1) 
              : fieldNamePart,
            optionType,
            optionValue,
            isStructured: true,
            groupPath
          };
        }
        
        // Standard dot notation without type suffix
        return {
          section,
          fieldName: restOfName,
          optionType: null,
          optionValue: null,
          isStructured: true,
          groupPath: fieldName // Use the original field name as groupPath
        };
      }
    }
    
    // Fall back to underscore parsing for legacy format
    const parts = fieldName.split('_');
    
    // Need at least section_fieldname for structured fields
    if (parts.length < 2) {
      // Single word field name without section - preserve as-is without adding "general"
      // The field name becomes both the section and the field
      return {
        section: fieldName,
        fieldName: fieldName,
        optionType: null,
        optionValue: null,
        isStructured: false,
        groupPath: fieldName
      };
    }
    
    // Check if this follows our convention
    // Look for known option types: radio, checkbox, select, bool, boolean, text
    const knownTypes = ['radio', 'checkbox', 'select', 'bool', 'boolean', 'text', 'textarea', 'email', 'phone', 'zipcode', 'ein', 'date', 'address'];
    let optionTypeIndex = -1;
    
    for (let i = 0; i < parts.length; i++) {
      if (knownTypes.includes(parts[i])) {
        optionTypeIndex = i;
        break;
      }
    }
    
    if (optionTypeIndex > 0) {
      // Structured field: section_fieldname_optiontype_optionvalue
      const section = parts[0];
      const fieldNamePart = parts.slice(1, optionTypeIndex).join('_');
      const optionType = parts[optionTypeIndex];
      const optionValue = optionTypeIndex + 1 < parts.length ? parts.slice(optionTypeIndex + 1).join('_') : null;
      // groupPath: everything up to and including optionType
      const groupPath = parts.slice(0, optionTypeIndex + 1).join('_');
      
      return {
        section,
        fieldName: fieldNamePart,
        optionType,
        optionValue,
        isStructured: true,
        groupPath
      };
    } else {
      // Legacy format: just section_fieldname
      return {
        section: parts[0],
        fieldName: parts.slice(1).join('_'),
        optionType: null,
        optionValue: null,
        isStructured: false,
        groupPath: fieldName // original input field name
      };
    }
  }

  async parsePDF(buffer: Buffer): Promise<{
    sections: ParsedFormSection[];
    totalFields: number;
    addressGroups?: any[];
    signatureGroups?: any[];
  }> {
    try {
      // Load the PDF document
      const pdfDoc = await PDFDocument.load(buffer);
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      
      console.log(`Extracted ${fields.length} fields from PDF`);
      
      if (fields.length === 0) {
        console.warn('No form fields found in PDF. Using fallback Wells Fargo structure.');
        const sections = this.parseWellsFargoMPA("");
        const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
        return { sections, totalFields, addressGroups: [], signatureGroups: [] };
      }
      
      // Group fields by their base name (section_fieldname_optiontype)
      const fieldGroups = new Map<string, Array<{
        pdfFieldId: string;
        parsedName: FieldNameParts;
        pdfField: any;
        position: number;
      }>>();
      
      fields.forEach((field, index) => {
        const pdfFieldId = field.getName();
        const fieldType = field.constructor.name;
        
        // Debug: Log checkbox fields with more detail
        if (field instanceof PDFCheckBox) {
          const checkbox = field as PDFCheckBox;
          console.log(`🔲 Checkbox field: ${pdfFieldId} | isChecked: ${checkbox.isChecked()}`);
          
          // Check if this checkbox has widgets (multiple appearances)
          try {
            const acroField = (checkbox as any).acroField;
            if (acroField) {
              const widgets = acroField.getWidgets();
              if (widgets && widgets.length > 1) {
                console.log(`  → Has ${widgets.length} widgets (might be checkbox group)`);
              }
            }
          } catch (e) {
            // Ignore errors accessing internal structure
          }
        }
        
        const parsedName = this.parseFieldName(pdfFieldId);
        
        // Use groupPath for grouping - this preserves the original field structure
        // e.g., transactionInformation.seasonal.checkbox.jan → groupPath: transactionInformation.seasonal.checkbox
        // e.g., transactionInformation.checkbox.seasonal → groupPath: transactionInformation.checkbox.seasonal
        const groupKey = parsedName.groupPath;
        
        // Debug: Log grouping for checkbox fields
        if (pdfFieldId.includes('seasonal') && pdfFieldId.includes('checkbox')) {
          console.log(`🔑 Grouping: ${pdfFieldId} → groupKey: ${groupKey} | section: ${parsedName.section} | fieldName: ${parsedName.fieldName} | optionType: ${parsedName.optionType} | optionValue: ${parsedName.optionValue}`);
        }
        
        if (!fieldGroups.has(groupKey)) {
          fieldGroups.set(groupKey, []);
        }
        
        fieldGroups.get(groupKey)!.push({
          pdfFieldId,
          parsedName,
          pdfField: field,
          position: index + 1
        });
      });
      
      // Convert field groups to ParsedFormField objects
      const parsedFields: ParsedFormField[] = [];
      
      fieldGroups.forEach((group, groupKey) => {
        const first = group[0];
        const parsedName = first.parsedName;
        
        console.log(`📋 Processing field: ${first.pdfFieldId} | section: ${parsedName.section} | fieldName: ${parsedName.fieldName} | optionType: ${parsedName.optionType} | isStructured: ${parsedName.isStructured}`);
        
        // Determine if this is a grouped field (radio, checkbox group, etc.)
        if (parsedName.isStructured && group.length > 1 && parsedName.optionType) {
          // Grouped field with options
          const options = group.map(item => ({
            label: this.generateFieldLabel(item.parsedName.optionValue || ''),
            value: item.parsedName.optionValue || '',
            pdfFieldId: item.pdfFieldId
          }));
          
          // Normalize 'bool' to 'boolean' field type
          let fieldType = parsedName.optionType as ParsedFormField['fieldType'];
          if (parsedName.optionType === 'bool') {
            fieldType = 'boolean';
          }
          
          // For grouped fields, use the groupPath to create a unique fieldName
          // e.g., transactionInformation.seasonal.checkbox → seasonal.months (derived from groupPath)
          // This ensures checkbox groups with options have distinct field names
          const groupPathWithoutSection = parsedName.groupPath.startsWith(parsedName.section + '.')
            ? parsedName.groupPath.substring(parsedName.section.length + 1)
            : parsedName.groupPath;
          
          // For checkbox/radio groups with options, use groupPath-derived name
          // e.g., seasonal.checkbox → transactionInformation.seasonal.months
          const fieldNameForGroup = groupPathWithoutSection.replace(/\.checkbox$|\.radio$|\.bool$|\.boolean$/, '.months');
          
          // Generate a distinct label for grouped fields - append "Options" or "Selection"
          const groupFieldLabel = this.generateFieldLabel(parsedName.fieldName) + ' Selection';
          
          console.log(`  → Grouped field: groupPath=${parsedName.groupPath}, derived fieldName=${fieldNameForGroup}, label=${groupFieldLabel}`);
          
          parsedFields.push({
            fieldName: `${parsedName.section}.${fieldNameForGroup}`,
            fieldType,
            fieldLabel: groupFieldLabel,
            isRequired: false,
            options,
            pdfFieldIds: group.map(item => item.pdfFieldId),
            position: first.position,
            section: parsedName.section
          });
        } else {
          // Simple field or single option
          let fieldType: ParsedFormField['fieldType'] = 'text';
          let defaultValue: string | undefined = undefined;
          
          // Detect type from PDF field or from naming convention
          if (parsedName.isStructured && parsedName.optionType) {
            fieldType = parsedName.optionType as ParsedFormField['fieldType'];
            console.log(`  → Using structured type from naming convention: ${parsedName.optionType} → ${fieldType}`);
            // Normalize 'bool' to 'boolean' field type
            if (parsedName.optionType === 'bool') {
              fieldType = 'boolean';
            }
            
            // Handle single checkbox/radio/boolean fields with optionValue
            // These should still have options array even if there's only one option in the PDF
            if ((parsedName.optionType === 'checkbox' || parsedName.optionType === 'radio' || 
                 parsedName.optionType === 'bool' || parsedName.optionType === 'boolean') && 
                parsedName.optionValue) {
              console.log(`  → Single ${parsedName.optionType} field with option: ${parsedName.optionValue}`);
              
              // Create options array with the single option
              const options = group.map(item => ({
                label: this.generateFieldLabel(item.parsedName.optionValue || ''),
                value: item.parsedName.optionValue || '',
                pdfFieldId: item.pdfFieldId
              }));
              
              parsedFields.push({
                fieldName: this.buildNewFieldName(parsedName.section, parsedName.fieldName),
                fieldType,
                fieldLabel: this.generateFieldLabel(parsedName.fieldName),
                isRequired: false,
                options,
                pdfFieldIds: group.map(item => item.pdfFieldId),
                position: first.position,
                section: parsedName.section
              });
              return; // Skip the default push below since we handled it
            }
          } else if (first.pdfField instanceof PDFTextField) {
            const textField = first.pdfField as PDFTextField;
            fieldType = textField.isMultiline() ? 'textarea' : 'text';
            defaultValue = textField.getText() || undefined;
            
            // Enhanced type detection for text fields
            const fieldNameLower = parsedName.fieldName.toLowerCase();
            if (fieldNameLower.includes('date')) fieldType = 'date';
            else if (fieldNameLower.includes('email')) fieldType = 'email';
            else if (fieldNameLower.includes('phone')) fieldType = 'phone';
            else if (fieldNameLower.includes('zip') || fieldNameLower.includes('postal')) fieldType = 'zipcode';
            else if (fieldNameLower.includes('taxid') || fieldNameLower.includes('ein')) fieldType = 'ein';
            else if (fieldNameLower.includes('ssn') || fieldNameLower.includes('social')) fieldType = 'ssn';
            else if (fieldNameLower.includes('percent') || fieldNameLower.includes('ownership')) fieldType = 'percentage';
            else if (fieldNameLower.includes('address') || fieldNameLower.includes('street')) {
              fieldType = 'address';
              console.log(`✅ Detected address field: ${first.pdfFieldId} → fieldName: ${parsedName.fieldName} → type: address`);
            }
          } else if (first.pdfField instanceof PDFCheckBox) {
            fieldType = 'checkbox';
            defaultValue = (first.pdfField as PDFCheckBox).isChecked() ? 'true' : 'false';
            
            // Check if this is a boolean field (Yes/No checkbox pair by naming convention)
            const fieldNameLower = parsedName.fieldName.toLowerCase();
            if (fieldNameLower.includes('_yes') || fieldNameLower.includes('_no') ||
                fieldNameLower.endsWith('yes') || fieldNameLower.endsWith('no') ||
                fieldNameLower.includes('.yes') || fieldNameLower.includes('.no')) {
              console.log(`  → Detected boolean field from checkbox naming: ${first.pdfFieldId}`);
              // Keep as checkbox - boolean grouping happens at a higher level
            }
          } else if (first.pdfField instanceof PDFRadioGroup) {
            // Handle PDF radio button groups
            fieldType = 'radio';
            const radioGroup = first.pdfField as PDFRadioGroup;
            const options = radioGroup.getOptions();
            
            console.log(`  → Detected PDFRadioGroup: ${first.pdfFieldId} with ${options.length} options`);
            
            // Get selected value if any
            try {
              const selected = radioGroup.getSelected();
              if (selected) {
                defaultValue = selected;
              }
            } catch (e) {
              // No selection
            }
            
            // If the radio group has options, create structured options
            if (options.length > 0) {
              parsedFields.push({
                fieldName: this.buildNewFieldName(parsedName.section, parsedName.fieldName),
                fieldType: 'radio',
                fieldLabel: this.generateFieldLabel(parsedName.fieldName),
                isRequired: false,
                options: options.map((opt, idx) => ({
                  label: this.generateFieldLabel(opt),
                  value: opt,
                  pdfFieldId: `${first.pdfFieldId}_${opt}`
                })),
                pdfFieldId: first.pdfFieldId,
                pdfFieldIds: [first.pdfFieldId],
                defaultValue,
                position: first.position,
                section: parsedName.section
              });
              return; // Skip the default push below since we handled it
            }
          } else if (first.pdfField instanceof PDFDropdown) {
            // Handle dropdown/select fields
            fieldType = 'select';
            const dropdown = first.pdfField as PDFDropdown;
            const options = dropdown.getOptions();
            
            console.log(`  → Detected PDFDropdown: ${first.pdfFieldId} with ${options.length} options`);
            
            try {
              const selected = dropdown.getSelected();
              if (selected && selected.length > 0) {
                defaultValue = selected[0];
              }
            } catch (e) {
              // No selection
            }
            
            if (options.length > 0) {
              parsedFields.push({
                fieldName: this.buildNewFieldName(parsedName.section, parsedName.fieldName),
                fieldType: 'select',
                fieldLabel: this.generateFieldLabel(parsedName.fieldName),
                isRequired: false,
                options: options.map((opt) => ({
                  label: this.generateFieldLabel(opt),
                  value: opt,
                  pdfFieldId: `${first.pdfFieldId}_${opt}`
                })),
                pdfFieldId: first.pdfFieldId,
                defaultValue,
                position: first.position,
                section: parsedName.section
              });
              return; // Skip the default push below since we handled it
            }
          }
          
          parsedFields.push({
            fieldName: this.buildNewFieldName(parsedName.section, parsedName.fieldName),
            fieldType,
            fieldLabel: this.generateFieldLabel(parsedName.fieldName),
            isRequired: false,
            pdfFieldId: first.pdfFieldId,
            defaultValue,
            position: first.position,
            section: parsedName.section
          });
        }
      });
      
      // Group fields into sections
      const sections = this.groupFieldsIntoSections(parsedFields);
      const totalFields = parsedFields.length;
      
      // Extract address groups from fields
      const addressGroups = this.extractAddressGroups(parsedFields);
      
      // Extract signature groups from fields
      const signatureGroups = this.extractSignatureGroups(parsedFields);
      
      console.log(`Created ${totalFields} logical fields from ${fields.length} PDF fields`);
      console.log(`✅ Extracted ${addressGroups.length} address groups`);
      console.log(`✅ Extracted ${signatureGroups.length} signature groups`);
      
      return {
        sections,
        totalFields,
        addressGroups,
        signatureGroups
      };
    } catch (error) {
      console.error('Error parsing PDF with pdf-lib:', error);
      console.log('Falling back to Wells Fargo MPA structure');
      
      // Fallback to predefined structure if PDF parsing fails
      const sections = this.parseWellsFargoMPA("");
      const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
      return { sections, totalFields, addressGroups: [], signatureGroups: [] };
    }
  }

  /**
   * Generate a human-readable field label from a PDF field name
   * Examples: "TaxID" -> "Tax ID", "company_email" -> "Company Email"
   */
  private generateFieldLabel(fieldName: string): string {
    // Replace underscores and hyphens with spaces
    let label = fieldName.replace(/[_-]/g, ' ');
    
    // Add spaces before capital letters (for camelCase)
    label = label.replace(/([A-Z])/g, ' $1');
    
    // Capitalize first letter of each word
    label = label.replace(/\b\w/g, char => char.toUpperCase());
    
    // Clean up extra spaces
    label = label.replace(/\s+/g, ' ').trim();
    
    return label;
  }

  /**
   * Group fields into sections based on naming patterns or create a single section
   * Supports both period-delimited (new: section.field) and underscore (legacy: section_field) formats
   */
  private groupFieldsIntoSections(fields: ParsedFormField[]): ParsedFormSection[] {
    // Try to detect sections based on field name prefixes
    const sectionMap = new Map<string, ParsedFormField[]>();
    
    fields.forEach(field => {
      // Check for period-delimited format first (new format: section.field)
      const periodMatch = field.fieldName.match(/^([a-zA-Z]+)\./);
      // Fallback to underscore format (legacy: section_field)
      const underscoreMatch = field.fieldName.match(/^([a-zA-Z]+)_/);
      const match = periodMatch || underscoreMatch;
      
      if (match) {
        const sectionKey = match[1];
        if (!sectionMap.has(sectionKey)) {
          sectionMap.set(sectionKey, []);
        }
        sectionMap.get(sectionKey)!.push(field);
      } else {
        // No prefix, put in "General" section
        if (!sectionMap.has('general')) {
          sectionMap.set('general', []);
        }
        sectionMap.get('general')!.push(field);
      }
    });
    
    // If we only have one section or all fields are in general, use a single "Form Fields" section
    if (sectionMap.size === 1 || (sectionMap.size === 2 && sectionMap.has('general') && sectionMap.get('general')!.length === fields.length)) {
      return [{
        title: 'Form Fields',
        order: 1,
        fields
      }];
    }
    
    // Convert map to sections array
    const sections: ParsedFormSection[] = [];
    let order = 1;
    
    sectionMap.forEach((sectionFields, sectionKey) => {
      sections.push({
        title: this.generateFieldLabel(sectionKey),
        order: order++,
        fields: sectionFields
      });
    });
    
    return sections.sort((a, b) => a.order - b.order);
  }

  /**
   * Extract address groups from parsed fields
   * Pattern: {prefix}.{canonicalField} where canonicalField = street1|street2|city|state|postalcode|country
   * Uses original pdfFieldId which preserves dots (e.g., "merchant_mailing_address.street1")
   */
  private extractAddressGroups(fields: ParsedFormField[]): any[] {
    const addressFieldPattern = /^(.+)\.(street1|street2|address1|address2|apt|suite|city|state|postalcode|zipcode|country)$/i;
    const groupMap = new Map<string, any>();
    
    fields.forEach(field => {
      // Use pdfFieldId (original PDF field name) instead of normalized fieldName
      const pdfFieldId = field.pdfFieldId || field.fieldName;
      const match = pdfFieldId.match(addressFieldPattern);
      
      if (match) {
        const [, prefix, canonicalField] = match;
        
        if (!groupMap.has(prefix)) {
          groupMap.set(prefix, {
            type: prefix.replace(/_/g, ''), // e.g., merchant_mailing_address -> merchantmailingaddress
            sectionName: field.section || 'general',
            fieldMappings: {}
          });
        }
        
        // Map canonical field to the actual normalized field name (what's used in the app)
        const lowerField = canonicalField.toLowerCase();
        const normalizedCanonical = lowerField === 'zipcode' ? 'postalcode' : 
                                   lowerField === 'address1' ? 'street1' : 
                                   lowerField === 'address2' ? 'street2' :
                                   lowerField === 'apt' ? 'street2' :
                                   lowerField === 'suite' ? 'street2' :
                                   lowerField;
        groupMap.get(prefix)!.fieldMappings[normalizedCanonical] = field.fieldName;
        
        console.log(`✅ Address field matched: ${pdfFieldId} → prefix: ${prefix} → canonical: ${normalizedCanonical} → mapped to: ${field.fieldName}`);
      }
    });
    
    return Array.from(groupMap.values());
  }

  /**
   * Extract signature groups from parsed fields
   * Pattern: {prefix}_signature_{role}.{fieldType} where fieldType = signerName|signature|initials|email|dateSigned|ownershipPercentage
   * Uses original pdfFieldId which preserves dots (e.g., "owners_owner1_signature_owner.signerName")
   */
  private extractSignatureGroups(fields: ParsedFormField[]): any[] {
    const signatureFieldPattern = /^(.+)_signature_([^.]+)\.(.+)$/i;
    const groupMap = new Map<string, any>();
    
    fields.forEach(field => {
      // Use pdfFieldId (original PDF field name) instead of normalized fieldName
      const pdfFieldId = field.pdfFieldId || field.fieldName;
      const match = pdfFieldId.match(signatureFieldPattern);
      
      if (match) {
        const [, prefix, role, fieldType] = match;
        const groupKey = `${prefix}_signature_${role}`;
        
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            roleKey: role,
            label: this.generateFieldLabel(`${role} Signature`),
            sectionName: field.section || 'general',
            prefix: prefix,
            fieldMappings: {}
          });
        }
        
        // Map field type to the actual normalized field name (what's used in the app)
        const normalizedFieldType = fieldType.toLowerCase();
        groupMap.get(groupKey)!.fieldMappings[normalizedFieldType] = field.fieldName;
        
        console.log(`✅ Signature field matched: ${pdfFieldId} → prefix: ${prefix} → role: ${role} → fieldType: ${normalizedFieldType} → mapped to: ${field.fieldName}`);
      }
    });
    
    return Array.from(groupMap.values());
  }

  private parseWellsFargoMPA(text: string): ParsedFormSection[] {
    // Use the enhanced Wells Fargo form structure
    const enhancedSections = getWellsFargoMPAForm();
    
    // Convert enhanced sections to ParsedFormSection format with new options structure
    return enhancedSections.map(section => ({
      title: section.title,
      order: section.order,
      fields: section.fields.map(field => ({
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        fieldLabel: field.fieldLabel,
        isRequired: field.isRequired,
        // Convert old string[] options to new structured format
        options: field.options ? field.options.map(opt => ({
          label: opt,
          value: opt.toLowerCase().replace(/\s+/g, '_'),
          pdfFieldId: `${field.fieldName}_${opt.toLowerCase().replace(/\s+/g, '_')}`
        })) : undefined,
        defaultValue: field.defaultValue,
        validation: field.validation,
        position: field.position,
        section: field.section
      }))
    }));
  }

  private parseWellsFargoMPALegacy(text: string): ParsedFormSection[] {
    // Define fields with legacy string[] options format for simplicity
    const legacySections: any[] = [
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

    // Convert legacy sections to new ParsedFormSection format with structured options
    return legacySections.map(section => ({
      title: section.title,
      order: section.order,
      fields: section.fields.map((field: any) => ({
        ...field,
        options: this.convertOptionsToStructured(field.options, field.fieldName)
      }))
    }));
  }

  convertToDbFields(sections: ParsedFormSection[], formId: number): Omit<PdfFormField, 'id' | 'createdAt'>[] {
    const fields: Omit<PdfFormField, 'id' | 'createdAt'>[] = [];
    
    sections.forEach(section => {
      section.fields.forEach(field => {
        // Convert structured options back to string[] for database storage
        const optionsArray = field.options 
          ? field.options.map(opt => opt.label)
          : null;
        
        fields.push({
          formId,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          fieldLabel: field.fieldLabel,
          isRequired: field.isRequired,
          options: optionsArray,
          defaultValue: field.defaultValue || null,
          validation: field.validation || null,
          position: field.position,
          section: field.section || section.title, // Use field's section or default to section title
          pdfFieldId: field.pdfFieldId || (field.pdfFieldIds && field.pdfFieldIds.length > 0 ? JSON.stringify(field.pdfFieldIds) : null) // Store single pdfFieldId or array as JSON
        });
      });
    });

    return fields;
  }
}

export const pdfFormParser = new PDFFormParser();