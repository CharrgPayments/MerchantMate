import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, Clock, AlertCircle, FileText, Mail, User, Calendar, Building, ExternalLink, RefreshCw } from 'lucide-react';

interface ApplicationData {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string;
  status: string;
  validationToken: string;
  agentId: number;
  formData?: string;
  createdAt: string;
  updatedAt: string;
  agent?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface ApplicationStatusWidgetProps {
  token: string;
  size?: 'small' | 'medium' | 'large';
  showDetails?: boolean;
  showActions?: boolean;
  onStatusChange?: (status: string) => void;
  className?: string;
}

export function ApplicationStatusWidget({ 
  token, 
  size = 'medium', 
  showDetails = true, 
  showActions = true,
  onStatusChange,
  className = '' 
}: ApplicationStatusWidgetProps) {
  const {
    data: application,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery<ApplicationData, Error>({
    queryKey: ['/api/application-status', token],
    queryFn: async () => {
      const response = await fetch(`/api/application-status/${token}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error('Application not found');
        throw new Error('Failed to load status');
      }
      return response.json();
    },
    enabled: !!token,
  });

  const error = queryError ? queryError.message : null;
  const fetchApplicationStatus = () => { refetch(); };

  useEffect(() => {
    if (application && onStatusChange) {
      onStatusChange(application.status);
    }
  }, [application, onStatusChange]);

  const getStatusInfo = (status: string) => {
    switch (status.toLowerCase()) {
      case 'submitted':
        return {
          icon: <CheckCircle className="h-4 w-4 text-green-600" />,
          label: 'Submitted',
          color: 'bg-green-100 text-green-800',
          description: 'Application submitted and under review'
        };
      case 'in_review':
        return {
          icon: <Clock className="h-4 w-4 text-yellow-600" />,
          label: 'Under Review',
          color: 'bg-yellow-100 text-yellow-800',
          description: 'Currently being reviewed'
        };
      case 'approved':
        return {
          icon: <CheckCircle className="h-4 w-4 text-green-600" />,
          label: 'Approved',
          color: 'bg-green-100 text-green-800',
          description: 'Application approved'
        };
      case 'rejected':
        return {
          icon: <AlertCircle className="h-4 w-4 text-red-600" />,
          label: 'Rejected',
          color: 'bg-red-100 text-red-800',
          description: 'Application not approved'
        };
      default:
        return {
          icon: <Clock className="h-4 w-4 text-gray-600" />,
          label: 'Processing',
          color: 'bg-gray-100 text-gray-800',
          description: 'Application processing'
        };
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(size === 'large' && { hour: '2-digit', minute: '2-digit' })
    });
  };

  const getFormData = () => {
    if (!application?.formData) return null;
    try {
      return JSON.parse(application.formData);
    } catch {
      return null;
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center p-6">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm text-gray-600">Loading status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !application) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center p-6">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600">{error || 'Application not found'}</p>
            {showActions && (
              <Button size="sm" variant="outline" onClick={fetchApplicationStatus} className="mt-2">
                Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusInfo = getStatusInfo(application.status);
  const formData = getFormData();

  // Small size - compact status display
  if (size === 'small') {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {statusInfo.icon}
              <div>
                <p className="font-medium text-sm">{formData?.companyName || `${application.firstName} ${application.lastName}`}</p>
                <p className="text-xs text-gray-500">{formatDate(application.createdAt)}</p>
              </div>
            </div>
            <Badge className={statusInfo.color}>
              {statusInfo.label}
            </Badge>
          </div>
          {showActions && (
            <div className="flex justify-end mt-2">
              <Button size="sm" variant="ghost" asChild>
                <a href={`/application-status/${application.validationToken}`}>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Medium size - standard widget display
  if (size === 'medium') {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {statusInfo.icon}
              <div>
                <CardTitle className="text-base">{formData?.companyName || `${application.firstName} ${application.lastName}`}</CardTitle>
                <CardDescription className="text-sm">{statusInfo.description}</CardDescription>
              </div>
            </div>
            <Badge className={statusInfo.color}>
              {statusInfo.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {showDetails && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Submitted:</span>
                <span>{formatDate(application.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Application ID:</span>
                <span className="font-mono text-xs">{application.validationToken}</span>
              </div>
              {application.agent && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Agent:</span>
                  <span>{application.agent.firstName} {application.agent.lastName}</span>
                </div>
              )}
            </div>
          )}
          {showActions && (
            <div className="flex justify-between mt-4">
              <Button size="sm" variant="outline" onClick={fetchApplicationStatus}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
              <Button size="sm" variant="default" asChild>
                <a href={`/application-status/${application.validationToken}`}>
                  View Details
                  <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Large size - full details display
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {statusInfo.icon}
            <div>
              <CardTitle className="text-xl">{formData?.companyName || `${application.firstName} ${application.lastName}`}</CardTitle>
              <CardDescription>{statusInfo.description}</CardDescription>
            </div>
          </div>
          <Badge className={statusInfo.color}>
            {statusInfo.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showDetails && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Application Info</h4>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Submitted:</span>
                    <span>{formatDate(application.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Application ID:</span>
                    <span className="font-mono text-xs">{application.validationToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Email:</span>
                    <span>{application.email}</span>
                  </div>
                </div>
              </div>
              
              {application.agent && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Assigned Agent</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Name:</span>
                      <span>{application.agent.firstName} {application.agent.lastName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Email:</span>
                      <span>{application.agent.email}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {formData && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Business Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    {formData.businessType && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Business Type:</span>
                        <span>{formData.businessType}</span>
                      </div>
                    )}
                    {formData.yearsInBusiness && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Years in Business:</span>
                        <span>{formData.yearsInBusiness}</span>
                      </div>
                    )}
                    {formData.monthlyVolume && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Monthly Volume:</span>
                        <span>${formData.monthlyVolume}</span>
                      </div>
                    )}
                    {formData.averageTicket && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Average Ticket:</span>
                        <span>${formData.averageTicket}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {showActions && (
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={fetchApplicationStatus}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Status
            </Button>
            <Button asChild>
              <a href={`/application-status/${application.validationToken}`}>
                View Full Details
                <ExternalLink className="h-4 w-4 ml-2" />
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ApplicationStatusWidget;