import { useRoute } from 'wouter';
import { AlertCircle, Upload, FileText, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ApplicationStatus() {
  const [, params] = useRoute('/application-status/:token');
  const token = params?.token;

  // Fetch prospect data by token
  const { data: prospect, isLoading, error } = useQuery({
    queryKey: [`/api/prospects/status/${token}`],
    queryFn: async () => {
      const response = await fetch(`/api/prospects/status/${token}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!token,
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Application ID</h1>
          <p className="text-gray-600 mb-6">The application ID provided is not valid.</p>
          <Button onClick={() => window.location.href = '/'}>Return to Home</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading application status...</p>
        </div>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Application Not Found</h1>
          <p className="text-gray-600 mb-6">We couldn't find an application with this ID.</p>
          <Button onClick={() => window.location.href = '/'}>Return to Home</Button>
        </div>
      </div>
    );
  }

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'contacted': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-purple-100 text-purple-800';
      case 'submitted': return 'bg-indigo-100 text-indigo-800';
      case 'applied': return 'bg-indigo-100 text-indigo-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Application Status</h1>
          <p className="text-gray-600">Track your merchant application progress</p>
        </div>

        {/* Application Status Card */}
        <Card className="w-full">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-xl">
                  {formData.companyName || `${prospect.firstName} ${prospect.lastName}`}
                </CardTitle>
                <p className="text-gray-600 mt-1">Application ID: {prospect.id}</p>
              </div>
              <Badge className={getStatusColor(prospect.status)}>
                {prospect.status.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Timeline */}
            <div>
              <h3 className="font-semibold mb-3">Application Timeline</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Application Created:</span>
                  <span>{formatDate(prospect.createdAt)}</span>
                </div>
                {prospect.validatedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Email Validated:</span>
                    <span>{formatDate(prospect.validatedAt)}</span>
                  </div>
                )}
                {prospect.applicationStartedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Application Started:</span>
                    <span>{formatDate(prospect.applicationStartedAt)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Updated:</span>
                  <span>{formatDate(prospect.updatedAt)}</span>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div>
              <h3 className="font-semibold mb-3">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-600">Name:</span>
                  <p className="font-medium">{prospect.firstName} {prospect.lastName}</p>
                </div>
                <div>
                  <span className="text-gray-600">Email:</span>
                  <p className="font-medium">{prospect.email}</p>
                </div>
                {formData.companyName && (
                  <div>
                    <span className="text-gray-600">Company:</span>
                    <p className="font-medium">{formData.companyName}</p>
                  </div>
                )}
                {formData.companyPhone && (
                  <div>
                    <span className="text-gray-600">Phone:</span>
                    <p className="font-medium">{formData.companyPhone}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Next Steps */}
            <div>
              <h3 className="font-semibold mb-3">Next Steps</h3>
              <div className="bg-blue-50 p-4 rounded-lg">
                {prospect.status === 'pending' && (
                  <p className="text-blue-800">
                    Your application has been received. Our team will review it and contact you soon.
                  </p>
                )}
                {prospect.status === 'contacted' && (
                  <p className="text-blue-800">
                    Our agent has reached out to you. Please check your email for next steps.
                  </p>
                )}
                {prospect.status === 'in_progress' && (
                  <p className="text-blue-800">
                    Your application is being processed. We'll update you on the progress.
                  </p>
                )}
                {prospect.status === 'submitted' && (
                  <p className="text-blue-800">
                    Your application has been submitted for review. We'll notify you of the decision.
                  </p>
                )}
                {prospect.status === 'applied' && (
                  <p className="text-blue-800">
                    Your application has been submitted to our processing partner. We'll update you on the status.
                  </p>
                )}
                {prospect.status === 'approved' && (
                  <p className="text-green-800">
                    Congratulations! Your application has been approved. We'll be in touch with next steps.
                  </p>
                )}
                {prospect.status === 'rejected' && (
                  <p className="text-red-800">
                    Your application was not approved at this time. Please contact us for more information.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Document Upload Card - shown after application is submitted */}
        {(prospect.status === 'submitted' || prospect.status === 'applied' || prospect.status === 'in_progress' || prospect.status === 'approved') && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Document Management
              </CardTitle>
              <CardDescription>
                Upload supporting documents or access your full prospect portal
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-start gap-4">
                  <Upload className="h-8 w-8 text-blue-600 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">Upload Supporting Documents</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      You can upload bank statements, business licenses, identification documents, and other supporting materials through your prospect portal.
                    </p>
                    <div className="mt-4">
                      <Button 
                        onClick={() => window.location.href = '/prospect-portal'}
                        className="gap-2"
                        data-testid="button-go-to-portal"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Go to Prospect Portal
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Note: You'll need to log in with your email address to access the prospect portal. If you haven't set up your password yet, use the password reset option.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}