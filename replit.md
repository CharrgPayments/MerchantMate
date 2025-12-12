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
- **Secure Authentication**: Session management, 2FA, password reset, strong password requirements.
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
- **Generic Workflow/Ticketing System**: Reusable workflow engine supporting multi-stage processing pipelines with pluggable handlers, checkpoint reviews, issue/task tracking, and automated stage execution.
- **Disclosure Fields**: Scrollable disclosure components with mandatory scroll-through tracking and signature acknowledgment. Captures audit data (scroll start/completion times, duration, IP address) for compliance. Signature unlocks only after 100% scroll completion.
- **PDF Rehydration**: Automatic generation of completed application PDFs on submission. Original PDF templates are filled with collected data and signatures using pdf-lib. Generated PDFs are stored in Object Storage with ACL rules granting access to PROSPECT_OWNER, ASSIGNED_AGENT, and ADMIN roles.

### System Design Choices
- **Testing Framework**: TDD-style with Jest and React Testing Library.
- **Schema Management**: Migration-first deployment pipeline with Drizzle's migration system.
- **Multi-Environment Support**: Session-based database environment switching (Development, Test, Production) with a strict `Dev → Test → Production` promotion workflow.
- **Database Safety**: Strict protocols and wrapper scripts to prevent accidental production database modifications.
- **User-Company Association Pattern**: All agent and merchant lookups MUST use the generic pattern: `User → user_company_associations → Company → Agent/Merchant`.
- **CRITICAL: Database Schema Change Workflow**: After every change to `shared/schema.ts`, a migration **MUST** be immediately generated using `tsx scripts/migration-manager.ts generate`.
- **Production Protection**: Scripts enforce deployment pipeline (`Development → Test → Production`) blocking direct operations on production without explicit `--force-production`.

### Field Naming Convention (Application Templates)
Uses period (`.`) delimiter for hierarchical field names in application templates: `section.subsection.fieldName` or `section.index.fieldName`.

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