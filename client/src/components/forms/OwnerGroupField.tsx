import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  UserPlus, 
  Trash2, 
  Users, 
  AlertCircle, 
  CheckCircle2, 
  PenTool,
  Shield,
  Percent,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EnhancedSignatureField } from './EnhancedSignatureField';
import { SignatureEnvelope } from '@shared/schema';

export interface Owner {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  ssn: string;
  ownershipPercent: number;
  isControlPerson: boolean;
  isBeneficialOwner: boolean;
  address: {
    street1: string;
    street2: string;
    city: string;
    state: string;
    zipCode: string;
  };
  signature?: SignatureEnvelope;
}

export interface OwnerGroupValidation {
  isValid: boolean;
  errors: string[];
  ownershipTotal: number;
  pendingSignatures: number;
  missingRequiredFields: string[];
}

interface OwnerGroupFieldProps {
  fieldId: string;
  value: Owner[];
  onChange: (owners: Owner[]) => void;
  onValidationChange?: (validation: OwnerGroupValidation) => void;
  config?: {
    maxOwners?: number;
    requireSignatureThreshold?: number;
    collectFields?: string[];
  };
  disabled?: boolean;
  errors?: Record<string, string>;
}

const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' }, { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' }, { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' }, { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' }, { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' }, { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' }, { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' }, { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' }, { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' }, { value: 'DC', label: 'District of Columbia' }
];

const TITLE_OPTIONS = [
  'CEO', 'CFO', 'COO', 'President', 'Vice President', 'Secretary', 'Treasurer',
  'Managing Member', 'General Partner', 'Owner', 'Director', 'Other'
];

