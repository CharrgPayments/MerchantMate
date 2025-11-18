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

### Technical Implementations
- **Frontend**: React with TypeScript and Vite, TanStack Query, Wouter for routing.
- **Backend**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM on Neon serverless.
- **Authentication**: Session-based with `express-session`, PostgreSQL session store, and 2FA.
- **Email Service**: SendGrid for transactional emails with webhook integration, including a WYSIWYG editor (React Quill).
- **File Handling**: Multer for PDF form uploads.
- **Object Storage**: Replit Object Storage (GCS-backed) with presigned URLs, ACL-based access control, and owner-only file isolation.

### Feature Specifications
- **Company-Centric Data Architecture**: Companies as the root entity.
- **Role-Based Access Control**: Granular permissions for multiple roles.
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
- **Generic Trigger/Action Catalog System**: Extensible event-driven action system supporting multi-channel notifications and action chaining.
- **User Profile Management**: Self-service profile/settings page.
- **Unified Communications Management**: Consolidated dashboard for all communications features (Templates, Triggers, Activity & Analytics, Settings) accessed via `/communications` route.
- **Email Configuration & Testing**: Settings tab in Communications Manager displays current SendGrid sender configuration, provides instructions for changing sender email via environment variables, and includes test email functionality for all email templates.
- **Prospect Self-Service Portal**: Comprehensive portal for prospects to manage their application lifecycle, including automatic account creation, password setup, document management, notification system, status tracking, profile management, and automatic conversion to merchant upon approval.

### System Design Choices
- **Testing Framework**: TDD-style with Jest and React Testing Library.
- **Schema Management**: Migration-first deployment pipeline with Drizzle's migration system for automated, deterministic, and auditable schema changes.
- **Multi-Environment Support**: Session-based database environment switching (Development, Test, Production) with a strict `Dev → Test → Production` promotion workflow.
- **Database Safety**: Strict protocols and wrapper scripts to prevent accidental production database modifications, including automatic backups and checksum validation for migrations.
- **User-Company Association Pattern**: All agent and merchant lookups MUST use the generic pattern: `User → user_company_associations → Company → Agent/Merchant`.
- **CRITICAL: Database Schema Change Workflow**: After every change to `shared/schema.ts`, a migration **MUST** be immediately generated using `tsx scripts/migration-manager.ts generate`.

## Recent Changes (November 2025)

### User Account Field Type for Application Templates (November 18, 2025)

**Feature**: Comprehensive user account field type enabling automatic user account creation during form submissions.

**Frontend Implementation**:
- **Type Safety**: Replaced `validation?: any` with properly typed `FieldValidationConfig` union in DynamicFormRenderer
- **Schema Generation**: DynamicFormRenderer dynamically builds Zod schema based on UserAccountFieldConfig
  - Username validation (manual, email-based, firstLastName-based)
  - Password validation (manual with strength requirements, reset_token)
  - **SECURITY**: Role selection uses `z.enum(allowedRoles)` to prevent privilege escalation
- **Template Builder UI**: Enhanced application-templates.tsx with comprehensive UserAccountFieldConfig component
  - Roles to assign
  - Username generation strategy (email, firstLastName, manual)
  - Password setup type (manual, reset_token, auto)
  - Initial user status
  - Email notification options
  - Allowed roles for manual selection
  - Default role pre-selection
- **User Input Component**: UserAccountInput dynamically renders fields based on configuration
  - Conditional field display based on config
  - Password strength hints
  - Role selection dropdown when allowedRoles specified

**Backend Implementation**:
- **User Account Service** (`server/services/userAccountService.ts`):
  - `createUserFromFormField`: Creates user accounts from form field data
  - Validates email uniqueness, username uniqueness
  - Generates usernames based on config (email prefix, firstLastName, manual)
  - Handles password setup: manual (with strength validation), auto-generated, reset_token
  - **SECURITY**: Double validation of roles (frontend Zod enum + backend allowedRoles check)
  - Sends password reset emails via SendGrid
  - Comprehensive audit logging
  - Exports `validatePasswordStrength` for use in password reset flows
- **Form Submission Integration** (server/routes.ts):
  - Processes user_account fields after form validation
  - Extracts field configuration from application template
  - **SECURITY**: Validates submitted role against allowedRoles before account creation
  - Creates user accounts via createUserFromFormField
  - Graceful error handling with user-friendly messages:
    - DuplicateEmailError: "Email already registered"
    - DuplicateUsernameError: "Username already taken"
    - PasswordMismatchError: "Passwords do not match"
    - Invalid role: "Invalid role selected. This incident has been logged."
  - Continues with form submission even if account creation fails

**Security Features**:
- Password strength validation: 8+ characters, uppercase, lowercase, number, special character
- Role validation: Zod enum on frontend + allowedRoles check on backend
- Prevents privilege escalation by validating role submissions
- Logs invalid role submission attempts
- Bcrypt password hashing
- Secure reset token generation (UUID, 24-hour expiry)
- Audit trail for all account creations

**Impact**: Application templates can now automatically create user accounts during form submission, enabling self-service registration flows with granular role control and security.

**Defensive Coding Fix (November 18, 2025)**:
- **Issue**: Enhanced PDF wizard crashed with "Cannot read properties of undefined (reading 'fields')" error when validating sections
- **Root Cause**: `getSectionValidationStatus` function accessed `section.fields` without checking if section exists
- **Solution**: Added defensive null/undefined check before accessing section properties
- **Code Change**: `if (!section || !section.fields) return false;` at line 728 in enhanced-pdf-wizard.tsx
- **Impact**: Eliminated crashes during form validation, improving wizard stability and user experience
- **Testing**: Verified via end-to-end test - wizard loads correctly, forms are interactive, and no runtime errors occur

### Prospect Application Auto-Save Fix (November 13, 2025)

**Issue**: Prospect application forms only saved data when users clicked "Next" or "Previous" buttons. If users filled out fields but closed the browser without navigating between steps, all their data was lost.

**Solution**: Implemented auto-save functionality with debounced saves:
- **Auto-Save Effect**: Added useEffect that monitors `formData` changes and automatically saves after 2.5 seconds of inactivity
- **Smart Guards**: Only triggers in prospect mode with valid prospect ID and after initial data load
- **Debouncing**: Uses timeout-based debouncing to prevent excessive server requests
- **Visual Feedback**: Added `isAutoSaving` state for future UI indicators
- **Error Handling**: Displays user-friendly error messages if auto-save fails
- **Concurrent Save Prevention**: Skips saves when mutation is already pending

**Technical Details**:
- File modified: `client/src/pages/enhanced-pdf-wizard.tsx`
- Added state: `isAutoSaving`, `autoSaveTimeoutRef`
- Updated mutation: `saveFormDataMutation` with onMutate/onSettled callbacks
- Auto-save triggers on formData changes in prospect mode
- Cleanup on unmount prevents memory leaks

**Impact**: Prospects can now safely close and reopen their applications without losing progress, significantly improving user experience and reducing frustration.

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