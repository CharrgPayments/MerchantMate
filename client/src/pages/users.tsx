import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Settings, Trash2, RotateCcw, Users, Edit2, Key, Wand2, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
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
import { validatePasswordStrength } from "@shared/schema";
import { formatPhoneNumber, unformatPhoneNumber, generatePassword } from "@/lib/utils";
import { PasswordConfirmationDialog } from "@/components/password-confirmation-dialog";

// User create form schema
const createUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
  phone: z.string().min(1, "Phone number is required"),
  communicationPreference: z.enum(["email", "sms", "both"]).default("email"),
  roles: z.array(z.enum(["merchant", "agent", "admin", "corporate", "super_admin"])).min(1, "At least one role is required"),
}).refine((data) => {
  const validation = validatePasswordStrength(data.password);
  return validation.valid;
}, {
  message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  path: ["password"],
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
}).refine((data) => unformatPhoneNumber(data.phone).length === 10, {
  message: "Phone number must be exactly 10 digits",
  path: ["phone"],
});

// User update form schema
const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  communicationPreference: z.enum(["email", "sms", "both"]),
  roles: z.array(z.enum(["merchant", "agent", "admin", "corporate", "super_admin"])).min(1, "At least one role is required"),
  status: z.enum(["active", "suspended", "inactive"]),
});

type CreateUserFormData = z.infer<typeof createUserSchema>;
type UpdateUserFormData = z.infer<typeof updateUserSchema>;

