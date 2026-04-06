import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  AlertCircle
} from 'lucide-react';
import { Link } from 'wouter';

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
}

interface Owner {
  name: string;
  email: string;
  percentage: string;
  signature?: string;
  signatureType?: string;
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
  const { data: signatureStatus } = useQuery({
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