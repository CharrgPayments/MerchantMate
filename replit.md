# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, form processing, and analytics. It offers role-based access for various user types (merchants, agents, administrators, corporate users). The project aims to provide a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management to gain a competitive edge. Key capabilities include enhanced field types, advanced PDF parsing, and progressive disclosure of owner fields.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Theming**: CSS variables for consistent look and feel.
- **Form Design**: React Hook Form with Zod validation.
- **Responsive Design**: Radix UI and shadcn/ui with Tailwind CSS.
- **Icon Color Coding**: Visual differentiation by user type (Agents: Blue, Merchants: Green, Prospects: Yellow).
- **Empty States**: Reusable EmptyState component for contextual guidance and CTAs when pages have no data.
- **Contextual Help**: Comprehensive contextual help system providing in-line guidance across major forms and modals using nested dialog components.
- **Bulk Actions**: Reusable BulkActionBar component with multi-select checkboxes, batch operations (delete, status updates), and role-based authorization across Prospects, Merchants, and Agents pages.

### Technical Implementations
- **Frontend**: React with TypeScript and Vite, TanStack Query, Wouter for routing.
- **Backend**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM on Neon serverless.
- **Authentication**: Session-based with `express-session`, PostgreSQL session store, and 2FA.
- **Email Service**: SendGrid for transactional emails with webhook integration, including a WYSIWYG editor (React Quill).
- **File Handling**: Multer for PDF form uploads.
- **Object Storage**: Replit Object Storage (GCS-backed) with presigned URLs, ACL-based access control, and owner-only file isolation.
- **User Account Field Type**: Enables automatic user account creation during form submissions with role and password management.

### Feature Specifications
- **Company-Centric Data Architecture**: Companies as the root entity.
- **Role-Based Access Control**: Database-backed RBAC system with Permission Manager UI for configuring role permissions. Supports 6 roles (merchant, agent, underwriter, admin, corporate, super_admin) with granular view/manage/execute actions on resources like pages, widgets, and features. Includes audit logging for permission changes.
- **Secure Authentication**: Session management, 2FA, password reset, strong password requirements.
- **Merchant & Agent Management**: Comprehensive profiles, assignment, status, fee management.
- **Location Management**: Polymorphic locations with geolocation and operating hours.
- **Transaction Processing**: Tracking, commission calculations, revenue analytics.
- **Form Management System**: PDF upload/parsing (including auto-detection for various field types), dynamic field generation, public access, conditional fields with real-time evaluation.
- **Dashboard System**: Personalized, widget-based dashboards with real-time analytics.
- **Digital Signature System**: Comprehensive signature capture and management with multi-role support, auto-detection from PDFs, canvas/typed capture methods, email workflows, status tracking, token-based security, and audit trails.
- **Address Validation & Autocomplete**: Google Maps Geocoding and Places Autocomplete integration.
- **Campaign Management**: Full CRUD for campaigns, pricing types, fee groups, equipment associations.
- **SOC2 Compliance Features**: Comprehensive audit trail, logging, security events, login attempt tracking.
- **Generic Trigger/Action Catalog System**: Extensible event-driven action system supporting multi-channel notifications and action chaining. Includes centralized `TRIGGER_KEYS` dictionary in `shared/triggerKeys.ts` with type-safe constants for all trigger events.
- **User Profile Management**: Self-service profile/settings page.
- **Unified Communications Management**: Consolidated dashboard for all communications features (Templates, Triggers, Activity & Analytics, Settings).
- **Email Configuration & Testing**: Settings tab in Communications Manager displays current SendGrid sender configuration and includes test email functionality.
- **Prospect Self-Service Portal**: Comprehensive portal for prospects to manage their application lifecycle, including auto-account creation, password setup, document management, notifications, status tracking, profile management, and automatic conversion to merchant.
- **Prospect Application Auto-Save**: Auto-save functionality with debounced saves for prospect application forms.
- **Generic Workflow/Ticketing System**: Reusable workflow engine supporting multi-stage processing pipelines with pluggable handlers, checkpoint reviews, issue/task tracking, and automated stage execution. Designed for underwriting automation but extensible to onboarding, support tickets, and compliance workflows.

