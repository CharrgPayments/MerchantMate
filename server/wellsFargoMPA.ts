// Enhanced Wells Fargo Merchant Processing Application Form Parser
// Complete form structure with all sections and advanced validation

export interface EnhancedFormField {
  fieldName: string;
  fieldType: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'phone' | 'email' | 'url';
  fieldLabel: string;
  isRequired: boolean;
  options?: string[];
  defaultValue?: string;
  validation?: string;
  position: number;
  section: string;
  helpText?: string;
  placeholder?: string;
}

export interface EnhancedFormSection {
  title: string;
  description: string;
  fields: EnhancedFormField[];
  order: number;
}

export function getWellsFargoMPAForm(): EnhancedFormSection[] {
  return [
    {
      title: 'Merchant Information',
      description: 'Basic business and contact information for the merchant account application',
      order: 1,
      fields: [
        {
          fieldName: 'agentNumber',
          fieldType: 'text',
          fieldLabel: 'Agent #',
          isRequired: false,
          position: 1,
          section: 'Merchant Information',
          helpText: 'Internal agent reference number',
          placeholder: 'Enter agent number if applicable'
        },
        {
          fieldName: 'legalBusinessName',
          fieldType: 'text',
          fieldLabel: 'Legal Name of Business / IRS Filing Name',
          isRequired: true,
          position: 2,
          section: 'Merchant Information',
          validation: JSON.stringify({ minLength: 2, maxLength: 100 }),
          helpText: 'Must match IRS records exactly',
          placeholder: 'Enter legal business name as filed with IRS'
        },
        {
          fieldName: 'dbaName',
          fieldType: 'text',
          fieldLabel: 'DBA (Doing Business As)',
          isRequired: false,
          position: 3,
          section: 'Merchant Information',
          validation: JSON.stringify({ maxLength: 100 }),
          placeholder: 'Enter trade name if different from legal name'
        },
        {
          fieldName: 'locationAddress',
          fieldType: 'text',
          fieldLabel: 'Location / Site Address',
          isRequired: true,
          position: 4,
          section: 'Merchant Information',
          validation: JSON.stringify({ minLength: 5, maxLength: 200 }),
          placeholder: 'Physical business address'
        },
        {
          fieldName: 'locationCity',
          fieldType: 'text',
          fieldLabel: 'City',
          isRequired: true,
          position: 5,
          section: 'Merchant Information',
          validation: JSON.stringify({ minLength: 2, maxLength: 50 }),
          placeholder: 'Business city'
        },
        {
          fieldName: 'locationState',
          fieldType: 'select',
          fieldLabel: 'State',
          isRequired: true,
          position: 6,
          section: 'Merchant Information',
          options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
        },
        {
          fieldName: 'locationZipCode',
          fieldType: 'text',
          fieldLabel: 'ZIP Code',
          isRequired: true,
          position: 7,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\d{5}(-\\d{4})?$' }),
          placeholder: '12345 or 12345-6789'
        },
        {
          fieldName: 'companyWebsite',
          fieldType: 'url',
          fieldLabel: 'Company Website Address (URL)',
          isRequired: false,
          position: 8,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^https?://.*' }),
          placeholder: 'https://www.example.com'
        },
        {
          fieldName: 'mailingAddress',
          fieldType: 'text',
          fieldLabel: 'Mailing Address (if different from location)',
          isRequired: false,
          position: 9,
          section: 'Merchant Information',
          validation: JSON.stringify({ maxLength: 200 }),
          placeholder: 'Leave blank if same as location address'
        },
        {
          fieldName: 'mailingCity',
          fieldType: 'text',
          fieldLabel: 'Mailing City',
          isRequired: false,
          position: 10,
          section: 'Merchant Information',
          validation: JSON.stringify({ maxLength: 50 })
        },
        {
          fieldName: 'mailingState',
          fieldType: 'select',
          fieldLabel: 'Mailing State',
          isRequired: false,
          position: 11,
          section: 'Merchant Information',
          options: ['', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
        },
        {
          fieldName: 'mailingZipCode',
          fieldType: 'text',
          fieldLabel: 'Mailing ZIP Code',
          isRequired: false,
          position: 12,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\d{5}(-\\d{4})?$' }),
          placeholder: '12345 or 12345-6789'
        },
        {
          fieldName: 'companyEmail',
          fieldType: 'email',
          fieldLabel: 'Company E-mail Address',
          isRequired: true,
          position: 13,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^[^@]+@[^@]+\\.[^@]+$' }),
          placeholder: 'business@company.com'
        },
        {
          fieldName: 'companyPhone',
          fieldType: 'phone',
          fieldLabel: 'Company Phone #',
          isRequired: true,
          position: 14,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$' }),
          placeholder: '(555) 123-4567'
        },
        {
          fieldName: 'descriptorPhone',
          fieldType: 'phone',
          fieldLabel: 'Descriptor Phone # (E-commerce or MOTO)',
          isRequired: false,
          position: 15,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$' }),
          helpText: 'Phone number that appears on customer statements',
          placeholder: '(555) 123-4567'
        },
        {
          fieldName: 'mobilePhone',
          fieldType: 'phone',
          fieldLabel: 'Mobile Phone #',
          isRequired: false,
          position: 16,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$' }),
          placeholder: '(555) 123-4567'
        },
        {
          fieldName: 'faxNumber',
          fieldType: 'phone',
          fieldLabel: 'Fax #',
          isRequired: false,
          position: 17,
          section: 'Merchant Information',
          validation: JSON.stringify({ pattern: '^\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$' }),
          placeholder: '(555) 123-4567'
        },
        {
          fieldName: 'contactName',
          fieldType: 'text',
          fieldLabel: 'Contact Name',
          isRequired: true,
          position: 18,
          section: 'Merchant Information',
          validation: JSON.stringify({ minLength: 2, maxLength: 100 }),
          placeholder: 'Primary contact person'
        },
        {
          fieldName: 'contactTitle',
          fieldType: 'text',
          fieldLabel: 'Title',
          isRequired: true,
          position: 19,
          section: 'Merchant Information',
          validation: JSON.stringify({ maxLength: 50 }),
          placeholder: 'Owner, Manager, etc.'
        }
      ]
    },
    {
      title: 'Business Type & Tax Information',
      description: 'Business structure, tax ID, and regulatory information',
      order: 2,
      fields: [
        {
          fieldName: 'taxId',
          fieldType: 'text',
          fieldLabel: 'Tax ID / EIN',
          isRequired: true,
          position: 20,
          section: 'Business Type & Tax Information',
          validation: JSON.stringify({ pattern: '^\\d{2}-\\d{7}$' }),
          placeholder: '12-3456789',
          helpText: 'Federal Employer Identification Number'
        },
        {
          fieldName: 'foreignEntity',
          fieldType: 'checkbox',
          fieldLabel: 'I certify that I\'m a foreign entity/nonresident alien',
          isRequired: false,
          position: 21,
          section: 'Business Type & Tax Information',
          helpText: 'Check if applicable and attach IRS Form W-8'
        },
        {
          fieldName: 'businessType',
          fieldType: 'select',
          fieldLabel: 'Business Type',
          isRequired: true,
          position: 22,
          section: 'Business Type & Tax Information',
          options: [
            'Sole Proprietorship',
            'Partnership', 
            'Private Corporation',
            'Public Corporation',
            'Tax Exempt Corporation',
            'Limited Liability Company'
          ]
        },
        {
          fieldName: 'stateFiled',
          fieldType: 'select',
          fieldLabel: 'State Filed',
          isRequired: true,
          position: 23,
          section: 'Business Type & Tax Information',
          options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'],
          helpText: 'State where business is incorporated/registered'
        },
        {
          fieldName: 'businessStartDate',
          fieldType: 'date',
          fieldLabel: 'Business Start Date',
          isRequired: true,
          position: 24,
          section: 'Business Type & Tax Information',
          validation: JSON.stringify({ max: new Date().toISOString().split('T')[0] })
        },
        {
          fieldName: 'previouslyTerminated',
          fieldType: 'select',
          fieldLabel: 'Has this business or any associated principal been terminated as a Visa/MasterCard/Amex/Discover network merchant?',
          isRequired: true,
          position: 25,
          section: 'Business Type & Tax Information',
          options: ['No', 'Yes']
        },
        {
          fieldName: 'bankruptcyHistory',
          fieldType: 'select',
          fieldLabel: 'Has merchant or any associated principal filed bankruptcy or been subject to involuntary bankruptcy?',
          isRequired: true,
          position: 26,
          section: 'Business Type & Tax Information',
          options: ['No', 'Yes']
        },
        {
          fieldName: 'bankruptcyDate',
          fieldType: 'date',
          fieldLabel: 'Bankruptcy Date (if applicable)',
          isRequired: false,
          position: 27,
          section: 'Business Type & Tax Information'
        },
        {
          fieldName: 'currentlyAcceptCards',
          fieldType: 'select',
          fieldLabel: 'Do you currently accept Visa/MC/Amex/Discover Network?',
          isRequired: true,
          position: 28,
          section: 'Business Type & Tax Information',
          options: ['No', 'Yes'],
          helpText: 'If Yes, you must submit 3 most current monthly statements'
        },
        {
          fieldName: 'previousProcessor',
          fieldType: 'text',
          fieldLabel: 'Previous Card Processor',
          isRequired: false,
          position: 29,
          section: 'Business Type & Tax Information',
          placeholder: 'Name of current/previous processor'
        },
        {
          fieldName: 'reasonToChange',
          fieldType: 'select',
          fieldLabel: 'Reason to Change',
          isRequired: false,
          position: 30,
          section: 'Business Type & Tax Information',
          options: ['', 'Rates', 'Service', 'Other']
        },
        {
          fieldName: 'terminationDate',
          fieldType: 'date',
          fieldLabel: 'Termination Date (if applicable)',
          isRequired: false,
          position: 31,
          section: 'Business Type & Tax Information'
        }
      ]
    },
    {
      title: 'Products, Services & Processing',
      description: 'Business operations, products/services sold, and payment processing preferences',
      order: 3,
      fields: [
        {
          fieldName: 'merchantSells',
          fieldType: 'textarea',
          fieldLabel: 'Merchant Sells (specify product, service and/or information)',
          isRequired: true,
          position: 32,
          section: 'Products, Services & Processing',
          validation: JSON.stringify({ minLength: 10, maxLength: 500 }),
          placeholder: 'Describe the products and/or services your business sells'
        },
        {
          fieldName: 'mccCode',
          fieldType: 'mcc-select',
          fieldLabel: 'Merchant Category Code (MCC)',
          isRequired: true,
          position: 33,
          section: 'Products, Services & Processing',
          helpText: 'Select the merchant category code that best describes your primary business activity. This code is used for payment processing classification and risk assessment.'
        },
        {
          fieldName: 'thirdPartyDataStorage',
          fieldType: 'select',
          fieldLabel: 'Do you use any third party to store, process or transmit cardholder\'s data?',
          isRequired: true,
          position: 34,
          section: 'Products, Services & Processing',
          options: ['No', 'Yes']
        },
        {
          fieldName: 'thirdPartyCompanyInfo',
          fieldType: 'text',
          fieldLabel: 'Third Party Company Information (if applicable)',
          isRequired: false,
          position: 35,
          section: 'Products, Services & Processing',
          placeholder: 'Company name, address and phone number',
          validation: JSON.stringify({ maxLength: 200 })
        },
        {
          fieldName: 'refundPolicy',
          fieldType: 'select',
          fieldLabel: 'Refund Policy for Visa/MasterCard/Amex/Discover Network Sales',
          isRequired: true,
          position: 36,
          section: 'Products, Services & Processing',
          options: [
            'Refund will be granted to a customer as follows',
            'No refund. All sales final (Merchant must notify customers)',
            'Exchange',
            'Store Credit'
          ]
        },
        {
          fieldName: 'refundTimeframe',
          fieldType: 'select',
          fieldLabel: 'Credit Exchange Timeframe',
          isRequired: false,
          position: 36,
          section: 'Products, Services & Processing',
          options: ['', '0-3 Days', '4-7 Days', '8-14 Days', 'Over 14 Days']
        }
      ]
    },
    {
      title: 'Transaction Information',
      description: 'Financial data and transaction processing details',
      order: 4,
      fields: [
        {
          fieldName: 'avgMonthlyVolume',
          fieldType: 'number',
          fieldLabel: 'Average Combined Monthly Visa/MC/Discover/Amex Volume ($)',
          isRequired: true,
          position: 37,
          section: 'Transaction Information',
          validation: JSON.stringify({ min: 0, max: 999999999 }),
          placeholder: '10000'
        },
        {
          fieldName: 'avgTicketAmount',
          fieldType: 'number',
          fieldLabel: 'Average Visa/MC/Amex/Discover Network Ticket ($)',
          isRequired: true,
          position: 38,
          section: 'Transaction Information',
          validation: JSON.stringify({ min: 0, max: 99999 }),
          placeholder: '50.00'
        },
        {
          fieldName: 'highestTicketAmount',
          fieldType: 'number',
          fieldLabel: 'Highest Ticket Amount ($)',
          isRequired: true,
          position: 39,
          section: 'Transaction Information',
          validation: JSON.stringify({ min: 0, max: 999999 }),
          placeholder: '500.00'
        },
        {
          fieldName: 'seasonal',
          fieldType: 'checkbox',
          fieldLabel: 'Seasonal Business',
          isRequired: false,
          position: 40,
          section: 'Transaction Information'
        },
        {
          fieldName: 'highestVolumeMonths',
          fieldType: 'number',
          fieldLabel: 'Highest Volume Months ($)',
          isRequired: false,
          position: 41,
          section: 'Transaction Information',
          validation: JSON.stringify({ min: 0, max: 999999999 }),
          placeholder: '25000'
        },
        {
          fieldName: 'merchantType',
          fieldType: 'select',
          fieldLabel: 'Merchant Type',
          isRequired: true,
          position: 42,
          section: 'Transaction Information',
          options: [
            'Retail Outlet',
            'Restaurant/Food',
            'Lodging',
            'Home Business, Trade Fairs',
            'Outside Sales/Service, Other, etc.',
            'Mail/Telephone Order Only',
            'Internet',
            'Health Care'
          ]
        }
      ]
    }
  ];
}