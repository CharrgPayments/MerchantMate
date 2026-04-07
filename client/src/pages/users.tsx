import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Settings, Trash2, RotateCcw, Users, Edit2, Key, Shield, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { ROLES, PERMISSIONS, ROLE_PERMISSIONS, type Role, type Permission } from "@/lib/rbac";

// User update form schema
const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  role: z.enum(["merchant", "agent", "admin", "corporate", "super_admin"]),
  status: z.enum(["active", "suspended", "inactive"]),
});

type UpdateUserFormData = z.infer<typeof updateUserSchema>;

// Role metadata for display
const ROLE_DEFINITIONS: Record<Role, { label: string; description: string; color: string; capabilities: string[] }> = {
  [ROLES.SUPER_ADMIN]: {
    label: "Super Admin",
    color: "destructive",
    description: "Full system access with all administrative capabilities. Can manage all users, settings, and configurations.",
    capabilities: [
      "Full access to all system features",
      "Manage all user accounts and roles",
      "Access to system configuration and integrations",
      "View and export all financial data",
      "Manage security settings and audit logs",
      "Override any system restriction",
    ],
  },
  [ROLES.ADMIN]: {
    label: "Admin",
    color: "destructive",
    description: "Administrative access for managing users, merchants, agents, and transactions. Cannot modify system-level settings.",
    capabilities: [
      "Manage user accounts (create, edit)",
      "Manage merchant and agent records",
      "View and edit all transactions",
      "Access analytics and financial reports",
      "Export data and generate reports",
      "View system logs",
    ],
  },
  [ROLES.CORPORATE]: {
    label: "Corporate",
    color: "outline",
    description: "Executive-level read access to all business data including analytics, reports, and financial information.",
    capabilities: [
      "View all merchants and agents",
      "Read-only access to all transactions",
      "Access to analytics and financial reports",
      "Export data for reporting",
      "View all location data",
    ],
  },
  [ROLES.AGENT]: {
    label: "Agent",
    color: "default",
    description: "Manages assigned merchants and their transactions. Limited to own data scope.",
    capabilities: [
      "View own assigned merchants",
      "View and create transactions for own merchants",
      "Access analytics for own portfolio",
      "Generate reports for own data",
      "View own locations",
    ],
  },
  [ROLES.MERCHANT]: {
    label: "Merchant",
    color: "secondary",
    description: "Business owner access to own merchant profile, locations, and transaction history.",
    capabilities: [
      "View own merchant profile",
      "Manage own locations",
      "View own transaction history",
      "Access own analytics dashboard",
    ],
  },
};

// Human-readable permission labels
const PERMISSION_LABELS: Record<Permission, string> = {
  view_all_users: "View All Users",
  create_users: "Create Users",
  edit_users: "Edit Users",
  delete_users: "Delete Users",
  manage_user_roles: "Manage User Roles",
  view_all_merchants: "View All Merchants",
  view_own_merchant: "View Own Merchant",
  create_merchants: "Create Merchants",
  edit_merchants: "Edit Merchants",
  delete_merchants: "Delete Merchants",
  view_all_agents: "View All Agents",
  view_own_agents: "View Own Agents",
  create_agents: "Create Agents",
  edit_agents: "Edit Agents",
  delete_agents: "Delete Agents",
  view_all_transactions: "View All Transactions",
  view_own_transactions: "View Own Transactions",
  create_transactions: "Create Transactions",
  edit_transactions: "Edit Transactions",
  delete_transactions: "Delete Transactions",
  view_all_locations: "View All Locations",
  view_own_locations: "View Own Locations",
  create_locations: "Create Locations",
  edit_locations: "Edit Locations",
  delete_locations: "Delete Locations",
  view_analytics: "View Analytics",
  view_reports: "View Reports",
  view_financial_data: "View Financial Data",
  export_data: "Export Data",
  manage_system: "Manage System",
  view_system_logs: "View System Logs",
  manage_integrations: "Manage Integrations",
};

