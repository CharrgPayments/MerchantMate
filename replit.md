# Core CRM - Merchant Payment Processing System

## Recent Changes (April 2026)
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