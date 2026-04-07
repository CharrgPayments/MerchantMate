import { Input } from '@/components/ui/input';
import { formatEIN } from '@/lib/utils';

interface EINInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  dataTestId?: string;
  className?: string;
}

export function EINInput({
  value,
  onChange,
  placeholder = "12-3456789",
  disabled = false,
  dataTestId,
  className = ""
}: EINInputProps) {
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Remove all non-digit characters
    const digitsOnly = input.replace(/\D/g, '');
    
    // Limit to 9 digits
    const limited = digitsOnly.slice(0, 9);
    
    // Format the EIN
    const formatted = formatEIN(limited);
    onChange(formatted);
  };

  const handleBlur = () => {
    // Ensure the EIN is fully formatted on blur
    if (value) {
      const digitsOnly = value.replace(/\D/g, '');
      if (digitsOnly.length === 9) {
        const formatted = formatEIN(digitsOnly);
        if (formatted !== value) {
          onChange(formatted);
        }
      }
    }
  };

  return (
    <Input
      type="text"
      value={value}
      onChange={handleInputChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      data-testid={dataTestId}
      className={className}
      maxLength={10}
    />
  );
}
