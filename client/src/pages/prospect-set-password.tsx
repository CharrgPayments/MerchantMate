import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Eye, EyeOff, CheckCircle, KeyRound, RefreshCw, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { z } from "zod";

function getUrlParams(): { token: string | null; db: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    token: params.get('token'),
    db: params.get('db')
  };
}

function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (password.length < 12) {
    return { valid: false, error: "Password must be at least 12 characters long" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: "Password must contain at least one special character" };
  }
  return { valid: true };
}

const setPasswordSchema = z.object({
  password: z.string().min(12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
}).refine((data) => {
  const validation = validatePasswordStrength(data.password);
  return validation.valid;
}, {
  message: "Password must contain uppercase, lowercase, number, and special character",
  path: ["password"],
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SetPasswordForm = z.infer<typeof setPasswordSchema>;

export default function ProspectSetPassword() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { token, db } = getUrlParams();

  const form = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: async (data: SetPasswordForm) => {
      const dbParam = db ? `?db=${db}` : "";
      const response = await fetch(`/api/prospects/auth/set-password${dbParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          token,
          password: data.password,
          // Also send db in the body as a fallback for middleware detection
          ...(db ? { database: db } : {})
        }),
        credentials: "include"
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || "Failed to set password");
      }
      
      return result;
    },
    onSuccess: () => {
      setIsSuccess(true);
      toast({
        title: "Password Set Successfully",
        description: "You can now log in to your prospect portal",
      });
    },
    onError: (error: any) => {
      const msg: string = error.message || "";
      if (msg.toLowerCase().includes("invalid or expired") || msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("expired")) {
        setIsTokenInvalid(true);
      } else {
        toast({
          title: "Failed to Set Password",
          description: msg,
          variant: "destructive",
        });
      }
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (email: string) => {
      const dbParam = db ? `?db=${db}` : "";
      const response = await fetch(`/api/prospects/auth/resend-activation${dbParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(db ? { database: db } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Failed to resend");
      return result;
    },
    onSuccess: () => {
      setResendSent(true);
    },
    onError: (error: any) => {
      toast({
        title: "Resend Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SetPasswordForm) => {
    setPasswordMutation.mutate(data);
  };

  const handleGoToLogin = () => {
    const dbParam = db ? `?db=${db}` : "";
    window.location.href = `/prospect-login${dbParam}`;
  };

  // Token invalid/expired UI — shown either when no token in URL, or after a 400 error
  const showInvalidToken = !token || isTokenInvalid;
  if (showInvalidToken) {
    if (resendSent) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <Mail className="w-10 h-10 text-green-600" />
              </div>
              <CardTitle className="text-2xl text-green-600">Activation Email Sent</CardTitle>
              <CardDescription className="text-base">
                A new activation link has been sent to <strong>{resendEmail}</strong>. Please check your inbox (and spam folder) and click the link to set your password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => window.location.href = "/prospect-login"} variant="outline" className="w-full">
                Go to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-red-600">Link Expired or Invalid</CardTitle>
            <CardDescription className="text-base">
              This activation link has expired or has already been used. Enter your email below to receive a fresh activation link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resend-email">Email Address</Label>
              <Input
                id="resend-email"
                type="email"
                placeholder="your@email.com"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                disabled={resendMutation.isPending}
              />
            </div>
            <Button
              onClick={() => resendEmail && resendMutation.mutate(resendEmail)}
              disabled={!resendEmail || resendMutation.isPending}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
            >
              {resendMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</>
              ) : (
                <><RefreshCw className="mr-2 h-4 w-4" />Send New Activation Link</>
              )}
            </Button>
            <p className="text-center text-sm text-gray-500">
              Already have a password?{" "}
              <button onClick={() => window.location.href = "/prospect-login"} className="text-orange-600 hover:underline font-medium">
                Sign in
              </button>
            </p>
            <p className="text-center text-xs text-gray-400">
              If you continue to have trouble, please contact your agent or{" "}
              <a href="mailto:support@charrg.com" className="underline">support</a>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <CardTitle className="text-2xl text-green-600">Password Set!</CardTitle>
            <CardDescription className="text-base">
              Your password has been set successfully. You can now log in to access your merchant application portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleGoToLogin}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
              data-testid="button-go-to-login"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mb-2">
            <KeyRound className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold">Set Your Password</CardTitle>
          <CardDescription className="text-base">
            Create a secure password for your prospect portal account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-set-password">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  {...form.register("password")}
                  disabled={setPasswordMutation.isPending}
                  className="pr-10"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-sm text-red-500">{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  {...form.register("confirmPassword")}
                  disabled={setPasswordMutation.isPending}
                  className="pr-10"
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.confirmPassword && (
                <p className="text-sm text-red-500">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-sm text-blue-800">
                <strong>Password Requirements:</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>At least 12 characters</li>
                  <li>One uppercase letter (A-Z)</li>
                  <li>One lowercase letter (a-z)</li>
                  <li>One number (0-9)</li>
                  <li>One special character (!@#$%^&*...)</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
              disabled={setPasswordMutation.isPending}
              data-testid="button-set-password"
            >
              {setPasswordMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting Password...
                </>
              ) : (
                "Set Password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
