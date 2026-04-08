-- Migration: 0005_create_role_definitions
-- Description: Add role_definitions table for dynamic role management
-- Environments: dev → test → production (follow MIGRATION_WORKFLOW.md)

CREATE TABLE IF NOT EXISTS role_definitions (
  id serial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,
  label varchar(100) NOT NULL,
  description text,
  color varchar(50) DEFAULT 'secondary',
  is_system boolean DEFAULT false,
  permissions text[] DEFAULT ARRAY[]::text[],
  capabilities text[] DEFAULT ARRAY[]::text[],
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Seed the five built-in system roles
INSERT INTO role_definitions (code, label, description, color, is_system, permissions, capabilities)
VALUES
  (
    'super_admin', 'Super Admin',
    'Full system access with all administrative capabilities. Can manage all users, settings, and configurations.',
    'destructive', true,
    ARRAY[
      'view_all_users','create_users','edit_users','delete_users','manage_user_roles',
      'view_all_merchants','view_own_merchant','create_merchants','edit_merchants','delete_merchants',
      'view_all_agents','view_own_agents','create_agents','edit_agents','delete_agents',
      'view_all_transactions','view_own_transactions','create_transactions','edit_transactions','delete_transactions',
      'view_all_locations','view_own_locations','create_locations','edit_locations','delete_locations',
      'view_analytics','view_reports','view_financial_data','export_data',
      'manage_system','view_system_logs','manage_integrations'
    ],
    ARRAY[
      'Full access to all system features',
      'Manage all user accounts and roles',
      'Access to system configuration and integrations',
      'View and export all financial data',
      'Manage security settings and audit logs',
      'Override any system restriction'
    ]
  ),
  (
    'admin', 'Admin',
    'Administrative access for managing users, merchants, agents, and transactions. Cannot modify system-level settings.',
    'destructive', true,
    ARRAY[
      'view_all_users','create_users','edit_users','manage_user_roles',
      'view_all_merchants','create_merchants','edit_merchants',
      'view_all_agents','create_agents','edit_agents',
      'view_all_transactions','create_transactions','edit_transactions',
      'view_all_locations','create_locations','edit_locations',
      'view_analytics','view_reports','view_financial_data','export_data','view_system_logs'
    ],
    ARRAY[
      'Manage user accounts (create, edit)',
      'Manage merchant and agent records',
      'View and edit all transactions',
      'Access analytics and financial reports',
      'Export data and generate reports',
      'View system logs'
    ]
  ),
  (
    'corporate', 'Corporate',
    'Executive-level read access to all business data including analytics, reports, and financial information.',
    'outline', true,
    ARRAY[
      'view_all_merchants','create_merchants','edit_merchants',
      'view_all_agents',
      'view_all_transactions',
      'view_all_locations',
      'view_analytics','view_reports','view_financial_data','export_data'
    ],
    ARRAY[
      'View all merchants and agents',
      'Read-only access to all transactions',
      'Access to analytics and financial reports',
      'Export data for reporting',
      'View all location data'
    ]
  ),
  (
    'agent', 'Agent',
    'Manages assigned merchants and their transactions. Limited to own data scope.',
    'default', true,
    ARRAY[
      'view_own_merchant','view_own_agents','view_own_transactions','view_own_locations',
      'create_transactions','edit_transactions',
      'view_analytics','view_reports'
    ],
    ARRAY[
      'View own assigned merchants',
      'View and create transactions for own merchants',
      'Access analytics for own portfolio',
      'Generate reports for own data',
      'View own locations'
    ]
  ),
  (
    'merchant', 'Merchant',
    'Business owner access to own merchant profile, locations, and transaction history.',
    'secondary', true,
    ARRAY[
      'view_own_merchant','view_own_transactions','view_own_locations',
      'create_locations','edit_locations',
      'view_analytics'
    ],
    ARRAY[
      'View own merchant profile',
      'Manage own locations',
      'View own transaction history',
      'Access own analytics dashboard'
    ]
  )
ON CONFLICT (code) DO NOTHING;
