import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, AlertCircle, Building2 } from "lucide-react";
import { z } from "zod";

const validationSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ValidationData = z.infer<typeof validationSchema>;

export default function ProspectValidation() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [validationState, setValidationState] = useState<'initial' | 'validating' | 'success' | 'error'>('initial');
  const [errorMessage, setErrorMessage] = useState("");
  const [prospectData, setProspectData] = useState<any>(null);

  // Check for prospect validation token in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const prospectToken = urlParams.get('token');

  const form = useForm<ValidationData>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      email: "",
    },
  });

  // Token-based auto-validation as a proper mutation (POST semantics)
  const validateByTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await fetch("/api/prospects/validate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Token validation failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setValidationState('success');
      setProspectData(data.prospect);
      toast({
        title: "Email Validated",
        description: "Redirecting to merchant application...",
      });
      setTimeout(() => {
        setLocation(`/merchant-application?token=${data.prospect.validationToken}`);
      }, 1500);
    },
    onError: (error: Error) => {
      setValidationState('error');
      setErrorMessage(error.message);
    },
  });

  // Auto-validate if token is present in URL (fires once on mount when token exists)
  useEffect(() => {
    if (prospectToken && validationState === 'initial') {
      setValidationState('validating');
      validateByTokenMutation.mutate(prospectToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectToken]);

  const validateMutation = useMutation({
    mutationFn: async (data: ValidationData) => {
      const response = await fetch("/api/prospects/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Validation failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setValidationState('success');
      setProspectData(data.prospect);
      toast({
        title: "Email Validated",
        description: "Redirecting to merchant application...",
      });
      
      // Automatically redirect to merchant application
      if (data.prospect?.validationToken) {
        setTimeout(() => {
          setLocation(`/merchant-application?token=${data.prospect.validationToken}`);
        }, 1500);
      }
    },
    onError: (error: Error) => {
      setValidationState('error');
      setErrorMessage(error.message);
    },
  });

  const onSubmit = async (data: ValidationData) => {
    setValidationState('validating');
    setErrorMessage("");
    validateMutation.mutate(data);
  };

  const startApplication = () => {
    if (prospectData?.validationToken) {
      // Navigate to merchant application with the validation token
      setLocation(`/merchant-application?token=${prospectData.validationToken}`);
    }
  };

  if (validationState === 'success' && prospectData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle className="text-xl font-semibold text-gray-900">
                Email Verified Successfully
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Welcome,</p>
                <p className="font-semibold text-gray-900">
                  {prospectData.firstName} {prospectData.lastName}
                </p>
                <p className="text-sm text-gray-500 mt-1">{prospectData.email}</p>
              </div>

              <div className="text-left">
                <p className="text-sm text-gray-600 mb-4">
                  Your email has been verified. You can now proceed to complete your merchant processing application.
                </p>
                <Alert>
                  <Building2 className="h-4 w-4" />
                  <AlertDescription>
                    This application will guide you through providing your business information, 
                    processing requirements, and documentation needed for merchant account setup.
                  </AlertDescription>
                </Alert>
              </div>

              <Button onClick={startApplication} className="w-full" size="lg">
                Start Merchant Application
              </Button>

              <p className="text-xs text-gray-500">
                If you have any questions, please contact your assigned agent or our support team.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show loading state when auto-validating with token
  if (validationState === 'validating' && prospectToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-6">
              <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <CardTitle className="text-xl font-semibold text-gray-900">
                Validating Invitation
              </CardTitle>
              <p className="text-sm text-gray-600 mt-2">
                Please wait while we verify your invitation...
              </p>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card className="border-0 shadow-lg">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Mail className="w-6 h-6 text-blue-600" />
            </div>
            <CardTitle className="text-xl font-semibold text-gray-900">
              Verify Your Email
            </CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Enter the exact email address that received the invitation from your agent
            </p>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="Enter the email that received the invitation"
                          disabled={validationState === 'validating'}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      <p className="text-xs text-gray-500 mt-1">
                        This must be the exact email address your agent sent the invitation to
                      </p>
                    </FormItem>
                  )}
                />

                {validationState === 'error' && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {errorMessage}
                    </AlertDescription>
                  </Alert>
                )}

                <Button 
                  type="submit" 
                  className="w-full" 
                  size="lg"
                  disabled={validationState === 'validating'}
                >
                  {validationState === 'validating' ? "Verifying..." : "Verify Email"}
                </Button>
              </form>
            </Form>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="text-center">
                <p className="text-xs text-gray-500">
                  This verification ensures you have been invited by one of our authorized agents to begin the merchant application process.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}