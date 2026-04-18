import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  ArrowLeft,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Users,
  DollarSign,
  Calendar,
  CheckCircle,
  Download,
  XCircle,
  Clock,
  AlertCircle,
  MessageSquare,
  FolderOpen,
  Activity,
  Send,
  Plus,
  Trash2,
  Upload,
  Shield,
  FileEdit
} from 'lucide-react';
import { Link } from 'wouter';
import { EntityActivityFeed } from '@/components/EntityActivityFeed';

interface ProspectData {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  formData: any;
  assignedAgent: string;
  validatedAt: string | null;
  applicationStartedAt: string | null;
  applicationId: number | null;
}

interface Owner {
  name: string;
  email: string;
  percentage: string;
  signature?: string;
  signatureType?: string;
}

interface SignatureCert {
  signedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  documentHash: string | null;
  signatureType: string;
  recordLink: string | null;
}

interface OwnerSignatureStatus {
  name: string;
  email: string;
  percentage: string;
  hasSignature: boolean;
  cert: SignatureCert | null;
}

interface SignatureStatus {
  required: number;
  completed: number;
  pending: number;
  isComplete: boolean;
  needsAttention: boolean;
  ownerStatus: OwnerSignatureStatus[];
}

export default function ApplicationView() {
  const [, params] = useRoute('/application-view/:id');
  const prospectId = params?.id;

  console.log('ApplicationView - prospectId:', prospectId);
  console.log('ApplicationView - params:', params);

  const { data: prospect, isLoading, error } = useQuery<ProspectData>({
    queryKey: ['/api/prospects/view', prospectId],
    queryFn: async () => {
      console.log('Query function called for prospect ID:', prospectId);
      const response = await fetch(`/api/prospects/view/${prospectId}`);
      console.log('Response status:', response.status);
      if (!response.ok) {
        const errorData = await response.text();
        console.error('Query error response:', errorData);
        throw new Error(`HTTP ${response.status}: ${errorData}`);
      }
      const data = await response.json();
      console.log('Query response data:', data);
      return data;
    },
    enabled: !!prospectId
  });

  // Fetch signature status using database signatures
  const { data: signatureStatus } = useQuery<SignatureStatus>({
    queryKey: ['/api/prospects', prospectId, 'signature-status'],
    queryFn: async () => {
      const response = await fetch(`/api/prospects/${prospectId}/signature-status`);
      if (!response.ok) {
        throw new Error(`Failed to fetch signature status: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!prospectId,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [messageBody, setMessageBody] = useState("");
  const [newRequestLabel, setNewRequestLabel] = useState("");
  const [newRequestDesc, setNewRequestDesc] = useState("");
  const [showNewRequest, setShowNewRequest] = useState(false);

  const { data: messagesData } = useQuery<{ messages: any[] }>({
    queryKey: ['/api/prospects', prospectId, 'messages'],
    queryFn: async () => {
      const r = await fetch(`/api/prospects/${prospectId}/messages`);
      if (!r.ok) return { messages: [] };
      return r.json();
    },
    staleTime: 0,
    enabled: !!prospectId,
  });

  const { data: fileRequestsData } = useQuery<{ fileRequests: any[] }>({
    queryKey: ['/api/prospects', prospectId, 'file-requests'],
    queryFn: async () => {
      const r = await fetch(`/api/prospects/${prospectId}/file-requests`);
      if (!r.ok) return { fileRequests: [] };
      return r.json();
    },
    staleTime: 0,
    enabled: !!prospectId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/prospects/${prospectId}/messages`, { message: messageBody }),
    onSuccess: () => {
      setMessageBody("");
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospectId, 'messages'] });
      toast({ title: "Message sent" });
    },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const createFileRequestMutation = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/prospects/${prospectId}/file-requests`, { label: newRequestLabel, description: newRequestDesc }),
    onSuccess: () => {
      setNewRequestLabel("");
      setNewRequestDesc("");
      setShowNewRequest(false);
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospectId, 'file-requests'] });
      toast({ title: "File request created" });
    },
    onError: () => toast({ title: "Failed to create request", variant: "destructive" }),
  });

  const deleteFileRequestMutation = useMutation({
    mutationFn: async (frId: number) => apiRequest('DELETE', `/api/prospects/${prospectId}/file-requests/${frId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospectId, 'file-requests'] });
      toast({ title: "Request deleted" });
    },
  });

  const updateFileRequestMutation = useMutation({
    mutationFn: async ({ frId, status }: { frId: number; status: string }) =>
      apiRequest('PATCH', `/api/prospects/${prospectId}/file-requests/${frId}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/prospects', prospectId, 'file-requests'] }),
  });

  const sendPortalInviteMutation = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/prospects/${prospectId}/send-portal-invite`, {}),
    onSuccess: (data: any) => toast({ title: "Invitation sent", description: `Portal invite emailed to ${data.email}` }),
    onError: (err: any) => toast({ title: "Failed to send invite", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  const messages = messagesData?.messages ?? [];
  const fileRequests = fileRequestsData?.fileRequests ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading application...</p>
        </div>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Application Not Found</h3>
          <p className="text-gray-500 mb-4">The requested application could not be found.</p>
          <Link href="/agent-dashboard">
            <Button>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Parse form data safely with type guard
  let formData: any = {};
  try {
    if (prospect && prospect.formData) {
      formData = typeof prospect.formData === 'string' ? JSON.parse(prospect.formData) : prospect.formData;
    }
  } catch (e) {
    console.error('Error parsing form data:', e);
    formData = {};
  }
  
  const owners: Owner[] = formData.owners || [];

  // Type guard to ensure prospect is defined
  if (!prospect) {
    return null;
  }

  const getStatusColor = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      contacted: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-purple-100 text-purple-800',
      applied: 'bg-green-100 text-green-800',
      approved: 'bg-emerald-100 text-emerald-800',
      rejected: 'bg-red-100 text-red-800'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (value: string) => {
    if (!value) return 'Not specified';
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? value : `$${num.toLocaleString()}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <Link href="/agent-dashboard">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="flex items-center space-x-3">
              <SetCampaignButton prospectId={prospectId} />
              <a href={`/api/prospects/${prospectId}/download-pdf`} target="_blank" rel="noopener noreferrer">
                <Button>
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </a>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {prospect?.firstName} {prospect?.lastName}
              </h1>
              <p className="text-gray-600 mt-1">Merchant Application Review</p>
            </div>
            <Badge className={getStatusColor(prospect?.status || 'pending')}>
              {(prospect?.status || 'pending').replace('_', ' ').toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Application Timeline */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calendar className="h-5 w-5 mr-2" />
              Application Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Application Created</span>
                <span className="text-sm font-medium">{formatDate(prospect?.createdAt || new Date().toISOString())}</span>
              </div>
              {prospect?.applicationStartedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Application Started</span>
                  <span className="text-sm font-medium">{formatDate(prospect.applicationStartedAt)}</span>
                </div>
              )}
              {prospect?.validatedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Email Validated</span>
                  <span className="text-sm font-medium">{formatDate(prospect.validatedAt)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Last Updated</span>
                <span className="text-sm font-medium">{formatDate(prospect?.updatedAt || new Date().toISOString())}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <User className="h-5 w-5 mr-2" />
              Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Mail className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="font-medium">{prospect?.email || 'Not provided'}</p>
                </div>
              </div>
              {formData.companyPhone && (
                <div className="flex items-center space-x-3">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="font-medium">{formData.companyPhone}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center space-x-3">
                <User className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Assigned Agent</p>
                  <p className="font-medium">{prospect?.assignedAgent || 'Not assigned'}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Information */}
        {(formData.companyName || formData.businessType) && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Building2 className="h-5 w-5 mr-2" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {formData.companyName && (
                  <div>
                    <p className="text-sm text-gray-600">Company Name</p>
                    <p className="font-medium text-lg">{formData.companyName}</p>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formData.businessType && (
                    <div>
                      <p className="text-sm text-gray-600">Business Type</p>
                      <p className="font-medium">{formData.businessType}</p>
                    </div>
                  )}
                  {formData.stateFiled && (
                    <div>
                      <p className="text-sm text-gray-600">State Filed</p>
                      <p className="font-medium">{formData.stateFiled}</p>
                    </div>
                  )}
                  {formData.businessStartDate && (
                    <div>
                      <p className="text-sm text-gray-600">Business Start Date</p>
                      <p className="font-medium">{new Date(formData.businessStartDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {formData.yearsInBusiness && (
                    <div>
                      <p className="text-sm text-gray-600">Years in Business</p>
                      <p className="font-medium">{formData.yearsInBusiness}</p>
                    </div>
                  )}
                  {formData.federalTaxId && (
                    <div>
                      <p className="text-sm text-gray-600">Federal Tax ID</p>
                      <p className="font-medium">{formData.federalTaxId}</p>
                    </div>
                  )}
                  {formData.companyEmail && (
                    <div>
                      <p className="text-sm text-gray-600">Company Email</p>
                      <p className="font-medium">{formData.companyEmail}</p>
                    </div>
                  )}
                </div>

                {(formData.businessDescription || formData.productsServices) && (
                  <div className="space-y-3">
                    {formData.businessDescription && (
                      <div>
                        <p className="text-sm text-gray-600">Business Description</p>
                        <p className="font-medium">{formData.businessDescription}</p>
                      </div>
                    )}
                    {formData.productsServices && (
                      <div>
                        <p className="text-sm text-gray-600">Products & Services</p>
                        <p className="font-medium">{formData.productsServices}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Address Information */}
        {(formData.address || formData.city || formData.state) && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <MapPin className="h-5 w-5 mr-2" />
                Business Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {formData.address && <p className="font-medium">{formData.address}</p>}
                {formData.addressLine2 && <p className="font-medium">{formData.addressLine2}</p>}
                <p className="font-medium">
                  {formData.city && `${formData.city}, `}
                  {formData.state && `${formData.state} `}
                  {formData.zipCode}
                </p>
                <div className="flex items-center mt-3 pt-3 border-t">
                  <div className="flex items-center text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                    <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Address Verified by Google Places</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Business Ownership */}
        {owners.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Business Ownership
                </div>
                <div className="flex items-center space-x-2">
                  {(() => {
                    // Use database-backed signature status for badge
                    if (!signatureStatus) return null;
                    
                    const { required, completed } = signatureStatus;
                    const signatureProgress = required > 0 ? `${completed}/${required}` : '0/0';
                    
                    return (
                      <>
                        <Badge 
                          variant={completed === required && required > 0 ? "default" : "secondary"}
                          className={completed === required && required > 0 ? "bg-green-600" : ""}
                        >
                          Signatures: {signatureProgress}
                        </Badge>
                        {completed === required && required > 0 ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : required > 0 ? (
                          <Clock className="h-5 w-5 text-yellow-600" />
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {owners.map((owner, index) => {
                  const ownershipPercentage = parseFloat(owner.percentage);
                  const requiresSignature = ownershipPercentage >= 25;
                  // Use database-backed signature status instead of form data
                  const ownerStatus = signatureStatus?.ownerStatus?.find(
                    (os: any) => os.email === owner.email
                  );
                  const hasSignature = ownerStatus?.hasSignature || false;
                  
                  return (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">{owner.name}</h4>
                        <div className="flex items-center space-x-2">
                          <Badge variant="outline">{owner.percentage}% ownership</Badge>
                          {requiresSignature && (
                            <Badge 
                              variant={hasSignature ? "default" : "secondary"}
                              className={hasSignature ? "bg-green-600" : "bg-yellow-500"}
                            >
                              Signature {hasSignature ? "Received" : "Required"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{owner.email}</p>
                      
                      {/* Signature Status */}
                      <div className="flex items-center justify-between">
                        {requiresSignature ? (
                          hasSignature ? (
                            <div className="flex items-center text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              <span className="font-medium">Signature Received</span>
                              <span className="ml-2 text-gray-600">({owner.signatureType || 'digital'})</span>
                            </div>
                          ) : (
                            <div className="flex items-center text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg">
                              <Clock className="h-4 w-4 mr-2" />
                              <span className="font-medium">Signature Pending</span>
                              <span className="ml-2 text-gray-600">(≥25% ownership)</span>
                            </div>
                          )
                        ) : (
                          <div className="flex items-center text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg">
                            <XCircle className="h-4 w-4 mr-2" />
                            <span>No signature required</span>
                            <span className="ml-2 text-gray-500">(&lt;25% ownership)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Overall Signature Status Summary */}
              {(() => {
                // Use database-backed signature status for summary
                if (!signatureStatus) return null;
                
                const { required, completed, pending } = signatureStatus;
                
                if (required > 0) {
                  return (
                    <div className="mt-6 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Signature Collection Status:</span>
                        <div className="flex items-center space-x-4">
                          {completed > 0 && (
                            <div className="flex items-center text-sm text-green-600">
                              <CheckCircle className="h-4 w-4 mr-1" />
                              {completed} Complete
                            </div>
                          )}
                          {pending > 0 && (
                            <div className="flex items-center text-sm text-yellow-600">
                              <Clock className="h-4 w-4 mr-1" />
                              {pending} Pending
                            </div>
                          )}
                          {completed === required ? (
                            <div className="flex items-center text-sm text-green-700 font-medium">
                              <CheckCircle className="h-4 w-4 mr-1" />
                              All Required Signatures Collected
                            </div>
                          ) : (
                            <div className="flex items-center text-sm text-yellow-700 font-medium">
                              <AlertCircle className="h-4 w-4 mr-1" />
                              Awaiting {pending} Signature{pending > 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* E-Sign Certificate Summary (Epic F) — per-owner cert evidence */}
              {signatureStatus?.ownerStatus?.some((o) => o.cert) && (
                <div className="mt-6 pt-4 border-t" data-testid="esign-cert-summary">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">E-Sign Certificate (audit trail)</h4>
                  <div className="space-y-2">
                    {signatureStatus.ownerStatus
                      .filter((o): o is OwnerSignatureStatus & { cert: SignatureCert } => o.cert !== null)
                      .map((o, idx) => (
                        <div key={idx} className="rounded border border-gray-200 bg-gray-50 p-3 text-xs space-y-1" data-testid={`esign-cert-${idx}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-800">{o.name}</span>
                            <span className="text-gray-500">{o.cert.signatureType === 'draw' ? 'Drawn' : 'Typed'}</span>
                          </div>
                          <div><span className="text-gray-500">Signed:</span> {o.cert.signedAt ? new Date(o.cert.signedAt).toLocaleString() : '—'}</div>
                          <div><span className="text-gray-500">IP:</span> {o.cert.ipAddress ?? '—'}</div>
                          <div className="truncate"><span className="text-gray-500">User-Agent:</span> {o.cert.userAgent ?? '—'}</div>
                          <div className="truncate"><span className="text-gray-500">Document SHA-256:</span> <code className="font-mono">{o.cert.documentHash ?? '—'}</code></div>
                          {o.cert.recordLink && (
                            <div className="truncate">
                              <span className="text-gray-500">Verifiable record:</span>{' '}
                              <a
                                href={o.cert.recordLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline font-mono"
                                data-testid={`signature-record-link-${o.email}`}
                              >
                                {o.cert.recordLink}
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Transaction Information */}
        {(formData.monthlyVolume || formData.averageTicket || formData.processingMethod || formData.averageMonthlyVolume || formData.seasonal || formData.merchantType || formData.highestVolumeMonths) && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <DollarSign className="h-5 w-5 mr-2" />
                Transaction Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {formData.monthlyVolume && (
                  <div>
                    <p className="text-sm text-gray-600">Monthly Volume</p>
                    <p className="font-medium">{formatCurrency(formData.monthlyVolume)}</p>
                  </div>
                )}
                {formData.averageMonthlyVolume && (
                  <div>
                    <p className="text-sm text-gray-600">Average Monthly Volume</p>
                    <p className="font-medium">{formatCurrency(formData.averageMonthlyVolume)}</p>
                  </div>
                )}
                {formData.averageTicket && (
                  <div>
                    <p className="text-sm text-gray-600">Average Ticket</p>
                    <p className="font-medium">{formatCurrency(formData.averageTicket)}</p>
                  </div>
                )}
                {formData.highestTicket && (
                  <div>
                    <p className="text-sm text-gray-600">Highest Ticket</p>
                    <p className="font-medium">{formatCurrency(formData.highestTicket)}</p>
                  </div>
                )}
                {formData.processingMethod && (
                  <div>
                    <p className="text-sm text-gray-600">Processing Method</p>
                    <p className="font-medium">{formData.processingMethod}</p>
                  </div>
                )}
                {formData.merchantType && (
                  <div>
                    <p className="text-sm text-gray-600">Merchant Type</p>
                    <p className="font-medium">{formData.merchantType}</p>
                  </div>
                )}
                {formData.seasonal && (
                  <div>
                    <p className="text-sm text-gray-600">Seasonal Business</p>
                    <p className="font-medium">{formData.seasonal === 'true' || formData.seasonal === true ? 'Yes' : formData.seasonal === 'false' || formData.seasonal === false ? 'No' : formData.seasonal}</p>
                  </div>
                )}
                {formData.highestVolumeMonths && (
                  <div>
                    <p className="text-sm text-gray-600">Highest Volume Months</p>
                    <p className="font-medium">{formatCurrency(formData.highestVolumeMonths)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Portal Communication ── */}
        <div className="mt-8">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Applicant Portal</h2>
              {messages.filter((m: any) => m.senderType === "prospect" && !m.isRead).length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {messages.filter((m: any) => m.senderType === "prospect" && !m.isRead).length} unread
                </Badge>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => sendPortalInviteMutation.mutate()}
              disabled={sendPortalInviteMutation.isPending}
              title="Email the applicant a link to set up or access their portal account"
            >
              <Mail className="w-3.5 h-3.5 mr-1.5" />
              {sendPortalInviteMutation.isPending ? "Sending…" : "Send Portal Invite"}
            </Button>
          </div>

          <Tabs defaultValue="messages">
            <TabsList>
              <TabsTrigger value="messages">
                <MessageSquare className="w-4 h-4 mr-1.5" />
                Messages ({messages.length})
              </TabsTrigger>
              <TabsTrigger value="files">
                <FolderOpen className="w-4 h-4 mr-1.5" />
                Document Requests ({fileRequests.length})
              </TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity">
                <Activity className="w-4 h-4 mr-1.5" />
                Activity
              </TabsTrigger>
            </TabsList>

            {/* Messages Tab */}
            <TabsContent value="messages" className="mt-4 space-y-4">
              {/* Compose */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <Label className="text-sm font-medium">Send message to applicant</Label>
                  <Textarea
                    placeholder="Type your message..."
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    rows={3}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => sendMessageMutation.mutate()}
                    disabled={sendMessageMutation.isPending || !messageBody.trim()}
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {sendMessageMutation.isPending ? "Sending..." : "Send"}
                  </Button>
                </CardContent>
              </Card>

              {/* Thread */}
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : (
                  messages.map((msg: any) => (
                    <div key={msg.id} className={`flex ${msg.senderType === "agent" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        msg.senderType === "agent"
                          ? "bg-blue-600 text-white rounded-br-sm"
                          : "bg-white border border-gray-200 text-gray-900 rounded-bl-sm"
                      }`}>
                        <p className={`text-xs font-medium mb-1 ${msg.senderType === "agent" ? "text-blue-100" : "text-gray-500"}`}>
                          {msg.senderType === "agent" ? "You (Agent)" : "Applicant"}
                        </p>
                        <p className="text-sm leading-relaxed">{msg.message}</p>
                        <p className={`text-xs mt-1.5 ${msg.senderType === "agent" ? "text-blue-200" : "text-gray-400"}`}>
                          {new Date(msg.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            {/* File Requests Tab */}
            <TabsContent value="files" className="mt-4 space-y-4">
              {/* New request form */}
              {showNewRequest ? (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <Label className="font-medium">New Document Request</Label>
                    <div className="space-y-2">
                      <Input
                        placeholder="Document name (e.g. Voided Check, Driver's License)"
                        value={newRequestLabel}
                        onChange={(e) => setNewRequestLabel(e.target.value)}
                      />
                      <Input
                        placeholder="Description or instructions (optional)"
                        value={newRequestDesc}
                        onChange={(e) => setNewRequestDesc(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => createFileRequestMutation.mutate()} disabled={!newRequestLabel.trim() || createFileRequestMutation.isPending}>
                        {createFileRequestMutation.isPending ? "Creating..." : "Create Request"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowNewRequest(false)}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNewRequest(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Request a Document
                </Button>
              )}

              {/* List */}
              {fileRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No document requests yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {fileRequests.map((fr: any) => (
                    <Card key={fr.id} className={fr.status === "uploaded" ? "border-green-200 bg-green-50/30" : ""}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{fr.label}</span>
                              <Badge className={`text-xs ${
                                fr.status === "uploaded" || fr.status === "approved" ? "bg-green-100 text-green-800" :
                                fr.status === "rejected" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"
                              }`}>{fr.status}</Badge>
                            </div>
                            {fr.description && <p className="text-xs text-gray-500 mt-0.5">{fr.description}</p>}
                            {fr.fileName && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <FileText className="w-3 h-3" />{fr.fileName}
                                </span>
                                <a href={`/api/prospects/${prospectId}/file-requests/${fr.id}/download`} target="_blank" rel="noopener noreferrer">
                                  <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs">
                                    <Download className="w-3 h-3 mr-1" />Download
                                  </Button>
                                </a>
                                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs text-green-700 border-green-300"
                                  onClick={() => updateFileRequestMutation.mutate({ frId: fr.id, status: "approved" })}
                                  disabled={fr.status === "approved"}>
                                  <CheckCircle className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs text-red-700 border-red-300"
                                  onClick={() => updateFileRequestMutation.mutate({ frId: fr.id, status: "rejected" })}
                                  disabled={fr.status === "rejected"}>
                                  <XCircle className="w-3 h-3 mr-1" />Reject
                                </Button>
                              </div>
                            )}
                          </div>
                          <Button type="button" variant="ghost" size="sm" className="text-gray-400 hover:text-red-500 h-7 w-7 p-0"
                            onClick={() => deleteFileRequestMutation.mutate(fr.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Activity Tab — per-entity audit log feed (Epic F) */}
            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardContent className="p-4">
                  {prospect?.applicationId ? (
                    <EntityActivityFeed resource="application" resourceId={String(prospect.applicationId)} />
                  ) : (
                    <EntityActivityFeed resource="prospect" resourceId={String(prospectId)} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Actions */}
        <div className="flex justify-center space-x-4 mt-8">
          <Link href="/agent-dashboard">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <a href={`/api/prospects/${prospectId}/download-pdf`} target="_blank" rel="noopener noreferrer">
            <Button>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

function SetCampaignButton({ prospectId }: { prospectId: string | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string>("");
  const [regenerate, setRegenerate] = useState(true);

  const { data: campaigns = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/campaigns"],
    enabled: open,
  });

  const setMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/prospects/${prospectId}/set-campaign`, {
        campaignId: parseInt(campaignId),
        regenerate,
      });
      return res.json();
    },
    onSuccess: (data: { regenerated?: { ok: boolean; pdfPath?: string } | null }) => {
      const regenOk = !!data.regenerated?.ok;
      toast({
        title: "Campaign updated",
        description: regenOk ? "Filled PDF regenerated." : "Campaign assignment swapped.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      setOpen(false);
    },
    onError: (e: any) => {
      toast({ title: "Failed", description: e?.message || "Could not set campaign", variant: "destructive" });
    },
  });

  if (!prospectId) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-set-campaign">
        <FileEdit className="h-4 w-4 mr-2" />
        Set Campaign
      </Button>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-background rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Set Campaign</h2>
            <div className="space-y-4">
              <div>
                <Label>Campaign</Label>
                <select
                  className="w-full mt-1 border rounded px-3 py-2 bg-background"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  data-testid="select-set-campaign"
                >
                  <option value="">— Choose a campaign —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={regenerate}
                  onChange={(e) => setRegenerate(e.target.checked)}
                  data-testid="checkbox-regenerate-pdf"
                />
                Regenerate filled PDF using new campaign
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => setMutation.mutate()}
                  disabled={!campaignId || setMutation.isPending}
                  data-testid="button-confirm-set-campaign"
                >
                  {setMutation.isPending ? "Saving..." : "Apply"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

