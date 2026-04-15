import {
  humanizeFieldName,
  deriveSectionFromFieldName,
  inferFieldTypeFromName,
  isProperlyNamed,
  classifySkippedField,
  groupAcroFormFields,
  suggestFieldName,
  guessSection,
  SECTION_MAP,
} from './pdfParser';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function test(name: string, fn: () => void) {
  console.log(`\n  ${name}`);
  fn();
}

console.log('\n=== PDF Parser Unit Tests ===\n');

test('humanizeFieldName - basic camelCase', () => {
  assert(humanizeFieldName('legalBusinessName') === 'Legal Business Name', 'legalBusinessName → Legal Business Name');
  assert(humanizeFieldName('companyEmail') === 'Company Email', 'companyEmail → Company Email');
  assert(humanizeFieldName('dbaName') === 'Dba Name', 'dbaName → Dba Name');
});

test('humanizeFieldName - with dot notation', () => {
  assert(humanizeFieldName('merchant.legalBusinessName') === 'Legal Business Name', 'merchant.legalBusinessName extracts last part');
  assert(humanizeFieldName('bankInformation.bankRoutingNumber') === 'Bank Routing Number', 'nested dot notation');
});

test('humanizeFieldName - with underscores', () => {
  assert(humanizeFieldName('legal_business_name') === 'Legal Business Name', 'underscores converted to spaces');
});

test('humanizeFieldName - consecutive caps (acronyms)', () => {
  assert(humanizeFieldName('SSNField') === 'SSN Field', 'SSNField → SSN Field');
});

test('deriveSectionFromFieldName - known sections', () => {
  assert(deriveSectionFromFieldName('merchant.companyEmail') === 'Merchant Information', 'merchant → Merchant Information');
  assert(deriveSectionFromFieldName('owners.firstName') === 'Ownership Information', 'owners → Ownership Information');
  assert(deriveSectionFromFieldName('bankInformation.routingNumber') === 'Bank Information', 'bankInformation → Bank Information');
  assert(deriveSectionFromFieldName('transactionInformation.volume') === 'Transaction Information', 'transactionInformation → Transaction Information');
  assert(deriveSectionFromFieldName('equipment.terminal') === 'Equipment', 'equipment → Equipment');
  assert(deriveSectionFromFieldName('pricing.rate') === 'Pricing & Fees', 'pricing → Pricing & Fees');
});

test('deriveSectionFromFieldName - unknown sections auto-humanize', () => {
  assert(deriveSectionFromFieldName('companyDetails.yearFounded') === 'Company Details', 'custom prefix auto-humanized');
  assert(deriveSectionFromFieldName('riskAssessment.score') === 'Risk Assessment', 'custom prefix auto-humanized');
});

test('deriveSectionFromFieldName - no dot notation', () => {
  assert(deriveSectionFromFieldName('standaloneName') === 'Form Fields', 'no dot → Form Fields');
});

test('inferFieldTypeFromName - email detection', () => {
  assert(inferFieldTypeFromName('merchant.companyEmail') === 'email', 'companyEmail → email');
  assert(inferFieldTypeFromName('merchant.emailAddress') === 'email', 'emailAddress → email');
});

test('inferFieldTypeFromName - phone detection', () => {
  assert(inferFieldTypeFromName('merchant.companyPhone') === 'phone', 'companyPhone → phone');
  assert(inferFieldTypeFromName('merchant.fax') === 'phone', 'fax → phone');
  assert(inferFieldTypeFromName('merchant.mobile') === 'phone', 'mobile → phone');
  assert(inferFieldTypeFromName('merchant.faxNumber') === 'phone', 'faxNumber → phone');
  assert(inferFieldTypeFromName('merchant.telephone') === 'phone', 'telephone → phone');
});

test('inferFieldTypeFromName - date detection', () => {
  assert(inferFieldTypeFromName('merchant.businessStartDate') === 'date', 'businessStartDate → date');
  assert(inferFieldTypeFromName('owners.dob') === 'date', 'dob → date');
  assert(inferFieldTypeFromName('merchant.expirationDate') === 'date', 'expirationDate → date');
});

