import { useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Building2, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar, 
  Users, 
  DollarSign,
  FileText,
  CheckCircle
} from 'lucide-react';

interface ProspectData {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  agentId: number;
  status: string;
  validationToken: string | null;
  validatedAt: string | null;
  applicationStartedAt: string | null;
  formData: string | null;
  currentStep: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAgent?: string;
}

export default function ApplicationPrint() {
  const [, params] = useRoute('/application-print/:id');
  const prospectId = params?.id;

  // Fetch prospect data
  const { data: prospect, isLoading } = useQuery<ProspectData>({
    queryKey: [`/api/prospects/view/${prospectId}`],
    queryFn: async () => {
      console.log('Query function called for prospect ID:', prospectId);
      const response = await fetch(`/api/prospects/view/${prospectId}`, {
        credentials: 'include'
      });
      console.log('Response status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Query response data:', data);
      return data;
    },
    enabled: !!prospectId,
  });

  // Parse form data
  let formData: any = {};
  if (prospect?.formData) {
    try {
      formData = JSON.parse(prospect.formData);
    } catch (e) {
      console.error('Error parsing form data:', e);
      formData = {};
    }
  }

  // Add print-specific styles
  useEffect(() => {
    // Add print styles to head
    const printStyles = document.createElement('style');
    printStyles.textContent = `
      @media print {
        body { margin: 0; }
        .print-container { 
          padding: 20px; 
          font-size: 12px;
          background: white !important;
        }
        .print-card {
          break-inside: avoid;
          page-break-inside: avoid;
          margin-bottom: 15px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
          background: white !important;
        }
        .print-header {
          border-bottom: 2px solid #3b82f6;
          padding-bottom: 12px;
          margin-bottom: 20px;
        }
        .print-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .print-section {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        @page {
          margin: 0.5in;
          size: letter;
        }
      }
      @media screen {
        .print-container {
          max-width: 8.5in;
          margin: 0 auto;
          padding: 20px;
          background: white;
          min-height: 11in;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
      }
    `;
    document.head.appendChild(printStyles);

    return () => {
      document.head.removeChild(printStyles);
    };
  }, []);

  // Auto-trigger print dialog
  useEffect(() => {
    if (prospect && !isLoading) {
      // Small delay to ensure content is rendered
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [prospect, isLoading]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not available';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: string | number) => {
    if (!amount) return '$0.00';
    const num = typeof amount === 'string' ? parseFloat(amount.replace(/[^0-9.-]+/g, '')) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num);
  };

  if (isLoading) {
    return (
      <div className="print-container">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg">Loading application data...</div>
        </div>
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="print-container">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg text-red-600">Application not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="print-container">
      {/* Header */}
      <div className="print-header">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Merchant Application
            </h1>
            <p className="text-gray-600 mt-1">
              {formData.companyName || `${prospect.firstName} ${prospect.lastName}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">Application ID</div>
            <div className="font-mono text-lg">{prospect.id}</div>
            <Badge variant="secondary" className="mt-2">
              {prospect.status}
            </Badge>
          </div>
        </div>
      </div>

      <div className="print-grid">
        {/* Timeline Section */}
        <div className="print-section">
          <div className="print-card">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold">Application Timeline</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span className="font-medium">{formatDate(prospect.createdAt)}</span>
              </div>
              {prospect.validatedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Validated:</span>
                  <span className="font-medium">{formatDate(prospect.validatedAt)}</span>
                </div>
              )}
              {prospect.applicationStartedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Application Started:</span>
                  <span className="font-medium">{formatDate(prospect.applicationStartedAt)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Last Updated:</span>
                <span className="font-medium">{formatDate(prospect.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="print-section">
          <div className="print-card">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold">Contact Information</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Name:</span>
                <span className="font-medium">{prospect.firstName} {prospect.lastName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Email:</span>
                <span className="font-medium">{prospect.email}</span>
              </div>
              {formData.companyPhone && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Phone:</span>
                  <span className="font-medium">{formData.companyPhone}</span>
                </div>
              )}
              {prospect.assignedAgent && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Assigned Agent:</span>
                  <span className="font-medium">{prospect.assignedAgent}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Business Details */}
        {formData.companyName && (
          <div className="print-section">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Business Details</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Company:</span>
                  <span className="font-medium">{formData.companyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Email:</span>
                  <span className="font-medium">{formData.companyEmail}</span>
                </div>
                {formData.businessType && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Business Type:</span>
                    <span className="font-medium">{formData.businessType}</span>
                  </div>
                )}
                {formData.yearsInBusiness && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Years in Business:</span>
                    <span className="font-medium">{formData.yearsInBusiness}</span>
                  </div>
                )}
                {formData.federalTaxId && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Federal Tax ID:</span>
                    <span className="font-medium">{formData.federalTaxId}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Address */}
        {formData.address && (
          <div className="print-section">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Business Address</h3>
              </div>
              <div className="space-y-1">
                <div>{formData.address}</div>
                {formData.addressLine2 && <div>{formData.addressLine2}</div>}
                <div>{formData.city}, {formData.state} {formData.zipCode}</div>
              </div>
            </div>
          </div>
        )}

        {/* Transaction Information */}
        {(formData.monthlyVolume || formData.averageTicket || formData.processingMethod) && (
          <div className="print-section">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Transaction Information</h3>
              </div>
              <div className="space-y-3">
                {formData.monthlyVolume && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly Volume:</span>
                    <span className="font-medium">{formatCurrency(formData.monthlyVolume)}</span>
                  </div>
                )}
                {formData.averageTicket && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Average Ticket:</span>
                    <span className="font-medium">{formatCurrency(formData.averageTicket)}</span>
                  </div>
                )}
                {formData.highestTicket && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Highest Ticket:</span>
                    <span className="font-medium">{formatCurrency(formData.highestTicket)}</span>
                  </div>
                )}
                {formData.processingMethod && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Processing Method:</span>
                    <span className="font-medium">{formData.processingMethod}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Business Ownership */}
        {formData.owners && formData.owners.length > 0 && (
          <div className="print-section col-span-2">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Business Ownership</h3>
              </div>
              <div className="space-y-4">
                {formData.owners.map((owner: any, index: number) => (
                  <div key={index} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium">{owner.name}</div>
                        <div className="text-sm text-gray-600">{owner.email}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{owner.percentage}% ownership</div>
                        {owner.signature && (
                          <div className="flex items-center gap-1 text-green-600 text-sm mt-1">
                            <CheckCircle className="h-4 w-4" />
                            <span>Signed</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {owner.signature && (
                      <div className="mt-2 pt-2 border-t">
                        <div className="text-sm text-gray-600 mb-1">Digital Signature:</div>
                        <div className="font-signature text-lg">{owner.signature}</div>
                        {owner.submittedAt && (
                          <div className="text-xs text-gray-500 mt-1">
                            Signed on {formatDate(owner.submittedAt)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Business Description */}
        {formData.businessDescription && (
          <div className="print-section col-span-2">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Business Description</h3>
              </div>
              <p className="text-gray-700 leading-relaxed">{formData.businessDescription}</p>
            </div>
          </div>
        )}

        {/* Products/Services */}
        {formData.productsServices && (
          <div className="print-section col-span-2">
            <div className="print-card">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Products & Services</h3>
              </div>
              <p className="text-gray-700 leading-relaxed">{formData.productsServices}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t text-center text-sm text-gray-500">
        <p>Generated on {new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</p>
      </div>
    </div>
  );
}