-- Migration: RBAC Schema Synchronization
-- Purpose: Create and sync RBAC tables (rbac_resources, role_permissions, permission_audit_log)
-- This migration is idempotent and can be run multiple times safely

-- 1. Create rbac_resources table if it doesn't exist
CREATE TABLE IF NOT EXISTS rbac_resources (
    id SERIAL PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    parent_resource_key TEXT,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Create role_permissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_key TEXT NOT NULL,
    resource_id INTEGER NOT NULL REFERENCES rbac_resources(id) ON DELETE CASCADE,
    action TEXT NOT NULL DEFAULT 'view',
    is_granted BOOLEAN NOT NULL DEFAULT true,
    granted_by VARCHAR(255),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes TEXT
);

-- 3. Create permission_audit_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS permission_audit_log (
    id SERIAL PRIMARY KEY,
    actor_user_id VARCHAR(255) NOT NULL,
    role_key TEXT NOT NULL,
    resource_id INTEGER REFERENCES rbac_resources(id),
    action TEXT NOT NULL,
    change_type TEXT NOT NULL,
    previous_value BOOLEAN,
    new_value BOOLEAN NOT NULL,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Add any missing columns to existing tables (idempotent column additions)
DO $$
BEGIN
    -- Add metadata column to rbac_resources if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rbac_resources' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE rbac_resources ADD COLUMN metadata JSONB DEFAULT '{}';
        RAISE NOTICE 'Added metadata column to rbac_resources';
    END IF;

    -- Rename parent_resource_id to parent_resource_key if old name exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rbac_resources' AND column_name = 'parent_resource_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rbac_resources' AND column_name = 'parent_resource_key'
    ) THEN
        ALTER TABLE rbac_resources RENAME COLUMN parent_resource_id TO parent_resource_key;
        RAISE NOTICE 'Renamed parent_resource_id to parent_resource_key';
    END IF;
END $$;

-- 5. Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS rbac_resources_type_idx ON rbac_resources(resource_type);
CREATE INDEX IF NOT EXISTS rbac_resources_category_idx ON rbac_resources(category);
CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions(role_key);
CREATE INDEX IF NOT EXISTS role_permissions_resource_idx ON role_permissions(resource_id);
CREATE INDEX IF NOT EXISTS permission_audit_log_actor_idx ON permission_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS permission_audit_log_role_idx ON permission_audit_log(role_key);
CREATE INDEX IF NOT EXISTS permission_audit_log_created_at_idx ON permission_audit_log(created_at DESC);

-- 6. Create unique index for role_permissions if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'role_permissions_role_resource_action_idx'
    ) THEN
        CREATE UNIQUE INDEX role_permissions_role_resource_action_idx 
        ON role_permissions(role_key, resource_id, action);
        RAISE NOTICE 'Created unique index role_permissions_role_resource_action_idx';
    END IF;
END $$;

