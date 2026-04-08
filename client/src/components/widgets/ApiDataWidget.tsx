import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Settings,
  Database,
  RefreshCw,
  AlertCircle,
  Loader2,
  BarChart3,
  TableIcon,
  Hash,
} from "lucide-react";
import { BaseWidget } from "./BaseWidget";
import { type WidgetProps } from "./widget-types";
import { useToast } from "@/hooks/use-toast";

interface ApiDataWidgetConfig {
  templateId?: number;
  templateName?: string;
  displayType?: "stat" | "table" | "chart";
  title?: string;
  dataPath?: string;
  columns?: string[];
  maxRows?: number;
  valueField?: string;
  valueLabel?: string;
  xField?: string;
  yField?: string;
  chartType?: "bar" | "line";
}

// Resolve a dot-notation path into a nested object
function resolvePath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

// Get top-level keys from an object or first element of an array
function inferFields(data: any): string[] {
  if (Array.isArray(data) && data.length > 0) return Object.keys(data[0]);
  if (data && typeof data === "object") return Object.keys(data);
  return [];
}

export function ApiDataWidget(props: WidgetProps) {
  const { definition, preference, onConfigChange, onSizeChange, onVisibilityChange } = props;
  const [showConfig, setShowConfig] = useState(false);
  const { toast } = useToast();

  const config: ApiDataWidgetConfig = (preference.configuration as ApiDataWidgetConfig) || {};
  const isConfigured = !!config.templateId;

  // Fetch live data from the template endpoint
  const {
    data: result,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ data: any; status: number; elapsed: number; success: boolean }>({
    queryKey: ["/api/action-templates", config.templateId, "data"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${config.templateId}/data`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: isConfigured,
    staleTime: 0,
    gcTime: 0,
  });

  const rawData = result?.data;
  const displayData = config.dataPath ? resolvePath(rawData, config.dataPath) : rawData;
  const dataArray: any[] = Array.isArray(displayData)
    ? displayData
    : displayData != null
    ? [displayData]
    : [];
  const availableFields = inferFields(displayData);

  const handleSave = (newConfig: ApiDataWidgetConfig) => {
    onConfigChange(newConfig as Record<string, any>);
    setShowConfig(false);
    toast({ title: "Widget configured", description: "Data source widget updated successfully." });
  };

  return (
    <>
      <BaseWidget
        definition={definition}
        preference={preference}
        onConfigChange={onConfigChange}
        onSizeChange={onSizeChange}
        onVisibilityChange={onVisibilityChange}
        onConfigure={() => setShowConfig(true)}
        isLoading={isLoading && isConfigured}
      >
        {/* Header extras: elapsed badge + refresh */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-xs text-muted-foreground">
              {config.title || config.templateName || "API Data"}
            </span>
            {result && (
              <Badge variant="outline" className="text-[10px]">
                {result.elapsed}ms
              </Badge>
            )}
          </div>
          {isConfigured && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>

        {/* Body */}
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <Database className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              Connect a data source to display live data.
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowConfig(true)}>
              <Settings className="h-3 w-3 mr-1" />
              Configure
            </Button>
          </div>
        ) : isError ? (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{(error as Error)?.message || "Failed to load data"}</span>
          </div>
        ) : !result?.success && result ? (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Upstream returned HTTP {result.status}. Check template configuration.</span>
          </div>
        ) : (
          <WidgetDisplay
            displayType={config.displayType || "table"}
            dataArray={dataArray}
            rawData={displayData}
            columns={config.columns?.length ? config.columns : availableFields.slice(0, 5)}
            maxRows={config.maxRows || 10}
            valueField={config.valueField || availableFields[0] || ""}
            valueLabel={config.valueLabel || config.title || "Value"}
            xField={config.xField || availableFields[0] || ""}
            yField={config.yField || availableFields[1] || ""}
            chartType={config.chartType || "bar"}
          />
        )}
      </BaseWidget>

      {showConfig && (
        <ConfigDialog
          currentConfig={config}
          availableFields={availableFields}
          onSave={handleSave}
          onClose={() => setShowConfig(false)}
        />
      )}
    </>
  );
}

// ─── Display sub-components ────────────────────────────────────────────────

interface DisplayProps {
  displayType: "stat" | "table" | "chart";
  dataArray: any[];
  rawData: any;
  columns: string[];
  maxRows: number;
  valueField: string;
  valueLabel: string;
  xField: string;
  yField: string;
  chartType: "bar" | "line";
}

function WidgetDisplay({
  displayType, dataArray, rawData, columns, maxRows, valueField, valueLabel, xField, yField, chartType,
}: DisplayProps) {
  if (displayType === "stat") {
    const val = Array.isArray(rawData) ? rawData[0]?.[valueField] : rawData?.[valueField];
    return (
      <div className="flex flex-col gap-1">
        <div className="text-3xl font-bold tabular-nums">
          {val !== undefined && val !== null ? String(val) : "—"}
        </div>
        <p className="text-xs text-muted-foreground">{valueLabel}</p>
      </div>
    );
  }

  if (displayType === "chart") {
    const chartData = dataArray.slice(0, 20);
    if (!chartData.length) return <EmptyState />;
    return (
      <ResponsiveContainer width="100%" height={150}>
        {chartType === "line" ? (
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xField} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey={yField} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xField} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey={yField} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    );
  }

  // Table (default)
  if (!dataArray.length) return <EmptyState />;
  const rows = dataArray.slice(0, maxRows);
  return (
    <div className="overflow-auto max-h-48 rounded-md border text-xs">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="py-1 px-2 text-[11px] font-medium whitespace-nowrap">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col} className="py-1 px-2 max-w-[110px] truncate" title={String(row[col] ?? "")}>
                  {row[col] != null ? String(row[col]) : <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dataArray.length > maxRows && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground border-t">
          Showing {maxRows} of {dataArray.length} records
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return <p className="text-sm text-muted-foreground text-center py-4">No data to display</p>;
}

// ─── Config Dialog ─────────────────────────────────────────────────────────

interface ConfigDialogProps {
  currentConfig: ApiDataWidgetConfig;
  availableFields: string[];
  onSave: (config: ApiDataWidgetConfig) => void;
  onClose: () => void;
}

function ConfigDialog({ currentConfig, availableFields, onSave, onClose }: ConfigDialogProps) {
  const [templateId, setTemplateId] = useState<string>(
    currentConfig.templateId ? String(currentConfig.templateId) : ""
  );
  const [displayType, setDisplayType] = useState<"stat" | "table" | "chart">(
    currentConfig.displayType || "table"
  );
  const [title, setTitle] = useState(currentConfig.title || "");
  const [dataPath, setDataPath] = useState(currentConfig.dataPath || "");
  const [maxRows, setMaxRows] = useState(String(currentConfig.maxRows || 10));
  const [columns, setColumns] = useState((currentConfig.columns || []).join(", "));
  const [valueField, setValueField] = useState(currentConfig.valueField || "");
  const [valueLabel, setValueLabel] = useState(currentConfig.valueLabel || "");
  const [xField, setXField] = useState(currentConfig.xField || "");
  const [yField, setYField] = useState(currentConfig.yField || "");
  const [chartType, setChartType] = useState<"bar" | "line">(currentConfig.chartType || "bar");

  // Fetch available data source templates
  const { data: allTemplates = [] } = useQuery<any[]>({
    queryKey: ["/api/action-templates"],
    queryFn: async () => {
      const res = await fetch("/api/action-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  const dataSourceTemplates = allTemplates.filter(
    (t: any) => t.actionType === "webhook" && t.config?.isDataSource
  );

  const selectedTemplate = dataSourceTemplates.find((t: any) => t.id === Number(templateId));

  const schemaFields: string[] = (() => {
    if (!selectedTemplate?.config?.responseSchema) return availableFields;
    try {
      const parsed = JSON.parse(selectedTemplate.config.responseSchema);
      return Object.keys(parsed);
    } catch {
      return availableFields;
    }
  })();

  const handleSave = () => {
    if (!templateId) return;
    const newConfig: ApiDataWidgetConfig = {
      templateId: Number(templateId),
      templateName: selectedTemplate?.name || "",
      displayType,
      title: title || selectedTemplate?.name || "",
      dataPath: dataPath || undefined,
      maxRows: Number(maxRows) || 10,
      columns: columns ? columns.split(",").map((c) => c.trim()).filter(Boolean) : [],
      valueField: valueField || undefined,
      valueLabel: valueLabel || undefined,
      xField: xField || undefined,
      yField: yField || undefined,
      chartType,
    };
    onSave(newConfig);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Data Source Widget</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Data Source Template</label>
            {dataSourceTemplates.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 border rounded-md bg-muted/30">
                No data source templates found. Create a Webhook template and enable "Use as Data Source" in its settings first.
              </p>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a data source…" />
                </SelectTrigger>
                <SelectContent>
                  {dataSourceTemplates.map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Widget title */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Widget Title (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedTemplate?.name || "Auto from template name"}
            />
          </div>

          {/* Data path */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Data Path (optional)</label>
            <Input
              value={dataPath}
              onChange={(e) => setDataPath(e.target.value)}
              placeholder="e.g. data.records or results"
            />
            <p className="text-[11px] text-muted-foreground">
              Dot-notation path into the API response. Leave blank to use the root.
            </p>
          </div>

          {/* Display type */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Display As</label>
            <div className="flex gap-2">
              {(["stat", "table", "chart"] as const).map((type) => {
                const icons = { stat: Hash, table: TableIcon, chart: BarChart3 };
                const Icon = icons[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDisplayType(type)}
                    className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-md border text-xs font-medium transition-colors
                      ${displayType === type
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted/50 text-muted-foreground"
                      }`}
                  >
                    <Icon className="h-4 w-4" />
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stat options */}
          {displayType === "stat" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Value Field</label>
                <FieldSelect fields={schemaFields} value={valueField} onChange={setValueField} placeholder="Select field" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Label</label>
                <Input value={valueLabel} onChange={(e) => setValueLabel(e.target.value)} placeholder="e.g. Total Records" />
              </div>
            </div>
          )}

          {/* Table options */}
          {displayType === "table" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Columns</label>
                <Input
                  value={columns}
                  onChange={(e) => setColumns(e.target.value)}
                  placeholder="id, name, status (comma-separated, blank = all)"
                />
                {schemaFields.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Available: {schemaFields.join(", ")}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Max Rows</label>
                <Input type="number" min={1} max={100} value={maxRows} onChange={(e) => setMaxRows(e.target.value)} />
              </div>
            </div>
          )}

          {/* Chart options */}
          {displayType === "chart" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">X Axis (label)</label>
                  <FieldSelect fields={schemaFields} value={xField} onChange={setXField} placeholder="Select field" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Y Axis (value)</label>
                  <FieldSelect fields={schemaFields} value={yField} onChange={setYField} placeholder="Select field" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Chart Type</label>
                <div className="flex gap-2">
                  {(["bar", "line"] as const).map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setChartType(ct)}
                      className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors
                        ${chartType === ct
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted/50 text-muted-foreground"
                        }`}
                    >
                      {ct.charAt(0).toUpperCase() + ct.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!templateId}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({ fields, value, onChange, placeholder }: {
  fields: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  if (!fields.length) {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {fields.map((f) => (
          <SelectItem key={f} value={f}>{f}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
