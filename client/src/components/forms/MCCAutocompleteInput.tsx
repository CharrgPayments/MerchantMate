import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MCCCode {
  mcc: string;
  description: string;
  category: string;
  irs_description: string;
}

interface MCCAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dataTestId?: string;
  onMCCSelect?: (mccCode: MCCCode) => void;
}

export function MCCAutocompleteInput({
  value,
  onChange,
  placeholder = "Describe your business (e.g., restaurant, retail store, gas station)",
  dataTestId,
  onMCCSelect
}: MCCAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<MCCCode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedMCC, setSelectedMCC] = useState<MCCCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced search effect
  useEffect(() => {
    if (!value || value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/mcc/search?q=${encodeURIComponent(value)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions(true);
        }
      } catch (error) {
        console.error('Failed to fetch MCC suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [value]);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    // Clear selected MCC if user starts typing again
    if (selectedMCC) {
      setSelectedMCC(null);
    }
  };

  const handleSuggestionClick = (mccCode: MCCCode) => {
    onChange(mccCode.description);
    setSelectedMCC(mccCode);
    setShowSuggestions(false);
    onMCCSelect?.(mccCode);
  };

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          data-testid={dataTestId}
          className={cn(
            "pl-10",
            selectedMCC && "border-green-300 bg-green-50"
          )}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          </div>
        )}
      </div>

      {selectedMCC && (
        <div className="mt-2 flex items-center gap-2">
          <Badge variant="outline" className="text-green-700 border-green-300">
            <Building2 className="h-3 w-3 mr-1" />
            MCC {selectedMCC.mcc}: {selectedMCC.description}
          </Badge>
        </div>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <Card
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 shadow-lg border border-gray-200"
        >
          <CardContent className="p-0 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            {suggestions.map((mccCode, index) => (
              <div
                key={`${mccCode.mcc}-${index}`}
                className="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                onClick={() => handleSuggestionClick(mccCode)}
                data-testid={`mcc-suggestion-${mccCode.mcc}`}
              >
                <Badge variant="secondary" className="text-xs font-mono">
                  {mccCode.mcc}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 line-clamp-1">
                    {mccCode.description}
                  </div>
                  {mccCode.category && mccCode.category !== mccCode.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-1">
                      {mccCode.category}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}