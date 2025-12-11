/**
 * Field Naming Convention for Application Templates
 * 
 * Uses period (.) delimiter for hierarchy:
 * - section.fieldName
 * - section.subsection.fieldName
 * - section.index.fieldName (for numbered items like owners)
 * 
 * Examples:
 * - business.legalName
 * - owners.1.firstName
 * - owners.1.signature.data
 * - owners.2.ssn
 * - location.address.street
 * 
 * Benefits:
 * - Easy to split on '.' for parsing
 * - Clear visual hierarchy
 * - Doesn't conflict with underscores in field names
 */

export const FIELD_DELIMITER = '.';

/**
 * Parse a field name into its hierarchical parts
 */
export function parseFieldName(fieldName: string): {
  parts: string[];
  section: string;
  subsection?: string;
  fieldKey: string;
  ownerNumber?: number;
  isOwnerField: boolean;
  isSignatureField: boolean;
} {
  const parts = fieldName.split(FIELD_DELIMITER);
  const section = parts[0] || '';
  
  // Check if this is an owner field (e.g., owners.1.firstName)
  const isOwnerField = section === 'owners' && parts.length >= 3 && !isNaN(parseInt(parts[1]));
  const ownerNumber = isOwnerField ? parseInt(parts[1]) : undefined;
  
  // Check if this is a signature field
  const isSignatureField = parts.some(p => p === 'signature');
  
  // Get the field key (last part)
  const fieldKey = parts[parts.length - 1] || '';
  
  // Get subsection if exists
  let subsection: string | undefined;
  if (isOwnerField && parts.length >= 4) {
    subsection = parts[2]; // e.g., 'signature' in owners.1.signature.data
  } else if (parts.length >= 3) {
    subsection = parts[1];
  }
  
  return {
    parts,
    section,
    subsection,
    fieldKey,
    ownerNumber,
    isOwnerField,
    isSignatureField,
  };
}

/**
 * Build a field name from parts
 */
export function buildFieldName(...parts: (string | number)[]): string {
  return parts.filter(p => p !== undefined && p !== null && p !== '').join(FIELD_DELIMITER);
}

/**
 * Convert legacy underscore-based field names to new period-based convention
 * 
 * Legacy patterns:
 * - owners_owner1_signature_owner.signerName -> owners.1.signature.signerName
 * - owners_owner2_signature_owner_howLongYears -> owners.2.howLongYears
 * - merchant_location_address_city -> location.address.city
 * - signatureGroup_owners_owner1_signature_owner -> signatureGroup.owners.1.signature
 */
