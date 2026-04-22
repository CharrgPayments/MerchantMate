import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Endpoint {
  method: Method;
  path: string;
  description: string;
  permission: string;
  body?: string;
  validated?: boolean;
}

interface Section {
  id: string;
  title: string;
  blurb: string;
  endpoints: Endpoint[];
}

const LAST_REVIEWED = "April 22, 2026";

const SECTIONS: Section[] = [
  {
    id: "public-api-v1",
    title: "Public API (v1, API key)",
    blurb:
      "Endpoints under /api/v1 are gated by an API key (Authorization header) and are the primary surface for external integrations.",
    endpoints: [
      { method: "GET", path: "/api/v1/merchants", description: "List all merchants", permission: "merchants:read" },
      { method: "GET", path: "/api/v1/merchants/:id", description: "Retrieve a single merchant by id", permission: "merchants:read" },
      { method: "POST", path: "/api/v1/merchants", description: "Create a merchant", permission: "merchants:write", body: "insertMerchantSchema", validated: true },
      { method: "GET", path: "/api/v1/agents", description: "List all agents", permission: "agents:read" },
      { method: "GET", path: "/api/v1/agents/:id", description: "Retrieve a single agent by id", permission: "agents:read" },
      { method: "GET", path: "/api/v1/transactions", description: "List all transactions", permission: "transactions:read" },
      { method: "POST", path: "/api/v1/transactions", description: "Create a transaction", permission: "transactions:write", body: "insertTransactionSchema", validated: true },
    ],
  },
  {
    id: "auth",
    title: "Authentication & Session",
    blurb: "Session-based login endpoints used by the in-app UI and the agent/applicant portals.",
    endpoints: [
      { method: "POST", path: "/api/auth/register", description: "Register a new user account", permission: "public" },
      { method: "POST", path: "/api/auth/login", description: "Username / password login (rate limited)", permission: "public" },
      { method: "POST", path: "/api/auth/logout", description: "End the current session", permission: "session" },
      { method: "GET", path: "/api/auth/user", description: "Current authenticated user payload", permission: "session" },
      { method: "GET", path: "/api/auth/permissions", description: "Effective permission set for current user", permission: "session" },
      { method: "POST", path: "/api/auth/forgot-password", description: "Initiate a password reset email", permission: "public" },
      { method: "POST", path: "/api/auth/reset-password", description: "Complete a password reset", permission: "public" },
      { method: "POST", path: "/api/auth/verify-2fa", description: "Verify a 2FA TOTP code during login", permission: "public" },
      { method: "POST", path: "/api/auth/enable-2fa", description: "Enable TOTP 2FA for the current user", permission: "session" },
      { method: "POST", path: "/api/auth/disable-2fa", description: "Disable TOTP 2FA for the current user", permission: "session" },
      { method: "GET", path: "/api/auth/verify-email", description: "Verify an email-link token (callback)", permission: "public (token)" },
      { method: "POST", path: "/api/auth/check-username", description: "Check whether a username is already taken", permission: "public" },
      { method: "POST", path: "/api/auth/check-email", description: "Check whether an email is already registered", permission: "public" },
    ],
  },
  {
    id: "merchants",
    title: "Merchants",
    blurb: "Internal merchant CRUD used by the admin app. Mutations validate the body against insertMerchantSchema.",
    endpoints: [
      { method: "GET", path: "/api/merchants", description: "List merchants visible to the current user", permission: "session" },
      { method: "GET", path: "/api/merchants/all", description: "List every merchant (admin)", permission: "admin:read" },
      { method: "POST", path: "/api/merchants", description: "Create a merchant + user", permission: "admin:read", body: "insertMerchantSchema (omit userId)", validated: true },
      { method: "PUT", path: "/api/merchants/:id", description: "Update a merchant", permission: "admin:read" },
      { method: "DELETE", path: "/api/merchants/:id", description: "Delete a merchant", permission: "admin:manage" },
      { method: "GET", path: "/api/merchants/hierarchy/tree", description: "Closure-table merchant hierarchy", permission: "admin:read" },
      { method: "GET", path: "/api/merchants/:id/descendants", description: "Descendant merchants for a parent", permission: "admin:read" },
      { method: "GET", path: "/api/merchants/:id/user", description: "Get the user account tied to a merchant", permission: "admin:read" },
      { method: "POST", path: "/api/merchants/:id/reset-password", description: "Reset a merchant user's password", permission: "admin:manage" },
      { method: "GET", path: "/api/merchants/:merchantId/mtd-revenue", description: "Month-to-date revenue", permission: "session" },
    ],
  },
  {
    id: "agents",
    title: "Agents",
    blurb: "Agent CRUD, hierarchy, and merchant assignment.",
    endpoints: [
      { method: "GET", path: "/api/agents", description: "List agents (paginated)", permission: "agent:read" },
      { method: "POST", path: "/api/agents", description: "Create an agent + user", permission: "admin:read", body: "insertAgentSchema (omit userId)", validated: true },
      { method: "PUT", path: "/api/agents/:id", description: "Update an agent", permission: "admin:read" },
      { method: "DELETE", path: "/api/agents/:id", description: "Delete an agent", permission: "admin:manage" },
      { method: "GET", path: "/api/current-agent", description: "Agent record for the current user", permission: "session" },
      { method: "GET", path: "/api/agents/hierarchy/tree", description: "Closure-table agent hierarchy", permission: "agent:read" },
      { method: "GET", path: "/api/agents/:id/descendants", description: "Descendant agents for a parent", permission: "agent:read" },
      { method: "GET", path: "/api/agents/:id/user", description: "Get the user account tied to an agent", permission: "admin:read" },
      { method: "POST", path: "/api/agents/:id/reset-password", description: "Reset an agent user's password", permission: "admin:read" },
      { method: "POST", path: "/api/agents/:agentId/merchants/:merchantId", description: "Assign a merchant to an agent", permission: "admin:read" },
      { method: "DELETE", path: "/api/agents/:agentId/merchants/:merchantId", description: "Unassign a merchant from an agent", permission: "admin:read" },
      { method: "GET", path: "/api/agents/:agentId/merchants", description: "Merchants assigned to an agent", permission: "admin:read" },
      { method: "GET", path: "/api/agent/dashboard/stats", description: "Pipeline / KPI tiles for an agent dashboard", permission: "session" },
      { method: "GET", path: "/api/agent/applications", description: "Applications visible to the current agent", permission: "session" },
    ],
  },
  {
    id: "users",
    title: "Users",
    blurb: "Admin user management.",
    endpoints: [
      { method: "GET", path: "/api/users", description: "List users", permission: "admin:read" },
      { method: "PATCH", path: "/api/users/:id", description: "Update a user record", permission: "admin:manage", body: "updateUserSchema", validated: true },
      { method: "PATCH", path: "/api/users/:id/role", description: "Change a user's role", permission: "system:superadmin", validated: true },
      { method: "PATCH", path: "/api/users/:id/status", description: "Activate/deactivate a user", permission: "admin:read", validated: true },
      { method: "DELETE", path: "/api/users/:id", description: "Delete a user", permission: "system:superadmin" },
      { method: "POST", path: "/api/users/:id/reset-password", description: "Reset a user's password", permission: "admin:manage" },
    ],
  },
  {
    id: "locations",
    title: "Locations & Addresses",
    blurb: "Location CRUD per merchant, and address CRUD per location.",
    endpoints: [
      { method: "GET", path: "/api/merchants/:merchantId/locations", description: "Locations for a merchant", permission: "session" },
      { method: "POST", path: "/api/merchants/:merchantId/locations", description: "Create a location", permission: "session" },
      { method: "PUT", path: "/api/locations/:locationId", description: "Update a location", permission: "session" },
      { method: "DELETE", path: "/api/locations/:locationId", description: "Delete a location", permission: "session" },
      { method: "GET", path: "/api/locations/:locationId/revenue", description: "Revenue for a location", permission: "session" },
      { method: "GET", path: "/api/locations/:locationId/addresses", description: "Addresses for a location", permission: "session" },
      { method: "POST", path: "/api/locations/:locationId/addresses", description: "Add an address", permission: "session" },
      { method: "PUT", path: "/api/addresses/:addressId", description: "Update an address", permission: "session" },
      { method: "DELETE", path: "/api/addresses/:addressId", description: "Delete an address", permission: "session" },
      { method: "POST", path: "/api/address-autocomplete", description: "Google Places autocomplete (rate-limited)", permission: "session or prospect token" },
      { method: "POST", path: "/api/validate-address", description: "Google geocode validation (rate-limited)", permission: "session or prospect token" },
    ],
  },
  {
    id: "transactions",
    title: "Transactions",
    blurb: "Transaction read/write used by the admin app.",
    endpoints: [
      { method: "GET", path: "/api/transactions", description: "List transactions visible to the current user", permission: "session" },
      { method: "GET", path: "/api/transactions/all", description: "List every transaction", permission: "admin:read" },
      { method: "GET", path: "/api/transactions/mid/:mid", description: "Transactions for a given MID", permission: "session" },
      { method: "POST", path: "/api/transactions", description: "Create a transaction", permission: "admin:read", body: "insertTransactionSchema", validated: true },
    ],
  },
  {
    id: "prospects",
    title: "Prospects (admin-side)",
    blurb: "Prospect CRUD, invitations, application data, and inline messaging / file requests from the agent's view.",
    endpoints: [
      { method: "GET", path: "/api/prospects", description: "List prospects (paginated, filterable)", permission: "session" },
      { method: "POST", path: "/api/prospects", description: "Create a prospect", permission: "session", body: "insertMerchantProspectSchema", validated: true },
      { method: "PUT", path: "/api/prospects/:id", description: "Update a prospect", permission: "agent:read", body: "insertMerchantProspectSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/prospects/:id", description: "Delete a prospect", permission: "session" },
      { method: "GET", path: "/api/prospects/view/:id", description: "Detailed prospect view payload", permission: "session" },
      { method: "POST", path: "/api/prospects/:id/resend-invitation", description: "Resend the application invitation email", permission: "agent:read" },
      { method: "POST", path: "/api/prospects/:id/send-portal-invite", description: "Send the applicant portal invitation", permission: "session" },
      { method: "POST", path: "/api/prospects/:id/start-application", description: "Mark application as started", permission: "public (token-gated)" },
      { method: "POST", path: "/api/prospects/:id/save-form-data", description: "Save partial application form data", permission: "public (token-gated)" },
      { method: "POST", path: "/api/prospects/:id/submit-application", description: "Submit the completed application", permission: "public (token-gated)" },
      { method: "GET", path: "/api/prospects/:id/download-pdf", description: "Download the merchant-filled application PDF", permission: "public (token-gated)" },
      { method: "POST", path: "/api/prospects/:id/save-inline-signature", description: "Save an inline signature image", permission: "public (token-gated)" },
      { method: "POST", path: "/api/prospects/:id/clear-address-data", description: "Clear cached address fields", permission: "public (token-gated)" },
      { method: "POST", path: "/api/prospects/:id/set-campaign", description: "Override the prospect's pricing campaign", permission: "admin:manage" },
      { method: "GET", path: "/api/prospects/:prospectId/owners-with-signatures", description: "Owners and signature status", permission: "session" },
      { method: "GET", path: "/api/prospects/:prospectId/signature-status", description: "Aggregate signature status", permission: "session" },
      { method: "GET", path: "/api/prospects/:id/messages", description: "Conversation history with the prospect", permission: "session" },
      { method: "POST", path: "/api/prospects/:id/messages", description: "Send a message to the prospect", permission: "session" },
      { method: "PATCH", path: "/api/prospects/:id/messages/:mid/read", description: "Mark a message read", permission: "session" },
      { method: "GET", path: "/api/prospects/:id/file-requests", description: "List file requests for a prospect", permission: "session" },
      { method: "POST", path: "/api/prospects/:id/file-requests", description: "Create a file request", permission: "session" },
      { method: "PATCH", path: "/api/prospects/:id/file-requests/:frid", description: "Update a file request (status, notes)", permission: "session" },
      { method: "DELETE", path: "/api/prospects/:id/file-requests/:frid", description: "Delete a file request", permission: "session" },
      { method: "GET", path: "/api/prospects/:id/file-requests/:frid/download", description: "Download an uploaded file", permission: "session" },
    ],
  },
  {
    id: "prospect-public",
    title: "Prospects (token-gated public)",
    blurb: "Endpoints the applicant uses while filling out their application; gated by a per-prospect token rather than a session.",
    endpoints: [
      { method: "POST", path: "/api/prospects/validate", description: "Validate prospect data (legacy)", permission: "public" },
      { method: "POST", path: "/api/prospects/validate-token", description: "Exchange an invitation token for prospect info (rate-limited)", permission: "public" },
      { method: "GET", path: "/api/prospects/token/:token", description: "Fetch prospect by invitation token", permission: "public (token)" },
      { method: "GET", path: "/api/prospects/status/:token", description: "Application status by token", permission: "public (token)" },
      { method: "GET", path: "/api/application-status/:token", description: "Detailed status for the applicant", permission: "public (token)" },
      { method: "GET", path: "/api/prospects/download-filled-pdf/:token", description: "Download the filled PDF by token", permission: "public (token)" },
    ],
  },
  {
    id: "applicant-portal",
    title: "Applicant Portal",
    blurb: "Authenticated portal the applicant uses after accepting their invite — supports password and magic-link sign-in.",
    endpoints: [
      { method: "POST", path: "/api/portal/setup-password", description: "First-time password setup from invitation", permission: "public" },
      { method: "POST", path: "/api/portal/login", description: "Portal login with email + password", permission: "public" },
      { method: "POST", path: "/api/portal/logout", description: "End portal session", permission: "portal session" },
      { method: "POST", path: "/api/portal/magic-link-request", description: "Request a magic-link email", permission: "public" },
      { method: "POST", path: "/api/portal/magic-link-login", description: "Exchange a magic-link token for a session", permission: "public" },
      { method: "GET", path: "/api/portal/me", description: "Portal user profile", permission: "portal session" },
      { method: "GET", path: "/api/portal/messages", description: "Portal inbox", permission: "portal session" },
      { method: "POST", path: "/api/portal/messages", description: "Send a message from the portal", permission: "portal session" },
      { method: "GET", path: "/api/portal/file-requests", description: "Portal-side file requests", permission: "portal session" },
      { method: "POST", path: "/api/portal/file-requests/:id/upload", description: "Upload a requested file", permission: "portal session" },
    ],
  },
  {
    id: "signatures",
    title: "Signatures",
    blurb: "Standalone signature request/submit endpoints used by signers reached via emailed links.",
    endpoints: [
      { method: "POST", path: "/api/signature-request", description: "Send a signature request email", permission: "session" },
      { method: "POST", path: "/api/signature-submit", description: "Submit a signature for a request", permission: "public (token)" },
      { method: "GET", path: "/api/signature-request/:token", description: "Load a signature request by token", permission: "public (token)" },
      { method: "GET", path: "/api/signature/:token", description: "Read a saved signature image by token", permission: "public (token)" },
      { method: "GET", path: "/api/signatures/by-email/:email", description: "Lookup signatures by signer email", permission: "session" },
    ],
  },
  {
    id: "campaigns",
    title: "Campaigns & Pricing",
    blurb:
      "Campaign CRUD, fee groups, fee items, pricing types, equipment items, and the rules that auto-assign campaigns to applications. Mutations are Zod-validated.",
    endpoints: [
      { method: "GET", path: "/api/campaigns", description: "List campaigns", permission: "agent:read" },
      { method: "POST", path: "/api/campaigns", description: "Create a campaign", permission: "admin:manage" },
      { method: "GET", path: "/api/campaigns/:id", description: "Get one campaign with details", permission: "admin:manage" },
      { method: "PUT", path: "/api/campaigns/:id", description: "Update a campaign", permission: "admin:manage", body: "insertCampaignSchema.partial()", validated: true },
      { method: "POST", path: "/api/campaigns/:id/deactivate", description: "Deactivate a campaign", permission: "admin:manage" },
      { method: "GET", path: "/api/campaigns/:id/equipment", description: "Equipment attached to a campaign", permission: "admin:manage" },
      { method: "GET", path: "/api/campaigns/:id/prospects", description: "Prospects assigned to a campaign", permission: "admin:manage" },
      { method: "GET", path: "/api/campaigns/:id/affected-applications", description: "Applications touched by a campaign change", permission: "admin:manage" },
      { method: "POST", path: "/api/campaigns/:id/regenerate-pdfs", description: "Regenerate PDFs for affected applications", permission: "admin:manage" },
      { method: "GET", path: "/api/public/campaigns/:id/prefill", description: "Public prefill payload for a campaign landing page", permission: "public" },
      { method: "GET", path: "/api/campaign-rules", description: "List campaign auto-assignment rules", permission: "admin:manage" },
      { method: "POST", path: "/api/campaign-rules", description: "Create a campaign rule", permission: "admin:manage", body: "insertCampaignAssignmentRuleSchema", validated: true },
      { method: "PATCH", path: "/api/campaign-rules/:id", description: "Update a campaign rule", permission: "admin:manage", body: "insertCampaignAssignmentRuleSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/campaign-rules/:id", description: "Delete a campaign rule", permission: "admin:manage" },
      { method: "GET", path: "/api/fee-groups", description: "List fee groups", permission: "admin:manage" },
      { method: "GET", path: "/api/fee-groups/:id", description: "Get a fee group", permission: "admin:manage" },
      { method: "POST", path: "/api/fee-groups", description: "Create a fee group", permission: "admin:manage" },
      { method: "PUT", path: "/api/fee-groups/:id", description: "Update a fee group", permission: "admin:manage", body: "insertFeeGroupSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/fee-groups/:id", description: "Delete a fee group", permission: "admin:manage" },
      { method: "GET", path: "/api/fee-item-groups", description: "List fee-item groups", permission: "admin:manage" },
      { method: "GET", path: "/api/fee-item-groups/:id", description: "Get a fee-item group by id", permission: "admin:manage" },
      { method: "POST", path: "/api/fee-item-groups", description: "Create a fee-item group", permission: "admin:manage" },
      { method: "PUT", path: "/api/fee-item-groups/:id", description: "Update a fee-item group", permission: "admin:manage", body: "insertFeeItemGroupSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/fee-item-groups/:id", description: "Delete a fee-item group", permission: "admin:manage" },
      { method: "GET", path: "/api/fee-items", description: "List fee items", permission: "admin:manage" },
      { method: "POST", path: "/api/fee-items", description: "Create a fee item", permission: "admin:manage" },
      { method: "PUT", path: "/api/fee-items/:id", description: "Update a fee item", permission: "admin:manage", body: "insertFeeItemSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/fee-items/:id", description: "Delete a fee item", permission: "admin:manage" },
      { method: "GET", path: "/api/pricing-types", description: "List pricing types", permission: "admin:manage" },
      { method: "GET", path: "/api/pricing-types-detailed", description: "Pricing types + nested fee data", permission: "session" },
      { method: "POST", path: "/api/pricing-types", description: "Create a pricing type", permission: "admin:manage" },
      { method: "PUT", path: "/api/pricing-types/:id", description: "Update a pricing type", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/pricing-types/:id", description: "Delete a pricing type", permission: "admin:manage" },
      { method: "GET", path: "/api/pricing-types/:id/fee-items", description: "Fee items in a pricing type", permission: "admin:manage" },
      { method: "GET", path: "/api/pricing-types/:id/fee-groups", description: "Fee groups in a pricing type", permission: "admin:manage" },
      { method: "GET", path: "/api/equipment-items", description: "List equipment items", permission: "session" },
      { method: "POST", path: "/api/equipment-items", description: "Create an equipment item", permission: "admin:manage" },
      { method: "PUT", path: "/api/equipment-items/:id", description: "Update an equipment item", permission: "admin:manage" },
      { method: "DELETE", path: "/api/equipment-items/:id", description: "Delete an equipment item", permission: "admin:manage" },
    ],
  },
  {
    id: "underwriting",
    title: "Underwriting",
    blurb:
      "10-phase underwriting pipeline, with per-transition permissions, manual phases, queue, files, and history.",
    endpoints: [
      { method: "POST", path: "/api/applications/:id/underwriting/run", description: "Run (or rerun) the underwriting pipeline", permission: "underwriting:run-pipeline" },
      { method: "POST", path: "/api/applications/:id/underwriting/manual-phase", description: "Record the outcome of a manual phase (Derogatory / G2)", permission: "underwriting:manual-phase" },
      { method: "GET", path: "/api/applications/:id/underwriting", description: "Full underwriting view (phases, issues, transitions)", permission: "underwriting:view-detail" },
      { method: "POST", path: "/api/applications/:id/underwriting/transition", description: "Transition status with reason", permission: "underwriting:transition (per matrix)" },
      { method: "POST", path: "/api/applications/:id/underwriting/assign", description: "Assign reviewer / underwriter", permission: "underwriting:assign" },
      { method: "POST", path: "/api/applications/:id/underwriting/pathway", description: "Choose Traditional vs PayFac pathway", permission: "underwriting:transition" },
      { method: "PATCH", path: "/api/underwriting/issues/:id", description: "Update an underwriting issue", permission: "underwriting:transition" },
      { method: "GET", path: "/api/applications/:id/underwriting/tasks", description: "Tasks for an application", permission: "underwriting:view-detail" },
      { method: "POST", path: "/api/applications/:id/underwriting/tasks", description: "Create an underwriting task", permission: "underwriting:transition" },
      { method: "PATCH", path: "/api/underwriting/tasks/:id", description: "Update / complete a task", permission: "underwriting:transition" },
      { method: "GET", path: "/api/applications/:id/underwriting/notes", description: "Notes timeline", permission: "underwriting:view-detail" },
      { method: "POST", path: "/api/applications/:id/underwriting/notes", description: "Add an underwriting note", permission: "underwriting:transition" },
      { method: "GET", path: "/api/applications/:id/underwriting/history", description: "Transition history", permission: "underwriting:view-detail" },
      { method: "PATCH", path: "/api/applications/:id/underwriting/sub-status", description: "Patch a sub-status (e.g. P1→P2)", permission: "underwriting:transition" },
      { method: "GET", path: "/api/underwriting/queue", description: "Reviewer queue with SLA badges", permission: "underwriting:view-queue" },
      { method: "GET", path: "/api/underwriting/phases", description: "Static catalog of phases", permission: "session" },
      { method: "GET", path: "/api/applications/:id/underwriting/files", description: "Files attached to an application", permission: "underwriting:view-detail" },
      { method: "POST", path: "/api/applications/:id/underwriting/files", description: "Upload an underwriting file", permission: "underwriting:transition" },
      { method: "GET", path: "/api/underwriting/files/:id/download", description: "Download a file", permission: "underwriting:view-detail" },
      { method: "DELETE", path: "/api/underwriting/files/:id", description: "Delete a file", permission: "underwriting:transition" },
    ],
  },
  {
    id: "workflows",
    title: "Workflows & Tickets",
    blurb:
      "Workflow definitions, environment configs, stages and stage API configs, plus the ticket lifecycle and assignment endpoints. Most mutations are Zod-validated.",
    endpoints: [
      { method: "GET", path: "/api/admin/workflows", description: "List workflow definitions", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/workflows/:id", description: "Get a workflow", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/workflows", description: "Create a workflow", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/workflows/:id", description: "Update a workflow", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/workflows/:id", description: "Delete a workflow", permission: "admin:manage" },
      { method: "PATCH", path: "/api/admin/workflows/:id/toggle", description: "Enable / disable a workflow", permission: "admin:manage", validated: true },
      { method: "GET", path: "/api/admin/workflows/:id/env-configs", description: "Environment configs for a workflow", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/workflows/:id/env-configs/:env", description: "Upsert an env config", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/workflows/:id/env-configs/:env", description: "Delete an env config", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/workflows/:id/stages", description: "List stages of a workflow", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/workflows/:id/stages", description: "Add a stage", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/workflows/:id/stages/:stageId", description: "Update a stage", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/workflows/:id/stages/:stageId", description: "Delete a stage", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/workflows/:id/stages/:stageId/api-config", description: "Stage API integration config", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/workflows/:id/stages/:stageId/api-config", description: "Upsert stage API config", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/workflows/:id/stages/:stageId/api-config", description: "Clear stage API config", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/workflow-tickets", description: "List tickets across workflows", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/workflow-tickets/:id", description: "Get a ticket", permission: "admin:manage" },
      { method: "PATCH", path: "/api/admin/workflow-tickets/:ticketId/stages/:ticketStageId", description: "Advance/return a ticket stage", permission: "admin:manage", validated: true },
      { method: "PATCH", path: "/api/admin/workflow-tickets/:id/assign", description: "Assign a ticket to a user", permission: "admin:manage", validated: true },
      { method: "GET", path: "/api/admin/workflow-users", description: "Users eligible for ticket assignment", permission: "admin:manage" },
    ],
  },
  {
    id: "external-endpoints",
    title: "External Endpoints (Outbound)",
    blurb:
      "Saved outbound HTTP endpoints used by triggers, workflows, and webhooks. All payloads validated; test-send executes a real request without persisting.",
    endpoints: [
      { method: "GET", path: "/api/external-endpoints", description: "List saved external endpoints", permission: "external_endpoints:manage" },
      { method: "GET", path: "/api/external-endpoints/:id", description: "Get one endpoint", permission: "external_endpoints:manage" },
      { method: "POST", path: "/api/external-endpoints", description: "Create an endpoint", permission: "external_endpoints:manage", body: "insertExternalEndpointSchema", validated: true },
      { method: "PUT", path: "/api/external-endpoints/:id", description: "Update an endpoint", permission: "external_endpoints:manage", body: "insertExternalEndpointSchema.partial()", validated: true },
      { method: "DELETE", path: "/api/external-endpoints/:id", description: "Delete an endpoint", permission: "external_endpoints:manage" },
      { method: "POST", path: "/api/external-endpoints/test-send", description: "Fire a real outbound HTTP call without persisting", permission: "external_endpoints:manage", validated: true },
    ],
  },
  {
    id: "templates",
    title: "Action Templates & Triggers",
    blurb: "Reusable action templates, the trigger catalog, and the actions wired to each trigger.",
    endpoints: [
      { method: "GET", path: "/api/action-templates", description: "List action templates", permission: "admin:manage" },
      { method: "GET", path: "/api/action-templates/usage", description: "Where each template is referenced", permission: "admin:manage" },
      { method: "GET", path: "/api/action-templates/:id", description: "Get a template", permission: "session" },
      { method: "POST", path: "/api/action-templates", description: "Create a template", permission: "admin:manage" },
      { method: "PATCH", path: "/api/action-templates/:id", description: "Update a template", permission: "admin:manage" },
      { method: "DELETE", path: "/api/action-templates/:id", description: "Delete a template", permission: "admin:manage" },
      { method: "POST", path: "/api/action-templates/:id/test", description: "Dry-run a template", permission: "admin:manage" },
      { method: "GET", path: "/api/action-templates/:id/data", description: "Resolved data for a webhook-style template", permission: "session" },
      { method: "GET", path: "/api/admin/trigger-catalog", description: "List trigger definitions", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/trigger-catalog", description: "Create a trigger", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/trigger-catalog/:id", description: "Update a trigger", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/trigger-catalog/:id/actions", description: "Actions wired to a trigger", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/trigger-actions", description: "Create a trigger-action mapping", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/trigger-actions/:id", description: "Update a trigger-action mapping", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/action-activity/stats", description: "Trigger-action execution stats", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/action-activity/recent", description: "Recent trigger-action activity", permission: "admin:manage" },
    ],
  },
  {
    id: "acquirers",
    title: "Acquirers & Application Templates",
    blurb: "Acquirer records and the PDF application templates attached to them, including PDF parse diagnostics and field mapping.",
    endpoints: [
      { method: "GET", path: "/api/acquirers", description: "List acquirers", permission: "admin:manage" },
      { method: "POST", path: "/api/acquirers", description: "Create an acquirer", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirers/:id", description: "Get an acquirer", permission: "admin:manage" },
      { method: "PUT", path: "/api/acquirers/:id", description: "Update an acquirer", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/acquirers", description: "Admin acquirer list with stats", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/acquirers/:id/templates", description: "Templates for an acquirer", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/application-templates", description: "All application templates", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/application-templates/:id", description: "One application template", permission: "admin:manage" },
      { method: "PATCH", path: "/api/admin/application-templates/:id/toggle", description: "Enable / disable a template", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirer-application-templates", description: "Application templates (paginated)", permission: "admin:manage" },
      { method: "POST", path: "/api/acquirer-application-templates", description: "Create a template (metadata)", permission: "admin:manage" },
      { method: "POST", path: "/api/acquirer-application-templates/upload", description: "Upload a template PDF", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirer-application-templates/:id", description: "Get one template", permission: "admin:manage" },
      { method: "PUT", path: "/api/acquirer-application-templates/:id", description: "Update template metadata", permission: "admin:manage" },
      { method: "DELETE", path: "/api/acquirer-application-templates/:id", description: "Delete a template", permission: "admin:manage" },
      { method: "POST", path: "/api/acquirer-application-templates/:id/upload-pdf", description: "Replace the template PDF", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirer-application-templates/:id/parse-diagnostics", description: "PDF parsing diagnostics", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirer-application-templates/:id/field-mapping", description: "Current field mapping", permission: "admin:manage" },
      { method: "PUT", path: "/api/acquirer-application-templates/:id/field-mapping", description: "Save field mapping", permission: "admin:manage" },
      { method: "GET", path: "/api/acquirer-application-templates/:id/as-form", description: "Render template as a form schema", permission: "session" },
      { method: "GET", path: "/api/acquirer-application-templates/application-counts", description: "Per-template application counts", permission: "admin:manage" },
      { method: "GET", path: "/api/prospect-applications/:id/mapped-pdf", description: "Generated PDF mapped to a prospect application", permission: "session" },
    ],
  },
  {
    id: "mcc",
    title: "MCC Codes & Policies",
    blurb: "MCC code catalog and the prohibited / restricted policy rules that gate underwriting.",
    endpoints: [
      { method: "GET", path: "/api/mcc-codes", description: "List MCC codes (paginated, searchable)", permission: "admin:manage" },
      { method: "GET", path: "/api/mcc-codes/categories", description: "Distinct MCC categories", permission: "admin:manage" },
      { method: "GET", path: "/api/mcc-codes/:id", description: "Get an MCC code", permission: "admin:manage" },
      { method: "POST", path: "/api/mcc-codes", description: "Create an MCC code", permission: "admin:manage" },
      { method: "PATCH", path: "/api/mcc-codes/:id", description: "Update an MCC code", permission: "admin:manage" },
      { method: "DELETE", path: "/api/mcc-codes/:id", description: "Delete an MCC code", permission: "admin:manage" },
      { method: "GET", path: "/api/mcc/search", description: "Public MCC search by keyword", permission: "public" },
      { method: "GET", path: "/api/mcc-policies", description: "List MCC policy rules", permission: "admin:manage" },
      { method: "POST", path: "/api/mcc-policies", description: "Create an MCC policy rule", permission: "admin:manage" },
      { method: "PATCH", path: "/api/mcc-policies/:id", description: "Update a policy rule", permission: "admin:manage" },
      { method: "DELETE", path: "/api/mcc-policies/:id", description: "Delete a policy rule", permission: "admin:manage" },
    ],
  },
  {
    id: "disclosures",
    title: "Disclosures",
    blurb: "Versioned compliance disclosure definitions surfaced to applicants in the portal.",
    endpoints: [
      { method: "GET", path: "/api/disclosures", description: "List disclosure definitions", permission: "admin:manage" },
      { method: "GET", path: "/api/disclosures/:id", description: "Get a disclosure with version history", permission: "admin:manage" },
      { method: "POST", path: "/api/disclosures", description: "Create a disclosure definition", permission: "admin:manage" },
      { method: "PATCH", path: "/api/disclosures/:id", description: "Update a disclosure", permission: "admin:manage" },
      { method: "DELETE", path: "/api/disclosures/:id", description: "Delete a disclosure", permission: "system:superadmin" },
      { method: "GET", path: "/api/disclosures/:id/signature-report", description: "Per-disclosure signature report", permission: "admin:manage" },
      { method: "POST", path: "/api/disclosures/:definitionId/versions", description: "Add a new version", permission: "admin:manage" },
      { method: "PATCH", path: "/api/disclosure-versions/:id", description: "Update a version", permission: "admin:manage" },
      { method: "POST", path: "/api/disclosure-versions/:id/copy", description: "Clone a version", permission: "admin:manage" },
    ],
  },
  {
    id: "commissions",
    title: "Commissions & Payouts",
    blurb: "Commission settings, override rules, events, recalculation, and payout lifecycle.",
    endpoints: [
      { method: "GET", path: "/api/commissions/settings", description: "Read commission engine settings", permission: "session" },
      { method: "PUT", path: "/api/commissions/settings", description: "Update commission engine settings", permission: "admin:manage" },
      { method: "GET", path: "/api/commissions/overrides", description: "List override rules", permission: "session" },
      { method: "POST", path: "/api/commissions/overrides", description: "Create an override rule", permission: "admin:manage" },
      { method: "DELETE", path: "/api/commissions/overrides/:id", description: "Delete an override rule", permission: "admin:manage" },
      { method: "GET", path: "/api/commissions/events", description: "List commission events", permission: "session" },
      { method: "GET", path: "/api/commissions/statement", description: "Per-agent statement", permission: "session" },
      { method: "POST", path: "/api/commissions/recalculate/:transactionId", description: "Recalculate commissions for a transaction", permission: "admin:manage" },
      { method: "POST", path: "/api/commissions/recalculate-all", description: "Recalculate every transaction", permission: "admin:manage" },
      { method: "POST", path: "/api/commissions/events/mark-payable", description: "Mark events payable", permission: "admin:manage" },
      { method: "POST", path: "/api/commissions/events/mark-paid", description: "Mark events paid", permission: "admin:manage" },
      { method: "GET", path: "/api/commissions/dashboard-summary", description: "Dashboard rollup", permission: "session" },
      { method: "GET", path: "/api/payouts", description: "List payouts", permission: "session" },
      { method: "GET", path: "/api/payouts/:id", description: "Get a payout", permission: "session" },
      { method: "POST", path: "/api/payouts", description: "Create a payout", permission: "admin:manage" },
      { method: "POST", path: "/api/payouts/:id/mark-paid", description: "Mark a payout paid", permission: "admin:manage" },
      { method: "POST", path: "/api/payouts/:id/void", description: "Void a payout", permission: "admin:manage" },
    ],
  },
  {
    id: "compliance",
    title: "Compliance & SLA Operations",
    blurb: "SOC2 audit reads, SLA breach scanning, scheduled reports, schema-drift alerts, and archived applications.",
    endpoints: [
      { method: "GET", path: "/api/audit/entity/:resource/:resourceId", description: "Audit history for one resource", permission: "audit:read" },
      { method: "GET", path: "/api/applications/sla-status", description: "SLA status across the queue", permission: "underwriting:view-queue" },
      { method: "POST", path: "/api/applications/sla-breaches/:id/acknowledge", description: "Acknowledge an SLA breach", permission: "admin:manage" },
      { method: "POST", path: "/api/applications/sla-breaches/scan", description: "Re-scan applications for SLA breaches", permission: "admin:manage" },
      { method: "GET", path: "/api/prospects/:id/signature-trail", description: "Full signature audit trail for a prospect", permission: "admin:read" },
      { method: "GET", path: "/api/admin/scheduled-reports", description: "List scheduled reports", permission: "admin:read" },
      { method: "POST", path: "/api/admin/scheduled-reports", description: "Create a scheduled report", permission: "admin:manage" },
      { method: "DELETE", path: "/api/admin/scheduled-reports/:id", description: "Delete a scheduled report", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/scheduled-reports/:id/run-now", description: "Force-run a scheduled report", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/scheduled-reports/:id/runs", description: "Run history", permission: "admin:read" },
      { method: "GET", path: "/api/admin/report-templates/:template/preview", description: "Preview a report template", permission: "admin:read" },
      { method: "GET", path: "/api/admin/schema-drift-alerts", description: "Outstanding schema drift alerts", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/schema-drift-alerts/:id/acknowledge", description: "Acknowledge a drift alert", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/schema-drift/scan", description: "Run a fresh drift scan", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/archived-applications", description: "List archived applications", permission: "admin:read" },
      { method: "POST", path: "/api/admin/archived-applications/run-now", description: "Run the archive job", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/archived-applications/stats", description: "Archive job statistics", permission: "admin:read" },
    ],
  },
  {
    id: "roles",
    title: "Roles & Permission Grants",
    blurb: "Role registry, permission grants, and the audit trail of grant changes.",
    endpoints: [
      { method: "GET", path: "/api/admin/role-definitions", description: "List role definitions", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/role-definitions", description: "Create a role", permission: "admin:manage" },
      { method: "PUT", path: "/api/admin/role-definitions/:id", description: "Update a role", permission: "admin:manage" },
      { method: "DELETE", path: "/api/admin/role-definitions/:id", description: "Delete a role", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/role-action-grants", description: "Read the grant matrix", permission: "system:superadmin" },
      { method: "PUT", path: "/api/admin/role-action-grants", description: "Replace the grant matrix", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/role-action-audit", description: "Audit trail for grant changes", permission: "system:superadmin" },
    ],
  },
  {
    id: "admin",
    title: "Admin: API Keys, Email, Audit, Schema",
    blurb: "Admin tooling — issuing API keys, managing email templates / triggers, browsing audit data, and operating database migrations.",
    endpoints: [
      { method: "GET", path: "/api/admin/api-keys", description: "List issued API keys", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/api-keys", description: "Issue an API key", permission: "admin:manage", body: "insertApiKeySchema", validated: true },
      { method: "PATCH", path: "/api/admin/api-keys/:id", description: "Update an API key", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/api-keys/:id", description: "Revoke an API key", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/api-keys/:id/usage", description: "Per-key usage stats", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/api-logs", description: "Recent API call log", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/available-secrets", description: "List secret keys available to templates", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/email-templates", description: "List email templates", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/email-templates/:id", description: "Get a template", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/email-templates", description: "Create a template", permission: "admin:manage", validated: true },
      { method: "PUT", path: "/api/admin/email-templates/:id", description: "Update a template", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/email-templates/:id", description: "Delete a template", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/email-triggers", description: "List email triggers", permission: "admin:manage" },
      { method: "POST", path: "/api/admin/email-triggers", description: "Create an email trigger", permission: "admin:manage", validated: true },
      { method: "PUT", path: "/api/admin/email-triggers/:id", description: "Update an email trigger", permission: "admin:manage", validated: true },
      { method: "DELETE", path: "/api/admin/email-triggers/:id", description: "Delete an email trigger", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/email-activity", description: "Per-message email delivery log", permission: "admin:manage" },
      { method: "GET", path: "/api/admin/email-stats", description: "Email volume & delivery stats", permission: "admin:manage" },
      { method: "GET", path: "/api/email-templates", description: "Read email templates (legacy unprefixed alias)", permission: "session" },
      { method: "GET", path: "/api/email-activity", description: "Read email activity (legacy unprefixed alias)", permission: "session" },
      { method: "GET", path: "/api/admin/db-environment", description: "Current database environment", permission: "session" },
      { method: "POST", path: "/api/admin/db-environment", description: "Switch database environment for the session", permission: "session" },
      { method: "GET", path: "/api/database-environment", description: "Read the active session database environment", permission: "session" },
      { method: "POST", path: "/api/database-environment", description: "Set the session database environment (legacy alias)", permission: "session" },
      { method: "GET", path: "/api/admin/db-diagnostics", description: "Database diagnostics", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/schema-compare", description: "Compare schemas across environments", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/migration", description: "Apply a migration", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/db-sync", description: "Sync data between environments", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/schema-sync", description: "Sync schema between environments", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/reset-testing-data", description: "Reset testing data (test env only)", permission: "system:superadmin" },
      { method: "DELETE", path: "/api/admin/clear-prospects", description: "Clear all prospects (test env)", permission: "system:superadmin" },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboards & Analytics",
    blurb: "KPI tiles, revenue charts, and per-user widget preferences.",
    endpoints: [
      { method: "GET", path: "/api/dashboard/metrics", description: "Top-line dashboard metrics", permission: "session" },
      { method: "GET", path: "/api/dashboard/revenue", description: "Revenue series", permission: "session" },
      { method: "GET", path: "/api/dashboard/recent-activity", description: "Recent system activity", permission: "session" },
      { method: "GET", path: "/api/dashboard/top-locations", description: "Top-performing locations", permission: "session" },
      { method: "GET", path: "/api/dashboard/assigned-merchants", description: "Merchants assigned to current user", permission: "session" },
      { method: "GET", path: "/api/dashboard/system-overview", description: "System-wide overview tiles", permission: "session" },
      { method: "GET", path: "/api/dashboard/widgets", description: "User widget preferences", permission: "session" },
      { method: "POST", path: "/api/dashboard/widgets", description: "Save a widget preference", permission: "session", validated: true },
      { method: "PUT", path: "/api/dashboard/widgets/:id", description: "Update a widget preference (legacy handler in server/routes.ts)", permission: "session", validated: true },
      { method: "PATCH", path: "/api/dashboard/widgets/:id", description: "Update a widget preference (canonical handler in server/routes/dashboard.ts)", permission: "session", validated: true },
      { method: "DELETE", path: "/api/dashboard/widgets/:id", description: "Delete a widget preference", permission: "session" },
      { method: "POST", path: "/api/dashboard/initialize", description: "Seed default widgets for current user", permission: "session" },
      { method: "GET", path: "/api/dashboard/available-widgets", description: "Catalog of widget types", permission: "session" },
      { method: "GET", path: "/api/analytics/dashboard", description: "Legacy analytics dashboard", permission: "session" },
      { method: "GET", path: "/api/analytics/top-merchants", description: "Top merchants by volume", permission: "session" },
      { method: "GET", path: "/api/analytics/recent-transactions", description: "Recent transactions feed", permission: "session" },
    ],
  },
  {
    id: "notifications",
    title: "Notifications (Alerts)",
    blurb: "In-app bell. Includes a Server-Sent Events stream for real-time delivery.",
    endpoints: [
      { method: "GET", path: "/api/alerts", description: "List notifications for the current user", permission: "session" },
      { method: "GET", path: "/api/alerts/count", description: "Unread count", permission: "session" },
      { method: "GET", path: "/api/alerts/stream", description: "Server-Sent Events stream of new alerts", permission: "session" },
      { method: "PATCH", path: "/api/alerts/:id/read", description: "Mark a notification read", permission: "session" },
      { method: "POST", path: "/api/alerts/read-all", description: "Mark all notifications read", permission: "session" },
      { method: "DELETE", path: "/api/alerts/:id", description: "Delete a notification", permission: "session" },
      { method: "DELETE", path: "/api/alerts/read/all", description: "Delete every read notification", permission: "session" },
    ],
  },
  {
    id: "pdf-forms",
    title: "PDF Forms & Submissions",
    blurb: "Standalone PDF form definitions, submissions, and the per-token submission flow.",
    endpoints: [
      { method: "POST", path: "/api/pdf-forms/upload", description: "Upload a PDF form definition", permission: "admin:manage" },
      { method: "GET", path: "/api/pdf-forms", description: "List PDF forms", permission: "admin:manage" },
      { method: "GET", path: "/api/pdf-forms/:id", description: "Get a form", permission: "admin:manage" },
      { method: "GET", path: "/api/pdf-forms/:id/with-fields", description: "Form + parsed field definitions", permission: "session" },
      { method: "PATCH", path: "/api/pdf-forms/:id", description: "Update a form", permission: "admin:manage" },
      { method: "GET", path: "/api/pdf-forms/:id/submissions", description: "List submissions", permission: "session" },
      { method: "POST", path: "/api/pdf-forms/:id/submissions", description: "Create a submission", permission: "session" },
      { method: "POST", path: "/api/pdf-forms/:id/submit", description: "Submit a completed form", permission: "session" },
      { method: "POST", path: "/api/pdf-forms/:id/create-submission", description: "Create a token-based submission", permission: "session", validated: true },
      { method: "POST", path: "/api/pdf-forms/:id/send-submission-link", description: "Email the submission link", permission: "session" },
      { method: "GET", path: "/api/submissions/:token", description: "Load a submission by token", permission: "public (token)" },
      { method: "PUT", path: "/api/submissions/:token", description: "Save submission progress", permission: "public (token)", body: "updateSubmissionByTokenSchema", validated: true },
    ],
  },
  {
    id: "security",
    title: "Security & Audit",
    blurb: "SOC2 audit feeds, login attempts, security events.",
    endpoints: [
      { method: "GET", path: "/api/security/login-attempts", description: "Login attempt log", permission: "admin:manage" },
      { method: "GET", path: "/api/security/audit-logs", description: "Audit log search", permission: "admin:manage" },
      { method: "GET", path: "/api/security/audit-logs/export", description: "CSV export of audit log", permission: "admin:manage" },
      { method: "GET", path: "/api/security/audit-metrics", description: "Audit metrics rollup", permission: "admin:manage" },
      { method: "GET", path: "/api/security/events", description: "Security event feed", permission: "admin:manage" },
      { method: "GET", path: "/api/security/metrics", description: "Top-line security KPIs", permission: "admin:manage" },
      { method: "GET", path: "/api/audit-logs", description: "Generic audit log fetch", permission: "session" },
    ],
  },
  {
    id: "schema-sync",
    title: "Schema Sync (admin)",
    blurb: "Plan / apply / rollback DDL between environments. Apply and rollback stream progress over Server-Sent Events.",
    endpoints: [
      { method: "POST", path: "/api/admin/schema-sync/plan", description: "Generate a schema-diff plan against a target environment", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/schema-sync/plan/:planId", description: "Refetch a previously generated plan by id", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/schema-sync/apply", description: "Apply a plan (returns an SSE stream of progress events)", permission: "system:superadmin" },
      { method: "POST", path: "/api/admin/schema-sync/rollback", description: "Roll back a previous apply using a snapshot file (SSE)", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/schema-sync/certifications", description: "List plan certifications captured in the test environment", permission: "system:superadmin" },
      { method: "GET", path: "/api/admin/schema-sync/snapshots", description: "List rollback snapshots, optionally filtered by ?env=", permission: "system:superadmin" },
    ],
  },
  {
    id: "user-prefs",
    title: "User Preferences",
    blurb: "Generic per-user preference key/value store and per-user widget shortcuts.",
    endpoints: [
      { method: "GET", path: "/api/user/prefs/:key", description: "Read a preference value", permission: "session" },
      { method: "PUT", path: "/api/user/prefs/:key", description: "Write a preference value", permission: "session" },
      { method: "DELETE", path: "/api/user/prefs/:key", description: "Delete a preference", permission: "session" },
      { method: "GET", path: "/api/user/:userId/widgets", description: "List a user's saved widgets", permission: "session" },
      { method: "POST", path: "/api/user/:userId/widgets", description: "Create a widget for a user", permission: "session" },
      { method: "PUT", path: "/api/widgets/:widgetId", description: "Update a widget", permission: "session", validated: true },
      { method: "DELETE", path: "/api/widgets/:widgetId", description: "Delete a widget", permission: "session" },
      { method: "GET", path: "/api/user/widgets", description: "List the current user's widgets (legacy alias)", permission: "session" },
      { method: "POST", path: "/api/user/widgets", description: "Create a widget for the current user (legacy alias)", permission: "session" },
      { method: "PATCH", path: "/api/user/widgets/:id", description: "Update one of the current user's widgets (legacy alias)", permission: "session", validated: true },
      { method: "DELETE", path: "/api/user/widgets/:id", description: "Delete one of the current user's widgets (legacy alias)", permission: "session" },
    ],
  },
];

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-green-50 text-green-700 border-green-200",
  POST: "bg-blue-50 text-blue-700 border-blue-200",
  PUT: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PATCH: "bg-orange-50 text-orange-700 border-orange-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
};

export function EndpointsReference() {
  const [search, setSearch] = useState("");

  const totalCount = useMemo(
    () => SECTIONS.reduce((acc, s) => acc + s.endpoints.length, 0),
    [],
  );

  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS;
    const q = search.trim().toLowerCase();
    return SECTIONS.map((section) => ({
      ...section,
      endpoints: section.endpoints.filter(
        (e) =>
          e.path.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.permission.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q),
      ),
    })).filter((s) => s.endpoints.length > 0);
  }, [search]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>API Endpoints</CardTitle>
            <CardDescription>
              {totalCount} externally-callable endpoints across {SECTIONS.length} domains.
              See "Excluded internal routes" below for everything intentionally omitted.
            </CardDescription>
          </div>
          <div className="text-xs text-gray-500 md:text-right">
            Last reviewed: <span className="font-medium">{LAST_REVIEWED}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by path, method, permission…"
              className="pl-8"
              data-testid="input-endpoints-search"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              validated
            </Badge>
            <span className="text-xs text-gray-500 self-center">
              = body parsed with Zod; bad input returns 400 with <code>error.flatten()</code>
            </span>
          </div>
        </div>

        <nav
          aria-label="Endpoint sections"
          className="mb-6 flex flex-wrap gap-2 rounded-lg border bg-gray-50 p-3"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#endpoints-${s.id}`}
              className="rounded-md border bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              data-testid={`link-endpoint-section-${s.id}`}
            >
              {s.title}
              <span className="ml-1 text-gray-400">({s.endpoints.length})</span>
            </a>
          ))}
          <a
            href="#endpoints-excluded"
            className="rounded-md border border-dashed bg-white px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            data-testid="link-endpoint-section-excluded"
          >
            Excluded internal routes
          </a>
        </nav>

        {filteredSections.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
            No endpoints match "{search}".
          </div>
        )}

        <div className="space-y-8">
          {filteredSections.map((section) => (
            <section key={section.id} id={`endpoints-${section.id}`} className="space-y-3 scroll-mt-24">
              <div className="border-b pb-2">
                <h3 className="text-lg font-semibold">{section.title}</h3>
                <p className="text-xs text-gray-500">{section.blurb}</p>
              </div>
              <div className="space-y-2">
                {section.endpoints.map((e) => (
                  <div
                    key={`${e.method}-${e.path}`}
                    className="rounded-lg border p-3"
                    data-testid={`endpoint-${e.method}-${e.path}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={METHOD_STYLES[e.method]}>
                        {e.method}
                      </Badge>
                      <code className="text-sm font-mono">{e.path}</code>
                      {e.validated && (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                        >
                          validated
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-700">{e.description}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500">
                      <span>
                        Required permission: <span className="font-medium">{e.permission}</span>
                      </span>
                      {e.body && (
                        <span>
                          Body: <code className="font-mono">{e.body}</code>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section
          id="endpoints-excluded"
          className="mt-10 space-y-3 rounded-lg border border-dashed bg-gray-50 p-4 scroll-mt-24"
          aria-label="Excluded internal routes"
        >
          <div>
            <h3 className="text-base font-semibold">Excluded internal routes</h3>
            <p className="text-xs text-gray-500">
              These routes exist in <code>server/routes.ts</code> but are intentionally
              left out of the public catalogue above. They are framework callbacks,
              development helpers, or test plumbing — they are not part of the
              external API contract and may change at any time.
            </p>
          </div>
          <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
            <li>
              <code>POST /api/login/callback</code>,{" "}
              <code>GET /api/logout</code>, and any OpenID Connect (OIDC) callback
              routes mounted by <code>server/replitAuth.ts</code> — handled by the
              auth provider.
            </li>
            <li>
              The entire <code>/api/testing/*</code> sub-router (
              <code>server/routes/testing.ts</code>) — only mounted in non-production
              environments for E2E fixtures.
            </li>
            <li>
              Dev seed routes: <code>POST /api/admin/reset-testing-data</code> and
              <code> DELETE /api/admin/clear-prospects</code> are listed in
              "Admin & System" because they are reachable from the UI, but any
              ad-hoc seeders gated on <code>NODE_ENV !== "production"</code> are
              omitted.
            </li>
            <li>
              <code>GET /api/csrf-token</code> and other client-bootstrap helpers
              consumed only by the React app.
            </li>
            <li>
              Static file routes registered by <code>server/vite.ts</code> /
              <code>server/staticAssets.ts</code> (HTML, JS, CSS, uploaded files)
              — not API endpoints.
            </li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
