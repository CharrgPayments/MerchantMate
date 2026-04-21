import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

export type EndpointShape = {
  id: number;
  name: string;
  description?: string | null;
  url: string;
  method: string;
  headers?: Record<string, string> | null;
  authType: string;
  authConfig?: Record<string, any> | null;
  timeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds: number;
  isActive: boolean;
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const AUTH_TYPES = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "api_key", label: "API Key" },
];

const emptyForm = {
  name: "",
  description: "",
  url: "",
  method: "POST" as (typeof HTTP_METHODS)[number],
  headersText: "{}",
  authType: "none",
  authConfigText: "{}",
  timeoutSeconds: 30,
  maxRetries: 0,
  retryDelaySeconds: 5,
  isActive: true,
};

interface EndpointEditorDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: EndpointShape | null;
  /** Called with the saved endpoint's id (useful for "create then select" flows). */
  onSaved?: (id: number) => void;
}

export function EndpointEditorDialog({ open, onOpenChange, editing, onSaved }: EndpointEditorDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? "",
        url: editing.url,
        method: (editing.method as any) || "POST",
        headersText: JSON.stringify(editing.headers ?? {}, null, 2),
        authType: editing.authType || "none",
        authConfigText: JSON.stringify(editing.authConfig ?? {}, null, 2),
        timeoutSeconds: editing.timeoutSeconds ?? 30,
        maxRetries: editing.maxRetries ?? 0,
        retryDelaySeconds: editing.retryDelaySeconds ?? 5,
        isActive: editing.isActive,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let headers: Record<string, string> = {};
      let authConfig: Record<string, any> = {};
      try { headers = JSON.parse(form.headersText || "{}"); }
      catch { throw new Error("Headers must be valid JSON"); }
      try { authConfig = JSON.parse(form.authConfigText || "{}"); }
      catch { throw new Error("Auth config must be valid JSON"); }

      const payload = {
        name: form.name,
        description: form.description || undefined,
        url: form.url,
        method: form.method,
        headers,
        authType: form.authType,
        authConfig,
        timeoutSeconds: form.timeoutSeconds,
        maxRetries: form.maxRetries,
        retryDelaySeconds: form.retryDelaySeconds,
        isActive: form.isActive,
      };
      const res = editing
        ? await apiRequest("PUT", `/api/external-endpoints/${editing.id}`, payload)
        : await apiRequest("POST", "/api/external-endpoints", payload);
      return res.json();
    },
    onSuccess: (saved: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-endpoints"] });
      toast({ title: editing ? "Endpoint updated" : "Endpoint created" });
      onOpenChange(false);
      if (onSaved && saved?.id) onSaved(saved.id);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Endpoint" : "New Endpoint"}</DialogTitle>
          <DialogDescription>
            Configure transport details (URL, method, headers, auth) once, then reference this endpoint from any webhook template.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-endpoint-name" />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label>Active</Label>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div>
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://api.example.com/v1/things" data-testid="input-endpoint-url" />
            </div>
          </div>

          <div>
            <Label>Headers (JSON)</Label>
            <Textarea rows={3} className="font-mono text-xs" value={form.headersText} onChange={(e) => setForm({ ...form, headersText: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Auth Type</Label>
              <Select value={form.authType} onValueChange={(v) => setForm({ ...form, authType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTH_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Timeout (s)</Label>
              <Input type="number" value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: parseInt(e.target.value || "30", 10) })} />
            </div>
          </div>

          {form.authType !== "none" && (
            <div>
              <Label>Auth Config (JSON)</Label>
              <Textarea rows={3} className="font-mono text-xs" value={form.authConfigText} onChange={(e) => setForm({ ...form, authConfigText: e.target.value })} placeholder='{"token":"{{$MY_SECRET}}"}' />
              <p className="text-xs text-muted-foreground mt-1">
                Use <code>{"{{$SECRET_NAME}}"}</code> to reference environment secrets.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Max Retries</Label>
              <Input type="number" value={form.maxRetries} onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value || "0", 10) })} />
            </div>
            <div>
              <Label>Retry Delay (s)</Label>
              <Input type="number" value={form.retryDelaySeconds} onChange={(e) => setForm({ ...form, retryDelaySeconds: parseInt(e.target.value || "5", 10) })} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-endpoint">
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
