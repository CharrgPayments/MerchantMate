# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system that streamlines merchant onboarding, transaction management, location tracking, form processing, and analytics. It's designed with role-based access for various user types, including merchants, agents, administrators, and corporate users, aiming to provide a robust, scalable, and secure platform for payment processing businesses. The business vision is to empower businesses with efficient, transparent, and secure payment management, offering a competitive edge in the market.

## Recent Changes (August 2025)
- **DASHBOARD UI CLEANUP COMPLETED**: Removed duplicate card wrapper around dashboard widgets that was creating redundant headers and controls. Dashboard now displays clean, single-card widgets with proper spacing and unified styling. Each widget contains its title, three-dot menu controls (resize, hide, configure), and content in a single card container without visual duplication.
- **WIDGET HIDING/SHOWING FUNCTIONALITY FIXED**: Resolved critical issue preventing users from hiding/showing dashboard widgets. Fixed database connection problems, user authentication mapping, and schema property mismatch between frontend (`isVisible`) and database (`is_visible`). Widget visibility changes now persist correctly to the database with proper security controls ensuring users can only modify their own widgets.
- **AGENT LOGIN AUTHENTICATION FIXED**: Resolved critical database environment mapping issue preventing newly created agents from logging in. Fixed inconsistency between agent creation ("dev" database) and authentication system ("development" database) that caused login failures. Created proper user record synchronization ensuring agents can access their accounts immediately after creation. Agent authentication now works seamlessly with proper session persistence and role-based dashboard access.
- **AGENT DELETION FUNCTIONALITY RESTORED**: Successfully implemented the missing DELETE `/api/agents/:id` endpoint that was causing agent deletion failures in the UI. Added comprehensive deletion logic with database transaction support, proper user account cleanup, foreign key constraint handling, and role-based access control. Agent deletion now works seamlessly with frontend cache invalidation and displays proper success/error messages. System maintains database environment isolation and ACID compliance during deletion operations.
- **WIDGET DASHBOARD SYSTEM FULLY OPERATIONAL**: Successfully completed and deployed the complete widget-based dashboard system. All 5 widget types (recent_activity, transaction_summary, merchant_analytics, quick_stats, user_management) are now displaying correctly with proper database integration. Fixed critical schema property mismatch between frontend (isVisible) and database (is_visible) that was preventing widget rendering. System features complete CRUD operations, responsive grid layout, role-based access control, real-time database synchronization, and widget catalog for adding new widgets. Authentication fallback mechanisms ensure proper data retrieval across different session states. Dashboard successfully stores user preferences and displays personalized widget configurations.
- **SCHEMA COMPARISON UI ENHANCED**: Upgraded Testing Utilities interface with detailed column difference display showing data types, constraints, and clear categorization of missing/extra columns. UI now provides comprehensive visibility into schema differences with professional formatting and clear badges indicating difference types (Missing in Dev, Extra in Dev, Different).
- **DEVELOPMENT AND TEST FULLY SYNCHRONIZED**: Applied migrations `0002_fix_transactions_schema` and `0003_sync_test_with_dev` across environments. Development and test databases now have identical schemas with 0 differences between them. Both environments contain complete production column set plus development enhancements (`transaction_id` and `mid` in transactions table). Production maintains baseline schema with proper migration path for future deployments.
- **BACKUP CREATION SYSTEM FIXED**: Resolved backup creation failures in migration system by replacing unreliable drizzle-kit introspect with direct SQL queries to information_schema. Migration system now creates reliable schema backups before applying changes, ensuring complete safety during migrations. Backup files are stored in migrations/schema-backups/ with timestamp and environment identification.
- **DEVELOPMENT SCHEMA SYNCHRONIZED**: Successfully applied migration `0001_sync_development_schema` to bring development database up to date with production schema. Reduced column differences from 53 to 23, synchronizing 30 columns across audit_logs, equipment_items, fee_groups, locations, merchants, and transactions tables. Development now has enhanced SOC2 compliance logging, comprehensive merchant profiles, and improved inventory management. Migration applied through bulletproof workflow ensuring transaction safety and proper version control.
- **UNSAFE SCHEMA SYNC REMOVED FROM UI**: Removed dangerous schema synchronization functionality from Testing Utilities interface while preserving schema comparison for visual identification. Changed "Compare & Sync Schemas" button to "Compare Schemas" and removed all sync configuration controls, execution buttons, and related UI components. The interface now safely displays schema differences across environments and directs users to use the bulletproof migration workflow. This prevents accidental unsafe operations while maintaining visibility into schema differences for development and debugging purposes.
- **BULLETPROOF MIGRATION WORKFLOW IMPLEMENTED**: Completely replaced unsafe direct schema synchronization with a bulletproof version-controlled migration system. The new system enforces proper development → test → production workflow with automatic backup creation, transaction safety, and rollback capability. Created comprehensive migration manager (`scripts/migration-manager.ts`) with commands for generating migrations, applying to specific environments, and validating consistency. Added migration tracking table for each environment with checksum verification. Deprecated old `scripts/sync-database-schemas.ts` and `/api/admin/schema-sync` endpoints with proper warnings. New API endpoint `/api/admin/migration` provides secure migration management. All schema changes now require proper versioning and cannot be applied directly to production without test validation. Documentation in `MIGRATION_WORKFLOW.md` provides complete workflow guide. This addresses critical production safety concerns and ensures proper change management.
- **Complete Email System Implementation**: Successfully implemented and seeded the complete email management system for Core CRM. Created email_templates, email_activity, and email_triggers tables with proper relationships and indexes. Seeded 11 professional email templates, 8 automated email triggers, and sample activity data. All email-related API endpoints (email-templates, email-activity, email-triggers, email-stats) are now functional and returning proper data. Added comprehensive seeding script `scripts/seed-email-system.ts` for full email system deployment. Resolved all 500 errors related to missing email tables and established complete email workflow infrastructure.
- **CRITICAL FIX: Complete Database Environment Isolation**: Resolved critical security vulnerability where fee group creation was bypassing database environment middleware, causing development data to be written to production database. Added dbEnvironmentMiddleware to ALL fee-related endpoints (fee-groups, fee-items, fee-item-groups) ensuring complete database isolation. Fixed duplicate API endpoints and verified proper environment routing with console logging. All fee management operations now correctly respect the login screen environment selector.
- **Fee Management System Complete**: Implemented complete fee group edit functionality and fee item creation with proper UI dialogs, backend API endpoints, and database integration. Resolved persistent 500 server errors during agent creation. The system maintains strict database environment isolation based on login screen selection, with session-based persistence and ACID compliance across all authenticated routes.
- **UI Cache Optimization**: Fixed frontend cache issues that prevented real-time display of database updates. Implemented proper cache invalidation with staleTime: 0 and gcTime: 0 for fee-related queries, ensuring UI immediately reflects database changes without manual refresh. Fee item group associations now display correctly in real-time.
- **Fee Items API Enhancement**: Fixed fee items API endpoint to include complete fee group information in response. Modified /api/fee-items route to join with fee_groups table, ensuring UI displays fee group names instead of placeholder values. Fee items grid now shows proper fee group associations.
- **Edit Fee Item Functionality Complete**: Implemented missing edit fee item feature with complete CRUD functionality. Added edit dialog, form validation, onClick handlers, and PUT endpoint for updates. All fee item operations now support full lifecycle management with proper database environment isolation and real-time UI updates.

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