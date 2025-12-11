import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type TaxIdType = 'ein' | 'ssn' | 'tin';

interface MaskedTaxIdInputProps {
  value: string;
  onChange: (value: string) => void;
  type?: TaxIdType;
  placeholder?: string;
  disabled?: boolean;
  dataTestId?: string;
  className?: string;
}

function formatEIN(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function formatSSN(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatTIN(value: string): string {
  return formatEIN(value);
}

function maskEIN(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) return value;
  return `**-***${digits.slice(-4)}`;
}

function maskSSN(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) return value;
  return `***-**-${digits.slice(-4)}`;
}

function maskTIN(value: string): string {
  return maskEIN(value);
}

const formatters: Record<TaxIdType, (value: string) => string> = {
  ein: formatEIN,
  ssn: formatSSN,
  tin: formatTIN,
};

const maskers: Record<TaxIdType, (value: string) => string> = {
  ein: maskEIN,
  ssn: maskSSN,
  tin: maskTIN,
};

const placeholders: Record<TaxIdType, string> = {
  ein: '12-3456789',
  ssn: '123-45-6789',
  tin: '12-3456789',
};

export function MaskedTaxIdInput({
  value,
  onChange,
  type = 'ein',
  placeholder,
  disabled = false,
  dataTestId,
  className = ''
}: MaskedTaxIdInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const format = formatters[type];
  const mask = maskers[type];
  const defaultPlaceholder = placeholders[type];

  const digits = value?.replace(/\D/g, '') || '';
  const isComplete = digits.length === 9;

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    const digitsOnly = input.replace(/\D/g, '').slice(0, 9);
    const formatted = format(digitsOnly);
    onChange(formatted);
  }, [format, onChange]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (value) {
      const digitsOnly = value.replace(/\D/g, '');
      if (digitsOnly.length === 9) {
        const formatted = format(digitsOnly);
        if (formatted !== value) {
          onChange(formatted);
        }
      }
    }
  }, [value, format, onChange]);

  const toggleVisibility = useCallback(() => {
    setShowValue(prev => !prev);
  }, []);

  const displayValue = (() => {
    if (isFocused || showValue || !isComplete) {
      return value || '';
    }
    return mask(value || '');
  })();

  return (
    <div className="relative flex items-center">
      <Input
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder || defaultPlaceholder}
        disabled={disabled}
        data-testid={dataTestId}
        className={cn('pr-10', className)}
        maxLength={type === 'ssn' ? 11 : 10}
      />
      {isComplete && !isFocused && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-1 h-7 w-7 p-0"
          onClick={toggleVisibility}
          tabIndex={-1}
          data-testid={`${dataTestId}-toggle`}
        >
          {showValue ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      )}
    </div>
  );
}