// Create User Form Component
function CreateUserForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedPassword, setCopiedPassword] = useState(false);

  const createUserForm = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
      phone: "",
      communicationPreference: "email" as const,
      roles: ["merchant"],
    },
  });

  const handleGeneratePassword = () => {
    const newPassword = generatePassword();
    createUserForm.setValue("password", newPassword);
    createUserForm.setValue("confirmPassword", newPassword);
    
    navigator.clipboard.writeText(newPassword).then(() => {
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
      toast({
        title: "Password Generated",
        description: "A strong password has been generated and copied to clipboard.",
      });
    }).catch(() => {
      toast({
        title: "Password Generated",
        description: "A strong password has been generated. Please copy it manually from the field.",
        variant: "default",
      });
    });
  };

  const createUserMutation = useMutation({
    mutationFn: async (data: CreateUserFormData) => {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create user');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "User account created successfully. A verification email has been sent.",
      });
      createUserForm.reset();
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateUserFormData) => {
    createUserMutation.mutate(data);
  };

  return (
    <Form {...createUserForm}>
      <form onSubmit={createUserForm.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={createUserForm.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input placeholder="Enter first name" name={field.name} value={field.value || ""} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={createUserForm.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input placeholder="Enter last name" name={field.name} value={field.value || ""} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <FormField
          control={createUserForm.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="Enter email address" name={field.name} value={field.value || ""} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={createUserForm.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="Enter username" name={field.name} value={field.value || ""} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={createUserForm.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number *</FormLabel>
              <FormControl>
                <Input 
                  type="tel" 
                  placeholder="(555) 555-5555" 
                  name={field.name} 
                  value={field.value || ""} 
                  onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={createUserForm.control}
          name="communicationPreference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Communication Preferences *</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 mb-2">
                    Choose how you'd like to receive notifications:
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="communicationPreference"
                        value="email"
                        checked={field.value === "email"}
                        onChange={() => field.onChange("email")}
                        className="rounded"
                      />
                      <span className="text-sm">📧 Email notifications</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="communicationPreference"
                        value="sms"
                        checked={field.value === "sms"}
                        onChange={() => field.onChange("sms")}
                        className="rounded"
                      />
                      <span className="text-sm">📱 SMS text messages</span>
                    </label>
                  </div>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <FormLabel>Password</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGeneratePassword}
              className="h-7 text-xs"
              data-testid="button-generate-password"
            >
              {copiedPassword ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied!
                </>
              ) : (
                <>
                  <Wand2 className="h-3 w-3 mr-1" />
                  Generate Password
                </>
              )}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={createUserForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="password" placeholder="Enter password" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={createUserForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="password" placeholder="Confirm password" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-confirm-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        
        <FormField
          control={createUserForm.control}
          name="roles"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Roles</FormLabel>
              <FormControl>
                <div className="space-y-2">
                  {[
                    { value: "merchant", label: "Merchant" },
                    { value: "agent", label: "Agent" },
                    { value: "admin", label: "Admin" },
                    { value: "corporate", label: "Corporate" },
                    { value: "super_admin", label: "Super Admin" },
                  ].map((role) => (
                    <label key={role.value} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={field.value.includes(role.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            field.onChange([...field.value, role.value]);
                          } else {
                            field.onChange(field.value.filter((r: string) => r !== role.value));
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">{role.label}</span>
                    </label>
                  ))}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              createUserForm.reset();
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createUserMutation.isPending}>
            {createUserMutation.isPending ? "Creating..." : "Create User"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [passwordConfirmOpen, setPasswordConfirmOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ userId: string; updates: UpdateUserFormData } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateUserForm = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      communicationPreference: "email" as const,
      roles: ["merchant"],
      status: "active",
    },
  });

  const { data: users = [], isLoading, refetch, error } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch('/api/users', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Debug logging
  console.log("Users data:", users);
  console.log("Users length:", users?.length);
  console.log("Is loading:", isLoading);
  console.log("Error:", error);

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
      toast({
        title: "Error",
        description: "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: UpdateUserFormData & { password?: string } }) =>
      apiRequest("PATCH", `/api/users/${data.userId}`, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      setEditDialogOpen(false);
      setEditingUser(null);
      setPendingUpdate(null);
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update user";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handlePasswordVerified = (password: string) => {
    if (pendingUpdate) {
      // Include the verified password in the update request
      updateUserMutation.mutate({
        ...pendingUpdate,
        updates: { ...pendingUpdate.updates, password }
      });
    }
  };

  const handleUpdateUser = (updates: UpdateUserFormData) => {
    if (!editingUser) return;

    // Check if roles or status are being changed
    const rolesChanged = JSON.stringify(updates.roles) !== JSON.stringify(editingUser.roles);
    const statusChanged = updates.status !== editingUser.status;
    const isSensitiveUpdate = rolesChanged || statusChanged;

    if (isSensitiveUpdate) {
      // Store the update and show password confirmation
      setPendingUpdate({ userId: editingUser.id, updates });
      setPasswordConfirmOpen(true);
    } else {
      // No sensitive changes, exclude roles and status from updates to avoid password requirement
      const { roles, status, ...nonSensitiveUpdates } = updates;
      updateUserMutation.mutate({ userId: editingUser.id, updates: nonSensitiveUpdates });
    }
  };

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("DELETE", `/api/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
      toast({
        title: "Success",
        description: "User account deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete user account",
        variant: "destructive",
      });
    },
  });

  const filteredUsers = users.filter((user: User) =>
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.roles.some((role: string) => role.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "super_admin":
        return "gold";
      case "admin":
        return "destructive";
      case "agent":
        return "default";
      case "merchant":
        return "secondary";
      case "corporate":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "suspended":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const formatLastLogin = (lastLogin: string | null) => {
    if (!lastLogin) return "Never";
    return new Date(lastLogin).toLocaleDateString();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Action Buttons */}
      <div className="flex justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Users</h1>
        </div>
        <div className="flex gap-2">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Users className="h-4 w-4 mr-2" />
                Create User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user to the system with their role and details.
                </DialogDescription>
              </DialogHeader>
              <CreateUserForm 
                onSuccess={() => {
                  setCreateDialogOpen(false);
                  refetch();
                }} 
                onCancel={() => setCreateDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
          <Button onClick={() => refetch()} disabled={isLoading} variant="outline">
            {isLoading ? "Refreshing..." : "Refresh Data"}
          </Button>
          <Button 
            variant="outline" 
            onClick={async () => {
              // Clear React Query cache and force fresh data fetch
              await queryClient.resetQueries();
              window.location.reload();
            }} 
            disabled={isLoading}
          >
            Force Refresh
          </Button>
        </div>
      </div>

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
              {users.filter((u: User) => u.roles?.includes("agent")).length}
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
              {users.filter((u: User) => u.roles?.includes("merchant")).length}
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
              {users.filter((u: User) => u.roles?.includes("admin") || u.roles?.includes("super_admin")).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users by name, email, username, or role..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
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
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role: string) => (
                          <Badge key={role} variant={getRoleBadgeVariant(role)}>
                            {role.replace('_', ' ').toUpperCase()}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(user.status)}>
                        {user.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {formatLastLogin(user.lastLoginAt?.toString() || null)}
                      </div>
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
                        
                        {user.role !== "super_admin" && (
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
              onSubmit={updateUserForm.handleSubmit(handleUpdateUser)}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={updateUserForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input name={field.name} value={field.value || ""} onChange={field.onChange} />
                      </FormControl>
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
                      <FormControl>
                        <Input name={field.name} value={field.value || ""} onChange={field.onChange} />
                      </FormControl>
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
                    <FormControl>
                      <Input type="email" name={field.name} value={field.value || ""} onChange={field.onChange} />
                    </FormControl>
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
                    <FormControl>
                      <Input name={field.name} value={field.value || ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={updateUserForm.control}
                name="communicationPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Communication Preference</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select preference" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="email">Email Only</SelectItem>
                        <SelectItem value="sms">SMS Only</SelectItem>
                        <SelectItem value="both">Both Email & SMS</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={updateUserForm.control}
                  name="roles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Roles</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          {[
                            { value: "merchant", label: "Merchant" },
                            { value: "agent", label: "Agent" },
                            { value: "admin", label: "Admin" },
                            { value: "corporate", label: "Corporate" },
                            { value: "super_admin", label: "Super Admin" },
                          ].map((role) => (
                            <label key={role.value} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={field.value.includes(role.value)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    field.onChange([...field.value, role.value]);
                                  } else {
                                    field.onChange(field.value.filter((r: string) => r !== role.value));
                                  }
                                }}
                                className="rounded"
                              />
                              <span className="text-sm">{role.label}</span>
                            </label>
                          ))}
                        </div>
                      </FormControl>
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
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
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
                  onClick={() => {
                    setEditDialogOpen(false);
                    setEditingUser(null);
                  }}
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

      {/* Password Confirmation Dialog */}
      <PasswordConfirmationDialog
        isOpen={passwordConfirmOpen}
        onClose={() => {
          setPasswordConfirmOpen(false);
          setPendingUpdate(null);
        }}
        onConfirm={handlePasswordVerified}
        title="Confirm Role/Status Change"
        description="This action requires password verification for security purposes. Changing user roles or status is a sensitive operation. Please enter your password to continue."
      />

    </div>
  );

  // Helper function to open edit dialog
  function openEditDialog(user: User) {
    setEditingUser(user);
    updateUserForm.reset({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email,
      username: user.username,
      communicationPreference: (user.communicationPreference || "email") as any,
      roles: user.roles || ["merchant"],
      status: user.status as any,
    });
    setEditDialogOpen(true);
  }
}