test('inferFieldTypeFromName - currency detection', () => {
  assert(inferFieldTypeFromName('transactionInformation.averageMonthlyVolume') === 'currency', 'averageMonthlyVolume → currency');
  assert(inferFieldTypeFromName('transactionInformation.averageTicket') === 'currency', 'averageTicket → currency');
  assert(inferFieldTypeFromName('transactionInformation.highestTicket') === 'currency', 'highestTicket → currency');
  assert(inferFieldTypeFromName('pricing.monthlyFee') === 'currency', 'monthlyFee → currency');
});

test('inferFieldTypeFromName - percentage detection', () => {
  assert(inferFieldTypeFromName('transactionInformation.swipedPercentage') === 'percentage', 'swipedPercentage → percentage');
  assert(inferFieldTypeFromName('transactionInformation.keyedPercentage') === 'percentage', 'keyedPercentage → percentage');
  assert(inferFieldTypeFromName('transactionInformation.internetPercentage') === 'percentage', 'internetPercentage → percentage');
});

test('inferFieldTypeFromName - financial field detection', () => {
  assert(inferFieldTypeFromName('merchant.taxId') === 'ein', 'taxId → ein');
  assert(inferFieldTypeFromName('owners.ssn') === 'ssn', 'ssn → ssn');
  assert(inferFieldTypeFromName('owners.socialSecurityNumber') === 'ssn', 'socialSecurityNumber → ssn');
  assert(inferFieldTypeFromName('bankInformation.bankAccountNumber') === 'bank_account', 'bankAccountNumber → bank_account');
  assert(inferFieldTypeFromName('bankInformation.bankRoutingNumber') === 'bank_routing', 'bankRoutingNumber → bank_routing');
  assert(inferFieldTypeFromName('bankInformation.abaNumber') === 'bank_routing', 'abaNumber → bank_routing');
});

test('inferFieldTypeFromName - special types', () => {
  assert(inferFieldTypeFromName('owners.signature') === 'signature', 'signature → signature');
  assert(inferFieldTypeFromName('merchant.mccCode') === 'mcc-select', 'mccCode → mcc-select');
  assert(inferFieldTypeFromName('merchant.mcc') === 'mcc-select', 'mcc → mcc-select');
  assert(inferFieldTypeFromName('merchant.companyUrl') === 'url', 'companyUrl → url');
  assert(inferFieldTypeFromName('merchant.website') === 'url', 'website → url');
});

test('inferFieldTypeFromName - textarea detection', () => {
  assert(inferFieldTypeFromName('merchant.businessDescription') === 'textarea', 'businessDescription → textarea');
  assert(inferFieldTypeFromName('merchant.comments') === 'textarea', 'comments → textarea');
  assert(inferFieldTypeFromName('merchant.notes') === 'textarea', 'notes → textarea');
});

test('inferFieldTypeFromName - zipcode detection', () => {
  assert(inferFieldTypeFromName('merchant.postalCode') === 'zipcode', 'postalCode → zipcode');
  assert(inferFieldTypeFromName('merchant.zip') === 'zipcode', 'zip → zipcode');
  assert(inferFieldTypeFromName('merchant.zipCode') === 'zipcode', 'zipCode → zipcode');
});

test('inferFieldTypeFromName - fallback to text', () => {
  assert(inferFieldTypeFromName('merchant.legalBusinessName') === 'text', 'legalBusinessName → text');
  assert(inferFieldTypeFromName('merchant.dbaName') === 'text', 'dbaName → text');
  assert(inferFieldTypeFromName('merchant.contactName') === 'text', 'contactName → text');
});

test('isProperlyNamed - valid names', () => {
  assert(isProperlyNamed('merchant.legalBusinessName') === true, 'merchant.legalBusinessName is valid');
  assert(isProperlyNamed('owners.firstName') === true, 'owners.firstName is valid');
  assert(isProperlyNamed('bankInformation.bankRoutingNumber') === true, 'deep nested is valid');
  assert(isProperlyNamed('merchant.businessType.radio.soleProprietorship') === true, 'radio field is valid');
  assert(isProperlyNamed('merchant.location.address.city') === true, 'address field is valid');
});

