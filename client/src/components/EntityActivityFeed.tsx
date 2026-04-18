import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Activity, ChevronLeft, ChevronRight, Search } from "lucide-react";

// Epic F — generic activity feed scoped to a single resource. Renders the
// audit_logs rows for (resource, resourceId) returned by
// GET /api/audit/entity/:resource/:resourceId.

type AuditLogRow = {
  id: number;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  description: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
};

interface EntityActivityFeedProps {
  resource: string;
  resourceId: string | number;
  pageSize?: number;
}

export function EntityActivityFeed({ resource, resourceId, pageSize = 25 }: EntityActivityFeedProps) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const offset = page * pageSize;

  const { data, isLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/audit/entity", resource, String(resourceId), { pageSize, offset }],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit/entity/${encodeURIComponent(resource)}/${encodeURIComponent(String(resourceId))}?limit=${pageSize}&offset=${offset}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to load activity (${res.status})`);
      return (await res.json()) as AuditLogRow[];
    },
  });

  const filtered = (data ?? []).filter((row) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      row.action?.toLowerCase().includes(q) ||
      row.description?.toLowerCase().includes(q) ||
      row.userEmail?.toLowerCase().includes(q) ||
      row.userId?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3" data-testid="entity-activity-feed">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search action, user, or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="activity-search"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          data-testid="activity-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground" data-testid="activity-page">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={!data || data.length < pageSize}
          data-testid="activity-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="entity-activity-feed-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="entity-activity-feed-empty">
          <Activity className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">
            {search ? `No matches for "${search}".` : `No activity recorded yet for this ${resource}.`}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[480px] pr-4">
          <ol className="relative border-l border-border ml-3">
            {filtered.map((row) => (
              <li key={row.id} className="mb-6 ml-6" data-testid={`activity-row-${row.id}`}>
                <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary ring-4 ring-background" />
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{row.action}</Badge>
                  <span className="text-sm font-medium">{row.userEmail || row.userId || "system"}</span>
                  <span className="text-xs text-muted-foreground" title={new Date(row.createdAt).toLocaleString()}>
                    {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
                  </span>
                </div>
                {row.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                )}
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </div>
  );
}
