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
 */
export function convertLegacyFieldName(legacyName: string): string {
  // Handle the mixed format: underscores for hierarchy, dots for final field
  // Pattern: owners_owner1_signature_owner.signerName
  
  let name = legacyName;
  
  // Step 1: Handle owner patterns
  // Match: owners_owner1_... or owner1_...
  const ownerMatch = name.match(/^(?:owners_)?owner(\d+)_(.+)$/);
  if (ownerMatch) {
    const ownerNum = ownerMatch[1];
    const rest = ownerMatch[2];
    
    // Handle signature_owner prefix
    const sigMatch = rest.match(/^signature_owner[._]?(.*)$/);
    if (sigMatch) {
      const sigField = sigMatch[1] || '';
      if (sigField) {
        // owners.1.signature.signerName
        return buildFieldName('owners', ownerNum, 'signature', sigField);
      } else {
        // owners.1.signature
        return buildFieldName('owners', ownerNum, 'signature');
      }
    }
    
    // Handle signature_ prefix without "owner"
    const sigMatch2 = rest.match(/^signature[._](.+)$/);
    if (sigMatch2) {
      return buildFieldName('owners', ownerNum, 'signature', sigMatch2[1]);
    }
    
    // Regular owner field
    // Convert remaining underscores to appropriate structure
    const cleanField = rest.replace(/^signature_/, '').replace(/\./g, FIELD_DELIMITER);
    return buildFieldName('owners', ownerNum, cleanField);
  }
  
  // Step 2: Handle address patterns
  // merchant_location_address_city -> location.address.city
  const addressMatch = name.match(/^(merchant_)?location_address_(.+)$/);
  if (addressMatch) {
    return buildFieldName('location', 'address', addressMatch[2]);
  }
  
  // Step 3: Handle business address patterns
  const businessAddressMatch = name.match(/^(business_)?address_(.+)$/);
  if (businessAddressMatch) {
    return buildFieldName('business', 'address', businessAddressMatch[2]);
  }
  
  // Step 4: Handle mailing address patterns
  const mailingMatch = name.match(/^mailing_address_(.+)$/);
  if (mailingMatch) {
    return buildFieldName('mailing', 'address', mailingMatch[1]);
  }
  
  // Step 5: Handle merchant_ prefix
  if (name.startsWith('merchant_')) {
    name = name.substring(9); // Remove 'merchant_'
  }
  
  // Step 6: Handle generic section_field pattern
  // Replace underscores with periods for hierarchy, but keep some as underscores
  // This is tricky - we need to identify meaningful hierarchy breaks
  
  // Common section prefixes
  const sectionPrefixes = ['business', 'location', 'owners', 'agent', 'banking', 'equipment', 'signatures'];
  
  for (const prefix of sectionPrefixes) {
    if (name.startsWith(`${prefix}_`)) {
      const rest = name.substring(prefix.length + 1);
      return buildFieldName(prefix, rest);
    }
  }
  
  // If no pattern matched, return with dots replacing underscores as a fallback
  // But be careful - some underscores might be part of the field name
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