test('isProperlyNamed - invalid names', () => {
  assert(isProperlyNamed('LegalBusinessName') === false, 'no dot notation');
  assert(isProperlyNamed('MERCHANT_NAME') === false, 'ALL_CAPS no dot');
  assert(isProperlyNamed('') === false, 'empty string');
  assert(isProperlyNamed('undefined.field') === false, 'undefined prefix');
  assert(isProperlyNamed('.field') === false, 'empty prefix');
  assert(isProperlyNamed('SECTION.fieldName') === false, 'ALL CAPS section');
  assert(isProperlyNamed('TEXT1') === false, 'generic name no dot');
});

test('classifySkippedField - categorizes issues correctly', () => {
  const noDot = classifySkippedField('LegalBusinessName');
  assert(noDot.issue === 'no_dot_notation', 'no dot → no_dot_notation');
  assert(noDot.severity === 'warning', 'no dot severity is warning');

  const allCaps = classifySkippedField('MERCHANT.fieldName');
  assert(allCaps.issue === 'all_caps', 'ALL CAPS → all_caps');

  const empty = classifySkippedField('');
  assert(empty.issue === 'empty_name', 'empty → empty_name');
});

test('groupAcroFormFields - radio grouping', () => {
  const fields = [
    'merchant.businessType.radio.soleProprietorship',
    'merchant.businessType.radio.partnership',
    'merchant.businessType.radio.corporation',
    'merchant.businessType.radio.llc',
  ];
  const { groups, warnings } = groupAcroFormFields(fields, []);
  assert(groups.size === 1, 'radio fields grouped into 1');
  const group = groups.get('merchant.businessType')!;
  assert(group.fieldType === 'radio', 'type is radio');
  assert(group.options.length === 4, '4 options');
  assert(group.rawPdfFieldNames.length === 4, '4 raw PDF fields');
  assert(group.section === 'Merchant Information', 'section derived correctly');
  assert(warnings.length === 0, 'no warnings');
});

test('groupAcroFormFields - checkbox grouping', () => {
  const fields = [
    'merchant.acceptedCards.checkbox.visa',
    'merchant.acceptedCards.checkbox.mastercard',
    'merchant.acceptedCards.checkbox.amex',
  ];
  const { groups } = groupAcroFormFields(fields, []);
  assert(groups.size === 1, 'checkbox fields grouped into 1');
  const group = groups.get('merchant.acceptedCards')!;
  assert(group.fieldType === 'checkbox-list', 'type is checkbox-list');
  assert(group.options.length === 3, '3 options');
});

test('groupAcroFormFields - boolean grouping', () => {
  const fields = [
    'merchant.previouslyTerminated.bool.yes',
    'merchant.previouslyTerminated.bool.no',
  ];
  const { groups } = groupAcroFormFields(fields, []);
  assert(groups.size === 1, 'bool fields grouped into 1');
  const group = groups.get('merchant.previouslyTerminated')!;
  assert(group.fieldType === 'boolean', 'type is boolean');
  assert(group.options.length === 2, '2 options (Yes/No)');
});

test('groupAcroFormFields - address grouping', () => {
  const fields = [
    'merchant.location.address.street1',
    'merchant.location.address.street2',
    'merchant.location.address.city',
    'merchant.location.address.state',
    'merchant.location.address.postalCode',
  ];
  const { groups } = groupAcroFormFields(fields, []);
  assert(groups.size === 1, 'address fields grouped into 1');
  const group = groups.get('merchant.location.address')!;
  assert(group.fieldType === 'address', 'type is address');
  assert(group.rawPdfFieldNames.length === 5, '5 sub-fields tracked');
  assert(group.fieldLabel.includes('Address'), 'label includes Address');
});

