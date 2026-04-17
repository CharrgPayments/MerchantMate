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