### Workflow System Architecture
- **Workflow Definitions**: Configurable workflow templates with stages, handlers, and timeout rules.
- **Ticket Management**: Polymorphic tickets linked to any entity (prospects, merchants, locations) with full lifecycle tracking.
- **Stage Handlers**: Registry-based handler system for automated stages (MCC screening, KYB/KYC APIs, volume analysis) and manual checkpoints.
- **Issue Tracking**: Severity-based issues (blocker, critical, warning, info) with resolution/override workflows.
- **Task Management**: Assigned tasks with due dates and status tracking for manual review steps.
- **Checkpoint Resolution**: Approval/rejection workflows with required notes and audit trails.
- **Artifact Storage**: Stage-level artifact capture for API responses, documents, and verification results.

### System Design Choices
- **Testing Framework**: TDD-style with Jest and React Testing Library.
- **Schema Management**: Migration-first deployment pipeline with Drizzle's migration system for automated, deterministic, and auditable schema changes.
- **Multi-Environment Support**: Session-based database environment switching (Development, Test, Production) with a strict `Dev → Test → Production` promotion workflow.
- **Database Safety**: Strict protocols and wrapper scripts to prevent accidental production database modifications, including automatic backups and checksum validation for migrations.
- **User-Company Association Pattern**: All agent and merchant lookups MUST use the generic pattern: `User → user_company_associations → Company → Agent/Merchant`.
- **CRITICAL: Database Schema Change Workflow**: After every change to `shared/schema.ts`, a migration **MUST** be immediately generated using `tsx scripts/migration-manager.ts generate`.

### Production Protection (ENFORCED BY TOOLING)
**All scripts enforce the deployment pipeline: Development → Test → Production**

- **drizzle-env.ts**: BLOCKS `push` and `generate` against Production. Use `--force-production` for emergencies.
- **migration-manager.ts**: BLOCKS `apply prod`. Use `promote test prod` to deploy certified changes.
- **execute-sql.ts**: BLOCKS production SQL without `--force-production` flag.

**ALLOWED OPERATIONS:**
```bash
tsx scripts/migration-manager.ts apply dev           # Apply to development
tsx scripts/migration-manager.ts apply test          # Apply to test
tsx scripts/migration-manager.ts promote test prod   # Promote certified changes
tsx scripts/drizzle-env.ts --env development push    # Push schema to development
```

**BLOCKED OPERATIONS (without --force-production):**
```bash
tsx scripts/migration-manager.ts apply prod          # BLOCKED
tsx scripts/drizzle-env.ts --env production push     # BLOCKED
tsx scripts/execute-sql.ts --env production --sql    # BLOCKED
```

See `MIGRATION_WORKFLOW.md` for complete deployment pipeline documentation.

### Testing & Database Utilities

#### Test Data Management
- **Test Data Cleanup**: `scripts/cleanup-test-data.ts` - Cleans up prospect, application, and optionally agent test data from specified environment.
  ```bash
  # Using environment variable
  CORECRM_ENV=development tsx scripts/cleanup-test-data.ts
  
  # Using command-line argument
  tsx scripts/cleanup-test-data.ts --env development
  
  # Keep specific agents while cleaning
  tsx scripts/cleanup-test-data.ts --env development --include-agents --keep-agent 63
  
  # Dry run to preview changes
  tsx scripts/cleanup-test-data.ts --env development --dry-run
  ```

#### Database Tools
- **SQL Execution**: `scripts/execute-sql.ts` - Environment-aware SQL execution with safety features.
  ```bash
  # Query development database
  tsx scripts/execute-sql.ts --env development --sql "SELECT * FROM agents"
  
  # Execute SQL from file
  tsx scripts/execute-sql.ts --env test --file scripts/seed.sql
  
  # Dry run to preview query
  tsx scripts/execute-sql.ts --env development --sql "DELETE FROM prospects" --dry-run
  ```
- **Drizzle Environment Wrapper**: `scripts/drizzle-env.ts` - Runs drizzle-kit commands against the correct database.
  ```bash
  # Push schema to development (RECOMMENDED for schema changes)
  tsx scripts/drizzle-env.ts --env development push
  
  # Generate migrations from development schema
  tsx scripts/drizzle-env.ts --env development generate
  
  # Push with force flag
  tsx scripts/drizzle-env.ts --env development push --force
  
  # Open Drizzle Studio for development
  tsx scripts/drizzle-env.ts --env development studio
  ```
- **Database Management**: `scripts/database-management.js` - Database environment setup and management.
- **Schema Sync**: `scripts/sync-database-schemas.ts` - Synchronize schemas across environments.

#### Environment Configuration
- **CORECRM_ENV**: Environment variable to specify target database (development, test, production)
- **--env flag**: Command-line alternative to CORECRM_ENV for all database scripts
- **Safety**: Production operations require explicit `--force-production` flag

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