test('groupAcroFormFields - mixed fields', () => {
  const fields = [
    'merchant.legalBusinessName',
    'merchant.companyEmail',
    'merchant.companyPhone',
    'merchant.businessType.radio.corp',
    'merchant.businessType.radio.llc',
    'merchant.terminated.bool.yes',
    'merchant.terminated.bool.no',
    'merchant.location.address.city',
    'merchant.location.address.state',
    'bankInformation.bankRoutingNumber',
  ];
  const { groups } = groupAcroFormFields(fields, []);
  assert(groups.size === 7, '10 raw fields → 7 logical fields');
  assert(groups.get('merchant.legalBusinessName')!.fieldType === 'text', 'legalBusinessName → text');
  assert(groups.get('merchant.companyEmail')!.fieldType === 'email', 'companyEmail → email');
  assert(groups.get('merchant.companyPhone')!.fieldType === 'phone', 'companyPhone → phone');
  assert(groups.get('merchant.businessType')!.fieldType === 'radio', 'businessType → radio');
  assert(groups.get('merchant.terminated')!.fieldType === 'boolean', 'terminated → boolean');
  assert(groups.get('merchant.location.address')!.fieldType === 'address', 'location.address → address');
});

test('groupAcroFormFields - skipped fields generate warnings', () => {
  const { warnings } = groupAcroFormFields(
    ['merchant.validField'],
    ['INVALID_NAME', 'AnotherBadField', '']
  );
  assert(warnings.length === 3, '3 warnings for 3 skipped fields');
  assert(warnings.some(w => w.issue === 'no_dot_notation'), 'has no_dot_notation warning');
  assert(warnings.some(w => w.issue === 'empty_name'), 'has empty_name warning');
});

test('groupAcroFormFields - section derivation from known prefixes', () => {
  const fields = [
    'merchant.name',
    'owners.firstName',
    'bankInformation.account',
    'equipment.terminal',
    'pricing.rate',
    'transactionInformation.volume',
  ];
  const { groups } = groupAcroFormFields(fields, []);
  assert(groups.get('merchant.name')!.section === 'Merchant Information', 'merchant section');
  assert(groups.get('owners.firstName')!.section === 'Ownership Information', 'owners section');
  assert(groups.get('bankInformation.account')!.section === 'Bank Information', 'bank section');
  assert(groups.get('equipment.terminal')!.section === 'Equipment', 'equipment section');
  assert(groups.get('pricing.rate')!.section === 'Pricing & Fees', 'pricing section');
  assert(groups.get('transactionInformation.volume')!.section === 'Transaction Information', 'transaction section');
});

test('SECTION_MAP has all expected entries', () => {
  assert('merchant' in SECTION_MAP, 'merchant in map');
  assert('owners' in SECTION_MAP, 'owners in map');
  assert('bankInformation' in SECTION_MAP, 'bankInformation in map');
  assert('equipment' in SECTION_MAP, 'equipment in map');
  assert('pricing' in SECTION_MAP, 'pricing in map');
  assert('transactionInformation' in SECTION_MAP, 'transactionInformation in map');
  assert('agent' in SECTION_MAP, 'agent in map');
  assert('creditDebitAuth' in SECTION_MAP, 'creditDebitAuth in map');
});

test('guessSection - infers correct section from field content', () => {
  assert(guessSection('BankRoutingNumber') === 'bankInformation', 'bank routing → bankInformation');
  assert(guessSection('AccountNumber') === 'bankInformation', 'account → bankInformation');
  assert(guessSection('OwnerName') === 'owners', 'owner → owners');
  assert(guessSection('PrincipalAddress') === 'owners', 'principal → owners');
  assert(guessSection('TransactionVolume') === 'transactionInformation', 'transaction → transactionInformation');
  assert(guessSection('AverageTicket') === 'transactionInformation', 'ticket → transactionInformation');
  assert(guessSection('TerminalType') === 'equipment', 'terminal → equipment');
  assert(guessSection('GatewayID') === 'equipment', 'gateway → equipment');
  assert(guessSection('DiscountRate') === 'pricing', 'discount → pricing');
  assert(guessSection('MonthlyFee') === 'pricing', 'fee → pricing');
  assert(guessSection('SalesRepName') === 'agent', 'sales rep → agent');
  assert(guessSection('LegalBusinessName') === 'merchant', 'general → merchant fallback');
  assert(guessSection('CompanyEmail') === 'merchant', 'company → merchant fallback');
});

