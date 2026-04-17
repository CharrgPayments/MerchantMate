import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Trash2, Users, Edit2, Key, Shield, CheckCircle, XCircle, Plus, Lock, RotateCcw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { PERMISSIONS, ROLE_PERMISSIONS, type Role, type Permission } from "@/lib/rbac";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  roles: z.array(z.string()).min(1, "At least one role is required"),
  status: z.enum(["active", "suspended", "inactive"]),
});
type UpdateUserFormData = z.infer<typeof updateUserSchema>;

const roleDefinitionSchema = z.object({
  code: z.string().min(1, "Code is required").regex(/^[a-z_]+$/, "Only lowercase letters and underscores").max(50),
  label: z.string().min(1, "Label is required").max(100),
  description: z.string().max(500).optional(),
  color: z.enum(["default", "secondary", "destructive", "outline"]),
  permissions: z.array(z.string()).default([]),
  capabilities: z.string().optional(),
});
type RoleDefinitionFormData = z.infer<typeof roleDefinitionSchema>;

// ─── Permission metadata ────────────────────────────────────────────────────

const PERMISSION_LABELS: Record<string, string> = {
  view_all_users: "View All Users", create_users: "Create Users", edit_users: "Edit Users",
  delete_users: "Delete Users", manage_user_roles: "Manage User Roles",
  view_all_merchants: "View All Merchants", view_own_merchant: "View Own Merchant",
  create_merchants: "Create Merchants", edit_merchants: "Edit Merchants", delete_merchants: "Delete Merchants",
  view_all_agents: "View All Agents", view_own_agents: "View Own Agents",
  create_agents: "Create Agents", edit_agents: "Edit Agents", delete_agents: "Delete Agents",
  view_all_transactions: "View All Transactions", view_own_transactions: "View Own Transactions",
  create_transactions: "Create Transactions", edit_transactions: "Edit Transactions", delete_transactions: "Delete Transactions",
  view_all_locations: "View All Locations", view_own_locations: "View Own Locations",
  create_locations: "Create Locations", edit_locations: "Edit Locations", delete_locations: "Delete Locations",
  view_analytics: "View Analytics", view_reports: "View Reports", view_financial_data: "View Financial Data",
  export_data: "Export Data", manage_system: "Manage System", view_system_logs: "View System Logs",
  manage_integrations: "Manage Integrations",
};

const PERMISSION_GROUPS: { label: string; permissions: string[] }[] = [
  { label: "User Management", permissions: ["view_all_users","create_users","edit_users","delete_users","manage_user_roles"] },
  { label: "Merchant Management", permissions: ["view_all_merchants","view_own_merchant","create_merchants","edit_merchants","delete_merchants"] },
  { label: "Agent Management", permissions: ["view_all_agents","view_own_agents","create_agents","edit_agents","delete_agents"] },
  { label: "Transaction Management", permissions: ["view_all_transactions","view_own_transactions","create_transactions","edit_transactions","delete_transactions"] },
  { label: "Location Management", permissions: ["view_all_locations","view_own_locations","create_locations","edit_locations","delete_locations"] },
  { label: "Analytics & Reporting", permissions: ["view_analytics","view_reports","view_financial_data","export_data"] },
  { label: "System Administration", permissions: ["manage_system","view_system_logs","manage_integrations"] },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.permissions);

