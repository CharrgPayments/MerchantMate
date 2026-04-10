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
  Tag,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { BaseWidget } from "./BaseWidget";
import { type WidgetProps } from "./widget-types";
import { useToast } from "@/hooks/use-toast";
import { humanizeField } from "@/lib/grid-utils";

/**
 * Resolve a display label with a 3-level priority cascade:
 *   1. Widget-level override (fieldLabels)
 *   2. Template-level label (templateFieldLabels — defined once on the template, shared everywhere)
 *   3. Auto-humanized field name (fallback)
 */
function displayLabel(
  field: string,
  fieldLabels: Record<string, string> = {},
  templateFieldLabels: Record<string, string> = {},
): string {
  return fieldLabels[field]?.trim() || templateFieldLabels[field]?.trim() || humanizeField(field);
}

// ─── Config type ────────────────────────────────────────────────────────────

interface ApiDataWidgetConfig {
  templateId?: number;
  templateName?: string;
  displayType?: "stat" | "table" | "chart";
  title?: string;
  dataPath?: string;
  /** After extracting the array via dataPath, pull this sub-key from each row. */
  rowPath?: string;
  columns?: string[];
  maxRows?: number;
  valueField?: string;
  valueLabel?: string;
  xField?: string;
  yField?: string;
  chartType?: "bar" | "line";
  /** Labels copied from the template definition at save time (lower priority than fieldLabels) */
  templateFieldLabels?: Record<string, string>;
  /** Per-widget label overrides (highest priority, overrides templateFieldLabels) */
  fieldLabels?: Record<string, string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolvePath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

function inferFields(data: any): string[] {
  if (Array.isArray(data) && data.length > 0) return Object.keys(data[0]);
  if (data && typeof data === "object") return Object.keys(data);
  return [];
}

// ─── Main widget component ──────────────────────────────────────────────────

export function ApiDataWidget(props: WidgetProps) {
  const { definition, preference, onConfigChange, onSizeChange, onVisibilityChange } = props;
  const [showConfig, setShowConfig] = useState(false);
  const { toast } = useToast();

  const config: ApiDataWidgetConfig = (preference.configuration as ApiDataWidgetConfig) || {};
  const isConfigured = !!config.templateId;

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
        const detail = err.error ? `${err.message}: ${err.error}` : (err.message || `HTTP ${res.status}`);
        throw new Error(detail);
      }
      return res.json();
    },
    enabled: isConfigured,
    staleTime: 0,
    gcTime: 0,
  });

  const rawData = result?.data;
  const displayData = config.dataPath ? resolvePath(rawData, config.dataPath) : rawData;
  const dataArrayRaw: any[] = Array.isArray(displayData)
    ? displayData
    : displayData != null
    ? [displayData]
    : [];
  // Apply rowPath: extract a sub-key from each row (e.g. "attributes" for JSON:API responses)
  const dataArray: any[] = config.rowPath
    ? dataArrayRaw.map((row: any) => {
        const sub = row?.[config.rowPath!];
        return (sub != null && typeof sub === "object" && !Array.isArray(sub)) ? sub : row;
      })
    : dataArrayRaw;
  const availableFields = inferFields(displayData);
  const fieldLabels = config.fieldLabels || {};
  const templateFieldLabels = config.templateFieldLabels || {};

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
        title={config.title || config.templateName || undefined}
      >
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
            valueLabel={config.valueLabel || displayLabel(config.valueField || availableFields[0] || "", fieldLabels, templateFieldLabels)}
            xField={config.xField || availableFields[0] || ""}
            yField={config.yField || availableFields[1] || ""}
            chartType={config.chartType || "bar"}
            fieldLabels={fieldLabels}
            templateFieldLabels={templateFieldLabels}
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

// ─── Display sub-components ─────────────────────────────────────────────────

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
  fieldLabels: Record<string, string>;
  templateFieldLabels: Record<string, string>;
}

