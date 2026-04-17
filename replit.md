# Core CRM - Merchant Payment Processing System

## Recent Changes (April 2026)
- **Epic A — Hierarchy Foundation (agents + merchants)**: Added `parent_agent_id`/`parent_merchant_id` columns and `agent_hierarchy`/`merchant_hierarchy` closure tables (composite PK, depth column, indexed both directions) to `shared/schema.ts`. Created `server/hierarchyService.ts` with cycle detection, MAX_HIERARCHY_DEPTH=5 enforcement, subtree-move via raw SQL, and backfill helpers. Routes: POST `/api/agents` and POST `/api/merchants` now initialize closures + apply parent. Added the previously-missing PUT `/api/agents/:id` and PUT `/api/merchants/:id` (edit modal was silently broken before). New: GET `/api/agents/hierarchy/tree`, `/api/merchants/hierarchy/tree`, `/api/agents/:id/descendants`, `/api/merchants/:id/descendants`. Frontend: agent-modal and merchant-modal include a parent picker (excludes self + descendants, "__none__" sentinel for root). Agents page renders an indented tree view (depth × 24px paddingLeft, "└─" prefix, "Sub-agent · L{n}" caption) using the tree endpoint as a depth lookup. Schema applied to dev + prod via `scripts/migrate-hierarchy.ts` (raw SQL because drizzle-kit's interactive rename prompts mis-classify new tables); closures backfilled on both DBs.
- **Per-request DB context (architectural)**: `server/db.ts` now uses Node `AsyncLocalStorage` (`runWithDb`, `getActiveDb`) and exports `db` as a Proxy that forwards to the request-bound DB when one is set, falling back to the static production DB otherwise. `server/dbMiddleware.ts` wraps `next()` with `runWithDb(req.dynamicDB, next)` in all four resolution branches. Result: every `storage.*` call, `auditService` call, and any other code reaching the `db` import now automatically uses the database selected at login (session.dbEnv) — no call-site changes required. This fixes the long-standing bug where `storage.getUser`, `storage.getAgentByEmail`, etc. silently queried production even when the session selected dev. The `crm.charrg.com` lock to production still wins.
- **Agent dashboard endpoints rewritten**: `/api/agent/dashboard/stats` and `/api/agent/applications` now do their user/agent/prospect lookups via `getRequestDB(req)` directly (look up agent by `userId` first, then fall back to email). The old `storage.getUser → getAgentByEmail` chain returned 404 "User not found" for any session bound to a non-production DB.
- **Prospect Portal**: Full portal system built. Schema: added `portal_password_hash`, `portal_setup_at` to `merchant_prospects`; new `prospect_messages` (matching existing DB table), `prospect_file_requests` (new, with inline base64 file storage), `portal_magic_links` (for password-free one-click sign-in, 24h expiry, single-use) tables — migrations run against dev + prod. Backend: portal-auth routes (setup-password, login, logout, me, magic-link-request, magic-link-login) + portal-data routes (messages, file-requests, upload) + CRM-side routes (prospect messages CRUD, file-requests CRUD/download/approve/reject, send-portal-invite). Email notifications: agents can send portal invite emails; prospects are emailed when agent sends a message or file request. Frontend: `/portal/login` (two-tab: password + email-link/magic-link), `/portal/magic-login` (token-exchange handler), `/portal` dashboard (status + chat thread + document upload tabs), `application-status.tsx` with portal account setup card, `application-view.tsx` with Applicant Portal section (Messages + Document Requests tabs + "Send Portal Invite" button). Session: prospect portal uses `req.session.portalProspectId` separate from CRM session.
- **Notification Bell fully wired**: Added `userAlerts` Drizzle table definition to `shared/schema.ts` (was in DB but missing from schema). Added all 6 backend API routes: `GET /api/alerts`, `GET /api/alerts/count`, `PATCH /api/alerts/:id/read`, `POST /api/alerts/read-all`, `DELETE /api/alerts/:id`, `DELETE /api/alerts/read/all`. Updated `client/src/components/layout/header.tsx` bell button to open a Popover notification panel: live unread badge, per-alert type icons (info/warning/error/success), relative timestamps, per-alert mark-read button, "Mark all read" button, action URL navigation, and "View all notifications" link to `/alerts`.
- **PDF Field Naming Guide**: Added comprehensive in-app documentation page at `/pdf-naming-guide` (`client/src/pages/pdf-naming-guide.tsx`). Covers the dot-notation naming convention for PDF form fields: section prefixes, auto-detected field types (email, phone, date, currency, etc.), grouped field types (radio, checkbox-list, boolean, address), full examples, and step-by-step PDF creation instructions. Linked from sidebar under Acquirers and from the Application Templates page header via a "Naming Guide" button.
- **PDF Parser Hardening**: Complete rewrite of `server/pdfParser.ts` with: `FieldType` union type (20+ types); `ParseWarning` with severity levels; `ParseResult` with `warnings` and `summary` fields; centralized `SECTION_MAP` and `FIELD_TYPE_RULES`; `groupAcroFormFields()` and `classifySkippedField()` as standalone exported functions; skipped fields generate structured warnings instead of being silently dropped. New diagnostic endpoint `GET /api/acquirer-application-templates/:id/parse-diagnostics` returns full parse analysis for admin review. Comprehensive unit tests in `server/pdfParser.test.ts` (109 tests covering field type inference, section derivation, grouping, warnings).
- **Workflow Definitions system**: Added `workflow_definitions`, `workflow_endpoints`, and `workflow_environment_configs` tables. Full CRUD API at `/api/admin/workflows` with GET/POST/PUT/DELETE for workflows, endpoints, and environment configs. Frontend page `client/src/pages/workflows.tsx` with split-panel UI added; sidebar nav item added with `Zap` icon.
- **User schema additions**: Added `phone`, `communicationPreference`, and `mustChangePassword` fields to the `users` table (both dev and prod databases updated via `ALTER TABLE`).
- **Role array support**: `users.roles` is now `text[]`. A `withRole()` shim adds backward-compatible `role = roles[0]` on all user-returning methods. `normalizeLegacyRole()` typed helper converts legacy `role` string to `roles` array without `any` casts.
- **Route access control**: `/workflows`, `/security`, `/audit-trail`, and related routes use `canAccessSecurityDashboard(user)` from `client/src/lib/rbac.ts` instead of hardcoded role string comparisons.
- **Env-config full CRUD**: Added POST and DELETE handlers for workflow environment configs alongside the existing GET and PUT.
- **PDF Field Mapping & Filled PDF Generation**: Original uploaded PDFs are stored as base64 in `original_pdf_base64` column on `acquirer_application_templates`. On application submission, the system uses `pdf-lib` to open the original template PDF, fill in form fields with collected data using the pdfFieldId mapping, and saves the filled PDF to `uploads/generated-pdfs/`. The `generatedPdfPath` is stored on `prospect_applications`. Prospects can download their filled PDF from the Application Status page via `/api/prospects/download-filled-pdf/:token`. The existing `/api/prospects/:id/download-pdf` endpoint also checks for filled PDFs first, falling back to generic generation. Key admin endpoints: GET/PUT `/api/acquirer-application-templates/:id/field-mapping` for mapping management, POST `/:id/upload-pdf` for re-uploading original PDFs. Frontend shows `PdfFieldMappingView` with mapped/unmapped indicators and `UploadOriginalPdf` button in template viewer.

## Overview
Core CRM is a comprehensive merchant payment processing management system that streamlines merchant onboarding, transaction management, location tracking, form processing, and analytics. It's designed with role-based access for various user types, including merchants, agents, administrators, and corporate users, aiming to provide a robust, scalable, and secure platform for payment processing businesses. The business vision is to empower businesses with efficient, transparent, and secure payment management, offering a competitive edge in the market.

## User Preferences
Preferred communication style: Simple, everyday language.

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
- **Role-Based Access Control**: Granular permissions for `merchant`, `agent`, `admin`, `corporate`, `super_admin` roles.
- **Secure Authentication**: Session management, login attempt tracking, 2FA support, and password reset.
- **Merchant & Agent Management**: Comprehensive profiles, assignment, status tracking, and fee management.
- **Location Management**: Multiple locations per merchant with geolocation and operating hours.
- **Transaction Processing**: Tracking, commission calculations, and revenue analytics.
- **Form Management System**: PDF upload/parsing, dynamic field generation, and public access.
- **Dashboard System**: Personalized, widget-based dashboards with real-time analytics.
- **Digital Signature**: Inline canvas-based and typed signature functionality with email request workflows.
- **Address Validation**: Google Maps Geocoding and Places Autocomplete integration.
- **Campaign Management**: Full CRUD for campaigns, pricing types, fee groups, and equipment associations.
- **SOC2 Compliance Features**: Comprehensive audit trail system with logging, security events, and login attempt tracking.
- **Testing Framework**: TDD-style with Jest and React Testing Library for component, page, API, and schema tests, including a visual testing dashboard.
- **Schema Management**: Comprehensive database schema comparison and synchronization utilities supporting production, development, and test environments. Features automated difference detection, bidirectional sync options (Drizzle push and selective table sync), and interactive management interface in Testing Utilities.
- **Multi-Environment Support**: Complete session-based database environment switching with login screen environment selector integration, ensuring proper ACID compliance and environment isolation across all authenticated routes. Database environment is selected during login via `?db=development` parameter and persisted throughout the entire session.
- **Workflow Definitions**: Implemented complete Workflow Definitions system for configuring and managing automation workflows.
- **ApiDataGrid component**: New standalone `<ApiDataGrid templateId={N} />` component in `client/src/components/ApiDataGrid.tsx` — drop into any page to render a template-powered full-featured data grid with search, multi-column sort, pagination, and 3-level field label cascade (widget override → template label → auto-humanize).
- **Full-page data viewer**: `/data-view/:templateId` route (`client/src/pages/data-view.tsx`) renders any webhook data-source template as a full-page searchable/sortable grid. Action Templates list shows a "View Grid" button on all data-source templates to open this view.

## External Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL connector.
- **drizzle-orm**: Type-safe ORM for PostgreSQL.
- **@sendgrid/mail**: SendGrid email API client.
- **@anthropic-ai/sdk**: AI integration (potential future use).
- **@tanstack/react-query**: React server state management.
- **@radix-ui/**\*: UI component primitives.
- **bcrypt**: Password hashing.
- **speakeasy**: Two-factor authentication.
- **express-session**: Session management middleware.
- **connect-pg-simple**: PostgreSQL session store.
- **multer**: Middleware for handling `multipart/form-data`.
- **google-maps-services-js**: Google Maps Geocoding and Places APIs.