import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface PasswordConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  title?: string;
  description?: string;
}

export function PasswordConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Sensitive Operation",
  description = "This action requires password verification for security purposes. Please enter your password to continue.",
}: PasswordConfirmationDialogProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const verifyMutation = useMutation({
    mutationFn: async (password: string) => {
      return await apiRequest("POST", "/api/auth/verify-password", { password });
    },
    onSuccess: (_data, password) => {
      setError("");
      onConfirm(password); // Pass the verified password to the callback
      setPassword("");
      onClose();
    },
    onError: (error: any) => {
      // Handle session expiration
      if (error.message?.includes("401") || error.message?.includes("Authentication")) {
        setError("Your session has expired. Please log in again.");
        setTimeout(() => {
          window.location.href = "/auth";
        }, 2000);
      } else {
        setError("Verification failed. Please check your password.");
      }
      setPassword(""); // Clear password on error for security
    },
  });

  const handleVerify = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }

    setError("");
    verifyMutation.mutate(password);
  };

  const handleClose = () => {
    setPassword("");
    setError("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent data-testid="password-confirmation-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !verifyMutation.isPending) {
                  handleVerify();
                }
              }}
              placeholder="Enter your password"
              disabled={verifyMutation.isPending}
              data-testid="input-password-confirm"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={verifyMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleVerify}
            disabled={verifyMutation.isPending || !password}
            data-testid="button-confirm"
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              "Confirm"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
