import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserAccountFieldConfig } from '@shared/schema';
import { useState, useEffect } from 'react';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UserAccountInputProps {
  config: UserAccountFieldConfig;
  fieldId: string;
  formValue: any;
  onChange: (value: any) => void;
  dataTestId?: string;
  className?: string;
}

interface UserAccountData {
  email: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
}

export function UserAccountInput({
  config,
  fieldId,
  formValue = {},
  onChange,
  dataTestId,
  className = ''
}: UserAccountInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [accountData, setAccountData] = useState<UserAccountData>({
    email: formValue.email || '',
    username: formValue.username || '',
    password: formValue.password || '',
    confirmPassword: formValue.confirmPassword || '',
    role: formValue.role || config.defaultRole || (config.roles && config.roles[0]) || '',
    firstName: formValue.firstName || '',
    lastName: formValue.lastName || ''
  });

  useEffect(() => {
    onChange(accountData);
  }, [accountData]);

  const handleFieldChange = (field: keyof UserAccountData, value: string) => {
    setAccountData(prev => ({ ...prev, [field]: value }));
  };

  const needsFirstLastName = config.usernameGeneration === 'firstLastName';
  const needsManualUsername = config.usernameGeneration === 'manual';
  const needsManualPassword = config.passwordType === 'manual';
  const hasRoleSelection = config.allowedRoles && config.allowedRoles.length > 0;

  return (
    <div className={`space-y-4 border rounded-lg p-4 bg-muted/20 ${className}`} data-testid={dataTestId}>
      <div className="flex items-center gap-2 mb-2">
        <UserPlus className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">User Account Information</h3>
      </div>

      {/* Email - Always Required */}
      <div>
        <Label htmlFor={`${fieldId}_email`}>Email Address *</Label>
        <Input
          id={`${fieldId}_email`}
          type="email"
          value={accountData.email}
          onChange={(e) => handleFieldChange('email', e.target.value)}
          placeholder="user@example.com"
          data-testid={`${dataTestId}-email`}
          required
        />
      </div>

      {/* First and Last Name - Required if username generation is firstLastName */}
      {needsFirstLastName && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${fieldId}_firstName`}>First Name *</Label>
            <Input
              id={`${fieldId}_firstName`}
              value={accountData.firstName}
              onChange={(e) => handleFieldChange('firstName', e.target.value)}
              placeholder="John"
              data-testid={`${dataTestId}-firstName`}
              required
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}_lastName`}>Last Name *</Label>
            <Input
              id={`${fieldId}_lastName`}
              value={accountData.lastName}
              onChange={(e) => handleFieldChange('lastName', e.target.value)}
              placeholder="Doe"
              data-testid={`${dataTestId}-lastName`}
              required
            />
          </div>
        </div>
      )}

      {/* Username - Only if manual generation */}
      {needsManualUsername && (
        <div>
          <Label htmlFor={`${fieldId}_username`}>Username *</Label>
          <Input
            id={`${fieldId}_username`}
            value={accountData.username}
            onChange={(e) => handleFieldChange('username', e.target.value)}
            placeholder="username"
            data-testid={`${dataTestId}-username`}
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Choose a unique username for your account
          </p>
        </div>
      )}

      {/* Password - Only if manual entry */}
      {needsManualPassword && (
        <>
          <div>
            <Label htmlFor={`${fieldId}_password`}>Password *</Label>
            <div className="relative">
              <Input
                id={`${fieldId}_password`}
                type={showPassword ? 'text' : 'password'}
                value={accountData.password}
                onChange={(e) => handleFieldChange('password', e.target.value)}
                placeholder="••••••••"
                data-testid={`${dataTestId}-password`}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Minimum 8 characters, include uppercase, lowercase, number, and special character
            </p>
          </div>
          <div>
            <Label htmlFor={`${fieldId}_confirmPassword`}>Confirm Password *</Label>
            <Input
              id={`${fieldId}_confirmPassword`}
              type={showPassword ? 'text' : 'password'}
              value={accountData.confirmPassword}
              onChange={(e) => handleFieldChange('confirmPassword', e.target.value)}
              placeholder="••••••••"
              data-testid={`${dataTestId}-confirmPassword`}
              required
            />
          </div>
        </>
      )}

      {/* Role Selection - Only if allowed roles specified */}
      {hasRoleSelection && config.allowedRoles && (
        <div>
          <Label htmlFor={`${fieldId}_role`}>Account Type *</Label>
          <Select
            value={accountData.role}
            onValueChange={(value) => handleFieldChange('role', value)}
          >
            <SelectTrigger id={`${fieldId}_role`} data-testid={`${dataTestId}-role`}>
              <SelectValue placeholder="Select account type" />
            </SelectTrigger>
            <SelectContent>
              {config.allowedRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Info message based on password type */}
      {config.passwordType === 'reset_token' && (
        <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200 dark:border-blue-800">
          <strong>Note:</strong> You will receive an email with instructions to set your password after submitting this form.
        </div>
      )}
      {config.passwordType === 'auto' && (
        <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200 dark:border-blue-800">
          <strong>Note:</strong> A temporary password will be sent to your email after submitting this form.
        </div>
      )}
    </div>
  );
}
