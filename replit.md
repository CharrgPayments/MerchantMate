# Core CRM - Merchant Payment Processing System

## Overview
Core CRM is a comprehensive merchant payment processing management system designed to streamline merchant onboarding, transaction management, location tracking, and form processing. It provides a robust, scalable, and secure platform for payment processing businesses, empowering them with efficient, transparent, and secure payment management. The system supports various user types with role-based access, including merchants, agents, administrators, and corporate users.

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
- **Role-Based Access Control**: Granular permissions for various roles (e.g., `underwriter`, `senior_underwriter`, `data_processing`, `deployment`) managed via a central permission registry and runtime overrides.
- **Underwriting Engine**: 10-phase pipeline (MCC → Google KYB → Volume → Phone → MATCH/EIN → OFAC → SOS → SSN → Credit → Website) with Traditional vs PayFac pathway branching, checkpoint halts at MCC/MATCH/OFAC, two manual phases (Derogatory, G2), spec-correct status taxonomy (SUB/CUW/P1-P3/W1-W3/D1-D4/APPROVED), per-transition permission matrix with required-reason gating, scoring, issue/task management, audit trails, and PayFac SLA countdown.
- **Campaign Linkage & Auto-Assignment**: Rules-based system for linking merchant applications to pricing campaigns.
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
- **API Documentation Page**: `/api-documentation` is the canonical in-app reference for external consumers — its Endpoints tab catalogues every public route in `server/routes.ts` (grouped by domain, with method, path, permission, request-body schema, and a "validated" flag for Zod-checked routes). Update it whenever public routes are added or changed.

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