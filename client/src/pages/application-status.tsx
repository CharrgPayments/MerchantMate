import { useState } from "react";
import { useRoute, useLocation } from 'wouter';
import { AlertCircle, Download, Shield, Eye, EyeOff, LogIn, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function ApplicationStatus() {
  const [, params] = useRoute('/application-status/:token');
  const token = params?.token;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [portalCreated, setPortalCreated] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const dbEnv = urlParams.get("db") || "";

  // Fetch prospect data by token
  const { data: prospect, isLoading, error } = useQuery({
    queryKey: [`/api/prospects/status/${token}`],
    queryFn: async () => {
      const response = await fetch(`/api/prospects/status/${token}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    },
    enabled: !!token,
  });

  const setupPortalMutation = useMutation({
    mutationFn: async () => {
      const url = dbEnv ? `/api/portal/setup-password?db=${dbEnv}` : `/api/portal/setup-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create account");
      return data;
    },
    onSuccess: () => {
      setPortalCreated(true);
      toast({ title: "Portal account created!", description: "You can now sign in to your applicant portal." });
    },
    onError: (err: Error) => {
      if (err.message.includes("already set up")) {
        toast({ title: "Account already exists", description: "You already have a portal account. Redirecting to login...", variant: "default" });
        setTimeout(() => navigate(dbEnv ? `/portal/login?db=${dbEnv}` : "/portal/login"), 1500);
      } else {
        toast({ title: "Setup failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const handleSetupPortal = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please make sure both passwords are the same.", variant: "destructive" });
      return;
    }
    setupPortalMutation.mutate();
  };

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

  let formData: any = {};
  if (prospect?.formData) {
    try { formData = JSON.parse(prospect.formData); } catch { formData = {}; }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not available';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  const hasPortalAccount = !!prospect.portalSetupAt;

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
                {prospect.status === 'pending' && <p className="text-blue-800">Your application has been received. Our team will review it and contact you soon.</p>}
                {prospect.status === 'contacted' && <p className="text-blue-800">Our agent has reached out to you. Please check your email for next steps.</p>}
                {prospect.status === 'in_progress' && <p className="text-blue-800">Your application is being processed. We'll update you on the progress.</p>}
                {prospect.status === 'submitted' && <p className="text-blue-800">Your application has been submitted for review. We'll notify you of the decision.</p>}
                {prospect.status === 'applied' && <p className="text-blue-800">Your application has been submitted to our processing partner. We'll update you on the status.</p>}
                {prospect.status === 'approved' && <p className="text-green-800">Congratulations! Your application has been approved. We'll be in touch with next steps.</p>}
                {prospect.hasGeneratedPdf && (prospect.status === 'submitted' || prospect.status === 'applied' || prospect.status === 'approved') && (
                  <div className="mt-4 pt-4 border-t border-blue-200">
                    <a href={`/api/prospects/download-filled-pdf/${token}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="w-full">
                        <Download className="w-4 h-4 mr-2" />
                        Download Application PDF
                      </Button>
                    </a>
                  </div>
                )}
                {prospect.status === 'rejected' && <p className="text-red-800">Your application was not approved at this time. Please contact us for more information.</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Prospect Portal Section */}
        {!hasPortalAccount ? (
          <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Create Your Applicant Portal Account</CardTitle>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Set up a password to access your portal — message your agent and upload documents securely.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {portalCreated ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                    <p className="text-green-800 text-sm font-medium">Portal account created! You can now sign in to your applicant portal.</p>
                  </div>
                  <Button className="w-full" onClick={() => navigate(dbEnv ? `/portal?db=${dbEnv}` : "/portal")}>
                    <LogIn className="w-4 h-4 mr-2" />
                    Go to My Portal
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSetupPortal} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-email">Email address</Label>
                      <Input id="portal-email" type="email" value={prospect.email} readOnly className="bg-gray-100 cursor-not-allowed" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-password">Create a password</Label>
                      <div className="relative">
                        <Input
                          id="portal-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Min 8 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="pr-10"
                        />
                        <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-confirm">Confirm password</Label>
                      <Input
                        id="portal-confirm"
                        type={showPassword ? "text" : "password"}
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full sm:w-auto" disabled={setupPortalMutation.isPending}>
                    <Shield className="w-4 h-4 mr-2" />
                    {setupPortalMutation.isPending ? "Creating account..." : "Create Portal Account"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                <div>
                  <p className="font-medium text-green-900">You have a portal account</p>
                  <p className="text-sm text-green-700">Sign in to message your agent and manage document uploads.</p>
                </div>
              </div>
              <Button variant="outline" className="border-green-300 text-green-800 hover:bg-green-100 shrink-0"
                onClick={() => navigate(dbEnv ? `/portal/login?db=${dbEnv}` : "/portal/login")}>
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
