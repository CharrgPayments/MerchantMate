import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { EntityActivityFeed } from "@/components/EntityActivityFeed";

type EntityKind = "prospect" | "agent" | "merchant";

const KIND_CONFIG: Record<EntityKind, {
  title: string;
  listPath: string;
  apiPath: (id: string) => string;
  resource: string;
}> = {
  prospect: {
    title: "Prospect",
    listPath: "/prospects",
    apiPath: (id) => `/api/prospects/${id}`,
    resource: "prospect",
  },
  agent: {
    title: "Agent",
    listPath: "/agents",
    apiPath: (id) => `/api/agents/${id}`,
    resource: "agent",
  },
  merchant: {
    title: "Merchant",
    listPath: "/merchants",
    apiPath: (id) => `/api/merchants/${id}`,
    resource: "merchant",
  },
};

interface EntityDetailProps {
  kind: EntityKind;
}

export default function EntityDetail({ kind }: EntityDetailProps) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const cfg = KIND_CONFIG[kind];

  const { data, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: [cfg.apiPath(id)],
  });

  const displayName =
    (data?.businessName as string | undefined) ||
    (data?.name as string | undefined) ||
    (data?.email as string | undefined) ||
    `#${id}`;

  return (
    <div className="p-6 space-y-4" data-testid={`entity-detail-${kind}`}>
      <div className="flex items-center gap-3">
        <Link href={cfg.listPath}>
          <Button variant="ghost" size="sm" data-testid="back-to-list">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to {cfg.title}s
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="entity-detail-title">
            {cfg.title}: {isLoading ? <Skeleton className="inline-block h-6 w-40 align-middle" /> : displayName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-5 w-64" />
                  <Skeleton className="h-5 w-32" />
                </div>
              ) : !data ? (
                <p className="text-sm text-muted-foreground">Not found.</p>
              ) : (
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {Object.entries(data)
                    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
                    .slice(0, 20)
                    .map(([k, v]) => (
                      <div key={k} className="border-b pb-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                        <dd className="font-medium break-words">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </TabsContent>

            <TabsContent value="activity" className="pt-4">
              <EntityActivityFeed resource={cfg.resource} resourceId={id} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