test('suggestFieldName - generates proper dot-notation suggestions', () => {
  const r1 = suggestFieldName('LegalBusinessName');
  assert(r1.includes('.'), 'has dot notation');
  assert(r1 === 'merchant.legalBusinessName', `LegalBusinessName → ${r1}`);

  const r2 = suggestFieldName('BankRoutingNumber');
  assert(r2 === 'bankInformation.bankRoutingNumber', `BankRoutingNumber → ${r2}`);

  const r3 = suggestFieldName('OwnerSSN');
  assert(r3.startsWith('owners.'), `OwnerSSN starts with owners. → ${r3}`);

  const r4 = suggestFieldName('AverageTicket');
  assert(r4.startsWith('transactionInformation.'), `AverageTicket starts with transactionInformation. → ${r4}`);

  const r5 = suggestFieldName('TerminalType');
  assert(r5.startsWith('equipment.'), `TerminalType starts with equipment. → ${r5}`);

  const r6 = suggestFieldName('DiscountRate');
  assert(r6.startsWith('pricing.'), `DiscountRate starts with pricing. → ${r6}`);
});

test('suggestFieldName - handles messy PDF tool names', () => {
  const r1 = suggestFieldName('TEXT1');
  assert(r1.includes('.'), 'TEXT1 gets dot notation');

  const r2 = suggestFieldName('FIELD_BUSINESS_NAME');
  assert(r2.includes('.'), 'FIELD_BUSINESS_NAME gets dot notation');

  const r3 = suggestFieldName('TXT_Owner_SSN');
  assert(r3.startsWith('owners.'), `TXT_Owner_SSN → owners section: ${r3}`);

  const r4 = suggestFieldName('');
  assert(r4 === 'merchant.fieldName', 'empty → merchant.fieldName');
});

test('classifySkippedField - includes actionable suggestions', () => {
  const noDot = classifySkippedField('LegalBusinessName');
  assert(noDot.suggestion !== undefined, 'no_dot has suggestion');
  assert(noDot.suggestion!.includes('Rename to'), 'suggestion says Rename to');
  assert(noDot.suggestion!.includes('merchant.legalBusinessName'), `suggestion includes proper name: ${noDot.suggestion}`);

  const allCaps = classifySkippedField('MERCHANT.businessName');
  assert(allCaps.suggestion !== undefined, 'all_caps has suggestion');
  assert(allCaps.suggestion!.includes('Rename to'), 'all_caps suggestion says Rename to');
  assert(allCaps.suggestion!.includes('merchant.businessName'), `all_caps fix: ${allCaps.suggestion}`);

  const empty = classifySkippedField('');
  assert(empty.suggestion !== undefined, 'empty has suggestion');
  assert(empty.suggestion!.includes('dot notation'), 'empty suggestion mentions dot notation');

  const bankField = classifySkippedField('RoutingNumber');
  assert(bankField.suggestion!.includes('bankInformation'), `bank field suggestion: ${bankField.suggestion}`);

  const ownerField = classifySkippedField('PrincipalName');
  assert(ownerField.suggestion!.includes('owners'), `owner field suggestion: ${ownerField.suggestion}`);
});

test('classifySkippedField - suggestions include detected type', () => {
  const emailField = classifySkippedField('CompanyEmail');
  assert(emailField.suggestion!.includes('email'), `email type detected: ${emailField.suggestion}`);

  const phoneField = classifySkippedField('BusinessPhone');
  assert(phoneField.suggestion!.includes('phone'), `phone type detected: ${phoneField.suggestion}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
