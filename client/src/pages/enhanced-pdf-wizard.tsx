import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Building, FileText, CheckCircle, ArrowLeft, ArrowRight, Users, Upload, Signature, PenTool, Type, RotateCcw, Check, X, AlertTriangle, Monitor, Info } from 'lucide-react';
import { MCCSelect } from '@/components/ui/mcc-select';
import { PhoneNumberInput } from '@/components/forms/PhoneNumberInput';
import { EINInput } from '@/components/forms/EINInput';
import { AddressAutocompleteInput } from '@/components/forms/AddressAutocompleteInput';
import { SignatureGroupInput } from '@/components/forms/SignatureGroupInput';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface FormField {
  id: number;
  fieldName: string;
  fieldType: string;
  fieldLabel: string;
  isRequired: boolean;
  options: string[] | null;
  defaultValue: string | null;
  validation: string | null;
  position: number;
  section: string | null;
  description?: string;
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
  const [isInitialRender, setIsInitialRender] = useState(true);
  const [addressValidationStatus, setAddressValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [activeOwnerSlots, setActiveOwnerSlots] = useState<Set<number>>(new Set([1])); // Start with owner1 active
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check for submitted signatures when form data changes
  useEffect(() => {
    // Add a small delay to ensure form data is fully loaded
    const timer = setTimeout(async () => {
      if (!formData.owners || !Array.isArray(formData.owners)) {
        console.log('No owners array found');
        return;
      }
      
      console.log('Checking for submitted signatures...', formData.owners);
      
      const updatedOwners = [...formData.owners];
      let hasUpdates = false;
      
      for (let i = 0; i < updatedOwners.length; i++) {
        const owner = updatedOwners[i];
        
        console.log(`Checking owner ${owner.name}:`, {
          hasSignature: !!owner.signature,
          signatureToken: owner.signatureToken
        });
        
        // Skip if owner already has a signature or no signature token
        if (owner.signature || !owner.signatureToken) {
          console.log(`Skipping ${owner.name}: ${owner.signature ? 'already has signature' : 'no signature token'}`);
          continue;
        }
        
        try {
          console.log(`Fetching signature for token: ${owner.signatureToken}`);
          const response = await fetch(`/api/signature/${owner.signatureToken}`);
          console.log(`Response status: ${response.status}`);
          
          if (response.ok) {
            const result = await response.json();
            console.log('Signature API response:', result);
            
            if (result.success && result.signature) {
              updatedOwners[i] = {
                ...owner,
                signature: result.signature.signature,
                signatureType: result.signature.signatureType
              };
              hasUpdates = true;
              console.log(`Found submitted signature for ${owner.name}`);
            }
          } else {
            console.log(`No signature found for ${owner.name} (${response.status})`);
          }
        } catch (error) {
          console.log(`Error checking signature for ${owner.name}:`, error);
        }
      }
      
      if (hasUpdates) {
        console.log('Updating form data with signatures');
        setFormData(prev => ({
          ...prev,
          owners: updatedOwners
        }));
      } else {
        console.log('No signature updates found');
      }
    }, 100); // Small delay to ensure form data is fully loaded
    
    return () => clearTimeout(timer);
  }, [formData.owners]); // Trigger when owners array changes

  // Check for any cached data on component mount
  useEffect(() => {
    console.log('Component mounted, checking for cached data...');
    console.log('localStorage keys:', Object.keys(localStorage));
    console.log('sessionStorage keys:', Object.keys(sessionStorage));
    
    // Clear any potential cached address data
    const addressKeys = ['address', 'city', 'state', 'zipCode'];
    addressKeys.forEach(key => {
      if (localStorage.getItem(key)) {
        console.log(`Found cached ${key}:`, localStorage.getItem(key));
        localStorage.removeItem(key);
      }
      if (sessionStorage.getItem(key)) {
        console.log(`Found cached ${key}:`, sessionStorage.getItem(key));
        sessionStorage.removeItem(key);
      }
    });
  }, []);

  // Check for prospect validation token in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const prospectToken = urlParams.get('token');
  const isProspectMode = !!prospectToken;
  
  // Check for preview mode with templateId
  const isPreviewMode = urlParams.get('preview') === 'true';
  const previewTemplateId = urlParams.get('templateId');

  // Fetch prospect data if token is present
  const { data: prospectData } = useQuery({
    queryKey: ['/api/prospects/token', prospectToken],
    queryFn: async () => {
      if (!prospectToken) return null;
      const response = await fetch(`/api/prospects/token/${prospectToken}`);
      if (!response.ok) throw new Error('Invalid prospect token');
      const data = await response.json();
      console.log('📍 Prospect data loaded:', data);
      console.log('📍 Has applicationTemplate?', !!data?.applicationTemplate);
      if (data?.applicationTemplate) {
        console.log('📍 Template details:', {
          id: data.applicationTemplate.id,
          name: data.applicationTemplate.templateName,
          hasAddressGroups: !!data.applicationTemplate.addressGroups,
          addressGroupsCount: data.applicationTemplate.addressGroups?.length || 0,
          addressGroups: data.applicationTemplate.addressGroups
        });
      }
      return data;
    },
    enabled: !!prospectToken,
  });

  // Fetch template data for preview mode
  const { data: previewTemplate } = useQuery({
    queryKey: ['/api/acquirer-application-templates', previewTemplateId],
    queryFn: async () => {
      if (!previewTemplateId) return null;
      const response = await fetch(`/api/acquirer-application-templates/${previewTemplateId}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch template');
      return response.json();
    },
    enabled: isPreviewMode && !!previewTemplateId,
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

  // Signature request mutation
  const signatureRequestMutation = useMutation({
    mutationFn: async (requestData: {
      applicationId: number | null;
      prospectId: number | null;
      roleKey: string;
      signerType: string;
      signerName: string;
      signerEmail: string;
      ownershipPercentage: number | null;
    }) => {
      return await apiRequest('/api/signature-requests', {
        method: 'POST',
        body: JSON.stringify(requestData),
      });
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        toast({
          title: 'Signature request sent',
          description: `Email sent to ${variables.signerEmail}`,
        });
        // Invalidate related queries
        queryClient.invalidateQueries({ queryKey: ['/api/signatures'] });
        if (variables.prospectId) {
          queryClient.invalidateQueries({ queryKey: [`/api/prospects/${variables.prospectId}`] });
        }
        if (variables.applicationId) {
          queryClient.invalidateQueries({ queryKey: [`/api/applications/${variables.applicationId}`] });
        }
      } else {
        toast({
          title: 'Failed to send request',
          description: result.message || 'Please try again',
          variant: 'destructive',
        });
      }
    },
    onError: (error: any) => {
      console.error('Error requesting signature:', error);
      toast({
        title: 'Error',
        description: 'Failed to send signature request',
        variant: 'destructive',
      });
    },
  });

  // Resend signature request mutation
  const resendSignatureRequestMutation = useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      return await apiRequest(`/api/signatures/${token}/resend`, {
        method: 'POST',
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: 'Signature request resent',
          description: 'A new email has been sent with an updated link',
        });
        // Invalidate related queries
        queryClient.invalidateQueries({ queryKey: ['/api/signatures'] });
      } else {
        toast({
          title: 'Failed to resend request',
          description: result.message || 'Please try again',
          variant: 'destructive',
        });
      }
    },
    onError: (error: any) => {
      console.error('Error resending signature request:', error);
      toast({
        title: 'Error',
        description: 'Failed to resend signature request',
        variant: 'destructive',
      });
    },
  });

  // Helper function to calculate total ownership percentage from active owners
  const calculateTotalOwnership = (): number => {
    let total = 0;
    activeOwnerSlots.forEach((slotNumber) => {
      const ownerKey = `owner${slotNumber}`;
      const ownerDataStr = formData[`_signatureGroup_${ownerKey}_signature_owner`];
      if (ownerDataStr) {
        try {
          const ownerData = JSON.parse(ownerDataStr);
          const percentage = parseFloat(ownerData.ownershipPercentage || '0');
          if (!isNaN(percentage)) {
            total += percentage;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    return total;
  };

  // Helper function to add a new owner slot
  const addOwnerSlot = () => {
    const nextSlot = Math.max(...Array.from(activeOwnerSlots), 0) + 1;
    if (nextSlot <= 5) { // Max 5 owners
      setActiveOwnerSlots(new Set([...activeOwnerSlots, nextSlot]));
    }
  };

  // Helper function to remove an owner slot
  const removeOwnerSlot = (slotNumber: number) => {
    if (slotNumber === 1) return; // Can't remove owner1
    const newSlots = new Set(activeOwnerSlots);
    newSlots.delete(slotNumber);
    setActiveOwnerSlots(newSlots);
    
    // Clear the form data for this owner
    const ownerKey = `owner${slotNumber}`;
    handleFieldChange(`_signatureGroup_${ownerKey}_signature_owner`, '');
  };

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
        // Create enhanced modal dialog for all validation errors
        const modalOverlay = document.createElement('div');
        modalOverlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          backdrop-filter: blur(2px);
          animation: fadeIn 0.2s ease-out;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;
        
        // Add CSS animations
        const style = document.createElement('style');
        style.textContent = `
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideIn {
            from { transform: scale(0.95) translateY(-20px); opacity: 0; }
            to { transform: scale(1) translateY(0); opacity: 1; }
          }
          .modal-button:hover {
            background: #b91c1c !important;
            transform: translateY(-1px);
          }
        `;
        document.head.appendChild(style);
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
          background: white;
          border-radius: 16px;
          padding: 32px;
          max-width: 650px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.3);
          border: 1px solid #e5e7eb;
          animation: slideIn 0.3s ease-out;
        `;
        
        modalContent.innerHTML = `
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="
              width: 72px;
              height: 72px;
              background: linear-gradient(135deg, #fee2e2, #fecaca);
              border-radius: 50%;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              margin-bottom: 16px;
              box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
            ">
              <svg width="32" height="32" fill="#dc2626" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
            </div>
            <h3 style="
              margin: 0; 
              color: #dc2626; 
              font-weight: 700; 
              font-size: 28px; 
              letter-spacing: -0.5px;
              margin-bottom: 8px;
            ">
              Application Incomplete
            </h3>
            <p style="
              margin: 0;
              color: #6b7280;
              font-size: 16px;
              font-weight: 500;
            ">
              Please complete the required information before submitting
            </p>
          </div>
          <div style="
            white-space: pre-line; 
            line-height: 1.7; 
            color: #374151; 
            margin-bottom: 32px;
            font-size: 15px;
            background: linear-gradient(135deg, #f9fafb, #f3f4f6);
            padding: 24px;
            border-radius: 12px;
            border-left: 5px solid #dc2626;
            box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
          ">${errorMessage}</div>
          <div style="display: flex; gap: 16px; justify-content: center;">
            <button id="closeModalBtn" 
              class="modal-button"
              style="
                background: linear-gradient(135deg, #dc2626, #b91c1c); 
                color: white; 
                border: none; 
                padding: 14px 32px; 
                border-radius: 10px; 
                cursor: pointer;
                font-weight: 600;
                font-size: 16px;
                letter-spacing: 0.25px;
                transition: all 0.2s ease;
                box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
                min-width: 140px;
              ">
              I Understand
            </button>
          </div>
        `;
        
        modalOverlay.appendChild(modalContent);
        
        // Add close button event listener
        const closeBtn = modalContent.querySelector('#closeModalBtn');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            modalOverlay.remove();
          });
        }
        
        // Close modal when clicking overlay
        modalOverlay.addEventListener('click', (e) => {
          if (e.target === modalOverlay) {
            modalOverlay.remove();
          }
        });
        
        // Close modal with Escape key
        const handleEscape = (e) => {
          if (e.key === 'Escape') {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleEscape);
          }
        };
        document.addEventListener('keydown', handleEscape);
        
        document.body.appendChild(modalOverlay);
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

  // Navigation handlers that save form data before moving between sections
  const handleNext = () => {
    const nextStep = Math.min(filteredSections.length - 1, currentStep + 1);
    
    console.log(`Navigating from step ${currentStep} to step ${nextStep}`);
    
    // Preserve all previously visited sections and add current one
    setVisitedSections(prev => {
      const newVisited = new Set([...prev]);
      newVisited.add(currentStep); // Mark current section as visited
      newVisited.add(nextStep); // Mark next section as visited
      return newVisited;
    });
    
    // Save current form data before navigating for prospect mode
    if (isProspectMode && prospectData?.prospect?.id) {
      console.log('Saving form data with currentStep:', nextStep);
      saveFormDataMutation.mutate({
        formData: formData,
        currentStep: nextStep
      });
    }
    
    setCurrentStep(nextStep);
  };

  const handlePrevious = () => {
    const prevStep = Math.max(0, currentStep - 1);
    
    console.log(`Navigating from step ${currentStep} to step ${prevStep}`);
    
    // Preserve all previously visited sections - don't reset when going back
    setVisitedSections(prev => {
      const newVisited = new Set([...prev]);
      newVisited.add(currentStep); // Mark current section as visited
      // Don't remove any previously visited sections when going back
      return newVisited;
    });
    
    // Save current form data before navigating for prospect mode
    if (isProspectMode && prospectData?.prospect?.id) {
      console.log('Saving form data with currentStep:', prevStep);
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

    // Check required fields in this section
    for (const field of section.fields) {
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

    // For debugging, log validation status
    if (section.name === 'Merchant Information') {
      console.log(`Section ${sectionIndex} (${section.name}) validation:`, {
        hasErrors
      });
    }

    return hasErrors;
  };

  // Fetch PDF form with fields (disable for prospect mode)
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
    enabled: !!id && !isProspectMode
  });

  // Load owners with signatures from database
  const loadOwnersWithSignatures = async (prospectId: number) => {
    try {
      console.log(`Loading owners with signatures for prospect ${prospectId}`);
      const response = await fetch(`/api/prospects/${prospectId}/owners-with-signatures`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.owners.length > 0) {
          console.log("Found owners with signatures from database:", result.owners);
          
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
            
            console.log("Merged owners with signatures:", updatedOwners);
            return {
              ...prev,
              owners: updatedOwners
            };
          });
        } else {
          console.log("No owners found in database");
        }
      } else {
        console.log("Failed to fetch owners:", response.status);
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
        console.log('Auto-selecting single equipment option:', singleEquipment.name);
        handleFieldChange('selectedEquipment', [singleEquipment.id]);
      }
    }
  }, [prospectData, formData.selectedEquipment]);

  // Debug form data changes
  useEffect(() => {
    console.log('Form data updated:', formData);
  }, [formData]);

  // Initialize form data with agent and prospect information for prospects
  useEffect(() => {
    if (isProspectMode && prospectData?.prospect && prospectData?.agent && !initialDataLoaded) {
      const newData = {
        assignedAgent: `${prospectData.agent.firstName} ${prospectData.agent.lastName} (${prospectData.agent.email})`,
        companyEmail: prospectData.prospect.email
      };
      console.log('Setting initial prospect data:', newData);
      setFormData(newData);
      setInitialDataLoaded(true);
      
      // Load existing form data if available
      if (prospectData.prospect.formData) {
        try {
          const existingData = JSON.parse(prospectData.prospect.formData);
          console.log('Loading existing form data:', existingData);
          
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
          
          console.log('Marking sections as visited based on existing data:', Array.from(newVisited));
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
          
          console.log('Auto-advancing to step:', startingStep, {
            merchantInfoComplete,
            businessTypeComplete,
            savedStep
          });
        } catch (error) {
          console.error('Error determining starting step:', error);
        }
      }
      
      console.log('Setting starting step:', startingStep);
      setCurrentStep(startingStep);
      
      // Mark as no longer initial render after a short delay to allow focus
      setTimeout(() => {
        setIsInitialRender(false);
      }, 500);
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
          { id: 18, fieldName: 'mccCode', fieldType: 'mcc-select', fieldLabel: 'Merchant Category Code (MCC)', isRequired: true, options: null, defaultValue: null, validation: null, position: 18, section: 'Products, Services & Processing' },
          { id: 19, fieldName: 'processingMethod', fieldType: 'select', fieldLabel: 'Primary Processing Method', isRequired: true, options: ['In-Person (Card Present)', 'Online (Card Not Present)', 'Both'], defaultValue: null, validation: null, position: 19, section: 'Products, Services & Processing' },
        ]
      },
      {
        name: 'Transaction Information',
        description: 'Financial data, volume estimates, and transaction processing details',
        icon: ArrowRight,
        fields: [
          { id: 20, fieldName: 'monthlyVolume', fieldType: 'number', fieldLabel: 'Expected Monthly Processing Volume ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 20, section: 'Transaction Information' },
          { id: 21, fieldName: 'averageTicket', fieldType: 'number', fieldLabel: 'Average Transaction Amount ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 21, section: 'Transaction Information' },
          { id: 22, fieldName: 'highestTicket', fieldType: 'number', fieldLabel: 'Highest Single Transaction ($)', isRequired: true, options: null, defaultValue: null, validation: null, position: 22, section: 'Transaction Information' },
        ]
      }
    );

    return baseSections;
  };

  // Convert template field configuration to FormSection format
  const createSectionsFromTemplate = (template: any): FormSection[] => {
    if (!template?.fieldConfiguration?.sections) {
      return createProspectFormSections();
    }
    
    const iconMap: Record<string, any> = {
      'Campaign Details': FileText,
      'Equipment Selection': Monitor,
      'Merchant Information': Building,
      'Business Type & Tax Information': FileText,
      'Business Ownership': Users,
      'Products, Services & Processing': CheckCircle,
      'Transaction Information': ArrowRight,
    };
    
    // Get the list of required field names from the template
    const requiredFieldNames = template.requiredFields || [];
    
    // Auto-detect address groups from field naming patterns
    // Pattern: {prefix}.{canonicalField} where canonicalField is address1/street1/city/state/zipcode/postalCode/country
    const autoDetectedGroups: Record<string, any> = {};
    const addressFieldIdsToFilter = new Set<string>();
    const addressGroupPositions: Record<string, { sectionTitle: string, position: number }> = {};
    
    // First pass: detect address group prefixes and track their positions
    template.fieldConfiguration.sections.forEach((section: any) => {
      section.fields.forEach((field: any, fieldIndex: number) => {
        const match = field.id?.match(/^(.+)\.(address1|street1|city|state|zipcode|postalCode|country)$/i);
        if (match) {
          const [, prefix, canonicalField] = match;
          if (!autoDetectedGroups[prefix]) {
            autoDetectedGroups[prefix] = {
              type: prefix.split('_').pop()?.replace(/Address$/, '') || 'location',
              label: field.label?.split('.')[0] || prefix,
              sectionName: section.title,
              fieldMappings: {}
            };
            // Track the position of the first field in this address group
            addressGroupPositions[prefix] = {
              sectionTitle: section.title,
              position: fieldIndex
            };
          }
          
          // Map canonical names to field IDs
          const canonical = canonicalField.toLowerCase() === 'address1' ? 'street1' : 
                           canonicalField.toLowerCase() === 'zipcode' ? 'postalCode' : 
                           canonicalField.toLowerCase();
          autoDetectedGroups[prefix].fieldMappings[canonical] = field.id;
          addressFieldIdsToFilter.add(field.id);
        }
      });
    });
    
    const addressGroups = Object.values(autoDetectedGroups);
    console.log('📍 Auto-detected address groups:', addressGroups);
    console.log('📍 Address field IDs to filter out:', Array.from(addressFieldIdsToFilter));
    
    // Auto-detect signature groups from field naming patterns
    // Pattern: {prefix}_signature_{role}.{fieldType} where fieldType is signerName/signature/initials/email/dateSigned
    const autoDetectedSignatureGroups: Record<string, any> = {};
    const signatureFieldIdsToFilter = new Set<string>();
    const signatureGroupPositions: Record<string, { sectionTitle: string, position: number }> = {};
    
    // First pass: detect signature group prefixes and track their positions
    template.fieldConfiguration.sections.forEach((section: any) => {
      section.fields.forEach((field: any, fieldIndex: number) => {
        const match = field.id?.match(/^(.+)_signature_([^.]+)\.(signerName|signature|initials|email|dateSigned)$/i);
        if (match) {
          const [, prefix, role, fieldType] = match;
          const groupKey = `${prefix}_signature_${role}`;
          
          if (!autoDetectedSignatureGroups[groupKey]) {
            autoDetectedSignatureGroups[groupKey] = {
              roleKey: role,
              label: field.label?.split('.')[0] || `${role} Signature`,
              sectionName: section.title,
              fieldMappings: {}
            };
            // Track the position of the first field in this signature group
            signatureGroupPositions[groupKey] = {
              sectionTitle: section.title,
              position: fieldIndex
            };
          }
          
          // Map field types to field IDs
          autoDetectedSignatureGroups[groupKey].fieldMappings[fieldType.toLowerCase()] = field.id;
          signatureFieldIdsToFilter.add(field.id);
        }
      });
    });
    
    const signatureGroups = Object.values(autoDetectedSignatureGroups);
    console.log('✍️ Auto-detected signature groups:', signatureGroups);
    console.log('✍️ Signature field IDs to filter out:', Array.from(signatureFieldIdsToFilter));
    
    return template.fieldConfiguration.sections.map((section: any, sectionIndex: number) => {
      console.log(`📍 Processing section: ${section.title}, fields before filter:`, section.fields.length);
      
      // Filter out individual address and signature fields that are part of groups
      const filteredFields = section.fields.filter((field: any) => {
        // Check if this field's ID is in the address or signature group mappings
        const isAddressField = addressFieldIdsToFilter.has(field.id);
        const isSignatureField = signatureFieldIdsToFilter.has(field.id);
        const shouldFilter = isAddressField || isSignatureField;
        if (shouldFilter) {
          console.log(`📍 Filtering out field: ${field.id} (${field.label}) - ${isAddressField ? 'address' : 'signature'} group`);
        }
        return !shouldFilter;
      });
      
      console.log(`📍 Section ${section.title}: ${filteredFields.length} fields after filtering`);
      
      // Add address group pseudo-fields at their original positions
      const fieldsWithGroups = [...filteredFields];
      if (addressGroups.length > 0) {
        // Build a list of address groups for this section with their original positions
        const groupsForSection: Array<{ group: any, originalPosition: number }> = [];
        
        Object.entries(autoDetectedGroups).forEach(([prefix, group]) => {
          const posInfo = addressGroupPositions[prefix];
          
          // Check if this is an owner address group (owner1, owner2, etc.)
          // Prefix format can be like "owner1_mailing_address" or "owners_owner2_address"
          const ownerMatch = prefix.match(/(?:owners_)?owner(\d+)/);
          if (ownerMatch) {
            const ownerNumber = parseInt(ownerMatch[1]);
            // Only include this owner if it's in the active slots
            if (!activeOwnerSlots.has(ownerNumber)) {
              console.log(`📍 Skipping inactive owner address group: ${prefix}`);
              return; // Skip this owner slot
            }
          }
          
          if (posInfo && posInfo.sectionTitle === section.title) {
            groupsForSection.push({
              group,
              originalPosition: posInfo.position
            });
          }
        });
        
        // Sort by original position (ascending) - groups with lower positions come first
        groupsForSection.sort((a, b) => a.originalPosition - b.originalPosition);
        
        // Insert each group in order, adjusting position for previously inserted groups
        let insertionOffset = 0;
        groupsForSection.forEach(({ group, originalPosition }) => {
          // Calculate insertion position: count non-address fields before this group's original position
          let insertPosition = 0;
          for (let i = 0; i < originalPosition; i++) {
            const fieldId = section.fields[i]?.id;
            if (fieldId && !addressFieldIdsToFilter.has(fieldId)) {
              insertPosition++;
            }
          }
          
          // Add the offset from previously inserted groups
          const finalPosition = insertPosition + insertionOffset;
          
          console.log(`📍 Inserting addressGroup "${group.label}" at position ${finalPosition} (original: ${originalPosition}, offset: ${insertionOffset}) in section "${section.title}"`);
          
          fieldsWithGroups.splice(finalPosition, 0, {
            id: `addressGroup_${group.type}`,
            label: group.label || `${group.type.charAt(0).toUpperCase() + group.type.slice(1)} Address`,
            type: 'addressGroup',
            addressGroupConfig: group,
          });
          
          // Increment offset since we just added a group
          insertionOffset++;
        });
      }
      
      // Add signature group pseudo-fields at their original positions
      if (signatureGroups.length > 0) {
        // Build a list of signature groups for this section with their original positions
        const sigGroupsForSection: Array<{ group: any, originalPosition: number, groupKey: string }> = [];
        
        Object.entries(autoDetectedSignatureGroups).forEach(([groupKey, group]) => {
          const posInfo = signatureGroupPositions[groupKey];
          
          // Check if this is an owner signature group (owner1, owner2, etc.)
          // GroupKey format is like "owners_owner1_signature_owner", so we match the number after "owner"
          const ownerMatch = groupKey.match(/owner(\d+)_signature_owner$/);
          if (ownerMatch) {
            const ownerNumber = parseInt(ownerMatch[1]);
            // Only include this owner if it's in the active slots
            if (!activeOwnerSlots.has(ownerNumber)) {
              console.log(`✍️ Skipping inactive owner slot: ${groupKey}`);
              return; // Skip this owner slot
            }
          }
          
          // Only include groups that belong to this section
          if (posInfo && posInfo.sectionTitle === section.title) {
            sigGroupsForSection.push({
              group,
              originalPosition: posInfo.position,
              groupKey
            });
          }
        });
        
        // Only proceed if there are signature groups in this section
        if (sigGroupsForSection.length > 0) {
          // Sort by original position (ascending) - groups with lower positions come first
          sigGroupsForSection.sort((a, b) => a.originalPosition - b.originalPosition);
          
          // Track how many signature groups we've inserted so far
          let sigGroupsInsertedSoFar = 0;
          
          sigGroupsForSection.forEach(({ group, originalPosition, groupKey }) => {
            // Calculate insertion position: count non-grouped fields before this group's original position
            let insertPosition = 0;
            for (let i = 0; i < originalPosition; i++) {
              const fieldId = section.fields[i]?.id;
              if (fieldId && !addressFieldIdsToFilter.has(fieldId) && !signatureFieldIdsToFilter.has(fieldId)) {
                insertPosition++;
              }
            }
            
            // Count how many ADDRESS groups appear BEFORE this signature group's original position
            let addressGroupsBeforeThis = 0;
            Object.entries(autoDetectedGroups).forEach(([prefix, addrGroup]) => {
              const addrPosInfo = addressGroupPositions[prefix];
              if (addrPosInfo && addrPosInfo.sectionTitle === section.title && addrPosInfo.position < originalPosition) {
                addressGroupsBeforeThis++;
              }
            });
            
            // Add the offset from address groups that appear before this signature group
            // AND signature groups we've already inserted (to account for previously inserted groups)
            const finalPosition = insertPosition + addressGroupsBeforeThis + sigGroupsInsertedSoFar;
            
            console.log(`✍️ Inserting signatureGroup "${groupKey}" at position ${finalPosition} (original: ${originalPosition}, addressBefore: ${addressGroupsBeforeThis}, sigBefore: ${sigGroupsInsertedSoFar}) in section "${section.title}"`);
            
            // Enrich the signature group config with metadata for downstream rendering
            const enrichedConfig = {
              ...group,
              groupKey, // Unique identifier for this signature group
              prefix: groupKey.split('_signature_')[0], // Extract prefix (e.g., merchantInformation)
              sectionName: section.title,
            };
            
            fieldsWithGroups.splice(finalPosition, 0, {
              id: `signatureGroup_${groupKey}`, // Unique ID using full groupKey
              label: group.label || `${group.roleKey} Signature`,
              type: 'signatureGroup',
              signatureGroupConfig: enrichedConfig,
            });
            
            // Increment counter since we just added a signature group
            sigGroupsInsertedSoFar++;
          });
        }
      }
      
      console.log(`📍 Section ${section.title}: ${fieldsWithGroups.length} fields total (with address & signature groups)`);
      
      return {
        name: section.title,
        description: section.description || '',
        icon: iconMap[section.title] || FileText,
        fields: fieldsWithGroups.map((field: any, fieldIndex: number) => ({
          id: sectionIndex * 100 + fieldIndex,
          fieldName: field.id,
          fieldType: field.type,
          fieldLabel: field.label,
          isRequired: requiredFieldNames.includes(field.id),
          options: field.options || null,
          defaultValue: null,
          validation: field.pattern || null,
          position: sectionIndex * 100 + fieldIndex,
          section: section.title,
          description: field.description || null,
          placeholder: field.placeholder || null,
          addressGroupConfig: field.addressGroupConfig || null,
          signatureGroupConfig: field.signatureGroupConfig || null,
        }))
      };
    });
  };

  // Create enhanced sections with descriptions and icons
  let sections: FormSection[] = [];
  
  if (isPreviewMode && previewTemplate) {
    // Preview mode: use template configuration
    sections = createSectionsFromTemplate(previewTemplate);
  } else if (isProspectMode) {
    // Use template fields if available, otherwise use hardcoded sections
    if (prospectData?.applicationTemplate) {
      sections = createSectionsFromTemplate(prospectData.applicationTemplate);
    } else {
      sections = createProspectFormSections();
    }
  } else if (pdfForm?.fields) {
    sections = [
      {
        name: 'Form Fields',
        description: 'Complete all required fields',
        icon: FileText,
        fields: pdfForm.fields.sort((a, b) => a.position - b.position)
      }
    ];
  }

  // Function to evaluate if a field should be visible based on conditional rules
  const shouldShowField = (fieldId: string): boolean => {
    // Get the active template (preview or prospect mode)
    const activeTemplate = isPreviewMode ? previewTemplate : prospectData?.applicationTemplate;
    
    if (!activeTemplate) {
      return true; // Show all fields if no template
    }

    // Filter owner fields based on active owner slots
    // Check if this field belongs to an owner (owner1_, owner2_, owners_owner1_, owners_owner2_, etc.)
    const ownerFieldMatch = fieldId.match(/^(?:owners_)?owner(\d+)_/);
    if (ownerFieldMatch) {
      const ownerNumber = parseInt(ownerFieldMatch[1]);
      // Only show if this owner number is in the active slots
      if (!activeOwnerSlots.has(ownerNumber)) {
        return false;
      }
    }

    let finalVisibility = true;

    // Check field-level conditional rules
    const conditionalFields = activeTemplate.conditionalFields;
    if (conditionalFields && conditionalFields[fieldId]) {
      const fieldCondition = conditionalFields[fieldId];
      const { action, when } = fieldCondition;
      
      if (when && when.field) {
        const dependentFieldValue = formData[when.field];
        let conditionMet = false;

        // Evaluate the condition based on operator (handle both single values and arrays)
        switch (when.operator) {
          case 'equals':
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = dependentFieldValue.includes(when.value);
            } else {
              conditionMet = dependentFieldValue === when.value;
            }
            break;
          case 'not_equals':
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = !dependentFieldValue.includes(when.value);
            } else {
              conditionMet = dependentFieldValue !== when.value;
            }
            break;
          case 'contains':
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = dependentFieldValue.some(val => String(val).includes(when.value));
            } else {
              conditionMet = dependentFieldValue && String(dependentFieldValue).includes(when.value);
            }
            break;
          case 'is_checked':
            // For boolean/checkbox fields
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = dependentFieldValue.length > 0;
            } else {
              conditionMet = dependentFieldValue === true || dependentFieldValue === 'true' || dependentFieldValue === 'yes' || dependentFieldValue === 'Yes';
            }
            break;
          case 'is_not_checked':
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = dependentFieldValue.length === 0;
            } else {
              conditionMet = !dependentFieldValue || dependentFieldValue === false || dependentFieldValue === 'false' || dependentFieldValue === 'no' || dependentFieldValue === 'No';
            }
            break;
          case 'is_not_empty':
            // Check if field has any value (not null, undefined, or empty string)
            if (Array.isArray(dependentFieldValue)) {
              conditionMet = dependentFieldValue.length > 0;
            } else {
              conditionMet = dependentFieldValue !== null && 
                           dependentFieldValue !== undefined && 
                           dependentFieldValue !== '' &&
                           String(dependentFieldValue).trim() !== '';
            }
            break;
          default:
            conditionMet = false;
        }

        // Update visibility based on action and whether condition is met
        if (action === 'show') {
          finalVisibility = conditionMet; // Show only when condition is met
        } else {
          finalVisibility = !conditionMet; // Hide when condition is met
        }
      }
    }

    // Check option-level conditional rules from all fields
    const fieldConfiguration = activeTemplate.fieldConfiguration;
    if (fieldConfiguration?.sections) {
      for (const section of fieldConfiguration.sections) {
        for (const field of section.fields) {
          // Check if this field has options with conditionals
          if (field.options && Array.isArray(field.options)) {
            for (const option of field.options) {
              // Check if option has a conditional targeting our fieldId
              if (option.conditional && option.conditional.targetField === fieldId) {
                const selectedValue = formData[field.id];
                // Handle both single values (radio, select) and arrays (checkbox)
                const isOptionSelected = Array.isArray(selectedValue) 
                  ? selectedValue.includes(option.value)
                  : selectedValue === option.value;
                
                if (isOptionSelected) {
                  // This option is selected and has a conditional for our field
                  if (option.conditional.action === 'show') {
                    finalVisibility = true;
                  } else if (option.conditional.action === 'hide') {
                    finalVisibility = false;
                  }
                }
              }
            }
          }
        }
      }
    }

    return finalVisibility;
  };

  // Filter fields based on conditional visibility
  const filteredSections = sections.map(section => ({
    ...section,
    fields: section.fields.filter(field => shouldShowField(field.fieldName))
  }));

  // Add agent signature section if all owner signatures are collected
  if (isProspectMode) {
    const owners = formData.owners || [];
    const ownersNeedingSignatures = owners.filter((owner: any) => parseFloat(owner.percentage || 0) >= 25);
    const allOwnersSigned = ownersNeedingSignatures.length > 0 && ownersNeedingSignatures.every((owner: any) => owner.signature);
    
    if (allOwnersSigned) {
      filteredSections.push({
        name: 'Agent Signature',
        description: 'Final approval signature from assigned agent',
        icon: Signature,
        fields: [
          { 
            id: 9999, 
            fieldName: 'agentSignature', 
            fieldType: 'agent-signature', 
            fieldLabel: 'Agent Signature', 
            isRequired: true, 
            options: null, 
            defaultValue: null, 
            validation: null, 
            position: 9999, 
            section: 'Agent Signature' 
          },
        ]
      });
    }
  }

  // Fetch address suggestions using Google Places Autocomplete API
  const fetchAddressSuggestions = async (input: string) => {
    console.log('🌐 fetchAddressSuggestions CALLED with input:', input, 'length:', input.length);
    
    if (input.length < 4) {
      console.log('❌ Input too short, aborting');
      setAddressSuggestions([]);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
      return;
    }

    console.log('✨ Fetching suggestions from API...');
    setIsLoadingSuggestions(true);
    
    try {
      const response = await fetch('/api/address-autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input }),
      });
      
      console.log('📡 API Response status:', response.status, response.ok);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ API Success! Received suggestions:', result.suggestions?.length || 0, result);
        setAddressSuggestions(result.suggestions || []);
        setShowSuggestions(true);
        setSelectedSuggestionIndex(-1);
        console.log('🎯 State updated - showSuggestions:', true, 'suggestions count:', result.suggestions?.length);
      } else {
        console.error('❌ Address suggestions API error:', response.status);
      }
    } catch (error) {
      console.error('💥 Address suggestions network error:', error);
    } finally {
      setIsLoadingSuggestions(false);
      console.log('🏁 Fetch complete, loading state set to false');
    }
  };

  // Track current address field being edited for smart field population
  const [currentAddressField, setCurrentAddressField] = useState<string | null>(null);

  // Select address suggestion and validate
  const selectAddressSuggestion = async (suggestion: any) => {
    console.log('🚀🚀🚀 SELECT ADDRESS SUGGESTION FUNCTION CALLED! 🚀🚀🚀');
    console.log('Suggestion received:', suggestion);
    
    const mainText = suggestion.structured_formatting?.main_text || suggestion.description.split(',')[0];
    
    console.log('Selecting address suggestion:', suggestion);
    console.log('Previous form data before selection:', formData);
    console.log('Current address field being edited:', currentAddressField);
    
    // Hide suggestions immediately
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    
    // Set addressOverrideActive to prevent browser cache interference
    setAddressOverrideActive(true);
    
    // Find the actual field names from the current section instead of constructing them
    const currentFields = filteredSections[currentStep]?.fields || [];
    
    console.log('🔍 DEBUG: Current step:', currentStep);
    console.log('🔍 DEBUG: Total sections:', filteredSections.length);
    console.log('🔍 DEBUG: Current section name:', filteredSections[currentStep]?.name);
    console.log('🔍 DEBUG: All field names in current section:', currentFields.map(f => f.fieldName));
    
    // Find the actual address, city, state, and zipCode field names from the form definition
    const addressField = currentFields.find(f => f.fieldName.toLowerCase().includes('address') && !f.fieldName.toLowerCase().includes('line2'));
    const cityField = currentFields.find(f => f.fieldName.toLowerCase().includes('city'));
    const stateField = currentFields.find(f => f.fieldName.toLowerCase().includes('state') && !f.fieldName.toLowerCase().includes('filed'));
    const zipField = currentFields.find(f => f.fieldName.toLowerCase().includes('zip'));
    
    console.log('🔍 DEBUG: Field lookup results:', {
      addressField: addressField?.fieldName,
      cityField: cityField?.fieldName,
      stateField: stateField?.fieldName,
      zipField: zipField?.fieldName
    });
    
    const addressFieldName = addressField?.fieldName || 'address';
    const cityFieldName = cityField?.fieldName || 'city';
    const stateFieldName = stateField?.fieldName || 'state';
    const zipCodeFieldName = zipField?.fieldName || 'zipCode';
    
    console.log('✅ Final field names to populate:', {
      address: addressFieldName,
      city: cityFieldName,
      state: stateFieldName,
      zipCode: zipCodeFieldName
    });
    
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
        console.log('Address validation result:', result);
        
        if (result.isValid) {
          setAddressValidationStatus('valid');
          
          console.log('API returned validated address data:', {
            streetAddress: result.streetAddress,
            city: result.city,
            state: result.state,
            zipCode: result.zipCode
          });
          
          console.log('Will populate these actual form fields:', {
            address: addressFieldName,
            city: cityFieldName,
            state: stateFieldName,
            zipCode: zipCodeFieldName
          });
          
          // Create final validated address data - this OVERWRITES any previous data
          const overwrittenFormData = {
            ...formData,  // Keep all existing form data
            [addressFieldName]: result.streetAddress || mainText,  // OVERWRITE address
            [cityFieldName]: result.city || '',                     // OVERWRITE city
            [stateFieldName]: result.state || '',                   // OVERWRITE state
            [zipCodeFieldName]: result.zipCode || ''                // OVERWRITE zipCode
          };
          
          console.log('Form Data BEFORE update:', formData);
          console.log('Form Data AFTER construction:', overwrittenFormData);
          console.log('New field values being set:', {
            [addressFieldName]: overwrittenFormData[addressFieldName],
            [cityFieldName]: overwrittenFormData[cityFieldName],
            [stateFieldName]: overwrittenFormData[stateFieldName],
            [zipCodeFieldName]: overwrittenFormData[zipCodeFieldName]
          });
          
          // IMMEDIATELY update form data with the new address - this overwrites any previous data
          setFormData(overwrittenFormData);
          console.log('✓ setFormData called with updated address fields');
          
          // Clear browser cache and storage that might interfere
          const addressKeys = ['address', 'city', 'state', 'zipCode'];
          addressKeys.forEach(key => {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
          });
          
          // IMMEDIATELY save to database to ensure persistence and overwrite previous data
          if (isProspectMode && prospectData?.prospect) {
            console.log('Saving overwritten form data to database:', overwrittenFormData);
            
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
              
              if (saveResponse.ok) {
                const saveResult = await saveResponse.json();
                console.log('Database save successful:', saveResult);
              } else {
                console.error('Database save failed:', saveResponse.status);
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
            
            console.log('Force updating DOM fields with validated address data...');
            console.log('Forcing fields to show:', {
              streetAddress: result.streetAddress,
              city: result.city,
              state: result.state,
              zipCode: result.zipCode
            });
            
            if (addressField && result.streetAddress) {
              addressField.value = result.streetAddress;
              addressField.dispatchEvent(new Event('input', { bubbles: true }));
              addressField.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('Force set address field to:', result.streetAddress);
            }
            if (cityField && result.city) {
              cityField.value = result.city;
              cityField.dispatchEvent(new Event('input', { bubbles: true }));
              cityField.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('Force set city field to:', result.city);
            }
            if (stateField && result.state) {
              stateField.value = result.state;
              stateField.dispatchEvent(new Event('change', { bubbles: true }));
              stateField.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('Force set state field to:', result.state);
            }
            if (zipField && result.zipCode) {
              zipField.value = result.zipCode;
              zipField.dispatchEvent(new Event('input', { bubbles: true }));
              zipField.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('Force set zip field to:', result.zipCode);
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
    // Check if this is a city, state, or zipCode field (with any prefix)
    const isCityField = fieldName.endsWith('City');
    const isStateField = fieldName.endsWith('State');
    const isZipCodeField = fieldName.endsWith('ZipCode') || fieldName.endsWith('zipCode');
    
    // Prevent address field changes if addressOverrideActive and fields are locked
    if (addressOverrideActive && addressFieldsLocked && 
        (isCityField || isStateField || isZipCodeField)) {
      console.log(`Blocking change to ${fieldName} due to address override protection`);
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
    const currentField = filteredSections[currentStep]?.fields.find(f => f.fieldName === fieldName);
    if (currentField) {
      const error = validateField(currentField, value);
      setValidationErrors(prev => ({
        ...prev,
        [fieldName]: error
      }));
    }
    
    // Track field interaction for prospect status update
    handleFieldInteraction(fieldName, value);
    
    // Trigger address autocomplete for any field ending with "Address"
    const isAddressField = fieldName.endsWith('Address');
    console.log('🔍 Field change detected:', fieldName, 'isAddressField:', isAddressField, 'value length:', value?.length);
    if (isAddressField) {
      console.log('✅ This is an address field! fieldName:', fieldName);
      // Track which address field is being edited for smart population
      setCurrentAddressField(fieldName);
      
      // Extract field prefix to determine which city/state/zip fields to clear
      const match = fieldName.match(/^(.+?)Address$/);
      const fieldPrefix = match ? match[1] : '';
      const cityFieldName = fieldPrefix ? `${fieldPrefix}City` : 'city';
      const stateFieldName = fieldPrefix ? `${fieldPrefix}State` : 'state';
      const zipCodeFieldName = fieldPrefix ? `${fieldPrefix}ZipCode` : 'zipCode';
      
      // If user starts typing in a locked address field, unlock it for new selection
      if (addressFieldsLocked && value !== formData[fieldName]) {
        console.log('User typing new address - unlocking fields for new selection');
        setAddressFieldsLocked(false);
        setAddressOverrideActive(false);
        setAddressValidationStatus('idle');
      }
      
      setAddressValidationStatus('idle');
      // Clear city, state, zip when manually typing new address (if not locked or being unlocked)
      if (value && value.length >= 4) {
        console.log('📞 Calling fetchAddressSuggestions with value:', value, 'length:', value.length);
        fetchAddressSuggestions(value);
      } else {
        console.log('⏸️ NOT calling fetchAddressSuggestions - value length too short:', value?.length);
        setShowSuggestions(false);
        setAddressSuggestions([]);
        setSelectedSuggestionIndex(-1);
        // Only clear address-related fields when completely empty (not just short)
        if (value.length === 0 && !addressFieldsLocked) {
          console.log('Address field completely cleared - clearing dependent fields');
          const clearedFormData = { ...newFormData };
          clearedFormData[cityFieldName] = '';
          clearedFormData[stateFieldName] = '';
          clearedFormData[zipCodeFieldName] = '';
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

    // Validate expiration dates are in the future
    if (field.fieldType === 'date' && value) {
      const fieldNameLower = field.fieldName.toLowerCase();
      const isExpirationDate = fieldNameLower.includes('exp') || 
                              fieldNameLower.includes('expiration');
      
      if (isExpirationDate) {
        const enteredDate = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to start of day for fair comparison
        
        if (enteredDate < today) {
          return 'Expiration date must be in the future';
        }
      }
    }

    return null;
  };

  // For preview mode, show loading if template data isn't loaded yet
  if (isPreviewMode && !previewTemplate) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading template preview...</p>
        </div>
      </div>
    );
  }

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

  // For authenticated mode (not preview or prospect), show loading and error states for PDF form
  if (!isProspectMode && !isPreviewMode) {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading form...</p>
          </div>
        </div>
      );
    }

    if (error || !pdfForm) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 mb-4">Failed to load form</p>
            <Button onClick={() => setLocation('/pdf-forms')}>Back to Forms</Button>
          </div>
        </div>
      );
    }
  }

  // Helper function to detect if a field is an agent field
  const isAgentField = (fieldName: string): boolean => {
    const lowerFieldName = fieldName.toLowerCase();
    return lowerFieldName.includes('agent') || 
           lowerFieldName === 'salesrep' || 
           lowerFieldName === 'sales_rep' ||
           lowerFieldName === 'representative';
  };

  // Get agent name for pre-population
  const getAgentName = (): string => {
    if (!prospectData?.agent) return '';
    return `${prospectData.agent.firstName} ${prospectData.agent.lastName}`;
  };

  // Helper to check if field is read-only
  const isFieldReadOnly = (fieldName: string): boolean => {
    const isAgent = isProspectMode && isAgentField(fieldName);
    const isCityField = fieldName.endsWith('City');
    const isZipCodeField = fieldName.endsWith('ZipCode') || fieldName.endsWith('zipCode');
    return (isProspectMode && (fieldName === 'companyEmail' || isAgent)) ||
           (addressFieldsLocked && (isCityField || isZipCodeField));
  };

  // Render form field based on type
  const renderField = (field: FormField, fieldIndex: number = 0) => {
    // Check if this is an agent field in prospect mode
    const isAgentFieldInProspectMode = isProspectMode && isAgentField(field.fieldName);
    const agentName = isAgentFieldInProspectMode ? getAgentName() : '';
    
    // Use agent name if this is an agent field, otherwise use existing value
    const value = isAgentFieldInProspectMode && agentName ? agentName : (formData[field.fieldName] || '');
    const hasError = validationErrors[field.fieldName];
    
    // Determine if field is read-only
    const isReadOnly = isFieldReadOnly(field.fieldName);
    
    // Auto-focus first editable field on initial render only
    const currentFields = filteredSections[currentStep]?.fields || [];
    const firstEditableIndex = currentFields.findIndex(f => !isFieldReadOnly(f.fieldName));
    const shouldAutoFocus = isInitialRender && fieldIndex === firstEditableIndex && firstEditableIndex >= 0;

    switch (field.fieldType) {
      case 'text':
      case 'email':
        return (
          <div className="space-y-2 relative">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
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
                  isProspectMode && (field.fieldName === 'companyEmail' || isAgentFieldInProspectMode) ? 'bg-gray-50 cursor-not-allowed' : ''
                } ${
                  field.fieldName === 'address' && addressValidationStatus === 'valid' ? 'border-green-500' : ''
                } ${
                  field.fieldName === 'address' && addressValidationStatus === 'invalid' ? 'border-red-500' : ''
                } ${
                  addressFieldsLocked && (field.fieldName === 'city' || field.fieldName === 'zipCode') ? 'bg-gray-50 cursor-not-allowed' : ''
                }`}
                placeholder={field.placeholder || 
                            (field.fieldType === 'email' ? 'Enter email address' : 
                            field.fieldType === 'phone' ? 'Enter phone number' : 
                            field.fieldName === 'address' ? 'Enter street address (e.g., 123 Main St)' :
                            field.fieldName === 'addressLine2' ? 'Suite, apt, floor, etc. (optional)' :
                            (field.fieldName === 'federalTaxId' || field.fieldName === 'taxId') ? 'Enter 9-digit EIN (will format as XX-XXXXXXX)' :
                            ['monthlyVolume', 'averageTicket', 'highestTicket', 'avgMonthlyVolume', 'avgTicketAmount', 'highestTicketAmount'].includes(field.fieldName) ? 
                              `Enter amount (e.g., 10000.00)` :
                            `Enter ${field.fieldLabel.toLowerCase()}`)}
                readOnly={isReadOnly}
                tabIndex={isReadOnly ? -1 : undefined}
                autoFocus={shouldAutoFocus}
                data-testid={`input-${field.fieldName}`}
              />
              
              {/* Address autocomplete suggestions */}
              {field.fieldName.endsWith('Address') && showSuggestions && currentAddressField === field.fieldName && (
                <div className="absolute z-[9999] w-full mt-1 bg-white border-4 border-blue-600 rounded-md shadow-2xl max-h-60 overflow-auto" style={{ border: '4px solid #0000FF', backgroundColor: '#FFFFFF' }}>
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
                          console.log('👇 Suggestion mousedown! Selecting:', suggestion.description);
                          e.preventDefault();
                          e.stopPropagation();
                          selectAddressSuggestion(suggestion);
                        }}
                        onMouseEnter={() => setSelectedSuggestionIndex(index)}
                        data-testid={`suggestion-${index}`}
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
              
              {field.fieldName.endsWith('Address') && (addressValidationStatus === 'validating' || isLoadingSuggestions) && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              )}
              {field.fieldName.endsWith('Address') && addressValidationStatus === 'valid' && !isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-600">
                  ✓
                </div>
              )}
              {field.fieldName.endsWith('Address') && addressValidationStatus === 'invalid' && !isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-red-600">
                  ⚠
                </div>
              )}
            </div>
            {field.fieldName.endsWith('Address') && addressValidationStatus === 'valid' && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-green-600">✓ Address validated and locked. Edit Address</p>
                {addressFieldsLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddressFieldsLocked(false);
                      setAddressValidationStatus('idle');
                      setAddressOverrideActive(false);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                    data-testid="button-edit-address"
                  >
                    Edit Address
                  </button>
                )}
              </div>
            )}
            {field.fieldName.endsWith('Address') && addressValidationStatus === 'invalid' && (
              <p className="text-xs text-red-600">⚠ Please enter a valid address</p>
            )}
            {addressFieldsLocked && (field.fieldName.endsWith('City') || field.fieldName.endsWith('State') || field.fieldName.endsWith('ZipCode') || field.fieldName.endsWith('zipCode')) && (
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
            {isAgentFieldInProspectMode && agentName && (
              <p className="text-xs text-gray-500">✓ Auto-populated from assigned agent</p>
            )}
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'select':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <Select value={value} onValueChange={(value) => handleFieldChange(field.fieldName, value)}>
              <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                <SelectValue placeholder={`Select ${field.fieldLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'radio':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <RadioGroup value={value} onValueChange={(value) => handleFieldChange(field.fieldName, value)}>
              {field.options?.map((option: any) => {
                const optionValue = typeof option === 'string' ? option : option.value;
                const optionLabel = typeof option === 'string' ? option : option.label;
                
                return (
                  <div key={optionValue} className="flex items-center space-x-2">
                    <RadioGroupItem
                      value={optionValue}
                      id={`${field.fieldName}-${optionValue}`}
                      data-testid={`radio-${field.fieldName}-${optionValue}`}
                    />
                    <Label
                      htmlFor={`${field.fieldName}-${optionValue}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {optionLabel}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'boolean':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <RadioGroup value={value} onValueChange={(value) => handleFieldChange(field.fieldName, value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="yes"
                  id={`${field.fieldName}-yes`}
                  data-testid={`radio-${field.fieldName}-yes`}
                />
                <Label
                  htmlFor={`${field.fieldName}-yes`}
                  className="text-sm font-normal cursor-pointer"
                >
                  Yes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="no"
                  id={`${field.fieldName}-no`}
                  data-testid={`radio-${field.fieldName}-no`}
                />
                <Label
                  htmlFor={`${field.fieldName}-no`}
                  className="text-sm font-normal cursor-pointer"
                >
                  No
                </Label>
              </div>
            </RadioGroup>
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'textarea':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <Textarea
              id={field.fieldName}
              value={value}
              onChange={(e) => handleFieldChange(field.fieldName, e.target.value)}
              className={hasError ? 'border-red-500' : ''}
              placeholder={field.placeholder || `Enter ${field.fieldLabel.toLowerCase()}`}
              rows={3}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'mcc-select':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <MCCSelect
              value={value}
              onValueChange={(value) => handleFieldChange(field.fieldName, value)}
              placeholder="Select your business category"
              required={field.isRequired}
              className={hasError ? 'border-red-500' : ''}
            />
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
              placeholder={field.placeholder || 
                (['monthlyVolume', 'averageTicket', 'highestTicket', 'avgMonthlyVolume', 'avgTicketAmount', 'highestTicketAmount'].includes(field.fieldName) ? 
                `Enter amount (e.g., 10000.00)` : 
                `Enter ${field.fieldLabel.toLowerCase()}`)}
            />
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
            <div className="relative">
              <Input
                id={field.fieldName}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={value}
                onChange={(e) => {
                  const val = e.target.value;
                  // Allow empty or valid percentage values
                  if (val === '' || (parseFloat(val) >= 0 && parseFloat(val) <= 100)) {
                    handleFieldChange(field.fieldName, val);
                  }
                }}
                className={`pr-8 ${hasError ? 'border-red-500' : ''}`}
                placeholder={field.placeholder || "Enter percentage (0-100)"}
                data-testid={`input-${field.fieldName}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">
                %
              </span>
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
            <Input
              id={field.fieldName}
              type="text"
              value={value}
              onChange={(e) => {
                let val = e.target.value.replace(/\D/g, ''); // Remove non-digits
                if (val.length > 9) val = val.slice(0, 9); // Limit to 9 digits
                
                // Format as XXX-XX-XXXX
                let formatted = val;
                if (val.length > 5) {
                  formatted = `${val.slice(0, 3)}-${val.slice(3, 5)}-${val.slice(5)}`;
                } else if (val.length > 3) {
                  formatted = `${val.slice(0, 3)}-${val.slice(3)}`;
                }
                
                handleFieldChange(field.fieldName, formatted);
              }}
              className={hasError ? 'border-red-500' : ''}
              placeholder="XXX-XX-XXXX"
              maxLength={11}
              data-testid={`input-${field.fieldName}`}
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
        console.log('Campaign object:', campaign);
        console.log('Campaign pricingType:', campaign.pricingType);

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
        console.log('Equipment section - campaignEquipmentForSelection:', campaignEquipmentForSelection);
        
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
                console.log(`Auto-saved owner ${index + 1} data after ${field} entry`);
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
                                    console.log(`Inline signature saved to database for ${owner.name}`);
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
                                      console.log(`Signature request sent to ${owner.email}`);
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

      case 'agent-signature':
        const agentSignature = formData.agentSignature;
        const agentSignatureType = formData.agentSignatureType;
        const assignedAgentName = prospectData?.agent ? `${prospectData.agent.firstName} ${prospectData.agent.lastName}` : '';

        return (
          <div className="space-y-4">
            <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3 mb-4">
                <Signature className="w-6 h-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold text-blue-900">Agent Final Approval</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    All owner signatures have been collected. As the assigned agent, your signature is required to complete this application.
                  </p>
                </div>
              </div>
              
              <div className="mb-4 p-3 bg-white rounded border border-blue-100">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Assigned Agent:</span> {assignedAgentName}
                </p>
              </div>

              {agentSignature ? (
                <div className="space-y-3">
                  <div className="p-4 bg-white rounded border border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-green-700">Signature Captured</span>
                      <Check className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 flex items-center justify-center min-h-[80px]">
                      {agentSignatureType === 'canvas' ? (
                        <img src={agentSignature} alt="Agent signature" className="max-h-16" />
                      ) : (
                        <span className="text-2xl font-signature">{agentSignature}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleFieldChange('agentSignature', null);
                      handleFieldChange('agentSignatureType', null);
                    }}
                    className="w-full"
                    data-testid="button-clear-agent-signature"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Clear and Re-sign
                  </Button>
                </div>
              ) : (
                <DigitalSignaturePad
                  ownerIndex={-1}
                  owner={{ name: assignedAgentName }}
                  onSignatureChange={async (_, signature, type) => {
                    handleFieldChange('agentSignature', signature);
                    handleFieldChange('agentSignatureType', type);
                    
                    // Save agent signature to database
                    if (signature && type && prospectData?.prospect?.id) {
                      try {
                        const response = await fetch(`/api/prospects/${prospectData.prospect.id}/agent-signature`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            agentSignature: signature,
                            agentSignatureType: type,
                          }),
                        });
                        
                        if (!response.ok) {
                          toast({
                            title: 'Error',
                            description: 'Failed to save agent signature',
                            variant: 'destructive'
                          });
                        }
                      } catch (error) {
                        console.error('Error saving agent signature:', error);
                      }
                    }
                  }}
                />
              )}
            </div>
          </div>
        );

      case 'phone':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
                {field.fieldLabel}
                {field.isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{field.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <PhoneNumberInput
              value={value}
              onChange={(value) => handleFieldChange(field.fieldName, value)}
              placeholder="(555) 555-5555"
              dataTestId={`input-${field.fieldName}`}
              className={hasError ? 'border-red-500' : ''}
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
            <EINInput
              value={value}
              onChange={(value) => handleFieldChange(field.fieldName, value)}
              placeholder="12-3456789"
              dataTestId={`input-${field.fieldName}`}
              className={hasError ? 'border-red-500' : ''}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'address':
        return (
          <div className="space-y-2">
            <Label htmlFor={field.fieldName} className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <AddressAutocompleteInput
              value={value}
              onChange={(value) => handleFieldChange(field.fieldName, value)}
              onAddressSelect={(address) => {
                // Try to find related city, state, zipCode fields based on naming patterns
                // Examples: businessAddress -> businessCity, businessState, businessZipCode
                //           mailingAddress -> mailingCity, mailingState, mailingZipCode
                //           address -> city, state, zipCode (fallback)
                
                const baseFieldName = field.fieldName
                  .replace(/address/i, '')
                  .replace(/street/i, '')
                  .replace(/Address/g, '')
                  .replace(/Street/g, '');
                
                // Generate possible field name variations
                const possibleCityFields = [
                  `${baseFieldName}city`,
                  `${baseFieldName}City`,
                  'city'
                ];
                const possibleStateFields = [
                  `${baseFieldName}state`,
                  `${baseFieldName}State`,
                  'state'
                ];
                const possibleZipFields = [
                  `${baseFieldName}zipCode`,
                  `${baseFieldName}ZipCode`,
                  `${baseFieldName}zip`,
                  `${baseFieldName}Zip`,
                  `${baseFieldName}postalCode`,
                  `${baseFieldName}PostalCode`,
                  'zipCode',
                  'zip',
                  'postalCode'
                ];
                
                // Find and populate matching fields
                const cityField = possibleCityFields.find(f => formData.hasOwnProperty(f));
                const stateField = possibleStateFields.find(f => formData.hasOwnProperty(f));
                const zipField = possibleZipFields.find(f => formData.hasOwnProperty(f));
                
                if (cityField) handleFieldChange(cityField, address.city);
                if (stateField) handleFieldChange(stateField, address.state);
                if (zipField) handleFieldChange(zipField, address.zipCode);
              }}
              placeholder="Start typing an address..."
              dataTestId={`input-${field.fieldName}`}
              className={hasError ? 'border-red-500' : ''}
              showExpandedFields={true}
            />
            {hasError && <p className="text-xs text-red-500">{hasError}</p>}
          </div>
        );

      case 'addressGroup':
        // Render address group with canonical field names
        const groupConfig = (field as any).addressGroupConfig;
        if (!groupConfig) return null;
        
        const groupType = groupConfig.type;
        const fieldMappings = groupConfig.fieldMappings || {};
        
        // Get actual field IDs from mappings
        const street1FieldId = fieldMappings.street1 || '';
        const street2FieldId = fieldMappings.street2 || '';
        const cityFieldId = fieldMappings.city || '';
        const stateFieldId = fieldMappings.state || '';
        const postalCodeFieldId = fieldMappings.postalCode || '';
        const countryFieldId = fieldMappings.country || '';
        
        // Get values from formData using actual field IDs
        const streetValue = formData[street1FieldId] || '';
        const street2Val = formData[street2FieldId] || '';
        const cityVal = formData[cityFieldId] || '';
        const stateVal = formData[stateFieldId] || '';
        const zipCodeVal = formData[postalCodeFieldId] || '';
        
        console.log('🏠 AddressGroup render for', groupType);
        console.log('  Field mappings:', fieldMappings);
        console.log('  Field IDs:', { street1FieldId, cityFieldId, stateFieldId, postalCodeFieldId });
        console.log('  formData keys containing address:', Object.keys(formData).filter(k => k.toLowerCase().includes('address')));
        console.log('  Values retrieved:', { streetValue, cityVal, stateVal, zipCodeVal });
        console.log('  Raw formData lookups:', {
          [street1FieldId]: formData[street1FieldId],
          [cityFieldId]: formData[cityFieldId],
          [stateFieldId]: formData[stateFieldId],
          [postalCodeFieldId]: formData[postalCodeFieldId]
        });
        
        return (
          <div className="space-y-2" key={field.fieldName}>
            <Label className="text-sm font-medium text-gray-700">
              {field.fieldLabel}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <AddressAutocompleteInput
              key={`addressgroup-${groupType}`}
              value={streetValue}
              onChange={(value) => {
                handleFieldChange(street1FieldId, value);
              }}
              initialValues={{
                city: cityVal,
                state: stateVal,
                zipCode: zipCodeVal,
                street2: street2Val
              }}
              onAddressSelect={(address) => {
                // Update all address fields using their actual field IDs
                if (street1FieldId) handleFieldChange(street1FieldId, address.street || '');
                if (street2FieldId) handleFieldChange(street2FieldId, address.street2 || '');
                if (cityFieldId) handleFieldChange(cityFieldId, address.city || '');
                if (stateFieldId) handleFieldChange(stateFieldId, address.state || '');
                if (postalCodeFieldId) handleFieldChange(postalCodeFieldId, address.zipCode || '');
                if (countryFieldId) handleFieldChange(countryFieldId, 'US');
              }}
              onCityChange={(value) => {
                if (cityFieldId) handleFieldChange(cityFieldId, value);
              }}
              onStateChange={(value) => {
                if (stateFieldId) handleFieldChange(stateFieldId, value);
              }}
              onZipCodeChange={(value) => {
                if (postalCodeFieldId) handleFieldChange(postalCodeFieldId, value);
              }}
              onStreet2Change={(value) => {
                if (street2FieldId) handleFieldChange(street2FieldId, value);
              }}
              placeholder="Start typing an address..."
              dataTestId={`addressgroup-${groupType}`}
              showExpandedFields={true}
            />
          </div>
        );

      case 'signatureGroup':
        // Render signature group with field mappings
        const sigGroupConfig = (field as any).signatureGroupConfig;
        if (!sigGroupConfig) return null;
        
        const sigFieldMappings = sigGroupConfig.fieldMappings || {};
        
        // Get actual field IDs from mappings
        const signerNameFieldId = sigFieldMappings.signername || '';
        const signerEmailFieldId = sigFieldMappings.email || '';
        const signatureFieldId = sigFieldMappings.signature || '';
        const initialsFieldId = sigFieldMappings.initials || '';
        const dateSignedFieldId = sigFieldMappings.datesigned || '';
        
        // Get current signature data from formData (stored as JSON string)
        const signatureDataStr = formData[`_signatureGroup_${sigGroupConfig.groupKey}`];
        let signatureData;
        try {
          signatureData = signatureDataStr ? JSON.parse(signatureDataStr) : undefined;
        } catch (e) {
          // Handle malformed data from legacy cache or previous bugs
          console.warn(`✍️ Failed to parse signature data for ${sigGroupConfig.groupKey}:`, e);
          console.warn(`  Raw value: "${signatureDataStr}"`);
          signatureData = undefined;
        }
        
        console.log('✍️ SignatureGroup render for', sigGroupConfig.roleKey);
        console.log('  Field mappings:', sigFieldMappings);
        console.log('  Current signature data:', signatureData);
        
        // Check if this is an owner signature group
        // GroupKey format is like "owners_owner1_signature_owner", so we match the number after "owner"
        const ownerMatch = sigGroupConfig.groupKey.match(/owner(\d+)_signature_owner$/);
        const isOwnerGroup = !!ownerMatch;
        const ownerNumber = ownerMatch ? parseInt(ownerMatch[1]) : null;
        
        return (
          <div className="space-y-2" key={field.fieldName}>
            {/* Show ownership management UI for owner groups */}
            {isOwnerGroup && ownerNumber === 1 && (
              <Card className="mb-4 bg-blue-50 border-blue-200">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-blue-900">Business Ownership</h3>
                      <p className="text-sm text-blue-700">
                        Total Ownership: <span className={`font-bold ${
                          Math.abs(calculateTotalOwnership() - 100) < 0.01 ? 'text-green-600' :
                          calculateTotalOwnership() > 100 ? 'text-red-600' : 'text-orange-600'
                        }`}>
                          {calculateTotalOwnership().toFixed(1)}%
                        </span>
                        {Math.abs(calculateTotalOwnership() - 100) > 0.01 && (
                          <span className="ml-2 text-sm">
                            ({calculateTotalOwnership() < 100 ? 
                              `${(100 - calculateTotalOwnership()).toFixed(1)}% remaining` :
                              `${(calculateTotalOwnership() - 100).toFixed(1)}% over limit`
                            })
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addOwnerSlot}
                      disabled={activeOwnerSlots.size >= 5 || calculateTotalOwnership() >= 100}
                      data-testid="add-owner-btn"
                    >
                      <Users className="h-4 w-4 mr-2" />
                      Add Owner
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <div className="relative">
              <SignatureGroupInput
              config={sigGroupConfig}
              value={signatureData}
              onChange={(data) => {
                // Store the complete signature data as JSON string (handleFieldChange expects scalars)
                handleFieldChange(`_signatureGroup_${sigGroupConfig.groupKey}`, JSON.stringify(data));
                
                // Also update individual fields if they exist for backward compatibility
                if (signerNameFieldId) handleFieldChange(signerNameFieldId, data.signerName);
                if (signerEmailFieldId) handleFieldChange(signerEmailFieldId, data.signerEmail);
                if (signatureFieldId) handleFieldChange(signatureFieldId, data.signature);
                if (initialsFieldId) handleFieldChange(initialsFieldId, data.initials || '');
                if (dateSignedFieldId) handleFieldChange(dateSignedFieldId, data.dateSigned || '');
                
                // Auto-add next owner slot if ownership percentage is entered and < 100%
                // GroupKey format is like "owners_owner1_signature_owner", so we match the number after "owner"
                const ownerMatch = sigGroupConfig.groupKey.match(/owner(\d+)_signature_owner$/);
                if (ownerMatch && data.ownershipPercentage) {
                  const percentage = parseFloat(data.ownershipPercentage);
                  if (!isNaN(percentage) && percentage > 0 && percentage < 100) {
                    // Calculate total ownership including this change
                    const currentTotal = calculateTotalOwnership();
                    
                    // Only add next slot if we haven't reached max owners and total is still < 100
                    if (activeOwnerSlots.size < 5 && currentTotal < 100) {
                      const currentOwnerNum = parseInt(ownerMatch[1]);
                      const nextOwnerNum = currentOwnerNum + 1;
                      
                      // Only add the next sequential owner if it doesn't exist yet
                      if (!activeOwnerSlots.has(nextOwnerNum)) {
                        console.log(`Auto-adding owner${nextOwnerNum} slot (${percentage}% < 100%)`);
                        setActiveOwnerSlots(new Set([...activeOwnerSlots, nextOwnerNum]));
                      }
                    }
                  }
                }
              }}
              dataTestId={`signaturegroup-${sigGroupConfig.roleKey}`}
              isRequired={field.isRequired}
              onRequestSignature={async (roleKey, email) => {
                const currentSignatureData = formData[`_signatureGroup_${sigGroupConfig.groupKey}`];
                let signatureInfo: any = {};
                
                if (currentSignatureData && typeof currentSignatureData === 'string') {
                  try {
                    signatureInfo = JSON.parse(currentSignatureData);
                  } catch {
                    // Ignore parse errors
                  }
                }
                
                // Call the mutation
                const result = await signatureRequestMutation.mutateAsync({
                  applicationId: null, // TODO: Add application ID when available
                  prospectId: isProspectMode ? prospectData?.prospect?.id : null,
                  roleKey,
                  signerType: sigGroupConfig.prefix || 'owner',
                  signerName: signatureInfo.signerName || '',
                  signerEmail: email,
                  ownershipPercentage: null,
                });
                
                // Update local state if successful
                if (result.success && result.signature) {
                  const updatedData = {
                    ...signatureInfo,
                    signerName: signatureInfo.signerName || '',
                    signerEmail: email,
                    status: 'requested' as const,
                    timestampRequested: new Date(),
                    timestampExpires: new Date(result.expiresAt),
                    requestToken: result.signature.requestToken,
                  };
                  handleFieldChange(`_signatureGroup_${sigGroupConfig.groupKey}`, JSON.stringify(updatedData));
                }
              }}
              onResendRequest={async (roleKey) => {
                const currentSignatureData = formData[`_signatureGroup_${sigGroupConfig.groupKey}`];
                let signatureInfo: any = {};
                
                if (currentSignatureData && typeof currentSignatureData === 'string') {
                  try {
                    signatureInfo = JSON.parse(currentSignatureData);
                  } catch {
                    // Ignore parse errors
                  }
                }
                
                // Check if we have a token to resend
                if (!signatureInfo.requestToken) {
                  toast({ 
                    title: 'Cannot resend',
                    description: 'No signature request token found. Please send a new request.',
                    variant: 'destructive',
                  });
                  return;
                }
                
                // Call the resend mutation
                const result = await resendSignatureRequestMutation.mutateAsync({
                  token: signatureInfo.requestToken,
                });
                
                // Update local state if successful
                if (result.success && result.signature) {
                  const updatedData = {
                    ...signatureInfo,
                    status: 'requested',
                    timestampRequested: new Date(),
                    timestampExpires: new Date(result.signature.timestampExpires),
                    requestToken: result.signature.requestToken,
                  };
                  handleFieldChange(`_signatureGroup_${sigGroupConfig.groupKey}`, JSON.stringify(updatedData));
                }
              }}
            />
            
            {/* Remove owner button for owners 2-5 */}
            {isOwnerGroup && ownerNumber && ownerNumber > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeOwnerSlot(ownerNumber)}
                className="mt-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                data-testid={`remove-owner${ownerNumber}-btn`}
              >
                <X className="h-4 w-4 mr-2" />
                Remove This Owner
              </Button>
            )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Preview Mode Banner */}
      {isPreviewMode && previewTemplate && (
        <div className="bg-green-600 text-white px-4 py-3 shadow-md">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Monitor className="w-5 h-5" />
              <div>
                <p className="font-semibold">Test/Preview Mode</p>
                <p className="text-xs opacity-90">Testing template: {previewTemplate.templateName} v{previewTemplate.version}</p>
              </div>
            </div>
            <p className="text-xs opacity-90">Data will not be saved</p>
          </div>
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
                  {isProspectMode ? 'Merchant Processing Application' : (pdfForm?.name || 'Form')}
                </h1>
                <p className="text-gray-600 text-sm">
                  {isProspectMode 
                    ? `Welcome ${prospectData?.prospect?.firstName || ''}! Complete your application - all changes save automatically`
                    : `${pdfForm?.description || 'Form'} - all changes save automatically`
                  }
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Progress</div>
              <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                {(() => {
                  // Calculate progress based on completed required fields
                  const allRequiredFields = filteredSections.flatMap(section => 
                    section.fields.filter(field => field.isRequired)
                  );
                  const completedRequiredFields = allRequiredFields.filter(field => {
                    const value = formData[field.fieldName];
                    return value !== null && value !== undefined && value !== '';
                  });
                  const progressPercent = allRequiredFields.length > 0 
                    ? Math.round((completedRequiredFields.length / allRequiredFields.length) * 100)
                    : 0;
                  return `${progressPercent}%`;
                })()}
              </div>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">
                {(() => {
                  const allRequiredFields = filteredSections.flatMap(section => 
                    section.fields.filter(field => field.isRequired)
                  );
                  const completedRequiredFields = allRequiredFields.filter(field => {
                    const value = formData[field.fieldName];
                    return value !== null && value !== undefined && value !== '';
                  });
                  return `${completedRequiredFields.length} of ${allRequiredFields.length} required fields completed`;
                })()}
              </span>
              <span className="text-xs text-gray-500">
                {filteredSections[currentStep]?.name}
              </span>
            </div>
            <Progress 
              value={(() => {
                const allRequiredFields = filteredSections.flatMap(section => 
                  section.fields.filter(field => field.isRequired)
                );
                const completedRequiredFields = allRequiredFields.filter(field => {
                  const value = formData[field.fieldName];
                  return value !== null && value !== undefined && value !== '';
                });
                return allRequiredFields.length > 0 
                  ? (completedRequiredFields.length / allRequiredFields.length) * 100
                  : 0;
              })()} 
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
                  {filteredSections.map((section, index) => {
                    const IconComponent = section.icon;
                    const isActive = currentStep === index;
                    const isCompleted = index < currentStep;
                    const isVisited = Array.from(visitedSections).includes(index);
                    const hasValidationIssues = getSectionValidationStatus(index);
                    const showWarning = isVisited && hasValidationIssues && !isActive;
                    
                    // Debug logging for Merchant Information section
                    if (section.name === 'Merchant Information') {
                      console.log(`Section ${index} (${section.name}) status:`, {
                        isVisited,
                        hasValidationIssues,
                        showWarning,
                        isActive,
                        visitedSections: Array.from(visitedSections)
                      });
                    }
                    
                    return (
                      <button
                        key={index}
                        onClick={() => {
                          // Preserve all previously visited sections when navigating
                          setVisitedSections(prev => {
                            const newVisited = new Set([...prev]);
                            newVisited.add(index); // Add current section
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
                                : `${section.fields.length} field${section.fields.length !== 1 ? 's' : ''}`
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
                      {React.createElement(filteredSections[currentStep]?.icon || FileText, {
                        className: "w-6 h-6 text-blue-600"
                      })}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-blue-900">{filteredSections[currentStep]?.name}</h2>
                      <p className="text-blue-700 text-sm mt-1">{filteredSections[currentStep]?.description}</p>
                    </div>
                  </div>
                </div>

                {/* Form Fields */}
                <div className="p-8">
                  <div className="space-y-6">
                    {filteredSections[currentStep]?.fields.map((field, index) => (
                      <div key={field.id}>
                        {renderField(field, index)}
                      </div>
                    ))}
                  </div>

                  {/* Required Field Legend */}
                  {filteredSections[currentStep]?.fields.some(f => f.isRequired) && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <p className="text-sm text-gray-500 flex items-center">
                        <span className="text-red-500 font-bold mr-1">*</span>
                        <span>indicates required field</span>
                      </p>
                    </div>
                  )}

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
                      {currentStep < filteredSections.length - 1 ? (
                        <Button
                          onClick={handleNext}
                          className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                        >
                          <span>Next</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          onClick={() => submitApplicationMutation.mutate(formData)}
                          disabled={submitApplicationMutation.isPending}
                          className="flex items-center space-x-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                        >
                          {submitApplicationMutation.isPending ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Submitting...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              <span>Submit Application</span>
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
    </div>
  );
}