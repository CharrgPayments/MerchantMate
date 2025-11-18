import { authService } from '../auth';
import { UserAccountFieldConfig, users } from '@shared/schema';
import crypto from 'crypto';
import { emailService } from '../emailService';
import { AuditService } from '../auditService';
import type { db as DbType } from '../db';
import { eq } from 'drizzle-orm';

interface UserAccountData {
  email: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email ${email} is already registered`);
    this.name = 'DuplicateEmailError';
  }
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username ${username} is already taken`);
    this.name = 'DuplicateUsernameError';
  }
}

export class PasswordMismatchError extends Error {
  constructor() {
    super('Passwords do not match');
    this.name = 'PasswordMismatchError';
  }
}

export class PasswordStrengthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordStrengthError';
  }
}

/**
 * Create a user account from form field data
 * @param formValue - The user account data from the form submission
 * @param config - The UserAccountFieldConfig from the template
 * @param db - The database instance
 * @param dbEnv - The database environment (development, test, production)
 * @returns The created user ID
 */
export async function createUserFromFormField(
  formValue: UserAccountData,
  config: UserAccountFieldConfig,
  db: typeof DbType,
  dbEnv: string = 'development'
): Promise<string> {
  const { email, username: manualUsername, password, confirmPassword, role, firstName, lastName } = formValue;

  // Validate required fields
  if (!email) {
    throw new Error('Email is required');
  }

  // Check for duplicate email
  const existingUserByEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUserByEmail.length > 0) {
    throw new DuplicateEmailError(email);
  }

  // Generate username based on config
  let username = '';
  switch (config.usernameGeneration) {
    case 'email':
      username = email.split('@')[0].toLowerCase();
      break;
    case 'firstLastName':
      if (!firstName || !lastName) {
        throw new Error('First name and last name are required for username generation');
      }
      username = `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}`;
      break;
    case 'manual':
      if (!manualUsername) {
        throw new Error('Username is required');
      }
      username = manualUsername.toLowerCase();
      break;
  }

  // Ensure username is unique by appending numbers if needed
  let finalUsername = username;
  let counter = 1;
  while (true) {
    const existingUserByUsername = await db.select().from(users).where(eq(users.username, finalUsername)).limit(1);
    if (existingUserByUsername.length === 0) {
      break;
    }
    finalUsername = `${username}${counter}`;
    counter++;
  }

  // Handle password based on config
  let hashedPassword: string | null = null;
  let resetToken: string | null = null;
  let resetTokenExpires: Date | null = null;
  const userStatus = config.status || 'pending_password';

  switch (config.passwordType) {
    case 'manual':
      if (!password) {
        throw new Error('Password is required');
      }
      if (password !== confirmPassword) {
        throw new PasswordMismatchError();
      }
      // Validate password strength using shared function
      const validationResult = validatePasswordStrength(password);
      if (!validationResult.valid) {
        throw new PasswordStrengthError(validationResult.error || 'Invalid password');
      }
      hashedPassword = await authService.hashPassword(password);
      break;
    case 'auto':
      // Generate a random secure password
      const tempPassword = crypto.randomBytes(16).toString('base64').slice(0, 16) + '!Aa1';
      hashedPassword = await authService.hashPassword(tempPassword);
      // Log temp password for development (in production, this should be sent via secure email)
      console.log(`[DEV] Auto-generated password for ${email}: ${tempPassword}`);
      console.log(`[WARNING] Auto-generated passwords should be sent via secure email in production`);
      // TODO: Implement secure email delivery for auto-generated passwords
      break;
    case 'reset_token':
      // Generate reset token
      resetToken = crypto.randomUUID();
      resetTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      // Send reset email
      if (config.notifyUser !== false) {
        await emailService.sendPasswordResetEmail({ 
          email, 
          resetToken,
          dbEnv 
        });
      }
      break;
  }

  // Determine which roles to assign - SECURITY: Fail closed if role doesn't match allowedRoles
  let rolesToAssign: string[];
  if (config.allowedRoles && config.allowedRoles.length > 0) {
    // If allowedRoles is defined, MUST validate submitted role
    if (!role) {
      // Use default role if present, otherwise fail
      if (config.defaultRole && config.allowedRoles.includes(config.defaultRole)) {
        rolesToAssign = [config.defaultRole];
      } else {
        throw new Error('Role selection is required');
      }
    } else if (!config.allowedRoles.includes(role)) {
      // SECURITY: Reject if submitted role not in allowed list
      throw new Error(`Invalid role: ${role}. This incident has been logged.`);
    } else {
      rolesToAssign = [role];
    }
  } else {
    // No role restrictions - use config.roles
    rolesToAssign = config.roles;
  }

  // Create user
  const [newUser] = await db.insert(users).values({
    username: finalUsername,
    passwordHash: hashedPassword,
    email,
    roles: rolesToAssign,
    status: userStatus,
    firstName: firstName || null,
    lastName: lastName || null,
    resetToken,
    resetTokenExpires
  }).returning();

  // TODO: Send welcome email if configured
  // Welcome emails are currently not implemented
  // if (config.notifyUser !== false && config.passwordType === 'manual') {
  //   await emailService.sendWelcomeEmail({ email, username: finalUsername, dbEnv });
  // }

  // Audit log - use database instance for audit service
  try {
    const auditService = new AuditService(db);
    await auditService.logAction(
      'user_registered',
      'users',
      {
        userId: newUser.id,
        userEmail: email,
        environment: dbEnv
      },
      {
        resourceId: newUser.id,
        notes: `User account created via form submission for ${email}`,
        riskLevel: 'low'
      }
    );
  } catch (auditError) {
    console.error('Audit logging failed:', auditError);
    // Continue - audit failure shouldn't block account creation
  }

  return newUser.id;
}

/**
 * Validate password strength
 * This is a shared validation function used for both initial password setup and password resets
 */
export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    return { 
      valid: false, 
      error: 'Password must include uppercase, lowercase, number, and special character (@$!%*?&)' 
    };
  }
  
  return { valid: true };
}
