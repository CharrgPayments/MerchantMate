import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  AlertCircle,
  Database,
  RefreshCw,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Label utilities ──────────────────────────────────────────────────────────

const KNOWN_ABBREVS = new Set([
  "id","url","api","mtd","ytd","ssn","ein","mcc","pos","atm","crm","erp",
  "dba","iso","fbo","ach","pdf","csv","json","xml","sms","pin","cvv","kyc",
  "aml","pci","dss","tpv","mrr","arr","roi","cac","ltv","gp","np",
]);

export function humanizeField(field: string): string {
  let s = field.replace(/_/g, " ");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = s.split(" ").filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (KNOWN_ABBREVS.has(lower)) return w.toUpperCase();
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      return w.toLowerCase();
    })
    .join(" ");
}

export function displayLabel(
  field: string,
  widgetLabels?: Record<string, string>,
  templateLabels?: Record<string, string>
): string {
  return widgetLabels?.[field] || templateLabels?.[field] || humanizeField(field);
}

// ── Path resolution ──────────────────────────────────────────────────────────

function resolvePath(data: unknown, path: string | undefined): unknown[] {
  if (!path || !data) {
    if (Array.isArray(data)) return data;
    return [];
  }
  const parts = path.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return [];
    cur = (cur as Record<string, unknown>)[p];
  }
  return Array.isArray(cur) ? cur : [];
}

// ── Sorting ──────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc" | null;

