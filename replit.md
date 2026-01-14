# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, form processing, and analytics. It offers role-based access for various user types (merchants, agents, administrators, corporate users). The project aims to provide a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management to gain a competitive edge.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Theming**: CSS variables for consistent look and feel.
- **Form Design**: React Hook Form with Zod validation.
- **Responsive Design**: Radix UI and shadcn/ui with Tailwind CSS.
- **Icon Color Coding**: Visual differentiation by user type (Agents: Blue, Merchants: Green, Prospects: Yellow).
- **Empty States**: Reusable EmptyState component for contextual guidance and CTAs when pages have no data.
- **Contextual Help**: Comprehensive contextual help system using nested dialog components.
- **Bulk Actions**: Reusable BulkActionBar component with multi-select, batch operations, and role-based authorization.

### Technical Implementations
- **Frontend**: React with TypeScript and Vite, TanStack Query, Wouter for routing.
- **Backend**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM on Neon serverless.
- **Authentication**: Session-based with `express-session`, PostgreSQL session store, and 2FA.
- **Email Service**: SendGrid for transactional emails with webhook integration and a WYSIWYG editor.
- **File Handling**: Multer for PDF form uploads.
- **Object Storage**: Replit Object Storage (GCS-backed) with presigned URLs, ACLs, and owner-only file isolation.

### Feature Specifications
- **Company-Centric Data Architecture**: Companies as the root entity.
- **Role-Based Access Control**: Database-backed RBAC with Permission Manager UI supporting 6 roles and granular view/manage/execute actions, including audit logging.
- **Secure Authentication**: Session management, 2FA, password reset, strong password requirements, forced password change for temporary passwords, and 12-month password history compliance (prevents password reuse).
- **Merchant & Agent Management**: Comprehensive profiles, assignment, status, fee management.
- **Location Management**: Polymorphic locations with geolocation and operating hours.
- **Transaction Processing**: Tracking, commission calculations, revenue analytics.
- **Form Management System**: PDF upload/parsing, dynamic field generation, public access, conditional fields.
- **Dashboard System**: Personalized, widget-based dashboards with real-time analytics.
- **Digital Signature System**: Comprehensive signature capture and management with multi-role support, auto-detection from PDFs, email workflows, and audit trails.
- **Address Validation & Autocomplete**: Google Maps Geocoding and Places Autocomplete integration.
- **Campaign Management**: Full CRUD for campaigns, pricing types, fee groups, equipment associations.
- **SOC2 Compliance Features**: Comprehensive audit trail, logging, security events, login attempt tracking.
- **Generic Trigger/Action Catalog System**: Extensible event-driven action system supporting multi-channel notifications and action chaining.
- **User Profile Management**: Self-service profile/settings page.
- **Unified Communications Management**: Consolidated dashboard for all communications features.
- **Prospect Self-Service Portal**: Comprehensive portal for prospects to manage application lifecycle, including auto-account creation, document management, and automatic conversion to merchant.
- **Prospect Application Auto-Save**: Auto-save functionality with debounced saves for prospect application forms.
- **Agent Communications**: Unified communications page for agents to view and respond to prospect messages with integrated notifications feed. Features conversation threading, unread badges, and reply functionality.
- **Generic Workflow/Ticketing System**: Reusable workflow engine supporting multi-stage processing pipelines with pluggable handlers, checkpoint reviews, issue/task tracking, and automated stage execution.
- **Disclosure Fields**: Scrollable disclosure components with mandatory scroll-through tracking and signature acknowledgment. Captures audit data (scroll start/completion times, duration, IP address) for compliance. Signature unlocks only after 100% scroll completion.
- **Editable Draft Disclosure Versions**: Disclosure versions with zero signatures are editable (title, version number, content). Once a signature is collected, the version becomes locked for compliance. Content hash is recalculated on edit. UI shows "Edit Draft" button for editable versions and "Locked" badge for versions with signatures.
- **PDF Rehydration**: Automatic generation of completed application PDFs on submission. Original PDF templates are filled with collected data and signatures using pdf-lib. Generated PDFs are stored in Object Storage with ACL rules granting access to PROSPECT_OWNER, ASSIGNED_AGENT, and ADMIN roles.
- **MCC Policy Management**: Admin UI for managing Merchant Category Code (MCC) policies used in underwriting decisions. Normalized data model with `mcc_codes` lookup table (136 codes across 10 categories) and `mcc_policies` table for policy rules. Supports policy types (allowed, requires_review, high_risk, prohibited), risk level overrides, and acquirer-specific policies. Accessible to admin, super_admin, and underwriter roles.

