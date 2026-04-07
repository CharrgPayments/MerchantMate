import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { agentsApi } from "@/lib/api";
import type { Agent, InsertAgent } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, User, Building, UserCheck, CheckCircle, MapPin, Loader2, Wand2, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import React from "react";
import { formatPhoneNumber, unformatPhoneNumber, formatEIN, unformatEIN, generatePassword } from "@/lib/utils";
import { validatePasswordStrength } from "@shared/schema";

const agentSchema = z.object({
  // Agent fields
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  territory: z.string().optional(),
  commissionRate: z.string().default("5.00"),
  status: z.enum(["active", "inactive"]).default("active"),
  // Company fields (required)
  companyName: z.string().min(1, "Company name is required"),
  companyBusinessType: z.enum(["corporation", "llc", "partnership", "sole_proprietorship", "non_profit"]).optional(),
  companyEmail: z.string().email().optional().or(z.literal("")),
  companyPhone: z.string().optional(),
  companyWebsite: z.string().url().optional().or(z.literal("")),
  companyTaxId: z.string().optional(),
  companyIndustry: z.string().optional(),
  companyDescription: z.string().optional(),
  companyAddress: z.object({
    street1: z.string().optional(),
    street2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default("US").optional(),
  }).optional(),
  // User account fields (required for creation, optional for edit)
  username: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  communicationPreference: z.enum(["email", "sms", "both"]).default("email").optional(),
}).superRefine((data, ctx) => {
  // Validate phone number has exactly 10 digits
  if (data.phone && unformatPhoneNumber(data.phone).length !== 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Phone number must be exactly 10 digits",
      path: ["phone"],
    });
  }
  
  // Validate company phone if provided
  if (data.companyPhone && unformatPhoneNumber(data.companyPhone).length !== 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Company phone must be exactly 10 digits",
      path: ["companyPhone"],
    });
  }
  
  // Validate company tax ID (EIN) if provided - must be exactly 9 digits
  if (data.companyTaxId && unformatEIN(data.companyTaxId).length !== 9) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tax ID (EIN) must be exactly 9 digits",
      path: ["companyTaxId"],
    });
  }
}).superRefine((data, ctx) => {
  // In create mode, username starts as empty string (not undefined)
  // In edit mode, username is undefined
  // So if username is defined (even as empty string), we're in create mode and must validate
  if (data.username !== undefined) {
    if (!data.username || data.username.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 3,
        type: "string",
        inclusive: true,
        message: "Username must be at least 3 characters",
        path: ["username"],
      });
    }
    
    if (!data.password || data.password.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 12,
        type: "string",
        inclusive: true,
        message: "Password must be at least 12 characters",
        path: ["password"],
      });
    }
    
    // Validate password strength
    if (data.password) {
      const validation = validatePasswordStrength(data.password);
      if (!validation.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
          path: ["password"],
        });
      }
    }
    
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
    
    if (!data.communicationPreference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Communication preference is required",
        path: ["communicationPreference"],
      });
    }
  }
});

type AgentFormData = z.infer<typeof agentSchema>;

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent?: Agent;
}

// Wizard sections configuration
const wizardSections = [
  {
    id: "agent",
    name: "Agent Information",
    description: "Basic agent details and contact information",
    icon: User,
    fields: ["firstName", "lastName", "email", "phone", "territory", "commissionRate", "status"]
  },
  {
    id: "company",
    name: "Company Information",
    description: "Company details and business information", 
    icon: Building,
    fields: ["companyName", "companyBusinessType", "companyEmail", "companyPhone", "companyWebsite", "companyTaxId", "companyIndustry", "companyDescription"]
  },
  {
    id: "address",
    name: "Company Address",
    description: "Physical address for the company",
    icon: Building,
    fields: ["companyAddress"]
  },
  {
    id: "user",
    name: "User Account",
    description: "Required login credentials for the agent",
    icon: UserCheck,
    fields: ["username", "password", "confirmPassword", "communicationPreference"]
  }
];

