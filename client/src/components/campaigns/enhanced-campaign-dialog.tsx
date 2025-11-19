import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, AlertCircle, HelpCircle, Package } from 'lucide-react';
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

interface ApplicationTemplate {
  id: number;
  templateName: string;
  version: string;
  acquirerId: number;
  isActive: boolean;
}

interface Campaign {
  id: number;
  name: string;
  description?: string;
  acquirerId: number;
  acquirer: {
    id: number;
    name: string;
    displayName: string;
    code: string;
    description?: string;
    isActive: boolean;
  };
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
    acquirerId: null as number | null,
    equipment: '',
    currency: 'USD',
    pricingTypeId: null as number | null,
  });
  
  const [feeValues, setFeeValues] = useState<Record<number, string>>({});
  const [selectedEquipment, setSelectedEquipment] = useState<number[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);
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

  // Get acquirers for dropdown
  const { data: acquirers = [], isLoading: acquirersLoading } = useQuery({
    queryKey: ['/api/acquirers'],
    queryFn: async () => {
      const response = await fetch('/api/acquirers', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch acquirers');
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

  // Get application templates for selected acquirer
  const { data: applicationTemplates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['/api/acquirer-application-templates', formData.acquirerId],
    queryFn: async () => {
      if (!formData.acquirerId) return [];
      const response = await fetch('/api/acquirer-application-templates', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch templates');
      const allTemplates = await response.json();
      // Filter by acquirer
      return allTemplates.filter((t: ApplicationTemplate) => t.acquirerId === formData.acquirerId && t.isActive);
    },
    enabled: !!formData.acquirerId,
  });

  // Fetch existing campaign templates when editing
  const { data: campaignTemplates = [] } = useQuery<{ id: number; templateId: number }[]>({
    queryKey: ['/api/campaigns', editCampaignId, 'templates'],
    queryFn: async () => {
      if (!editCampaignId) return [];
      const response = await fetch(`/api/campaigns/${editCampaignId}/templates`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch campaign templates');
      return response.json();
    },
    enabled: !!editCampaignId && open,
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
      acquirerId: null,
      equipment: '',
      currency: 'USD',
      pricingTypeId: null,
    });
    setFeeValues({});
    setSelectedEquipment([]);
    setSelectedTemplates([]);
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

  const handleTemplateChange = (templateId: number, checked: boolean) => {
    setSelectedTemplates(prev => {
      if (checked) {
        return [...prev, templateId];
      } else {
        return prev.filter(id => id !== templateId);
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
    
    if (!formData.acquirerId) {
      newErrors.acquirer = 'Acquirer is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    // Transform feeValues object to array format expected by backend
    const feeValuesArray = Object.entries(feeValues)
      .filter(([_, value]) => value && value.trim() !== '') // Only include non-empty values
      .map(([feeItemId, value]) => ({
        feeItemId: parseInt(feeItemId),
        value: value.trim(),
        valueType: "percentage" // Default to percentage, can be enhanced later
      }));

    const campaignData = {
      ...formData,
      pricingTypeId: formData.pricingTypeId,
      feeValues: feeValuesArray,
      equipmentIds: selectedEquipment, // Backend expects 'equipmentIds', not 'selectedEquipment'
      templateIds: selectedTemplates, // Backend expects 'templateIds'
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
        acquirerId: editCampaignData.acquirer?.id || editCampaignData.acquirerId || null,
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
      
      // Set selected equipment if available
      if (editCampaignData.equipmentAssociations) {
        const equipmentIds = editCampaignData.equipmentAssociations.map(assoc => assoc.equipmentItem.id);
        setSelectedEquipment(equipmentIds);
      }
    } else if (!editCampaignData && open) {
      // Reset form when opening for creation
      resetForm();
    }
  }, [editCampaignData, open]);

  // Separate effect to load campaign templates when editing
  useEffect(() => {
    if (editCampaignId && campaignTemplates && open) {
      const templateIds = campaignTemplates.map(ct => ct.templateId);
      setSelectedTemplates(templateIds);
    }
  }, [campaignTemplates, editCampaignId, open]);

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
                  <Label htmlFor="acquirer">Acquirer *</Label>
                  <Select value={formData.acquirerId?.toString() || ''} onValueChange={(value) => setFormData(prev => ({ ...prev, acquirerId: parseInt(value) }))}>
                    <SelectTrigger className={errors.acquirer ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Select acquirer" />
                    </SelectTrigger>
                    <SelectContent>
                      {acquirers.map((acquirer) => (
                        <SelectItem key={acquirer.id} value={acquirer.id.toString()}>
                          {acquirer.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.acquirer && (
                    <p className="text-sm text-destructive mt-1">{errors.acquirer}</p>
                  )}
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
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center">
                        <DollarSign className="h-4 w-4 mr-2" />
                        Fee Configuration
                      </CardTitle>
                      <CardDescription>
                        Configure fee values for {selectedPricingTypeFeeGroups.pricingType.name} pricing type.
                      </CardDescription>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 h-8"
                          data-testid="button-fee-config-help"
                        >
                          <HelpCircle className="h-4 w-4" />
                          <span className="text-xs">Help</span>
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Fee Configuration Guide</DialogTitle>
                          <DialogDescription>
                            Learn how to configure fees for your campaign based on the selected pricing type.
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4 text-sm">
                          <div>
                            <h3 className="font-semibold text-base mb-2">Understanding Fee Configuration</h3>
                            <p className="text-muted-foreground">
                              Fees are organized into groups (e.g., "Transaction Fees", "Monthly Fees"). Each group contains specific fee items that define the pricing structure for your campaign.
                            </p>
                          </div>

                          <div className="space-y-3">
                            <h3 className="font-semibold">Fee Value Types</h3>
                            
                            <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
                              <h4 className="font-medium text-blue-900 mb-1">Percentage Fees</h4>
                              <p className="text-sm text-blue-800">
                                Enter values like <code className="bg-blue-100 px-1 py-0.5 rounded">2.50</code> for 2.50%. Used for transaction fees that scale with amount (e.g., 2.5% per transaction).
                              </p>
                            </div>

                            <div className="bg-green-50 p-3 rounded-md border border-green-200">
                              <h4 className="font-medium text-green-900 mb-1">Fixed Fees</h4>
                              <p className="text-sm text-green-800">
                                Enter dollar amounts like <code className="bg-green-100 px-1 py-0.5 rounded">25.00</code> for $25. Used for flat fees (e.g., $25 monthly gateway fee).
                              </p>
                            </div>

                            <div className="bg-purple-50 p-3 rounded-md border border-purple-200">
                              <h4 className="font-medium text-purple-900 mb-1">Basis Points</h4>
                              <p className="text-sm text-purple-800">
                                Enter values like <code className="bg-purple-100 px-1 py-0.5 rounded">250</code> for 2.50% (250 basis points). Used in financial calculations where 100 basis points = 1%.
                              </p>
                            </div>
                          </div>

                          <div>
                            <h3 className="font-semibold mb-2">Required vs Optional Fees</h3>
                            <p className="text-muted-foreground">
                              Fees marked with a red asterisk (<span className="text-destructive">*</span>) are required. The system will prevent you from creating a campaign without values for required fees.
                            </p>
                          </div>

                          <div>
                            <h3 className="font-semibold mb-2">Best Practices</h3>
                            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                              <li>Review the default values - they may be pre-filled based on your pricing type</li>
                              <li>Double-check percentage vs fixed fee values to avoid pricing errors</li>
                              <li>Optional fees can be left empty if not applicable to this campaign</li>
                              <li>Fee configurations apply to all merchants enrolled in this campaign</li>
                            </ul>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
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

            {/* Application Template Selection */}
            {formData.acquirerId && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Application Templates</CardTitle>
                  <CardDescription>
                    Select application templates for this campaign (e.g., for amendments and different use cases).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {templatesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading templates...
                    </div>
                  ) : applicationTemplates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No templates available for this acquirer. Please create templates first.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {applicationTemplates.map((template: ApplicationTemplate) => (
                        <div key={template.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`template-${template.id}`}
                            checked={selectedTemplates.includes(template.id)}
                            onCheckedChange={(checked) => handleTemplateChange(template.id, checked as boolean)}
                            data-testid={`checkbox-template-${template.id}`}
                          />
                          <Label htmlFor={`template-${template.id}`} className="text-sm cursor-pointer">
                            {template.templateName} <Badge variant="outline" className="ml-1 text-xs">v{template.version}</Badge>
                          </Label>
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
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center">
                      <Package className="h-4 w-4 mr-2" />
                      Equipment Selection
                    </CardTitle>
                    <CardDescription>
                      Select equipment items to include with this campaign.
                    </CardDescription>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 h-8"
                        data-testid="button-equipment-help"
                      >
                        <HelpCircle className="h-4 w-4" />
                        <span className="text-xs">Help</span>
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Equipment Selection Guide</DialogTitle>
                        <DialogDescription>
                          Learn how to select and configure equipment for your campaign.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="space-y-4 text-sm">
                        <div>
                          <h3 className="font-semibold text-base mb-2">What is Equipment Selection?</h3>
                          <p className="text-muted-foreground">
                            Equipment items are physical hardware (e.g., card readers, terminals, PIN pads) that merchants receive as part of their campaign enrollment. Selecting equipment here determines which devices are available to merchants in this campaign.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold">How to Select Equipment</h3>
                          
                          <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
                            <h4 className="font-medium text-blue-900 mb-1 flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</span>
                              Browse Available Equipment
                            </h4>
                            <p className="text-sm text-blue-800 ml-8">
                              Review the list of equipment items. Each item shows its name, description, and specifications.
                            </p>
                          </div>

                          <div className="bg-green-50 p-3 rounded-md border border-green-200">
                            <h4 className="font-medium text-green-900 mb-1 flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">2</span>
                              Check Equipment Boxes
                            </h4>
                            <p className="text-sm text-green-800 ml-8">
                              Click the checkbox next to each equipment item you want to include in this campaign. You can select multiple items.
                            </p>
                          </div>

                          <div className="bg-purple-50 p-3 rounded-md border border-purple-200">
                            <h4 className="font-medium text-purple-900 mb-1 flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">3</span>
                              Review Your Selection
                            </h4>
                            <p className="text-sm text-purple-800 ml-8">
                              Selected equipment items will be highlighted. Merchants enrolling in this campaign can choose from these devices.
                            </p>
                          </div>
                        </div>

                        <div>
                          <h3 className="font-semibold mb-2">Equipment vs Fees</h3>
                          <p className="text-muted-foreground mb-2">
                            Equipment selection is separate from fee configuration. Equipment costs may be:
                          </p>
                          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                            <li><strong>Included in fees:</strong> Equipment cost is part of the monthly or setup fee</li>
                            <li><strong>Separate charge:</strong> Equipment billed separately from processing fees</li>
                            <li><strong>Free with contract:</strong> Equipment provided at no cost with commitment</li>
                          </ul>
                        </div>

                        <div>
                          <h3 className="font-semibold mb-2">Best Practices</h3>
                          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                            <li>Select equipment that matches your target merchant type (retail, mobile, e-commerce)</li>
                            <li>Ensure selected equipment is compatible with the chosen acquirer/processor</li>
                            <li>Consider offering multiple device options to accommodate different merchant needs</li>
                            <li>Keep equipment selection up-to-date as new devices become available</li>
                          </ul>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
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