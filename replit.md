# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, form processing, and analytics. It offers role-based access for various user types (merchants, agents, administrators, corporate users). The project aims to provide a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management to gain a competitive edge. Key capabilities include enhanced field types (Percentage, SSN, Expiration Date validation), advanced PDF parsing for address and signature groups, and progressive disclosure of owner fields.

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
- **Object Storage**: Replit Object Storage (GCS-backed) with presigned URLs for secure file uploads/downloads, ACL-based access control, and owner-only file isolation.

### Feature Specifications
- **Company-Centric Data Architecture**: Companies as the root entity.
- **Role-Based Access Control**: Granular permissions for multiple roles.
- **Secure Authentication**: Session management, 2FA, password reset, strong password requirements.
- **Merchant & Agent Management**: Comprehensive profiles, assignment, status, fee management.
- **Location Management**: Polymorphic locations with geolocation and operating hours.
- **Transaction Processing**: Tracking, commission calculations, revenue analytics.
- **Form Management System**: PDF upload/parsing (including auto-detection for address, signature, percentage, SSN, and expiration date fields), dynamic field generation, public access, conditional fields with real-time evaluation.
- **Dashboard System**: Personalized, widget-based dashboards with real-time analytics.
- **Digital Signature System**: Comprehensive signature capture and management with multi-role support, auto-detection from PDFs, canvas/typed capture methods, email workflows, status tracking, token-based security, and audit trails.
- **Address Validation & Autocomplete**: Google Maps Geocoding and Places Autocomplete integration.
- **Campaign Management**: Full CRUD for campaigns, pricing types, fee groups, equipment associations.
- **SOC2 Compliance Features**: Comprehensive audit trail, logging, security events, login attempt tracking.
- **Generic Trigger/Action Catalog System**: Extensible event-driven action system supporting multi-channel notifications and action chaining.
- **User Profile Management**: Self-service profile/settings page.
- **Unified Communications Management**: Consolidated dashboard for all communications features (Templates, Triggers, Activity & Analytics, Settings) accessed via `/communications` route, replacing separate email-management and action-templates pages.
- **Email Configuration & Testing**: Settings tab in Communications Manager displays current SendGrid sender configuration, provides instructions for changing sender email via environment variables, and includes test email functionality for all email templates (prospect validation, signature request, application submission, password reset) with live delivery testing.
- **Prospect Self-Service Portal**: Comprehensive portal for prospects to manage their application lifecycle including:
  - **Automatic Account Creation**: User accounts auto-created on application submission with role='prospect' and status='pending_password'
  - **Password Setup Workflow**: 24-hour UUID reset tokens sent via email for secure password initialization
  - **Prospect Authentication**: Dedicated login endpoints with prospect-only access and session management
  - **Document Management**: Upload/download/delete functionality using Replit Object Storage with presigned URLs and owner-only ACL enforcement
  - **Notification System**: Real-time notifications from agents/underwriters with read/unread tracking and message history
  - **Status Tracking**: View application status, uploaded documents, and communication history
  - **Profile Management**: Update contact information and change password
  - **Merchant Conversion**: Automatic role transition from 'prospect' to 'merchant' upon application approval

### System Design Choices
- **Testing Framework**: TDD-style with Jest and React Testing Library.
- **Schema Management**: Migration-first deployment pipeline with Drizzle's migration system for automated, deterministic, and auditable schema changes.
- **Multi-Environment Support**: Session-based database environment switching (Development, Test, Production) with a strict `Dev → Test → Production` promotion workflow.
- **Database Safety**: Strict protocols and wrapper scripts to prevent accidental production database modifications, including automatic backups and checksum validation for migrations.
- **User-Company Association Pattern**: **CRITICAL ARCHITECTURE** - All agent and merchant lookups MUST use the generic pattern: `User → user_company_associations → Company → Agent/Merchant`.

## **🚨 CRITICAL: Database Schema Change Workflow**

### **MANDATORY RULE for AI Agents:**
**AFTER EVERY CHANGE to `shared/schema.ts`, you MUST immediately generate a migration.**

### **Required Steps (Non-Negotiable):**

