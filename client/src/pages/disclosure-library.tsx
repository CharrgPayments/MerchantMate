import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  FileText, Search, Plus, Edit2, Trash2, History,
  Eye, CheckCircle2, Clock, ChevronRight, ScrollText
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WysiwygEditor } from "@/components/WysiwygEditor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

interface DisclosureVersion {
  id: number;
  definitionId: number;
  version: string;
  title: string;
  content: string;
  contentHash: string;
  effectiveDate: string;
  retiredDate: string | null;
  requiresSignature: boolean;
  isCurrentVersion: boolean;
  createdBy: string | null;
  createdAt: string;
}

interface DisclosureDefinition {
  id: number;
  slug: string;
  displayName: string;
  description: string | null;
  category: string;
  requiresSignature: boolean;
  isActive: boolean;
  companyId: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  currentVersion?: DisclosureVersion;
  versions?: DisclosureVersion[];
  signatureCount?: number;
}

interface DisclosureSignature {
  id: number;
  disclosureVersionId: number;
  prospectId: number | null;
  userId: string | null;
  signerName: string;
  signerEmail: string | null;
  signatureType: string;
  signedAt: string;
  scrollDurationMs: number | null;
}

interface SignatureReport {
  version: DisclosureVersion;
  signatures: DisclosureSignature[];
  signatureCount: number;
}

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'legal', label: 'Legal' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'fee', label: 'Fee Disclosure' },
  { value: 'agreement', label: 'Agreement' },
];

const CATEGORY_BADGES: Record<string, string> = {
  general: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  legal: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  terms: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  privacy: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  compliance: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  fee: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  agreement: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
};

