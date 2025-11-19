import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { merchantsApi, agentsApi } from "@/lib/api";
import type { Merchant, InsertMerchant } from "@shared/schema";
import { formatPhoneNumber, unformatPhoneNumber } from "@/lib/utils";
import { HelpCircle, Store } from "lucide-react";

const merchantSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  businessType: z.string().min(1, "Business type is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  address: z.string().optional(),
  agentId: z.number().optional(),
  processingFee: z.string().default("2.50"),
  status: z.enum(["active", "pending", "suspended"]).default("active"),
  monthlyVolume: z.string().default("0"),
}).refine((data) => unformatPhoneNumber(data.phone).length === 10, {
  message: "Phone number must be exactly 10 digits",
  path: ["phone"],
});

type MerchantFormData = z.infer<typeof merchantSchema>;

interface MerchantModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchant?: Merchant;
}

export function MerchantModal({ isOpen, onClose, merchant }: MerchantModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<MerchantFormData>({
    resolver: zodResolver(merchantSchema),
    defaultValues: {
      businessName: merchant?.businessName || "",
      businessType: merchant?.businessType || "",
      email: merchant?.email || "",
      phone: merchant?.phone || "",
      address: merchant?.address || "",
      agentId: merchant?.agentId || undefined,
      processingFee: merchant?.processingFee || "2.50",
      status: merchant?.status || "active",
      monthlyVolume: merchant?.monthlyVolume || "0",
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["/api/agents"],
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertMerchant) => merchantsApi.create(data),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboard"] });
      
      // Show user account creation details
      if (response.user) {
        toast({
          title: "Merchant and User Account Created",
          description: `Merchant created successfully. Login: ${response.user.username} Password: ${response.user.temporaryPassword}`,
        });
      } else {
        toast({
          title: "Success",
          description: "Merchant created successfully",
        });
      }
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create merchant",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertMerchant>) => 
      merchantsApi.update(merchant!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboard"] });
      toast({
        title: "Success",
        description: "Merchant updated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update merchant",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: MerchantFormData) => {
    if (merchant) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>
              {merchant ? "Edit Merchant" : "Add New Merchant"}
            </DialogTitle>
            <Dialog>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 h-8"
                  data-testid="button-merchant-help"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span className="text-xs">Help</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Merchant Information Guide</DialogTitle>
                  <DialogDescription>
                    Learn how to properly configure merchant profiles with business details and payment settings.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 text-sm">
                  <div>
                    <h3 className="font-semibold text-base mb-2">Required Fields</h3>
                    <p className="text-muted-foreground">
                      Fields marked with an asterisk (*) are required to create a merchant profile. These ensure you have the minimum information needed for payment processing.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-semibold">Business Types</h3>
                    <p className="text-muted-foreground mb-2">
                      Select the business type that best describes the merchant's operation:
                    </p>
                    
                    <div className="space-y-2">
                      <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
                        <h4 className="font-medium text-blue-900 mb-1">🏢 Retail</h4>
                        <p className="text-sm text-blue-800">
                          Physical store locations accepting in-person payments (card present transactions)
                        </p>
                      </div>

                      <div className="bg-green-50 p-3 rounded-md border border-green-200">
                        <h4 className="font-medium text-green-900 mb-1">🍔 Restaurant</h4>
                        <p className="text-sm text-green-800">
                          Food service businesses including restaurants, cafes, and food trucks
                        </p>
                      </div>

                      <div className="bg-purple-50 p-3 rounded-md border border-purple-200">
                        <h4 className="font-medium text-purple-900 mb-1">🛒 E-commerce</h4>
                        <p className="text-sm text-purple-800">
                          Online businesses processing card-not-present (CNP) transactions
                        </p>
                      </div>

                      <div className="bg-orange-50 p-3 rounded-md border border-orange-200">
                        <h4 className="font-medium text-orange-900 mb-1">🚚 Service</h4>
                        <p className="text-sm text-orange-800">
                          Service-based businesses like contractors, consultants, or delivery services
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Phone Number Format</h3>
                    <p className="text-muted-foreground">
                      Enter phone numbers in standard format: <code className="bg-gray-100 px-1 py-0.5 rounded">(555) 123-4567</code>. The system requires exactly 10 digits for US phone numbers. Auto-formatting will be applied as you type.
                    </p>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Processing Fee (%)</h3>
                    <p className="text-muted-foreground mb-2">
                      The percentage fee charged per transaction. Typical ranges:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      <li><strong>2.5% - 2.9%:</strong> Standard retail card-present transactions</li>
                      <li><strong>2.9% - 3.5%:</strong> E-commerce card-not-present transactions</li>
                      <li><strong>3.5%+:</strong> High-risk or premium card transactions</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Monthly Volume ($)</h3>
                    <p className="text-muted-foreground">
                      The estimated or actual monthly transaction volume in dollars. This helps with:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      <li>Pricing tier calculations and volume discounts</li>
                      <li>Risk assessment and fraud prevention</li>
                      <li>Analytics and revenue forecasting</li>
                      <li>Agent commission calculations</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Merchant Status</h3>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">Active</span>
                        <p className="text-xs text-muted-foreground flex-1">Merchant can process transactions</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>
                        <p className="text-xs text-muted-foreground flex-1">Awaiting approval or document verification</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">Suspended</span>
                        <p className="text-xs text-muted-foreground flex-1">Temporarily disabled - cannot process payments</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-50 p-3 rounded-md border border-amber-200">
                    <h3 className="font-semibold text-amber-900 mb-2">💡 Pro Tips</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-amber-800">
                      <li>Assign an agent to track commissions and maintain relationships</li>
                      <li>Update monthly volume regularly for accurate reporting</li>
                      <li>Use "Pending" status during onboarding to prevent premature activation</li>
                      <li>Include complete address information for compliance and fraud prevention</li>
                    </ul>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter business name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="businessType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Type *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select business type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Retail">Retail</SelectItem>
                        <SelectItem value="Food & Beverage">Food & Beverage</SelectItem>
                        <SelectItem value="Electronics">Electronics</SelectItem>
                        <SelectItem value="Services">Services</SelectItem>
                        <SelectItem value="Healthcare">Healthcare</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address *</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="business@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="(555) 555-5555" 
                        value={field.value || ""}
                        onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="agentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned Agent</FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} 
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id.toString()}>
                            {agent.firstName} {agent.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="processingFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Processing Fee (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="2.50"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="monthlyVolume"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Volume ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter complete business address"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-end space-x-4 pt-6 border-t">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : merchant ? "Update Merchant" : "Create Merchant"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
