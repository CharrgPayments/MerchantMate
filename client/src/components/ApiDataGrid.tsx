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
  ChevronsUpDown,
  Loader2,
  AlertCircle,
  Database,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Label utilities ─────────────────────────────────────────────────────────

const KNOWN_ABBREVS = new Set([
  "id","url","api","mtd","ytd","ssn","ein","mcc","pos","atm","crm","erp",
  "dba","iso","fbo","ach","pdf","csv","json","xml","sms","pin","cvv","kyc",
  "aml","pci","dss","tpv","mrr","arr","roi","cac","ltv","gp","np",
]);

function humanizeField(field: string): string {
  // snake_case → words
  let s = field.replace(/_/g, " ");
  // camelCase / PascalCase → words
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

function displayLabel(
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

// ── Props ────────────────────────────────────────────────────────────────────

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
}

// ── Component ────────────────────────────────────────────────────────────────

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
}: ApiDataGridProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeProp);

  // Fetch template metadata (for name + templateFieldLabels)
  const { data: templateMeta } = useQuery<{ id: number; name: string; config: Record<string, unknown> }>({
    queryKey: ["/api/action-templates", templateId, "meta"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${templateId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load template");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Fetch live data
  const {
    data: rawResponse,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<unknown>({
    queryKey: ["/api/action-templates", templateId, "data"],
    queryFn: async () => {
      const res = await fetch(`/api/action-templates/${templateId}/data`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch data");
      const json = await res.json();
      return json;
    },
    staleTime: 0,
    gcTime: 0,
  });

  // Resolve the template's field labels (middle tier)
  const templateFieldLabels = useMemo<Record<string, string>>(
    () => ((templateMeta?.config as Record<string, unknown>)?.fieldLabels as Record<string, string>) || {},
    [templateMeta]
  );

  // Resolve config-level dataPath (template config overrides prop)
  const effectiveDataPath =
    (templateMeta?.config as Record<string, unknown>)?.dataPath as string | undefined || dataPath;

  // Extract the array of rows from the response
  const allRows = useMemo<Record<string, unknown>[]>(() => {
    if (!rawResponse) return [];
    const payload = (rawResponse as Record<string, unknown>)?.data ?? rawResponse;
    const arr = resolvePath(payload, effectiveDataPath);
    return arr.filter((r): r is Record<string, unknown> => r != null && typeof r === "object");
  }, [rawResponse, effectiveDataPath]);

  // Derive columns
  const columns = useMemo(() => {
    if (columnsProp && columnsProp.length > 0) return columnsProp;
    if (allRows.length === 0) return [];
    return Object.keys(allRows[0]);
  }, [columnsProp, allRows]);

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter((row) =>
      columns.some((col) => String(row[col] ?? "").toLowerCase().includes(q))
    );
  }, [allRows, search, columns]);

  // Sort
  const sorted = useMemo(
    () => (sortKey ? sortRows(filtered, sortKey, sortDir) : filtered),
    [filtered, sortKey, sortDir]
  );

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // Sort toggle
  const toggleSort = (col: string) => {
    if (sortKey !== col) {
      setSortKey(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
    setPage(1);
  };

  const displayTitle = title || templateMeta?.name || `Template #${templateId}`;

  // ── Render helpers ─────────────────────────────────────────────────────────

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1 text-primary" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1 text-primary" />
    );
  };

  const renderCell = (value: unknown) => {
    if (value == null) return <span className="text-muted-foreground">—</span>;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return <code className="text-xs">{JSON.stringify(value)}</code>;
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
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

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
          {allRows.length > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              {sorted.length.toLocaleString()} row{sorted.length !== 1 ? "s" : ""}
              {search && allRows.length !== sorted.length && ` of ${allRows.length.toLocaleString()}`}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => refetch()}
            disabled={isFetching}
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
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">
            Retry
          </Button>
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
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground text-sm py-10">
                    No results found.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => (
                  <TableRow key={i} className="hover:bg-muted/40 transition-colors">
                    {columns.map((col) => (
                      <TableCell key={col} className="py-2 px-3 text-xs align-middle max-w-[220px]">
                        {renderCell(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
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
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
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
              variant="outline"
              size="sm"
              className="h-7 px-2 ml-2"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ‹
            </Button>
            {/* page chips — show max 5 */}
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
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </Button>
                )
              )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              ›
            </Button>
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