1. **Make Schema Change** - Edit `shared/schema.ts`
2. **IMMEDIATELY Generate Migration** - Run:
   ```bash
   tsx scripts/migration-manager.ts generate
   ```
3. **Verify Migration Created** - Check `migrations/` directory for new `.sql` file
4. **Document Change** - Update Recent Changes section in this file

### **Why This is Critical:**
- ❌ **Without migration**: Test/Production won't get schema changes
- ❌ **Schema drift**: Environments become out of sync
- ❌ **Deployment failures**: Automated sync commands will fail
- ✅ **With migration**: All environments stay synchronized

### **Migration Commands Reference:**

**For Agents Making Schema Changes:**
```bash
# After editing shared/schema.ts:
tsx scripts/migration-manager.ts generate        # Creates migration SQL file
tsx scripts/migration-manager.ts status          # Verify migration is listed
```

**For Admin Deployments:**
```bash
tsx scripts/sync-environments.ts dev-to-test     # Deploy to Test
tsx scripts/sync-environments.ts test-to-prod    # Deploy to Production
```

**For Troubleshooting:**
```bash
tsx scripts/migration-manager.ts validate        # Check for schema drift
tsx scripts/migration-manager.ts apply test      # Manually apply to Test
tsx scripts/migration-manager.ts apply prod      # Manually apply to Production
```

### **Migration System Details:**
- **Tracking Table**: `schema_migrations` in each environment
- **Migration Files**: Stored in `migrations/` directory as SQL files
- **Automatic Backups**: Created before each migration apply
- **Transactional**: Each migration runs in a transaction (atomic)
- **Checksum Validation**: Prevents file tampering
- **Environment-Specific**: Each environment tracks its own migration history

## Recent Changes (November 2025)

### Prospect Portal Backend Implementation
**Date**: November 11, 2025

**Schema Changes**:
- Added `userId` field to `merchantProspects` table (nullable, links to users table)
- Created `prospectDocuments` table for file metadata tracking (prospectId, fileName, fileType, fileSize, uploadedAt, category, storageKey, uploadedBy)
- Created `prospectNotifications` table for agent/underwriter messaging (prospectId, subject, message, type, isRead, readAt, createdBy, createdAt)
- Migration: `migrations/0001_migration_20251111T22192.sql` applied to development database

**Authentication & Authorization**:
- Implemented automatic user account creation on application submission (role='prospect', status='pending_password')
- Password setup workflow with 24-hour UUID reset tokens and email notifications
- Prospect-only authentication endpoints (`POST /api/prospects/auth/set-password`, `POST /api/prospects/auth/login`)
- `requireProspectAuth` middleware for prospect-scoped route protection

**Document Management** (Replit Object Storage Integration):
- Upload workflow: Generate presigned URL → client uploads → server sets ACL → create metadata
- Download workflow: Verify ownership → check ACL → generate presigned download URL
- Delete workflow: Verify ownership → delete from storage → remove metadata
- ACL enforcement: Owner-only access with prospect.userId validation
- Storage paths: `prospects/{prospectId}/documents/{timestamp}-{fileName}`
- Error handling: 403 for AccessDeniedError, 404 for ObjectNotFoundError

**Notification System**:
- List all notifications for prospect (`GET /api/prospects/:id/notifications`)
- Unread count endpoint (`GET /api/prospects/:id/notifications/unread-count`)
- Mark as read functionality (`PATCH /api/prospects/:id/notifications/:notificationId/read`)
- Admin/agent notification creation (`POST /api/prospects/:id/notifications`)

**ObjectStorageService Methods** (`server/objectStorage.ts`):
- `getUploadUrl(storageKey)`: Generate presigned upload URL (15min expiry)
- `setFileAcl(storageKey, aclPolicy)`: Set ACL after upload completes
- `getDownloadUrl(storageKey, options)`: Generate presigned download URL with ACL verification (1hr expiry)
- `deleteFile(storageKey)`: Delete file from GCS with existence check
- Custom errors: `ObjectNotFoundError`, `AccessDeniedError`

**Testing & Validation**:
- All 10 backend tasks completed and architect-approved with PASS ratings
- No security vulnerabilities identified
- Server running successfully on port 5000
- Ready for frontend integration

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