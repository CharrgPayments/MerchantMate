import { hashPassword } from '../auth';
import { UserAccountFieldConfig, users } from '@shared/schema';
import crypto from 'crypto';
import { emailService } from '../emailService';
import { auditService } from '../auditService';
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

/**
 * Create a user account from form field data
 * @param formValue - The user account data from the form submission
 * @param config - The UserAccountFieldConfig from the template
 * @param db - The database instance
 * @returns The created user ID
 */
export async function createUserFromFormField(
  formValue: UserAccountData,
  config: UserAccountFieldConfig,
  db: typeof DbType
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
      hashedPassword = await hashPassword(password);
      break;
    case 'auto':
      // Generate a random password
      const tempPassword = crypto.randomBytes(12).toString('base64').slice(0, 12);
      hashedPassword = await hashPassword(tempPassword);
      // Send temp password via email
      if (config.notifyUser !== false) {
        await emailService.sendPasswordReset(email, tempPassword);
      }
      break;
    case 'reset_token':
      // Generate reset token
      resetToken = crypto.randomUUID();
      resetTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      // Send reset email
      if (config.notifyUser !== false) {
        await emailService.sendPasswordResetEmail(email, resetToken);
      }
      break;
  }

  // Determine roles
  const rolesToAssign = role && config.allowedRoles?.includes(role) 
    ? [role]
    : config.roles;

  // Create user
  const [newUser] = await db.insert(users).values({
    email,
    username: finalUsername,
    password: hashedPassword,
    roles: rolesToAssign,
    status: userStatus,
    firstName: firstName || null,
    lastName: lastName || null,
    resetToken,
    resetTokenExpires
  }).returning({ id: users.id });

  // Send welcome email if configured
  if (config.notifyUser !== false && config.passwordType !== 'reset_token') {
    await emailService.sendWelcomeEmail(email, finalUsername);
  }

  // Audit log
  await auditService.log({
    action: 'user_registered',
    userId: newUser.id,
    details: `User account created via form submission: ${email}`,
    ipAddress: null,
    userAgent: null,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });

  return newUser.id;
}
