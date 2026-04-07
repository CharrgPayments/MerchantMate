import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import sgMail from "@sendgrid/mail";
import { storage } from "./storage";
import type { Request } from "express";
import type { 
  RegisterUser, 
  LoginUser, 
  PasswordResetRequest, 
  PasswordReset,
  TwoFactorVerify,
  User 
} from "@shared/schema";

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes
const PASSWORD_RESET_EXPIRES = 60 * 60 * 1000; // 1 hour
const TWO_FACTOR_EXPIRES = 5 * 60 * 1000; // 5 minutes

// SendGrid configuration
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export class AuthService {
  // Hash password with bcrypt
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  // Verify password against hash
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Generate secure random token
  generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  // Generate 6-digit 2FA code
  generate2FACode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Get client IP address
  getClientIP(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "unknown"
    );
  }

  // Check if IP address has changed since last login
  async hasIPChanged(user: User, currentIP: string): Promise<boolean> {
    return user.lastLoginIp !== null && user.lastLoginIp !== currentIP;
  }

  // Check for recent failed login attempts
  async checkLoginAttempts(usernameOrEmail: string, ip: string): Promise<boolean> {
    const recentAttempts = await storage.getRecentLoginAttempts(usernameOrEmail, ip, LOCKOUT_TIME);
    return recentAttempts.length < MAX_LOGIN_ATTEMPTS;
  }

  // Log login attempt
  async logLoginAttempt(
    usernameOrEmail: string,
    ip: string,
    userAgent: string,
    success: boolean,
    failureReason?: string
  ): Promise<void> {
    await storage.createLoginAttempt({
      username: usernameOrEmail.includes("@") ? null : usernameOrEmail,
      email: usernameOrEmail.includes("@") ? usernameOrEmail : null,
      ipAddress: ip,
      userAgent,
      success,
      failureReason,
    });
  }

  // Send email using SendGrid
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!process.env.SENDGRID_API_KEY) {
      console.log("Email would be sent:", { to, subject, html });
      return;
    }

    try {
      const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_VERIFIED_SENDER;
      if (!fromEmail) {
        console.error("No verified sender email configured for SendGrid");
        return;
      }

      const msg = {
        to,
        from: fromEmail,
        subject,
        html,
      };

      await sgMail.send(msg);
      console.log("Email sent successfully to:", to);
    } catch (error: any) {
      console.error("SendGrid email sending failed:", error);
      if (error.response?.body?.errors) {
        console.error("SendGrid error details:", error.response.body.errors);
      }
      // Don't throw error to prevent app crash - just log it
    }
  }

  // Register new user with dynamic database support
  async registerWithDB(userData: RegisterUser, req: Request, db: any): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      // Import schema and drizzle functions
      const schema = await import('@shared/schema');
      const { eq, or } = await import('drizzle-orm');
      
      // Check if user already exists in the specific database
      const existingUsers = await db
        .select()
        .from(schema.users)
        .where(
          or(
            eq(schema.users.username, userData.username),
            eq(schema.users.email, userData.email)
          )
        );
      
      if (existingUsers.length > 0) {
        const existingUser = existingUsers[0];
        return {
          success: false,
          message: existingUser.email === userData.email ? "Email already registered" : "Username already taken"
        };
      }

      // Hash password
      const passwordHash = await this.hashPassword(userData.password);
      
      // Generate verification token
      const emailVerificationToken = this.generateToken();

      // Create user in the specific database
      const newUser = {
        id: uuidv4(),
        username: userData.username,
        email: userData.email,
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || "merchant",
        emailVerificationToken,
        emailVerified: false,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [user] = await db.insert(schema.users).values(newUser).returning();

      // Send verification email
      await this.sendEmail(
        user.email,
        "Verify Your CoreCRM Account",
        `
        <h2>Welcome to CoreCRM!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${process.env.APP_URL || "http://localhost:5000"}/api/auth/verify-email?token=${emailVerificationToken}">
          Verify Email Address
        </a>
        <p>This link will expire in 24 hours.</p>
        `
      );

      return {
        success: true,
        message: "Registration successful. Please check your email to verify your account.",
        user
      };
    } catch (error) {
      console.error("Registration error:", error);
      return {
        success: false,
        message: "Registration failed. Please try again."
      };
    }
  }

  // Register new user (legacy method using storage)
  async register(userData: RegisterUser, req: Request): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      // Check if user already exists
      const existingUser = await storage.getUserByUsernameOrEmail(userData.username, userData.email);
      if (existingUser) {
        return {
          success: false,
          message: existingUser.email === userData.email ? "Email already registered" : "Username already taken"
        };
      }

      // Hash password
      const passwordHash = await this.hashPassword(userData.password);
      
      // Generate verification token
      const emailVerificationToken = this.generateToken();

      // Create user
      const user = await storage.createUser({
        id: uuidv4(),
        username: userData.username,
        email: userData.email,
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || "merchant",
        emailVerificationToken,
        emailVerified: false,
      });

      // Send verification email
      await this.sendEmail(
        user.email,
        "Verify Your CoreCRM Account",
        `
        <h2>Welcome to CoreCRM!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${process.env.APP_URL || "http://localhost:5000"}/api/auth/verify-email?token=${emailVerificationToken}">
          Verify Email Address
        </a>
        <p>This link will expire in 24 hours.</p>
        `
      );

      return {
        success: true,
        message: "Registration successful. Please check your email to verify your account.",
        user
      };
    } catch (error) {
      console.error("Registration error:", error);
      return {
        success: false,
        message: "Registration failed. Please try again."
      };
    }
  }

  // Login user
  async login(loginData: LoginUser, req: Request): Promise<{ 
    success: boolean; 
    message: string; 
    user?: User; 
    requires2FA?: boolean;
    sessionId?: string;
  }> {
    const ip = this.getClientIP(req);
    const userAgent = req.headers["user-agent"] || "";

    try {
      // Check login attempts
      if (!(await this.checkLoginAttempts(loginData.usernameOrEmail, ip))) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "too_many_attempts");
        return {
          success: false,
          message: "Too many failed login attempts. Please try again in 15 minutes."
        };
      }

      // Get user by username or email
      let user = await storage.getUserByUsername(loginData.usernameOrEmail);
      if (!user) {
        user = await storage.getUserByEmail(loginData.usernameOrEmail);
      }
      if (!user) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "user_not_found");
        return {
          success: false,
          message: "Invalid username/email or password"
        };
      }

      // Check if account is active
      if (user.status !== "active") {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "account_inactive");
        return {
          success: false,
          message: "Account is suspended. Please contact support."
        };
      }

      // Verify password
      if (!(await this.verifyPassword(loginData.password, user.passwordHash))) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "invalid_password");
        return {
          success: false,
          message: "Invalid username/email or password"
        };
      }

      // Check if IP changed or 2FA is enabled
      const ipChanged = await this.hasIPChanged(user, ip);
      if (user.twoFactorEnabled || ipChanged) {
        if (!loginData.twoFactorCode) {
          // Generate and send 2FA code
          const code = this.generate2FACode();
          const type = ipChanged ? "ip_change" : "login";
          
          await storage.create2FACode({
            userId: user.id,
            code,
            type,
            expiresAt: new Date(Date.now() + TWO_FACTOR_EXPIRES),
          });

          // Send 2FA code via email
          await this.sendEmail(
            user.email,
            `CoreCRM Security Code${ipChanged ? " - New IP Address Detected" : ""}`,
            `
            <h2>Security Code Required</h2>
            ${ipChanged ? "<p><strong>We detected a login from a new IP address.</strong></p>" : ""}
            <p>Your verification code is: <strong style="font-size: 24px; color: #007bff;">${code}</strong></p>
            <p>This code will expire in 5 minutes.</p>
            <p>IP Address: ${ip}</p>
            `
          );

          return {
            success: false,
            requires2FA: true,
            message: ipChanged 
              ? "New IP address detected. Please check your email for a security code."
              : "Please enter your 2FA code."
          };
        } else {
          // Verify 2FA code
          const validCode = await storage.verify2FACode(user.id, loginData.twoFactorCode);
          if (!validCode) {
            await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "invalid_2fa");
            return {
              success: false,
              message: "Invalid or expired security code"
            };
          }
        }
      }

      // Update user login info with timezone if provided
      const updateData: any = {
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      };
      
      // Update timezone if provided in login data
      if (loginData.timezone) {
        updateData.timezone = loginData.timezone;
      }
      
      await storage.updateUser(user.id, updateData);

      // Log successful login
      await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, true);

      return {
        success: true,
        message: "Login successful",
        user,
        sessionId: uuidv4()
      };
    } catch (error) {
      console.error("Login error:", error);
      await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "system_error");
      return {
        success: false,
        message: "Login failed. Please try again."
      };
    }
  }

  // Login with dynamic database support
  async loginWithDB(loginData: LoginUser, req: Request, db: any): Promise<{ 
    success: boolean; 
    message: string; 
    user?: User; 
    requires2FA?: boolean;
    sessionId?: string;
  }> {
    const ip = this.getClientIP(req);
    const userAgent = req.headers["user-agent"] || "";

    try {
      // Import schema and drizzle functions
      const schema = await import('@shared/schema');
      const { eq, or } = await import('drizzle-orm');

      // Check login attempts (still use storage for cross-database tracking)
      if (!(await this.checkLoginAttempts(loginData.usernameOrEmail, ip))) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "too_many_attempts");
        return {
          success: false,
          message: "Too many failed login attempts. Please try again in 15 minutes."
        };
      }

      // Get user from the specific database
      const users = await db
        .select()
        .from(schema.users)
        .where(
          or(
            eq(schema.users.username, loginData.usernameOrEmail),
            eq(schema.users.email, loginData.usernameOrEmail)
          )
        );

      const user = users[0];
      if (!user) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "user_not_found");
        return {
          success: false,
          message: "Invalid username/email or password"
        };
      }

      // Check if account is active
      if (user.status !== "active") {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "account_inactive");
        return {
          success: false,
          message: "Account is suspended. Please contact support."
        };
      }

      // Verify password
      if (!(await this.verifyPassword(loginData.password, user.passwordHash))) {
        await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "invalid_password");
        return {
          success: false,
          message: "Invalid username/email or password"
        };
      }

      // Update user login info in the specific database
      const updateData = {
        lastLoginAt: new Date(),
        lastLoginIp: ip,
        ...(loginData.timezone && { timezone: loginData.timezone }),
      };
      
      await db
        .update(schema.users)
        .set(updateData)
        .where(eq(schema.users.id, user.id));

      // Log successful login
      await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, true);

      return {
        success: true,
        message: "Login successful",
        user,
        sessionId: uuidv4()
      };
    } catch (error) {
      console.error("Login error:", error);
      await this.logLoginAttempt(loginData.usernameOrEmail, ip, userAgent, false, "system_error");
      return {
        success: false,
        message: "Login failed. Please try again."
      };
    }
  }

  // Request password reset
  async requestPasswordReset(data: PasswordResetRequest): Promise<{ success: boolean; message: string }> {
    try {
      const user = await storage.getUserByUsernameOrEmail(data.usernameOrEmail, data.usernameOrEmail);
      if (!user) {
        // Don't reveal if user exists or not
        return {
          success: true,
          message: "If an account with that username/email exists, a password reset link has been sent."
        };
      }

      // Generate reset token
      const resetToken = this.generateToken();
      const resetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRES);

      // Save reset token
      await storage.updateUser(user.id, {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      });

      // Send reset email
      await this.sendEmail(
        user.email,
        "CoreCRM Password Reset",
        `
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your CoreCRM account.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${process.env.APP_URL || "http://localhost:5000"}/auth/reset-password?token=${resetToken}">
          Reset Password
        </a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
        `
      );

      return {
        success: true,
        message: "If an account with that username/email exists, a password reset link has been sent."
      };
    } catch (error) {
      console.error("Password reset request error:", error);
      return {
        success: false,
        message: "Password reset request failed. Please try again."
      };
    }
  }

  // Reset password
  async resetPassword(data: PasswordReset): Promise<{ success: boolean; message: string }> {
    try {
      const user = await storage.getUserByResetToken(data.token);
      if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
        return {
          success: false,
          message: "Invalid or expired reset token"
        };
      }

      // Hash new password
      const passwordHash = await this.hashPassword(data.password);

      // Update user
      await storage.updateUser(user.id, {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      });

      // Send confirmation email
      await this.sendEmail(
        user.email,
        "CoreCRM Password Changed",
        `
        <h2>Password Successfully Changed</h2>
        <p>Your CoreCRM account password has been successfully changed.</p>
        <p>If you didn't make this change, please contact support immediately.</p>
        `
      );

      return {
        success: true,
        message: "Password reset successful. You can now log in with your new password."
      };
    } catch (error) {
      console.error("Password reset error:", error);
      return {
        success: false,
        message: "Password reset failed. Please try again."
      };
    }
  }

  // Admin password reset - generates temporary password
  async adminResetPassword(userId: string): Promise<{ success: boolean; message: string; temporaryPassword?: string }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          message: "User not found"
        };
      }

      // Generate temporary password and update user
      const { user: updatedUser, temporaryPassword } = await storage.resetUserPassword(userId);

      // Send temporary password email
      await this.sendEmail(
        updatedUser.email,
        "CoreCRM Account Password Reset",
        `
        <h2>Password Reset - CoreCRM Account</h2>
        <p>Dear ${updatedUser.firstName || updatedUser.username},</p>
        <p>Your account password has been reset by an administrator.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Temporary Login Credentials</h3>
          <p><strong>Username:</strong> ${updatedUser.username}</p>
          <p><strong>Temporary Password:</strong> <span style="background-color: #e9ecef; padding: 4px 8px; font-family: monospace; font-size: 14px;">${temporaryPassword}</span></p>
        </div>
        
        <p><strong>Important:</strong> You will be required to change this password immediately upon your next login for security purposes.</p>
        
        <p><a href="${process.env.APP_URL || "http://localhost:5000"}/login" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Login to Change Password</a></p>
        
        <p>If you have any questions, please contact your administrator.</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">This is an automated message from CoreCRM. Please do not reply to this email.</p>
        `
      );

      return {
        success: true,
        message: "Password reset successfully. Temporary password has been emailed to the user.",
        temporaryPassword
      };
    } catch (error) {
      console.error("Admin password reset error:", error);
      return {
        success: false,
        message: "Password reset failed. Please try again."
      };
    }
  }

  // Verify email address
  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await storage.getUserByEmailVerificationToken(token);
      if (!user) {
        return {
          success: false,
          message: "Invalid verification token"
        };
      }

      await storage.updateUser(user.id, {
        emailVerified: true,
        emailVerificationToken: null,
      });

      return {
        success: true,
        message: "Email verified successfully. You can now log in."
      };
    } catch (error) {
      console.error("Email verification error:", error);
      return {
        success: false,
        message: "Email verification failed. Please try again."
      };
    }
  }

  // Enable 2FA for user
  async enable2FA(userId: string): Promise<{ success: boolean; secret?: string; qrCode?: string }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return { success: false };
      }

      const secret = speakeasy.generateSecret({
        name: `CoreCRM (${user.email})`,
        issuer: "CoreCRM",
      });

      await storage.updateUser(userId, {
        twoFactorSecret: secret.base32,
        twoFactorEnabled: true,
      });

      return {
        success: true,
        secret: secret.base32,
        qrCode: secret.otpauth_url,
      };
    } catch (error) {
      console.error("Enable 2FA error:", error);
      return { success: false };
    }
  }

  // Disable 2FA for user
  async disable2FA(userId: string): Promise<{ success: boolean }> {
    try {
      await storage.updateUser(userId, {
        twoFactorSecret: null,
        twoFactorEnabled: false,
      });

      return { success: true };
    } catch (error) {
      console.error("Disable 2FA error:", error);
      return { success: false };
    }
  }
}

export const authService = new AuthService();