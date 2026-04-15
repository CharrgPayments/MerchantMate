import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function PortalMagicLogin() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const urlParams = new URLSearchParams(window.location.search);
  const dbEnv = urlParams.get("db") || "";

  useEffect(() => {
    const token = window.location.hash.replace("#token=", "").trim();
    if (!token) {
      setStatus("error");
      setErrorMsg("No sign-in token found in this link. Please request a new one.");
      return;
    }

    const url = dbEnv ? `/api/portal/magic-link-login?db=${dbEnv}` : "/api/portal/magic-link-login";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Sign-in failed");
        }
        return res.json();
      })
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate(dbEnv ? `/portal?db=${dbEnv}` : "/portal"), 1500);
      })
      .catch((err: Error) => {
        setStatus("error");
        setErrorMsg(err.message);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-6 shadow-lg">
          <Shield className="w-8 h-8 text-white" />
        </div>

        {status === "loading" && (
          <>
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Signing you in…</h1>
            <p className="text-gray-500">Verifying your sign-in link, one moment.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Signed in!</h1>
            <p className="text-gray-500">Redirecting you to your portal…</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-14 h-14 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign-in failed</h1>
            <p className="text-gray-500 mb-6">{errorMsg}</p>
            <Link href={dbEnv ? `/portal/login?db=${dbEnv}` : "/portal/login"}>
              <Button variant="outline">Back to sign-in</Button>
            </Link>
          </>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          Secure applicant portal · Powered by CoreCRM
        </p>
      </div>
    </div>
  );
}
