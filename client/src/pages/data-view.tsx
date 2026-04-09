import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiDataGrid, type RowExpansionConfig } from "@/components/ApiDataGrid";
import {
  ArrowLeft,
  Database,
  ExternalLink,
  Settings2,
  AlertCircle,
} from "lucide-react";

export default function DataViewPage() {
  const [, params] = useRoute("/data-view/:templateId");
  const [, navigate] = useLocation();

  const templateId = params?.templateId ? Number(params.templateId) : null;

  const { data: template, isLoading, isError } = useQuery<{
    id: number;
    name: string;
    description: string | null;
    actionType: string;
    category: string;
    config: Record<string, unknown>;
    isActive: boolean;
  }>({
    queryKey: ["/api/action-templates", templateId, "meta"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${templateId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Template not found");
      return res.json();
    },
    enabled: templateId != null,
    staleTime: 60_000,
  });

  if (!templateId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-sm">Invalid template ID.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/action-templates")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Templates
        </Button>
      </div>
    );
  }

  // Derive display options from template config
  const columns = (template?.config?.columns as string[] | undefined) || undefined;
  const dataPath = (template?.config?.dataPath as string | undefined) || undefined;
  const templateFieldLabels = (template?.config?.fieldLabels as Record<string, string> | undefined) || {};
  // Convert stored rowExpansion config to the component-expected shape
  const rowExpansion: RowExpansionConfig | undefined = (() => {
    const re = template?.config?.rowExpansion as Record<string, unknown> | undefined;
    if (!re || !re.templateId || !re.rowKeyField) return undefined;
    return {
      templateId: Number(re.templateId),
      rowKeyField: String(re.rowKeyField),
      routeParamName: re.routeParamName ? String(re.routeParamName) : String(re.rowKeyField),
      label: re.label ? String(re.label) : undefined,
      // columns stored as comma-string, convert to array
      columns: re.columns
        ? String(re.columns).split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      dataPath: re.dataPath ? String(re.dataPath) : undefined,
    } satisfies RowExpansionConfig;
  })();

  return (
    <div className="flex flex-col gap-6 p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 shrink-0"
          onClick={() => navigate("/action-templates")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Templates
        </Button>

        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm font-medium">Template not found</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold truncate">{template?.name}</h1>
                <Badge variant="outline" className="gap-1 text-xs shrink-0">
                  <Database className="h-3 w-3" />
                  Data Source
                </Badge>
                {template?.category && (
                  <Badge variant="secondary" className="text-xs shrink-0 capitalize">
                    {template.category}
                  </Badge>
                )}
              </div>
              {template?.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{template.description}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/action-templates")}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Configure Template
          </Button>
          {template?.config?.url && (
            <Button
              variant="ghost"
              size="sm"
              asChild
            >
              <a
                href={template.config.url as string}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1"
              >
                <ExternalLink className="h-4 w-4" />
                API
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Data grid */}
      {!isError && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <ApiDataGrid
            templateId={templateId}
            columns={columns}
            fieldLabels={templateFieldLabels}
            dataPath={dataPath}
            rowExpansion={rowExpansion}
            searchable
            pageSize={25}
          />
        </div>
      )}
    </div>
  );
}
