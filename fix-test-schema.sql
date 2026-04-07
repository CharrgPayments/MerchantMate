-- Fix test database schema to match code expectations
-- Add roles column as array if it doesn't exist, preserve role column for backward compatibility

DO $$
BEGIN
    -- Check if roles column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'roles'
    ) THEN
        -- Add roles column as array
        ALTER TABLE users ADD COLUMN roles text[] DEFAULT '{merchant}';
        
        -- Migrate data from role to roles if role column exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'role'
        ) THEN
            -- Update roles array based on existing role value
            UPDATE users SET roles = ARRAY[role] WHERE role IS NOT NULL;
        END IF;
    END IF;
END
$$;

-- Verify the fix
SELECT 'Schema fix completed' as status;