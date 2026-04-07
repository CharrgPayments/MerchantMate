import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function CampaignView() {
  const { id } = useParams();
  
  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['/api/campaigns', id],
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${id}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch campaign details');
      }
      return response.json();
    },
    enabled: !!id,
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/campaigns" data-testid="button-back">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Campaigns
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-campaign-name">{campaign.name}</h1>
            <p className="text-muted-foreground">Campaign Details</p>
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

      {/* Campaign Information */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Campaign Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Campaign ID</label>
              <p className="font-mono" data-testid="text-campaign-id">{campaign.id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <p data-testid="text-campaign-name-detail">{campaign.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p data-testid="text-campaign-description">{campaign.description || 'No description provided'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Acquirer</label>
              <p data-testid="text-campaign-acquirer">{campaign.acquirer?.displayName || campaign.acquirer?.name || 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Currency</label>
              <p data-testid="text-campaign-currency">{campaign.currency}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div>
                <Badge variant={campaign.isActive ? "default" : "secondary"} data-testid="badge-campaign-status">
                  {campaign.isActive ? "Active" : "Inactive"}
                </Badge>
                {campaign.isDefault && (
                  <Badge variant="outline" className="ml-2" data-testid="badge-campaign-default">
                    Default Campaign
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pricing Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Pricing Type</label>
              <p data-testid="text-pricing-type-name">{campaign.pricingType?.name || 'No pricing type assigned'}</p>
              {campaign.pricingType?.description && (
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-pricing-type-description">
                  {campaign.pricingType.description}
                </p>
              )}
            </div>
            {campaign.pricingType && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Available Fee Structure</label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {campaign.pricingType.feeGroups && campaign.pricingType.feeGroups.length > 0 ? (
                    campaign.pricingType.feeGroups.map((feeGroup: any) => (
                      <div key={feeGroup.id} className="border rounded-lg p-3 bg-card hover:bg-accent/50 transition-colors">
                        <div className="flex flex-col space-y-2">
                          <span className="text-sm font-medium leading-tight">{feeGroup.name}</span>
                          <Badge variant="outline" className="text-xs w-fit">
                            {feeGroup.feeItemsCount || 0} item{(feeGroup.feeItemsCount || 0) !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No fee groups configured</p>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground">Created Date</label>
              <p data-testid="text-campaign-created">
                {new Date(campaign.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Created By</label>
              <p data-testid="text-campaign-created-by">{campaign.createdBy || 'System'}</p>
            </div>
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
            <div className="space-y-4">
              {campaign.feeValues.map((feeValue: any) => (
                <div 
                  key={feeValue.id} 
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`fee-value-${feeValue.id}`}
                >
                  <div className="space-y-1">
                    <p className="font-medium" data-testid={`text-fee-item-name-${feeValue.id}`}>
                      {feeValue.feeItem?.name || 'Unknown Fee Item'}
                    </p>
                    {feeValue.feeItem?.description && (
                      <p className="text-sm text-muted-foreground" data-testid={`text-fee-item-description-${feeValue.id}`}>
                        {feeValue.feeItem.description}
                      </p>
                    )}
                    {feeValue.feeGroup?.name && (
                      <Badge variant="outline" data-testid={`badge-fee-group-${feeValue.id}`}>
                        {feeValue.feeGroup.name}
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-medium" data-testid={`text-fee-value-${feeValue.id}`}>
                      {feeValue.feeItem?.valueType === 'fixed' && '$'}
                      {feeValue.value}
                      {feeValue.feeItem?.valueType === 'percentage' && '%'}
                      {feeValue.feeItem?.valueType === 'basis_points' && ' bps'}
                    </p>
                    <p className="text-sm text-muted-foreground capitalize" data-testid={`text-fee-type-${feeValue.id}`}>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Associated Equipment</CardTitle>
        </CardHeader>
        <CardContent>
          {campaign.equipmentAssociations && campaign.equipmentAssociations.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaign.equipmentAssociations.map((association: any) => (
                <div 
                  key={association.id} 
                  className="border rounded-lg p-4"
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
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Display Order: {association.displayOrder}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-equipment">
              No equipment associated with this campaign.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}