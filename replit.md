# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, and form processing. It provides a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management. The system supports various user types with role-based access, including merchants, agents, administrators, and corporate users.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (April 2026)
- **Epic C — Roles & Permission Matrix (rev 12)**: Addresses approved-with-comments items from the eleventh-pass review — `/form-demo` agent-parity regression and missing role-code validation on the generic user-edit endpoint.
  - **`NAV_AGENTS` defaults restored for `agent`**: `DEFAULT_ACTION_GRANTS[ACTIONS.NAV_AGENTS]` now grants `agent: 'downline'` (parity with the legacy `canAccessAgentManagement` behaviour). `/agents`, `/form-demo`, and the sidebar Agents link are once again accessible to the agent role under default grants.
  - **`PATCH /api/users/:id` now validates `roles[]` against `role_definitions`**: the same live-catalog check used by `PATCH /api/users/:id/role` is reused so non-catalog role codes can't sneak in via the generic edit form. 400 with `{message, invalid, validCodes}` on mismatch.
- **Epic C — Roles & Permission Matrix (rev 11)**: Closes tenth-pass review (lingering hardcoded auth helpers in `client/src/lib/rbac.ts`, missing 4 new roles in users-page fallback, AI-slop comments).
  - **`client/src/lib/rbac.ts` rewritten as a pure registry-bridge**: removed the role-based authorization functions `hasPermission` / `hasAnyPermission` / `hasAllPermissions` / `shouldFilterByUser` / `getUserDataScope`. `ROLE_PERMISSIONS` and `PERMISSIONS` are now explicitly DISPLAY-ONLY (consumed only by the Permission Matrix tab in `users.tsx` for human-readable labels). Every exported authorization helper (`canAccess*`, `canPerformAction`, `hasRole`, `hasAnyRole`) now delegates to the runtime registry via `hasActionPermission` / `hasRoleCode` from `@shared/permissions`.
  - **`users.tsx` fallback role list completed**: added the 4 system roles introduced in rev 1 (`underwriter`, `senior_underwriter`, `data_processing`, `deployment`) so admins can still assign them in the multi-role checkbox even if `/api/role-definitions` hasn't been fetched yet.
  - **AI-slop comments trimmed**: the verbose narrative blocks in `server/replitAuth.ts` (above `requirePerm`) and `client/src/lib/rbac.ts` (above the `ROLE_PERMISSIONS` map) are now concise, local-style comments.
- **Epic C — Roles & Permission Matrix (rev 10)**: Closes ninth-pass review (sidebar/route action mismatch on `/pdf-naming-guide`, lingering `as any` in dashboard).
  - **Sidebar/route parity for `/pdf-naming-guide`**: route guard switched to `can(ACTIONS.NAV_ACQUIRERS)` (sidebar already groups it under Acquirers). Toggling NAV_ACQUIRERS now consistently shows/hides nav AND grants/denies the route.
  - **Removed `as any` cast in `PersonalizedDashboard`**: `hasRole(r as any)` → typed `hasRole(r: RoleCode)` against `getUserRoleCodes(user)`.
- **Epic C — Roles & Permission Matrix (rev 9)**: Fixes ALS-context loss in rev 8's order-tolerant `requirePerm` fallback (storage.getUser was silently hitting prod after the await boundary).
  - **`requirePerm` env resolution is now ALS-safe**: instead of awaiting an inline `dbEnvironmentMiddleware` (whose `runWithDb(...)` ALS frame is dropped at the `await` boundary), the guard now (a) reads `req.session.dbEnv` directly to derive the env when upstream middleware was skipped, (b) takes a direct `dbForEnv` handle via `getDynamicDatabase(env)`, and (c) wraps the `storage.getUser(userId)` lookup in `runWithDb(dbForEnv, …)` so the per-env DB is guaranteed to be queried regardless of upstream middleware order.
