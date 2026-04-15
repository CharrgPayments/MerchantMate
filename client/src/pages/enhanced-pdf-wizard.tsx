import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Building, FileText, CheckCircle, ArrowLeft, ArrowRight, Users, Upload, Signature, PenTool, Type, RotateCcw, Check, X, AlertTriangle, Monitor, ChevronDown, Lock } from 'lucide-react';
import { MCCSelect } from '@/components/ui/mcc-select';

interface FormField {
  id: number;
  fieldName: string;
  fieldType: string;
  fieldLabel: string;
  isRequired: boolean;
  options: string[] | null;
  defaultValue: string | null;
  validation: string | null;
  description: string | null;
  position: number;
  section: string | null;
  disclosureDefinitionId?: number | null;
  disclosureTitle?: string | null;
  requiresSignature?: boolean;
  requiresInitials?: boolean;
  maxSigners?: number | null;
  signerLabel?: string | null;
  ownerGroupConfig?: any | null;
  conditional?: {
    action: 'show' | 'hide';
    when: {
      field: string;
      operator: string;
      value: string;
    };
  } | null;
  displayOrientation?: 'horizontal' | 'vertical' | null;
}

function DisclosureFieldRenderer({ field, formData, onFieldChange }: { field: FormField; formData: Record<string, any>; onFieldChange: (name: string, value: any) => void }) {
  const { data: disclosureData, isLoading } = useQuery<any>({
    queryKey: [`/api/disclosures/${field.disclosureDefinitionId}`],
    queryFn: async () => {
      const res = await fetch(`/api/disclosures/${field.disclosureDefinitionId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch disclosure: ${res.status}`);
      return res.json();
    },
    enabled: !!field.disclosureDefinitionId,
    staleTime: 0,
    gcTime: 0,
  });

  const disclosure = disclosureData?.disclosure;
  const currentVersion = disclosure?.currentVersion || disclosure?.versions?.find((v: any) => v.isCurrentVersion) || disclosure?.versions?.[0];

  // Derive which interaction is required (version-level takes precedence over definition-level)
  const needsInitials = !!(currentVersion?.requiresInitials ?? disclosure?.requiresInitials ?? field.requiresInitials);
  const needsSignature = !!(currentVersion?.requiresSignature ?? disclosure?.requiresSignature ?? field.requiresSignature);
  const needsAction = needsInitials || needsSignature;

  // Scroll enforcement state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const checkScrolledToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Allow a 8px tolerance for sub-pixel rounding
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // Check on mount and whenever content loads (content might be short enough to not need scrolling)
  useEffect(() => {
    checkScrolledToBottom();
  }, [currentVersion, checkScrolledToBottom]);

  // Stored values
  const acknowledged = !!formData[field.fieldName];
  const initialsValue: string = formData[`${field.fieldName}_initials`] || '';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-800">{field.disclosureTitle || field.fieldLabel}</h3>
        {field.isRequired && <span className="text-red-500 text-sm">*</span>}
        {needsInitials && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Initials Required</span>
        )}
        {needsSignature && !needsInitials && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Signature Required</span>
        )}
      </div>

      {isLoading ? (
        <div className="border rounded-lg p-6 text-center text-gray-500 bg-gray-50">
          <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2" />
          Loading disclosure content...
        </div>
      ) : currentVersion ? (
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={checkScrolledToBottom}
            className="border rounded-lg p-4 max-h-72 overflow-y-auto bg-white text-sm leading-relaxed prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: currentVersion.content }}
          />
          {/* Scroll-to-bottom indicator — only shown when not yet at bottom and action required */}
          {needsAction && !hasScrolledToBottom && (
            <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-end pointer-events-none">
              <div className="w-full h-12 bg-gradient-to-t from-white to-transparent rounded-b-lg" />
              <div className="absolute bottom-2 flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-md pointer-events-none">
                <ChevronDown className="h-3.5 w-3.5 animate-bounce" />
                Scroll to the bottom to continue
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border rounded-lg p-4 bg-amber-50 text-amber-700 text-sm">
          Disclosure content not available. Definition ID: {field.disclosureDefinitionId}
        </div>
      )}

      {/* Acknowledgement controls — locked until scrolled to bottom */}
      {currentVersion && (
        <div className={`space-y-3 pt-1 transition-opacity duration-200 ${needsAction && !hasScrolledToBottom ? 'opacity-40 pointer-events-none select-none' : ''}`}>
          {needsAction && !hasScrolledToBottom && (
            <div className="flex items-center gap-2 text-xs text-gray-500 italic">
              <Lock className="h-3.5 w-3.5" />
              Please scroll through the entire disclosure above before continuing.
            </div>
          )}

          {needsInitials ? (
            // Initials input
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Enter your initials to acknowledge you have read this section:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={5}
                    placeholder="e.g. JD"
                    value={initialsValue}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
                      onFieldChange(`${field.fieldName}_initials`, val);
                      // Mark the base field as acknowledged when initials are provided
                      onFieldChange(field.fieldName, val ? 'initialed' : '');
                    }}
                    disabled={needsAction && !hasScrolledToBottom}
                    className="w-20 text-center text-lg font-bold border-2 border-gray-300 rounded-md px-2 py-1.5 uppercase tracking-widest focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
                    data-field-initials={field.fieldName}
                  />
                  {initialsValue && (
                    <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                      <Check className="h-4 w-4" />
                      Initialed
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Standard acknowledgment checkbox (for signature-only or no-action disclosures)
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id={field.fieldName}
                checked={acknowledged}
                onChange={(e) => onFieldChange(field.fieldName, e.target.checked ? 'acknowledged' : '')}
                disabled={needsAction && !hasScrolledToBottom}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
              />
              <label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700 cursor-pointer">
                I have read and acknowledge this disclosure
              </label>
              {acknowledged && (
                <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                  <Check className="h-4 w-4" />
                  Acknowledged
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PdfForm {
  id: number;
  name: string;
  description: string;
  fileName: string;
  fields: FormField[];
}

interface FormSection {
  name: string;
  description: string;
  fields: FormField[];
  icon: any;
}

export default function EnhancedPdfWizard() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formStarted, setFormStarted] = useState(false);
  const [fieldsInteracted, setFieldsInteracted] = useState(new Set<string>());
  const [addressOverrideActive, setAddressOverrideActive] = useState(false);
  const [visitedSections, setVisitedSections] = useState(new Set<number>());
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [addressFieldsLocked, setAddressFieldsLocked] = useState(false);
  const [addressValidationStatus, setAddressValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationModalMessage, setValidationModalMessage] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check for submitted signatures when form data changes
  useEffect(() => {
    // Add a small delay to ensure form data is fully loaded
    const timer = setTimeout(async () => {
      if (!formData.owners || !Array.isArray(formData.owners)) return;

      const updatedOwners = [...formData.owners];
      let hasUpdates = false;

      for (let i = 0; i < updatedOwners.length; i++) {
        const owner = updatedOwners[i];
        if (owner.signature || !owner.signatureToken) continue;

        try {
          const response = await fetch(`/api/signature/${owner.signatureToken}`);
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.signature) {
              updatedOwners[i] = {
                ...owner,
                signature: result.signature.signature,
                signatureType: result.signature.signatureType
              };
              hasUpdates = true;
            }
          }
        } catch (error) {
          // Signature fetch failed silently — user can retry
        }
      }

      if (hasUpdates) {
        setFormData(prev => ({
          ...prev,
          owners: updatedOwners
        }));
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [formData.owners]); // Trigger when owners array changes

  useEffect(() => {
    const addressKeys = ['address', 'city', 'state', 'zipCode'];
    addressKeys.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }, []);

  // Check for prospect validation token in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const prospectToken = urlParams.get('token');
  const isProspectMode = !!prospectToken;
  const previewTemplateId = urlParams.get('templateId');
  const isTemplatePreviewMode = !!previewTemplateId && urlParams.get('preview') === 'true';

  // Fetch prospect data if token is present
  const { data: prospectData } = useQuery({
    queryKey: ['/api/prospects/token', prospectToken],
    queryFn: async () => {
      if (!prospectToken) return null;
      const response = await fetch(`/api/prospects/token/${prospectToken}`);
      if (!response.ok) throw new Error('Invalid prospect token');
      return response.json();
    },
    enabled: !!prospectToken,
  });

  // Mutation to update prospect status to "in progress"
  const updateProspectStatusMutation = useMutation({
    mutationFn: async (prospectId: number) => {
      const response = await fetch(`/api/prospects/${prospectId}/start-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to update prospect status');
      }
      
      return response.json();
    },
  });

  // Auto-save mutation
  const autoSaveMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      const response = await fetch(`/api/pdf-forms/${id}/auto-save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ formData }),
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to auto-save form data');
      }
      
      return response.json();
    },
  });

  // Save form data mutation for prospects
  const saveFormDataMutation = useMutation({
    mutationFn: async ({ formData, currentStep }: { formData: Record<string, any>; currentStep: number }) => {
      if (!prospectData?.prospect?.id) {
        throw new Error('No prospect ID available');
      }
      
      const response = await fetch(`/api/prospects/${prospectData.prospect.id}/save-form-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ formData, currentStep }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save form data');
      }
      
      return response.json();
    },
  });

  // Submit application mutation
  const submitApplicationMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      if (!prospectData?.prospect?.id) {
        throw new Error('No prospect ID available');
      }
      
      const response = await fetch(`/api/prospects/${prospectData.prospect.id}/submit-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ formData }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle comprehensive validation errors
        if (errorData.validationErrors && Array.isArray(errorData.validationErrors)) {
          const validationErrors = ['Application incomplete. Please complete the following:'];
          
          // Add general validation errors
          validationErrors.push(...errorData.validationErrors.map((error: string) => `• ${error}`));
          
          // Add specific signature information if present
          if (errorData.missingSignatures && Array.isArray(errorData.missingSignatures)) {
            validationErrors.push('');
            validationErrors.push('Missing signatures from:');
            validationErrors.push(...errorData.missingSignatures.map((owner: any) => 
              `• ${owner.name} (${owner.percentage}% ownership) - ${owner.email}`
            ));
            validationErrors.push('');
            validationErrors.push('To complete signatures:');
            validationErrors.push('1. Use "Draw Signature" or "Type Signature" in Business Ownership section');
            validationErrors.push('2. Or send signature request emails to owners');
          }
          
          throw new Error(validationErrors.join('\n'));
        }
        
        throw new Error(errorData.message || 'Failed to submit application');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        // Application submitted successfully
        toast({
          title: "Application Submitted Successfully!",
          description: "Your merchant processing application has been submitted for review. You will receive an email confirmation shortly.",
        });
        
        // Redirect to application status page
        setLocation(`/application-status/${prospectToken}`);
      }
    },
    onError: (error: any) => {
      console.error('Application submission error:', error);
      
      // Handle multi-line error messages with proper formatting
      const errorMessage = error.message || "There was an error submitting your application. Please try again.";
      
      // Always show validation errors in enhanced modal dialog
      if (errorMessage.includes('Application incomplete') || errorMessage.includes('Missing signatures') || errorMessage.includes('required') || errorMessage.includes('Required signatures missing:')) {
        setValidationModalMessage(errorMessage);
        setValidationModalOpen(true);
      } else {
        // Standard toast for other errors
        toast({
          title: "Submission Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    }
  });

  const isFieldVisible = (field: FormField): boolean => {
    const allFields = sections.flatMap(s => s.fields);

    if (field.conditional) {
      const { action, when } = field.conditional;
      if (when?.field) {
        const sourceField = allFields.find(f =>
          f.fieldName === when.field || String(f.id) === when.field
        );
        if (sourceField) {
          const sourceValue = formData[sourceField.fieldName];
          const targetValue = when.value;

          let conditionMet = false;
          switch (when.operator) {
            case 'equals':
              conditionMet = String(sourceValue || '') === String(targetValue || '');
              break;
            case 'not_equals':
              conditionMet = String(sourceValue || '') !== String(targetValue || '');
              break;
            case 'contains':
              conditionMet = String(sourceValue || '').toLowerCase().includes(String(targetValue || '').toLowerCase());
              break;
            case 'is_checked':
              conditionMet = sourceValue === true || sourceValue === 'true' || sourceValue === 'yes' || sourceValue === 'Yes';
              break;
            case 'is_not_checked':
              conditionMet = !sourceValue || sourceValue === false || sourceValue === 'false' || sourceValue === 'no' || sourceValue === 'No';
              break;
            case 'is_not_empty':
              conditionMet = !!sourceValue && String(sourceValue).trim().length > 0;
              break;
            default:
              conditionMet = true;
          }

          const visible = action === 'show' ? conditionMet : !conditionMet;
          if (!visible) return false;
        }
      }
    }

    for (const otherField of allFields) {
      if (!otherField.options || !Array.isArray(otherField.options)) continue;
      const currentValue = formData[otherField.fieldName];
      for (const opt of otherField.options) {
        if (typeof opt !== 'object' || !opt.conditional) continue;
        const optCond = opt.conditional;
        if (optCond.targetField !== field.fieldName && optCond.targetField !== String(field.id)) continue;

        const optValue = opt.value || opt.label;
        const isSelected = Array.isArray(currentValue)
          ? currentValue.includes(optValue)
          : String(currentValue || '') === String(optValue);

        if (optCond.action === 'show') {
          if (!isSelected) return false;
        } else if (optCond.action === 'hide') {
          if (isSelected) return false;
        }
      }
    }

    return true;
  };

  const scrollToFirstError = () => {
    requestAnimationFrame(() => {
      const firstErrorEl = document.querySelector('[data-field-error="true"]');
      if (firstErrorEl) {
        firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  const getVisibleFieldCount = (sectionIndex: number): number => {
    const section = sections[sectionIndex];
    if (!section) return 0;
    return section.fields.filter(f => isFieldVisible(f)).length;
  };

  const handleNext = () => {
    setVisitedSections(prev => {
      const newVisited = new Set([...prev]);
      newVisited.add(currentStep);
      return newVisited;
    });

    if (!validateCurrentSection()) {
      scrollToFirstError();
      toast({
        title: "Required Fields Missing",
        description: "Please fill in the highlighted fields before proceeding.",
        variant: "destructive",
      });
      return;
    }

    const nextStep = Math.min(sections.length - 1, currentStep + 1);

    setVisitedSections(prev => {
      const newVisited = new Set([...prev]);
      newVisited.add(nextStep);
      return newVisited;
    });

    if (isProspectMode && prospectData?.prospect?.id) {
      saveFormDataMutation.mutate({
        formData: formData,
        currentStep: nextStep
      });
    }

    setCurrentStep(nextStep);
  };

  const handlePrevious = () => {
    const prevStep = Math.max(0, currentStep - 1);

    setVisitedSections(prev => {
      const newVisited = new Set([...prev]);
      newVisited.add(currentStep);
      return newVisited;
    });

    if (isProspectMode && prospectData?.prospect?.id) {
      saveFormDataMutation.mutate({
        formData: formData,
        currentStep: prevStep
      });
    }

    setCurrentStep(prevStep);
  };

  // Check if a section has validation issues
  const getSectionValidationStatus = (sectionIndex: number) => {
    const section = sections[sectionIndex];
    let hasErrors = false;

    for (const field of section.fields) {
      if (!isFieldVisible(field)) continue;
      const error = validateField(field, formData[field.fieldName]);
      if (error) {
        hasErrors = true;
        break;
      }
    }

    // Special ownership validation for Business Ownership section
    if (section.name === 'Business Ownership') { // Business Ownership section
      const owners = formData.owners || [];
      const totalPercentage = owners.reduce((sum: number, owner: any) => sum + (parseFloat(owner.percentage) || 0), 0);
      
      // Check if ownership totals 100%
      if (Math.abs(totalPercentage - 100) > 0.01) {
        hasErrors = true;
      }

      // Check for missing signatures for owners with 25%+ ownership
      const missingSignatures = owners.filter((owner: any) => {
        const percentage = parseFloat(owner.percentage) || 0;
        return percentage >= 25 && !owner.signature;
      });

      if (missingSignatures.length > 0) {
        hasErrors = true;
      }
    }

    // Special equipment validation for Equipment Selection section
    if (section.name === 'Equipment Selection') {
      const selectedEquipment = formData.selectedEquipment || [];
      const campaignEquipment = prospectData?.campaignEquipment || [];
      
      // Check if equipment selection is required but not selected
      if (campaignEquipment.length > 0 && selectedEquipment.length === 0) {
        hasErrors = true;
      }
    }

    return hasErrors;
  };

  // Fetch PDF form with fields (disable for prospect mode or template preview mode)
  const { data: pdfForm, isLoading, error } = useQuery<PdfForm>({
    queryKey: ['/api/pdf-forms', id, 'with-fields'],
    queryFn: async () => {
      const response = await fetch(`/api/pdf-forms/${id}/with-fields`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch form');
      }
      return response.json();
    },
    enabled: !!id && !isProspectMode && !isTemplatePreviewMode
  });

  // Fetch acquirer application template as a form (for template preview mode)
  const { data: templateAsForm, isLoading: isTemplateLoading, error: templateError } = useQuery<PdfForm>({
    queryKey: ['/api/acquirer-application-templates', previewTemplateId, 'as-form'],
    queryFn: async () => {
      const response = await fetch(`/api/acquirer-application-templates/${previewTemplateId}/as-form`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch template form');
      }
      return response.json();
    },
    enabled: isTemplatePreviewMode,
    staleTime: 0,
    gcTime: 0
  });

  const activeForm = isTemplatePreviewMode ? templateAsForm : pdfForm;
  const activeIsLoading = isTemplatePreviewMode ? isTemplateLoading : isLoading;
  const activeError = isTemplatePreviewMode ? templateError : error;

  // Load owners with signatures from database
  const loadOwnersWithSignatures = async (prospectId: number) => {
    try {
      const response = await fetch(`/api/prospects/${prospectId}/owners-with-signatures`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.owners.length > 0) {
          
          // Merge signature data with existing owners instead of replacing the entire array
          setFormData(prev => {
            const existingOwners = prev.owners || [];
            const signatureOwners = result.owners;
            
            // Create a map of signatures by email for easy lookup
            const signatureMap = new Map();
            signatureOwners.forEach(sigOwner => {
              signatureMap.set(sigOwner.email, sigOwner);
            });
            
            // Update existing owners with signature data if available
            const updatedOwners = existingOwners.map(owner => {
              const signatureData = signatureMap.get(owner.email);
              if (signatureData) {
                return {
                  ...owner,
                  signature: signatureData.signature,
                  signatureType: signatureData.signatureType,
                  signatureToken: signatureData.signatureToken,
                  submittedAt: signatureData.submittedAt,
                  emailSent: signatureData.emailSent,
                  emailSentAt: signatureData.emailSentAt
                };
              }
              return owner;
            });
            
            return {
              ...prev,
              owners: updatedOwners
            };
          });
        } else {
        }
      } else {
        console.error("Failed to fetch owners:", response.status);
      }
    } catch (error) {
      console.error("Error loading owners with signatures:", error);
    }
  };

  // Load owners with signatures when prospect data is available
  useEffect(() => {
    if (prospectData?.prospect?.id && isProspectMode) {
      loadOwnersWithSignatures(prospectData.prospect.id);
    }
  }, [prospectData, isProspectMode]);

  // Auto-select equipment if only one option available
  useEffect(() => {
    if (prospectData?.campaignEquipment && prospectData.campaignEquipment.length === 1) {
      const singleEquipment = prospectData.campaignEquipment[0];
      if (!formData.selectedEquipment || formData.selectedEquipment.length === 0) {
        handleFieldChange('selectedEquipment', [singleEquipment.id]);
      }
    }
  }, [prospectData, formData.selectedEquipment]);

  // Initialize form data with agent and prospect information for prospects
  useEffect(() => {
    if (isProspectMode && prospectData?.prospect && prospectData?.agent && !initialDataLoaded) {
      const newData = {
        assignedAgent: `${prospectData.agent.firstName} ${prospectData.agent.lastName} (${prospectData.agent.email})`,
        companyEmail: prospectData.prospect.email
      };
      setFormData(newData);
      setInitialDataLoaded(true);
      
      // Load existing form data if available
      if (prospectData.prospect.formData) {
        try {
          const existingData = JSON.parse(prospectData.prospect.formData);
          // Prevent address override by setting addressOverrideActive
          if (existingData.address && existingData.city && existingData.state && existingData.zipCode) {
            setAddressOverrideActive(true);
            setAddressFieldsLocked(true);
            setAddressValidationStatus('valid');
          }
          
          setFormData(prev => ({ ...prev, ...existingData }));
          
          // Mark sections as visited based on existing form data
          const newVisited = new Set<number>();
          
          // Check Section 0 (Merchant Information) - if we have company info
          if (existingData.companyName || existingData.address || existingData.city) {
            newVisited.add(0);
          }
          
          // Check Section 1 (Business Type) - if we have business type info
          if (existingData.businessType || existingData.federalTaxId || existingData.yearsInBusiness) {
            newVisited.add(1);
          }
          
          // Check Section 2 (Business Ownership) - if we have owners
          if (existingData.owners && existingData.owners.length > 0) {
            newVisited.add(2);
          }
          
          // Check Section 3 (Products/Services) - if we have business description
          if (existingData.businessDescription || existingData.productsServices) {
            newVisited.add(3);
          }
          
          // Check Section 4 (Transaction Info) - if we have volume info
          if (existingData.monthlyVolume || existingData.averageTicket) {
            newVisited.add(4);
          }
          
          setVisitedSections(newVisited);
        } catch (error) {
          console.error('Error parsing existing form data:', error);
        }
      }

      // Determine the appropriate starting step based on form completion
      const savedStep = prospectData.prospect.currentStep;
      let startingStep = savedStep !== null && savedStep !== undefined ? savedStep : 0;
      
      // Check if we should advance to the next incomplete section
      if (prospectData.prospect.formData) {
        try {
          const existingData = JSON.parse(prospectData.prospect.formData);
          
          // Check if Merchant Information section is complete
          const merchantInfoComplete = existingData.companyName && 
                                     existingData.companyEmail && 
                                     existingData.companyPhone && 
                                     existingData.address && 
                                     existingData.city && 
                                     existingData.state && 
                                     existingData.zipCode;
          
          // Check if Business Type section is complete
          const businessTypeComplete = existingData.federalTaxId && 
                                     existingData.businessType && 
                                     existingData.stateFiled && 
                                     existingData.businessStartDate;
          
          // Auto-advance to next incomplete section
          if (merchantInfoComplete && !businessTypeComplete && startingStep === 0) {
            startingStep = 1; // Business Type & Tax Information
          } else if (merchantInfoComplete && businessTypeComplete && startingStep <= 1) {
            startingStep = 2; // Business Ownership
          }
          
        } catch (error) {
          console.error('Error determining starting step:', error);
        }
      }

      setCurrentStep(startingStep);
    }
  }, [prospectData, isProspectMode, initialDataLoaded]);

  // Create hardcoded form sections for prospect mode
  const createProspectFormSections = (): FormSection[] => {
    const baseSections = [
      {
        name: 'Campaign Details',
        description: 'Campaign information and overview',
        icon: FileText,
        fields: [
          { id: 0, fieldName: 'campaignInfo', fieldType: 'campaign', fieldLabel: 'Campaign Information', isRequired: false, options: null, defaultValue: null, validation: null, position: 0, section: 'Campaign Details' },
        ]
      },
    ];

    // Add equipment section if campaign has equipment
    const campaignEquipment = prospectData?.campaignEquipment || [];
    if (campaignEquipment.length > 0) {
      baseSections.push({
        name: 'Equipment Selection',
        description: 'Choose your preferred payment processing equipment',
        icon: Monitor,
        fields: [
          { id: 0.5, fieldName: 'selectedEquipment', fieldType: 'equipment', fieldLabel: 'Select Equipment', isRequired: true, options: null, defaultValue: null, validation: null, position: 0.5, section: 'Equipment Selection' },
        ]
      });
    }

    baseSections.push(
      {
        name: 'Merchant Information',
        description: 'Basic business details, contact information, and location data',
        icon: Building,
        fields: [
          { id: 1, fieldName: 'assignedAgent', fieldType: 'readonly', fieldLabel: 'Assigned Agent', isRequired: false, options: null, defaultValue: null, validation: null, position: 1, section: 'Merchant Information' },
          { id: 2, fieldName: 'companyName', fieldType: 'text', fieldLabel: 'Company Name', isRequired: true, options: null, defaultValue: null, validation: null, position: 2, section: 'Merchant Information' },
          { id: 3, fieldName: 'companyEmail', fieldType: 'email', fieldLabel: 'Company Email', isRequired: true, options: null, defaultValue: null, validation: null, position: 3, section: 'Merchant Information' },
          { id: 4, fieldName: 'companyPhone', fieldType: 'phone', fieldLabel: 'Company Phone', isRequired: true, options: null, defaultValue: null, validation: null, position: 4, section: 'Merchant Information' },
          { id: 5, fieldName: 'address', fieldType: 'text', fieldLabel: 'Business Address', isRequired: true, options: null, defaultValue: null, validation: null, position: 5, section: 'Merchant Information' },
          { id: 6, fieldName: 'addressLine2', fieldType: 'text', fieldLabel: 'Address Line 2', isRequired: false, options: null, defaultValue: null, validation: null, position: 6, section: 'Merchant Information' },
          { id: 7, fieldName: 'city', fieldType: 'text', fieldLabel: 'City', isRequired: true, options: null, defaultValue: null, validation: null, position: 7, section: 'Merchant Information' },
          { id: 8, fieldName: 'state', fieldType: 'select', fieldLabel: 'State', isRequired: true, options: [
            'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 
            'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 
            'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 
            'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 
            'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 
            'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 
            'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
          ], defaultValue: null, validation: null, position: 8, section: 'Merchant Information' },
          { id: 9, fieldName: 'zipCode', fieldType: 'text', fieldLabel: 'ZIP Code', isRequired: true, options: null, defaultValue: null, validation: null, position: 9, section: 'Merchant Information' },
        ]
      },
      {
        name: 'Business Type & Tax Information',
        description: 'Business structure, tax identification, and regulatory compliance',
        icon: FileText,
        fields: [
          { id: 9, fieldName: 'federalTaxId', fieldType: 'text', fieldLabel: 'Federal Tax ID (EIN)', isRequired: true, options: null, defaultValue: null, validation: null, position: 9, section: 'Business Type & Tax Information' },
          { id: 10, fieldName: 'businessType', fieldType: 'select', fieldLabel: 'Business Type', isRequired: true, options: ['Corporation', 'LLC', 'Partnership', 'Sole Proprietorship'], defaultValue: null, validation: null, position: 10, section: 'Business Type & Tax Information' },
          { id: 11, fieldName: 'stateFiled', fieldType: 'select', fieldLabel: 'State Filed', isRequired: true, options: [
            'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 
            'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 
            'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 
            'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 
            'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 
            'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 
            'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
          ], defaultValue: null, validation: null, position: 11, section: 'Business Type & Tax Information' },
          { id: 12, fieldName: 'businessStartDate', fieldType: 'date', fieldLabel: 'Business Start Date', isRequired: true, options: null, defaultValue: null, validation: null, position: 12, section: 'Business Type & Tax Information' },
          { id: 13, fieldName: 'yearsInBusiness', fieldType: 'readonly', fieldLabel: 'Years in Business', isRequired: false, options: null, defaultValue: null, validation: null, position: 13, section: 'Business Type & Tax Information' },
        ]
      },
      {
        name: 'Business Ownership',
        description: 'Ownership structure and signature requirements for owners with 25% or more ownership',
        icon: Users,
        fields: [
          { id: 15, fieldName: 'owners', fieldType: 'ownership', fieldLabel: 'Business Owners', isRequired: true, options: null, defaultValue: null, validation: null, position: 15, section: 'Business Ownership' },
        ]
      },
      {
        name: 'Products, Services & Processing',
        description: 'Business operations, products sold, and payment processing preferences',
        icon: CheckCircle,
        fields: [
          { id: 16, fieldName: 'businessDescription', fieldType: 'textarea', fieldLabel: 'Business Description', isRequired: true, options: null, defaultValue: null, validation: null, position: 16, section: 'Products, Services & Processing' },
          { id: 17, fieldName: 'productsServices', fieldType: 'textarea', fieldLabel: 'Products/Services Sold', isRequired: true, options: null, defaultValue: null, validation: null, position: 17, section: 'Products, Services & Processing' },
          { id: 18, fieldName: 'processingMethod', fieldType: 'select', fieldLabel: 'Primary Processing Method', isRequired: true, options: ['In-Person (Card Present)', 'Online (Card Not Present)', 'Both'], defaultValue: null, validation: null, position: 18, section: 'Products, Services & Processing' },
        ]
      },
      {
        name: 'Transaction Information',
        description: 'Financial data, volume estimates, and transaction processing details',
        icon: ArrowRight,
        fields: [
          { id: 19, fieldName: 'monthlyVolume', fieldType: 'number', fieldLabel: 'Expected Monthly Processing Volume ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 19, section: 'Transaction Information' },
          { id: 20, fieldName: 'averageTicket', fieldType: 'number', fieldLabel: 'Average Transaction Amount ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 20, section: 'Transaction Information' },
          { id: 21, fieldName: 'highestTicket', fieldType: 'number', fieldLabel: 'Highest Single Transaction ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 21, section: 'Transaction Information' },
        ]
      }
    );

    return baseSections;
  };

  // Create enhanced sections with descriptions and icons
  let sections: FormSection[] = [];
  
  if (isProspectMode) {
    sections = createProspectFormSections();
  } else if (isTemplatePreviewMode && activeForm?.fields) {
    // Group fields by section name for template preview
    const sectionMap = new Map<string, FormField[]>();
    activeForm.fields.sort((a, b) => a.position - b.position).forEach(field => {
      const sectionName = field.section || 'General';
      if (!sectionMap.has(sectionName)) sectionMap.set(sectionName, []);
      sectionMap.get(sectionName)!.push(field);
    });
    sections = Array.from(sectionMap.entries()).map(([name, fields]) => ({
      name,
      description: '',
      icon: FileText,
      fields
    }));
  } else if (activeForm?.fields) {
    sections = [
      {
        name: 'Form Fields',
        description: 'Complete all required fields',
        icon: FileText,
        fields: activeForm.fields.sort((a, b) => a.position - b.position)
      }
    ];
  }

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

  // Select address suggestion and validate
  const selectAddressSuggestion = async (suggestion: any) => {
    const mainText = suggestion.structured_formatting?.main_text || suggestion.description.split(',')[0];
    
    // Hide suggestions immediately
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    
    // Set addressOverrideActive to prevent browser cache interference
    setAddressOverrideActive(true);
    
    // Validate the address with Google Maps API for complete information
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

          // Create final validated address data - this OVERWRITES any previous data
          const overwrittenFormData = {
            ...formData,  // Keep all existing form data
            address: result.streetAddress || mainText,  // OVERWRITE address
            city: result.city || '',                    // OVERWRITE city
            state: result.state || '',                  // OVERWRITE state
            zipCode: result.zipCode || ''               // OVERWRITE zipCode
          };
          
          // IMMEDIATELY update form data with the new address - this overwrites any previous data
          setFormData(overwrittenFormData);
          
          // Clear browser cache and storage that might interfere
          const addressKeys = ['address', 'city', 'state', 'zipCode'];
          addressKeys.forEach(key => {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
          });
          
          // IMMEDIATELY save to database to ensure persistence and overwrite previous data
          if (isProspectMode && prospectData?.prospect) {
            try {
              const saveResponse = await fetch(`/api/prospects/${prospectData.prospect.id}/save-form-data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                  formData: overwrittenFormData, 
                  currentStep: currentStep,
                  overwriteAddress: true  // Flag to indicate this is an address overwrite
                }),
              });
              
              if (!saveResponse.ok) {
                console.error('Address save failed:', saveResponse.status);
              }
            } catch (saveError) {
              console.error('Database save error:', saveError);
            }
          }
          
          // Lock the address fields after successful autocomplete selection
          setAddressFieldsLocked(true);
          
          // Force update DOM input fields to override any browser persistence - MULTIPLE attempts
          const forceUpdateFields = () => {
            const addressField = document.querySelector('input[id*="address"]:not([id*="addressLine2"])') as HTMLInputElement;
            const cityField = document.querySelector('input[id*="city"]') as HTMLInputElement;
            const stateField = document.querySelector('select[id*="state"], input[id*="state"]') as HTMLInputElement;
            const zipField = document.querySelector('input[id*="zip"]') as HTMLInputElement;
            
            if (addressField && result.streetAddress) {
              addressField.value = result.streetAddress;
              addressField.dispatchEvent(new Event('input', { bubbles: true }));
              addressField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (cityField && result.city) {
              cityField.value = result.city;
              cityField.dispatchEvent(new Event('input', { bubbles: true }));
              cityField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (stateField && result.state) {
              stateField.value = result.state;
              stateField.dispatchEvent(new Event('change', { bubbles: true }));
              stateField.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (zipField && result.zipCode) {
              zipField.value = result.zipCode;
              zipField.dispatchEvent(new Event('input', { bubbles: true }));
              zipField.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          
          // Execute force update multiple times to ensure it sticks
          setTimeout(forceUpdateFields, 100);
          setTimeout(forceUpdateFields, 300);
          setTimeout(forceUpdateFields, 500);
          setTimeout(forceUpdateFields, 1000);
          
          // Auto-focus to address line 2 field after successful selection
          setTimeout(() => {
            const addressLine2Field = document.querySelector('input[id*="addressLine2"]') as HTMLInputElement;
            if (addressLine2Field) {
              addressLine2Field.focus();
            }
          }, 600);
          
        } else {
          setAddressValidationStatus('invalid');
        }
      } else {
        console.error('Address validation API error:', response.status);
        setAddressValidationStatus('invalid');
      }
    } catch (error) {
      console.error('Address validation network error:', error);
      setAddressValidationStatus('invalid');
    }
  };

  // Handle field changes with auto-save and address override protection
  const handleFieldChange = (fieldName: string, value: any) => {
    // Prevent address field changes if addressOverrideActive and fields are locked
    if (addressOverrideActive && addressFieldsLocked && 
        (fieldName === 'city' || fieldName === 'state' || fieldName === 'zipCode')) {
      return;
    }
    
    const newFormData = { ...formData, [fieldName]: value };
    
    // Calculate years in business when business start date is entered
    if (fieldName === 'businessStartDate' && value) {
      const startDate = new Date(value);
      const currentDate = new Date();
      const yearsDiff = currentDate.getFullYear() - startDate.getFullYear();
      const monthsDiff = currentDate.getMonth() - startDate.getMonth();
      
      // Calculate more precise years (including partial years)
      let yearsInBusiness = yearsDiff;
      if (monthsDiff < 0 || (monthsDiff === 0 && currentDate.getDate() < startDate.getDate())) {
        yearsInBusiness--;
      }
      
      // Ensure minimum of 0 years
      yearsInBusiness = Math.max(0, yearsInBusiness);
      
      // Update both the start date and calculated years
      newFormData.yearsInBusiness = yearsInBusiness.toString();
    }
    
    setFormData(newFormData);

    // Validate the field and update errors
    const currentField = sections[currentStep]?.fields.find(f => f.fieldName === fieldName);
    if (currentField) {
      const error = validateField(currentField, value);
      setValidationErrors(prev => ({
        ...prev,
        [fieldName]: error
      }));
    }
    
    // Track field interaction for prospect status update
    handleFieldInteraction(fieldName, value);
    
    // Trigger address autocomplete for address field - allow even when locked to enable new selections
    if (fieldName === 'address') {
      // If user starts typing in a locked address field, unlock it for new selection
      if (addressFieldsLocked && value !== formData.address) {
        // User typing new address - unlock fields for new selection
        setAddressFieldsLocked(false);
        setAddressOverrideActive(false);
        setAddressValidationStatus('idle');
      }
      
      setAddressValidationStatus('idle');
      // Clear city, state, zip when manually typing new address (if not locked or being unlocked)
      if (value && value.length >= 4) {
        fetchAddressSuggestions(value);
      } else {
        setShowSuggestions(false);
        setAddressSuggestions([]);
        setSelectedSuggestionIndex(-1);
        // Only clear address-related fields when completely empty (not just short)
        if (value.length === 0 && !addressFieldsLocked) {
          // Address field completely cleared - clear dependent fields
          const clearedFormData = { ...newFormData };
          clearedFormData.city = '';
          clearedFormData.state = '';
          clearedFormData.zipCode = '';
          setFormData(clearedFormData);
        }
      }
    }
    
    // Auto-save after 2 seconds of no changes (only for authenticated users, not prospects)
    if (!isProspectMode) {
      setTimeout(() => {
        autoSaveMutation.mutate(newFormData);
      }, 2000);
    }
  };

  // Handle field interaction tracking
  const handleFieldInteraction = (fieldName: string, value: any) => {
    if (!fieldsInteracted.has(fieldName) && value) {
      setFieldsInteracted(prev => new Set([...prev, fieldName]));
      setFormStarted(true);
      
      // For prospect mode, update status to "in progress" on first interaction
      if (isProspectMode && prospectData?.prospect && !formStarted) {
        updateProspectStatusMutation.mutate(prospectData.prospect.id);
      }
    }
  };

  // Phone number formatting function
  const formatPhoneNumber = (value: string): string => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return value;
  };

  // EIN formatting function
  const formatEIN = (value: string): string => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 9) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2)}`;
    }
    return value;
  };

  // Handle phone number formatting on blur
  const handlePhoneBlur = (fieldName: string, value: string) => {
    if (fieldName === 'companyPhone') {
      const formatted = formatPhoneNumber(value);
      if (formatted !== value) {
        const newFormData = { ...formData, [fieldName]: formatted };
        setFormData(newFormData);
      }
    }
  };

  // Handle EIN formatting on blur
  const handleEINBlur = (fieldName: string, value: string) => {
    if (fieldName === 'federalTaxId' || fieldName === 'taxId') {
      const formatted = formatEIN(value);
      if (formatted !== value) {
        const newFormData = { ...formData, [fieldName]: formatted };
        setFormData(newFormData);
      }
    }
  };

  // Handle money field formatting on blur
  const handleMoneyBlur = (fieldName: string, value: string) => {
    const moneyFields = ['monthlyVolume', 'averageTicket', 'highestTicket', 'avgMonthlyVolume', 'avgTicketAmount', 'highestTicketAmount'];
    
    if (moneyFields.includes(fieldName) && value) {
      const cleanValue = value.replace(/[^0-9.]/g, '');
      const numericValue = parseFloat(cleanValue);
      
      if (!isNaN(numericValue) && numericValue >= 0) {
        const formatted = numericValue.toFixed(2);
        if (formatted !== value) {
          const newFormData = { ...formData, [fieldName]: formatted };
          setFormData(newFormData);
        }
      }
    }
  };

  // Digital Signature Component
  const DigitalSignaturePad = ({ ownerIndex, owner, onSignatureChange }: {
    ownerIndex: number;
    owner: any;
    onSignatureChange: (index: number, signature: string | null, type: string | null) => void;
  }) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = React.useState(false);
    const [signatureMode, setSignatureMode] = React.useState<'draw' | 'type'>('draw');
    const [typedSignature, setTypedSignature] = React.useState('');
    const [showSignaturePad, setShowSignaturePad] = React.useState(false);

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
      setIsDrawing(true);
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const stopDrawing = () => {
      setIsDrawing(false);
    };

    const clearSignature = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setTypedSignature('');
      onSignatureChange(ownerIndex, null, null);
    };

    const saveSignature = () => {
      let signatureData: string | null = null;
      let signatureType: string | null = null;

      if (signatureMode === 'draw') {
        const canvas = canvasRef.current;
        if (canvas) {
          signatureData = canvas.toDataURL();
          signatureType = 'canvas';
        }
      } else {
        signatureData = typedSignature;
        signatureType = 'typed';
      }

      onSignatureChange(ownerIndex, signatureData, signatureType);
      setShowSignaturePad(false);
    };

    const generateTypedSignature = () => {
      if (!typedSignature.trim()) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Set signature font style
      ctx.font = '32px "Brush Script MT", cursive';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Draw the typed signature
      ctx.fillText(typedSignature, canvas.width / 2, canvas.height / 2);
    };

    React.useEffect(() => {
      if (signatureMode === 'type' && typedSignature) {
        generateTypedSignature();
      }
    }, [typedSignature, signatureMode]);

    return (
      <div className="space-y-4">
        {!showSignaturePad && !owner.signature && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowSignaturePad(true)}
            className="w-full"
          >
            <Signature className="w-4 h-4 mr-2" />
            Add Digital Signature
          </Button>
        )}

        {!showSignaturePad && owner.signature && (
          <div className="border border-green-200 bg-green-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Check className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium text-green-800">
                  Signature Added ({owner.signatureType === 'canvas' ? 'Drawn' : 'Typed'})
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowSignaturePad(true)}
              >
                Edit
              </Button>
            </div>
            {owner.signatureType === 'canvas' && (
              <img 
                src={owner.signature} 
                alt="Signature" 
                className="mt-2 border rounded max-h-20"
              />
            )}
            {owner.signatureType === 'typed' && (
              <div className="mt-2 text-2xl font-signature text-center py-2 border rounded bg-white">
                {owner.signature}
              </div>
            )}
          </div>
        )}

        {showSignaturePad && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-medium">Digital Signature</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowSignaturePad(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex space-x-2 mb-4">
              <Button
                type="button"
                variant={signatureMode === 'draw' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSignatureMode('draw')}
              >
                <PenTool className="w-4 h-4 mr-2" />
                Draw
              </Button>
              <Button
                type="button"
                variant={signatureMode === 'type' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSignatureMode('type')}
              >
                <Type className="w-4 h-4 mr-2" />
                Type
              </Button>
            </div>

            {signatureMode === 'draw' && (
              <div className="space-y-3">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={150}
                  className="border border-gray-300 rounded bg-white cursor-crosshair w-full"
                  style={{ maxWidth: '100%', height: '150px' }}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                />
                <p className="text-sm text-gray-600">
                  Draw your signature in the box above using your mouse or touch screen.
                </p>
              </div>
            )}

            {signatureMode === 'type' && (
              <div className="space-y-3">
                <Input
                  placeholder="Type your full name"
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value)}
                  className="text-center"
                />
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={150}
                  className="border border-gray-300 rounded bg-white w-full"
                  style={{ maxWidth: '100%', height: '150px' }}
                />
                <p className="text-sm text-gray-600">
                  Type your name above to preview your signature style.
                </p>
              </div>
            )}

            <div className="flex space-x-2 mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={clearSignature}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                type="button"
                onClick={saveSignature}
                disabled={
                  signatureMode === 'draw' ? false : !typedSignature.trim()
                }
              >
                <Check className="w-4 h-4 mr-2" />
                Save Signature
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Validate field value
  const validateField = (field: FormField, value: any): string | null => {
    // Handle ownership validation separately
    if (field.fieldType === 'ownership') {
      const owners = value || [];
      if (field.isRequired && owners.length === 0) {
        return 'At least one owner is required';
      }

      for (let i = 0; i < owners.length; i++) {
        const owner = owners[i];
        const percentage = parseFloat(owner.percentage);

        if (!owner.name || owner.name.trim() === '') {
          return `Owner ${i + 1}: Name is required`;
        }

        if (!owner.email || owner.email.trim() === '') {
          return `Owner ${i + 1}: Email is required`;
        }

        if (!owner.percentage || isNaN(percentage)) {
          return `Owner ${i + 1}: Ownership percentage is required`;
        }

        if (percentage < 0 || percentage > 100) {
          return `Owner ${i + 1}: Ownership percentage must be between 0 and 100`;
        }

        // Validate email format
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(owner.email)) {
          return `Owner ${i + 1}: Please enter a valid email address`;
        }

        // Check signature requirement for owners with >=25%
        if (percentage >= 25 && !owner.signature) {
          return `Owner ${i + 1}: Signature required for ownership ≥ 25%`;
        }
      }

      // Validate total percentage equals 100%
      const total = owners.reduce((sum: number, owner: any) => {
        return sum + (parseFloat(owner.percentage) || 0);
      }, 0);

      if (Math.abs(total - 100) > 0.01) {
        return `Total ownership must equal 100% (currently ${total.toFixed(2)}%)`;
      }

      return null;
    }

    if (field.isRequired && (!value || value.toString().trim() === '')) {
      return `${field.fieldLabel} is required`;
    }

    if (value && field.validation) {
      const patterns = {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        phone: /^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/,
        zip: /^\d{5}(-\d{4})?$/,
        ein: /^\d{2}-\d{7}$/,
        ssn: /^\d{3}-\d{2}-\d{4}$/
      };

      if (field.validation.includes('email') && !patterns.email.test(value)) {
        return 'Please enter a valid email address';
      }
      if (field.validation.includes('phone') && !patterns.phone.test(value)) {
        return 'Please enter a valid phone number';
      }
      if (field.validation.includes('zip') && !patterns.zip.test(value)) {
        return 'Please enter a valid ZIP code';
      }
      if (field.validation.includes('ein') && !patterns.ein.test(value)) {
        return 'Please enter a valid EIN (XX-XXXXXXX)';
      }
      
      // Additional EIN validation for federal tax ID fields
      if ((field.fieldName === 'federalTaxId' || field.fieldName === 'taxId') && value) {
        const cleanedEIN = value.replace(/\D/g, '');
        if (cleanedEIN.length !== 9) {
          return 'EIN must be exactly 9 digits';
        }
        if (!/^\d{2}-\d{7}$/.test(value) && cleanedEIN.length === 9) {
          // Allow unformatted 9 digits, will be formatted on blur
          return null; // Valid, will be auto-formatted
        }
      }
      if (field.validation.includes('ssn') && !patterns.ssn.test(value)) {
        return 'Please enter a valid SSN (XXX-XX-XXXX)';
      }
    }

    return null;
  };

  // Validate all fields in the current section and surface errors
  const validateCurrentSection = (): boolean => {
    if (!sections[currentStep]) return true;

    let isValid = true;
    const errors: Record<string, string> = {};

    sections[currentStep].fields.forEach(field => {
      if (!isFieldVisible(field)) return;
      const value = formData[field.fieldName];
      const error = validateField(field, value);
      if (error) {
        errors[field.fieldName] = error;
        isValid = false;
      }
    });

    setValidationErrors(errors);
    return isValid;
  };

  // For prospect mode, show loading if prospect data isn't loaded yet
  if (isProspectMode && !prospectData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading application...</p>
        </div>
      </div>
    );
  }

  // For authenticated mode, show loading and error states for PDF form or template
  if (!isProspectMode) {
    if (activeIsLoading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading form...</p>
          </div>
        </div>
      );
    }

    if (activeError || !activeForm) {
      const is401 = (activeError as any)?.status === 401 || (activeError as any)?.message?.includes('401');
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <p className="text-red-600 font-semibold mb-2">
              {is401 ? 'Session expired or not logged in' : 'Failed to load form'}
            </p>
            <p className="text-gray-500 text-sm mb-4">
              {is401
                ? 'Please log in and return to Application Templates to preview this form.'
                : isTemplatePreviewMode
                ? 'The template could not be loaded. Please return to Application Templates and try again.'
                : 'The form could not be loaded.'}
            </p>
            <Button onClick={() => setLocation(is401 ? '/login' : isTemplatePreviewMode ? '/application-templates' : '/pdf-forms')}>
              {is401 ? 'Go to Login' : isTemplatePreviewMode ? 'Back to Templates' : 'Back to Forms'}
            </Button>
          </div>
        </div>
      );
    }
  }

  const renderField = (field: FormField) => {
    const value = formData[field.fieldName] || '';
    const hasError = validationErrors[field.fieldName];

    switch (field.fieldType) {
      case 'address':
      case 'url':
      case 'tel':
      case 'text':
      case 'email':
      case 'phone':
        return (
          <div className="space-y-2 relative">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <div className="relative">
              <Input
                id={field.fieldName}
                type={field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'}
                value={value}
                onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
                onBlur={(e) => {
                  handlePhoneBlur(field.fieldName, e.target.value);
                  handleEINBlur(field.fieldName, e.target.value);
                }}
                className={`${hasError ? 'border-red-500' : ''} ${
                  isProspectMode && field.fieldName === 'companyEmail' ? 'bg-gray-50 cursor-not-allowed' : ''
                } ${
                  field.fieldName === 'address' && addressValidationStatus === 'valid' ? 'border-green-500' : ''
                } ${
                  field.fieldName === 'address' && addressValidationStatus === 'invalid' ? 'border-red-500' : ''
                } ${
                  addressFieldsLocked && (field.fieldName === 'city' || field.fieldName === 'zipCode') ? 'bg-gray-50 cursor-not-allowed' : ''
                }`}
                placeholder={field.fieldType === 'email' ? 'Enter email address' : 
                            field.fieldType === 'phone' ? 'Enter phone number' : 
                            field.fieldName === 'address' ? 'Enter street address (e.g., 123 Main St)' :
                            field.fieldName === 'addressLine2' ? 'Suite, apt, floor, etc. (optional)' :
                            (field.fieldName === 'federalTaxId' || field.fieldName === 'taxId') ? 'Enter 9-digit EIN (will format as XX-XXXXXXX)' :
                            ['monthlyVolume', 'averageTicket', 'highestTicket', 'avgMonthlyVolume', 'avgTicketAmount', 'highestTicketAmount'].includes(field.fieldName) ? 
                              `Enter amount (e.g., 10000.00)` :
                            `Enter ${field.fieldLabel.toLowerCase()}`}
                readOnly={
                  (isProspectMode && field.fieldName === 'companyEmail') ||
                  (addressFieldsLocked && (field.fieldName === 'city' || field.fieldName === 'zipCode'))
                }
              />
              
              {/* Address autocomplete suggestions */}
              {field.fieldName === 'address' && showSuggestions && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                  {isLoadingSuggestions ? (
                    <div className="p-3 text-center text-gray-500">
                      <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                      Loading suggestions...
                    </div>
                  ) : addressSuggestions.length > 0 ? (
                    addressSuggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className={`p-3 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${
                          index === selectedSuggestionIndex 
                            ? 'bg-blue-50 border-blue-200' 
                            : 'hover:bg-gray-100'
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectAddressSuggestion(suggestion);
                        }}
                        onMouseEnter={() => setSelectedSuggestionIndex(index)}
                      >
                        <div className={`font-medium ${
                          index === selectedSuggestionIndex ? 'text-blue-900' : 'text-gray-900'
                        }`}>
                          {suggestion.structured_formatting?.main_text || suggestion.description}
                        </div>
                        <div className={`text-sm ${
                          index === selectedSuggestionIndex ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {suggestion.structured_formatting?.secondary_text || ''}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-center text-gray-500">No suggestions found</div>
                  )}
                </div>
              )}
              
              {field.fieldName === 'address' && (addressValidationStatus === 'validating' || isLoadingSuggestions) && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              )}
              {field.fieldName === 'address' && addressValidationStatus === 'valid' && !isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-600">
                  ✓
                </div>
              )}
              {field.fieldName === 'address' && addressValidationStatus === 'invalid' && !isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-red-600">
                  ⚠
                </div>
              )}
            </div>
            {field.fieldName === 'address' && addressValidationStatus === 'valid' && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-green-600">✓ Street address validated and auto-populated city, state, and ZIP</p>
                {addressFieldsLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                      setAddressOverrideActive(false);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Edit Address
                  </button>
                )}
              </div>
            )}
            {field.fieldName === 'address' && addressValidationStatus === 'invalid' && (
              <p className="text-xs text-red-600">⚠ Please enter a valid address</p>
            )}
            {addressFieldsLocked && (field.fieldName === 'city' || field.fieldName === 'state' || field.fieldName === 'zipCode') && (
              <p className="text-xs text-gray-500">
                🔒 Field locked after address autocomplete selection. 
                <button 
                  onClick={() => {
                    setAddressFieldsLocked(false);
                    setAddressValidationStatus('idle');
                    setAddressOverrideActive(false);
                  }}
                  className="text-blue-600 hover:text-blue-800 underline ml-1"
                >
                  Edit Address
                </button>
              </p>
            )}
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'radio':
      case 'select':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Select value={value} onValueChange={(value) => handleFieldChange(field.fieldName, value)}>
              <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                <SelectValue placeholder={`Select ${field.fieldLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option: any, idx: number) => {
                  const optValue = typeof option === 'object' ? (option.value || option.label || '') : option;
                  const optLabel = typeof option === 'object' ? (option.label || option.value || '') : option;
                  return (
                    <SelectItem key={optValue || idx} value={optValue || `option_${idx}`}>
                      {optLabel}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'textarea':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Textarea
              id={field.fieldName}
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
              rows={3}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'mcc-select':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <MCCSelect
              value={value}
              onValueChange={(value) => handleFieldChange(field.fieldName, value)}
              placeholder="Select your business category"
              required={field.isRequired}
              className={hasError ? 'border-red-500' : ''}
            />
            {field.helpText && (
              <p className="text-xs text-gray-500">{field.helpText}</p>
            )}
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.fieldName}
              type="text"
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              onBlur={(e) => handleMoneyBlur(field.fieldName, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={['monthlyVolume', 'averageTicket', 'highestTicket', 'avgMonthlyVolume', 'avgTicketAmount', 'highestTicketAmount'].includes(field.fieldName) ? 
                `Enter amount (e.g., 10000.00)` : 
                `Enter ${field.fieldLabel.toLowerCase()}`}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'date':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.fieldName}
              type="date"
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'readonly':
        const readonlyValue = (() => {
          if (!value) {
            return field.fieldName === 'yearsInBusiness' ? 'Enter business start date to calculate' : 'Loading...';
          }
          if (typeof value === 'object') {
            return JSON.stringify(value);
          }
          return String(value);
        })();
        
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
            </Label>
            <Input
              id={field.fieldName}
              type="text"
              value={readonlyValue}
              readOnly
              className="bg-gray-50 cursor-not-allowed"
            />
          </div>
        );

      case 'campaign':
        if (!prospectData?.campaign) {
          return (
            <div className="space-y-4">
              <div className="text-center py-8 text-gray-500">
                <p>Campaign information not available</p>
              </div>
            </div>
          );
        }

        const campaign = prospectData.campaign;
        
        // Debug logging

        return (
          <div className="space-y-6">
            {/* Campaign Overview Card */}
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Campaign Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Campaign Name</Label>
                    <p className="text-gray-900 font-medium">{String(campaign.name || 'N/A')}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Acquirer</Label>
                    <p className="text-gray-900 font-medium">{String(campaign.acquirer || 'N/A')}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Pricing Type</Label>
                    <p className="text-gray-900 font-medium">
                      {(() => {
                        if (!campaign.pricingType) return 'Not configured';
                        if (typeof campaign.pricingType === 'string') return campaign.pricingType;
                        if (typeof campaign.pricingType === 'object' && campaign.pricingType.name) return String(campaign.pricingType.name);
                        return 'Not configured';
                      })()}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Status</Label>
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      campaign.isActive 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {campaign.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                {campaign.description && (
                  <div className="mt-4">
                    <Label className="text-sm font-medium text-gray-700">Description</Label>
                    <p className="text-gray-700 text-sm mt-1">{String(campaign.description)}</p>
                  </div>
                )}
              </CardContent>
            </Card>


          </div>
        );

      case 'equipment':
        const campaignEquipmentForSelection = prospectData?.campaignEquipment || [];
        
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  Equipment Selection
                </CardTitle>
                <p className="text-sm text-gray-600">
                  Select the equipment you would like for your merchant processing setup:
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {campaignEquipmentForSelection.map((equipment: any) => (
                    <div
                      key={equipment.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-all ${
                        formData.selectedEquipment?.includes(equipment.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => {
                        const currentSelected = formData.selectedEquipment || [];
                        const isSelected = currentSelected.includes(equipment.id);
                        const newSelected = isSelected
                          ? currentSelected.filter((id: number) => id !== equipment.id)
                          : [...currentSelected, equipment.id];
                        
                        handleFieldChange('selectedEquipment', newSelected);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {equipment.imageData && (
                          <img
                            src={equipment.imageData.startsWith('data:') ? equipment.imageData : `data:image/jpeg;base64,${equipment.imageData}`}
                            alt={String(equipment.name || 'Equipment')}
                            className="w-12 h-12 object-cover rounded"
                          />
                        )}
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{String(equipment.name || 'Equipment')}</h4>
                          <p className="text-sm text-gray-600 mt-1">{String(equipment.description || '')}</p>
                          {equipment.specifications && (
                            <p className="text-xs text-gray-500 mt-2">{String(equipment.specifications)}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                            formData.selectedEquipment?.includes(equipment.id)
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-gray-300'
                          }`}>
                            {formData.selectedEquipment?.includes(equipment.id) && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-500 mt-4">
                  You can select multiple equipment items. Final equipment will be confirmed during the approval process.
                </p>
              </CardContent>
            </Card>
          </div>
        );

      case 'ownership':
        const owners = formData.owners || [];
        const totalPercentage = owners.reduce((sum: number, owner: any) => sum + (parseFloat(owner.percentage) || 0), 0);

        const addOwner = () => {
          // Pre-populate first owner with prospect information if available
          const isFirstOwner = owners.length === 0;
          const prospectFirstName = prospectData?.prospect?.firstName || '';
          const prospectLastName = prospectData?.prospect?.lastName || '';
          const prospectEmail = prospectData?.prospect?.email || '';
          const prospectFullName = `${prospectFirstName} ${prospectLastName}`.trim();
          
          const newOwner = isFirstOwner && isProspectMode && prospectFullName && prospectEmail
            ? { 
                name: prospectFullName, 
                email: prospectEmail, 
                percentage: '', 
                signature: null, 
                signatureType: null 
              }
            : { 
                name: '', 
                email: '', 
                percentage: '', 
                signature: null, 
                signatureType: null 
              };
          
          const newOwners = [...owners, newOwner];
          handleFieldChange('owners', newOwners);
        };

        const removeOwner = (index: number) => {
          const newOwners = owners.filter((_: any, i: number) => i !== index);
          handleFieldChange('owners', newOwners);
        };

        const updateOwner = (index: number, field: string, value: any) => {
          const newOwners = [...owners];
          newOwners[index] = { ...newOwners[index], [field]: value };
          handleFieldChange('owners', newOwners);
        };

        // Auto-save owner data to database when key fields lose focus
        const handleOwnerBlur = async (index: number, field: string) => {
          if ((field === 'percentage' || field === 'name' || field === 'email') && isProspectMode && prospectData?.prospect) {
            const updatedFormData = { ...formData, owners };
            
            try {
              const response = await fetch(`/api/prospects/${prospectData.prospect.id}/save-form-data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                  formData: updatedFormData, 
                  currentStep: currentStep
                }),
              });
              
              if (response.ok) {
              } else {
                console.error('Auto-save failed for owner data:', response.status);
              }
            } catch (error) {
              console.error('Auto-save error for owner data:', error);
            }
          }
        };

        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold text-gray-800">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <div className="flex gap-2">
                {owners.length > 0 && (
                  <Button
                    type="button"
                    onClick={async () => {
                      // Check for submitted signatures by owner email
                      const updatedOwners = [...owners];
                      let hasUpdates = false;
                      
                      for (let i = 0; i < updatedOwners.length; i++) {
                        const owner = updatedOwners[i];
                        if (owner.signature) continue; // Skip if already has signature
                        
                        try {
                          // First try with signature token if available
                          if (owner.signatureToken) {
                            const response = await fetch(`/api/signature/${owner.signatureToken}`);
                            if (response.ok) {
                              const result = await response.json();
                              if (result.success && result.signature) {
                                updatedOwners[i] = {
                                  ...owner,
                                  signature: result.signature.signature,
                                  signatureType: result.signature.signatureType
                                };
                                hasUpdates = true;
                                continue;
                              }
                            }
                          }
                          
                          // Fallback: search by email
                          if (owner.email) {
                            const emailResponse = await fetch(`/api/signature/by-email/${encodeURIComponent(owner.email)}`);
                            if (emailResponse.ok) {
                              const emailResult = await emailResponse.json();
                              if (emailResult.success && emailResult.signature) {
                                updatedOwners[i] = {
                                  ...owner,
                                  signature: emailResult.signature.signature,
                                  signatureType: emailResult.signature.signatureType
                                };
                                hasUpdates = true;
                              }
                            }
                          }
                        } catch (error) {
                          console.error('Error checking signature for owner:', error);
                        }
                      }
                      
                      if (hasUpdates) {
                        handleFieldChange('owners', updatedOwners);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Check for Signatures
                  </Button>
                )}
                {totalPercentage < 100 && (
                  <Button
                    type="button"
                    onClick={addOwner}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Add Owner
                  </Button>
                )}
              </div>
            </div>

            {owners.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No owners added yet. Click "Add Owner" to get started.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {owners.map((owner: any, index: number) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-gray-800">Owner {index + 1}</h4>
                      <Button
                        type="button"
                        onClick={() => removeOwner(index)}
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-800"
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-sm text-gray-600">Owner Name *</Label>
                        <Input
                          value={owner.name || ''}
                          onChange={(e) => updateOwner(index, 'name', e.target.value)}
                          onBlur={() => handleOwnerBlur(index, 'name')}
                          placeholder="Full name"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-sm text-gray-600">Email Address *</Label>
                        <Input
                          type="email"
                          value={owner.email || ''}
                          onChange={(e) => updateOwner(index, 'email', e.target.value)}
                          onBlur={() => handleOwnerBlur(index, 'email')}
                          placeholder="owner@company.com"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-sm text-gray-600">Ownership % *</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={owner.percentage || ''}
                          onChange={(e) => updateOwner(index, 'percentage', e.target.value)}
                          onBlur={() => handleOwnerBlur(index, 'percentage')}
                          placeholder="25.00"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    {/* Signature requirement for owners with >=25% */}
                    {parseFloat(owner.percentage) >= 25 && (
                      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-3">
                          <FileText className="w-5 h-5 text-amber-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-amber-800">Signature Required</p>
                            <p className="text-xs text-amber-700">
                              Owners with 25% or more ownership must provide a signature
                            </p>
                          </div>
                        </div>

                        <DigitalSignaturePad
                          ownerIndex={index}
                          owner={owner}
                          onSignatureChange={async (ownerIndex, signature, type) => {
                            updateOwner(ownerIndex, 'signature', signature);
                            updateOwner(ownerIndex, 'signatureType', type);
                            
                            // Save inline signature to database
                            if (signature && type && owner.email && owner.name) {
                              const prospectId = prospectData?.prospect?.id || prospectData?.id;
                              if (prospectId) {
                                try {
                                  const response = await fetch(`/api/prospects/${prospectId}/save-inline-signature`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                      ownerEmail: owner.email,
                                      ownerName: owner.name,
                                      signature,
                                      signatureType: type,
                                      ownershipPercentage: owner.percentage
                                    }),
                                  });
                                  
                                  if (response.ok) {
                                    const result = await response.json();
                                    // Optionally update owner with signature token
                                    if (result.signatureToken) {
                                      updateOwner(ownerIndex, 'signatureToken', result.signatureToken);
                                    }
                                  } else {
                                    console.error('Failed to save inline signature to database');
                                  }
                                } catch (error) {
                                  console.error('Error saving inline signature:', error);
                                }
                              }
                            }
                          }}
                        />
                        
                        {!owner.signature && owner.email && (
                          <div className="mt-3 pt-3 border-t border-amber-200">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-amber-800">Or Send Email Request</p>
                                <p className="text-xs text-amber-700">
                                  Send a secure email request for digital signature
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  if (!owner.email || !owner.name || !formData.companyName) {
                                    return;
                                  }

                                  const prospectId = prospectData?.prospect?.id || prospectData?.id;
                                  
                                  if (!prospectId) {
                                    console.error('No prospect ID available');
                                    return;
                                  }

                                  try {
                                    const response = await fetch('/api/signature-request', {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                      },
                                      body: JSON.stringify({
                                        prospectId: prospectId,
                                        ownerName: owner.name,
                                        ownerEmail: owner.email,
                                        companyName: formData.companyName,
                                        ownershipPercentage: owner.percentage,
                                        requesterName: formData.companyName,
                                        agentName: formData.assignedAgent?.split(' (')[0] || 'Agent'
                                      }),
                                    });

                                    const result = await response.json();
                                    
                                    if (response.ok && result.success) {
                                      updateOwner(index, 'signatureToken', result.signatureToken);
                                      updateOwner(index, 'emailSent', new Date().toISOString());
                                    } else {
                                      console.error('Failed to send signature request:', result.message);
                                    }
                                  } catch (error) {
                                    console.error('Error sending signature request:', error);
                                  }
                                }}
                                disabled={!owner.email || !formData.companyName}
                                className="border-amber-300 text-amber-700 hover:bg-amber-100"
                              >
                                Send Email Request
                              </Button>
                            </div>
                            
                            {owner.emailSent && (
                              <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                                Email sent successfully on {new Date(owner.emailSent).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {owners.length > 0 && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-800">
                    Total Ownership: {totalPercentage.toFixed(2)}%
                  </span>
                  {totalPercentage !== 100 && (
                    <span className="text-xs text-blue-700">
                      {totalPercentage > 100 ? 'Exceeds 100%' : `${(100 - totalPercentage).toFixed(2)}% remaining`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'disclosure':
        const disclosureSignaturesKey = `${field.fieldName}_signatures`;
        const disclosureSigners = formData[disclosureSignaturesKey] || [];
        const maxDisclosureSigners = field.maxSigners || 1;
        const disclosureSignerLabel = field.signerLabel || 'Signer';

        return (
          <div className="space-y-4">
            <DisclosureFieldRenderer
              field={field}
              formData={formData}
              onFieldChange={handleFieldChange}
            />

            {field.requiresSignature && (
              <div className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700">
                    {disclosureSignerLabel} Signature{maxDisclosureSigners > 1 ? 's' : ''}{' '}
                    {maxDisclosureSigners > 1 && `(${disclosureSigners.length} of ${maxDisclosureSigners})`}
                  </h4>
                  <div className="flex gap-2">
                    {disclosureSigners.length > 0 && (
                      <Button
                        type="button"
                        onClick={async () => {
                          const updated = [...disclosureSigners];
                          let found = false;
                          for (let i = 0; i < updated.length; i++) {
                            const s = updated[i];
                            if (s.signature) continue;
                            try {
                              if (s.signatureToken) {
                                const res = await fetch(`/api/signature/${s.signatureToken}`);
                                if (res.ok) {
                                  const r = await res.json();
                                  if (r.success && r.signature) {
                                    updated[i] = { ...s, signature: r.signature.signature, signatureType: r.signature.signatureType };
                                    found = true;
                                    continue;
                                  }
                                }
                              }
                              if (s.email) {
                                const res = await fetch(`/api/signatures/by-email/${encodeURIComponent(s.email)}`);
                                if (res.ok) {
                                  const r = await res.json();
                                  if (r.success && r.signature) {
                                    updated[i] = { ...s, signature: r.signature.signature, signatureType: r.signature.signatureType, signatureToken: r.signature.token };
                                    found = true;
                                  }
                                }
                              }
                            } catch (err) { console.error('Error checking signature:', err); }
                          }
                          if (found) {
                            handleFieldChange(disclosureSignaturesKey, updated);
                            toast({ title: "Signatures Found!", description: "Successfully loaded submitted signatures." });
                          } else {
                            toast({ title: "No Signatures Found", description: "No submitted signatures found for the current signers." });
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Check for Signatures
                      </Button>
                    )}
                    {disclosureSigners.length < maxDisclosureSigners && (
                      <Button
                        type="button"
                        onClick={() => handleFieldChange(disclosureSignaturesKey, [...disclosureSigners, { name: '', email: '', signature: null, signatureType: null }])}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                      >
                        <Users className="w-3 h-3 mr-1" />
                        Add {disclosureSignerLabel}
                      </Button>
                    )}
                  </div>
                </div>

                {disclosureSigners.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleFieldChange(disclosureSignaturesKey, [{ name: '', email: '', signature: null, signatureType: null }])}
                  >
                    <Signature className="w-4 h-4 mr-2" />
                    Add {disclosureSignerLabel} Signature
                  </Button>
                )}

                {disclosureSigners.map((signer: any, signerIdx: number) => (
                  <Card key={signerIdx} className="p-4 border border-gray-200">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-gray-800 flex items-center gap-2">
                          <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Signature className="w-4 h-4 text-blue-600" />
                          </div>
                          {disclosureSignerLabel} {signerIdx + 1}
                        </h4>
                        {disclosureSigners.length > 1 && (
                          <Button
                            type="button"
                            onClick={() => handleFieldChange(disclosureSignaturesKey, disclosureSigners.filter((_: any, i: number) => i !== signerIdx))}
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 border-red-200"
                          >
                            Remove
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm text-gray-600">{disclosureSignerLabel} Name *</Label>
                          <Input
                            value={signer.name || ''}
                            onChange={(e) => {
                              const updated = [...disclosureSigners];
                              updated[signerIdx] = { ...updated[signerIdx], name: e.target.value };
                              handleFieldChange(disclosureSignaturesKey, updated);
                            }}
                            placeholder="Full name"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-sm text-gray-600">Email Address *</Label>
                          <Input
                            type="email"
                            value={signer.email || ''}
                            onChange={(e) => {
                              const updated = [...disclosureSigners];
                              updated[signerIdx] = { ...updated[signerIdx], email: e.target.value };
                              handleFieldChange(disclosureSignaturesKey, updated);
                            }}
                            placeholder="signer@company.com"
                            className="mt-1"
                          />
                        </div>
                      </div>

                      <div className="mt-2">
                        <DigitalSignaturePad
                          ownerIndex={signerIdx}
                          owner={signer}
                          onSignatureChange={(idx, signature, type) => {
                            const updated = [...disclosureSigners];
                            updated[idx] = { ...updated[idx], signature, signatureType: type };
                            handleFieldChange(disclosureSignaturesKey, updated);
                          }}
                        />
                      </div>

                      {!signer.signature && signer.email && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-700">Or Send Email Request</p>
                              <p className="text-xs text-gray-500">Send a secure email for digital signature</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!signer.email || !signer.name) {
                                  toast({ title: "Missing Information", description: "Signer name and email are required.", variant: "destructive" });
                                  return;
                                }
                                const prospectId = prospectData?.prospect?.id || prospectData?.id;
                                if (!prospectId) {
                                  toast({ title: "Error", description: "Unable to identify prospect. Please refresh and try again.", variant: "destructive" });
                                  return;
                                }
                                try {
                                  const response = await fetch('/api/signature-request', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      prospectId,
                                      ownerName: signer.name,
                                      ownerEmail: signer.email,
                                      companyName: formData.companyName || '',
                                      ownershipPercentage: '',
                                      requesterName: formData.companyName || field.disclosureTitle || '',
                                      agentName: formData.assignedAgent?.split(' (')[0] || 'Agent'
                                    }),
                                  });
                                  const result = await response.json();
                                  if (response.ok && result.success) {
                                    const updated = [...disclosureSigners];
                                    updated[signerIdx] = { ...updated[signerIdx], signatureToken: result.signatureToken, emailSent: true, emailSentAt: new Date().toISOString() };
                                    handleFieldChange(disclosureSignaturesKey, updated);
                                    toast({ title: "Email Sent", description: `Signature request sent to ${signer.email}` });
                                  } else {
                                    throw new Error(result.message || 'Failed to send email');
                                  }
                                } catch (error) {
                                  toast({ title: "Email Failed", description: "Failed to send signature request. Please try again.", variant: "destructive" });
                                }
                              }}
                              disabled={!signer.email || !signer.name}
                              className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              Send Email Request
                            </Button>
                          </div>
                          {signer.emailSent && (
                            <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                              ✓ Email sent to {signer.email} on {new Date(signer.emailSentAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );

      case 'checkbox-list': {
        const selectedValues: string[] = Array.isArray(value) ? value : (value ? String(value).split(',').filter(Boolean) : []);
        const checklistOptions = field.options || [];
        const isHorizontal = field.displayOrientation === 'horizontal';
        return (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <div className={`border rounded-lg p-3 bg-white ${isHorizontal ? 'flex flex-wrap gap-4' : 'space-y-2'}`}>
              {checklistOptions.length > 0 ? checklistOptions.map((opt: any, idx: number) => {
                const optLabel = typeof opt === 'object' ? opt.label : opt;
                const optValue = typeof opt === 'object' ? opt.value : opt;
                const isChecked = selectedValues.includes(optValue);
                return (
                  <label key={idx} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        const updated = isChecked
                          ? selectedValues.filter(v => v !== optValue)
                          : [...selectedValues, optValue];
                        handleFieldChange(field.fieldName, updated);
                      }}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">{optLabel}</span>
                  </label>
                );
              }) : (
                <p className="text-sm text-gray-400 text-center py-2">No options configured</p>
              )}
            </div>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );
      }

      case 'currency':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <Input
                id={field.fieldName}
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, '');
                  handleFieldChange(field.fieldName, raw);
                }}
                className={`pl-7 ${hasError ? 'border-red-500' : ''}`}
                placeholder="0.00"
              />
            </div>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'percentage':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <div className="relative">
              <Input
                id={field.fieldName}
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, '');
                  handleFieldChange(field.fieldName, raw);
                }}
                className={`pr-8 ${hasError ? 'border-red-500' : ''}`}
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
            </div>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'ssn':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Input
              id={field.fieldName}
              type="text"
              inputMode="numeric"
              maxLength={11}
              value={value}
              onChange={(e) => {
                let raw = e.target.value.replace(/\D/g, '').slice(0, 9);
                let formatted = raw;
                if (raw.length > 5) formatted = `${raw.slice(0,3)}-${raw.slice(3,5)}-${raw.slice(5)}`;
                else if (raw.length > 3) formatted = `${raw.slice(0,3)}-${raw.slice(3)}`;
                handleFieldChange(field.fieldName, formatted);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="XXX-XX-XXXX"
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'ein':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Input
              id={field.fieldName}
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={value}
              onChange={(e) => {
                let raw = e.target.value.replace(/\D/g, '').slice(0, 9);
                let formatted = raw.length > 2 ? `${raw.slice(0,2)}-${raw.slice(2)}` : raw;
                handleFieldChange(field.fieldName, formatted);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="XX-XXXXXXX"
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'zipcode':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Input
              id={field.fieldName}
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={value}
              onChange={(e) => {
                let raw = e.target.value.replace(/[^0-9-]/g, '').slice(0, 10);
                handleFieldChange(field.fieldName, raw);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="12345 or 12345-6789"
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'bank_account':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Input
              id={field.fieldName}
              type="text"
              inputMode="numeric"
              maxLength={17}
              value={value}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 17);
                handleFieldChange(field.fieldName, raw);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="Account number"
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'bank_routing':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Input
              id={field.fieldName}
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={value}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
                handleFieldChange(field.fieldName, raw);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="9-digit routing number"
            />
            {value && value.length === 9 && <p className="text-xs text-green-600">Valid length (9 digits)</p>}
            {value && value.length > 0 && value.length < 9 && <p className="text-xs text-amber-500">{9 - value.length} more digit{9 - value.length > 1 ? 's' : ''} needed</p>}
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'checkbox':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id={field.fieldName}
                checked={value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1'}
                onChange={(e) => handleFieldChange(field.fieldName, e.target.checked ? 'yes' : 'no')}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700 cursor-pointer">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
            </div>
            {field.description && <p className="text-xs text-gray-500 ml-7">{field.description}</p>}
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'boolean':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
            <Select value={value} onValueChange={(val) => handleFieldChange(field.fieldName, val)}>
              <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select Yes or No" />
              </SelectTrigger>
              <SelectContent>
                {(field.options || []).map((opt: any, idx: number) => {
                  const optVal = typeof opt === 'object' ? (opt.value || '') : opt;
                  const optLbl = typeof opt === 'object' ? (opt.label || opt.value || '') : opt;
                  return (
                    <SelectItem key={optVal || idx} value={optVal || `opt_${idx}`}>
                      {optLbl}
                    </SelectItem>
                  );
                })}
                {(!field.options || field.options.length === 0) && (
                  <>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'owner_group':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              <Label className="text-lg font-semibold text-gray-800">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
              <p className="text-sm text-gray-500 text-center">
                Owner/principal information section — supports up to {field.ownerGroupConfig?.maxOwners || 4} owners
              </p>
              <p className="text-xs text-gray-400 text-center mt-1">
                Full ownership form with name, title, SSN, DOB, address, and ownership percentage
              </p>
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.fieldName}
              type="text"
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Preview mode banner */}
      {isTemplatePreviewMode && (
        <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium">
          Preview Mode — {activeForm?.name || 'Template'} — This form is for review only; submissions are disabled.
        </div>
      )}
      {/* Header - Fixed */}
      <div className="bg-white/95 backdrop-blur-sm border-b border-gray-200 px-4 py-6 sticky top-0 z-50 shadow-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {isProspectMode ? 'Merchant Processing Application' : (activeForm?.name || 'Form')}
                </h1>
                <p className="text-gray-600 text-sm">
                  {isProspectMode 
                    ? `Welcome ${prospectData?.prospect?.firstName || ''}! Complete your application - all changes save automatically`
                    : isTemplatePreviewMode
                    ? `Template preview — ${activeForm?.description || ''}`
                    : `${activeForm?.description || 'Form'} - all changes save automatically`
                  }
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Progress</div>
              <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                {Math.round(((currentStep + 1) / sections.length) * 100)}%
              </div>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">
                Step {currentStep + 1} of {sections.length}
              </span>
              <span className="text-xs text-gray-500">
                {sections[currentStep]?.name}
              </span>
            </div>
            <Progress 
              value={((currentStep + 1) / sections.length) * 100} 
              className="h-3 bg-gray-200"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Section Navigation */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 h-fit sticky top-28">
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Application Sections</h3>
                <nav className="space-y-3">
                  {sections.map((section, index) => {
                    const IconComponent = section.icon;
                    const isActive = currentStep === index;
                    const isCompleted = index < currentStep;
                    const isVisited = Array.from(visitedSections).includes(index);
                    const hasValidationIssues = getSectionValidationStatus(index);
                    const showWarning = isVisited && hasValidationIssues && !isActive;
                    
                    return (
                      <button
                        key={index}
                        onClick={() => {
                          setVisitedSections(prev => {
                            const newVisited = new Set([...prev]);
                            newVisited.add(currentStep); // Mark the section we're LEAVING as visited
                            newVisited.add(index); // Mark the section we're GOING TO as visited
                            return newVisited;
                          });
                          setCurrentStep(index);
                        }}
                        className={`w-full text-left p-4 rounded-xl transition-all duration-200 ${
                          isActive
                            ? 'bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200 text-blue-800 shadow-md transform scale-[1.02]'
                            : showWarning
                            ? 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-yellow-200 text-yellow-800 hover:shadow-sm'
                            : isCompleted && !hasValidationIssues
                            ? 'bg-gradient-to-r from-green-50 to-green-100 border-green-200 text-green-800 hover:shadow-sm'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:shadow-sm'
                        } border`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isActive 
                              ? 'bg-blue-200 shadow-sm' 
                              : showWarning
                              ? 'bg-yellow-200'
                              : isCompleted && !hasValidationIssues 
                              ? 'bg-green-200' 
                              : 'bg-gray-200'
                          }`}>
                            {showWarning ? (
                              <AlertTriangle className="w-5 h-5 text-yellow-700" />
                            ) : (
                              <IconComponent className={`w-5 h-5 ${
                                isActive 
                                  ? 'text-blue-700' 
                                  : isCompleted && !hasValidationIssues 
                                  ? 'text-green-700' 
                                  : 'text-gray-600'
                              }`} />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-sm">{section.name}</div>
                            <div className="text-xs opacity-70 mt-1">
                              {showWarning 
                                ? 'Needs attention' 
                                : `${getVisibleFieldCount(index)} field${getVisibleFieldCount(index) !== 1 ? 's' : ''}`
                              }
                            </div>
                          </div>
                          {showWarning ? (
                            <AlertTriangle className="w-5 h-5 text-yellow-600" />
                          ) : isCompleted && !hasValidationIssues ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </nav>
                
                {/* Auto-save Status */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="flex items-center text-sm">
                    {autoSaveMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                        <span className="text-blue-600">Saving...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-gray-600">All changes saved</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Form Content */}
            <div className="lg:col-span-4">
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                {/* Section Header */}
                <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-8 py-6 border-b border-blue-200">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                      {React.createElement(sections[currentStep]?.icon || FileText, {
                        className: "w-6 h-6 text-blue-600"
                      })}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-blue-900">{sections[currentStep]?.name}</h2>
                      <p className="text-blue-700 text-sm mt-1">{sections[currentStep]?.description}</p>
                    </div>
                  </div>
                </div>

                {/* Form Fields */}
                <div className="p-8">
                  <div className="space-y-6">
                    {sections[currentStep]?.fields.map((field) => {
                      if (!isFieldVisible(field)) return null;
                      const fieldHasError = !!validationErrors[field.fieldName];
                      return (
                        <div key={field.id} data-field-error={fieldHasError ? "true" : undefined}>
                          {renderField(field)}
                        </div>
                      );
                    })}
                  </div>

                  {/* Navigation Buttons */}
                  <div className="flex items-center justify-between mt-12 pt-8 border-t border-gray-200">
                    <div>
                      {currentStep > 0 && (
                        <Button
                          variant="outline"
                          onClick={handlePrevious}
                          className="flex items-center space-x-2"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          <span>Previous</span>
                        </Button>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-4">
                      {currentStep < sections.length - 1 ? (
                        <Button
                          onClick={handleNext}
                          className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                        >
                          <span>Next</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            if (isTemplatePreviewMode) return;
                            if (!validateCurrentSection()) {
                              scrollToFirstError();
                              toast({
                                title: "Required Fields Missing",
                                description: "Please fill in the highlighted fields before submitting.",
                                variant: "destructive",
                              });
                              return;
                            }
                            submitApplicationMutation.mutate(formData);
                          }}
                          disabled={submitApplicationMutation.isPending || isTemplatePreviewMode}
                          title={isTemplatePreviewMode ? 'Submission disabled in preview mode' : undefined}
                          className="flex items-center space-x-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submitApplicationMutation.isPending ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Submitting...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              <span>{isTemplatePreviewMode ? 'Preview Only' : 'Submit Application'}</span>
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={validationModalOpen} onOpenChange={setValidationModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-200 rounded-full flex items-center justify-center mb-4 shadow-sm">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <DialogTitle className="text-2xl font-bold text-red-600">
                Application Incomplete
              </DialogTitle>
              <DialogDescription className="text-gray-500 mt-1">
                Please complete the required information before submitting
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-xl border-l-4 border-red-600 whitespace-pre-line text-gray-700 leading-relaxed text-sm max-h-[50vh] overflow-y-auto">
            {validationModalMessage}
          </div>
          <DialogFooter className="justify-center sm:justify-center">
            <Button
              onClick={() => setValidationModalOpen(false)}
              className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 px-8"
            >
              I Understand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}