export function AgentModal({ isOpen, onClose, agent }: AgentModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSections, setVisitedSections] = useState<Set<number>>(new Set([0]));
  const [copiedPassword, setCopiedPassword] = useState(false);
  
  // Address autocomplete state
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [addressFieldsLocked, setAddressFieldsLocked] = useState(false);
  const [addressValidationStatus, setAddressValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  
  // Refs for address autocomplete
  const addressInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      firstName: agent?.firstName || "",
      lastName: agent?.lastName || "",
      email: (agent as any)?.email || "",
      phone: (agent as any)?.phone || "",
      territory: agent?.territory || "",
      commissionRate: agent?.commissionRate || "5.00",
      status: (agent?.status as "active" | "inactive") || "active",
      // Company defaults (required)
      companyName: "",
      companyBusinessType: undefined,
      companyEmail: "",
      companyPhone: "",
      companyWebsite: "",
      companyTaxId: "",
      companyIndustry: "",
      companyDescription: "",
      companyAddress: {
        street1: "",
        street2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "US",
      },
      // User account defaults (required)
      username: "",
      password: "",
      confirmPassword: "",
      communicationPreference: "email",
    },
  });



  const createMutation = useMutation({
    mutationFn: (data: InsertAgent) => agentsApi.create(data),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboard"] });
      
      // Show user account creation details
      if (response.user) {
        toast({
          title: "Agent and User Account Created",
          description: `Agent created successfully. Login: ${response.user.username} Password: ${response.user.temporaryPassword}`,
        });
      } else {
        toast({
          title: "Success",
          description: "Agent created successfully",
        });
      }
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create agent",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertAgent>) => 
      agentsApi.update(agent!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboard"] });
      toast({
        title: "Success",
        description: "Agent updated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update agent",
        variant: "destructive",
      });
    },
  });

  // Fetch address suggestions using Google Places Autocomplete API
  const fetchAddressSuggestions = async (input: string) => {
    if (input.length < 4) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
      return;
    }

    setIsLoadingSuggestions(true);
    
    try {
      const response = await fetch('/api/address-autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setAddressSuggestions(result.suggestions || []);
        setShowSuggestions(true);
        setSelectedSuggestionIndex(-1);
      } else {
        console.error('Address suggestions API error:', response.status);
      }
    } catch (error) {
      console.error('Address suggestions network error:', error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  // Validate selected address using Google Geocoding API
  const validateAndSelectAddress = async (suggestion: any) => {
    try {
      const response = await fetch('/api/validate-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address: suggestion.description }),
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.isValid) {
          setAddressValidationStatus('valid');
          
          // Update form with validated address data - set each field individually
          form.setValue("companyAddress.street1", result.streetAddress || suggestion.description.split(',')[0].trim());
          form.setValue("companyAddress.city", result.city || '');
          form.setValue("companyAddress.state", result.state || '');
          form.setValue("companyAddress.postalCode", result.zipCode || '');
          form.setValue("companyAddress.country", 'US');
          
          // Lock the address fields after successful selection
          setAddressFieldsLocked(true);
          
          // Clear suggestions
          setShowSuggestions(false);
          setAddressSuggestions([]);
        } else {
          setAddressValidationStatus('invalid');
        }
      }
    } catch (error) {
      console.error('Address validation error:', error);
      setAddressValidationStatus('invalid');
    }
  };

  // Handle address input changes
  const handleAddressChange = (value: string) => {
    // If user starts typing in a locked address field, unlock it for new selection
    if (addressFieldsLocked && value !== form.getValues("companyAddress.street1")) {
      setAddressFieldsLocked(false);
      setAddressValidationStatus('idle');
    }
    
    if (value && value.length >= 4) {
      fetchAddressSuggestions(value);
    } else {
      setShowSuggestions(false);
      setAddressSuggestions([]);
      setSelectedSuggestionIndex(-1);
      
      // Clear dependent fields when address is cleared - set each field individually
      if (value.length === 0 && !addressFieldsLocked) {
        form.setValue("companyAddress.city", '');
        form.setValue("companyAddress.state", '');
        form.setValue("companyAddress.postalCode", '');
      }
    }
  };

  // Handle keyboard navigation in suggestions
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Always prevent Enter from submitting the form in address input
    if (e.key === 'Enter') {
      e.preventDefault();
      // If suggestions are visible and one is selected, use it
      if (showSuggestions && addressSuggestions.length > 0 && selectedSuggestionIndex >= 0) {
        validateAndSelectAddress(addressSuggestions[selectedSuggestionIndex]);
      }
      return;
    }

    // Handle other keys only when suggestions are visible
    if (!showSuggestions || addressSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < addressSuggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };

  // Reset form when modal opens or agent changes
  useEffect(() => {
    if (isOpen) {
      // Reset wizard state
      setCurrentStep(0);
      setVisitedSections(new Set([0]));
      
      // Reset address state
      setAddressSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setSelectedSuggestionIndex(-1);
      setAddressFieldsLocked(false);
      setAddressValidationStatus('idle');
      
      // Reset form with appropriate values
      if (agent) {
        // Edit mode - populate with agent data including company and address
        const agentWithCompany = agent as any; // Agent may include company and address data
        
        const formData = {
          firstName: agent.firstName || "",
          lastName: agent.lastName || "",
          email: (agent as any).email || "",
          phone: (agent as any).phone || "",
          territory: agent.territory || "",
          commissionRate: agent.commissionRate || "5.00",
          status: (agent.status as "active" | "inactive") || "active",
          // Company data from joined data
          companyName: agentWithCompany.company?.name || "",
          companyBusinessType: agentWithCompany.company?.businessType as any || undefined,
          companyEmail: agentWithCompany.company?.email || "",
          companyPhone: agentWithCompany.company?.phone || "",
          companyWebsite: agentWithCompany.company?.website || "",
          companyTaxId: agentWithCompany.company?.taxId || "",
          companyIndustry: agentWithCompany.company?.industry || "",
          companyDescription: agentWithCompany.company?.description || "",
          companyAddress: {
            street1: agentWithCompany.address?.street1 || "",
            street2: agentWithCompany.address?.street2 || "",
            city: agentWithCompany.address?.city || "",
            state: agentWithCompany.address?.state || "",
            postalCode: agentWithCompany.address?.postalCode || "",
            country: agentWithCompany.address?.country || "US",
          },
          // User account defaults (clear for edit mode - not editable)
          username: undefined,
          password: undefined,
          confirmPassword: undefined,
          communicationPreference: undefined,
        };
        
        form.reset(formData);
        
        // Explicitly set address fields using setValue to ensure they're populated
        if (agentWithCompany.address) {
          setTimeout(() => {
            if (agentWithCompany.address.street1) {
              form.setValue("companyAddress.street1", agentWithCompany.address.street1);
            }
            if (agentWithCompany.address.street2) {
              form.setValue("companyAddress.street2", agentWithCompany.address.street2);
            }
            if (agentWithCompany.address.city) {
              form.setValue("companyAddress.city", agentWithCompany.address.city);
            }
            if (agentWithCompany.address.state) {
              form.setValue("companyAddress.state", agentWithCompany.address.state);
            }
            if (agentWithCompany.address.postalCode) {
              form.setValue("companyAddress.postalCode", agentWithCompany.address.postalCode);
            }
            if (agentWithCompany.address.country) {
              form.setValue("companyAddress.country", agentWithCompany.address.country);
            }
          }, 50);
        }
        
        // If address exists, lock it for editing
        if (agentWithCompany.address?.street1) {
          setAddressFieldsLocked(true);
          setAddressValidationStatus('valid');
        }
      } else {
        // Add mode - reset to completely clean state
        form.reset({
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          territory: "",
          commissionRate: "5.00",
          status: "active",
          // Company defaults
          companyName: "",
          companyBusinessType: undefined,
          companyEmail: "",
          companyPhone: "",
          companyWebsite: "",
          companyTaxId: "",
          companyIndustry: "",
          companyDescription: "",
          companyAddress: {
            street1: "",
            street2: "",
            city: "",
            state: "",
            postalCode: "",
            country: "US",
          },
          // User account defaults (required for creation)
          username: "",
          password: "",
          confirmPassword: "",
          communicationPreference: "email",
        });
      }
    }
  }, [isOpen, agent, form]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        addressInputRef.current &&
        !addressInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check if a section is completed (all required fields filled and valid)
  const isSectionCompleted = (sectionIndex: number): boolean => {
    const section = availableSections[sectionIndex];
    const formValues = form.getValues();
    const formErrors = form.formState.errors;
    
    // Check each field in the section
    for (const fieldName of section.fields) {
      const fieldValue = formValues[fieldName as keyof AgentFormData];
      const fieldError = formErrors[fieldName as keyof AgentFormData];
      
      // Required fields that must be filled
      const requiredFields = ["firstName", "lastName", "email", "companyName", "companyEmail", "username", "password", "confirmPassword", "communicationPreference"];
      
      if (requiredFields.includes(fieldName)) {
        // Check if field has error or is empty
        if (fieldError || !fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '')) {
          return false;
        }
      }
    }
    
    return true;
  };

  const onSubmit = (data: AgentFormData) => {
    if (agent) {
      // For updates, send agent data and user account creation fields
      // Note: Company/address updates not yet supported, only user account creation
      const { companyName, companyBusinessType, companyEmail, companyPhone, companyWebsite, companyTaxId, companyIndustry, companyDescription, companyAddress, ...agentAndUserData } = data;
      updateMutation.mutate(agentAndUserData as any);
    } else {
      // For creation, send all data including company and user account with agent role
      // Include createUserAccount flag based on whether username/password are provided
      const createData = {
        ...data,
        roles: ["agent"] as ("merchant" | "agent" | "admin" | "corporate" | "super_admin")[],
        createUserAccount: Boolean(data.username && data.password)
      };
      createMutation.mutate(createData as any);
    }
  };

  const handleNext = () => {
    const nextStep = Math.min(availableSections.length - 1, currentStep + 1);
    setVisitedSections(prev => {
      const newVisited = new Set(Array.from(prev));
      newVisited.add(currentStep);
      newVisited.add(nextStep);
      return newVisited;
    });
    setCurrentStep(nextStep);
  };

  const handlePrevious = () => {
    const prevStep = Math.max(0, currentStep - 1);
    setVisitedSections(prev => {
      const newVisited = new Set(Array.from(prev));
      newVisited.add(currentStep);
      return newVisited;
    });
    setCurrentStep(prevStep);
  };

  const navigateToSection = (sectionIndex: number) => {
    setVisitedSections(prev => {
      const newVisited = new Set(Array.from(prev));
      newVisited.add(sectionIndex);
      return newVisited;
    });
    setCurrentStep(sectionIndex);
  };

  const handleGeneratePassword = () => {
    const newPassword = generatePassword();
    form.setValue("password", newPassword);
    form.setValue("confirmPassword", newPassword);
    
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

  // Filter wizard sections based on mode (hide user account section in edit mode)
  const availableSections = agent 
    ? wizardSections.filter(s => s.id !== "user") 
    : wizardSections;
  
  const currentSection = availableSections[currentStep];
  const isLastStep = currentStep === availableSections.length - 1;
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Function to render form sections based on current step
  const renderAgentSection = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <FormField
        control={form.control}
        name="firstName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>First Name *</FormLabel>
            <FormControl>
              <Input placeholder="Enter first name" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-firstName" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="lastName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Last Name *</FormLabel>
            <FormControl>
              <Input placeholder="Enter last name" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-lastName" />
            </FormControl>
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
              <Input type="email" placeholder="agent@example.com" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-email" />
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
                name={field.name} 
                value={field.value || ""} 
                onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))} 
                data-testid="input-phone" 
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="territory"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Territory</FormLabel>
            <FormControl>
              <Input placeholder="e.g., North Region" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-territory" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="commissionRate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Commission Rate (%)</FormLabel>
            <FormControl>
              <Input type="number" step="0.01" placeholder="5.00" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-commissionRate" />
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
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  const renderCompanySection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company Name *</FormLabel>
              <FormControl>
                <Input placeholder="Enter company name" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-companyName" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyBusinessType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-companyBusinessType">
                    <SelectValue placeholder="Select business type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="corporation">Corporation</SelectItem>
                  <SelectItem value="llc">LLC</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                  <SelectItem value="non_profit">Non-Profit</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="info@company.com" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-companyEmail" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company Phone</FormLabel>
              <FormControl>
                <Input 
                  placeholder="(555) 555-5555" 
                  name={field.name} 
                  value={field.value || ""} 
                  onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))} 
                  data-testid="input-companyPhone" 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyWebsite"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company Website</FormLabel>
              <FormControl>
                <Input placeholder="https://company.com" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-companyWebsite" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyTaxId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tax ID (EIN)</FormLabel>
              <FormControl>
                <Input 
                  placeholder="12-3456789" 
                  name={field.name} 
                  value={field.value || ""} 
                  onChange={(e) => field.onChange(formatEIN(e.target.value))} 
                  data-testid="input-companyTaxId" 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyIndustry"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Industry</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Technology, Finance" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-companyIndustry" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="companyDescription"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Company Description</FormLabel>
            <FormControl>
              <Textarea 
                placeholder="Brief description of the company..."
                className="resize-none"
                rows={3}
                name={field.name}
                value={field.value || ""}
                onChange={field.onChange}
                data-testid="input-companyDescription"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  const renderAddressSection = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="companyAddress.street1"
          render={({ field }) => (
            <FormItem className="relative">
              <FormLabel>Street Address</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    placeholder="Start typing an address..."
                    value={field.value || ""}
                    ref={addressInputRef}
                    data-testid="input-street1"
                    onChange={(e) => {
                      field.onChange(e);
                      handleAddressChange(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={addressFieldsLocked}
                    className={`pr-8 ${
                      addressValidationStatus === 'valid'
                        ? 'border-green-500 bg-green-50'
                        : addressValidationStatus === 'invalid'
                        ? 'border-red-500'
                        : ''
                    }`}
                  />
                  {isLoadingSuggestions && (
                    <Loader2 className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                  )}
                  {addressValidationStatus === 'valid' && (
                    <CheckCircle className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-green-500" />
                  )}
                  {addressValidationStatus === 'invalid' && (
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 bg-red-500 rounded-full" />
                  )}
                </div>
              </FormControl>
              
              {/* Address suggestions dropdown */}
              {showSuggestions && addressSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {addressSuggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.place_id}
                      className={`px-4 py-2 cursor-pointer hover:bg-gray-50 ${
                        index === selectedSuggestionIndex ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => validateAndSelectAddress(suggestion)}
                    >
                      <div className="flex items-center space-x-2">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <span className="text-sm">{suggestion.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {addressFieldsLocked && (
                <p className="text-xs text-gray-500 mt-1">
                  🔒 Address validated and locked. 
                  <button 
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                    }}
                    className="text-blue-600 hover:text-blue-800 underline ml-1"
                  >
                    Edit Address
                  </button>
                </p>
              )}
              
              {addressValidationStatus === 'invalid' && (
                <p className="text-xs text-red-600 mt-1">⚠ Please enter a valid address</p>
              )}
              
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyAddress.street2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Apt/Suite (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="Suite 100" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-street2" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyAddress.city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input 
                  placeholder="New York" 
                  name={field.name}
                  value={field.value || ""}
                  onChange={field.onChange}
                  data-testid="input-city"
                  disabled={addressFieldsLocked}
                  className={addressFieldsLocked ? 'bg-gray-50' : ''}
                />
              </FormControl>
              {addressFieldsLocked && (
                <p className="text-xs text-gray-500 mt-1">
                  🔒 Field locked after address selection. 
                  <button 
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                    }}
                    className="text-blue-600 hover:text-blue-800 underline ml-1"
                  >
                    Edit Address
                  </button>
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyAddress.state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input 
                  placeholder="NY" 
                  name={field.name}
                  value={field.value || ""}
                  onChange={field.onChange}
                  data-testid="input-state"
                  disabled={addressFieldsLocked}
                  className={addressFieldsLocked ? 'bg-gray-50' : ''}
                />
              </FormControl>
              {addressFieldsLocked && (
                <p className="text-xs text-gray-500 mt-1">
                  🔒 Field locked after address selection. 
                  <button 
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                    }}
                    className="text-blue-600 hover:text-blue-800 underline ml-1"
                  >
                    Edit Address
                  </button>
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyAddress.postalCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Postal Code</FormLabel>
              <FormControl>
                <Input 
                  placeholder="10001" 
                  name={field.name}
                  value={field.value || ""}
                  onChange={field.onChange}
                  data-testid="input-postalCode"
                  disabled={addressFieldsLocked}
                  className={addressFieldsLocked ? 'bg-gray-50' : ''}
                />
              </FormControl>
              {addressFieldsLocked && (
                <p className="text-xs text-gray-500 mt-1">
                  🔒 Field locked after address selection. 
                  <button 
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                    }}
                    className="text-blue-600 hover:text-blue-800 underline ml-1"
                  >
                    Edit Address
                  </button>
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="companyAddress.country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <FormControl>
                <Input placeholder="US" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-country" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );

  const renderUserAccountSection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username *</FormLabel>
              <FormControl>
                <Input placeholder="Enter username" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-username" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="communicationPreference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Communication Preferences *</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 mb-2">
                    Choose how to receive notifications:
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
                        data-testid="radio-communicationPreference-email"
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
                        data-testid="radio-communicationPreference-sms"
                      />
                      <span className="text-sm">📱 SMS text messages</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="communicationPreference"
                        value="both"
                        checked={field.value === "both"}
                        onChange={() => field.onChange("both")}
                        className="rounded"
                        data-testid="radio-communicationPreference-both"
                      />
                      <span className="text-sm">📧📱 Both Email and SMS</span>
                    </label>
                  </div>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <FormLabel>Password *</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGeneratePassword}
              className="h-7 text-xs"
              data-testid="button-generate-password-agent"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
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
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="password" placeholder="Confirm password" name={field.name} value={field.value || ""} onChange={field.onChange} data-testid="input-confirmPassword" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderCurrentSection = () => {
    switch (currentSection.id) {
      case "agent":
        return <div key="agent-section">{renderAgentSection()}</div>;
      case "company":
        return <div key="company-section">{renderCompanySection()}</div>;
      case "address":
        return <div key="address-section">{renderAddressSection()}</div>;
      case "user":
        return <div key="user-section">{renderUserAccountSection()}</div>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {agent ? "Edit Agent" : "Add New Agent"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Complete each section to create a new agent with company information
          </p>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 overflow-hidden">
              {/* Section Navigation */}
              <div className="lg:col-span-1">
                <div className="bg-gray-50 rounded-lg p-4 h-full">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Sections</h3>
                  <nav className="space-y-2">
                    {availableSections.map((section, index) => {
                      const IconComponent = section.icon;
                      const isActive = currentStep === index;
                      const isCompleted = visitedSections.has(index) && isSectionCompleted(index);
                      
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => navigateToSection(index)}
                          className={`w-full text-left p-3 rounded-lg transition-all ${
                            isActive
                              ? 'bg-blue-100 border-blue-200 text-blue-800'
                              : isCompleted
                              ? 'bg-green-50 border-green-200 text-green-800'
                              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                          } border`}
                          data-testid={`section-${section.id}`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                              isActive 
                                ? 'bg-blue-200' 
                                : isCompleted 
                                ? 'bg-green-200' 
                                : 'bg-gray-200'
                            }`}>
                              {isCompleted ? (
                                <CheckCircle className="w-4 h-4 text-green-700" />
                              ) : (
                                <IconComponent className={`w-4 h-4 ${
                                  isActive ? 'text-blue-700' : 'text-gray-600'
                                }`} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs">{section.name}</div>
                              <div className="text-xs opacity-70 truncate">{section.description}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </nav>
                </div>
              </div>

              {/* Form Content */}
              <div className="lg:col-span-3">
                <div className="bg-white rounded-lg border h-full flex flex-col">
                  {/* Section Header */}
                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-6 py-4 border-b border-blue-200">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                        {React.createElement(currentSection.icon, {
                          className: "w-5 h-5 text-blue-600"
                        })}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-blue-900">{currentSection.name}</h2>
                        <p className="text-blue-700 text-sm">{currentSection.description}</p>
                      </div>
                    </div>
                  </div>

                  {/* Form Fields */}
                  <div className="flex-1 p-6 overflow-y-auto">
                    {renderCurrentSection()}
                  </div>

                  {/* Navigation Buttons */}
                  <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
                    <div>
                      {currentStep > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handlePrevious}
                          className="flex items-center space-x-2"
                          data-testid="button-previous"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          <span>Previous</span>
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center space-x-4">
                      <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel">
                        Cancel
                      </Button>
                      {isLastStep ? (
                        <Button type="submit" disabled={isPending} data-testid="button-submit">
                          {isPending ? "Creating..." : agent ? "Update Agent" : "Create Agent"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={handleNext}
                          className="flex items-center space-x-2"
                          data-testid="button-next"
                        >
                          <span>Next</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}