- **Epic C — Roles & Permission Matrix (rev 8)**: Closes seventh-pass review (middleware ordering, lingering hardcoded role checks, `/pdf-naming-guide` guard, sidebar `any` casts).
  - **`requirePerm` is now order-tolerant** (superseded by rev 9 ALS fix below).
  - **Sidebar fully off raw `user.role`**: removed `(user as any)?.firstName`, `(user as any)?.lastName`, `(user as any)?.roles?.includes('super_admin')` and the legacy `user.role` fallback. Crown icon is now driven by `can(ACTIONS.SUPERADMIN_ONLY)` from the registry; name uses the typed `User` shape from `@shared/schema`.
  - **`PersonalizedDashboard` migrated**: dropped `hasPermission(user, 'manage_dashboard')` (action wasn't in the registry) → `can(ACTIONS.ADMIN_MANAGE)`. Role-keyed widget map + tip badges now read `getUserRoleCodes(user)` and key off `ROLE_CODES.*` constants instead of `user.role` strings, supporting multi-role users.
  - **`/pdf-naming-guide` route guarded**: `can(ACTIONS.NAV_PDF_FORMS)` (was the last unguarded sidebar-listed route).
  - TS error count: 609 (down from 611, no regression).
- **Epic C — Roles & Permission Matrix (rev 7)**: Closes sixth-pass review (open `/api/users` endpoint, two unguarded routes, leftover `requireRole` in testing.ts).
  - **`GET /api/users` now properly gated**: added `isAuthenticated` + `requirePerm('admin:read')` (was wide open under a "development bypass" comment). Removed `console.log('Users found:', …full list…)` PII leak from same handler.
  - **App.tsx route guard parity**: `/pdf-forms` → `can(ACTIONS.NAV_PDF_FORMS)`; `/agent-dashboard` → `can(ACTIONS.NAV_AGENT_DASHBOARD)`. These were the last sidebar-listed routes without page-level guards.
  - **`server/routes/testing.ts` migrated to `requirePerm`**: 3 endpoints (`/test-files`, `/run-tests`, `/coverage-summary`) flipped from `requireRole(['super_admin'])` to `requirePerm('system:superadmin')`. Legacy `requireRole` import removed from this file.
- **Epic C — Roles & Permission Matrix (rev 6)**: Aligned every App.tsx route guard to its sidebar action — `/prospects`→`NAV_PROSPECTS`; `/campaigns*`+`/equipment`→`NAV_CAMPAIGNS`; `/acquirers`+`/mcc-codes`+`/mcc-policies`+`/disclosure-library`+`/application-templates`→`NAV_ACQUIRERS`; `/workflows`→`NAV_WORKFLOWS`; `/api-documentation`→`NAV_API_DOCS`; `/testing-utilities`→`NAV_TESTING`. Sidebar plumbing fully typed (`LucideIcon`, `RenderedNavItem`, `useQuery<PdfForm[]>`, no `any` casts).
- **Epic C — Roles & Permission Matrix (rev 5)**: All App.tsx route guards now registry-driven (`/roles-permissions` + `/action-templates` + `/data-view` + `/communications` use `can(...)`). New `NAV_ACTION_TEMPLATES`/`NAV_DATA_VIEW` actions added. `DEFAULT_ACTION_GRANTS` parity restored for `NAV_LOCATIONS` (admin/corporate/agent/merchant) and `NAV_REPORTS` (agent). Static `ROLE_PERMISSIONS` map retired from `client/src/lib/rbac.ts` authorization helpers.
- **Epic C — Roles & Permission Matrix (rev 4)**: Per-environment override cache (`Map<env, {data, at}>` in `server/permissionRegistry.ts` keyed on `req.dbEnv`). True multi-role assignment end-to-end (`storage.updateUserRoles`, `PATCH /api/users/:id/role` accepts `roles: string[]`, multi-checkbox UI in `client/src/pages/users.tsx`). `as any` removed from `req.user = …` in `requirePerm`.
- **Epic C — Roles & Permission Matrix (rev 3)**: New `GET /api/auth/permissions` returns effective scope map; client `usePermissions` hook + sidebar/all 23 App.tsx guards consult it. Matrix mutation invalidates the permissions query so toggles take effect immediately.
- **Epic C — Roles & Permission Matrix (rev 2)**: Per-action `Scope = 'own' | 'downline' | 'all'` with `DEFAULT_ACTION_GRANTS` + DB overrides table (`role_action_grants`) and audit (`role_action_audit`). Super-admin matrix UI at `/roles-permissions`. `req.permScope` attached by middleware. `PATCH /api/users/:id/role` validates against live `role_definitions`.
- **Epic C — Roles & Permission Matrix (rev 1)**: 4 new system roles seeded (`underwriter`, `senior_underwriter`, `data_processing`, `deployment`). Central registry at `shared/permissions.ts`. `requirePerm(action)` middleware introduced and 178 `requireRole([...])` call sites in `server/routes.ts` migrated.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI Components**: Radix UI with shadcn/ui and Tailwind CSS for styling, supporting theming via CSS variables.
- **State Management**: TanStack Query for server state.
- **Routing**: Wouter for client-side routing.
- **Forms**: React Hook Form with Zod validation.

### Backend Architecture
- **Framework**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM, deployed on Neon serverless.
- **Authentication**: Session-based authentication with `express-session` and PostgreSQL session store.
- **Email Service**: SendGrid for transactional emails.
- **File Handling**: Multer for PDF form uploads.

### Data Storage Solutions
- **Primary Database**: PostgreSQL for user, merchant, agent, location, transaction, and form data.
- **Session Storage**: PostgreSQL-based session store.
- **File Storage**: Server filesystem for uploaded PDF forms.

### Key Features & Design Patterns
- **Role-Based Access Control**: Granular permissions for various roles (e.g., `underwriter`, `senior_underwriter`, `data_processing`, `deployment`) managed via a central permission registry and runtime overrides.
- **Secure Authentication**: Session management, login attempt tracking, 2FA support, and password reset.
- **Merchant & Agent Hierarchy**: Supports multi-level agent and merchant hierarchies with parent tracking and closure tables.
- **Per-request DB context**: Uses Node `AsyncLocalStorage` for specific database environment per request.
- **Prospect Portal**: Dedicated portal with authentication, messaging, file requests, and magic link sign-in.
- **Notification System**: Robust notification bell system with user alerts and API.
- **PDF Processing**: Advanced PDF parsing, field mapping, and generation of filled PDFs using `pdf-lib`.
- **Workflow Definitions System**: CRUD for defining and managing automation workflows, endpoints, and environment configurations.
- **User Management**: Expanded user schema, including `text[]` for user roles.
- **SOC2 Compliance Features**: Comprehensive audit trail system with logging, security events, and login attempt tracking.
- **Multi-Environment Support**: Session-based database environment switching.
- **Dynamic Data Grid**: `ApiDataGrid` component for template-powered data grids with search, sort, and pagination.
- **Full-Page Data Viewer**: Route for viewing any webhook data-source template.

## External Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL connector.
- **drizzle-orm**: Type-safe ORM for PostgreSQL.
- **@sendgrid/mail**: SendGrid email API client.
- **@tanstack/react-query**: React server state management.
- **@radix-ui/**\*: UI component primitives.
- **bcrypt**: Password hashing.
- **speakeasy**: Two-factor authentication.
- **express-session**: Session management middleware.
- **connect-pg-simple**: PostgreSQL session store.
- **multer**: Middleware for handling `multipart/form-data`.
- **google-maps-services-js**: Google Maps Geocoding and Places APIs.
- **pdf-lib**: For PDF manipulation and form filling.