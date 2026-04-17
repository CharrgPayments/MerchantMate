// Single client-side gateway to the runtime permission registry. Fetches the
// current user's effective scopes for every Action (defaults merged with DB
// overrides written from the /roles-permissions matrix). All UI permission
// gates (sidebar, route guards, widgets) consult this hook so super-admin
// matrix toggles take effect without a redeploy.
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { Action, Scope } from "@shared/permissions";

type PermissionsResponse = { scopes: Record<string, Scope> };

export function usePermissions() {
  const { data, isLoading } = useQuery<PermissionsResponse | null>({
    queryKey: ["/api/auth/permissions"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
    retry: false,
  });
  const scopes = data?.scopes ?? {};
  return {
    isLoading,
    scopes: scopes as Record<string, Scope>,
    can: (action: Action | string): boolean => action in scopes,
    scope: (action: Action | string): Scope | null =>
      (scopes[action as string] as Scope | undefined) ?? null,
  };
}