export default function DisclosureLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVersionDialog, setShowVersionDialog] = useState(false);
  const [showVersionsPanel, setShowVersionsPanel] = useState(false);
  const [showSignaturesDialog, setShowSignaturesDialog] = useState(false);
  const [showEditVersionDialog, setShowEditVersionDialog] = useState(false);
  const [selectedDisclosure, setSelectedDisclosure] = useState<DisclosureDefinition | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DisclosureVersion | null>(null);
  const [editVersionFormData, setEditVersionFormData] = useState({
    version: '',
    title: '',
    content: '',
  });
  
  const [formData, setFormData] = useState({
    slug: '',
    displayName: '',
    description: '',
    category: 'general',
    requiresSignature: true,
    isActive: true,
  });

  const [versionFormData, setVersionFormData] = useState({
    version: '',
    title: '',
    content: '',
    requiresSignature: true,
  });

  const queryFn = getQueryFn<any>({ on401: 'throw' });

  const { data: disclosuresData, isLoading } = useQuery<{ disclosures: DisclosureDefinition[] }>({
    queryKey: ['/api/disclosures'],
    queryFn,
  });

  const disclosures = disclosuresData?.disclosures || [];

  // Sync selectedDisclosure with latest data when disclosures refetch
  useEffect(() => {
    if (selectedDisclosure && disclosures.length > 0) {
      const updatedDisclosure = disclosures.find(d => d.id === selectedDisclosure.id);
      if (updatedDisclosure && updatedDisclosure !== selectedDisclosure) {
        setSelectedDisclosure(updatedDisclosure);
      }
    }
  }, [disclosures]); // Only depend on disclosures array to avoid infinite loop

  const { data: signatureReportData } = useQuery<{ report: SignatureReport[] }>({
    queryKey: ['/api/disclosures', selectedDisclosure?.id, 'signature-report'],
    queryFn,
    enabled: !!selectedDisclosure && (showSignaturesDialog || showVersionsPanel),
  });

  const signatureReport = signatureReportData?.report || [];
  
  // Helper to get signature count for a specific version
  const getVersionSignatureCount = (versionId: number): number => {
    const versionReport = signatureReport.find(sr => sr.version.id === versionId);
    return versionReport?.signatureCount || 0;
  };

  const createDisclosureMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest('POST', '/api/disclosures', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/disclosures'] });
      setShowAddDialog(false);
      resetForm();
      toast({
        title: "Disclosure Created",
        description: "Disclosure definition has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create disclosure",
        variant: "destructive",
      });
    },
  });

  const updateDisclosureMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      return apiRequest('PATCH', `/api/disclosures/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/disclosures'] });
      setShowEditDialog(false);
      setSelectedDisclosure(null);
      resetForm();
      toast({
        title: "Disclosure Updated",
        description: "Disclosure definition has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update disclosure",
        variant: "destructive",
      });
    },
  });

  const deleteDisclosureMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/disclosures/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/disclosures'] });
      setShowDeleteDialog(false);
      setSelectedDisclosure(null);
      toast({
        title: "Disclosure Deleted",
        description: "Disclosure definition has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete disclosure",
        variant: "destructive",
      });
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: async ({ definitionId, data }: { definitionId: number; data: typeof versionFormData }) => {
      return apiRequest('POST', `/api/disclosures/${definitionId}/versions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/disclosures'] });
      setShowVersionDialog(false);
      resetVersionForm();
      toast({
        title: "Version Created",
        description: "New disclosure version has been published successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create version",
        variant: "destructive",
      });
    },
  });

  const updateVersionMutation = useMutation({
    mutationFn: async ({ versionId, data }: { versionId: number; data: { title?: string; content?: string; version?: string } }) => {
      return apiRequest('PATCH', `/api/disclosure-versions/${versionId}`, data);
    },
    onSuccess: () => {
      // Invalidate both disclosures and signature report queries
      queryClient.invalidateQueries({ queryKey: ['/api/disclosures'] });
      if (selectedDisclosure) {
        queryClient.invalidateQueries({ queryKey: ['/api/disclosures', selectedDisclosure.id, 'signature-report'] });
      }
      setShowEditVersionDialog(false);
      setSelectedVersion(null);
      toast({
        title: "Version Updated",
        description: "Disclosure version has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot Edit Version",
        description: error.message || "Failed to update version. This version may already have signatures.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      slug: '',
      displayName: '',
      description: '',
      category: 'general',
      requiresSignature: true,
      isActive: true,
    });
  };

  const resetVersionForm = () => {
    setVersionFormData({
      version: '',
      title: '',
      content: '',
      requiresSignature: true,
    });
  };

  const filteredDisclosures = useMemo(() => {
    return disclosures.filter(d => {
      const matchesSearch = 
        d.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.description || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || d.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
  }, [disclosures, searchQuery, categoryFilter]);

  const openEditDialog = (disclosure: DisclosureDefinition) => {
    setSelectedDisclosure(disclosure);
    setFormData({
      slug: disclosure.slug,
      displayName: disclosure.displayName,
      description: disclosure.description || '',
      category: disclosure.category,
      requiresSignature: disclosure.requiresSignature,
      isActive: disclosure.isActive,
    });
    setShowEditDialog(true);
  };

  const openVersionDialog = (disclosure: DisclosureDefinition) => {
    setSelectedDisclosure(disclosure);
    const currentVersion = disclosure.currentVersion;
    const nextVersionNumber = currentVersion 
      ? `${parseFloat(currentVersion.version) + 0.1}`.replace(/\.(\d{2})\d*$/, '.$1')
      : '1.0';
    setVersionFormData({
      version: nextVersionNumber,
      title: currentVersion?.title || disclosure.displayName,
      content: currentVersion?.content || '',
      requiresSignature: disclosure.requiresSignature,
    });
    setShowVersionDialog(true);
  };

  const openVersionsPanel = (disclosure: DisclosureDefinition) => {
    setSelectedDisclosure(disclosure);
    setShowVersionsPanel(true);
  };

  const openEditVersionDialog = (version: DisclosureVersion) => {
    setSelectedVersion(version);
    setEditVersionFormData({
      version: version.version,
      title: version.title,
      content: version.content,
    });
    setShowEditVersionDialog(true);
  };

  const openSignaturesDialog = (disclosure: DisclosureDefinition) => {
    setSelectedDisclosure(disclosure);
    setShowSignaturesDialog(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ScrollText className="h-8 w-8 text-primary" />
            Disclosure Library
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage versioned disclosure content for application forms
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-disclosure">
          <Plus className="h-4 w-4 mr-2" />
          Add Disclosure
        </Button>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search disclosures..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disclosure Definitions</CardTitle>
          <CardDescription>
            {filteredDisclosures.length} disclosure{filteredDisclosures.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading disclosures...</div>
          ) : filteredDisclosures.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No disclosures found. Create your first disclosure to get started.
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Current Version</TableHead>
                    <TableHead>Signatures</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDisclosures.map((disclosure) => (
                    <TableRow key={disclosure.id} data-testid={`row-disclosure-${disclosure.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{disclosure.displayName}</div>
                          {disclosure.description && (
                            <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {disclosure.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {disclosure.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge className={CATEGORY_BADGES[disclosure.category] || CATEGORY_BADGES.general}>
                          {CATEGORY_OPTIONS.find(c => c.value === disclosure.category)?.label || disclosure.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {disclosure.currentVersion ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">v{disclosure.currentVersion.version}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {formatDate(disclosure.currentVersion.effectiveDate)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">No version</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => openSignaturesDialog(disclosure)}
                          data-testid={`button-signatures-${disclosure.id}`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {disclosure.signatureCount || 0}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {disclosure.isActive ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openVersionsPanel(disclosure)}
                            title="View versions"
                            data-testid={`button-versions-${disclosure.id}`}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openVersionDialog(disclosure)}
                            title="Create new version"
                            data-testid={`button-new-version-${disclosure.id}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(disclosure)}
                            title="Edit disclosure"
                            data-testid={`button-edit-${disclosure.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedDisclosure(disclosure);
                              setShowDeleteDialog(true);
                            }}
                            title="Delete disclosure"
                            data-testid={`button-delete-${disclosure.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
            <DialogTitle>Create Disclosure</DialogTitle>
            <DialogDescription>
              Add a new disclosure definition to the library.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder="e.g., Terms of Service"
                data-testid="input-displayName"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">Slug (Unique ID)</Label>
              <Input
                id="slug"
                value={formData.slug}
                onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-') }))}
                placeholder="e.g., terms-of-service"
                data-testid="input-slug"
              />
              <p className="text-xs text-muted-foreground">
                Used to reference this disclosure in templates
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of this disclosure..."
                rows={2}
                data-testid="input-description"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}>
                <SelectTrigger data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="requiresSignature">Requires Signature</Label>
                <p className="text-xs text-muted-foreground">Users must sign after reading</p>
              </div>
              <Switch
                id="requiresSignature"
                checked={formData.requiresSignature}
                onCheckedChange={(c) => setFormData(prev => ({ ...prev, requiresSignature: c }))}
                data-testid="switch-requiresSignature"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => createDisclosureMutation.mutate(formData)}
              disabled={!formData.slug || !formData.displayName || createDisclosureMutation.isPending}
              data-testid="button-submit-disclosure"
            >
              {createDisclosureMutation.isPending ? 'Creating...' : 'Create Disclosure'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Disclosure</DialogTitle>
            <DialogDescription>
              Update the disclosure definition. Note: slug cannot be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-displayName">Display Name</Label>
              <Input
                id="edit-displayName"
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                data-testid="input-edit-displayName"
              />
            </div>
            <div className="grid gap-2">
              <Label>Slug</Label>
              <code className="text-sm bg-muted px-3 py-2 rounded">{formData.slug}</code>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                data-testid="input-edit-description"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}>
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="edit-requiresSignature">Requires Signature</Label>
                <p className="text-xs text-muted-foreground">Users must sign after reading</p>
              </div>
              <Switch
                id="edit-requiresSignature"
                checked={formData.requiresSignature}
                onCheckedChange={(c) => setFormData(prev => ({ ...prev, requiresSignature: c }))}
                data-testid="switch-edit-requiresSignature"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="edit-isActive">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive disclosures won't appear in forms</p>
              </div>
              <Switch
                id="edit-isActive"
                checked={formData.isActive}
                onCheckedChange={(c) => setFormData(prev => ({ ...prev, isActive: c }))}
                data-testid="switch-edit-isActive"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedDisclosure && updateDisclosureMutation.mutate({ id: selectedDisclosure.id, data: formData })}
              disabled={!formData.displayName || updateDisclosureMutation.isPending}
              data-testid="button-update-disclosure"
            >
              {updateDisclosureMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVersionDialog} onOpenChange={setShowVersionDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Version</DialogTitle>
            <DialogDescription>
              Publish a new version of "{selectedDisclosure?.displayName}". 
              Previous versions are preserved and cannot be modified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="version">Version Number</Label>
                <Input
                  id="version"
                  value={versionFormData.version}
                  onChange={(e) => setVersionFormData(prev => ({ ...prev, version: e.target.value }))}
                  placeholder="e.g., 1.0, 2.0"
                  data-testid="input-version"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="version-title">Version Title</Label>
                <Input
                  id="version-title"
                  value={versionFormData.title}
                  onChange={(e) => setVersionFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Terms of Service"
                  data-testid="input-version-title"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="version-content">Content</Label>
              <WysiwygEditor
                value={versionFormData.content}
                onChange={(content) => setVersionFormData(prev => ({ ...prev, content }))}
                placeholder="Enter the disclosure content that users must read..."
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="version-requiresSignature">Requires Signature</Label>
                <p className="text-xs text-muted-foreground">Override signature requirement for this version</p>
              </div>
              <Switch
                id="version-requiresSignature"
                checked={versionFormData.requiresSignature}
                onCheckedChange={(c) => setVersionFormData(prev => ({ ...prev, requiresSignature: c }))}
                data-testid="switch-version-requiresSignature"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVersionDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedDisclosure && createVersionMutation.mutate({ 
                definitionId: selectedDisclosure.id, 
                data: versionFormData 
              })}
              disabled={!versionFormData.version || !versionFormData.title || !versionFormData.content || createVersionMutation.isPending}
              data-testid="button-publish-version"
            >
              {createVersionMutation.isPending ? 'Publishing...' : 'Publish Version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVersionsPanel} onOpenChange={setShowVersionsPanel}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              All versions of "{selectedDisclosure?.displayName}"
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] pr-4">
            {selectedDisclosure?.versions?.length ? (
              <div className="space-y-4">
                {selectedDisclosure.versions.map((version) => {
                  const sigCount = getVersionSignatureCount(version.id);
                  const isEditable = sigCount === 0;
                  return (
                    <Card key={version.id} className={version.isCurrentVersion ? 'border-primary' : ''}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">v{version.version}</Badge>
                            <span className="font-medium">{version.title}</span>
                            {version.isCurrentVersion && (
                              <Badge className="bg-primary text-primary-foreground">Current</Badge>
                            )}
                            <Badge variant="secondary" className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {sigCount} signature{sigCount !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {isEditable ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditVersionDialog(version)}
                                data-testid={`button-edit-version-${version.id}`}
                              >
                                <Edit2 className="h-4 w-4 mr-1" />
                                Edit Draft
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                Locked
                              </Badge>
                            )}
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {formatDate(version.effectiveDate)}
                              {version.retiredDate && (
                                <span className="text-orange-600">
                                  (Retired: {formatDate(version.retiredDate)})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-muted rounded p-3 max-h-[200px] overflow-y-auto">
                          <div 
                            className="prose prose-sm dark:prose-invert max-w-none"
                            dangerouslySetInnerHTML={{ __html: version.content }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Hash: <code>{version.contentHash?.substring(0, 16) || 'N/A'}...</code>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No versions created yet. Create the first version to get started.
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showSignaturesDialog} onOpenChange={setShowSignaturesDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Signature Report</DialogTitle>
            <DialogDescription>
              All signatures for "{selectedDisclosure?.displayName}"
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All Versions</TabsTrigger>
              {signatureReport.map((sr) => (
                <TabsTrigger key={sr.version.id} value={sr.version.id.toString()}>
                  v{sr.version.version} ({sr.signatureCount})
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="all">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Signer</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Signed At</TableHead>
                      <TableHead>Read Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signatureReport.flatMap(sr => 
                      sr.signatures.map(sig => (
                        <TableRow key={sig.id}>
                          <TableCell>
                            <Badge variant="outline">v{sr.version.version}</Badge>
                          </TableCell>
                          <TableCell>{sig.signerName}</TableCell>
                          <TableCell>{sig.signerEmail || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{sig.signatureType}</Badge>
                          </TableCell>
                          <TableCell>{formatDateTime(sig.signedAt)}</TableCell>
                          <TableCell>
                            {sig.scrollDurationMs 
                              ? `${Math.round(sig.scrollDurationMs / 1000)}s` 
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    {signatureReport.every(sr => sr.signatures.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No signatures recorded yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>
            {signatureReport.map((sr) => (
              <TabsContent key={sr.version.id} value={sr.version.id.toString()}>
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Signer</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Signed At</TableHead>
                        <TableHead>Read Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sr.signatures.map(sig => (
                        <TableRow key={sig.id}>
                          <TableCell>{sig.signerName}</TableCell>
                          <TableCell>{sig.signerEmail || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{sig.signatureType}</Badge>
                          </TableCell>
                          <TableCell>{formatDateTime(sig.signedAt)}</TableCell>
                          <TableCell>
                            {sig.scrollDurationMs 
                              ? `${Math.round(sig.scrollDurationMs / 1000)}s` 
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {sr.signatures.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No signatures for this version
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Disclosure</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedDisclosure?.displayName}"? 
              This will also delete all versions and signature records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selectedDisclosure && deleteDisclosureMutation.mutate(selectedDisclosure.id)}
            >
              {deleteDisclosureMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showEditVersionDialog} onOpenChange={setShowEditVersionDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Edit Draft Version</DialogTitle>
            <DialogDescription>
              Edit version content before any signatures are collected. Once someone signs this version, it becomes locked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-version-number">Version Number</Label>
                <Input
                  id="edit-version-number"
                  value={editVersionFormData.version}
                  onChange={(e) => setEditVersionFormData(prev => ({ ...prev, version: e.target.value }))}
                  placeholder="e.g., 1.0, 2.0"
                  data-testid="input-edit-version-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-version-title">Version Title</Label>
                <Input
                  id="edit-version-title"
                  value={editVersionFormData.title}
                  onChange={(e) => setEditVersionFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter version title"
                  data-testid="input-edit-version-title"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-version-content">Content</Label>
              <WysiwygEditor
                value={editVersionFormData.content}
                onChange={(value) => setEditVersionFormData(prev => ({ ...prev, content: value }))}
                placeholder="Enter disclosure content..."
                data-testid="editor-edit-version-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditVersionDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => selectedVersion && updateVersionMutation.mutate({ 
                versionId: selectedVersion.id, 
                data: editVersionFormData 
              })}
              disabled={!editVersionFormData.version || !editVersionFormData.title || !editVersionFormData.content || updateVersionMutation.isPending}
              data-testid="button-save-version"
            >
              {updateVersionMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
