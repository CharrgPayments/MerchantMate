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
import { getDynamicDatabase } from "./db";
import { rateLimit } from "./rateLimits";

// Rate limiters for auth-sensitive endpoints. Per-IP and per-account
// (username/email) sliding windows; bursts get a 429 with Retry-After.
const loginLimiter = rateLimit({
  scope: 'auth:login',
  windowMs: 15 * 60_000,
  max: 10,
  keyExtractor: (req) =>
    (req.body && typeof req.body === 'object'
      ? (req.body.username || req.body.email)
      : undefined),
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

const forgotPasswordLimiter = rateLimit({
  scope: 'auth:forgot-password',
  windowMs: 60 * 60_000,
  max: 5,
  keyExtractor: (req) =>
    (req.body && typeof req.body === 'object' ? req.body.email : undefined),
  message: 'Too many password reset requests. Please try again later.',
});

const resetPasswordLimiter = rateLimit({
  scope: 'auth:reset-password',
  windowMs: 15 * 60_000,
  max: 10,
  keyExtractor: (req) =>
    (req.body && typeof req.body === 'object' ? req.body.token : undefined),
  message: 'Too many password reset attempts. Please try again later.',
});

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
    
    // Use dynamic database if available, otherwise fallback to default storage
    let user;
    if (req.dynamicDB) {
      const schema = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      const users = await req.dynamicDB
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, req.session.userId));
      
      const raw = users[0];
      user = raw ? { ...raw, role: (raw.roles?.[0] ?? (raw as any).role ?? "merchant") } : undefined;
    } else {
      user = await storage.getUser(req.session.userId);
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
  app.post('/api/auth/login', loginLimiter, async (req: RequestWithDB, res) => {
    try {
      const validatedData = loginUserSchema.parse(req.body);

      // Read ?db directly from query params — the domain-based override in
      // dbEnvironmentMiddleware would force production even when the user
      // explicitly chose Development or Test on the login screen.
      const dbParam = req.query.db as string | undefined;
      const allowedEnvs = ['dev', 'development', 'test'];
      const dbEnv = dbParam && allowedEnvs.includes(dbParam) ? dbParam : 'production';
      const dynamicDB = getDynamicDatabase(dbEnv);

      const result = await authService.loginWithDB(validatedData, req, dynamicDB);
      
      if (result.success && result.user) {
        // Store user session data including the ACTUAL chosen database environment
        req.session.userId = result.user.id;
        req.session.sessionId = result.sessionId || 'default-session';
        req.session.dbEnv = dbEnv;
        
        console.log(`Session created: userId=${result.user.id}, dbEnv=${dbEnv}`);
        
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

  // Forgot password — uses dbEnvironmentMiddleware so dev/test users can reset their passwords
  app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req: RequestWithDB, res) => {
    try {
      const validatedData = passwordResetRequestSchema.parse(req.body);
      // Always read ?db from query directly — the production-domain override in
      // dbEnvironmentMiddleware would block dev/test users from resetting their password
      const dbParam = req.query.db as string | undefined;
      const allowedEnvs = ['dev', 'development', 'test'];
      const dbEnv = dbParam && allowedEnvs.includes(dbParam) ? dbParam : 'production';
      const dynamicDB = getDynamicDatabase(dbEnv);
      const result = await authService.requestPasswordReset(validatedData, dynamicDB, dbEnv, req);
      res.json(result);
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(400).json({ 
        success: false, 
        message: "Invalid request data" 
      });
    }
  });

  // Reset password — always reads ?db directly so token is validated in the right DB
  app.post('/api/auth/reset-password', resetPasswordLimiter, async (req: RequestWithDB, res) => {
    try {
      const validatedData = passwordResetSchema.parse(req.body);
      const dbParam = req.query.db as string | undefined;
      const allowedEnvs = ['dev', 'development', 'test'];
      const dbEnv = dbParam && allowedEnvs.includes(dbParam) ? dbParam : 'production';
      const dynamicDB = getDynamicDatabase(dbEnv);
      const result = await authService.resetPassword(validatedData, dynamicDB);
      
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