// Permission categories for grouping
const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: "User Management",
    permissions: ["view_all_users", "create_users", "edit_users", "delete_users", "manage_user_roles"],
  },
  {
    label: "Merchant Management",
    permissions: ["view_all_merchants", "view_own_merchant", "create_merchants", "edit_merchants", "delete_merchants"],
  },
  {
    label: "Agent Management",
    permissions: ["view_all_agents", "view_own_agents", "create_agents", "edit_agents", "delete_agents"],
  },
  {
    label: "Transaction Management",
    permissions: ["view_all_transactions", "view_own_transactions", "create_transactions", "edit_transactions", "delete_transactions"],
  },
  {
    label: "Location Management",
    permissions: ["view_all_locations", "view_own_locations", "create_locations", "edit_locations", "delete_locations"],
  },
  {
    label: "Analytics & Reporting",
    permissions: ["view_analytics", "view_reports", "view_financial_data", "export_data"],
  },
  {
    label: "System Administration",
    permissions: ["manage_system", "view_system_logs", "manage_integrations"],
  },
];

const ALL_ROLES: Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE, ROLES.AGENT, ROLES.MERCHANT];

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateUserForm = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      role: "merchant",
      status: "active",
    },
  });

  const { data: users = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch('/api/users', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/users/${userId}/reset-password`),
    onSuccess: async (response) => {
      const data = await response.json();
      toast({
        title: "Password Reset Successful",
        description: `Temporary password: ${data.temporaryPassword}. An email has been sent to the user.`,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reset password", variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: UpdateUserFormData }) =>
      apiRequest("PATCH", `/api/users/${data.userId}`, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      setEditDialogOpen(false);
      setEditingUser(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
      toast({ title: "Success", description: "User account deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user account", variant: "destructive" });
    },
  });

  const getUserRole = (user: User): string => (user as any).role || user.roles?.[0] || "merchant";

  const filteredUsers = users.filter((user: User) =>
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getUserRole(user).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "super_admin": return "destructive";
      case "admin": return "destructive";
      case "agent": return "default";
      case "merchant": return "secondary";
      case "corporate": return "outline";
      default: return "secondary";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "inactive": return "secondary";
      case "suspended": return "destructive";
      default: return "secondary";
    }
  };

  const formatLastLogin = (lastLogin: string | null) => {
    if (!lastLogin) return "Never";
    return new Date(lastLogin).toLocaleDateString();
  };

  function openEditDialog(user: User) {
    setEditingUser(user);
    updateUserForm.reset({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email,
      username: user.username,
      role: getUserRole(user) as any,
      status: user.status as any,
    });
    setEditDialogOpen(true);
  }

  const roleHasPermission = (role: Role, permission: Permission): boolean => {
    return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter((u: User) => (u as any).role === "agent" || u.roles?.[0] === "agent").length}
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
              {users.filter((u: User) => (u as any).role === "merchant" || u.roles?.[0] === "merchant").length}
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
              {users.filter((u: User) => {
                const r = (u as any).role || u.roles?.[0];
                return r === "admin" || r === "super_admin";
              }).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">
            <Users className="h-4 w-4 mr-2" />
            Users
          </TabsTrigger>
          <TabsTrigger value="role-definitions">
            <Shield className="h-4 w-4 mr-2" />
            Role Definitions
          </TabsTrigger>
          <TabsTrigger value="permissions">
            <Settings className="h-4 w-4 mr-2" />
            Permissions by Role
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users by name, email, username, or role..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => refetch()} disabled={isLoading} variant="outline">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {isLoading ? "Refreshing..." : "Refresh"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted-foreground">Loading users...</div>
                </div>
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
                    {filteredUsers.map((user: User) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="font-medium">
                            {user.firstName && user.lastName
                              ? `${user.firstName} ${user.lastName}`
                              : user.username}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            ID: {user.id.substring(0, 8)}...
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.username}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(getUserRole(user)) as any}>
                            {getUserRole(user).replace('_', ' ').toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(user.status) as any}>
                            {user.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{formatLastLogin(user.lastLoginAt?.toString() || null)}</div>
                          {user.emailVerified && (
                            <div className="text-xs text-green-600">Email Verified</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(user)}
                              className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => resetPasswordMutation.mutate(user.id)}
                              disabled={resetPasswordMutation.isPending}
                              className="bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200"
                            >
                              <Key className="h-4 w-4" />
                            </Button>

                            {getUserRole(user) !== "super_admin" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={deleteUserMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete User Account</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete {user.firstName} {user.lastName}'s user account?
                                      This will also remove their associated agent or merchant record.
                                      This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteUserMutation.mutate(user.id)}
                                      className="bg-red-600 hover:bg-red-700"
                                    >
                                      Delete Account
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {filteredUsers.length === 0 && !isLoading && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm ? "No users found matching your search." : "No users found."}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Role Definitions Tab */}
        <TabsContent value="role-definitions">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ALL_ROLES.map((role) => {
                const def = ROLE_DEFINITIONS[role];
                const userCount = users.filter((u: User) => {
                  const r = (u as any).role || u.roles?.[0];
                  return r === role;
                }).length;
                return (
                  <Card key={role}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-muted-foreground" />
                          <CardTitle className="text-base">{def.label}</CardTitle>
                        </div>
                        <Badge variant={def.color as any}>{def.label}</Badge>
                      </div>
                      <CardDescription>{def.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-sm font-medium text-muted-foreground">
                        {userCount} user{userCount !== 1 ? "s" : ""} with this role
                      </div>
                      <ul className="space-y-1">
                        {def.capabilities.map((cap, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            <span>{cap}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="pt-2 border-t">
                        <div className="text-xs text-muted-foreground">
                          {ROLE_PERMISSIONS[role].length} permissions granted
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* Permissions by Role Tab */}
        <TabsContent value="permissions">
          <Card>
            <CardHeader>
              <CardTitle>Permission Matrix</CardTitle>
              <CardDescription>
                Overview of which permissions are granted to each role in the system.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Permission</TableHead>
                      {ALL_ROLES.map((role) => (
                        <TableHead key={role} className="text-center min-w-[110px]">
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant={ROLE_DEFINITIONS[role].color as any} className="text-xs">
                              {ROLE_DEFINITIONS[role].label}
                            </Badge>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERMISSION_GROUPS.map((group) => (
                      <>
                        <TableRow key={`group-${group.label}`} className="bg-muted/40">
                          <TableCell colSpan={ALL_ROLES.length + 1} className="py-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {group.label}
                            </span>
                          </TableCell>
                        </TableRow>
                        {group.permissions.map((permission) => (
                          <TableRow key={permission}>
                            <TableCell className="text-sm pl-4">
                              {PERMISSION_LABELS[permission]}
                            </TableCell>
                            {ALL_ROLES.map((role) => (
                              <TableCell key={role} className="text-center">
                                {roleHasPermission(role, permission) ? (
                                  <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Account</DialogTitle>
            <DialogDescription>
              Update user information. An email will be sent to notify them of any changes.
            </DialogDescription>
          </DialogHeader>

          <Form {...updateUserForm}>
            <form
              onSubmit={updateUserForm.handleSubmit((data) => {
                if (editingUser) {
                  updateUserMutation.mutate({ userId: editingUser.id, updates: data });
                }
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={updateUserForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateUserForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={updateUserForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={updateUserForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={updateUserForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="merchant">Merchant</SelectItem>
                          <SelectItem value="agent">Agent</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="corporate">Corporate</SelectItem>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateUserForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setEditDialogOpen(false); setEditingUser(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateUserMutation.isPending}>
                  {updateUserMutation.isPending ? "Updating..." : "Update User"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
