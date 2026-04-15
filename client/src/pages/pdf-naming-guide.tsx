import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import {
  BookOpen, ChevronDown, ChevronRight, Copy, Check,
  FileText, AlertTriangle, CheckCircle2, Info, Lightbulb,
  Type, Hash, Calendar, Mail, Phone, DollarSign, Percent,
  MapPin, List, ToggleLeft, PenTool, Shield, CreditCard,
  Building2, ClipboardList
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function CopyableCode({ children, className = '' }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    toast({ title: 'Copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <code
      className={`relative group inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-sm font-mono cursor-pointer hover:bg-muted/80 ${className}`}
      onClick={handleCopy}
      title="Click to copy"
    >
      {children}
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      )}
    </code>
  );
}

function ExpandableSection({ title, icon: Icon, defaultOpen = false, children }: {
  title: string;
  icon: any;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 p-4 h-auto text-left hover:bg-muted/50">
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Icon className="h-5 w-5 shrink-0 text-primary" />
          <span className="font-semibold text-base">{title}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

const FIELD_TYPES = [
  {
    type: 'text',
    icon: Type,
    description: 'Standard text input',
    example: 'merchant.legalBusinessName',
    rendered: 'Text field',
    notes: 'Default type when no special suffix is detected',
  },
  {
    type: 'email',
    icon: Mail,
    description: 'Email address with validation',
    example: 'merchant.companyEmail',
    rendered: 'Email input with @ validation',
    notes: 'Auto-detected from field names containing "email"',
  },
  {
    type: 'phone',
    icon: Phone,
    description: 'Phone number with formatting',
    example: 'merchant.companyPhone',
    rendered: 'Phone input with (xxx) xxx-xxxx formatting',
    notes: 'Auto-detected from "phone", "fax", "tel", "mobile", "cell"',
  },
  {
    type: 'date',
    icon: Calendar,
    description: 'Date picker',
    example: 'merchant.businessStartDate',
    rendered: 'Calendar date picker',
    notes: 'Auto-detected from "date", "dob", "startDate", "endDate"',
  },
  {
    type: 'currency',
    icon: DollarSign,
    description: 'Dollar amount with formatting',
    example: 'transactionInformation.averageMonthlyVolume',
    rendered: 'Currency input with $ prefix',
    notes: 'Auto-detected from "amount", "volume", "ticket", "price", "fee", "cost"',
  },
  {
    type: 'percentage',
    icon: Percent,
    description: 'Percentage value (0-100)',
    example: 'transactionInformation.swipedPercentage',
    rendered: 'Number input with % suffix',
    notes: 'Auto-detected from "percentage", "percent", "rate"',
  },
  {
    type: 'ein',
    icon: Hash,
    description: 'Employer ID Number (XX-XXXXXXX)',
    example: 'merchant.taxId',
    rendered: 'EIN input with formatting',
    notes: 'Auto-detected from "taxId", "ein"',
  },
  {
    type: 'ssn',
    icon: Shield,
    description: 'Social Security Number (XXX-XX-XXXX)',
    example: 'owners.socialSecurityNumber',
    rendered: 'Masked SSN input',
    notes: 'Auto-detected from "ssn", "socialSecurity"',
  },
  {
    type: 'zipcode',
    icon: MapPin,
    description: 'ZIP/postal code',
    example: 'merchant.address.postalCode',
    rendered: 'ZIP code input with 5 or 9 digit validation',
    notes: 'Auto-detected from "postalCode", "zip", "zipCode"',
  },
  {
    type: 'url',
    icon: Type,
    description: 'Website URL',
    example: 'merchant.companyUrl',
    rendered: 'URL input with http:// validation',
    notes: 'Auto-detected from "url", "website"',
  },
  {
    type: 'textarea',
    icon: ClipboardList,
    description: 'Multi-line text area',
    example: 'merchant.businessDescription',
    rendered: 'Large text area',
    notes: 'Auto-detected from "description", "comment", "note", "detail", "explain"',
  },
  {
    type: 'bank_account',
    icon: CreditCard,
    description: 'Bank account number',
    example: 'bankInformation.bankAccountNumber',
    rendered: 'Masked account number input',
    notes: 'Auto-detected from "bankAccountNumber", "accountNumber"',
  },
  {
    type: 'bank_routing',
    icon: CreditCard,
    description: 'Bank routing/ABA number',
    example: 'bankInformation.bankRoutingNumber',
    rendered: '9-digit routing number input',
    notes: 'Auto-detected from "bankRoutingNumber", "routingNumber", "abaNumber"',
  },
  {
    type: 'signature',
    icon: PenTool,
    description: 'Digital signature capture',
    example: 'owners.signature',
    rendered: 'Signature pad (draw or type)',
    notes: 'Auto-detected from "signature"',
  },
  {
    type: 'mcc-select',
    icon: Building2,
    description: 'MCC code selector with search',
    example: 'merchant.mccCode',
    rendered: 'Searchable MCC code dropdown',
    notes: 'Auto-detected from "mcc" or "sellsProductsServices"',
  },
];

const GROUPED_FIELD_TYPES = [
  {
    type: 'radio',
    suffix: '.radio.',
    icon: ToggleLeft,
    description: 'Radio button group — prospect picks exactly one option',
    example: [
      'merchant.businessType.radio.soleProprietorship',
      'merchant.businessType.radio.partnership',
      'merchant.businessType.radio.corporation',
      'merchant.businessType.radio.llc',
    ],
    rendered: 'Radio button group with 4 options',
    notes: 'All fields with the same prefix before ".radio." are grouped into one radio selection',
  },
  {
    type: 'checkbox-list',
    suffix: '.checkbox.',
    icon: List,
    description: 'Checkbox list — prospect can select multiple options',
    example: [
      'merchant.acceptedCards.checkbox.visa',
      'merchant.acceptedCards.checkbox.mastercard',
      'merchant.acceptedCards.checkbox.amex',
      'merchant.acceptedCards.checkbox.discover',
    ],
    rendered: 'Checkbox group with 4 options',
    notes: 'All fields with the same prefix before ".checkbox." are grouped into a multi-select list',
  },
  {
    type: 'boolean',
    suffix: '.bool.',
    icon: ToggleLeft,
    description: 'Yes/No toggle — a simple true/false question',
    example: [
      'merchant.previouslyTerminated.bool.yes',
      'merchant.previouslyTerminated.bool.no',
    ],
    rendered: 'Yes/No toggle switch',
    notes: 'Pair of fields with ".bool.yes" and ".bool.no" suffix creates a simple toggle',
  },
  {
    type: 'address',
    suffix: '.address.',
    icon: MapPin,
    description: 'Address group — full address with autocomplete',
    example: [
      'merchant.location.address.street1',
      'merchant.location.address.street2',
      'merchant.location.address.city',
      'merchant.location.address.state',
      'merchant.location.address.postalCode',
    ],
    rendered: 'Address block with Google autocomplete, street, city, state, ZIP fields',
    notes: 'Sub-fields: street1, street2, city, state, postalCode (or zip), country',
  },
];

const SECTION_PREFIXES = [
  { prefix: 'merchant', section: 'Merchant Information', description: 'Company details, contact info, EIN' },
  { prefix: 'transactionInformation', section: 'Transaction Information', description: 'Monthly volume, ticket sizes, percentages' },
  { prefix: 'creditDebitAuth', section: 'Credit & Debit Authorization', description: 'Card processing authorization details' },
  { prefix: 'owners', section: 'Ownership Information', description: 'Business owner details, SSN, ownership %' },
  { prefix: 'agent', section: 'Agent Information', description: 'Sales agent details' },
  { prefix: 'equipment', section: 'Equipment', description: 'Terminal and equipment selections' },
  { prefix: 'pricing', section: 'Pricing & Fees', description: 'Rate and fee configurations' },
  { prefix: 'bankInformation', section: 'Bank Information', description: 'Bank account and routing numbers' },
];

export default function PdfNamingGuide() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">PDF Field Naming Guide</h1>
            <p className="text-muted-foreground mt-1">
              How to name your PDF form fields so the system automatically builds dynamic application forms
            </p>
          </div>
        </div>

        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-800 dark:text-blue-200">How it works</AlertTitle>
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            When you upload a PDF, the system reads the form field names and automatically builds a multi-step wizard form.
            The field names tell the system what type of input to show, what section it belongs to, and how to group related fields together.
            Follow this naming convention and the system does the rest.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="quickstart" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="quickstart">Quick Start</TabsTrigger>
            <TabsTrigger value="structure">Name Structure</TabsTrigger>
            <TabsTrigger value="fields">Field Types</TabsTrigger>
            <TabsTrigger value="groups">Grouped Fields</TabsTrigger>
            <TabsTrigger value="examples">Full Examples</TabsTrigger>
          </TabsList>

          <TabsContent value="quickstart" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  The 3 Rules
                </CardTitle>
                <CardDescription>Everything you need to know in 60 seconds</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-4 items-start">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold text-sm shrink-0">1</div>
                    <div>
                      <h3 className="font-semibold text-lg">Use dot notation for structure</h3>
                      <p className="text-muted-foreground mt-1">
                        The first part is the <strong>section</strong>, the rest is the <strong>field name</strong>.
                        Use camelCase throughout.
                      </p>
                      <div className="mt-2 bg-muted p-3 rounded-lg space-y-1 font-mono text-sm">
                        <div><span className="text-blue-600 dark:text-blue-400">merchant</span>.<span className="text-green-600 dark:text-green-400">legalBusinessName</span></div>
                        <div><span className="text-blue-600 dark:text-blue-400">bankInformation</span>.<span className="text-green-600 dark:text-green-400">bankAccountNumber</span></div>
                        <div><span className="text-blue-600 dark:text-blue-400">owners</span>.<span className="text-green-600 dark:text-green-400">firstName</span></div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex gap-4 items-start">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold text-sm shrink-0">2</div>
                    <div>
                      <h3 className="font-semibold text-lg">Field type is auto-detected from the name</h3>
                      <p className="text-muted-foreground mt-1">
                        Name your fields descriptively and the system figures out the right input type.
                        "companyEmail" becomes an email field. "companyPhone" becomes a phone field.
                      </p>
                      <div className="mt-2 bg-muted p-3 rounded-lg space-y-1 font-mono text-sm">
                        <div>merchant.<span className="text-purple-600 dark:text-purple-400">companyEmail</span> → <Badge variant="outline" className="ml-2">email input</Badge></div>
                        <div>merchant.<span className="text-purple-600 dark:text-purple-400">businessStartDate</span> → <Badge variant="outline" className="ml-2">date picker</Badge></div>
                        <div>transactionInformation.<span className="text-purple-600 dark:text-purple-400">averageMonthlyVolume</span> → <Badge variant="outline" className="ml-2">currency input</Badge></div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex gap-4 items-start">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold text-sm shrink-0">3</div>
                    <div>
                      <h3 className="font-semibold text-lg">Use special suffixes for grouped fields</h3>
                      <p className="text-muted-foreground mt-1">
                        For radio buttons, checkboxes, yes/no toggles, and addresses — add the group type and options after the field name.
                      </p>
                      <div className="mt-2 bg-muted p-3 rounded-lg space-y-1 font-mono text-sm">
                        <div>merchant.businessType<span className="text-red-600 dark:text-red-400">.radio.soleProprietorship</span> → <Badge variant="outline" className="ml-2">radio option</Badge></div>
                        <div>merchant.acceptedCards<span className="text-red-600 dark:text-red-400">.checkbox.visa</span> → <Badge variant="outline" className="ml-2">checkbox option</Badge></div>
                        <div>merchant.terminated<span className="text-red-600 dark:text-red-400">.bool.yes</span> → <Badge variant="outline" className="ml-2">yes/no toggle</Badge></div>
                        <div>merchant.location<span className="text-red-600 dark:text-red-400">.address.city</span> → <Badge variant="outline" className="ml-2">address field</Badge></div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800 dark:text-yellow-200">Common Mistakes</AlertTitle>
              <AlertDescription className="text-yellow-700 dark:text-yellow-300 space-y-2">
                <div className="grid gap-2 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 font-bold">✗</span>
                    <code className="bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded text-sm">Legal Business Name</code>
                    <span className="text-muted-foreground">— No spaces, no standalone names</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 font-bold">✗</span>
                    <code className="bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded text-sm">MERCHANT_LEGAL_NAME</code>
                    <span className="text-muted-foreground">— No ALL CAPS, no underscores for structure</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 font-bold">✗</span>
                    <code className="bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded text-sm">field1</code>
                    <span className="text-muted-foreground">— No generic names, must be descriptive</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-500 font-bold">✓</span>
                    <code className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-sm">merchant.legalBusinessName</code>
                    <span className="text-muted-foreground">— Section + descriptive camelCase name</span>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </TabsContent>

          <TabsContent value="structure" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Field Name Structure</CardTitle>
                <CardDescription>Every field name follows the pattern: section.fieldName</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-muted p-4 rounded-lg">
                  <div className="font-mono text-lg text-center space-y-2">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-3 py-1 rounded font-semibold">section</span>
                      <span className="text-xl font-bold">.</span>
                      <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-3 py-1 rounded font-semibold">fieldName</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-sans">Basic field — auto-detects type from the name</p>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-3 py-1 rounded font-semibold">section</span>
                      <span className="text-xl font-bold">.</span>
                      <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-3 py-1 rounded font-semibold">fieldName</span>
                      <span className="text-xl font-bold">.</span>
                      <span className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-3 py-1 rounded font-semibold">groupType</span>
                      <span className="text-xl font-bold">.</span>
                      <span className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-3 py-1 rounded font-semibold">optionValue</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-sans">Grouped field — creates radio buttons, checkboxes, etc.</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-3">Section Prefixes</h3>
                  <p className="text-muted-foreground mb-3">
                    The first part of the field name determines which wizard section/step the field appears in.
                    Use these standard prefixes, or create your own — the system will auto-generate a section title from any camelCase prefix.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Section Title</TableHead>
                        <TableHead>Typical Fields</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SECTION_PREFIXES.map(sp => (
                        <TableRow key={sp.prefix}>
                          <TableCell><CopyableCode>{sp.prefix}</CopyableCode></TableCell>
                          <TableCell className="font-medium">{sp.section}</TableCell>
                          <TableCell className="text-muted-foreground">{sp.description}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="text-sm text-muted-foreground mt-3">
                    Custom prefixes work too! <CopyableCode>companyDetails.yearFounded</CopyableCode> automatically creates a "Company Details" section.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-3">CamelCase Rules</h3>
                  <div className="grid gap-2">
                    <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Use camelCase for all parts</p>
                        <p className="text-sm text-muted-foreground">
                          <CopyableCode>merchant.legalBusinessName</CopyableCode> — each word starts with a capital letter (except the first)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">The label is auto-generated from the name</p>
                        <p className="text-sm text-muted-foreground">
                          <CopyableCode>companyEmail</CopyableCode> → "Company Email" — the system splits camelCase into words
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Keep names descriptive</p>
                        <p className="text-sm text-muted-foreground">
                          Use <CopyableCode>averageMonthlyVolume</CopyableCode> not <CopyableCode>vol</CopyableCode> — the name becomes the label
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Auto-Detected Field Types</CardTitle>
                <CardDescription>
                  The system detects the field type from the field name automatically. No extra configuration needed — just use descriptive names.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Type</TableHead>
                      <TableHead>Example Field Name</TableHead>
                      <TableHead>Renders As</TableHead>
                      <TableHead>Detection Keywords</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {FIELD_TYPES.map(ft => (
                      <TableRow key={ft.type}>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            <ft.icon className="h-3 w-3" />
                            {ft.type}
                          </Badge>
                        </TableCell>
                        <TableCell><CopyableCode>{ft.example}</CopyableCode></TableCell>
                        <TableCell className="text-muted-foreground">{ft.rendered}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{ft.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="groups" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Grouped Field Types</CardTitle>
                <CardDescription>
                  When you need radio buttons, checkbox lists, yes/no toggles, or address blocks — use the special group suffix
                  between the field name and the option value.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {GROUPED_FIELD_TYPES.map(gft => (
                  <div key={gft.type} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="default" className="gap-1 text-sm">
                        <gft.icon className="h-3.5 w-3.5" />
                        {gft.type}
                      </Badge>
                      <span className="font-semibold">{gft.description}</span>
                    </div>

                    <p className="text-sm text-muted-foreground">{gft.notes}</p>

                    <div className="bg-muted p-3 rounded-lg space-y-1">
                      <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">PDF Form Fields:</p>
                      {gft.example.map((ex, i) => (
                        <div key={i} className="font-mono text-sm">
                          <CopyableCode>{ex}</CopyableCode>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>Renders as: <strong>{gft.rendered}</strong></span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertTitle className="text-blue-800 dark:text-blue-200">How grouping works</AlertTitle>
              <AlertDescription className="text-blue-700 dark:text-blue-300">
                <p className="mt-1">
                  Multiple PDF fields are combined into one form field. For example, if your PDF has 4 separate radio button fields:
                </p>
                <div className="mt-2 font-mono text-sm space-y-1">
                  <div>merchant.businessType.radio.soleProprietorship</div>
                  <div>merchant.businessType.radio.partnership</div>
                  <div>merchant.businessType.radio.corporation</div>
                  <div>merchant.businessType.radio.llc</div>
                </div>
                <p className="mt-2">
                  The system groups them into a single "Business Type" radio button field with 4 options.
                  The prospect picks one, and the selected value maps back to the correct PDF field.
                </p>
              </AlertDescription>
            </Alert>
          </TabsContent>

          <TabsContent value="examples" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Complete Example: Merchant Application</CardTitle>
                <CardDescription>
                  Here's what a full merchant application PDF would look like with properly named fields.
                  Each row shows the PDF field name and what it becomes in the wizard.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ExpandableSection title="Merchant Information (8 fields)" icon={Building2} defaultOpen={true}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Wizard Label</TableHead>
                        <TableHead>Input Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.legalBusinessName</CopyableCode></TableCell>
                        <TableCell>Legal Business Name</TableCell>
                        <TableCell><Badge variant="outline">text</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.dbaName</CopyableCode></TableCell>
                        <TableCell>Dba Name</TableCell>
                        <TableCell><Badge variant="outline">text</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.companyEmail</CopyableCode></TableCell>
                        <TableCell>Company Email</TableCell>
                        <TableCell><Badge variant="outline">email</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.companyPhone</CopyableCode></TableCell>
                        <TableCell>Company Phone</TableCell>
                        <TableCell><Badge variant="outline">phone</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.companyUrl</CopyableCode></TableCell>
                        <TableCell>Company Url</TableCell>
                        <TableCell><Badge variant="outline">url</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.taxId</CopyableCode></TableCell>
                        <TableCell>Tax Id</TableCell>
                        <TableCell><Badge variant="outline">ein</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessStartDate</CopyableCode></TableCell>
                        <TableCell>Business Start Date</TableCell>
                        <TableCell><Badge variant="outline">date</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessDescription</CopyableCode></TableCell>
                        <TableCell>Business Description</TableCell>
                        <TableCell><Badge variant="outline">textarea</Badge></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>

                <ExpandableSection title="Address Fields (5 fields → 1 address block)" icon={MapPin}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.location.address.street1</CopyableCode></TableCell>
                        <TableCell rowSpan={5} className="align-middle">
                          <div className="flex items-center gap-2">
                            <Badge>address block</Badge>
                            <span className="text-sm text-muted-foreground">with Google autocomplete</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.location.address.street2</CopyableCode></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.location.address.city</CopyableCode></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.location.address.state</CopyableCode></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.location.address.postalCode</CopyableCode></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>

                <ExpandableSection title="Business Type Radio Group (4 fields → 1 radio)" icon={ToggleLeft}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessType.radio.soleProprietorship</CopyableCode></TableCell>
                        <TableCell rowSpan={4} className="align-middle">
                          <div className="flex items-center gap-2">
                            <Badge>radio group</Badge>
                            <span className="text-sm text-muted-foreground">4 options, pick one</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessType.radio.partnership</CopyableCode></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessType.radio.corporation</CopyableCode></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>merchant.businessType.radio.llc</CopyableCode></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>

                <ExpandableSection title="Transaction Information (5 fields)" icon={DollarSign}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Wizard Label</TableHead>
                        <TableHead>Input Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>transactionInformation.averageMonthlyVolume</CopyableCode></TableCell>
                        <TableCell>Average Monthly Volume</TableCell>
                        <TableCell><Badge variant="outline">currency</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>transactionInformation.averageTicketAmount</CopyableCode></TableCell>
                        <TableCell>Average Ticket Amount</TableCell>
                        <TableCell><Badge variant="outline">currency</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>transactionInformation.highestTicketAmount</CopyableCode></TableCell>
                        <TableCell>Highest Ticket Amount</TableCell>
                        <TableCell><Badge variant="outline">currency</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>transactionInformation.swipedPercentage</CopyableCode></TableCell>
                        <TableCell>Swiped Percentage</TableCell>
                        <TableCell><Badge variant="outline">percentage</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>transactionInformation.keyedPercentage</CopyableCode></TableCell>
                        <TableCell>Keyed Percentage</TableCell>
                        <TableCell><Badge variant="outline">percentage</Badge></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>

                <ExpandableSection title="Bank Information (2 fields)" icon={CreditCard}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Wizard Label</TableHead>
                        <TableHead>Input Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>bankInformation.bankRoutingNumber</CopyableCode></TableCell>
                        <TableCell>Bank Routing Number</TableCell>
                        <TableCell><Badge variant="outline">bank_routing</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>bankInformation.bankAccountNumber</CopyableCode></TableCell>
                        <TableCell>Bank Account Number</TableCell>
                        <TableCell><Badge variant="outline">bank_account</Badge></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>

                <ExpandableSection title="Ownership & Signature (4 fields)" icon={PenTool}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PDF Field Name</TableHead>
                        <TableHead>Wizard Label</TableHead>
                        <TableHead>Input Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><CopyableCode>owners.firstName</CopyableCode></TableCell>
                        <TableCell>First Name</TableCell>
                        <TableCell><Badge variant="outline">text</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>owners.socialSecurityNumber</CopyableCode></TableCell>
                        <TableCell>Social Security Number</TableCell>
                        <TableCell><Badge variant="outline">ssn</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>owners.ownershipPercentage</CopyableCode></TableCell>
                        <TableCell>Ownership Percentage</TableCell>
                        <TableCell><Badge variant="outline">percentage</Badge></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><CopyableCode>owners.signature</CopyableCode></TableCell>
                        <TableCell>Signature</TableCell>
                        <TableCell><Badge variant="outline">signature</Badge></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ExpandableSection>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  How to Create Your PDF
                </CardTitle>
                <CardDescription>Step-by-step process in Adobe Acrobat or similar PDF editors</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex gap-4 items-start p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">1</div>
                    <div>
                      <p className="font-medium">Open your application PDF in Adobe Acrobat (or any PDF editor that supports form fields)</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">2</div>
                    <div>
                      <p className="font-medium">Use "Prepare Form" or "Edit Form" to add form fields</p>
                      <p className="text-sm text-muted-foreground">Add text fields, radio buttons, and checkboxes where you want data captured</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">3</div>
                    <div>
                      <p className="font-medium">Name each field using the dot-notation convention</p>
                      <p className="text-sm text-muted-foreground">In the field properties, set the Name to something like <code className="bg-background px-1 rounded">merchant.legalBusinessName</code></p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">4</div>
                    <div>
                      <p className="font-medium">Save the PDF and upload it to the Application Templates page</p>
                      <p className="text-sm text-muted-foreground">The system will parse all named fields and build the wizard form automatically</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-start p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">5</div>
                    <div>
                      <p className="font-medium">Review the parsed fields and activate the template</p>
                      <p className="text-sm text-muted-foreground">Check that all fields were detected correctly, then mark the template as active</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  Pro Tips
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Be consistent with naming across templates</p>
                      <p className="text-sm text-muted-foreground">Using <code>merchant.companyEmail</code> in every template means the data always maps to the same place</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Group related radio/checkbox options under the same prefix</p>
                      <p className="text-sm text-muted-foreground">All options for one question share the same prefix — only the last part changes</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Use the standard section prefixes when possible</p>
                      <p className="text-sm text-muted-foreground">The system knows about "merchant", "owners", "bankInformation", etc. and creates proper section titles</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 border rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Test with a small PDF first</p>
                      <p className="text-sm text-muted-foreground">Upload a PDF with 5-10 fields to verify your naming convention works before building the full template</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
