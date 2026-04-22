// Global Express augmentation: gives `req.user` a precise shape so handlers
// don't need `req.user as any` casts.
//
// Two auth flows attach a user to `req.user`:
//   1. Passport-OIDC (Replit auth) — { claims: { sub, ... }, expires_at, ... }
//   2. Session-based custom auth — sets only req.session.userId; req.user
//      remains undefined and downstream code reads from req.session.
//
// We model the union of fields that may be present so callers can check
// `req.user?.claims?.sub` or `req.user?.expires_at` without casting.

import "express-session";

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
  }
}

export {};