function sortRows(rows: Record<string, unknown>[], key: string, dir: SortDir) {
  if (!dir) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function renderCell(value: unknown) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <code className="text-[11px]">{JSON.stringify(value)}</code>;
  const str = String(value);
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate block max-w-[180px]">{str}</span>
        </TooltipTrigger>
        {str.length > 20 && (
          <TooltipContent side="top" className="max-w-xs break-all text-xs">
            {str}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Row Expansion types ───────────────────────────────────────────────────────

/**
 * Config for a row-level detail expansion.
 * When a row is clicked, the detail template is called with the row's key value
 * substituted into the URL as a route parameter.
 *
 * Example:
 *   Primary template URL: https://api.example.com/merchants (returns a list)
 *   Detail template URL:  https://api.example.com/merchants/{merchantId}/locations
 *
 *   rowExpansion = {
 *     templateId: 42,          // the detail template
 *     rowKeyField: "id",       // field in the parent row that holds the merchant ID
 *     routeParamName: "merchantId", // {merchantId} placeholder in the detail URL
 *     label: "Locations",
 *   }
 */
export interface RowExpansionConfig {
  /** Action template ID to call for each expanded row. */
  templateId: number;
  /**
   * The field name in the parent row whose value is passed as the route param.
   * E.g. "id" or "merchantId".
   */
  rowKeyField: string;
  /**
   * The placeholder name in the detail template URL.
   * E.g. if the URL is /merchants/{merchantId}/locations this should be "merchantId".
   * Defaults to the same value as rowKeyField.
   */
  routeParamName?: string;
  /** Columns to display in the expanded sub-table. Auto-detected if omitted. */
  columns?: string[];
  /** JSON path into the detail response to extract the array. */
  dataPath?: string;
  /** Display label for the expansion section header. */
  label?: string;
  /** Field label overrides for the detail columns. */
  fieldLabels?: Record<string, string>;
}

// ── RowExpansionPanel ─────────────────────────────────────────────────────────

interface RowExpansionPanelProps {
  config: RowExpansionConfig;
  parentRow: Record<string, unknown>;
  colSpan: number;
}

function RowExpansionPanel({ config, parentRow, colSpan }: RowExpansionPanelProps) {
  const keyValue = String(parentRow[config.rowKeyField] ?? "");
  const paramName = config.routeParamName || config.rowKeyField;

  // Fetch detail template metadata for its field labels
  const { data: detailMeta } = useQuery<{ name: string; config: Record<string, unknown> }>({
    queryKey: ["/api/action-templates", config.templateId, "meta"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${config.templateId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    staleTime: 60_000,
  });

  const templateFieldLabels: Record<string, string> =
    ((detailMeta?.config?.fieldLabels) as Record<string, string> | undefined) || {};
  const effectiveDataPath =
    (detailMeta?.config?.dataPath as string | undefined) || config.dataPath;

  // Fetch detail data — enabled only when keyValue is present
  const { data: rawDetail, isLoading, isError, error } = useQuery<unknown>({
    queryKey: ["/api/action-templates", config.templateId, "data", paramName, keyValue],
    queryFn: async () => {
      const params = new URLSearchParams({ [paramName]: keyValue });
      const res = await fetch(
        `/api/action-templates/${config.templateId}/data?${params}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load detail");
      }
      return res.json();
    },
    enabled: !!keyValue,
    staleTime: 0,
    gcTime: 0,
  });

  // Extract the rows from the detail response
  const detailRows = useMemo<Record<string, unknown>[]>(() => {
    if (!rawDetail) return [];
    const payload = (rawDetail as Record<string, unknown>)?.data ?? rawDetail;
    const arr = resolvePath(payload, effectiveDataPath);
    return arr.filter((r): r is Record<string, unknown> => r != null && typeof r === "object");
  }, [rawDetail, effectiveDataPath]);

  // Derive columns
  const columns = useMemo(() => {
    if (config.columns && config.columns.length > 0) return config.columns;
    if (detailRows.length === 0) return [];
    return Object.keys(detailRows[0]);
  }, [config.columns, detailRows]);

  const label = config.label || detailMeta?.name || `Detail (template #${config.templateId})`;
  const mergedLabels = { ...templateFieldLabels, ...(config.fieldLabels || {}) };

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="py-0 px-0">
        <div className="border-l-2 border-primary/30 ml-8 my-2 mr-4 rounded-md overflow-hidden">
          {/* Expansion header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
            <Layers className="h-3.5 w-3.5 text-primary/70" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {label}
            </span>
            {!isLoading && !isError && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal ml-auto">
                {detailRows.length} record{detailRows.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Expansion body */}
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading {label.toLowerCase()}…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {String(error)}
            </div>
          ) : detailRows.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No {label.toLowerCase()} found for this record.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50">
                  {columns.map((col) => (
                    <TableHead key={col} className="py-1.5 px-3 text-[11px] font-medium bg-muted/20 whitespace-nowrap">
                      {displayLabel(col, config.fieldLabels, templateFieldLabels)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailRows.map((row, i) => (
                  <TableRow key={i} className="border-b border-border/30 hover:bg-muted/20">
                    {columns.map((col) => (
                      <TableCell key={col} className="py-1.5 px-3 text-xs align-middle max-w-[220px]">
                        {renderCell(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ── ApiDataGridProps ──────────────────────────────────────────────────────────

export interface ApiDataGridProps {
  templateId: number;
  /** Columns to display. If omitted, all keys from the first row are used. */
  columns?: string[];
  /** Page-level label overrides (widget override tier). Highest priority. */
  fieldLabels?: Record<string, string>;
  /** Custom title. Falls back to template name. */
  title?: string;
  /** Whether to show the search bar. Default true. */
  searchable?: boolean;
  /** Rows per page. Default 25. */
  pageSize?: number;
  /** JSON path into the response to extract the data array, e.g. "data.items". */
  dataPath?: string;
  className?: string;
  /** Hide the card chrome — just the table. */
  bare?: boolean;
  /**
   * Optional row expansion config. When set, each row gets a toggle chevron.
   * Clicking it fires the detail template with the row's key value as a route param.
   */
  rowExpansion?: RowExpansionConfig;
}

// ── ApiDataGrid ───────────────────────────────────────────────────────────────

export function ApiDataGrid({
  templateId,
  columns: columnsProp,
  fieldLabels,
  title,
  searchable = true,
  pageSize: pageSizeProp = 25,
  dataPath,
  className,
  bare = false,
  rowExpansion,
}: ApiDataGridProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeProp);
  // Track which rows are expanded by their key value (or row index as fallback)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Fetch template metadata (name + field labels)
  const { data: templateMeta } = useQuery<{ id: number; name: string; config: Record<string, unknown> }>({
    queryKey: ["/api/action-templates", templateId, "meta"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${templateId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load template");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Fetch live data
  const { data: rawResponse, isLoading, isError, error, refetch, isFetching } = useQuery<unknown>({
    queryKey: ["/api/action-templates", templateId, "data"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${templateId}/data`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch data");
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  const templateFieldLabels = useMemo<Record<string, string>>(
    () => ((templateMeta?.config?.fieldLabels) as Record<string, string> | undefined) || {},
    [templateMeta]
  );

  const effectiveDataPath =
    (templateMeta?.config?.dataPath as string | undefined) || dataPath;

  const allRows = useMemo<Record<string, unknown>[]>(() => {
    if (!rawResponse) return [];
    const payload = (rawResponse as Record<string, unknown>)?.data ?? rawResponse;
    const arr = resolvePath(payload, effectiveDataPath);
    return arr.filter((r): r is Record<string, unknown> => r != null && typeof r === "object");
  }, [rawResponse, effectiveDataPath]);

  const columns = useMemo(() => {
    if (columnsProp && columnsProp.length > 0) return columnsProp;
    if (allRows.length === 0) return [];
    return Object.keys(allRows[0]);
  }, [columnsProp, allRows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter((row) =>
      columns.some((col) => String(row[col] ?? "").toLowerCase().includes(q))
    );
  }, [allRows, search, columns]);

  const sorted = useMemo(
    () => (sortKey ? sortRows(filtered, sortKey, sortDir) : filtered),
    [filtered, sortKey, sortDir]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const toggleSort = (col: string) => {
    if (sortKey !== col) { setSortKey(col); setSortDir("asc"); }
    else if (sortDir === "asc") { setSortDir("desc"); }
    else { setSortKey(null); setSortDir(null); }
    setPage(1);
  };

  // Row expansion helpers
  const getRowKey = (row: Record<string, unknown>, idx: number): string => {
    if (rowExpansion) {
      const val = row[rowExpansion.rowKeyField];
      if (val != null) return String(val);
    }
    return String(idx);
  };

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const displayTitle = title || templateMeta?.name || `Template #${templateId}`;

  // Total columns = data columns + optional expand toggle column
  const totalColSpan = columns.length + (rowExpansion ? 1 : 0);

  // ── Sort icon ───────────────────────────────────────────────────────────────

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 text-primary" />
      : <ChevronDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // ── Grid content ────────────────────────────────────────────────────────────

  const gridContent = (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {searchable && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-8 h-8 text-sm"
            />
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {rowExpansion && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Layers className="h-3 w-3" />
              Expandable rows
            </Badge>
          )}
          {allRows.length > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              {sorted.length.toLocaleString()} row{sorted.length !== 1 ? "s" : ""}
              {search && allRows.length !== sorted.length && ` of ${allRows.length.toLocaleString()}`}
            </Badge>
          )}
          <Button
            variant="ghost" size="sm" className="h-8 px-2"
            onClick={() => refetch()} disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading data…</span>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-destructive">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm font-medium">Failed to load data</p>
          <p className="text-xs text-muted-foreground">{String(error)}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">Retry</Button>
        </div>
      ) : columns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <Database className="h-8 w-8 opacity-40" />
          <p className="text-sm">No data returned from this template.</p>
          <p className="text-xs">Check that the endpoint is reachable and returns an array.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {rowExpansion && (
                  <TableHead className="w-8 py-2 px-2" />
                )}
                {columns.map((col) => (
                  <TableHead
                    key={col}
                    className="py-2 px-3 text-xs font-medium whitespace-nowrap cursor-pointer select-none hover:bg-muted/60 transition-colors"
                    onClick={() => toggleSort(col)}
                  >
                    <span className="flex items-center">
                      {displayLabel(col, fieldLabels, templateFieldLabels)}
                      <SortIcon col={col} />
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={totalColSpan} className="text-center text-muted-foreground text-sm py-10">
                    No results found.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => {
                  const rowKey = getRowKey(row, i);
                  const isExpanded = expandedKeys.has(rowKey);
                  return (
                    <>
                      <TableRow
                        key={`row-${rowKey}`}
                        className={cn(
                          "transition-colors",
                          rowExpansion ? "cursor-pointer hover:bg-muted/50" : "hover:bg-muted/40",
                          isExpanded && "bg-muted/30"
                        )}
                        onClick={rowExpansion ? () => toggleExpand(rowKey) : undefined}
                      >
                        {rowExpansion && (
                          <TableCell className="py-2 px-2 w-8">
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform duration-150",
                                isExpanded && "rotate-90 text-primary"
                              )}
                            />
                          </TableCell>
                        )}
                        {columns.map((col) => (
                          <TableCell key={col} className="py-2 px-3 text-xs align-middle max-w-[220px]">
                            {renderCell(row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                      {rowExpansion && isExpanded && (
                        <RowExpansionPanel
                          key={`expand-${rowKey}`}
                          config={rowExpansion}
                          parentRow={row}
                          colSpan={totalColSpan}
                        />
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && sorted.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows per page:</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>
              {((page - 1) * pageSize + 1).toLocaleString()}–
              {Math.min(page * pageSize, sorted.length).toLocaleString()} of{" "}
              {sorted.length.toLocaleString()}
            </span>
            <Button
              variant="outline" size="sm" className="h-7 px-2 ml-2"
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            >‹</Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm" className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(p as number)}
                  >{p}</Button>
                )
              )}
            <Button
              variant="outline" size="sm" className="h-7 px-2"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            >›</Button>
          </div>
        </div>
      )}
    </div>
  );

  if (bare) return gridContent;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{displayTitle}</h3>
          {templateMeta?.config && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Powered by action template · {allRows.length.toLocaleString()} records loaded
              {rowExpansion && " · click any row to expand detail"}
            </p>
          )}
        </div>
        <Badge variant="outline" className="gap-1 shrink-0">
          <Database className="h-3 w-3" />
          Live Data
        </Badge>
      </div>
      {gridContent}
    </div>
  );
}
