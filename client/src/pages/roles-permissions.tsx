// Super-admin Roles & Permissions matrix page.
// Shows the role × action grant grid (defaults merged with DB overrides).
// Cell click cycles scope: none → own → downline → all → none.
// Destructive grants ("all" on flagged actions) require confirmation.
// Audit history of changes shown in a panel below the matrix.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hasRoleCode, ROLE_CODES, type Scope } from "@shared/permissions";
import { Lock } from "lucide-react";

type GrantsResponse = {
  actions: Record<string, string>;
  actionLabels: Record<string, string>;
  actionGroups: { label: string; actions: string[] }[];
  destructiveActions: string[];
  defaults: Record<string, Partial<Record<string, Scope>>>;
  overrides: Record<string, Partial<Record<string, Scope | null>>>;
};

type AuditRow = {
  id: number;
  role_code: string;
  action: string;
  prev_scope: string | null;
  new_scope: string | null;
  changed_by: string | null;
  changed_at: string;
};

const SCOPE_ORDER: (Scope | "none")[] = ["none", "own", "downline", "all"];
const SCOPE_LABEL: Record<string, string> = {
  none: "—",
  own: "own",
  downline: "downline",
  all: "all",
};
const SCOPE_COLOR: Record<string, string> = {
  none: "bg-gray-100 text-gray-400 hover:bg-gray-200 border-gray-200",
  own: "bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-300",
  downline: "bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300",
  all: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-300",
};

function nextScope(s: Scope | "none"): Scope | "none" {
  const i = SCOPE_ORDER.indexOf(s);
  return SCOPE_ORDER[(i + 1) % SCOPE_ORDER.length];
}

function effective(
  defaults: GrantsResponse["defaults"],
  overrides: GrantsResponse["overrides"],
  action: string,
  role: string,
): Scope | "none" {
  const ov = overrides?.[action]?.[role];
  if (ov === null) return "none";
  if (ov) return ov;
  const def = defaults?.[action]?.[role];
  return def ?? "none";
}

export default function RolesPermissionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<{ role: string; action: string; next: Scope | "none" } | null>(null);

  const isSuperAdmin = hasRoleCode(user, ROLE_CODES.SUPER_ADMIN);

  const { data: grants, isLoading } = useQuery<GrantsResponse>({
    queryKey: ["/api/admin/role-action-grants"],
    enabled: isSuperAdmin,
  });

  const { data: roleDefs = [] } = useQuery<{ code: string; label: string }[]>({
    queryKey: ["/api/admin/role-definitions"],
    enabled: isSuperAdmin,
  });

  const { data: audit = [] } = useQuery<AuditRow[]>({
    queryKey: ["/api/admin/role-action-audit"],
    enabled: isSuperAdmin,
  });

  const setMutation = useMutation({
    mutationFn: async (args: { roleCode: string; action: string; scope: Scope | "none" }) => {
      const res = await apiRequest("PUT", "/api/admin/role-action-grants", args);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-action-grants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-action-audit"] });
      // Effective per-user scopes change too — refresh sidebar / route guards.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      toast({ title: "Permission updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err?.message || "", variant: "destructive" });
    },
  });

  if (!isSuperAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <Lock className="w-10 h-10 mx-auto text-gray-400" />
            <p className="text-lg font-medium">Super Admin only</p>
            <p className="text-sm text-gray-500">You don't have access to the Roles & Permissions matrix.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !grants) {
    return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  }

  const allRoles = (roleDefs.length ? roleDefs.map((r) => r.code) : Object.values(ROLE_CODES))
    .filter((c) => c !== "super_admin"); // super_admin is implicit 'all', not editable

  const handleCellClick = (roleCode: string, action: string, current: Scope | "none") => {
    const next = nextScope(current);
    const isDestructive = grants.destructiveActions.includes(action);
    const isUpgradeToAll = next === "all" && current !== "all";
    if (isDestructive && isUpgradeToAll) {
      setPending({ role: roleCode, action, next });
    } else {
      setMutation.mutate({ roleCode, action, scope: next });
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-roles-permissions">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles & Permissions Matrix</h1>
          <p className="text-sm text-gray-500">
            Click a cell to cycle scope: <span className="font-mono">none → own → downline → all</span>.
            super_admin is locked to "all" on every action.
          </p>
        </div>
      </div>

      {grants.actionGroups.map((group) => (
        <Card key={group.label} data-testid={`group-${group.label}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left font-medium pb-2 pr-4 sticky left-0 bg-white">Action</th>
                  {allRoles.map((r) => (
                    <th key={r} className="text-center font-medium px-2 pb-2 whitespace-nowrap">{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.actions.map((action) => (
                  <tr key={action} className="border-t">
                    <td className="py-2 pr-4 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{grants.actionLabels[action] ?? action}</span>
                        {grants.destructiveActions.includes(action) && (
                          <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">destructive</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono">{action}</div>
                    </td>
                    {allRoles.map((roleCode) => {
                      const cur = effective(grants.defaults, grants.overrides, action, roleCode);
                      const overridden = grants.overrides?.[action] && roleCode in (grants.overrides[action] || {});
                      return (
                        <td key={roleCode} className="px-1 py-1 text-center">
                          <button
                            onClick={() => handleCellClick(roleCode, action, cur)}
                            disabled={setMutation.isPending}
                            data-testid={`cell-${action}-${roleCode}`}
                            className={`min-w-[78px] px-2 py-1 rounded border font-mono text-xs transition-colors ${SCOPE_COLOR[cur]} ${overridden ? "ring-1 ring-offset-1 ring-purple-400" : ""}`}
                            title={overridden ? "Override active" : "Default"}
                          >
                            {SCOPE_LABEL[cur]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Change history</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-gray-500">No changes recorded yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-4">When</th>
                  <th className="py-1 pr-4">Role</th>
                  <th className="py-1 pr-4">Action</th>
                  <th className="py-1 pr-4">Change</th>
                  <th className="py-1 pr-4">By</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-1 pr-4 whitespace-nowrap">{new Date(row.changed_at).toLocaleString()}</td>
                    <td className="py-1 pr-4 font-mono">{row.role_code}</td>
                    <td className="py-1 pr-4 font-mono">{row.action}</td>
                    <td className="py-1 pr-4">
                      <span className="text-gray-500">{row.prev_scope ?? "—"}</span>
                      {" → "}
                      <span className="font-medium">{row.new_scope ?? "—"}</span>
                    </td>
                    <td className="py-1 pr-4 text-gray-500">{row.changed_by ?? "system"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant full access?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to grant <span className="font-mono">{pending?.role}</span> the
              {" "}<span className="font-mono">all</span> scope on
              {" "}<span className="font-mono">{pending?.action}</span>. This is a destructive
              action — every user with this role will gain full access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPending(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) {
                  setMutation.mutate({ roleCode: pending.role, action: pending.action, scope: pending.next });
                  setPending(null);
                }
              }}
            >
              Confirm grant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
