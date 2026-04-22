import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface CatalogueEntry {
  method: Method;
  path: string;
  permission: string;
  permissionType: "session" | "action" | "permission" | "public";
  validated: boolean;
  schema?: string;
  internal: boolean;
}

interface CatalogueSection {
  id: string;
  title: string;
  endpoints: CatalogueEntry[];
}

interface CatalogueResponse {
  generatedAt: string;
  total: number;
  sections: CatalogueSection[];
  entries: CatalogueEntry[];
}

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-green-50 text-green-700 border-green-200",
  POST: "bg-blue-50 text-blue-700 border-blue-200",
  PUT: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PATCH: "bg-orange-50 text-orange-700 border-orange-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
};

const SECTION_TITLE_OVERRIDES: Record<string, string> = {
  v1: "Public API (v1, API key)",
  auth: "Authentication & Session",
  merchants: "Merchants",
  agents: "Agents",
  users: "Users",
  locations: "Locations",
  addresses: "Addresses",
  transactions: "Transactions",
  prospects: "Prospects",
  portal: "Applicant Portal",
  signature: "Signatures",
  signatures: "Signatures",
  "signature-request": "Signatures",
  "signature-submit": "Signatures",
  campaigns: "Campaigns",
  "campaign-rules": "Campaign Rules",
  "fee-groups": "Fee Groups",
  "fee-item-groups": "Fee Item Groups",
  "fee-items": "Fee Items",
  "pricing-types": "Pricing Types",
  "pricing-types-detailed": "Pricing Types",
  "equipment-items": "Equipment",
  underwriting: "Underwriting",
  applications: "Applications & Underwriting",
  admin: "Admin & System",
  acquirers: "Acquirers",
  "acquirer-application-templates": "Application Templates",
  "action-templates": "Action Templates",
  "mcc-codes": "MCC Codes",
  "mcc-policies": "MCC Policies",
  mcc: "MCC Codes",
  disclosures: "Disclosures",
  "disclosure-versions": "Disclosures",
  commissions: "Commissions",
  payouts: "Payouts",
  audit: "Audit",
  "audit-logs": "Audit",
  security: "Security",
  dashboard: "Dashboards & Analytics",
  analytics: "Analytics",
  alerts: "Notifications",
  "pdf-forms": "PDF Forms",
  submissions: "PDF Form Submissions",
  "external-endpoints": "External Endpoints",
  "address-autocomplete": "Address Tools",
  "validate-address": "Address Tools",
  "current-agent": "Agents",
  agent: "Agents",
  user: "User Preferences",
  widgets: "User Preferences",
  "email-templates": "Email Templates",
  "email-activity": "Email Activity",
  "prospect-applications": "Application Templates",
  "database-environment": "Admin & System",
  public: "Public",
};

function prettifySectionTitle(id: string): string {
  if (SECTION_TITLE_OVERRIDES[id]) return SECTION_TITLE_OVERRIDES[id];
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EndpointsReference() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery<CatalogueResponse>({
    queryKey: ["/api/admin/route-catalogue"],
  });

  const sections = useMemo(() => data?.sections ?? [], [data]);

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections;
    const q = search.trim().toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        endpoints: section.endpoints.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.permission.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q) ||
            (e.schema?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((s) => s.endpoints.length > 0);
  }, [search, sections]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>API Endpoints</CardTitle>
            <CardDescription>
              {isLoading
                ? "Generating catalogue from live route table…"
                : isError
                  ? "Could not load the route catalogue."
                  : `${data?.total ?? 0} externally-callable endpoints across ${sections.length} domains, generated from the running Express route table.`}
              {" "}
              See "Excluded internal routes" below for everything intentionally omitted.
            </CardDescription>
          </div>
          <div className="text-xs text-gray-500 md:text-right">
            {data?.generatedAt && (
              <>
                Generated: <span className="font-medium">{new Date(data.generatedAt).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by path, method, permission…"
              className="pl-8"
              data-testid="input-endpoints-search"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              validated
            </Badge>
            <span className="text-xs text-gray-500 self-center">
              = body parsed with Zod; bad input returns 400
            </span>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3" data-testid="endpoints-loading">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-dashed border-red-300 bg-red-50 p-6 text-sm text-red-700">
            Failed to load the route catalogue. You may not have the
            <code className="mx-1">admin:manage</code> permission required to view it.
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <nav
              aria-label="Endpoint sections"
              className="mb-6 flex flex-wrap gap-2 rounded-lg border bg-gray-50 p-3"
            >
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#endpoints-${s.id}`}
                  className="rounded-md border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  data-testid={`link-endpoint-section-${s.id}`}
                >
                  {prettifySectionTitle(s.id)}
                  <span className="ml-1 text-gray-400">({s.endpoints.length})</span>
                </a>
              ))}
              <a
                href="#endpoints-excluded"
                className="rounded-md border border-dashed bg-white px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                data-testid="link-endpoint-section-excluded"
              >
                Excluded internal routes
              </a>
            </nav>

            {filteredSections.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
                No endpoints match "{search}".
              </div>
            )}

            <div className="space-y-8">
              {filteredSections.map((section) => (
                <section
                  key={section.id}
                  id={`endpoints-${section.id}`}
                  className="space-y-3 scroll-mt-24"
                >
                  <div className="border-b pb-2">
                    <h3 className="text-lg font-semibold">{prettifySectionTitle(section.id)}</h3>
                    <p className="text-xs text-gray-500">
                      Auto-grouped by URL prefix. {section.endpoints.length} endpoints.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {section.endpoints.map((e) => (
                      <div
                        key={`${e.method}-${e.path}`}
                        className="rounded-lg border p-3"
                        data-testid={`endpoint-${e.method}-${e.path}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={METHOD_STYLES[e.method]}>
                            {e.method}
                          </Badge>
                          <code className="text-sm font-mono">{e.path}</code>
                          {e.validated && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                            >
                              validated
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500">
                          <span>
                            Required permission: <span className="font-medium">{e.permission}</span>
                          </span>
                          {e.schema && (
                            <span>
                              Body: <code className="font-mono">{e.schema}</code>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        <section
          id="endpoints-excluded"
          className="mt-10 space-y-3 rounded-lg border border-dashed bg-gray-50 p-4 scroll-mt-24"
          aria-label="Excluded internal routes"
        >
          <div>
            <h3 className="text-base font-semibold">Excluded internal routes</h3>
            <p className="text-xs text-gray-500">
              These routes are mounted in the Express app but are intentionally
              left out of the catalogue above. They are framework callbacks,
              development helpers, or test plumbing — they are not part of the
              external API contract and may change at any time.
            </p>
          </div>
          <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
            <li>
              <code>GET /api/login</code>, <code>GET /api/callback</code>, and
              <code> GET /api/logout</code> — OpenID Connect plumbing mounted by
              <code> server/replitAuth.ts</code>.
            </li>
            <li>
              The entire <code>/api/testing/*</code> sub-router (
              <code>server/routes/testing.ts</code>) — only mounted in non-production
              environments for E2E fixtures.
            </li>
            <li>
              Username / email availability probes
              (<code>POST /api/auth/check-username</code>,
              <code> POST /api/auth/check-email</code>) and the email
              verification callback (<code>GET /api/auth/verify-email</code>) —
              consumed only by the React app and the email link.
            </li>
            <li>
              <code>GET /api/csrf-token</code> and other client-bootstrap helpers
              consumed only by the React app.
            </li>
            <li>
              Static file routes registered by <code>server/vite.ts</code> /
              <code>server/staticAssets.ts</code> (HTML, JS, CSS, uploaded files)
              — not API endpoints.
            </li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
