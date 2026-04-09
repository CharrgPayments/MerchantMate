import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiDataGrid } from "@/components/ApiDataGrid";
import { ArrowLeft, Database, Settings2 } from "lucide-react";

export default function DataViewPage() {
  const [, params] = useRoute("/data-view/:templateId");
  const [, navigate] = useLocation();

  const templateId = params?.templateId ? Number(params.templateId) : null;

  // ApiDataGrid fetches its own template meta internally.
  // The page only needs the template name for the header — it reads that
  // via the callback below so there is exactly ONE meta request total.
  const [templateName, setTemplateName] = useState<string | null>(null);

  if (!templateId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <Database className="h-10 w-10 opacity-40" />
        <p className="text-sm">Invalid template ID.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/action-templates")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Templates
        </Button>
      </div>
    );
  }

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
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold truncate">
              {templateName ?? `Template #${templateId}`}
            </h1>
            <Badge variant="outline" className="gap-1 text-xs shrink-0">
              <Database className="h-3 w-3" />
              Data Source
            </Badge>
          </div>
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
        </div>
      </div>

      {/* Data grid — always rendered; manages its own meta + data fetches */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <ApiDataGrid
          templateId={templateId}
          searchable
          pageSize={25}
          onMetaLoaded={setTemplateName}
        />
      </div>
    </div>
  );
}
