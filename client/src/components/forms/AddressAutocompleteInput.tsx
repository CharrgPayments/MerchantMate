import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MapPin, CheckCircle, Lock } from 'lucide-react';

interface AddressSuggestion {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

interface AddressDetails {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  street2?: string;
}

interface AddressAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect?: (address: AddressDetails) => void;
  placeholder?: string;
  disabled?: boolean;
  dataTestId?: string;
  className?: string;
  showExpandedFields?: boolean;
  initialValues?: {
    city?: string;
    state?: string;
    zipCode?: string;
    street2?: string;
  };
  street2Value?: string;
  onStreet2Change?: (value: string) => void;
  onCityChange?: (value: string) => void;
  onStateChange?: (value: string) => void;
  onZipCodeChange?: (value: string) => void;
}

export function AddressAutocompleteInput({
  value,
  onChange,
  onAddressSelect,
  placeholder = "Start typing an address...",
  disabled = false,
  dataTestId,
  className = "",
  showExpandedFields = true,
  initialValues = {},
  street2Value = '',
  onStreet2Change,
  onCityChange,
  onStateChange,
  onZipCodeChange
}: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLocked, setIsLocked] = useState(false);
  const [addressDetails, setAddressDetails] = useState<AddressDetails>({
    street: value || '',
    city: initialValues.city || '',
    state: initialValues.state || '',
    zipCode: initialValues.zipCode || '',
    street2: initialValues.street2 || street2Value || ''
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  // Update addressDetails when initialValues change
  useEffect(() => {
    console.log('🔄 AddressAutocompleteInput useEffect:', {
      value: value,
      'initialValues.city': initialValues.city,
      'initialValues.state': initialValues.state,
      'initialValues.zipCode': initialValues.zipCode,
      'initialValues.street2': initialValues.street2,
      currentAddressDetails: addressDetails
    });
    
    const newDetails = {
      ...addressDetails,
      city: initialValues.city || addressDetails.city,
      state: initialValues.state || addressDetails.state,
      zipCode: initialValues.zipCode || addressDetails.zipCode,
      street2: initialValues.street2 || street2Value || addressDetails.street2
    };
    
    console.log('📝 Setting addressDetails to:', newDetails);
    setAddressDetails(newDetails);
    
    // Auto-lock if we have complete address data from initialValues
    if (value && initialValues.city && initialValues.state && initialValues.zipCode) {
      console.log('✅ Auto-locking address field - complete data detected');
      setIsLocked(true);
      setValidationStatus('valid');
    } else {
      console.log('❌ NOT auto-locking:', {
        hasValue: !!value,
        hasCity: !!initialValues.city,
        hasState: !!initialValues.state,
        hasZipCode: !!initialValues.zipCode
      });
    }
  }, [initialValues.city, initialValues.state, initialValues.zipCode, initialValues.street2, street2Value, value]);

  // Fetch address suggestions
  const fetchSuggestions = async (input: string) => {
    if (input.length < 4) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch('/api/address-autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setSuggestions(result.suggestions || []);
        setShowSuggestions(true);
        setSelectedIndex(-1);
      }
    } catch (error) {
      console.error('Address suggestions error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Validate and select address
  const validateAndSelectAddress = async (suggestion: AddressSuggestion) => {
    try {
      const response = await fetch('/api/validate-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address: suggestion.description }),
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.isValid) {
          setValidationStatus('valid');
          setIsLocked(true);
          const newAddressDetails = {
            street: result.streetAddress || suggestion.description.split(',')[0].trim(),
            city: result.city || '',
            state: result.state || '',
            zipCode: result.zipCode || '',
            street2: addressDetails.street2 || ''
          };
          
          onChange(newAddressDetails.street);
          setAddressDetails(newAddressDetails);
          
          // Call the callback with full address data
          if (onAddressSelect) {
            onAddressSelect(newAddressDetails);
          }
          
          setShowSuggestions(false);
          setSuggestions([]);
        } else {
          setValidationStatus('invalid');
        }
      }
    } catch (error) {
      console.error('Address validation error:', error);
      setValidationStatus('invalid');
    }
  };

  // Handle edit address
  const handleEditAddress = () => {
    setIsLocked(false);
    setValidationStatus('idle');
    setAddressDetails({
      street: '',
      city: '',
      state: '',
      zipCode: ''
    });
    onChange('');
  };

  // Handle individual field updates
  const handleFieldChange = (field: keyof AddressDetails, value: string) => {
    const updatedDetails = {
      ...addressDetails,
      [field]: value
    };
    setAddressDetails(updatedDetails);
    
    // Call specific onChange handlers based on which field changed
    if (field === 'street') {
      onChange(value);
    } else if (field === 'city' && onCityChange) {
      onCityChange(value);
    } else if (field === 'state' && onStateChange) {
      onStateChange(value);
    } else if (field === 'zipCode' && onZipCodeChange) {
      onZipCodeChange(value);
    } else if (field === 'street2' && onStreet2Change) {
      onStreet2Change(value);
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setValidationStatus('idle');
    
    if (newValue && newValue.length >= 4) {
      fetchSuggestions(newValue);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedIndex(-1);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0 && selectedIndex >= 0) {
        validateAndSelectAddress(suggestions[selectedIndex]);
      }
      return;
    }

    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-4 w-full">
      {/* Street Address Input */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="street-address" className="text-sm font-semibold text-gray-900">
            Street Address
          </Label>
          <div className="relative">
            <Input
              ref={inputRef}
              id="street-address"
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || isLocked}
              data-testid={dataTestId}
              className={`pr-8 ${
                validationStatus === 'valid'
                  ? 'border-green-500 bg-green-50'
                  : validationStatus === 'invalid'
                  ? 'border-red-500'
                  : ''
              } ${className}`}
            />
            {isLoading && (
              <Loader2 className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
            )}
            {validationStatus === 'valid' && (
              <CheckCircle className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-green-500" />
            )}
            {validationStatus === 'invalid' && (
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 bg-red-500 rounded-full" />
            )}

            {/* Address suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto"
              >
                {suggestions.map((suggestion, index) => (
                  <div
                    key={suggestion.place_id}
                    className={`px-4 py-2 cursor-pointer hover:bg-gray-50 ${
                      index === selectedIndex ? 'bg-blue-50' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      validateAndSelectAddress(suggestion);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <div>
                        <div className="font-medium text-sm">
                          {suggestion.structured_formatting?.main_text || suggestion.description.split(',')[0]}
                        </div>
                        {suggestion.structured_formatting?.secondary_text && (
                          <div className="text-xs text-gray-500">
                            {suggestion.structured_formatting.secondary_text}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Validation message for street address */}
          {validationStatus === 'valid' && isLocked && (
            <div className="flex items-center space-x-1 text-sm text-orange-600">
              <Lock className="h-3 w-3" />
              <span>Address validated and locked.</span>
              <button
                type="button"
                onClick={handleEditAddress}
                className="text-blue-600 hover:text-blue-700 font-medium underline"
              >
                Edit Address
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="apt-suite" className="text-sm font-semibold text-gray-900">
            Apt/Suite <span className="text-gray-500 font-normal">(Optional)</span>
          </Label>
          <Input
            id="apt-suite"
            placeholder="Suite 100"
            value={addressDetails.street2 || ''}
            onChange={(e) => {
              const newStreet2 = e.target.value;
              setAddressDetails(prev => ({ ...prev, street2: newStreet2 }));
              // Only call the specific field onChange handler
              if (onStreet2Change) {
                onStreet2Change(newStreet2);
              }
            }}
            data-testid={`${dataTestId}-apt`}
          />
        </div>
      </div>

      {/* Expanded address fields - show when address is validated OR has initial values */}
      {(() => {
        const shouldShow = showExpandedFields && (validationStatus === 'valid' || addressDetails.city || addressDetails.state || addressDetails.zipCode);
        console.log('👁️ Should show expanded fields?', {
          showExpandedFields: showExpandedFields,
          validationStatus: validationStatus,
          'addressDetails.city': addressDetails.city,
          'addressDetails.state': addressDetails.state,
          'addressDetails.zipCode': addressDetails.zipCode,
          shouldShow: shouldShow
        });
        return shouldShow;
      })() && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="address-city" className="text-sm font-semibold text-gray-900">
              City
            </Label>
            <Input
              id="address-city"
              value={addressDetails.city}
              onChange={(e) => handleFieldChange('city', e.target.value)}
              placeholder="City"
              disabled={isLocked}
              data-testid={`${dataTestId}-city`}
              className="disabled:opacity-100 disabled:cursor-not-allowed"
            />
            {isLocked && (
              <div className="flex items-center space-x-1 text-sm text-orange-600">
                <Lock className="h-3 w-3" />
                <span>Field locked after address selection.</span>
                <button
                  type="button"
                  onClick={handleEditAddress}
                  className="text-blue-600 hover:text-blue-700 font-medium underline"
                >
                  Edit Address
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address-state" className="text-sm font-semibold text-gray-900">
              State
            </Label>
            <Input
              id="address-state"
              value={addressDetails.state}
              onChange={(e) => handleFieldChange('state', e.target.value)}
              placeholder="State"
              disabled={isLocked}
              data-testid={`${dataTestId}-state`}
              className="disabled:opacity-100 disabled:cursor-not-allowed"
              maxLength={2}
            />
            {isLocked && (
              <div className="flex items-center space-x-1 text-sm text-orange-600">
                <Lock className="h-3 w-3" />
                <span>Field locked after address selection.</span>
                <button
                  type="button"
                  onClick={handleEditAddress}
                  className="text-blue-600 hover:text-blue-700 font-medium underline"
                >
                  Edit Address
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address-zip" className="text-sm font-semibold text-gray-900">
              Postal Code
            </Label>
            <Input
              id="address-zip"
              value={addressDetails.zipCode}
              onChange={(e) => handleFieldChange('zipCode', e.target.value)}
              placeholder="ZIP Code"
              disabled={isLocked}
              data-testid={`${dataTestId}-zipcode`}
              className="disabled:opacity-100 disabled:cursor-not-allowed"
            />
            {isLocked && (
              <div className="flex items-center space-x-1 text-sm text-orange-600">
                <Lock className="h-3 w-3" />
                <span>Field locked after address selection.</span>
                <button
                  type="button"
                  onClick={handleEditAddress}
                  className="text-blue-600 hover:text-blue-700 font-medium underline"
                >
                  Edit Address
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address-country" className="text-sm font-semibold text-gray-900">
              Country
            </Label>
            <Input
              id="address-country"
              value="US"
              disabled
              data-testid={`${dataTestId}-country`}
              className="disabled:opacity-100 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      )}
    </div>
  );
}
