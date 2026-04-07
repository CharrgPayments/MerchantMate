import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

interface FeeGroup {
  id: number;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  feeItems: FeeItem[];
}

interface FeeItem {
  id: number;
  name: string;
  description?: string;
  feeGroupId: number;
  valueType: 'percentage' | 'fixed' | 'basis_points';
  defaultValue?: string;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
}

interface PricingType {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
}

interface CampaignFeeValue {
  feeItemId: number;
  value: string;
}

interface EquipmentItem {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  imageData?: string;
  specifications?: string;
  isActive: boolean;
}

interface Campaign {
  id: number;
  name: string;
  description?: string;
  acquirer: string;
  pricingType: {
    id: number;
    name: string;
  };
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  feeValues?: CampaignFeeValue[];
}

interface EnhancedCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCampaignCreated?: () => void;
  editCampaignId?: number | null;
  editCampaignData?: Campaign | null;
}

export function EnhancedCampaignDialog({ 
  open, 
  onOpenChange, 
  onCampaignCreated, 
  editCampaignId, 
  editCampaignData 
}: EnhancedCampaignDialogProps) {
  const { toast } = useToast();
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    acquirer: '',
    equipment: '',
    currency: 'USD',
    pricingTypeId: null as number | null,
  });
  
  const [feeValues, setFeeValues] = useState<Record<number, string>>({});
  const [selectedEquipment, setSelectedEquipment] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const defaultsSetRef = useRef(false);

  // Data queries
  const { data: pricingTypes = [], isLoading: pricingTypesLoading } = useQuery({
    queryKey: ['/api/pricing-types'],
    queryFn: async () => {
      const response = await fetch('/api/pricing-types', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch pricing types');
      return response.json();
    },
  });

  // Get fee groups for selected pricing type
  const { data: selectedPricingTypeFeeGroups, isLoading: feeGroupsLoading } = useQuery({
    queryKey: ['/api/pricing-types', formData.pricingTypeId, 'fee-groups'],
    queryFn: async () => {
      if (!formData.pricingTypeId) return null;
      const response = await fetch(`/api/pricing-types/${formData.pricingTypeId}/fee-groups`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch fee groups');
      return response.json();
    },
    enabled: !!formData.pricingTypeId,
  });

  // Get equipment items
  const { data: equipmentItems = [], isLoading: equipmentLoading } = useQuery({
    queryKey: ['/api/equipment-items'],
    queryFn: async () => {
      const response = await fetch('/api/equipment-items', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch equipment items');
      return response.json();
    },
  });

  // Create campaign mutation
  const createCampaignMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to create campaign');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Campaign Created",
        description: "Campaign has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      resetForm();
      onOpenChange(false);
      onCampaignCreated?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update campaign mutation
  const updateCampaignMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/campaigns/${editCampaignId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to update campaign');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Campaign Updated",
        description: "Campaign has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      resetForm();
      onOpenChange(false);
      onCampaignCreated?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      acquirer: '',
      equipment: '',
      currency: 'USD',
      pricingTypeId: null,
    });
    setFeeValues({});
    setSelectedEquipment([]);
    setErrors({});
    defaultsSetRef.current = false;
  };

  const handleEquipmentChange = (equipmentId: number, checked: boolean) => {
    setSelectedEquipment(prev => {
      if (checked) {
        return [...prev, equipmentId];
      } else {
        return prev.filter(id => id !== equipmentId);
      }
    });
  };

  // Handle pricing type selection
  const handlePricingTypeChange = (pricingTypeId: string) => {
    const id = pricingTypeId ? parseInt(pricingTypeId) : null;
    setFormData(prev => ({ ...prev, pricingTypeId: id }));
    // Clear existing fee values when changing pricing type
    setFeeValues({});
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Campaign name is required';
    } else if (formData.name.length > 50) {
      newErrors.name = 'Campaign name must be 50 characters or less';
    }
    
    if (formData.description && formData.description.length > 300) {
      newErrors.description = 'Description must be 300 characters or less';
    }
    
    if (!formData.pricingTypeId) {
      newErrors.pricingType = 'Pricing type is required';
    }
    
    if (!formData.acquirer) {
      newErrors.acquirer = 'Acquirer is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    const campaignData = {
      ...formData,
      pricingTypeId: formData.pricingTypeId,
      feeValues,
      selectedEquipment,
    };

    if (editCampaignId) {
      updateCampaignMutation.mutate(campaignData);
    } else {
      createCampaignMutation.mutate(campaignData);
    }
  };

  // Effect to populate form data when editing
  useEffect(() => {
    if (editCampaignData && open) {
      setFormData({
        name: editCampaignData.name,
        description: editCampaignData.description || '',
        acquirer: editCampaignData.acquirer,
        equipment: '',
        currency: 'USD',
        pricingTypeId: editCampaignData.pricingType?.id || null,
      });
      
      // Set fee values if available
      if (editCampaignData.feeValues) {
        const feeValueMap: Record<number, string> = {};
        editCampaignData.feeValues.forEach(fv => {
          feeValueMap[fv.feeItemId] = fv.value;
        });
        setFeeValues(feeValueMap);
      }
    } else if (!editCampaignData && open) {
      // Reset form when opening for creation
      resetForm();
    }
  }, [editCampaignData, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {editCampaignId ? 'Edit Campaign' : 'Create New Campaign'}
          </DialogTitle>
          <DialogDescription>
            {editCampaignId 
              ? 'Update this pricing campaign with custom fee structures for merchant applications'
              : 'Define a pricing campaign with custom fee structures for merchant applications'
            }
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Basic Campaign Information */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Campaign Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Campaign Name *</Label>
                    <Input
                      id="name"
                      placeholder="Enter campaign name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className={errors.name ? 'border-destructive' : ''}
                    />
                    {errors.name && (
                      <p className="text-sm text-destructive mt-1">{errors.name}</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="acquirer">Acquirer *</Label>
                    <Select value={formData.acquirer} onValueChange={(value) => setFormData(prev => ({ ...prev, acquirer: value }))}>
                      <SelectTrigger className={errors.acquirer ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Select acquirer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Esquire">Esquire</SelectItem>
                        <SelectItem value="Merrick">Merrick</SelectItem>
                        <SelectItem value="Wells Fargo">Wells Fargo</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.acquirer && (
                      <p className="text-sm text-destructive mt-1">{errors.acquirer}</p>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Enter campaign description (optional)"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className={errors.description ? 'border-destructive' : ''}
                  />
                  {errors.description && (
                    <p className="text-sm text-destructive mt-1">{errors.description}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    value={formData.currency}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Currently set to USD. Future enhancements will allow currency selection.
                  </p>
                </div>
                
                <div>
                  <Label htmlFor="pricingType">Pricing Type *</Label>
                  <Select value={formData.pricingTypeId?.toString() || ''} onValueChange={handlePricingTypeChange}>
                    <SelectTrigger className={errors.pricingType ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Select pricing type" />
                    </SelectTrigger>
                    <SelectContent>
                      {pricingTypes.map((pricingType) => (
                        <SelectItem key={pricingType.id} value={pricingType.id.toString()}>
                          {pricingType.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.pricingType && (
                    <p className="text-sm text-destructive mt-1">{errors.pricingType}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Fee Configuration */}
            {formData.pricingTypeId && selectedPricingTypeFeeGroups && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center">
                    <DollarSign className="h-4 w-4 mr-2" />
                    Fee Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure fee values for {selectedPricingTypeFeeGroups.pricingType.name} pricing type.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {feeGroupsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading fee items...
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {selectedPricingTypeFeeGroups.feeGroups.map((feeGroup: FeeGroup) => (
                        <div key={feeGroup.id} className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium text-sm">{feeGroup.name}</h4>
                            {feeGroup.description && (
                              <p className="text-xs text-muted-foreground">- {feeGroup.description}</p>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-4">
                            {feeGroup.feeItems.map((feeItem: FeeItem) => (
                              <div key={feeItem.id} className="space-y-2">
                                <Label htmlFor={`fee-${feeItem.id}`} className="text-xs">
                                  {feeItem.name}
                                  {feeItem.isRequired && <span className="text-destructive ml-1">*</span>}
                                </Label>
                                <div className="flex items-center space-x-2">
                                  <Input
                                    id={`fee-${feeItem.id}`}
                                    type="text"
                                    placeholder={feeItem.defaultValue || '0.00'}
                                    value={feeValues[feeItem.id] || ''}
                                    onChange={(e) => setFeeValues(prev => ({ ...prev, [feeItem.id]: e.target.value }))}
                                    className="text-sm"
                                  />
                                  <Badge variant="outline" className="text-xs">
                                    {feeItem.valueType === 'percentage' ? '%' : 
                                     feeItem.valueType === 'basis_points' ? 'bp' : '$'}
                                  </Badge>
                                </div>
                                {feeItem.description && (
                                  <p className="text-xs text-muted-foreground">{feeItem.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Equipment Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Equipment Selection</CardTitle>
                <CardDescription>
                  Select equipment items to include with this campaign.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {equipmentLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading equipment items...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {equipmentItems.map((item: EquipmentItem) => (
                      <div key={item.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`equipment-${item.id}`}
                          checked={selectedEquipment.includes(item.id)}
                          onCheckedChange={(checked) => handleEquipmentChange(item.id, checked as boolean)}
                        />
                        <Label htmlFor={`equipment-${item.id}`} className="text-sm cursor-pointer">
                          {item.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createCampaignMutation.isPending || updateCampaignMutation.isPending}
          >
            {(createCampaignMutation.isPending || updateCampaignMutation.isPending) 
              ? (editCampaignId ? 'Updating...' : 'Creating...') 
              : (editCampaignId ? 'Update Campaign' : 'Create Campaign')
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}