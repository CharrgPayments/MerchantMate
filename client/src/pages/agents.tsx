import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit, Trash2, ChevronDown, ChevronRight, Building2, Mail, Phone, MapPin, Key, User, UserX } from "lucide-react";
import { agentsApi } from "@/lib/api";
import { AgentModal } from "@/components/modals/agent-modal";
import type { Agent, Merchant } from "@shared/schema";

export default function Agents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["/api/agents", searchQuery],
    queryFn: () => agentsApi.getAll(searchQuery || undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => agentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboard"] });
      toast({
        title: "Success",
        description: "Agent deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete agent",
        variant: "destructive",
      });
    },
  });

  const filteredAgents = agents.filter((agent) => {
    if (statusFilter === "all") return true;
    return agent.status === statusFilter;
  });

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setIsModalOpen(true);
  };

  const handleDelete = (agent: Agent) => {
    if (window.confirm(`Are you sure you want to delete ${agent.firstName} ${agent.lastName}?`)) {
      deleteMutation.mutate(agent.id);
    }
  };

  // User account management mutations
  const resetPasswordMutation = useMutation({
    mutationFn: async (agentId: number) => {
      const response = await fetch(`/api/agents/${agentId}/reset-password`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to reset password');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Password Reset Successfully",
        description: `New password for ${data.username}: ${data.temporaryPassword}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const handleResetPassword = (agent: Agent) => {
    if (window.confirm(`Reset password for ${agent.firstName} ${agent.lastName}?`)) {
      resetPasswordMutation.mutate(agent.id);
    }
  };

  const deleteUserAccountMutation = useMutation({
    mutationFn: async (agentId: number) => {
      // Get agent user account details first
      const agent = await agentsApi.getById(agentId);
      if (!agent.userId) throw new Error('No user account found');
      
      const response = await fetch(`/api/users/${agent.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete user account');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({
        title: "User Account Deleted",
        description: "Agent and associated user account deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user account",
        variant: "destructive",
      });
    },
  });

  const handleDeleteUserAccount = (agent: Agent) => {
    if (window.confirm(`Delete user account for ${agent.firstName} ${agent.lastName}? This will permanently remove their login access.`)) {
      deleteUserAccountMutation.mutate(agent.id);
    }
  };

  const handleAddNew = () => {
    setEditingAgent(undefined);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAgent(undefined);
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: "corecrm-status-active",
      inactive: "corecrm-status-suspended",
    };
    return styles[status as keyof typeof styles] || "bg-gray-100 text-gray-800";
  };

  const toggleRowExpansion = (agentId: number) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(agentId)) {
      newExpandedRows.delete(agentId);
    } else {
      newExpandedRows.add(agentId);
    }
    setExpandedRows(newExpandedRows);
  };

  // Hook to fetch merchants for an expanded agent
  const useAgentMerchants = (agentId: number, enabled: boolean) => {
    return useQuery({
      queryKey: ["/api/agents", agentId, "merchants"],
      queryFn: async () => {
        const response = await fetch(`/api/agents/${agentId}/merchants`);
        if (!response.ok) throw new Error('Failed to fetch agent merchants');
        return response.json() as Promise<Merchant[]>;
      },
      enabled,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <Card className="corecrm-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Agents</CardTitle>
            <Button onClick={handleAddNew}>
              <Plus className="w-4 h-4 mr-2" />
              Add Agent
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Territory</TableHead>
                  <TableHead>Commission Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-6" /></TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          <Skeleton className="w-8 h-8 rounded-full" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      {searchQuery || statusFilter !== "all" ? "No agents found matching your filters" : "No agents found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => (
                    <AgentRowWithMerchants 
                      key={agent.id} 
                      agent={agent}
                      isExpanded={expandedRows.has(agent.id)}
                      onToggleExpand={() => toggleRowExpansion(agent.id)}
                      onEdit={() => handleEdit(agent)}
                      onDelete={() => handleDelete(agent)}
                      onResetPassword={() => handleResetPassword(agent)}
                      onDeleteUserAccount={() => handleDeleteUserAccount(agent)}
                      getStatusBadge={getStatusBadge}
                      useAgentMerchants={useAgentMerchants}
                      isDeleting={deleteMutation.isPending}
                      isResettingPassword={resetPasswordMutation.isPending}
                      isDeletingUserAccount={deleteUserAccountMutation.isPending}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination placeholder */}
          {filteredAgents.length > 0 && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-gray-500">
                Showing {filteredAgents.length} of {agents.length} agents
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AgentModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        agent={editingAgent}
      />
    </div>
  );
}

// Component for expandable agent rows
interface AgentRowWithMerchantsProps {
  agent: Agent;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onResetPassword: () => void;
  onDeleteUserAccount: () => void;
  getStatusBadge: (status: string) => string;
  useAgentMerchants: (agentId: number, enabled: boolean) => any;
  isDeleting: boolean;
  isResettingPassword: boolean;
  isDeletingUserAccount: boolean;
}

function AgentRowWithMerchants({
  agent,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onResetPassword,
  onDeleteUserAccount,
  getStatusBadge,
  useAgentMerchants,
  isDeleting,
  isResettingPassword,
  isDeletingUserAccount
}: AgentRowWithMerchantsProps) {
  const { data: merchants = [], isLoading: merchantsLoading } = useAgentMerchants(agent.id, isExpanded);

  return (
    <>
      <TableRow>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            className="p-1"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 font-medium text-sm">
                {agent.firstName.charAt(0)}{agent.lastName.charAt(0)}
              </span>
            </div>
            <div className="font-medium text-gray-900">
              {agent.firstName} {agent.lastName}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-gray-500">{agent.email}</TableCell>
        <TableCell className="text-gray-500">{agent.phone}</TableCell>
        <TableCell className="text-gray-500">{agent.territory || "—"}</TableCell>
        <TableCell className="font-medium">{agent.commissionRate}%</TableCell>
        <TableCell>
          <Badge className={`corecrm-status-badge ${getStatusBadge(agent.status)}`}>
            {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              title="Edit agent"
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetPassword}
              disabled={isResettingPassword}
              title="Reset user account password"
            >
              <Key className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeleteUserAccount}
              disabled={isDeletingUserAccount}
              title="Delete user account"
            >
              <UserX className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              title="Delete agent"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="p-0">
            <div className="bg-gray-50 border-t px-6 py-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-900 flex items-center">
                  <Building2 className="w-4 h-4 mr-2" />
                  Associated Merchants ({merchants.length})
                </h4>
              </div>
              
              {merchantsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center space-x-3">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
              ) : merchants.length === 0 ? (
                <p className="text-sm text-gray-500">No merchants assigned to this agent</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {merchants.map((merchant) => (
                    <div key={merchant.id} className="bg-white rounded-lg border p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h5 className="text-sm font-medium text-gray-900 mb-1">
                            {merchant.businessName}
                          </h5>
                          <div className="text-xs text-gray-500 space-y-1">
                            <div className="flex items-center">
                              <Mail className="w-3 h-3 mr-1" />
                              {merchant.email}
                            </div>
                            <div className="flex items-center">
                              <Phone className="w-3 h-3 mr-1" />
                              {merchant.phone}
                            </div>
                            <div className="flex items-center">
                              <Building2 className="w-3 h-3 mr-1" />
                              {merchant.businessType}
                            </div>
                          </div>
                        </div>
                        <Badge className={`text-xs ${getStatusBadge(merchant.status)}`}>
                          {merchant.status}
                        </Badge>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Monthly Volume:</span>
                          <span className="font-medium">${merchant.monthlyVolume}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-gray-500">Processing Fee:</span>
                          <span className="font-medium">{merchant.processingFee}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
