import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Globe, Plus, Pencil, Trash2, Send, Loader2 } from "lucide-react";
import { EndpointEditorDialog, type EndpointShape } from "./endpoint-editor-dialog";

export function EndpointsManagement() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EndpointShape | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const { data: endpoints, isLoading } = useQuery<EndpointShape[]>({
    queryKey: ["/api/external-endpoints"],
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (ep: EndpointShape) => { setEditing(ep); setDialogOpen(true); };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/external-endpoints/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-endpoints"] });
      toast({ title: "Endpoint deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const testEndpoint = async (ep: EndpointShape) => {
    setTestingId(ep.id);
    try {
      const res = await apiRequest("POST", "/api/external-endpoints/test-send", { endpointId: ep.id });
      const json: any = await res.json();
      toast({
        title: json.success ? `Test OK (${json.status})` : `Test failed (${json.status ?? "?"})`,
        description: `${ep.method} ${ep.url} • ${json.elapsed ?? "?"}ms`,
        variant: json.success ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="w-5 h-5" /> External Endpoints
          </h3>
          <p className="text-sm text-muted-foreground">
            Reusable HTTP endpoints referenced by webhook templates and triggers.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-endpoint">
          <Plus className="w-4 h-4 mr-2" /> New Endpoint
        </Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading endpoints…</CardContent></Card>
      ) : !endpoints || endpoints.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No endpoints yet. Create one to get started.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {endpoints.map((ep) => (
            <Card key={ep.id} data-testid={`endpoint-card-${ep.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      {ep.name}
                      {!ep.isActive && <Badge variant="outline">Inactive</Badge>}
                    </CardTitle>
                    <CardDescription className="truncate">
                      <code className="text-xs">{ep.method} {ep.url}</code>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => testEndpoint(ep)} disabled={testingId === ep.id} data-testid={`button-test-${ep.id}`}>
                      {testingId === ep.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(ep)} data-testid={`button-edit-${ep.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete endpoint "${ep.name}"? Templates referencing it will lose the link.`)) {
                          deleteMutation.mutate(ep.id);
                        }
                      }}
                      data-testid={`button-delete-${ep.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {ep.description && (
                <CardContent className="pt-0 text-sm text-muted-foreground">{ep.description}</CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <EndpointEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
    </div>
  );
}