### System Design Choices
- **Testing Framework**: TDD-style with Jest and React Testing Library.
- **Schema Management**: Migration-first deployment pipeline with Drizzle's migration system.
- **Multi-Environment Support**: Session-based database environment switching (Development, Test, Production) with a strict `Dev → Test → Production` promotion workflow.
- **Database Safety**: Strict protocols and wrapper scripts to prevent accidental production database modifications.
- **User-Company Association Pattern**: All agent and merchant lookups MUST use the generic pattern: `User → user_company_associations → Company → Agent/Merchant`.
- **CRITICAL: Database Schema Change Workflow**: After every change to `shared/schema.ts`, a migration **MUST** be immediately generated using `tsx scripts/migration-manager.ts generate`.
- **Production Protection**: Scripts enforce deployment pipeline (`Development → Test → Production`) blocking direct operations on production without explicit `--force-production`.

### CRITICAL: Database Push Commands
**🚨 NEVER run `npm run db:push` directly! It pushes to PRODUCTION! 🚨**

Use the SAFE push script instead:

```bash
# ✅ CORRECT - Always use these commands:
node scripts/db-push-safe.js dev       # Push to DEVELOPMENT (default for new features)
node scripts/db-push-safe.js test      # Push to TEST environment
node scripts/db-push-safe.js prod      # Push to PRODUCTION (requires confirmation)

# ❌ WRONG - NEVER do this:
npm run db:push                        # DANGER: This pushes directly to PRODUCTION!
DATABASE_URL=$DEV_DATABASE_URL npm run db:push  # Unreliable - variable substitution can fail
```

**Why the Safe Script?**
- `drizzle.config.ts` uses `DATABASE_URL` which points to PRODUCTION
- Shell variable substitution like `DATABASE_URL=$DEV_DATABASE_URL npm run db:push` is unreliable
- The safe script explicitly overrides the database URL and requires confirmation for production

**Development Workflow:**
1. Make schema changes in `shared/schema.ts`
2. Push to DEV first: `node scripts/db-push-safe.js dev`
3. Test the feature in development
4. Push to TEST: `node scripts/db-push-safe.js test`
5. Validate in test environment
6. Only then push to PROD: `node scripts/db-push-safe.js prod` (will ask for confirmation)

### Field Naming Convention (Application Templates)
Uses period (`.`) delimiter for hierarchical field names in application templates: `section.subsection.fieldName` or `section.index.fieldName`.

### "Other" Option Auto-Detection
Radio buttons and checkbox lists automatically detect options with the label "Other" (case-insensitive). When an "Other" option is selected/checked:
- A required text input appears below the field prompting "Please specify"
- The value is stored in a separate field named `{fieldName}_other`
- The text input is cleared automatically when a different option is selected/unchecked
- Visual validation feedback shows the field as required when empty

### Field Option Reordering (Drag-and-Drop)
Field options (for select, radio, checkbox-list, and boolean field types) can be reordered using drag-and-drop or keyboard-accessible up/down arrow buttons.

**Implementation Details:**
- Uses @dnd-kit library with `SortableContext` and `useSortable` hook
- Each option is assigned a stable `_sortId` (UUID) on dialog open for reliable drag-and-drop
- Options are normalized to structured objects when the field editor opens
- The `_sortId` is stripped before saving to avoid schema pollution
- Options support: label, value, pdfFieldId (for PDF mapping), and conditional triggers

**UI Features:**
- Drag handle (grip icon) for mouse/touch reordering
- Up/down arrow buttons for keyboard accessibility
- Visual position indicator (#1, #2, etc.)
- Smooth transition animations during drag

## External Dependencies
- **pg**: Native PostgreSQL driver.
- **drizzle-orm**: Type-safe ORM for PostgreSQL.
- **@sendgrid/mail**: SendGrid email API client.
- **@anthropic-ai/sdk**: AI integration.
- **@tanstack/react-query**: React server state management.
- **@radix-ui/**\*: UI component primitives.
- **bcrypt**: Password hashing.
- **speakeasy**: Two-factor authentication.
- **express-session**: Session management middleware.
- **connect-pg-simple**: PostgreSQL session store.
- **multer**: Middleware for handling `multipart/form-data`.
- **react-quill**: WYSIWYG rich text editor.
- **google-maps-services-js**: Google Maps Geocoding and Places APIs.
- **@google-cloud/storage**: Google Cloud Storage client for Replit Object Storage integration.