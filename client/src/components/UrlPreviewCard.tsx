import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Loader2, AlertCircle } from "lucide-react";

interface UrlPreviewData {
  url: string;
  domain: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

interface UrlPreviewCardProps {
  rawValue: string;
  enabled?: boolean;
  testId?: string;
}

const looksLikeUrl = (s: string): boolean => {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length < 4) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(trimmed);
};

export function UrlPreviewCard({ rawValue, enabled = true, testId }: UrlPreviewCardProps) {
  const isValidShape = looksLikeUrl(rawValue);
  const queryKey = ["/api/url-preview", rawValue.trim().toLowerCase()];

  const { data, isLoading, isError, error } = useQuery<UrlPreviewData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/url-preview?url=${encodeURIComponent(rawValue.trim())}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Preview failed (${res.status})`);
      }
      return res.json();
    },
    enabled: enabled && isValidShape,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!enabled || !isValidShape) return null;

  if (isLoading) {
    return (
      <div
        className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500"
        data-testid={testId ? `${testId}-loading` : undefined}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading website preview…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
        data-testid={testId ? `${testId}-error` : undefined}
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Couldn't preview this site ({(error as Error)?.message || "unreachable"})</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-2 block overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors hover:border-blue-400 hover:shadow-sm"
      data-testid={testId}
    >
      <div className="flex">
        {data.image ? (
          <div className="h-20 w-20 shrink-0 overflow-hidden bg-gray-100 sm:h-24 sm:w-24">
            <img
              src={data.image}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 sm:h-24 sm:w-24">
            {data.favicon ? (
              <img
                src={data.favicon}
                alt=""
                className="h-8 w-8"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Globe className="h-7 w-7 text-blue-400" />
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500">
            {data.favicon && (
              <img
                src={data.favicon}
                alt=""
                className="h-3 w-3"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <span className="truncate">{data.siteName || data.domain}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-sm font-semibold text-gray-900 group-hover:text-blue-700">
            {data.title}
          </div>
          {data.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-gray-600">{data.description}</div>
          )}
        </div>
        <div className="flex items-center px-3 text-gray-300 group-hover:text-blue-500">
          <ExternalLink className="h-4 w-4" />
        </div>
      </div>
    </a>
  );
}
