// Complete API endpoint reference - all 275 endpoints
export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  requestExample?: any;
  responseExample?: any;
  requestDescription?: string;
  responseDescription?: string;
}

export const apiEndpoints: Record<string, ApiEndpoint[]> = {
  'Authentication & Users': [
    { 
      method: 'GET', 
      path: '/api/auth/user', 
      description: 'Get current authenticated user',
      responseExample: {
        id: "user_123",
        username: "john.doe",
        email: "john.doe@example.com",
        roles: ["merchant"],
        status: "active",
        createdAt: "2025-01-15T10:30:00Z"
      },
      responseDescription: 'Returns the currently authenticated user object'
    },
    { 
      method: 'GET', 
      path: '/api/users', 
      description: 'List all users',
      responseExample: [
        {
          id: "user_123",
          username: "john.doe",
          email: "john.doe@example.com",
          roles: ["merchant"],
          status: "active"
        },
        {
          id: "user_456",
          username: "jane.smith",
          email: "jane.smith@example.com",
          roles: ["agent"],
          status: "active"
        }
      ],
      responseDescription: 'Returns array of all users in the system'
    },
    { method: 'DELETE', path: '/api/users/:id', description: 'Delete user' },
    { 
      method: 'PATCH', 
      path: '/api/users/:id', 
      description: 'Update user',
      requestExample: {
        email: "newemail@example.com",
        status: "inactive"
      },
      requestDescription: 'Provide fields to update',
      responseExample: {
        id: "user_123",
        username: "john.doe",
        email: "newemail@example.com",
        roles: ["merchant"],
        status: "inactive"
      },
      responseDescription: 'Returns the updated user object'
    },
    { method: 'PATCH', path: '/api/users/:id/role', description: 'Update user role (super_admin only)' },
    { method: 'PATCH', path: '/api/users/:id/status', description: 'Update user status' },
    { method: 'POST', path: '/api/users/:id/reset-password', description: 'Reset user password' },
  ],
  
  'Merchants': [
    { 
      method: 'GET', 
      path: '/api/merchants', 
      description: 'List all merchants',
      responseExample: [
        {
          id: 1,
          firstName: "John",
          lastName: "Doe",
          email: "john@business.com",
          companyId: 5,
          status: "active",
          dbaName: "John's Coffee Shop",
          legalName: "John Doe LLC"
        }
      ],
      responseDescription: 'Returns array of merchants'
    },
    { method: 'GET', path: '/api/merchants/all', description: 'Get all merchants (admin)' },
    { method: 'GET', path: '/api/merchants/:id/user', description: 'Get merchant\'s associated user' },
    { method: 'GET', path: '/api/merchants/:merchantId/locations', description: 'List merchant locations' },
    { 
      method: 'GET', 
      path: '/api/merchants/:merchantId/mtd-revenue', 
      description: 'Get merchant month-to-date revenue',
      responseExample: {
        totalRevenue: "15000.00",
        last24Hours: "500.00",
        monthToDate: "12000.00",
        yearToDate: "180000.00"
      },
      responseDescription: 'Returns revenue metrics for the merchant'
    },
    { 
      method: 'POST', 
      path: '/api/merchants', 
      description: 'Create new merchant',
      requestExample: {
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@retail.com",
        phone: "555-0123",
        dbaName: "Jane's Retail Store",
        legalName: "Jane Smith Inc",
        federalTaxId: "12-3456789",
        businessType: "retail",
        agentId: 1
      },
      requestDescription: 'Merchant creation data',
      responseExample: {
        id: 2,
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@retail.com",
        status: "pending",
        companyId: 10
      },
      responseDescription: 'Returns the created merchant object'
    },
    { method: 'POST', path: '/api/merchants/:id/reset-password', description: 'Reset merchant password' },
    { method: 'POST', path: '/api/merchants/:merchantId/locations', description: 'Create merchant location' },
    { method: 'GET', path: '/api/v1/merchants', description: 'List merchants (API v1)' },
    { method: 'GET', path: '/api/v1/merchants/:id', description: 'Get merchant by ID (API v1)' },
    { method: 'POST', path: '/api/v1/merchants', description: 'Create merchant (API v1)' },
  ],
  
  'Agents': [
    { method: 'GET', path: '/api/agents', description: 'List all agents' },
    { method: 'GET', path: '/api/agents/:id/user', description: 'Get agent\'s associated user' },
    { method: 'GET', path: '/api/agents/:agentId/merchants', description: 'Get agent\'s assigned merchants' },
    { method: 'GET', path: '/api/current-agent', description: 'Get current logged-in agent' },
    { method: 'GET', path: '/api/agent/dashboard/stats', description: 'Get agent dashboard statistics' },
    { method: 'GET', path: '/api/agent/applications', description: 'Get agent applications' },
    { method: 'POST', path: '/api/agents', description: 'Create new agent' },
    { method: 'POST', path: '/api/agents/:id/reset-password', description: 'Reset agent password' },
    { method: 'POST', path: '/api/agents/:agentId/merchants/:merchantId', description: 'Assign merchant to agent' },
    { method: 'PUT', path: '/api/agents/:id', description: 'Update agent' },
    { method: 'DELETE', path: '/api/agents/:id', description: 'Delete agent' },
    { method: 'DELETE', path: '/api/agents/:agentId/merchants/:merchantId', description: 'Unassign merchant from agent' },
    { method: 'GET', path: '/api/v1/agents', description: 'List agents (API v1)' },
    { method: 'GET', path: '/api/v1/agents/:id', description: 'Get agent by ID (API v1)' },
  ],
  
  'Prospects & Applications': [
    { 
      method: 'GET', 
      path: '/api/prospects', 
      description: 'List all prospects',
      responseExample: [
        {
          id: 1,
          firstName: "Bob",
          lastName: "Johnson",
          email: "bob@startup.com",
          companyName: "Bob's Startup",
          status: "in_progress",
          agentId: 1,
          createdAt: "2025-11-15T14:20:00Z"
        }
      ],
      responseDescription: 'Returns array of prospects'
    },
    { 
      method: 'GET', 
      path: '/api/prospects/me', 
      description: 'Get current prospect (self-service)',
      responseExample: {
        prospect: {
          id: 1,
          firstName: "Bob",
          lastName: "Johnson",
          email: "bob@startup.com",
          status: "in_progress",
          hasPassword: true
        },
        formData: {
          companyName: "Bob's Startup",
          companyEmail: "contact@bobstartup.com"
        }
      },
      responseDescription: 'Returns current prospect with application data'
    },
    { method: 'GET', path: '/api/prospects/view/:id', description: 'View prospect details' },
    { method: 'GET', path: '/api/prospects/:id/documents', description: 'List prospect documents' },
    { method: 'GET', path: '/api/prospects/:id/documents/:docId/download-url', description: 'Get document download URL' },
    { method: 'GET', path: '/api/prospects/:id/download-pdf', description: 'Download prospect application PDF' },
    { method: 'GET', path: '/api/prospects/:id/notifications', description: 'Get prospect notifications' },
    { method: 'GET', path: '/api/prospects/:id/notifications/unread-count', description: 'Get unread notification count' },
    { method: 'GET', path: '/api/prospects/:prospectId/owners-with-signatures', description: 'Get owners with signature status' },
    { method: 'GET', path: '/api/prospects/:prospectId/signature-status', description: 'Get prospect signature status' },
    { method: 'GET', path: '/api/prospects/status/:token', description: 'Get application status by token' },
    { method: 'GET', path: '/api/prospects/token/:token', description: 'Get prospect by token' },
    { method: 'POST', path: '/api/prospects', description: 'Create prospect' },
    { method: 'POST', path: '/api/prospects/auth/login', description: 'Prospect portal login' },
    { method: 'POST', path: '/api/prospects/auth/set-password', description: 'Set prospect password' },
    { method: 'POST', path: '/api/prospects/auth/change-password', description: 'Change prospect password' },
    { method: 'POST', path: '/api/prospects/validate', description: 'Validate prospect data' },
    { method: 'POST', path: '/api/prospects/validate-token', description: 'Validate prospect token' },
    { method: 'POST', path: '/api/prospects/:id/documents', description: 'Upload prospect document' },
    { method: 'POST', path: '/api/prospects/:id/documents/upload-url', description: 'Generate document upload URL' },
    { method: 'POST', path: '/api/prospects/:id/notifications', description: 'Create prospect notification' },
    { method: 'POST', path: '/api/prospects/:id/resend-invitation', description: 'Resend invitation email' },
    { method: 'POST', path: '/api/prospects/:id/save-form-data', description: 'Save prospect application data' },
    { method: 'POST', path: '/api/prospects/:id/save-inline-signature', description: 'Save inline signature' },
    { method: 'POST', path: '/api/prospects/:id/start-application', description: 'Start prospect application' },
    { method: 'POST', path: '/api/prospects/:id/submit-application', description: 'Submit prospect application' },
    { method: 'POST', path: '/api/prospects/:id/agent-signature', description: 'Add agent signature' },
    { method: 'POST', path: '/api/prospects/:id/clear-address-data', description: 'Clear address data' },
    { method: 'PATCH', path: '/api/prospects/:id', description: 'Update prospect' },
    { method: 'PATCH', path: '/api/prospects/:id/notifications/:notificationId/read', description: 'Mark notification as read' },
    { method: 'PUT', path: '/api/prospects/:id', description: 'Update prospect (full)' },
    { method: 'DELETE', path: '/api/prospects/:id', description: 'Delete prospect' },
    { method: 'DELETE', path: '/api/prospects/:id/documents/:docId', description: 'Delete prospect document' },
    { method: 'GET', path: '/api/prospect-applications', description: 'List prospect applications' },
    { method: 'GET', path: '/api/prospect-applications/:id', description: 'Get prospect application' },
    { method: 'GET', path: '/api/prospect-applications/:id/download-pdf', description: 'Download application PDF' },
    { method: 'POST', path: '/api/prospect-applications', description: 'Create prospect application' },
    { method: 'POST', path: '/api/prospect-applications/:id/start', description: 'Start application' },
    { method: 'POST', path: '/api/prospect-applications/:id/submit', description: 'Submit application' },
    { method: 'POST', path: '/api/prospect-applications/:id/approve', description: 'Approve application' },
    { method: 'POST', path: '/api/prospect-applications/:id/reject', description: 'Reject application' },
    { method: 'POST', path: '/api/prospect-applications/:id/generate-pdf', description: 'Generate application PDF' },
    { method: 'PUT', path: '/api/prospect-applications/:id', description: 'Update prospect application' },
    { method: 'GET', path: '/api/application-status/:token', description: 'Get application status by token' },
  ],
  
  'Locations & Addresses': [
    { method: 'GET', path: '/api/locations/:locationId/addresses', description: 'List location addresses' },
    { method: 'GET', path: '/api/locations/:locationId/revenue', description: 'Get location revenue' },
    { method: 'POST', path: '/api/locations/:locationId/addresses', description: 'Create location address' },
    { method: 'POST', path: '/api/address-autocomplete', description: 'Google Maps address autocomplete' },
    { method: 'POST', path: '/api/validate-address', description: 'Validate address with Google' },
    { method: 'PUT', path: '/api/locations/:locationId', description: 'Update location' },
    { method: 'PUT', path: '/api/addresses/:addressId', description: 'Update address' },
    { method: 'DELETE', path: '/api/locations/:locationId', description: 'Delete location' },
    { method: 'DELETE', path: '/api/addresses/:addressId', description: 'Delete address' },
  ],
  
  'Transactions': [
    { method: 'GET', path: '/api/transactions', description: 'List transactions (role-based)' },
    { method: 'GET', path: '/api/transactions/all', description: 'List all transactions (admin)' },
    { method: 'GET', path: '/api/transactions/mid/:mid', description: 'Get transactions by MID' },
    { method: 'POST', path: '/api/transactions', description: 'Create transaction' },
    { method: 'GET', path: '/api/v1/transactions', description: 'List transactions (API v1)' },
    { method: 'POST', path: '/api/v1/transactions', description: 'Create transaction (API v1)' },
  ],
  
  'Campaigns': [
    { method: 'GET', path: '/api/campaigns', description: 'List all campaigns' },
    { method: 'GET', path: '/api/campaigns/:id', description: 'Get campaign by ID' },
    { method: 'GET', path: '/api/campaigns/:id/equipment', description: 'Get campaign equipment' },
    { method: 'GET', path: '/api/campaigns/:id/templates', description: 'Get campaign templates' },
    { method: 'POST', path: '/api/campaigns', description: 'Create campaign' },
    { method: 'POST', path: '/api/campaigns/:id/deactivate', description: 'Deactivate campaign' },
    { method: 'PUT', path: '/api/campaigns/:id', description: 'Update campaign' },
  ],
  
  'Pricing & Fees': [
    { method: 'GET', path: '/api/pricing-types', description: 'List pricing types' },
    { method: 'GET', path: '/api/pricing-types-detailed', description: 'List pricing types with details' },
    { method: 'GET', path: '/api/pricing-types/:id/fee-groups', description: 'Get pricing type fee groups' },
    { method: 'GET', path: '/api/pricing-types/:id/fee-items', description: 'Get pricing type fee items' },
    { method: 'POST', path: '/api/pricing-types', description: 'Create pricing type' },
    { method: 'PUT', path: '/api/pricing-types/:id', description: 'Update pricing type' },
    { method: 'DELETE', path: '/api/pricing-types/:id', description: 'Delete pricing type' },
    { method: 'GET', path: '/api/fee-groups', description: 'List fee groups' },
    { method: 'GET', path: '/api/fee-groups/:id', description: 'Get fee group by ID' },
    { method: 'POST', path: '/api/fee-groups', description: 'Create fee group' },
    { method: 'PUT', path: '/api/fee-groups/:id', description: 'Update fee group' },
    { method: 'PUT', path: '/api/fee-groups/:id/fee-items', description: 'Update fee group items' },
    { method: 'DELETE', path: '/api/fee-groups/:id', description: 'Delete fee group' },
    { method: 'GET', path: '/api/fee-items', description: 'List fee items' },
    { method: 'POST', path: '/api/fee-items', description: 'Create fee item' },
    { method: 'PUT', path: '/api/fee-items/:id', description: 'Update fee item' },
    { method: 'DELETE', path: '/api/fee-items/:id', description: 'Delete fee item' },
    { method: 'GET', path: '/api/fee-item-groups', description: 'List fee item groups' },
    { method: 'GET', path: '/api/fee-item-groups/:id', description: 'Get fee item group by ID' },
    { method: 'POST', path: '/api/fee-item-groups', description: 'Create fee item group' },
    { method: 'PUT', path: '/api/fee-item-groups/:id', description: 'Update fee item group' },
    { method: 'DELETE', path: '/api/fee-item-groups/:id', description: 'Delete fee item group' },
  ],
  
  'Dashboard & Analytics': [
    { method: 'GET', path: '/api/dashboard/metrics', description: 'Get dashboard metrics' },
    { method: 'GET', path: '/api/dashboard/revenue', description: 'Get revenue analytics' },
    { method: 'GET', path: '/api/dashboard/recent-activity', description: 'Get recent activity' },
    { method: 'GET', path: '/api/dashboard/system-overview', description: 'Get system overview' },
    { method: 'GET', path: '/api/dashboard/top-locations', description: 'Get top locations' },
    { method: 'GET', path: '/api/dashboard/assigned-merchants', description: 'Get assigned merchants' },
    { method: 'GET', path: '/api/dashboard/widgets', description: 'Get user dashboard widgets' },
    { method: 'POST', path: '/api/dashboard/widgets', description: 'Create dashboard widget' },
    { method: 'POST', path: '/api/dashboard/initialize', description: 'Initialize dashboard' },
    { method: 'PUT', path: '/api/dashboard/widgets/:id', description: 'Update dashboard widget' },
    { method: 'DELETE', path: '/api/dashboard/widgets/:id', description: 'Delete dashboard widget' },
    { method: 'GET', path: '/api/analytics/dashboard', description: 'Get analytics dashboard' },
    { method: 'GET', path: '/api/analytics/recent-transactions', description: 'Get recent transactions analytics' },
    { method: 'GET', path: '/api/analytics/top-merchants', description: 'Get top merchants analytics' },
  ],
  
  'Email Templates & Communication': [
    { method: 'GET', path: '/api/email-templates', description: 'List email templates' },
    { method: 'GET', path: '/api/email-config', description: 'Get email configuration' },
    { method: 'GET', path: '/api/email-activity', description: 'Get email activity logs' },
    { method: 'POST', path: '/api/test-email', description: 'Send test email' },
    { method: 'GET', path: '/api/admin/email-templates', description: 'List email templates (admin)' },
    { method: 'GET', path: '/api/admin/email-templates/:id', description: 'Get email template by ID' },
    { method: 'POST', path: '/api/admin/email-templates', description: 'Create email template' },
    { method: 'POST', path: '/api/admin/email-templates/:id/test', description: 'Test email template' },
    { method: 'PUT', path: '/api/admin/email-templates/:id', description: 'Update email template' },
    { method: 'DELETE', path: '/api/admin/email-templates/:id', description: 'Delete email template' },
    { method: 'GET', path: '/api/admin/email-wrappers', description: 'List email wrappers' },
    { method: 'GET', path: '/api/admin/email-wrappers/:id', description: 'Get email wrapper by ID' },
    { method: 'POST', path: '/api/admin/email-wrappers', description: 'Create email wrapper' },
    { method: 'PUT', path: '/api/admin/email-wrappers/:id', description: 'Update email wrapper' },
    { method: 'DELETE', path: '/api/admin/email-wrappers/:id', description: 'Delete email wrapper' },
    { method: 'GET', path: '/api/admin/email-activity', description: 'Get email activity (admin)' },
    { method: 'GET', path: '/api/admin/email-stats', description: 'Get email statistics' },
    { method: 'GET', path: '/api/admin/email-triggers', description: 'List email triggers' },
    { method: 'POST', path: '/api/admin/email-triggers', description: 'Create email trigger' },
    { method: 'PUT', path: '/api/admin/email-triggers/:id', description: 'Update email trigger' },
    { method: 'DELETE', path: '/api/admin/email-triggers/:id', description: 'Delete email trigger' },
  ],
  
  'Triggers & Actions': [
    { method: 'GET', path: '/api/action-templates', description: 'List action templates' },
    { method: 'GET', path: '/api/action-templates/usage', description: 'Get action template usage' },
    { method: 'POST', path: '/api/action-templates', description: 'Create action template' },
    { method: 'POST', path: '/api/action-templates/:id/test', description: 'Test action template' },
    { method: 'PATCH', path: '/api/action-templates/:id', description: 'Update action template' },
    { method: 'DELETE', path: '/api/action-templates/:id', description: 'Delete action template' },
    { method: 'GET', path: '/api/admin/action-templates', description: 'List action templates (admin)' },
    { method: 'GET', path: '/api/admin/action-templates/:id', description: 'Get action template by ID' },
    { method: 'GET', path: '/api/admin/action-templates/:id/usage', description: 'Get action template usage' },
    { method: 'GET', path: '/api/admin/action-templates/type/:actionType', description: 'Get action templates by type' },
    { method: 'GET', path: '/api/admin/action-templates-usage', description: 'Get all action templates usage' },
    { method: 'GET', path: '/api/admin/action-activity/recent', description: 'Get recent action activity' },
    { method: 'GET', path: '/api/admin/action-activity/stats', description: 'Get action activity stats' },
    { method: 'POST', path: '/api/admin/action-templates', description: 'Create action template (admin)' },
    { method: 'PUT', path: '/api/admin/action-templates/:id', description: 'Update action template (admin)' },
    { method: 'DELETE', path: '/api/admin/action-templates/:id', description: 'Delete action template (admin)' },
    { method: 'GET', path: '/api/admin/trigger-catalog', description: 'List trigger catalog' },
    { method: 'GET', path: '/api/admin/trigger-catalog/:id', description: 'Get trigger by ID' },
    { method: 'GET', path: '/api/admin/trigger-catalog/:triggerId/actions', description: 'Get trigger actions' },
    { method: 'GET', path: '/api/admin/trigger-events', description: 'List trigger events' },
    { method: 'POST', path: '/api/admin/trigger-catalog', description: 'Create trigger' },
    { method: 'PUT', path: '/api/admin/trigger-catalog/:id', description: 'Update trigger' },
    { method: 'DELETE', path: '/api/admin/trigger-catalog/:id', description: 'Delete trigger' },
    { method: 'POST', path: '/api/admin/trigger-actions', description: 'Create trigger action' },
    { method: 'PUT', path: '/api/admin/trigger-actions/:id', description: 'Update trigger action' },
    { method: 'DELETE', path: '/api/admin/trigger-actions/:id', description: 'Delete trigger action' },
  ],
  
  'PDF Forms & Signatures': [
    { method: 'GET', path: '/api/pdf-forms', description: 'List PDF forms' },
    { method: 'GET', path: '/api/pdf-forms/:id', description: 'Get PDF form by ID' },
    { method: 'GET', path: '/api/pdf-forms/:id/with-fields', description: 'Get PDF form with fields' },
    { method: 'GET', path: '/api/pdf-forms/:id/submissions', description: 'Get form submissions' },
    { method: 'POST', path: '/api/pdf-forms/upload', description: 'Upload PDF form' },
    { method: 'POST', path: '/api/pdf-forms/:id/create-submission', description: 'Create form submission' },
    { method: 'POST', path: '/api/pdf-forms/:id/send-submission-link', description: 'Send submission link' },
    { method: 'POST', path: '/api/pdf-forms/:id/submissions', description: 'Create submission' },
    { method: 'POST', path: '/api/pdf-forms/:id/submit', description: 'Submit form' },
    { method: 'PATCH', path: '/api/pdf-forms/:id', description: 'Update PDF form' },
    { method: 'GET', path: '/api/submissions/:token', description: 'Get submission by token' },
    { method: 'PUT', path: '/api/submissions/:token', description: 'Update submission' },
    { method: 'GET', path: '/api/signature-request/:token', description: 'Get signature request' },
    { method: 'GET', path: '/api/signature/:token', description: 'Get signature by token' },
    { method: 'GET', path: '/api/signatures/by-email/:email', description: 'Get signatures by email' },
    { method: 'GET', path: '/api/signatures/application/:applicationId', description: 'Get application signatures' },
    { method: 'GET', path: '/api/signatures/prospect/:prospectId', description: 'Get prospect signatures' },
    { method: 'GET', path: '/api/signatures/:token/status', description: 'Get signature status' },
    { method: 'POST', path: '/api/signature-requests', description: 'Create signature request' },
    { method: 'POST', path: '/api/signature-request', description: 'Create signature request (alt)' },
    { method: 'POST', path: '/api/signatures/capture', description: 'Capture signature' },
    { method: 'POST', path: '/api/signatures/:token/resend', description: 'Resend signature request' },
    { method: 'POST', path: '/api/signature-submit', description: 'Submit signature' },
  ],
  
  'Security & Audit': [
    { method: 'GET', path: '/api/security/audit-logs', description: 'Get audit logs' },
    { method: 'GET', path: '/api/security/audit-logs/export', description: 'Export audit logs' },
    { method: 'GET', path: '/api/security/audit-metrics', description: 'Get audit metrics' },
    { method: 'GET', path: '/api/security/events', description: 'Get security events' },
    { method: 'GET', path: '/api/security/login-attempts', description: 'Get login attempts' },
    { method: 'GET', path: '/api/security/metrics', description: 'Get security metrics' },
    { method: 'GET', path: '/api/audit-logs', description: 'Get audit logs (legacy)' },
  ],
  
  'Admin & System': [
    { method: 'GET', path: '/api/admin/api-keys', description: 'List API keys' },
    { method: 'GET', path: '/api/admin/api-keys/:id/usage', description: 'Get API key usage' },
    { method: 'GET', path: '/api/admin/api-logs', description: 'Get API logs' },
    { method: 'POST', path: '/api/admin/api-keys', description: 'Create API key' },
    { method: 'PATCH', path: '/api/admin/api-keys/:id', description: 'Update API key' },
    { method: 'DELETE', path: '/api/admin/api-keys/:id', description: 'Delete API key' },
    { method: 'GET', path: '/api/admin/db-environment', description: 'Get database environment' },
    { method: 'GET', path: '/api/admin/db-diagnostics', description: 'Get database diagnostics' },
    { method: 'POST', path: '/api/admin/db-environment', description: 'Set database environment' },
    { method: 'GET', path: '/api/admin/schema-compare', description: 'Compare database schemas' },
    { method: 'GET', path: '/api/admin/schema-drift/:env1/:env2', description: 'Get schema drift' },
    { method: 'POST', path: '/api/admin/schema-sync', description: 'Sync database schema' },
    { method: 'POST', path: '/api/admin/schema-drift/auto-sync', description: 'Auto-sync schema drift' },
    { method: 'POST', path: '/api/admin/schema-drift/generate-fix', description: 'Generate schema fix' },
    { method: 'POST', path: '/api/admin/migration', description: 'Run database migration' },
    { method: 'POST', path: '/api/admin/reset-testing-data', description: 'Reset testing data' },
    { method: 'DELETE', path: '/api/admin/clear-prospects', description: 'Clear all prospects' },
    { method: 'GET', path: '/api/debug/database', description: 'Debug database connection' },
  ],
  
  'Alerts & Notifications': [
    { method: 'GET', path: '/api/alerts', description: 'List user alerts' },
    { method: 'GET', path: '/api/alerts/count', description: 'Get unread alert count' },
    { method: 'POST', path: '/api/alerts/test', description: 'Send test alert' },
    { method: 'POST', path: '/api/alerts/read-all', description: 'Mark all alerts as read' },
    { method: 'PATCH', path: '/api/alerts/:alertId/read', description: 'Mark alert as read' },
    { method: 'DELETE', path: '/api/alerts/:alertId', description: 'Delete alert' },
    { method: 'DELETE', path: '/api/alerts/read/all', description: 'Delete all read alerts' },
  ],
  
  'Acquirers & Application Templates': [
    { method: 'GET', path: '/api/acquirers', description: 'List acquirers' },
    { method: 'GET', path: '/api/acquirers/:id', description: 'Get acquirer by ID' },
    { method: 'POST', path: '/api/acquirers', description: 'Create acquirer' },
    { method: 'PUT', path: '/api/acquirers/:id', description: 'Update acquirer' },
    { method: 'GET', path: '/api/acquirer-application-templates', description: 'List application templates' },
    { method: 'GET', path: '/api/acquirer-application-templates/:id', description: 'Get application template' },
    { method: 'GET', path: '/api/acquirer-application-templates/application-counts', description: 'Get application counts' },
    { method: 'POST', path: '/api/acquirer-application-templates', description: 'Create application template' },
    { method: 'POST', path: '/api/acquirer-application-templates/upload', description: 'Upload application template' },
    { method: 'PUT', path: '/api/acquirer-application-templates/:id', description: 'Update application template' },
    { method: 'DELETE', path: '/api/acquirer-application-templates/:id', description: 'Delete application template' },
  ],
  
  'MCC Codes': [
    { method: 'GET', path: '/api/mcc/:code', description: 'Get MCC code details' },
    { method: 'GET', path: '/api/mcc/search', description: 'Search MCC codes' },
  ],
  
  'Widgets': [
    { method: 'GET', path: '/api/user/widgets', description: 'Get current user widgets' },
    { method: 'GET', path: '/api/user/:userId/widgets', description: 'Get user widgets by user ID' },
    { method: 'POST', path: '/api/user/widgets', description: 'Create user widget' },
    { method: 'POST', path: '/api/user/:userId/widgets', description: 'Create widget for user' },
    { method: 'PATCH', path: '/api/user/widgets/:id', description: 'Update user widget' },
    { method: 'PUT', path: '/api/widgets/:widgetId', description: 'Update widget' },
    { method: 'DELETE', path: '/api/user/widgets/:id', description: 'Delete user widget' },
    { method: 'DELETE', path: '/api/widgets/:widgetId', description: 'Delete widget' },
  ],
  
  'Equipment': [
    { method: 'GET', path: '/api/equipment-items', description: 'List equipment items' },
    { method: 'POST', path: '/api/equipment-items', description: 'Create equipment item' },
    { method: 'PUT', path: '/api/equipment-items/:id', description: 'Update equipment item' },
    { method: 'DELETE', path: '/api/equipment-items/:id', description: 'Delete equipment item' },
  ],
  
  'Database Environment': [
    { method: 'GET', path: '/api/database-environment', description: 'Get current database environment' },
    { method: 'POST', path: '/api/database-environment', description: 'Set database environment' },
  ],
  
  'Profile': [
    { method: 'PATCH', path: '/api/profile', description: 'Update user profile' },
    { method: 'POST', path: '/api/profile/change-password', description: 'Change password' },
  ],
  
  'Webhooks': [
    { method: 'POST', path: '/api/webhooks/sendgrid', description: 'SendGrid webhook handler' },
  ],
};

export function getAllEndpoints(): ApiEndpoint[] {
  return Object.values(apiEndpoints).flat();
}

export function searchEndpoints(query: string): Record<string, ApiEndpoint[]> {
  const lowerQuery = query.toLowerCase();
  const results: Record<string, ApiEndpoint[]> = {};
  
  Object.entries(apiEndpoints).forEach(([category, endpoints]) => {
    const filteredEndpoints = endpoints.filter(
      (ep) =>
        ep.path.toLowerCase().includes(lowerQuery) ||
        ep.description.toLowerCase().includes(lowerQuery) ||
        ep.method.toLowerCase().includes(lowerQuery)
    );
    
    if (filteredEndpoints.length > 0) {
      results[category] = filteredEndpoints;
    }
  });
  
  return results;
}