function WidgetDisplay({
  displayType, dataArray, rawData, columns, maxRows,
  valueField, valueLabel, xField, yField, chartType, fieldLabels, templateFieldLabels,
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
    const xLabel = displayLabel(xField, fieldLabels, templateFieldLabels);
    const yLabel = displayLabel(yField, fieldLabels, templateFieldLabels);
    return (
      <ResponsiveContainer width="100%" height={150}>
        {chartType === "line" ? (
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xField} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value: any) => [value, yLabel]}
              labelFormatter={(label: any) => `${xLabel}: ${label}`}
            />
            <Line
              type="monotone"
              dataKey={yField}
              name={yLabel}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        ) : (
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xField} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value: any) => [value, yLabel]}
              labelFormatter={(label: any) => `${xLabel}: ${label}`}
            />
            <Bar dataKey={yField} name={yLabel} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
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
                {displayLabel(col, fieldLabels, templateFieldLabels)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  className="py-1 px-2 max-w-[110px] truncate"
                  title={String(row[col] ?? "")}
                >
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

// ─── Config Dialog ──────────────────────────────────────────────────────────

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
  const [rowPath, setRowPath] = useState(currentConfig.rowPath || "");
  const [maxRows, setMaxRows] = useState(String(currentConfig.maxRows || 10));
  const [columns, setColumns] = useState((currentConfig.columns || []).join(", "));
  const [valueField, setValueField] = useState(currentConfig.valueField || "");
  const [valueLabel, setValueLabel] = useState(currentConfig.valueLabel || "");
  const [xField, setXField] = useState(currentConfig.xField || "");
  const [yField, setYField] = useState(currentConfig.yField || "");
  const [chartType, setChartType] = useState<"bar" | "line">(currentConfig.chartType || "bar");
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>(
    currentConfig.fieldLabels || {}
  );
  const [showFieldLabels, setShowFieldLabels] = useState(
    Object.keys(currentConfig.fieldLabels || {}).length > 0
  );

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

  // Labels already defined on the template (read-only reference for the widget editor)
  const templateFieldLabelsFromTpl: Record<string, string> =
    (selectedTemplate?.config?.fieldLabels as Record<string, string> | undefined) || {};

  // The full set of fields that may need labels — union of schema fields + selected columns
  const labelableFields: string[] = (() => {
    const colList = columns
      ? columns.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    const base = schemaFields.length ? schemaFields : availableFields;
    // Also surface any fields from the template's existing label map
    const fromTpl = Object.keys(templateFieldLabelsFromTpl);
    const union = [...new Set([...base, ...colList, ...fromTpl])];
    return union;
  })();

  const setFieldLabel = (field: string, label: string) => {
    setFieldLabels((prev) => ({ ...prev, [field]: label }));
  };

  const handleSave = () => {
    if (!templateId) return;
    // Strip empty widget-level overrides
    const cleanedLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldLabels)) {
      if (v.trim()) cleanedLabels[k] = v.trim();
    }
    // Snapshot the template's field labels so the widget can use them at render-time
    // without needing to re-fetch the template
    const tplLabels = (selectedTemplate?.config?.fieldLabels as Record<string, string> | undefined) || {};
    const newConfig: ApiDataWidgetConfig = {
      templateId: Number(templateId),
      templateName: selectedTemplate?.name || "",
      displayType,
      title: title || selectedTemplate?.name || "",
      dataPath: dataPath || undefined,
      rowPath: rowPath || undefined,
      maxRows: Number(maxRows) || 10,
      columns: columns ? columns.split(",").map((c) => c.trim()).filter(Boolean) : [],
      valueField: valueField || undefined,
      valueLabel: valueLabel || undefined,
      xField: xField || undefined,
      yField: yField || undefined,
      chartType,
      templateFieldLabels: Object.keys(tplLabels).length ? tplLabels : undefined,
      fieldLabels: Object.keys(cleanedLabels).length ? cleanedLabels : undefined,
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
                No data source templates found. Create a Webhook template and enable "Use as Data Source" first.
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
              Dot-notation path into the API response to find the data array. Leave blank to auto-detect.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Row Path (optional)</label>
            <Input
              value={rowPath}
              onChange={(e) => setRowPath(e.target.value)}
              placeholder="e.g. attributes"
            />
            <p className="text-[11px] text-muted-foreground">
              Sub-key to extract from each row. Use for JSON:API style responses where fields are nested (e.g. <code className="font-mono">attributes</code>).
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
                <Input
                  value={valueLabel}
                  onChange={(e) => setValueLabel(e.target.value)}
                  placeholder={valueField ? humanizeField(valueField) : "e.g. Total Records"}
                />
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

          {/* Field Label Overrides */}
          {labelableFields.length > 0 && (
            <div className="rounded-lg border bg-muted/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFieldLabels((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  Field Display Labels
                  {Object.keys(fieldLabels).filter((k) => fieldLabels[k]?.trim()).length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {Object.keys(fieldLabels).filter((k) => fieldLabels[k]?.trim()).length} custom
                    </Badge>
                  )}
                </div>
                {showFieldLabels
                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </button>

              {showFieldLabels && (
                <div className="border-t">
                  <div className="grid grid-cols-[1fr_1fr] gap-0 text-[11px] font-medium text-muted-foreground bg-muted/50 px-3 py-1.5 border-b">
                    <span>API Field</span>
                    <span>Display Label</span>
                  </div>
                  <div className="divide-y max-h-52 overflow-y-auto">
                    {labelableFields.map((field) => {
                      const tplLabel = templateFieldLabelsFromTpl[field];
                      const autoLabel = humanizeField(field);
                      const effectiveDefault = tplLabel || autoLabel;
                      return (
                        <div key={field} className="grid grid-cols-[1fr_1fr] gap-2 items-center px-3 py-1.5">
                          <div className="flex flex-col gap-0.5">
                            <code className="text-[11px] font-mono text-muted-foreground truncate">{field}</code>
                            {tplLabel ? (
                              <span className="text-[10px] text-violet-600 dark:text-violet-400 truncate font-medium">
                                template: {tplLabel}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/60 truncate">
                                auto: {autoLabel}
                              </span>
                            )}
                          </div>
                          <Input
                            value={fieldLabels[field] || ""}
                            onChange={(e) => setFieldLabel(field, e.target.value)}
                            placeholder={effectiveDefault}
                            className="h-7 text-xs"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-3 py-1.5 border-t">
                    <p className="text-[10px] text-muted-foreground">
                      Leave blank to inherit from the template label (shown in <span className="text-violet-600 dark:text-violet-400 font-medium">purple</span>) or auto-humanized name. Widget overrides take priority.
                    </p>
                  </div>
                </div>
              )}
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
          <SelectItem key={f} value={f}>
            {humanizeField(f)}
            <span className="ml-1 text-muted-foreground text-[10px] font-mono">({f})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