const createEmptyOwner = (): Owner => ({
  id: `owner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
  firstName: '',
  lastName: '',
  title: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  ssn: '',
  ownershipPercent: 0,
  isControlPerson: false,
  isBeneficialOwner: false,
  address: {
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  }
});

export default function OwnerGroupField({
  fieldId,
  value = [],
  onChange,
  onValidationChange,
  config = {},
  disabled = false,
  errors = {}
}: OwnerGroupFieldProps) {
  const maxOwners = config.maxOwners || 5;
  const signatureThreshold = config.requireSignatureThreshold || 25;
  
  // Limit initial value to maxOwners
  const limitedInitialValue = value.length > 0 ? value.slice(0, maxOwners) : [createEmptyOwner()];
  const [owners, setOwners] = useState<Owner[]>(limitedInitialValue);
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set(limitedInitialValue.map(o => o.id)));

  useEffect(() => {
    if (value.length > 0 && JSON.stringify(value) !== JSON.stringify(owners)) {
      // Limit loaded value to maxOwners
      const limitedValue = value.slice(0, maxOwners);
      setOwners(limitedValue);
    }
  }, [value, maxOwners]);

  useEffect(() => {
    onChange(owners);
  }, [owners]);

  const totalOwnership = owners.reduce((sum, o) => sum + (o.ownershipPercent || 0), 0);
  const remainingOwnership = 100 - totalOwnership;

  const validateOwner = (owner: Owner): string[] => {
    const ownerErrors: string[] = [];
    if (!owner.firstName.trim()) ownerErrors.push('First name is required');
    if (!owner.lastName.trim()) ownerErrors.push('Last name is required');
    if (!owner.title) ownerErrors.push('Title is required');
    if (!owner.email.trim()) ownerErrors.push('Email is required');
    if (!owner.phone.trim()) ownerErrors.push('Phone is required');
    if (!owner.dateOfBirth) ownerErrors.push('Date of birth is required');
    if (!owner.ssn.trim() || owner.ssn.replace(/\D/g, '').length !== 9) ownerErrors.push('Valid SSN is required');
    if (!owner.address.street1.trim()) ownerErrors.push('Street address is required');
    if (!owner.address.city.trim()) ownerErrors.push('City is required');
    if (!owner.address.state) ownerErrors.push('State is required');
    if (!owner.address.zipCode.trim() || owner.address.zipCode.length !== 5) ownerErrors.push('Valid ZIP code is required');
    return ownerErrors;
  };

  const getValidation = (): OwnerGroupValidation => {
    const validationErrors: string[] = [];
    const missingFields: string[] = [];
    
    if (totalOwnership !== 100) {
      validationErrors.push(`Total ownership must equal 100% (currently ${totalOwnership}%)`);
    }
    if (totalOwnership > 100) {
      validationErrors.push(`Total ownership exceeds 100% (currently ${totalOwnership}%)`);
    }
    
    const beneficialOwnersList = owners.filter(o => o.ownershipPercent >= signatureThreshold);
    const pendingSigs = beneficialOwnersList.filter(o => !o.signature || o.signature.status !== 'signed');
    
    if (pendingSigs.length > 0) {
      validationErrors.push(`${pendingSigs.length} beneficial owner(s) require signature`);
      pendingSigs.forEach(o => {
        missingFields.push(`${o.firstName || 'Owner'} ${o.lastName || ''} signature`);
      });
    }
    
    owners.forEach((owner, idx) => {
      const ownerErrors = validateOwner(owner);
      if (ownerErrors.length > 0) {
        const ownerName = owner.firstName && owner.lastName 
          ? `${owner.firstName} ${owner.lastName}` 
          : `Owner ${idx + 1}`;
        ownerErrors.forEach(err => {
          missingFields.push(`${ownerName}: ${err}`);
        });
      }
    });
    
    return {
      isValid: validationErrors.length === 0 && missingFields.length === 0,
      errors: validationErrors,
      ownershipTotal: totalOwnership,
      pendingSignatures: pendingSigs.length,
      missingRequiredFields: missingFields,
    };
  };

  const prevValidationRef = useRef<string>('');
  
  useEffect(() => {
    if (onValidationChange) {
      const validation = getValidation();
      const validationKey = JSON.stringify(validation);
      
      if (validationKey !== prevValidationRef.current) {
        prevValidationRef.current = validationKey;
        onValidationChange(validation);
      }
    }
  }, [owners]);
  const isComplete = totalOwnership === 100;
  const hasOverage = totalOwnership > 100;

  const beneficialOwners = owners.filter(o => o.ownershipPercent >= signatureThreshold);
  const pendingSignatures = beneficialOwners.filter(o => !o.signature);

  const addOwner = () => {
    if (owners.length >= maxOwners) return;
    const newOwner = createEmptyOwner();
    setOwners([...owners, newOwner]);
    setExpandedOwners(new Set([...Array.from(expandedOwners), newOwner.id]));
  };

  const removeOwner = (ownerId: string) => {
    if (owners.length <= 1) return;
    setOwners(owners.filter(o => o.id !== ownerId));
    const newExpanded = new Set(expandedOwners);
    newExpanded.delete(ownerId);
    setExpandedOwners(newExpanded);
  };

  const updateOwner = (ownerId: string, updates: Partial<Owner>) => {
    setOwners(owners.map(o => {
      if (o.id === ownerId) {
        const updated = { ...o, ...updates };
        updated.isBeneficialOwner = updated.ownershipPercent >= signatureThreshold;
        return updated;
      }
      return o;
    }));
  };

  const updateOwnerAddress = (ownerId: string, addressUpdates: Partial<Owner['address']>) => {
    setOwners(owners.map(o => {
      if (o.id === ownerId) {
        return { ...o, address: { ...o.address, ...addressUpdates } };
      }
      return o;
    }));
  };

  const handleSignature = (ownerId: string, signatureData: SignatureEnvelope) => {
    updateOwner(ownerId, { signature: signatureData });
  };

  const toggleExpand = (ownerId: string) => {
    const newExpanded = new Set(expandedOwners);
    if (newExpanded.has(ownerId)) {
      newExpanded.delete(ownerId);
    } else {
      newExpanded.add(ownerId);
    }
    setExpandedOwners(newExpanded);
  };

  const formatSSN = (value: string) => {
    const digits = value.replace(/\D/g, '').substring(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').substring(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Beneficial Owners & Control Persons</h3>
        </div>
        <Badge variant={isComplete ? 'default' : hasOverage ? 'destructive' : 'secondary'}>
          {owners.length} of {maxOwners} owners
        </Badge>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Total Ownership Defined</span>
              <span className={cn(
                "font-medium",
                isComplete ? "text-green-600" : hasOverage ? "text-red-600" : "text-amber-600"
              )}>
                {totalOwnership}%
              </span>
            </div>
            <Progress 
              value={Math.min(totalOwnership, 100)} 
              className={cn(
                "h-2",
                hasOverage && "[&>div]:bg-red-500"
              )}
            />
            {!isComplete && !hasOverage && (
              <p className="text-xs text-muted-foreground">
                {remainingOwnership}% ownership remaining to be assigned
              </p>
            )}
            {hasOverage && (
              <p className="text-xs text-red-600">
                Total ownership exceeds 100%. Please adjust ownership percentages.
              </p>
            )}
            {isComplete && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Ownership fully allocated
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {beneficialOwners.length > 0 && (
        <Alert>
          <PenTool className="h-4 w-4" />
          <AlertDescription>
            <strong>{beneficialOwners.length}</strong> owner(s) with ≥{signatureThreshold}% ownership require signature.
            {pendingSignatures.length > 0 && (
              <span className="text-amber-600 ml-1">
                ({pendingSignatures.length} pending)
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {owners.map((owner, index) => {
          const isExpanded = expandedOwners.has(owner.id);
          const requiresSignature = owner.ownershipPercent >= signatureThreshold;
          const hasSignature = !!owner.signature;

          return (
            <Card key={owner.id} className={cn(
              "transition-all",
              requiresSignature && !hasSignature && "border-amber-300",
              hasSignature && "border-green-300"
            )}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpand(owner.id)}
                      className="p-0 h-6 w-6"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <CardTitle className="text-base">
                      {owner.firstName && owner.lastName 
                        ? `${owner.firstName} ${owner.lastName}`
                        : `Owner ${index + 1}`
                      }
                    </CardTitle>
                    {owner.ownershipPercent > 0 && (
                      <Badge variant="outline" className="ml-2">
                        <Percent className="h-3 w-3 mr-1" />
                        {owner.ownershipPercent}%
                      </Badge>
                    )}
                    {owner.isControlPerson && (
                      <Badge variant="secondary">
                        <Shield className="h-3 w-3 mr-1" />
                        Control Person
                      </Badge>
                    )}
                    {requiresSignature && (
                      <Badge variant={hasSignature ? 'default' : 'outline'} className={cn(
                        hasSignature ? 'bg-green-100 text-green-800' : 'border-amber-300 text-amber-700'
                      )}>
                        <PenTool className="h-3 w-3 mr-1" />
                        {hasSignature ? 'Signed' : 'Signature Required'}
                      </Badge>
                    )}
                  </div>
                  {owners.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOwner(owner.id)}
                      disabled={disabled}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>First Name *</Label>
                      <Input
                        value={owner.firstName}
                        onChange={(e) => updateOwner(owner.id, { firstName: e.target.value })}
                        disabled={disabled}
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <Label>Last Name *</Label>
                      <Input
                        value={owner.lastName}
                        onChange={(e) => updateOwner(owner.id, { lastName: e.target.value })}
                        disabled={disabled}
                        placeholder="Last name"
                      />
                    </div>
                    <div>
                      <Label>Title *</Label>
                      <Select
                        value={owner.title}
                        onValueChange={(v) => updateOwner(owner.id, { title: v })}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select title" />
                        </SelectTrigger>
                        <SelectContent>
                          {TITLE_OPTIONS.map((title) => (
                            <SelectItem key={title} value={title}>{title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Ownership Percentage *</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={owner.ownershipPercent || ''}
                          onChange={(e) => updateOwner(owner.id, { 
                            ownershipPercent: Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
                          })}
                          disabled={disabled}
                          className="pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                      </div>
                      {owner.ownershipPercent >= signatureThreshold && (
                        <p className="text-xs text-amber-600 mt-1">
                          ≥{signatureThreshold}% = Beneficial Owner (signature required)
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>Date of Birth *</Label>
                      <Input
                        type="date"
                        value={owner.dateOfBirth}
                        onChange={(e) => updateOwner(owner.id, { dateOfBirth: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <Label>SSN *</Label>
                      <Input
                        value={owner.ssn}
                        onChange={(e) => updateOwner(owner.id, { ssn: formatSSN(e.target.value) })}
                        disabled={disabled}
                        placeholder="XXX-XX-XXXX"
                        maxLength={11}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        value={owner.email}
                        onChange={(e) => updateOwner(owner.id, { email: e.target.value })}
                        disabled={disabled}
                        placeholder="email@example.com"
                      />
                    </div>
                    <div>
                      <Label>Phone *</Label>
                      <Input
                        value={owner.phone}
                        onChange={(e) => updateOwner(owner.id, { phone: formatPhone(e.target.value) })}
                        disabled={disabled}
                        placeholder="(XXX) XXX-XXXX"
                        maxLength={14}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <Label className="text-sm font-medium">Residential Address</Label>
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Street Address *</Label>
                        <Input
                          value={owner.address.street1}
                          onChange={(e) => updateOwnerAddress(owner.id, { street1: e.target.value })}
                          disabled={disabled}
                          placeholder="123 Main St"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Suite/Apt (optional)</Label>
                        <Input
                          value={owner.address.street2}
                          onChange={(e) => updateOwnerAddress(owner.id, { street2: e.target.value })}
                          disabled={disabled}
                          placeholder="Apt 4B"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">City *</Label>
                        <Input
                          value={owner.address.city}
                          onChange={(e) => updateOwnerAddress(owner.id, { city: e.target.value })}
                          disabled={disabled}
                          placeholder="City"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">State *</Label>
                        <Select
                          value={owner.address.state}
                          onValueChange={(v) => updateOwnerAddress(owner.id, { state: v })}
                          disabled={disabled}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="State" />
                          </SelectTrigger>
                          <SelectContent>
                            {US_STATES.map((state) => (
                              <SelectItem key={state.value} value={state.value}>{state.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">ZIP Code *</Label>
                        <Input
                          value={owner.address.zipCode}
                          onChange={(e) => updateOwnerAddress(owner.id, { 
                            zipCode: e.target.value.replace(/\D/g, '').substring(0, 5)
                          })}
                          disabled={disabled}
                          placeholder="12345"
                          maxLength={5}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`control-${owner.id}`}
                      checked={owner.isControlPerson}
                      onCheckedChange={(checked) => updateOwner(owner.id, { isControlPerson: !!checked })}
                      disabled={disabled}
                    />
                    <div className="grid gap-1.5 leading-none">
                      <label
                        htmlFor={`control-${owner.id}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        Control Person
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Individual with significant responsibility for managing the business (e.g., CEO, CFO, Managing Member)
                      </p>
                    </div>
                  </div>

                  {requiresSignature && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <PenTool className="h-4 w-4 text-primary" />
                          <Label className="text-sm font-medium">
                            Signature Required (≥{signatureThreshold}% Beneficial Owner)
                          </Label>
                        </div>
                        <EnhancedSignatureField
                          fieldName={`${fieldId}.owner.${owner.id}.signature`}
                          fieldLabel={`${owner.firstName || 'Owner'} ${owner.lastName || ''} Signature`}
                          value={owner.signature}
                          onChange={(sig) => handleSignature(owner.id, sig)}
                          disabled={disabled}
                          linkedFields={[]}
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {owners.length < maxOwners && (
        <Button
          variant="outline"
          onClick={addOwner}
          disabled={disabled}
          className="w-full"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add Owner ({owners.length}/{maxOwners})
        </Button>
      )}

      {!isComplete && owners.length >= maxOwners && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Maximum of {maxOwners} owners reached but total ownership is only {totalOwnership}%.
            Please adjust ownership percentages to total 100%.
          </AlertDescription>
        </Alert>
      )}

      {/* Validation Summary */}
      {(() => {
        const validation = getValidation();
        if (validation.isValid) {
          return (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700">
                <strong>Owner information complete</strong> - All required fields filled and signatures collected.
              </AlertDescription>
            </Alert>
          );
        }
        
        return (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Please correct the following issues:</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {validation.errors.map((error, idx) => (
                    <li key={`err-${idx}`}>{error}</li>
                  ))}
                  {validation.missingRequiredFields.slice(0, 5).map((field, idx) => (
                    <li key={`field-${idx}`}>{field}</li>
                  ))}
                  {validation.missingRequiredFields.length > 5 && (
                    <li>...and {validation.missingRequiredFields.length - 5} more issues</li>
                  )}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        );
      })()}
    </div>
  );
}