-- 7. Seed default resources if the table is empty
INSERT INTO rbac_resources (resource_type, resource_key, display_name, description, category, metadata)
SELECT t.resource_type, t.resource_key, t.display_name, t.description, t.category, t.metadata::jsonb
FROM (VALUES
    ('page', 'page:dashboard', 'Dashboard', 'Main dashboard page', 'Pages - Core', '{"icon": "LayoutDashboard", "route": "/dashboard"}'),
    ('page', 'page:merchants', 'Merchants', 'Merchant management page', 'Pages - Core', '{"icon": "Store", "route": "/merchants"}'),
    ('page', 'page:agents', 'Agents', 'Agent management page', 'Pages - Core', '{"icon": "Users", "route": "/agents"}'),
    ('page', 'page:prospects', 'Prospects', 'Prospect management page', 'Pages - Core', '{"icon": "UserPlus", "route": "/prospects"}'),
    ('page', 'page:transactions', 'Transactions', 'Transaction management page', 'Pages - Core', '{"icon": "CreditCard", "route": "/transactions"}'),
    ('page', 'page:reports', 'Reports', 'Reports and analytics page', 'Pages - Core', '{"icon": "BarChart3", "route": "/reports"}'),
    ('page', 'page:forms', 'Forms', 'Form management page', 'Pages - Admin', '{"icon": "FileText", "route": "/forms"}'),
    ('page', 'page:users', 'Users', 'User management page', 'Pages - Admin', '{"icon": "Users", "route": "/users"}'),
    ('page', 'page:companies', 'Companies', 'Company management page', 'Pages - Admin', '{"icon": "Building2", "route": "/companies"}'),
    ('page', 'page:campaigns', 'Campaigns', 'Campaign management page', 'Pages - Admin', '{"icon": "Megaphone", "route": "/campaigns"}'),
    ('page', 'page:communications', 'Communications', 'Communications management page', 'Pages - Admin', '{"icon": "Mail", "route": "/communications"}'),
    ('page', 'page:security', 'Security', 'Security settings page', 'Pages - Admin', '{"icon": "Shield", "route": "/security"}'),
    ('page', 'page:permissions', 'Permissions', 'Permission manager page', 'Pages - Admin', '{"icon": "Lock", "route": "/permissions"}'),
    ('widget', 'widget:quick_stats', 'Quick Stats', 'Dashboard quick stats widget', 'Dashboard Widgets', '{}'),
    ('widget', 'widget:revenue_chart', 'Revenue Chart', 'Revenue analytics chart widget', 'Dashboard Widgets', '{}'),
    ('widget', 'widget:recent_activity', 'Recent Activity', 'Recent activity feed widget', 'Dashboard Widgets', '{}'),
    ('widget', 'widget:pending_tasks', 'Pending Tasks', 'Pending tasks widget', 'Dashboard Widgets', '{}'),
    ('feature', 'feature:bulk_actions', 'Bulk Actions', 'Ability to perform bulk operations', 'Features', '{}'),
    ('feature', 'feature:export_data', 'Export Data', 'Ability to export data to CSV/Excel', 'Features', '{}'),
    ('feature', 'feature:import_data', 'Import Data', 'Ability to import data from files', 'Features', '{}'),
    ('feature', 'feature:api_access', 'API Access', 'Access to API documentation and keys', 'Features', '{}'),
    ('api', 'api:merchants', 'Merchants API', 'Merchant CRUD API endpoints', 'API Endpoints', '{}'),
    ('api', 'api:agents', 'Agents API', 'Agent CRUD API endpoints', 'API Endpoints', '{}'),
    ('api', 'api:transactions', 'Transactions API', 'Transaction API endpoints', 'API Endpoints', '{}'),
    ('api', 'api:reports', 'Reports API', 'Reports and analytics API endpoints', 'API Endpoints', '{}')
) AS t(resource_type, resource_key, display_name, description, category, metadata)
WHERE NOT EXISTS (SELECT 1 FROM rbac_resources LIMIT 1)
ON CONFLICT (resource_key) DO NOTHING;

-- 8. Seed default permissions for super_admin (all permissions)
INSERT INTO role_permissions (role_key, resource_id, action, is_granted, notes)
SELECT 'super_admin', r.id, a.action, true, 'Default super_admin permission'
FROM rbac_resources r
CROSS JOIN (VALUES ('view'), ('manage'), ('execute')) AS a(action)
WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions 
    WHERE role_key = 'super_admin' AND resource_id = r.id AND action = a.action
)
ON CONFLICT DO NOTHING;

-- 9. Seed default permissions for admin (most permissions except some admin features)
INSERT INTO role_permissions (role_key, resource_id, action, is_granted, notes)
SELECT 'admin', r.id, a.action, true, 'Default admin permission'
FROM rbac_resources r
CROSS JOIN (VALUES ('view'), ('manage')) AS a(action)
WHERE r.resource_key NOT IN ('page:permissions', 'api:system')
AND NOT EXISTS (
    SELECT 1 FROM role_permissions 
    WHERE role_key = 'admin' AND resource_id = r.id AND action = a.action
)
ON CONFLICT DO NOTHING;

-- 10. Seed default permissions for other roles (view only for basic pages)
INSERT INTO role_permissions (role_key, resource_id, action, is_granted, notes)
SELECT role.role_key, r.id, 'view', true, 'Default view permission'
FROM rbac_resources r
CROSS JOIN (VALUES ('merchant'), ('agent'), ('underwriter'), ('corporate')) AS role(role_key)
WHERE r.category = 'Pages - Core' 
AND r.resource_key IN ('page:dashboard', 'page:transactions', 'page:reports')
AND NOT EXISTS (
    SELECT 1 FROM role_permissions 
    WHERE role_key = role.role_key AND resource_id = r.id AND action = 'view'
)
ON CONFLICT DO NOTHING;