const COLOR_OPTIONS = [
  { value: "default", label: "Blue (Agent)" },
  { value: "secondary", label: "Grey (Merchant)" },
  { value: "destructive", label: "Red (Admin)" },
  { value: "outline", label: "Outline (Corporate)" },
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface RoleDefinition {
  id: number;
  code: string;
  label: string;
  description: string;
  color: string;
  is_system: boolean;
  permissions: string[];
  capabilities: string[];
  created_at: string;
  updated_at: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── User form
  const updateUserForm = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { firstName: "", lastName: "", email: "", username: "", roles: ["merchant"], status: "active" },
  });

  // ── Role definition form
  const roleForm = useForm<RoleDefinitionFormData>({
    resolver: zodResolver(roleDefinitionSchema),
    defaultValues: { code: "", label: "", description: "", color: "secondary", permissions: [], capabilities: "" },
  });

  // ── Queries
  const { data: users = [], isLoading: usersLoading, refetch } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const r = await fetch('/api/users', { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 0, gcTime: 0, refetchOnMount: true,
  });

  const { data: roleDefs = [], isLoading: rolesLoading } = useQuery<RoleDefinition[]>({
    queryKey: ["/api/admin/role-definitions"],
    queryFn: async () => {
      const r = await fetch('/api/admin/role-definitions', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 0, gcTime: 0, refetchOnMount: true,
  });

  // ── Mutations: users
  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("POST", `/api/users/${userId}/reset-password`),
    onSuccess: async (response) => {
      const data = await response.json();
      toast({ title: "Password Reset", description: `Temporary password: ${data.temporaryPassword}` });
    },
    onError: () => toast({ title: "Error", description: "Failed to reset password", variant: "destructive" }),
  });

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: UpdateUserFormData }) =>
      apiRequest("PATCH", `/api/users/${data.userId}`, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User updated" });
      setEditDialogOpen(false); setEditingUser(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to update user", variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
      toast({ title: "Success", description: "User deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete user", variant: "destructive" }),
  });

  // ── Mutations: role definitions
  const createRoleMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/role-definitions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: "Role created" });
      closeRoleDialog();
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to create role", variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (data: { id: number; updates: any }) =>
      apiRequest("PUT", `/api/admin/role-definitions/${data.id}`, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: "Role updated" });
      closeRoleDialog();
    },
    onError: () => toast({ title: "Error", description: "Failed to update role", variant: "destructive" }),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/role-definitions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: "Role deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete role", variant: "destructive" }),
  });

  // ── Helpers
  const getUserRole = (user: User): string => (user as any).role || user.roles?.[0] || "merchant";

  const getRoleBadgeVariant = (color: string) => {
    if (color === "destructive") return "destructive";
    if (color === "outline") return "outline";
    if (color === "default") return "default";
    return "secondary";
  };

  const getStatusBadgeVariant = (status: string) => {
    if (status === "active") return "default";
    if (status === "suspended") return "destructive";
    return "secondary";
  };

  const formatLastLogin = (d: string | null) => d ? new Date(d).toLocaleDateString() : "Never";

  const filteredUsers = users.filter((user: User) =>
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getUserRole(user).toLowerCase().includes(searchTerm.toLowerCase())
  );

  function openEditUserDialog(user: User) {
    setEditingUser(user);
    updateUserForm.reset({
      firstName: user.firstName || "", lastName: user.lastName || "",
      email: user.email, username: user.username,
      roles: Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles
        : [getUserRole(user)],
      status: user.status as "active" | "suspended" | "inactive",
    });
    setEditDialogOpen(true);
  }

  function openCreateRoleDialog() {
    setEditingRole(null);
    setSelectedPerms([]);
    roleForm.reset({ code: "", label: "", description: "", color: "secondary", permissions: [], capabilities: "" });
    setRoleDialogOpen(true);
  }

  function openEditRoleDialog(role: RoleDefinition) {
    setEditingRole(role);
    const perms = Array.isArray(role.permissions) ? role.permissions : [];
    setSelectedPerms(perms);
    roleForm.reset({
      code: role.code,
      label: role.label,
      description: role.description || "",
      color: (role.color as any) || "secondary",
      permissions: perms,
      capabilities: Array.isArray(role.capabilities) ? role.capabilities.join("\n") : "",
    });
    setRoleDialogOpen(true);
  }

  function closeRoleDialog() {
    setRoleDialogOpen(false);
    setEditingRole(null);
    setSelectedPerms([]);
    roleForm.reset();
  }

  function togglePerm(perm: string) {
    setSelectedPerms(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  }

  function handleRoleSubmit(data: RoleDefinitionFormData) {
    const caps = data.capabilities
      ? data.capabilities.split("\n").map(s => s.trim()).filter(Boolean)
      : [];
    const payload = { ...data, permissions: selectedPerms, capabilities: caps };
    if (editingRole) {
      updateRoleMutation.mutate({ id: editingRole.id, updates: payload });
    } else {
      createRoleMutation.mutate(payload);
    }
  }

  const isPending = createRoleMutation.isPending || updateRoleMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{users.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter((u: User) => { const r = (u as any).role || u.roles?.[0]; return r === "agent"; }).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Merchants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter((u: User) => { const r = (u as any).role || u.roles?.[0]; return r === "merchant"; }).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter((u: User) => { const r = (u as any).role || u.roles?.[0]; return r === "admin" || r === "super_admin"; }).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Users</TabsTrigger>
          <TabsTrigger value="role-definitions"><Shield className="h-4 w-4 mr-2" />Role Definitions</TabsTrigger>
          <TabsTrigger value="permissions"><CheckCircle className="h-4 w-4 mr-2" />Permissions by Role</TabsTrigger>
        </TabsList>

        {/* ── Users tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, username, or role..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button onClick={() => refetch()} disabled={usersLoading} variant="outline" size="sm">
                  <RotateCcw className="h-4 w-4 mr-2" />{usersLoading ? "Refreshing..." : "Refresh"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">Loading users...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user: User) => {
                      const role = getUserRole(user);
                      const roleDef = roleDefs.find(r => r.code === role);
                      return (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="font-medium">
                              {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username}
                            </div>
                            <div className="text-sm text-muted-foreground">ID: {user.id.substring(0, 8)}...</div>
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>{user.username}</TableCell>
                          <TableCell>
                            <Badge variant={getRoleBadgeVariant(roleDef?.color || "secondary") as any}>
                              {(roleDef?.label || role).toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(user.status) as any}>
                              {user.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{formatLastLogin(user.lastLoginAt?.toString() || null)}</div>
                            {user.emailVerified && <div className="text-xs text-green-600">Email Verified</div>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <Button variant="outline" size="sm" onClick={() => openEditUserDialog(user)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200">
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button variant="outline" size="sm"
                                onClick={() => resetPasswordMutation.mutate(user.id)}
                                disabled={resetPasswordMutation.isPending}
                                className="bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200">
                                <Key className="h-4 w-4" />
                              </Button>
                              {role !== "super_admin" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={deleteUserMutation.isPending}>
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete User Account</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Delete {user.firstName} {user.lastName}'s account? This also removes their agent or merchant record and cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteUserMutation.mutate(user.id)} className="bg-red-600 hover:bg-red-700">
                                        Delete Account
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {filteredUsers.length === 0 && !usersLoading && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm ? "No users found matching your search." : "No users found."}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Role Definitions tab */}
        <TabsContent value="role-definitions">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openCreateRoleDialog}>
                <Plus className="h-4 w-4 mr-2" />New Role
              </Button>
            </div>
            {rolesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading role definitions...</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {roleDefs.map((role) => {
                  const userCount = users.filter((u: User) => {
                    const r = (u as any).role || u.roles?.[0];
                    return r === role.code;
                  }).length;
                  const caps = Array.isArray(role.capabilities) ? role.capabilities : [];
                  const perms = Array.isArray(role.permissions) ? role.permissions : [];
                  return (
                    <Card key={role.id} className="relative">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div>
                              <CardTitle className="text-base">{role.label}</CardTitle>
                              <div className="text-xs text-muted-foreground font-mono mt-0.5">{role.code}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant={getRoleBadgeVariant(role.color) as any}>{role.label}</Badge>
                            {role.is_system ? (
                              <Lock className="h-3.5 w-3.5 text-muted-foreground ml-1" title="System role" />
                            ) : (
                              <>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditRoleDialog(role)}>
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Role</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Delete the "{role.label}" role? This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteRoleMutation.mutate(role.id)} className="bg-red-600 hover:bg-red-700">
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </div>
                        <CardDescription>{role.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          {userCount} user{userCount !== 1 ? "s" : ""} with this role
                        </div>
                        {caps.length > 0 && (
                          <ul className="space-y-1">
                            {caps.map((cap, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                                <span>{cap}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="pt-2 border-t text-xs text-muted-foreground">
                          {perms.length} permission{perms.length !== 1 ? "s" : ""} granted
                          {role.is_system && <span className="ml-2 text-muted-foreground/60">· System role (read-only)</span>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Permissions Matrix tab */}
        <TabsContent value="permissions">
          <Card>
            <CardHeader>
              <CardTitle>Permission Matrix</CardTitle>
              <CardDescription>Overview of which permissions are granted to each role.</CardDescription>
            </CardHeader>
            <CardContent>
              {rolesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[200px]">Permission</TableHead>
                        {roleDefs.map((role) => (
                          <TableHead key={role.id} className="text-center min-w-[110px]">
                            <Badge variant={getRoleBadgeVariant(role.color) as any} className="text-xs">
                              {role.label}
                            </Badge>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PERMISSION_GROUPS.map((group) => (
                        <Fragment key={group.label}>
                          <TableRow className="bg-muted/40">
                            <TableCell colSpan={roleDefs.length + 1} className="py-2">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {group.label}
                              </span>
                            </TableCell>
                          </TableRow>
                          {group.permissions.map((perm) => (
                            <TableRow key={perm}>
                              <TableCell className="text-sm pl-4">{PERMISSION_LABELS[perm] || perm}</TableCell>
                              {roleDefs.map((role) => {
                                const perms = Array.isArray(role.permissions) ? role.permissions : [];
                                return (
                                  <TableCell key={role.id} className="text-center">
                                    {perms.includes(perm) ? (
                                      <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Account</DialogTitle>
            <DialogDescription>Update user information and role assignment.</DialogDescription>
          </DialogHeader>
          <Form {...updateUserForm}>
            <form onSubmit={updateUserForm.handleSubmit((data) => {
              if (editingUser) updateUserMutation.mutate({ userId: editingUser.id, updates: data });
            })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={updateUserForm.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={updateUserForm.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={updateUserForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={updateUserForm.control} name="username" render={({ field }) => (
                <FormItem><FormLabel>Username</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={updateUserForm.control} name="roles" render={({ field }) => {
                  const options = (roleDefs.length > 0 ? roleDefs : [
                    { id: -1, code: "merchant", label: "Merchant" },
                    { id: -2, code: "agent", label: "Agent" },
                    { id: -3, code: "admin", label: "Admin" },
                    { id: -4, code: "corporate", label: "Corporate" },
                    { id: -5, code: "super_admin", label: "Super Admin" },
                  ] as RoleDefinition[]);
                  const selected = new Set<string>(field.value ?? []);
                  return (
                    <FormItem>
                      <FormLabel>Roles</FormLabel>
                      <FormControl>
                        <div className="border rounded-md p-2 max-h-40 overflow-auto space-y-1" data-testid="roles-multiselect">
                          {options.map((rd) => (
                            <label key={rd.code} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={selected.has(rd.code)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selected);
                                  if (checked) next.add(rd.code); else next.delete(rd.code);
                                  field.onChange(Array.from(next));
                                }}
                                data-testid={`role-checkbox-${rd.code}`}
                              />
                              <span>{rd.label}</span>
                            </label>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }} />
                <FormField control={updateUserForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setEditDialogOpen(false); setEditingUser(null); }}>Cancel</Button>
                <Button type="submit" disabled={updateUserMutation.isPending}>
                  {updateUserMutation.isPending ? "Updating..." : "Update User"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Create / Edit Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={(open) => { if (!open) closeRoleDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Role" : "New Role Definition"}</DialogTitle>
            <DialogDescription>
              {editingRole
                ? "Update the role label, description, capabilities, and permissions."
                : "Define a new role with a unique code, label, and set of permissions."}
            </DialogDescription>
          </DialogHeader>

          <Form {...roleForm}>
            <form onSubmit={roleForm.handleSubmit(handleRoleSubmit)} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={roleForm.control} name="code" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. finance_analyst" disabled={!!editingRole} />
                    </FormControl>
                    <FormMessage />
                    {!editingRole && <p className="text-xs text-muted-foreground">Lowercase letters and underscores only. Cannot be changed later.</p>}
                  </FormItem>
                )} />
                <FormField control={roleForm.control} name="label" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Label</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Finance Analyst" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={roleForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Input {...field} placeholder="Brief description of this role's purpose" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={roleForm.control} name="color" render={({ field }) => (
                <FormItem>
                  <FormLabel>Badge Color</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {COLOR_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={roleForm.control} name="capabilities" render={({ field }) => (
                <FormItem>
                  <FormLabel>Capabilities</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="One capability per line, e.g.:&#10;View financial reports&#10;Manage own assignments"
                      rows={4}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Enter one capability bullet point per line.</p>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Permissions */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-base font-semibold">Permissions</FormLabel>
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setSelectedPerms([...ALL_PERMISSIONS])}>Select all</button>
                    <span className="text-muted-foreground">·</span>
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setSelectedPerms([])}>Clear all</button>
                  </div>
                </div>
                <div className="border rounded-md p-4 space-y-4 max-h-72 overflow-y-auto">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{group.label}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {group.permissions.map((perm) => (
                          <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                            <Checkbox
                              checked={selectedPerms.includes(perm)}
                              onCheckedChange={() => togglePerm(perm)}
                            />
                            <span>{PERMISSION_LABELS[perm] || perm}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">{selectedPerms.length} permission{selectedPerms.length !== 1 ? "s" : ""} selected</div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeRoleDialog}>Cancel</Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (editingRole ? "Saving..." : "Creating...") : (editingRole ? "Save Changes" : "Create Role")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
