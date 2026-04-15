import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, EyeOff, LogIn, Mail, CheckCircle } from "lucide-react";

export default function PortalLogin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const dbEnv = urlParams.get("db") || "";

  const loginMutation = useMutation({
    mutationFn: async () => {
      const url = dbEnv ? `/api/portal/login?db=${dbEnv}` : "/api/portal/login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: () => {
      navigate(dbEnv ? `/portal?db=${dbEnv}` : "/portal");
    },
    onError: (err: Error) => {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    },
  });

  const magicLinkMutation = useMutation({
    mutationFn: async () => {
      const url = dbEnv ? `/api/portal/magic-link-request?db=${dbEnv}` : "/api/portal/magic-link-request";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: magicEmail }),
      });
      if (!res.ok) throw new Error("Failed to send link");
      return res.json();
    },
    onSuccess: () => setMagicSent(true),
    onError: () => {
      toast({ title: "Error", description: "Could not send sign-in link. Please try again.", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Required", description: "Please enter your email and password.", variant: "destructive" });
      return;
    }
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Applicant Portal</h1>
          <p className="text-gray-500 mt-1">Sign in to track your application</p>
        </div>

        <Card className="shadow-xl border-0">
          {/* Mode toggle */}
          <div className="flex border-b">
            <button
              type="button"
              onClick={() => setMode("password")}
              className={`flex-1 py-3 text-sm font-medium transition-colors rounded-tl-lg ${mode === "password" ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            >
              <LogIn className="w-4 h-4 inline mr-1.5" />
              Password
            </button>
            <button
              type="button"
              onClick={() => { setMode("magic"); setMagicSent(false); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors rounded-tr-lg ${mode === "magic" ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            >
              <Mail className="w-4 h-4 inline mr-1.5" />
              Email link
            </button>
          </div>

          <CardContent className="pt-6">
            {mode === "password" && (
              <>
                <CardHeader className="px-0 pt-0 pb-4">
                  <CardTitle className="text-xl">Welcome back</CardTitle>
                  <CardDescription>Enter your email and portal password to continue</CardDescription>
                </CardHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Your portal password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                    <LogIn className="w-4 h-4 mr-2" />
                    {loginMutation.isPending ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
                <p className="text-center text-sm text-gray-500 mt-6">
                  No password?{" "}
                  <button type="button" className="text-blue-600 underline" onClick={() => { setMode("magic"); setMagicSent(false); }}>
                    Get a sign-in link instead
                  </button>
                </p>
              </>
            )}

            {mode === "magic" && !magicSent && (
              <>
                <CardHeader className="px-0 pt-0 pb-4">
                  <CardTitle className="text-xl">Email sign-in link</CardTitle>
                  <CardDescription>We'll send a one-click sign-in link to your email address. Valid for 24 hours.</CardDescription>
                </CardHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="magic-email">Email address</Label>
                    <Input
                      id="magic-email"
                      type="email"
                      placeholder="you@example.com"
                      value={magicEmail}
                      onChange={(e) => setMagicEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={magicLinkMutation.isPending || !magicEmail.trim()}
                    onClick={() => magicLinkMutation.mutate()}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    {magicLinkMutation.isPending ? "Sending…" : "Send Sign-In Link"}
                  </Button>
                </div>
                <p className="text-center text-sm text-gray-500 mt-6">
                  Have a password?{" "}
                  <button type="button" className="text-blue-600 underline" onClick={() => setMode("password")}>
                    Sign in with password
                  </button>
                </p>
              </>
            )}

            {mode === "magic" && magicSent && (
              <div className="py-6 text-center space-y-4">
                <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
                <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
                <p className="text-gray-500 text-sm">
                  If <strong>{magicEmail}</strong> matches an application, a sign-in link is on its way. The link is valid for 24 hours and can only be used once.
                </p>
                <button
                  type="button"
                  className="text-blue-600 text-sm underline"
                  onClick={() => { setMagicSent(false); setMagicEmail(""); }}
                >
                  Use a different email
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">
          Secure applicant portal · Powered by CoreCRM
        </p>
      </div>
    </div>
  );
}
