import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { MCCAutocompleteInput } from './MCCAutocompleteInput';

// Types for field configuration
interface FieldConfig {
  id: string;
  type: 'text' | 'email' | 'tel' | 'url' | 'date' | 'number' | 'select' | 'checkbox' | 'textarea' | 'mcc-select' | 'zipcode';
  label: string;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
  sensitive?: boolean;
  placeholder?: string;
  description?: string;
}

interface SectionConfig {
  id: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
}

interface FormConfiguration {
  sections: SectionConfig[];
}

interface ConditionalFields {
  [fieldId: string]: {
    [value: string]: {
      show?: string[];
      hide?: string[];
    };
  };
}

interface DynamicFormRendererProps {
  configuration: FormConfiguration;
  conditionalFields?: ConditionalFields;
  requiredFields?: string[];
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => void;
  onSave?: (data: Record<string, any>) => void;
  isSubmitting?: boolean;
  isSaving?: boolean;
  submitLabel?: string;
  saveLabel?: string;
  allowSave?: boolean;
  className?: string;
}

// Create dynamic Zod schema based on field configuration and visible fields
function createDynamicSchema(configuration: FormConfiguration, requiredFields: string[] = [], visibleFields?: Set<string>): z.ZodSchema {
  const schemaObject: Record<string, z.ZodTypeAny> = {};

  configuration.sections.forEach(section => {
    section.fields.forEach(field => {
      // Only include visible fields in schema validation
      if (visibleFields && !visibleFields.has(field.id)) {
        return;
      }

      let fieldSchema: z.ZodTypeAny;

      // Base field type validation
      switch (field.type) {
        case 'email':
          fieldSchema = z.string().email('Please enter a valid email address');
          break;
        case 'url':
          fieldSchema = z.string().url('Please enter a valid URL');
          break;
        case 'zipcode':
          fieldSchema = z.string().regex(
            /^\d{5}(-\d{4})?$/,
            'Please enter a valid US zip code (12345 or 12345-6789)'
          );
          break;
        case 'number':
          let numberSchema = z.coerce.number();
          if (field.min !== undefined) {
            numberSchema = numberSchema.min(field.min, `Minimum value is ${field.min}`);
          }
          if (field.max !== undefined) {
            numberSchema = numberSchema.max(field.max, `Maximum value is ${field.max}`);
          }
          fieldSchema = numberSchema;
          break;
        case 'checkbox':
          fieldSchema = z.boolean();
          break;
        case 'date':
          fieldSchema = z.string().refine(
            (date) => !isNaN(Date.parse(date)),
            'Please enter a valid date'
          );
          break;
        default:
          fieldSchema = z.string();
      }

      // Apply pattern validation if specified
      if (field.pattern && field.type !== 'number' && field.type !== 'checkbox' && field.type !== 'zipcode') {
        fieldSchema = (fieldSchema as z.ZodString).regex(
          new RegExp(field.pattern),
          `Please enter a valid ${field.label.toLowerCase()}`
        );
      }

      // Apply required validation
      const isRequired = field.required || requiredFields.includes(field.id);
      if (!isRequired && field.type !== 'checkbox') {
        fieldSchema = fieldSchema.optional();
      } else if (isRequired && field.type !== 'checkbox') {
        fieldSchema = (fieldSchema as z.ZodString).min(1, `${field.label} is required`);
      }

      schemaObject[field.id] = fieldSchema;
    });
  });

  return z.object(schemaObject);
}

