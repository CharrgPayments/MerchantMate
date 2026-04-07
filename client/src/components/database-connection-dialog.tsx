import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, Database } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DatabaseEnvironment {
  environment: string;
  available: boolean;
  isConfigured: boolean;
}

interface ConnectionStatus {
  success: boolean;
  currentEnvironment: string;
  availableEnvironments: DatabaseEnvironment[];
  canSwitch: boolean;
}

interface DatabaseConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onEnvironmentChange?: (environment: string) => void;
}

export function DatabaseConnectionDialog({
  open,
  onClose,
  onEnvironmentChange
}: DatabaseConnectionDialogProps) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      checkConnectionStatus();
    }
  }, [open]);

  const checkConnectionStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/database-connection-status');
      const data = await response.json();
      
      if (data.success) {
        setStatus(data);
      } else {
        setError(data.message || 'Failed to check connection status');
      }
    } catch (err) {
      console.error('Error checking connection status:', err);
      setError('Failed to check database connection status');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchEnvironment = async (environment: string) => {
    try {
      setSwitching(true);
      setError(null);

      const response = await apiRequest('/api/admin/environment', {
        method: 'POST',
        body: JSON.stringify({ environment }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.success) {
        // Notify parent and reload page to use new environment
        if (onEnvironmentChange) {
          onEnvironmentChange(environment);
        }
        
        // Reload the page to reconnect with new environment
        window.location.reload();
      } else {
        setError(response.message || 'Failed to switch environment');
      }
    } catch (err) {
      console.error('Error switching environment:', err);
      setError('Failed to switch database environment');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Connection Issue
          </DialogTitle>
          <DialogDescription>
            The application couldn't connect to the requested database environment.
            Please select an available environment to continue.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : status ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <p className="text-sm font-medium mb-2">Current Environment</p>
              <p className="text-sm text-muted-foreground">{status.currentEnvironment}</p>
            </div>

            {!status.canSwitch && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Environment switching is disabled for production URLs. Please use a development URL to change environments.
                </AlertDescription>
              </Alert>
            )}

            {status.canSwitch && (
              <>
                <div>
                  <p className="text-sm font-medium mb-3">Available Environments</p>
                  <div className="space-y-2">
                    {status.availableEnvironments.map((env) => (
                      <div
                        key={env.environment}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {env.available ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="text-sm font-medium capitalize">{env.environment}</p>
                            <p className="text-xs text-muted-foreground">
                              {env.isConfigured ? 'Configured' : 'Not configured'}
                            </p>
                          </div>
                        </div>
                        {env.available && env.environment !== status.currentEnvironment && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSwitchEnvironment(env.environment)}
                            disabled={switching}
                            data-testid={`button-switch-${env.environment}`}
                          >
                            {switching ? 'Switching...' : 'Switch'}
                          </Button>
                        )}
                        {env.environment === status.currentEnvironment && (
                          <span className="text-xs text-muted-foreground">Current</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Switching environments will reload the application and connect to a different database.
                    Make sure the selected environment has the necessary database configured.
                  </AlertDescription>
                </Alert>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={switching}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
