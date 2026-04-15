import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit, ExternalLink, FileText, Users, BarChart3, CheckCircle2, XCircle, Clock, FileEdit, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { label: "Draft", variant: "secondary", icon: FileEdit },
  submitted: { label: "Submitted", variant: "default", icon: Clock },
  approved: { label: "Approved", variant: "default", icon: CheckCircle2 },
  rejected: { label: "Rejected", variant: "destructive", icon: XCircle },
  pending_review: { label: "Pending Review", variant: "outline", icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const, icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="flex items-center gap-1 w-fit">
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-4 gap-1 text-center">
      <span className="text-3xl font-bold">{value}</span>
      <span className="text-sm font-medium">{label}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

export default function CampaignView() {
  const { id } = useParams();

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['/api/campaigns', id],
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${id}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch campaign details');
      return response.json();
    },
    enabled: !!id,
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/campaigns" data-testid="button-back">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Campaigns
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-semibold mb-2">Campaign Not Found</h2>
            <p className="text-muted-foreground">
              The campaign you're looking for doesn't exist or you don't have permission to view it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = campaign.applicationStats ?? { totalAssigned: 0, activeAssigned: 0, totalApplications: 0, byStatus: {} };
  const byStatus: Record<string, number> = stats.byStatus ?? {};
  const primaryTemplate = (campaign.applicationTemplates ?? []).find((t: any) => t.isPrimary) ?? (campaign.applicationTemplates ?? [])[0] ?? null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/campaigns" data-testid="button-back">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Campaigns
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" data-testid="text-campaign-name">{campaign.name}</h1>
              <Badge variant={campaign.isActive ? "default" : "secondary"} data-testid="badge-campaign-status">
                {campaign.isActive ? "Active" : "Inactive"}
              </Badge>
              {campaign.isDefault && (
                <Badge variant="outline" data-testid="badge-campaign-default">Default</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Campaign #{campaign.id} · Created {new Date(campaign.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              {campaign.createdBy && ` by ${campaign.createdBy}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/campaigns/${campaign.id}/edit`} data-testid="button-edit">
            <Button variant="outline">
              <Edit className="w-4 h-4 mr-2" />
              Edit Campaign
            </Button>
          </Link>
          <Button
            onClick={() => window.open(`/merchant-application?campaign=${campaign.id}`, '_blank')}
            data-testid="button-application-form"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Application Form
          </Button>
        </div>
      </div>

      {/* Application Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
            Application Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <StatCard label="Prospects Assigned" value={stats.totalAssigned} sub={`${stats.activeAssigned} active`} />
            <StatCard label="Total Applications" value={stats.totalApplications} />
            {Object.keys(byStatus).length === 0 && (
              <div className="col-span-2 flex items-center justify-center text-sm text-muted-foreground italic">
                No applications submitted yet
              </div>
            )}
            {Object.entries(byStatus).map(([status, count]) => (
              <StatCard key={status} label={STATUS_CONFIG[status]?.label ?? status} value={count as number} />
            ))}
          </div>
          {Object.keys(byStatus).length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="flex flex-wrap gap-2">
                {Object.entries(byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2 border rounded-md px-3 py-1.5 bg-muted/30">
                    <StatusBadge status={status} />
                    <span className="font-medium text-sm">{count as number}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Campaign Info + Acquirer Template side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Campaign Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p data-testid="text-campaign-description" className="mt-0.5">{campaign.description || 'No description provided'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Acquirer (legacy field)</label>
              <p data-testid="text-campaign-acquirer" className="mt-0.5">{campaign.acquirer || 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Currency</label>
              <p data-testid="text-campaign-currency" className="mt-0.5">{campaign.currency}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Pricing Type</label>
              <p data-testid="text-pricing-type-name" className="mt-0.5">{campaign.pricingType?.name || 'No pricing type assigned'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Application Template Association */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-muted-foreground" />
              Application Template
            </CardTitle>
          </CardHeader>
          <CardContent>
            {primaryTemplate ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-base">{primaryTemplate.acquirer?.displayName ?? primaryTemplate.acquirer?.name ?? 'Unknown Acquirer'}</p>
                      <p className="text-sm text-muted-foreground">{primaryTemplate.template?.templateName ?? 'Unknown Template'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {primaryTemplate.isPrimary && <Badge variant="default">Primary</Badge>}
                      <Badge variant="outline" className="text-xs">v{primaryTemplate.template?.version ?? '1.0'}</Badge>
                      {primaryTemplate.template?.isActive === false && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                    </div>
                  </div>
                  {primaryTemplate.acquirer?.code && (
                    <div>
                      <label className="text-xs text-muted-foreground">Acquirer Code</label>
                      <p className="font-mono text-sm">{primaryTemplate.acquirer.code}</p>
                    </div>
                  )}
                  {primaryTemplate.template?.id && (
                    <Link href={`/acquirer-templates/${primaryTemplate.template.id}`}>
                      <Button variant="outline" size="sm" className="mt-1">
                        <ExternalLink className="w-3 h-3 mr-2" />
                        View Template
                      </Button>
                    </Link>
                  )}
                </div>

                {/* Additional templates if more than one */}
                {(campaign.applicationTemplates ?? []).length > 1 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Additional Templates</p>
                    <div className="space-y-2">
                      {(campaign.applicationTemplates as any[]).slice(1).map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                          <span>{t.acquirer?.displayName ?? t.acquirer?.name ?? 'Unknown'} — {t.template?.templateName ?? 'Unknown'}</span>
                          <Badge variant="outline" className="text-xs">v{t.template?.version ?? '1.0'}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-template">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No application template associated with this campaign.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fee Structure */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Fee Structure</CardTitle>
        </CardHeader>
        <CardContent>
          {campaign.feeValues && campaign.feeValues.length > 0 ? (
            <div className="space-y-3">
              {campaign.feeValues.map((feeValue: any) => (
                <div
                  key={feeValue.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  data-testid={`fee-value-${feeValue.id}`}
                >
                  <div className="space-y-0.5">
                    <p className="font-medium" data-testid={`text-fee-item-name-${feeValue.id}`}>
                      {feeValue.feeItem?.name || 'Unknown Fee Item'}
                    </p>
                    {feeValue.feeItem?.description && (
                      <p className="text-sm text-muted-foreground" data-testid={`text-fee-item-description-${feeValue.id}`}>
                        {feeValue.feeItem.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-base" data-testid={`text-fee-value-${feeValue.id}`}>
                      {feeValue.feeItem?.valueType === 'fixed' && '$'}
                      {feeValue.value}
                      {feeValue.feeItem?.valueType === 'percentage' && '%'}
                      {feeValue.feeItem?.valueType === 'basis_points' && ' bps'}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize" data-testid={`text-fee-type-${feeValue.id}`}>
                      {feeValue.feeItem?.valueType || 'unknown'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-fee-values">
              No fee values configured for this campaign.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Associated Equipment */}
      {campaign.equipment && campaign.equipment.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Associated Equipment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaign.equipment.map((association: any) => (
                <div
                  key={association.id}
                  className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                  data-testid={`equipment-${association.id}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium" data-testid={`text-equipment-name-${association.id}`}>
                        {association.equipmentItem?.name || 'Unknown Equipment'}
                      </h4>
                      {association.isRequired && (
                        <Badge variant="secondary" data-testid={`badge-equipment-required-${association.id}`}>
                          Required
                        </Badge>
                      )}
                    </div>
                    {association.equipmentItem?.description && (
                      <p className="text-sm text-muted-foreground" data-testid={`text-equipment-description-${association.id}`}>
                        {association.equipmentItem.description}
                      </p>
                    )}
                    {association.equipmentItem?.manufacturer && (
                      <p className="text-xs text-muted-foreground">{association.equipmentItem.manufacturer}</p>
                    )}
                    {association.equipmentItem?.category && (
                      <Badge variant="outline" className="text-xs">{association.equipmentItem.category}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