export default function DynamicFormRenderer({
  configuration,
  conditionalFields = {},
  requiredFields = [],
  initialData = {},
  onSubmit,
  onSave,
  isSubmitting = false,
  isSaving = false,
  submitLabel = 'Submit',
  saveLabel = 'Save Draft',
  allowSave = true,
  className = ''
}: DynamicFormRendererProps) {
  const [showSensitiveFields, setShowSensitiveFields] = useState<Record<string, boolean>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [lastValidValues, setLastValidValues] = useState<Record<string, any>>({});

  // Create dynamic schema based on visible fields - recreate when visibility changes
  const currentSchema = useMemo(() => {
    return createDynamicSchema(configuration, requiredFields, visibleFields);
  }, [configuration, requiredFields, visibleFields]);

  // Set up form with dynamic schema that updates based on visible fields
  const form = useForm({
    resolver: zodResolver(currentSchema),
    defaultValues: initialData,
    mode: 'onBlur'
  });

  // Track form values to preserve them during schema updates
  useEffect(() => {
    const subscription = form.watch((value) => {
      setLastValidValues(prev => ({ ...prev, ...value }));
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Reset form validation when visible fields change to apply new schema
  useEffect(() => {
    if (visibleFields.size > 0) {
      // Clear validation errors from fields that are now hidden
      form.clearErrors();
      
      // Use only the cached values to preserve user edits, fallback to initial for new fields
      const preservedValues: Record<string, any> = {};
      configuration.sections.forEach(section => {
        section.fields.forEach(field => {
          if (lastValidValues.hasOwnProperty(field.id)) {
            preservedValues[field.id] = lastValidValues[field.id];
          } else if (initialData && initialData.hasOwnProperty(field.id)) {
            preservedValues[field.id] = initialData[field.id];
          }
        });
      });
      
      form.reset(preservedValues);
    }
  }, [visibleFields, currentSchema]);

  // Watch form values for conditional field logic
  const watchedValues = form.watch();

  // Calculate visible fields based on conditional logic
  useEffect(() => {
    // Identify which fields are exclusively controlled by show conditions (should start hidden)
    const showOnlyFields = new Set<string>();
    const hideControlledFields = new Set<string>();
    
    Object.values(conditionalFields).forEach(conditions => {
      Object.values(conditions).forEach(condition => {
        condition.show?.forEach(fieldId => showOnlyFields.add(fieldId));
        condition.hide?.forEach(fieldId => hideControlledFields.add(fieldId));
      });
    });
    
    // Remove fields that are also controlled by hide (mixed show/hide fields start visible)
    hideControlledFields.forEach(fieldId => {
      showOnlyFields.delete(fieldId);
    });

    // Start with all fields visible except show-only fields
    const newVisibleFields = new Set<string>();
    configuration.sections.forEach(section => {
      section.fields.forEach(field => {
        if (!showOnlyFields.has(field.id)) {
          newVisibleFields.add(field.id);
        }
      });
    });

    // Apply conditional field logic - process all conditions
    Object.entries(conditionalFields).forEach(([fieldId, conditions]) => {
      const fieldValue = watchedValues[fieldId];
      
      // Handle different value types for comparison
      const checkCondition = (valueToCheck: any) => {
        return conditions[valueToCheck];
      };
      
      // Try different value representations
      let condition;
      if (fieldValue === undefined || fieldValue === null) {
        condition = checkCondition('');
      } else {
        // Try exact value first (boolean true/false, numbers)
        condition = checkCondition(fieldValue);
        
        // If no exact match and not already a string, try string conversion
        if (!condition && typeof fieldValue !== 'string') {
          condition = checkCondition(String(fieldValue));
        }
      }
      
      if (condition) {
        // Show specific fields (additive)
        condition.show?.forEach(fieldToShow => {
          newVisibleFields.add(fieldToShow);
        });
        
        // Hide specific fields (subtractive, takes precedence)
        condition.hide?.forEach(fieldToHide => {
          newVisibleFields.delete(fieldToHide);
        });
      }
    });

    // Only update if the set has actually changed (deep equality check)
    const currentVisible = Array.from(visibleFields).sort();
    const newVisible = Array.from(newVisibleFields).sort();
    if (JSON.stringify(currentVisible) !== JSON.stringify(newVisible)) {
      setVisibleFields(newVisibleFields);
    }
  }, [watchedValues, conditionalFields, configuration, visibleFields]);

  const toggleSensitiveField = (fieldId: string) => {
    setShowSensitiveFields(prev => ({
      ...prev,
      [fieldId]: !prev[fieldId]
    }));
  };

  const renderField = (field: FieldConfig) => {
    const isVisible = visibleFields.has(field.id);
    if (!isVisible) return null;

    const isRequired = field.required || requiredFields.includes(field.id);
    const testId = `input-${field.id.replace(/_/g, '-')}`;

    return (
      <FormField
        key={field.id}
        control={form.control}
        name={field.id}
        render={({ field: formField }) => (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              {field.label}
              {isRequired && <span className="text-red-500">*</span>}
              {field.sensitive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto p-1"
                  onClick={() => toggleSensitiveField(field.id)}
                  data-testid={`button-toggle-sensitive-${field.id.replace(/_/g, '-')}`}
                >
                  {showSensitiveFields[field.id] ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
              )}
            </FormLabel>
            <FormControl>
              {(field.id === 'businessDescription' || field.type === 'mcc-select') ? (
                <MCCAutocompleteInput
                  value={formField.value || ''}
                  onChange={formField.onChange}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  dataTestId={testId}
                  onMCCSelect={(mccCode) => {
                    // Store the selected MCC code in the form data for later use
                    const currentData = form.getValues();
                    form.setValue('selectedMCC', mccCode.mcc);
                    form.setValue('selectedMCCDescription', mccCode.description);
                  }}
                />
              ) : field.type === 'select' ? (
                <Select
                  onValueChange={formField.onChange}
                  value={formField.value || ''}
                  data-testid={testId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === 'textarea' ? (
                <Textarea
                  {...formField}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  data-testid={testId}
                />
              ) : field.type === 'checkbox' ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={formField.value || false}
                    onCheckedChange={formField.onChange}
                    data-testid={testId}
                  />
                  <span className="text-sm">{field.description || field.label}</span>
                </div>
              ) : (
                <Input
                  {...formField}
                  type={field.sensitive && !showSensitiveFields[field.id] ? 'password' : field.type}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  min={field.min}
                  max={field.max}
                  data-testid={testId}
                />
              )}
            </FormControl>
            {field.description && field.type !== 'checkbox' && (
              <FormDescription>{field.description}</FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  const handleSubmit = (data: Record<string, any>) => {
    onSubmit(data);
  };

  const handleSave = () => {
    const currentData = form.getValues();
    onSave?.(currentData);
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {configuration.sections.map((section, sectionIndex) => (
            <Card key={section.id} data-testid={`section-${section.id.replace(/_/g, '-')}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {section.title}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({sectionIndex + 1} of {configuration.sections.length})
                  </span>
                </CardTitle>
                {section.description && (
                  <CardDescription>{section.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  {section.fields.map(renderField)}
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>All fields marked with * are required</span>
            </div>
            
            <div className="flex items-center gap-3">
              {allowSave && onSave && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSave}
                  disabled={isSaving}
                  data-testid="button-save-draft"
                >
                  {isSaving ? 'Saving...' : saveLabel}
                </Button>
              )}
              
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="button-submit-form"
              >
                {isSubmitting ? 'Submitting...' : submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

export type { FieldConfig, SectionConfig, FormConfiguration, ConditionalFields };