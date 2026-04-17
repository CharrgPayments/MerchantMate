import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";

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
  limit?: number;
}

export function EntityActivityFeed({ resource, resourceId, limit = 100 }: EntityActivityFeedProps) {
  const { data, isLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/audit/entity", resource, String(resourceId), { limit }],
  });

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="entity-activity-feed-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="entity-activity-feed-empty">
        <Activity className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No activity recorded yet for this {resource}.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[480px] pr-4" data-testid="entity-activity-feed">
      <ol className="relative border-l border-border ml-3">
        {data.map((row) => (
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
  );
}
