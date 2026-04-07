import type { Express } from "express";
import { authService } from "./auth";
import { storage } from "./storage";
import { 
  registerUserSchema, 
  loginUserSchema, 
  passwordResetRequestSchema, 
  passwordResetSchema,
  twoFactorVerifySchema 
} from "@shared/schema";
import { dbEnvironmentMiddleware, getRequestDB, type RequestWithDB } from "./dbMiddleware";

declare module "express-session" {
  interface SessionData {
    userId: string;
    sessionId: string;
    dbEnv: string;
  }
}

export function setupAuthRoutes(app: Express) {
  // Authentication middleware with database environment support
  const requireAuth = async (req: RequestWithDB, res: any, next: any) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Use storage layer for consistent user lookup across environments
    let user;
    try {
      user = await storage.getUser(req.session.userId);
    } catch (error) {
      console.error("Error fetching user from storage:", error);
      user = null;
    }
    
    if (!user || user.status !== 'active') {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Account not found or inactive" });
    }
    
    req.user = user;
    next();
  };

  // User registration with database environment support
  app.post('/api/auth/register', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      console.log("Registration request body:", req.body);
      const validatedData = registerUserSchema.parse(req.body);
      console.log("Validated data:", validatedData);
      // Use dynamic database for registration
      const dynamicDB = getRequestDB(req);
      const result = await authService.registerWithDB(validatedData, req, dynamicDB);
      
      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Registration validation error:", error);
      if (error?.issues) {
        res.status(400).json({ 
          success: false, 
          message: "Validation failed",
          errors: error.issues
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: "Invalid registration data" 
        });
      }
    }
  });

  // User login with database environment support
  app.post('/api/auth/login', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const validatedData = loginUserSchema.parse(req.body);
      // Use dynamic database for login authentication
      const dynamicDB = getRequestDB(req);
      const result = await authService.loginWithDB(validatedData, req, dynamicDB);
      
      if (result.success && result.user) {
        // Store user session data including database environment
        req.session.userId = result.user.id;
        req.session.sessionId = result.sessionId || 'default-session';
        req.session.dbEnv = req.dbEnv; // Store selected database environment in session
        
        console.log(`Session created: userId=${result.user.id}, dbEnv=${req.dbEnv}`);
        
        // Force session save before responding
        req.session.save((err: any) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ success: false, message: "Session save failed" });
          }
          res.json(result);
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(400).json({ 
        success: false, 
        message: "Invalid login data" 
      });
    }
  });

  // Password verification endpoint for sensitive operations
  app.post('/api/auth/verify-password', dbEnvironmentMiddleware, requireAuth, async (req: RequestWithDB, res) => {
    try {
      const { password } = req.body;
      const userId = req.session.userId!;
      const dbEnv = req.dbEnv;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      
      if (!password) {
        return res.status(400).json({ success: false, message: "Verification failed" });
      }
      
      // Use dynamic database consistent with session environment
      const dynamicDB = getRequestDB(req);
      const user = await dynamicDB
        .select()
        .from(await import("@shared/schema").then(m => m.usersTable))
        .where((await import("drizzle-orm").then(m => m.eq))((await import("@shared/schema").then(m => m.usersTable)).id, userId))
        .limit(1)
        .then((rows: any) => rows[0]);
      
      if (!user) {
        console.error(`[Security] Password verification failed: User ${userId} not found in ${dbEnv} environment from IP ${ipAddress}`);
        return res.status(401).json({ success: false, message: "Verification failed" });
      }
      
      const isValid = await authService.verifyPassword(password, user.passwordHash);
      
      if (isValid) {
        console.log(`[Security] Password verification successful for user ${userId} (${user.username}) in ${dbEnv} environment from IP ${ipAddress}`);
        res.json({ success: true, message: "Password verified" });
      } else {
        console.warn(`[Security] Password verification failed for user ${userId} (${user.username}) in ${dbEnv} environment from IP ${ipAddress} - Invalid password provided`);
        res.status(401).json({ success: false, message: "Verification failed" });
      }
    } catch (error) {
      console.error("Password verification error:", error);
      res.status(500).json({ success: false, message: "Verification failed" });
    }
  });

  // User logout
  app.post('/api/auth/logout', (req: any, res) => {
    console.log(`Logout: clearing session for user ${req.session?.userId}, dbEnv: ${req.session?.dbEnv}`);
    req.session.destroy((err: any) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie('connect.sid');
      res.json({ success: true, message: "Logged out successfully" });
    });
  });

  // Get current user
  app.get('/api/auth/user', requireAuth, (req: any, res) => {
    res.json(req.user);
  });

  // Forgot password
  app.post('/api/auth/forgot-password', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const validatedData = passwordResetRequestSchema.parse(req.body);
      const result = await authService.requestPasswordReset(validatedData, req.dbEnv);
      res.json(result);
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(400).json({ 
        success: false, 
        message: "Invalid request data" 
      });
    }
  });

  // Reset password
  app.post('/api/auth/reset-password', dbEnvironmentMiddleware, async (req: RequestWithDB, res) => {
    try {
      const validatedData = passwordResetSchema.parse(req.body);
      // Use dynamic database for password reset
      const dynamicDB = getRequestDB(req);
      const result = await authService.resetPasswordWithDB(validatedData, dynamicDB);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(400).json({ 
        success: false, 
        message: "Invalid reset data" 
      });
    }
  });

  // Verify email
  app.get('/api/auth/verify-email', async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ 
          success: false, 
          message: "Verification token required" 
        });
      }
      
      const result = await authService.verifyEmail(token);
      
      if (result.success) {
        res.redirect('/?verified=true');
      } else {
        res.redirect('/?verified=false');
      }
    } catch (error) {
      console.error("Email verification error:", error);
      res.redirect('/?verified=false');
    }
  });

  // Verify 2FA code
  app.post('/api/auth/verify-2fa', async (req, res) => {
    try {
      const validatedData = twoFactorVerifySchema.parse(req.body);
      res.json({ success: true, message: "2FA verification endpoint ready" });
    } catch (error) {
      res.status(400).json({ 
        success: false, 
        message: "Invalid 2FA data" 
      });
    }
  });

  // Enable 2FA
  app.post('/api/auth/enable-2fa', requireAuth, async (req: any, res) => {
    try {
      const result = await authService.enable2FA(req.user.id);
      res.json(result);
    } catch (error) {
      console.error("Enable 2FA error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to enable 2FA" 
      });
    }
  });

  // Disable 2FA
  app.post('/api/auth/disable-2fa', requireAuth, async (req: any, res) => {
    try {
      const result = await authService.disable2FA(req.user.id);
      res.json(result);
    } catch (error) {
      console.error("Disable 2FA error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to disable 2FA" 
      });
    }
  });

  // Username availability check
  app.post('/api/auth/check-username', async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ available: false, message: "Username required" });
      }
      
      const existingUser = await storage.getUserByUsername(username);
      res.json({ 
        available: !existingUser,
        message: existingUser ? "Username already taken" : "Username available"
      });
    } catch (error) {
      console.error("Username check error:", error);
      res.status(500).json({ available: false, message: "Check failed" });
    }
  });

  // Email availability check
  app.post('/api/auth/check-email', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ available: false, message: "Email required" });
      }
      
      const existingUser = await storage.getUserByEmail(email);
      res.json({ 
        available: !existingUser,
        message: existingUser ? "Email already registered" : "Email available"
      });
    } catch (error) {
      console.error("Email check error:", error);
      res.status(500).json({ available: false, message: "Check failed" });
    }
  });
}