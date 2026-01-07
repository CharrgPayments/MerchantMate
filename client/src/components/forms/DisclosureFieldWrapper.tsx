import { useQuery } from "@tanstack/react-query";
import { DisclosureField } from "./DisclosureField";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

interface DisclosureConfig {
  key: string;
  disclosureSlug?: string;
  displayLabel: string;
  sectionName: string;
  orderPriority: number;
  isRequired: boolean;
  requiresSignature: boolean;
  linkedSignatureGroupKey?: string;
}

interface DisclosureContent {
  id: number;
  name: string;
  slug: string;
  title: string;
  content: string;
  version: string;
}

interface DisclosureData {
  scrollStartedAt?: string;
  scrollCompletedAt?: string;
  scrollDurationMs?: number;
  scrollPercentage: number;
  acknowledged: boolean;
  signature?: {
    signerName: string;
    signatureData: string;
    signatureType: 'drawn' | 'typed';
    email: string;
    dateSigned: string;
  };
}

interface DisclosureFieldWrapperProps {
  config: DisclosureConfig;
  disclosureDefinitionId?: number;
  inlineContent?: DisclosureContent;
  value?: DisclosureData;
  onChange: (data: DisclosureData) => void;
  disabled?: boolean;
  dataTestId?: string;
}

interface DisclosureVersionResponse {
  success: boolean;
  disclosure?: {
    id: number;
    slug: string;
    displayName: string;
    currentVersion?: {
      id: number;
      version: string;
      title: string;
      content: string;
      contentHash: string;
    };
  };
}

export function DisclosureFieldWrapper({
  config,
  disclosureDefinitionId,
  inlineContent,
  value,
  onChange,
  disabled,
  dataTestId,
}: DisclosureFieldWrapperProps) {
  const { data, isLoading, error } = useQuery<DisclosureVersionResponse>({
    queryKey: ['/api/disclosures', disclosureDefinitionId],
    queryFn: async () => {
      const res = await fetch(`/api/disclosures/${disclosureDefinitionId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch disclosure');
      return res.json();
    },
    enabled: !!disclosureDefinitionId,
    staleTime: 5 * 60 * 1000,
  });

  if (disclosureDefinitionId) {
    if (isLoading) {
      return (
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      );
    }

    if (error || !data?.disclosure?.currentVersion) {
      return (
        <Card className="border-destructive">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load disclosure content. Please refresh the page.</span>
            </div>
          </CardContent>
        </Card>
      );
    }

    const version = data.disclosure.currentVersion;
    const content: DisclosureContent = {
      id: version.id,
      name: data.disclosure.displayName,
      slug: data.disclosure.slug,
      title: version.title,
      content: version.content,
      version: version.version,
    };

    return (
      <DisclosureField 
        config={{ ...config, disclosureSlug: config.disclosureSlug || data.disclosure.slug }}
        content={content} 
        value={value}
        onChange={onChange}
        disabled={disabled}
        dataTestId={dataTestId}
      />
    );
  }

  if (inlineContent) {
    return (
      <DisclosureField 
        config={{ ...config, disclosureSlug: config.disclosureSlug || inlineContent.slug }}
        content={inlineContent} 
        value={value}
        onChange={onChange}
        disabled={disabled}
        dataTestId={dataTestId}
      />
    );
  }

  return (
    <Card className="border-amber-300">
      <CardContent className="py-6">
        <div className="flex items-center gap-2 text-amber-600">
          <AlertCircle className="h-5 w-5" />
          <span>No disclosure content configured for this field.</span>
        </div>
      </CardContent>
    </Card>
  );
}
