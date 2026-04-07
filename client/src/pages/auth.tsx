import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff, Shield, User, Lock, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { z } from "zod";
import { getUserTimezone } from "@/lib/timezone";

// Form schemas
const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email required"),
  password: z.string().min(1, "Password required"),
  twoFactorCode: z.string().optional(),
  database: z.string().optional(),
});



const forgotPasswordSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email required"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

export default function Auth() {
  const [activeTab, setActiveTab] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { refetch } = useAuth();

  // Check if we're in development environment
  const isNonProduction = import.meta.env.DEV || 
    window.location.hostname === 'localhost' ||
    window.location.hostname.includes('.dev') ||
    window.location.hostname.includes('test') ||
    window.location.port !== '';

  const [selectedDatabase, setSelectedDatabase] = useState("dev");



  // Login form
  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      usernameOrEmail: "",
      password: "",
      twoFactorCode: "",
      database: "dev",
    },
  });



  // Forgot password form
  const forgotPasswordForm = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      usernameOrEmail: "",
    },
  });

  // Reset password form
  const resetPasswordForm = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: resetToken,
      password: "",
      confirmPassword: "",
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      // Automatically include user's timezone
      const loginData = {
        ...data,
        timezone: getUserTimezone()
      };
      
      // Build URL with database parameter in non-production environments
      let url = "/api/auth/login";
      if (isNonProduction && data.database) {
        url += `?db=${data.database}`;
      }
      
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginData),
        credentials: "include"
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        if (result.requires2FA) {
          return result; // Return the 2FA response even though it's technically an error
        }
        throw new Error(result.message || "Login failed");
      }
      
      return result;
    },
    onSuccess: async (data) => {
      if (data.requires2FA) {
        setRequires2FA(true);
        toast({
          title: "Security Code Required",
          description: data.message,
        });
      } else if (data.success) {
        toast({
          title: "Login Successful",
          description: "Welcome to CoreCRM!",
        });
        
        // Force complete page reload to ensure proper state management
        window.location.href = "/";
      }
    },
    onError: (error: any) => {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });



  // Forgot password mutation
  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordForm) => {
      const response = await apiRequest("POST", "/api/auth/forgot-password", data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reset Email Sent",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Request Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ResetPasswordForm) => {
      const response = await apiRequest("POST", "/api/auth/reset-password", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Password Reset Successful",
          description: data.message,
        });
        setActiveTab("login");
        setResetToken("");
      } else {
        toast({
          title: "Reset Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onLoginSubmit = (data: LoginForm) => {
    loginMutation.mutate(data);
  };



  const onForgotPasswordSubmit = (data: ForgotPasswordForm) => {
    forgotPasswordMutation.mutate(data);
  };

  const onResetPasswordSubmit = (data: ResetPasswordForm) => {
    resetPasswordMutation.mutate(data);
  };

  // Check URL for reset token
  useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    if (token) {
      setResetToken(token);
      setActiveTab("reset");
      resetPasswordForm.setValue("token", token);
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">CoreCRM</CardTitle>
          <CardDescription>
            Secure payment management platform
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-1">
              <TabsTrigger value="login">Login</TabsTrigger>
            </TabsList>

            {/* Login Tab */}
            <TabsContent value="login" className="space-y-4">
              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="usernameOrEmail">Username or Email</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="usernameOrEmail"
                      placeholder="Enter username or email"
                      className="pl-10"
                      {...loginForm.register("usernameOrEmail")}
                    />
                  </div>
                  {loginForm.formState.errors.usernameOrEmail && (
                    <p className="text-sm text-red-500">
                      {loginForm.formState.errors.usernameOrEmail.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter password"
                      className="pl-10 pr-10"
                      {...loginForm.register("password")}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-3 h-4 w-4 text-gray-400 hover:text-gray-600"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                  {loginForm.formState.errors.password && (
                    <p className="text-sm text-red-500">
                      {loginForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                {/* Environment Selection - only show in non-production environments */}
                {isNonProduction && (
                  <div className="space-y-2">
                    <Label htmlFor="database">Environment</Label>
                    <div className="relative">
                      <Database className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Select
                        value={selectedDatabase}
                        onValueChange={(value) => {
                          setSelectedDatabase(value);
                          loginForm.setValue("database", value);
                        }}
                      >
                        <SelectTrigger className="pl-10">
                          <SelectValue placeholder="Select environment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dev" className="flex items-center">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span>Development</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="test" className="flex items-center">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                              <span>Test</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-gray-500">
                      {selectedDatabase === "dev" && (
                        <span className="flex items-center space-x-1">
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          <span>Login to isolated development environment</span>
                        </span>
                      )}
                      {selectedDatabase === "test" && (
                        <span className="flex items-center space-x-1">
                          <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                          <span>Login to isolated test environment</span>
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {requires2FA && (
                  <div className="space-y-2">
                    <Label htmlFor="twoFactorCode">Security Code</Label>
                    <Input
                      id="twoFactorCode"
                      placeholder="Enter 6-digit code"
                      maxLength={6}
                      {...loginForm.register("twoFactorCode")}
                    />
                    <p className="text-sm text-gray-500">
                      Check your email for the security code
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setActiveTab("forgot")}
                >
                  Forgot your password?
                </button>
              </div>
            </TabsContent>



            {/* Forgot Password Tab */}
            <TabsContent value="forgot" className="space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold">Reset Password</h3>
                <p className="text-sm text-gray-600">
                  Enter your username or email to receive reset instructions
                </p>
              </div>

              <form onSubmit={forgotPasswordForm.handleSubmit(onForgotPasswordSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgotUsernameOrEmail">Username or Email</Label>
                  <Input
                    id="forgotUsernameOrEmail"
                    placeholder="Enter username or email"
                    {...forgotPasswordForm.register("usernameOrEmail")}
                  />
                  {forgotPasswordForm.formState.errors.usernameOrEmail && (
                    <p className="text-sm text-red-500">
                      {forgotPasswordForm.formState.errors.usernameOrEmail.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={forgotPasswordMutation.isPending}
                >
                  {forgotPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setActiveTab("login")}
                >
                  Back to login
                </button>
              </div>
            </TabsContent>

            {/* Reset Password Tab */}
            <TabsContent value="reset" className="space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold">Create New Password</h3>
                <p className="text-sm text-gray-600">
                  Enter your new password below
                </p>
              </div>

              <form onSubmit={resetPasswordForm.handleSubmit(onResetPasswordSubmit)} className="space-y-4">
                <input type="hidden" {...resetPasswordForm.register("token")} />

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password"
                    {...resetPasswordForm.register("password")}
                  />
                  {resetPasswordForm.formState.errors.password && (
                    <p className="text-sm text-red-500">
                      {resetPasswordForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    placeholder="Confirm new password"
                    {...resetPasswordForm.register("confirmPassword")}
                  />
                  {resetPasswordForm.formState.errors.confirmPassword && (
                    <p className="text-sm text-red-500">
                      {resetPasswordForm.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={resetPasswordMutation.isPending}
                >
                  {resetPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>

        <CardFooter className="text-center space-y-3">
          <p className="text-xs text-gray-500 w-full">
            Secure authentication with 2FA protection and IP monitoring
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}