// Global Express + express-session augmentations.
//
// Centralizing these typed shapes lets request handlers access
// `req.user`, `req.session`, and the DB-middleware-attached fields
// (`req.dbEnv`, `req.dynamicDB`, `req.currentUser`, `req.permScope`,
// `req.userId`) without the noisy untyped casts that used to litter
// `server/routes.ts`.
//
// Two auth flows attach a user to `req.user`:
//   1. Passport-OIDC (Replit auth) — { claims: { sub, ... }, expires_at, ... }
//   2. Session-based custom auth — sets only req.session.userId; req.user
//      remains undefined and downstream code reads from req.session.

import "express-session";
import type { getDynamicDatabase } from "../db";

declare global {
  namespace Express {
    interface User {
      id?: string;
      claims?: {
        sub?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        profile_image_url?: string;
        [key: string]: unknown;
      };
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      [key: string]: unknown;
    }

    interface Request {
      // Populated by `dbEnvironmentMiddleware` (see server/dbMiddleware.ts).
      dbEnv?: string;
      dynamicDB?: ReturnType<typeof getDynamicDatabase>;
      db?: ReturnType<typeof getDynamicDatabase>;
      userId?: string;
      // RBAC scope set by `requirePerm`.
      permScope?: 'own' | 'downline' | 'all';
      // Resolved DB user attached by the auth middlewares so handlers
      // don't have to re-fetch it.
      currentUser?: {
        id: string;
        username?: string | null;
        roles?: string[] | null;
        role?: string | null;
        [key: string]: unknown;
      } | null;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    // Custom session-based auth (server/authRoutes.ts).
    userId?: string;
    sessionId?: string;
    user?: unknown;
    // Selected DB environment for this session.
    dbEnv?: string;
    // Passport stash (cleared on environment switch).
    passport?: unknown;
    // Prospect portal magic-link auth. portalProspectId is the numeric
    // merchantProspects.id (not a UUID).
    portalProspectId?: number;
    portalProspectEmail?: string;
    portalDbEnv?: string;
  }
}

export {};
