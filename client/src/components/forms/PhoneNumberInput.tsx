import { Input } from '@/components/ui/input';
import { formatPhoneNumber, unformatPhoneNumber } from '@/lib/utils';

interface PhoneNumberInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  dataTestId?: string;
  className?: string;
}

export function PhoneNumberInput({
  value,
  onChange,
  placeholder = "(555) 555-5555",
  disabled = false,
  dataTestId,
  className = ""
}: PhoneNumberInputProps) {
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Remove all non-digit characters
    const digitsOnly = unformatPhoneNumber(input);
    
    // Limit to 10 digits
    const limited = digitsOnly.slice(0, 10);
    
    // Format the phone number
    const formatted = formatPhoneNumber(limited);
    onChange(formatted);
  };

  const handleBlur = () => {
    // Ensure the phone number is fully formatted on blur
    if (value) {
      const digitsOnly = unformatPhoneNumber(value);
      if (digitsOnly.length === 10) {
        const formatted = formatPhoneNumber(digitsOnly);
        if (formatted !== value) {
          onChange(formatted);
        }
      }
    }
  };

  return (
    <Input
      type="tel"
      value={value}
      onChange={handleInputChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      data-testid={dataTestId}
      className={className}
    />
  );
}
