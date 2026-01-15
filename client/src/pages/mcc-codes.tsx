import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CreditCard, Search, Plus, Edit2, Trash2, 
  AlertTriangle, CheckCircle, Filter
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

interface MccCode {
  id: number;
  code: string;
  description: string;
  category: string;
  riskLevel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const RISK_LEVEL_OPTIONS = [
  { value: 'low', label: 'Low Risk', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  { value: 'medium', label: 'Medium Risk', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  { value: 'high', label: 'High Risk', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
];

const RISK_LEVEL_BADGES: Record<string, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

export default function MccCodesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [riskLevelFilter, setRiskLevelFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCode, setSelectedCode] = useState<MccCode | null>(null);
  
  const [formData, setFormData] = useState({
    code: '',
    description: '',
    category: '',
    riskLevel: 'low',
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

  const createCodeMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest('POST', '/api/mcc-codes', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes/categories'] });
      setShowAddDialog(false);
      resetForm();
      toast({
        title: "MCC Code Created",
        description: "The MCC code has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create MCC code",
        variant: "destructive",
      });
    },
  });

  const updateCodeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      return apiRequest('PATCH', `/api/mcc-codes/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes/categories'] });
      setShowEditDialog(false);
      setSelectedCode(null);
      resetForm();
      toast({
        title: "MCC Code Updated",
        description: "The MCC code has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update MCC code",
        variant: "destructive",
      });
    },
  });

  const deleteCodeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/mcc-codes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mcc-codes/categories'] });
      setShowDeleteDialog(false);
      setSelectedCode(null);
      toast({
        title: "MCC Code Deleted",
        description: "The MCC code has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete MCC code",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      code: '',
      description: '',
      category: '',
      riskLevel: 'low',
      isActive: true,
    });
  };

  const handleOpenAdd = () => {
    resetForm();
    setShowAddDialog(true);
  };

  const handleOpenEdit = (mccCode: MccCode) => {
    setSelectedCode(mccCode);
    setFormData({
      code: mccCode.code,
      description: mccCode.description,
      category: mccCode.category,
      riskLevel: mccCode.riskLevel,
      isActive: mccCode.isActive,
    });
    setShowEditDialog(true);
  };

  const handleOpenDelete = (mccCode: MccCode) => {
    setSelectedCode(mccCode);
    setShowDeleteDialog(true);
  };

  const handleCreate = () => {
    if (!formData.code || !formData.description || !formData.category) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }
    createCodeMutation.mutate(formData);
  };

  const handleUpdate = () => {
    if (!selectedCode) return;
    if (!formData.description || !formData.category) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }
    updateCodeMutation.mutate({ id: selectedCode.id, data: formData });
  };

  const handleDelete = () => {
    if (!selectedCode) return;
    deleteCodeMutation.mutate(selectedCode.id);
  };

  const filteredCodes = useMemo(() => {
    return mccCodes.filter((mccCode) => {
      const matchesSearch = 
        searchQuery === '' || 
        mccCode.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mccCode.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = 
        categoryFilter === 'all' || 
        mccCode.category === categoryFilter;
      
      const matchesRiskLevel = 
        riskLevelFilter === 'all' || 
        mccCode.riskLevel === riskLevelFilter;
      
      return matchesSearch && matchesCategory && matchesRiskLevel;
    });
  }, [mccCodes, searchQuery, categoryFilter, riskLevelFilter]);

  const stats = useMemo(() => {
    const total = mccCodes.length;
    const active = mccCodes.filter(c => c.isActive).length;
    const lowRisk = mccCodes.filter(c => c.riskLevel === 'low').length;
    const highRisk = mccCodes.filter(c => c.riskLevel === 'high').length;
    return { total, active, lowRisk, highRisk };
  }, [mccCodes]);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CreditCard className="h-8 w-8" />
            MCC Codes Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage Merchant Category Codes used in underwriting decisions
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add MCC Code
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low Risk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.lowRisk}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">High Risk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.highRisk}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>MCC Codes</CardTitle>
          <CardDescription>
            Browse and manage all merchant category codes
          </CardDescription>
          <div className="flex flex-wrap gap-4 mt-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by code or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by category" />
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
            <Select value={riskLevelFilter} onValueChange={setRiskLevelFilter}>
              <SelectTrigger className="w-[180px]">
                <AlertTriangle className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                {RISK_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCodes ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredCodes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {mccCodes.length === 0 
                ? "No MCC codes found. Click 'Add MCC Code' to create one."
                : "No MCC codes match your search criteria."
              }
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCodes.map((mccCode) => (
                    <TableRow key={mccCode.id}>
                      <TableCell className="font-mono font-medium">{mccCode.code}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{mccCode.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{mccCode.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={RISK_LEVEL_BADGES[mccCode.riskLevel] || 'bg-gray-100 text-gray-800'}>
                          {mccCode.riskLevel.charAt(0).toUpperCase() + mccCode.riskLevel.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {mccCode.isActive ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(mccCode)}
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenDelete(mccCode)}
                            className="text-destructive hover:text-destructive"
                            title="Delete"
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
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add MCC Code</DialogTitle>
            <DialogDescription>
              Create a new Merchant Category Code for underwriting.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">MCC Code *</Label>
              <Input
                id="code"
                placeholder="0000"
                maxLength={4}
                value={formData.code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setFormData({ ...formData, code: value });
                }}
              />
              <p className="text-xs text-muted-foreground">4-digit numeric code</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                placeholder="Enter description..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">Category *</Label>
              <Input
                id="category"
                placeholder="Enter category (e.g., Retail, Services)"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="riskLevel">Risk Level</Label>
              <Select
                value={formData.riskLevel}
                onValueChange={(value) => setFormData({ ...formData, riskLevel: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Active</Label>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createCodeMutation.isPending}>
              {createCodeMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit MCC Code</DialogTitle>
            <DialogDescription>
              Update the MCC code details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-code">MCC Code *</Label>
              <Input
                id="edit-code"
                placeholder="0000"
                maxLength={4}
                value={formData.code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setFormData({ ...formData, code: value });
                }}
              />
              <p className="text-xs text-muted-foreground">4-digit numeric code</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description *</Label>
              <Input
                id="edit-description"
                placeholder="Enter description..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-category">Category *</Label>
              <Input
                id="edit-category"
                placeholder="Enter category (e.g., Retail, Services)"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                list="edit-category-suggestions"
              />
              <datalist id="edit-category-suggestions">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-riskLevel">Risk Level</Label>
              <Select
                value={formData.riskLevel}
                onValueChange={(value) => setFormData({ ...formData, riskLevel: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-isActive">Active</Label>
              <Switch
                id="edit-isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateCodeMutation.isPending}>
              {updateCodeMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCC Code</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete MCC code <strong>{selectedCode?.code}</strong>?
              This action cannot be undone. If there are policies associated with this code,
              you will need to delete them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCodeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
