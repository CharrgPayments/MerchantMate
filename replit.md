# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, and form processing. It provides a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management. The system supports various user types with role-based access, including merchants, agents, administrators, and corporate users.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (April 2026)
- **Epic C — Roles & Permission Matrix (rev 2)**:
  - **Per-action scope semantics**: `Scope = 'own' | 'downline' | 'all'` is now a first-class part of the registry. `DEFAULT_ACTION_GRANTS: Record<Action, Partial<Record<RoleCode, Scope>>>` replaces the previous role-list shape. Helpers `getActionScope(user, action, overrides)` + `maxScope()` return the broadest scope a user holds; `hasPermission` becomes a thin "scope !== null" check. `requirePerm` middleware attaches the resolved scope to `req.permScope` so downstream handlers can narrow data sets. super_admin always returns 'all' and cannot be revoked.
  - **Runtime overrides + audit**: New tables `role_action_grants` (PK role_code+action, scope, updated_by/at) and `role_action_audit` (id, role_code, action, prev_scope, new_scope, changed_by, changed_at) — Drizzle objects `roleActionGrants`/`roleActionAudit`, applied to dev + prod via `migrations/0008_role_action_grants.ts`. `server/permissionRegistry.ts` caches DB overrides (30s TTL, explicit invalidate after writes), merges with `DEFAULT_ACTION_GRANTS` via `getEffectiveGrants`, and writes audit rows on every change.
  - **Super-admin matrix UI** at `/roles-permissions` (`client/src/pages/roles-permissions.tsx`): role × action grid grouped by `ACTION_GROUPS` (Administration, Underwriting, Data Processing & Deployment, Sidebar Navigation). Each cell click cycles `none → own → downline → all`; cells with active overrides get a purple ring vs defaults. Destructive actions (`ADMIN_MANAGE`, `SUPERADMIN_ONLY`, `UNDERWRITING_APPROVE/DECLINE`, `DATA_PROCESSING_EDIT`, `DEPLOYMENT_MANAGE`) require an `AlertDialog` confirmation when escalating to `'all'`. Audit history panel below.
  - **Single source of truth for sidebar/UI gates**: Sidebar (`client/src/components/layout/sidebar.tsx`) rewritten to use one `requiresAction: Action` per nav item, evaluated through `hasPermission`. Hard-coded role arrays removed. 18 new `NAV_*` actions added to the registry (Dashboard, Agent Dashboard, Merchants, Locations, Agents, Prospects, Campaigns, Acquirers, Transactions, PDF Forms, Users, Reports, Security, Communications, Workflows, API Docs, Testing, Permission Matrix). `client/src/lib/authUtils.ts` `canAccessXxx` helpers refactored to delegate to `hasPermission(user, ACTIONS.X)` — no more duplicate `ROLE_PERMISSIONS` map driving sidebar.
  - **Role assignment fixed end-to-end**: `PATCH /api/users/:id/role` now validates against the live `role_definitions` table (queried via the request's dynamic DB), so the 4 new system roles + any custom role created via the role-definitions UI can be assigned. Returns 400 with the list of valid codes when invalid.
  - **New endpoints (super_admin only)**: `GET /api/admin/role-action-grants` (returns actions, labels, groups, destructive set, defaults, overrides), `PUT /api/admin/role-action-grants` (upsert + audit; rejects super_admin edits and invalid scopes), `GET /api/admin/role-action-audit` (recent change history).
  - Verified: matrix endpoints 200, toggle persists + audits, destructive confirmation triggers on upgrade-to-'all', super_admin edits rejected (400), invalid scope rejected (400), `/api/users/:id/role` accepts new roles. TS error count 612 → 611 (no new errors).
- **Epic C — Roles & Permission Matrix (rev 1)**: Added 4 new system roles — `underwriter`, `senior_underwriter`, `data_processing`, `deployment` — seeded into `role_definitions` (dev + prod) by `migrations/0007_seed_new_roles.ts`. Added `roleDefinitions` Drizzle table to `shared/schema.ts`. Created central permission registry at `shared/permissions.ts`. Added `requirePerm(action)` middleware to `server/replitAuth.ts`. Bulk-refactored 178 `requireRole([...])` call sites in `server/routes.ts` to `requirePerm('action-id')`.

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
- **Role-Based Access Control**: Granular permissions for various roles, including new system roles like `underwriter`, `senior_underwriter`, `data_processing`, and `deployment`, managed via a central permission registry.
- **Secure Authentication**: Session management, login attempt tracking, 2FA support, and password reset.
- **Merchant & Agent Hierarchy**: Supports multi-level agent and merchant hierarchies with parent tracking and closure tables for efficient subtree management.
- **Per-request DB context**: Uses Node `AsyncLocalStorage` to ensure each request uses its specific database environment.
- **Prospect Portal**: A dedicated portal for prospects with authentication, messaging, file requests (including inline base64 file storage), and magic link sign-in.
- **Notification System**: A robust notification bell system with user alerts, status indicators, and API for managing alerts.
- **PDF Processing**: Advanced PDF parsing with field type inference, section derivation, grouping, and structured warning generation. Includes PDF field mapping and generation of filled PDFs using `pdf-lib`. Original PDFs are stored as base64.
- **Workflow Definitions System**: Comprehensive CRUD for defining and managing automation workflows, endpoints, and environment configurations.
- **User Management**: Expanded user schema to include phone, communication preference, and password change requirements. Supports `text[]` for user roles.
- **SOC2 Compliance Features**: Comprehensive audit trail system with logging, security events, and login attempt tracking.
- **Multi-Environment Support**: Session-based database environment switching with login screen integration.
- **Dynamic Data Grid**: `ApiDataGrid` component for rendering template-powered, full-featured data grids with search, sort, and pagination.
- **Full-Page Data Viewer**: Route for viewing any webhook data-source template as a searchable/sortable grid.

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