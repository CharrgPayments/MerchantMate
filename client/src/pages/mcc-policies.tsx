import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Shield, Search, Plus, Edit2, Trash2, 
  AlertTriangle, CheckCircle, XCircle, Filter
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

interface MccCode {
  id: number;
  code: string;
  description: string;
  category: string;
  defaultRiskLevel: string;
}

interface MccPolicy {
  id: number;
  mccCodeId: number;
  acquirerId: number | null;
  policyType: string;
  riskLevelOverride: string | null;
  notes: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  mccCode: MccCode;
}

const POLICY_TYPE_OPTIONS = [
  { value: 'allowed', label: 'Allowed', description: 'Standard processing allowed' },
  { value: 'requires_review', label: 'Requires Review', description: 'Manual review required' },
  { value: 'prohibited', label: 'Prohibited', description: 'Not allowed to process' },
  { value: 'high_risk', label: 'High Risk', description: 'Enhanced monitoring required' },
];

const RISK_LEVEL_OPTIONS = [
  { value: 'low', label: 'Low Risk', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  { value: 'medium', label: 'Medium Risk', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  { value: 'high', label: 'High Risk', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  { value: 'prohibited', label: 'Prohibited', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
];

const POLICY_TYPE_BADGES: Record<string, string> = {
  allowed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  requires_review: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  high_risk: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  prohibited: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function MccPoliciesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [policyTypeFilter, setPolicyTypeFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<MccPolicy | null>(null);
  const [selectedMccCode, setSelectedMccCode] = useState<MccCode | null>(null);
  
  const [formData, setFormData] = useState({
    mccCodeId: 0,
    policyType: 'allowed',
    riskLevelOverride: '',
    notes: '',
    isActive: true,
  });

  const queryFn = getQueryFn<any>({ on401: 'throw' });

  const { data: mccCodes = [], isLoading: loadingCodes } = useQuery<MccCode[]>({
    queryKey: ['/api/mcc-codes'],
    queryFn,
  });

  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['/api/mcc-codes/categories'],
    queryFn,
  });

  const { data: policies = [], isLoading: loadingPolicies } = useQuery<MccPolicy[]>({
    queryKey: ['/api/mcc-policies'],
    queryFn,
  });

  const createPolicyMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest('POST', '/api/mcc-policies', {
        ...data,
        riskLevelOverride: data.riskLevelOverride || null,
        notes: data.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-policies'] });
      setShowAddDialog(false);
      resetForm();
      toast({
        title: "Policy Created",
        description: "MCC policy has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create policy",
        variant: "destructive",
      });
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      return apiRequest('PATCH', `/api/mcc-policies/${id}`, {
        ...data,
        riskLevelOverride: data.riskLevelOverride || null,
        notes: data.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-policies'] });
      setShowEditDialog(false);
      setSelectedPolicy(null);
      resetForm();
      toast({
        title: "Policy Updated",
        description: "MCC policy has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update policy",
        variant: "destructive",
      });
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/mcc-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-policies'] });
      setShowDeleteDialog(false);
      setSelectedPolicy(null);
      toast({
        title: "Policy Deleted",
        description: "MCC policy has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete policy",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      mccCodeId: 0,
      policyType: 'allowed',
      riskLevelOverride: '',
      notes: '',
      isActive: true,
    });
    setSelectedMccCode(null);
  };

  const handleEdit = (policy: MccPolicy) => {
    setSelectedPolicy(policy);
    setSelectedMccCode(policy.mccCode);
    setFormData({
      mccCodeId: policy.mccCodeId,
      policyType: policy.policyType,
      riskLevelOverride: policy.riskLevelOverride || '',
      notes: policy.notes || '',
      isActive: policy.isActive,
    });
    setShowEditDialog(true);
  };

  const handleDelete = (policy: MccPolicy) => {
    setSelectedPolicy(policy);
    setShowDeleteDialog(true);
  };

  const handleSubmitCreate = () => {
    if (!formData.mccCodeId) {
      toast({
        title: "Validation Error",
        description: "Please select an MCC code",
        variant: "destructive",
      });
      return;
    }
    createPolicyMutation.mutate(formData);
  };

  const handleSubmitEdit = () => {
    if (!selectedPolicy) return;
    updatePolicyMutation.mutate({
      id: selectedPolicy.id,
      data: {
        policyType: formData.policyType,
        riskLevelOverride: formData.riskLevelOverride,
        notes: formData.notes,
        isActive: formData.isActive,
      },
    });
  };

  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const matchesSearch = 
        policy.mccCode.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        policy.mccCode.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || policy.mccCode.category === categoryFilter;
      const matchesPolicyType = policyTypeFilter === 'all' || policy.policyType === policyTypeFilter;
      
      return matchesSearch && matchesCategory && matchesPolicyType;
    });
  }, [policies, searchQuery, categoryFilter, policyTypeFilter]);

  const availableMccCodes = useMemo(() => {
    const existingCodeIds = new Set(policies.map(p => p.mccCodeId));
    return mccCodes.filter(code => !existingCodeIds.has(code.id));
  }, [mccCodes, policies]);

  const filteredAvailableCodes = useMemo(() => {
    if (!searchQuery) return availableMccCodes;
    return availableMccCodes.filter(code =>
      code.code.includes(searchQuery) ||
      code.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableMccCodes, searchQuery]);

  const getRiskLevelBadge = (riskLevel: string | null | undefined) => {
    if (!riskLevel) return null;
    const option = RISK_LEVEL_OPTIONS.find(o => o.value === riskLevel);
    return option ? (
      <Badge className={option.color}>{option.label}</Badge>
    ) : null;
  };

  const isLoading = loadingCodes || loadingPolicies;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            MCC Policy Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage merchant category code policies for underwriting decisions
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-policy">
          <Plus className="h-4 w-4 mr-2" />
          Add Policy
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search and filter MCC policies</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by MCC code or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={policyTypeFilter} onValueChange={setPolicyTypeFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-policy-type-filter">
                <SelectValue placeholder="All Policy Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Policy Types</SelectItem>
                {POLICY_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            MCC Policies
            <Badge variant="secondary" className="ml-2">
              {filteredPolicies.length} of {policies.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Configure how each merchant category code should be handled during underwriting
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredPolicies.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No policies found</h3>
              <p className="text-muted-foreground">
                {policies.length === 0 
                  ? "Create your first MCC policy to get started"
                  : "Try adjusting your search or filters"}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MCC Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Default Risk</TableHead>
                    <TableHead>Policy Type</TableHead>
                    <TableHead>Risk Override</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPolicies.map((policy) => (
                    <TableRow key={policy.id} data-testid={`row-policy-${policy.id}`}>
                      <TableCell className="font-mono font-semibold">
                        {policy.mccCode.code}
                      </TableCell>
                      <TableCell className="max-w-[250px] truncate">
                        {policy.mccCode.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{policy.mccCode.category}</Badge>
                      </TableCell>
                      <TableCell>
                        {getRiskLevelBadge(policy.mccCode.defaultRiskLevel)}
                      </TableCell>
                      <TableCell>
                        <Badge className={POLICY_TYPE_BADGES[policy.policyType] || ''}>
                          {POLICY_TYPE_OPTIONS.find(o => o.value === policy.policyType)?.label || policy.policyType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {policy.riskLevelOverride 
                          ? getRiskLevelBadge(policy.riskLevelOverride)
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        {policy.isActive ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                            <XCircle className="h-3 w-3 mr-1" />
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(policy)}
                            data-testid={`button-edit-${policy.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(policy)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-${policy.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add MCC Policy</DialogTitle>
            <DialogDescription>
              Create a new policy for a merchant category code
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>MCC Code</Label>
              <Select
                value={formData.mccCodeId?.toString() || ''}
                onValueChange={(val) => {
                  const code = mccCodes.find(c => c.id === parseInt(val));
                  setFormData({ ...formData, mccCodeId: parseInt(val) });
                  setSelectedMccCode(code || null);
                }}
              >
                <SelectTrigger data-testid="select-mcc-code">
                  <SelectValue placeholder="Select an MCC code" />
                </SelectTrigger>
                <SelectContent>
                  {availableMccCodes.map((code) => (
                    <SelectItem key={code.id} value={code.id.toString()}>
                      <span className="font-mono">{code.code}</span> - {code.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMccCode && (
                <div className="text-sm text-muted-foreground mt-1">
                  Category: {selectedMccCode.category} | 
                  Default Risk: {selectedMccCode.defaultRiskLevel}
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <Label>Policy Type</Label>
              <Select
                value={formData.policyType}
                onValueChange={(val) => setFormData({ ...formData, policyType: val })}
              >
                <SelectTrigger data-testid="select-policy-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Risk Level Override (Optional)</Label>
              <Select
                value={formData.riskLevelOverride || "none"}
                onValueChange={(val) => setFormData({ ...formData, riskLevelOverride: val === "none" ? "" : val })}
              >
                <SelectTrigger data-testid="select-risk-override">
                  <SelectValue placeholder="Use default risk level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use default risk level</SelectItem>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                placeholder="Add any notes about this policy..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitCreate} 
              disabled={createPolicyMutation.isPending}
              data-testid="button-submit-create"
            >
              {createPolicyMutation.isPending ? 'Creating...' : 'Create Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit MCC Policy</DialogTitle>
            <DialogDescription>
              Update policy for MCC {selectedPolicy?.mccCode.code}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedMccCode && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="font-semibold font-mono">{selectedMccCode.code}</div>
                <div className="text-sm">{selectedMccCode.description}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Category: {selectedMccCode.category} | 
                  Default Risk: {selectedMccCode.defaultRiskLevel}
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Policy Type</Label>
              <Select
                value={formData.policyType}
                onValueChange={(val) => setFormData({ ...formData, policyType: val })}
              >
                <SelectTrigger data-testid="select-edit-policy-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Risk Level Override (Optional)</Label>
              <Select
                value={formData.riskLevelOverride || "none"}
                onValueChange={(val) => setFormData({ ...formData, riskLevelOverride: val === "none" ? "" : val })}
              >
                <SelectTrigger data-testid="select-edit-risk-override">
                  <SelectValue placeholder="Use default risk level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use default risk level</SelectItem>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                placeholder="Add any notes about this policy..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                data-testid="input-edit-notes"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Policy Active</Label>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-is-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditDialog(false); setSelectedPolicy(null); resetForm(); }}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitEdit} 
              disabled={updatePolicyMutation.isPending}
              data-testid="button-submit-edit"
            >
              {updatePolicyMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete MCC Policy
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the policy for MCC code{' '}
              <span className="font-mono font-semibold">{selectedPolicy?.mccCode.code}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selectedPolicy && deletePolicyMutation.mutate(selectedPolicy.id)}
              data-testid="button-confirm-delete"
            >
              {deletePolicyMutation.isPending ? 'Deleting...' : 'Delete Policy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
