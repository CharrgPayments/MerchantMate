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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DollarSign, Building2, FileText } from 'lucide-react';
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

interface Acquirer {
  id: number;
  name: string;
  displayName: string;
  code: string;
  isActive: boolean;
}

interface AcquirerTemplate {
  id: number;
  acquirerId: number;
  templateName: string;
  version: string;
  isActive: boolean;
  acquirer?: Acquirer;
}

interface EquipmentItem {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
}

interface Campaign {
  id: number;
  name: string;
  description?: string;
  acquirer: string;
  pricingType: { id: number; name: string };
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  feeValues?: { feeItemId: number; value: string }[];
  applicationTemplates?: {
    id: number;
    isPrimary: boolean;
    template: { id: number; templateName: string; version: string } | null;
    acquirer: { id: number; name: string; displayName: string } | null;
  }[];
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
  editCampaignData,
}: EnhancedCampaignDialogProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    acquirer: '',
    currency: 'USD',
    pricingTypeId: null as number | null,
  });

  const [acquirerId, setAcquirerId] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [feeValues, setFeeValues] = useState<Record<number, string>>({});
  const [selectedEquipment, setSelectedEquipment] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initDoneRef = useRef(false);

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: pricingTypes = [] } = useQuery<any[]>({
    queryKey: ['/api/pricing-types'],
    queryFn: async () => {
      const r = await fetch('/api/pricing-types', { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch pricing types');
      return r.json();
    },
    staleTime: 30000,
  });

  const { data: acquirers = [] } = useQuery<Acquirer[]>({
    queryKey: ['/api/acquirers'],
    queryFn: async () => {
      const r = await fetch('/api/acquirers', { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch acquirers');
      return r.json();
    },
    staleTime: 30000,
  });

  const { data: allTemplates = [] } = useQuery<AcquirerTemplate[]>({
    queryKey: ['/api/acquirer-application-templates'],
    queryFn: async () => {
      const r = await fetch('/api/acquirer-application-templates', { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch templates');
      return r.json();
    },
    staleTime: 30000,
  });

  // Templates filtered to selected acquirer
  const acquirerTemplates = acquirerId
    ? allTemplates.filter(t => t.acquirerId === acquirerId && t.isActive !== false)
    : [];

  // Fee groups for selected pricing type
  const { data: selectedPricingTypeFeeGroups, isLoading: feeGroupsLoading } = useQuery({
    queryKey: ['/api/pricing-types', formData.pricingTypeId, 'fee-groups'],
    queryFn: async () => {
      const r = await fetch(`/api/pricing-types/${formData.pricingTypeId}/fee-groups`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch fee groups');
      return r.json();
    },
    enabled: !!formData.pricingTypeId,
  });

  // Equipment items
  const { data: equipmentItems = [] } = useQuery<EquipmentItem[]>({
    queryKey: ['/api/equipment-items'],
    queryFn: async () => {
      const r = await fetch('/api/equipment-items', { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch equipment');
      return r.json();
    },
    staleTime: 30000,
  });

  // Full campaign detail when editing (to get applicationTemplates)
  const { data: fullCampaign } = useQuery<Campaign>({
    queryKey: ['/api/campaigns', editCampaignId, 'detail'],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${editCampaignId}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch campaign detail');
      return r.json();
    },
    enabled: !!editCampaignId && open,
    staleTime: 0,
  });

  // ── Form initialisation when opening ─────────────────────────────────────

  const resetForm = () => {
    setFormData({ name: '', description: '', acquirer: '', currency: 'USD', pricingTypeId: null });
    setAcquirerId(null);
    setTemplateId(null);
    setFeeValues({});
    setSelectedEquipment([]);
    setErrors({});
    initDoneRef.current = false;
  };

  // Populate from edit data
  useEffect(() => {
    if (!open) { initDoneRef.current = false; return; }
    if (!editCampaignId) { resetForm(); return; }

    const data = fullCampaign ?? editCampaignData;
    if (!data || initDoneRef.current) return;

    setFormData({
      name: data.name,
      description: data.description || '',
      acquirer: data.acquirer || '',
      currency: 'USD',
      pricingTypeId: data.pricingType?.id || null,
    });

    if (data.feeValues) {
      const map: Record<number, string> = {};
      data.feeValues.forEach(fv => { map[fv.feeItemId] = fv.value; });
      setFeeValues(map);
    }

    // Restore acquirer + template from applicationTemplates
    const primaryTpl = (data.applicationTemplates ?? []).find(t => t.isPrimary)
      ?? (data.applicationTemplates ?? [])[0]
      ?? null;
    if (primaryTpl) {
      if (primaryTpl.acquirer?.id) setAcquirerId(primaryTpl.acquirer.id);
      if (primaryTpl.template?.id) setTemplateId(primaryTpl.template.id);
    }

    initDoneRef.current = true;
  }, [open, editCampaignId, fullCampaign, editCampaignData]);

  // Clear template when acquirer changes
  const handleAcquirerChange = (val: string) => {
    const id = parseInt(val);
    setAcquirerId(id);
    setTemplateId(null);
    const acq = acquirers.find(a => a.id === id);
    setFormData(prev => ({ ...prev, acquirer: acq?.displayName || acq?.name || '' }));
  };

  const handlePricingTypeChange = (val: string) => {
    setFormData(prev => ({ ...prev, pricingTypeId: val ? parseInt(val) : null }));
    setFeeValues({});
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Campaign name is required';
    else if (formData.name.length > 50) errs.name = 'Campaign name must be 50 characters or less';
    if (formData.description && formData.description.length > 300) errs.description = 'Description must be 300 characters or less';
    if (!formData.pricingTypeId) errs.pricingType = 'Pricing type is required';
    if (!acquirerId) errs.acquirer = 'Acquirer is required';
    if (!templateId) errs.template = 'Application template is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text() || 'Failed to create campaign');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Campaign Created', description: 'Campaign has been created successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      resetForm();
      onOpenChange(false);
      onCampaignCreated?.();
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: any) => {
      const r = await fetch(`/api/campaigns/${editCampaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text() || 'Failed to update campaign');
      return r.json();
    },
    onSuccess: async () => {
      toast({ title: 'Campaign Updated', description: 'Campaign has been updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns', String(editCampaignId)] });

      // Epic D — offer to regenerate filled PDFs for affected applications
      try {
        const r = await fetch(`/api/campaigns/${editCampaignId}/affected-applications`, { credentials: 'include' });
        if (r.ok) {
          const { count } = await r.json();
          if (count > 0 && window.confirm(`${count} application(s) use this campaign. Regenerate their filled PDFs now?`)) {
            const regen = await fetch(`/api/campaigns/${editCampaignId}/regenerate-pdfs`, {
              method: 'POST',
              credentials: 'include',
            });
            if (regen.ok) {
              const result = await regen.json();
              toast({
                title: 'PDFs Regenerated',
                description: `${result.succeeded}/${result.total} succeeded${result.failed ? `, ${result.failed} failed` : ''}.`,
              });
            }
          }
        }
      } catch (err) {
        console.error('Affected-applications check failed:', err);
      }

      resetForm();
      onOpenChange(false);
      onCampaignCreated?.();
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!validateForm()) return;
    const body = {
      ...formData,
      templateId,
      feeValues,
      selectedEquipment,
    };
    if (editCampaignId) updateMutation.mutate(body);
    else createMutation.mutate(body);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{editCampaignId ? 'Edit Campaign' : 'Create New Campaign'}</DialogTitle>
          <DialogDescription>
            {editCampaignId
              ? 'Update this pricing campaign with its acquirer association and fee structure'
              : 'Define a pricing campaign, assign an acquirer and application template, and configure fees'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">

            {/* ── Campaign Information ── */}
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
                    {errors.name && <p className="text-sm text-destructive mt-1">{errors.name}</p>}
                  </div>
                  <div>
                    <Label htmlFor="currency">Currency</Label>
                    <Input id="currency" value={formData.currency} disabled className="bg-muted" />
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
                  {errors.description && <p className="text-sm text-destructive mt-1">{errors.description}</p>}
                </div>

                <div>
                  <Label htmlFor="pricingType">Pricing Type *</Label>
                  <Select value={formData.pricingTypeId?.toString() || ''} onValueChange={handlePricingTypeChange}>
                    <SelectTrigger className={errors.pricingType ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Select pricing type" />
                    </SelectTrigger>
                    <SelectContent>
                      {pricingTypes.map((pt: any) => (
                        <SelectItem key={pt.id} value={pt.id.toString()}>{pt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.pricingType && <p className="text-sm text-destructive mt-1">{errors.pricingType}</p>}
                </div>
              </CardContent>
            </Card>

            {/* ── Acquirer & Application Template ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Acquirer &amp; Application Template
                </CardTitle>
                <CardDescription>
                  Select the acquirer and the application template that will be used for merchant applications under this campaign.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Acquirer *</Label>
                    <Select
                      value={acquirerId?.toString() || ''}
                      onValueChange={handleAcquirerChange}
                    >
                      <SelectTrigger className={errors.acquirer ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Select acquirer" />
                      </SelectTrigger>
                      <SelectContent>
                        {acquirers.filter(a => a.isActive !== false).map(a => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            {a.displayName || a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.acquirer && <p className="text-sm text-destructive mt-1">{errors.acquirer}</p>}
                  </div>

                  <div>
                    <Label>Application Template *</Label>
                    <Select
                      value={templateId?.toString() || ''}
                      onValueChange={(v) => setTemplateId(parseInt(v))}
                      disabled={!acquirerId}
                    >
                      <SelectTrigger className={errors.template ? 'border-destructive' : ''}>
                        <SelectValue placeholder={acquirerId ? 'Select template' : 'Select acquirer first'} />
                      </SelectTrigger>
                      <SelectContent>
                        {acquirerTemplates.map(t => (
                          <SelectItem key={t.id} value={t.id.toString()}>
                            <span className="flex items-center gap-2">
                              <FileText className="h-3 w-3 shrink-0" />
                              {t.templateName}
                              <Badge variant="outline" className="text-xs ml-1">v{t.version}</Badge>
                            </span>
                          </SelectItem>
                        ))}
                        {acquirerId && acquirerTemplates.length === 0 && (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            No active templates for this acquirer
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                    {errors.template && <p className="text-sm text-destructive mt-1">{errors.template}</p>}
                  </div>
                </div>

                {templateId && acquirerId && (
                  <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <span className="font-medium">
                        {acquirers.find(a => a.id === acquirerId)?.displayName}
                      </span>
                      {' — '}
                      <span>{allTemplates.find(t => t.id === templateId)?.templateName}</span>
                      <Badge variant="outline" className="ml-2 text-xs">
                        v{allTemplates.find(t => t.id === templateId)?.version}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Fee Configuration ── */}
            {formData.pricingTypeId && selectedPricingTypeFeeGroups && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Fee Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure fee values for the {selectedPricingTypeFeeGroups.pricingType?.name} pricing type.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {feeGroupsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading fee items…</div>
                  ) : (
                    <div className="space-y-6">
                      {selectedPricingTypeFeeGroups.feeGroups?.map((feeGroup: FeeGroup) => (
                        <div key={feeGroup.id} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm">{feeGroup.name}</h4>
                            {feeGroup.description && (
                              <p className="text-xs text-muted-foreground">— {feeGroup.description}</p>
                            )}
                          </div>
                          <Separator />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2">
                            {feeGroup.feeItems?.map((feeItem: FeeItem) => (
                              <div key={feeItem.id} className="space-y-1">
                                <Label htmlFor={`fee-${feeItem.id}`} className="text-xs">
                                  {feeItem.name}
                                  {feeItem.isRequired && <span className="text-destructive ml-1">*</span>}
                                </Label>
                                <div className="flex items-center gap-2">
                                  <Input
                                    id={`fee-${feeItem.id}`}
                                    type="text"
                                    placeholder={feeItem.defaultValue || '0.00'}
                                    value={feeValues[feeItem.id] || ''}
                                    onChange={(e) => setFeeValues(prev => ({ ...prev, [feeItem.id]: e.target.value }))}
                                    className="text-sm"
                                  />
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    {feeItem.valueType === 'percentage' ? '%' : feeItem.valueType === 'basis_points' ? 'bp' : '$'}
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

            {/* ── Equipment ── */}
            {equipmentItems.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Equipment Selection</CardTitle>
                  <CardDescription>Select equipment items to include with this campaign.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {equipmentItems.map((item: EquipmentItem) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`equipment-${item.id}`}
                          checked={selectedEquipment.includes(item.id)}
                          onCheckedChange={(checked) => {
                            setSelectedEquipment(prev =>
                              checked ? [...prev, item.id] : prev.filter(id => id !== item.id)
                            );
                          }}
                        />
                        <Label htmlFor={`equipment-${item.id}`} className="text-sm cursor-pointer">
                          {item.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending
              ? (editCampaignId ? 'Updating…' : 'Creating…')
              : (editCampaignId ? 'Update Campaign' : 'Create Campaign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
