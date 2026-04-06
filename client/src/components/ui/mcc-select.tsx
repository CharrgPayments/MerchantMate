import React, { useState, useMemo } from 'react';
import { Check, ChevronDown, Search, Tag, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MCC_CODES, MCC_CATEGORIES, getMCCByCode, getMCCsByCategory, searchMCCs, getPopularMCCs, type MCCCode } from '@shared/mccCodes';

interface MCCSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}

export function MCCSelect({ 
  value, 
  onValueChange, 
  placeholder = "Select MCC code", 
  disabled = false,
  className,
  required = false
}: MCCSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedMCC = value ? getMCCByCode(value) : null;

  // Filter MCCs based on search term
  const filteredMCCs = useMemo(() => {
    if (!searchTerm.trim()) {
      return getPopularMCCs(); // Show popular MCCs by default
    }
    return searchMCCs(searchTerm);
  }, [searchTerm]);

  // Group MCCs by category for organized display
  const mccsByCategory = useMemo(() => {
    const categories: Record<string, MCCCode[]> = {};
    filteredMCCs.forEach(mcc => {
      if (!categories[mcc.category]) {
        categories[mcc.category] = [];
      }
      categories[mcc.category].push(mcc);
    });
    return categories;
  }, [filteredMCCs]);

  const popularMCCs = getPopularMCCs();

  const handleSelect = (mccCode: string) => {
    onValueChange(mccCode);
    setOpen(false);
    setSearchTerm('');
  };

  const getRiskLevelColor = (riskLevel: 'low' | 'medium' | 'high') => {
    switch (riskLevel) {
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between text-left font-normal",
              !value && "text-muted-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            disabled={disabled}
          >
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              <Tag className="h-4 w-4 flex-shrink-0" />
              {selectedMCC ? (
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="font-mono text-sm font-semibold">{selectedMCC.code}</span>
                  <span className="truncate">{selectedMCC.description}</span>
                  <Badge 
                    variant="outline" 
                    className={cn("text-xs", getRiskLevelColor(selectedMCC.riskLevel))}
                  >
                    {selectedMCC.riskLevel}
                  </Badge>
                </div>
              ) : (
                <span>{placeholder}</span>
              )}
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[600px] p-0" align="start">
          <div className="flex flex-col h-[500px]">
            {/* Search Header */}
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search MCC codes, descriptions, or categories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              {selectedMCC && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">Selected: {selectedMCC.code}</div>
                      <div className="text-sm text-gray-600">{selectedMCC.description}</div>
                      <div className="text-xs text-gray-500 mt-1">{selectedMCC.category}</div>
                    </div>
                    <Badge className={getRiskLevelColor(selectedMCC.riskLevel)}>
                      {selectedMCC.riskLevel} risk
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {/* MCC Lists */}
            <div className="flex-1 overflow-hidden">
              <Tabs defaultValue="popular" className="h-full flex flex-col">
                <TabsList className="grid w-full grid-cols-2 m-2">
                  <TabsTrigger value="popular">Popular</TabsTrigger>
                  <TabsTrigger value="all">All Categories</TabsTrigger>
                </TabsList>
                
                <TabsContent value="popular" className="flex-1 m-0">
                  <ScrollArea className="h-full px-2">
                    <div className="space-y-1 p-2">
                      {(searchTerm ? filteredMCCs.slice(0, 20) : popularMCCs).map((mcc) => (
                        <button
                          key={mcc.code}
                          onClick={() => handleSelect(mcc.code)}
                          className={cn(
                            "w-full flex items-center justify-between p-3 text-left rounded-lg border transition-colors hover:bg-gray-50",
                            value === mcc.code && "bg-blue-50 border-blue-200"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-sm font-semibold text-blue-600">{mcc.code}</span>
                              <Badge className={cn("text-xs", getRiskLevelColor(mcc.riskLevel))}>
                                {mcc.riskLevel}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-900 mt-1">{mcc.description}</div>
                            <div className="text-xs text-gray-500">{mcc.category}</div>
                          </div>
                          {value === mcc.code && (
                            <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                      {(searchTerm ? filteredMCCs : popularMCCs).length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No MCC codes found matching "{searchTerm}"</p>
                          <p className="text-sm mt-1">Try different keywords or browse categories</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="all" className="flex-1 m-0">
                  <ScrollArea className="h-full px-2">
                    <div className="p-2">
                      {Object.entries(mccsByCategory).map(([category, mccs]) => (
                        <div key={category} className="mb-6">
                          <h4 className="font-semibold text-sm text-gray-700 mb-2 px-2">{category}</h4>
                          <div className="space-y-1">
                            {mccs.map((mcc) => (
                              <button
                                key={mcc.code}
                                onClick={() => handleSelect(mcc.code)}
                                className={cn(
                                  "w-full flex items-center justify-between p-3 text-left rounded-lg border transition-colors hover:bg-gray-50",
                                  value === mcc.code && "bg-blue-50 border-blue-200"
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-mono text-sm font-semibold text-blue-600">{mcc.code}</span>
                                    <Badge className={cn("text-xs", getRiskLevelColor(mcc.riskLevel))}>
                                      {mcc.riskLevel}
                                    </Badge>
                                  </div>
                                  <div className="text-sm text-gray-900 mt-1">{mcc.description}</div>
                                </div>
                                {value === mcc.code && (
                                  <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            {/* Footer with help text */}
            <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Low Risk</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span>Medium Risk</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>High Risk</span>
                </div>
              </div>
              <p className="mt-1">MCC codes determine processing fees and risk assessment. Select the code that best matches your primary business activity.</p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      {required && !value && (
        <p className="text-sm text-red-500">MCC code selection is required</p>
      )}
    </div>
  );
}