export function convertLegacyFieldName(legacyName: string): string {
  let name = legacyName;
  
  // Skip if already in new format (contains periods but no underscores in hierarchy)
  if (name.includes(FIELD_DELIMITER) && !name.includes('_owner') && !name.includes('_signature_')) {
    return name;
  }
  
  // Step 1: Handle signatureGroup_ prefix
  // signatureGroup_owners_owner1_signature_owner -> signatureGroup.owners.1.signature
  const sigGroupMatch = name.match(/^signatureGroup_(.+)$/);
  if (sigGroupMatch) {
    const innerPart = convertLegacyFieldName(sigGroupMatch[1]);
    return buildFieldName('signatureGroup', innerPart);
  }
  
  // Step 2: Handle owner patterns with various formats
  // Match: owners_owner1_... or owner1_...
  const ownerPatterns = [
    // owners_owner1_signature_owner.signerName
    /^owners_owner(\d+)_signature_owner[._]?(.*)$/,
    // owners_owner1_signature.signerName (alt format)
    /^owners_owner(\d+)_signature[._](.+)$/,
    // owners_owner1_firstName
    /^owners_owner(\d+)_(.+)$/,
    // owner1_signature_owner.signerName
    /^owner(\d+)_signature_owner[._]?(.*)$/,
    // owner1_firstName
    /^owner(\d+)_(.+)$/,
  ];
  
  for (const pattern of ownerPatterns) {
    const match = name.match(pattern);
    if (match) {
      const ownerNum = match[1];
      let rest = match[2] || '';
      
      // Detect signature field within owner
      const isSignatureField = pattern.source.includes('signature');
      
      if (isSignatureField) {
        // Clean up the field name part (remove leading dots/underscores)
        rest = rest.replace(/^[._]/, '');
        if (rest) {
          return buildFieldName('owners', ownerNum, 'signature', rest);
        }
        return buildFieldName('owners', ownerNum, 'signature');
      }
      
      // Regular owner field - convert remaining underscores if they look like hierarchy
      // but keep underscores in actual field names (like first_name)
      const cleanField = rest.replace(/\./g, FIELD_DELIMITER);
      return buildFieldName('owners', ownerNum, cleanField);
    }
  }
  
  // Step 3: Handle address patterns
  const addressPatterns = [
    // merchant_location_address_city -> location.address.city
    { pattern: /^merchant_location_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('location', 'address', m[1]) },
    // location_address_city -> location.address.city
    { pattern: /^location_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('location', 'address', m[1]) },
    // merchant_mailing_address_city -> mailing.address.city
    { pattern: /^merchant_mailing_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('mailing', 'address', m[1]) },
    // mailing_address_city -> mailing.address.city
    { pattern: /^mailing_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('mailing', 'address', m[1]) },
    // business_address_city -> business.address.city  
    { pattern: /^business_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('business', 'address', m[1]) },
    // owner1_address_city -> owners.1.address.city
    { pattern: /^owner(\d+)_address_(.+)$/, replacement: (m: RegExpMatchArray) => buildFieldName('owners', m[1], 'address', m[2]) },
  ];
  
  for (const { pattern, replacement } of addressPatterns) {
    const match = name.match(pattern);
    if (match) {
      return replacement(match);
    }
  }
  
  // Step 4: Handle merchant_ prefix for other fields
  if (name.startsWith('merchant_')) {
    name = name.substring(9); // Remove 'merchant_'
    // Continue processing with cleaned name
  }
  
  // Step 5: Handle known section prefixes with subsections
  const sectionSubsectionPatterns = [
    // business_entity_type -> business.entityType
    { pattern: /^business_(.+)$/, section: 'business' },
    // banking_account_number -> banking.accountNumber
    { pattern: /^banking_(.+)$/, section: 'banking' },
    // equipment_terminal_type -> equipment.terminalType
    { pattern: /^equipment_(.+)$/, section: 'equipment' },
    // agent_name -> agent.name
    { pattern: /^agent_(.+)$/, section: 'agent' },
    // location_phone -> location.phone
    { pattern: /^location_(.+)$/, section: 'location' },
  ];
  
  for (const { pattern, section } of sectionSubsectionPatterns) {
    const match = name.match(pattern);
    if (match) {
      const fieldPart = match[1];
      // Don't convert underscores within the field name itself
      return buildFieldName(section, fieldPart);
    }
  }
  
  // Step 6: Return unchanged if no pattern matched
  // This preserves simple field names and prevents over-conversion
  return name;
}

/**
 * Convert new period-based field names back to legacy format (for compatibility)
 */
export function convertToLegacyFieldName(newName: string): string {
  const parsed = parseFieldName(newName);
  
  if (parsed.isOwnerField && parsed.ownerNumber) {
    // owners.1.signature.signerName -> owners_owner1_signature_owner.signerName
    if (parsed.isSignatureField && parsed.subsection === 'signature') {
      const sigField = parsed.parts.slice(3).join('.');
      return `owners_owner${parsed.ownerNumber}_signature_owner.${sigField}`;
    }
    // owners.1.firstName -> owners_owner1_firstName
    const field = parsed.parts.slice(2).join('_');
    return `owners_owner${parsed.ownerNumber}_${field}`;
  }
  
  // For non-owner fields, just replace periods with underscores
  return newName.split(FIELD_DELIMITER).join('_');
}

/**
 * Group fields by owner number for UI rendering
 */
export function groupFieldsByOwner(fieldNames: string[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  
  for (const fieldName of fieldNames) {
    const parsed = parseFieldName(fieldName);
    if (parsed.isOwnerField && parsed.ownerNumber) {
      if (!groups.has(parsed.ownerNumber)) {
        groups.set(parsed.ownerNumber, []);
      }
      groups.get(parsed.ownerNumber)!.push(fieldName);
    }
  }
  
  return groups;
}

/**
 * Check if a field belongs to a specific owner
 */
export function isFieldForOwner(fieldName: string, ownerNumber: number): boolean {
  const parsed = parseFieldName(fieldName);
  return parsed.isOwnerField && parsed.ownerNumber === ownerNumber;
}

/**
 * Get the owner number from a field name (if applicable)
 */
export function getOwnerNumberFromField(fieldName: string): number | null {
  // Try new format first
  const parsed = parseFieldName(fieldName);
  if (parsed.ownerNumber) {
    return parsed.ownerNumber;
  }
  
  // Try legacy format
  const legacyMatch = fieldName.match(/(?:owners_)?owner(\d+)/);
  if (legacyMatch) {
    return parseInt(legacyMatch[1]);
  }
  
  return null;
}

/**
 * Check if field is a signature group field
 */
export function isSignatureGroupField(fieldName: string): boolean {
  return fieldName.includes('.signature.') || 
         fieldName.includes('_signature_') ||
         fieldName.startsWith('signatureGroup_');
}
