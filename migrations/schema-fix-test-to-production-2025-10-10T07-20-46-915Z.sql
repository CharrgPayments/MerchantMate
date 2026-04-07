-- Schema Synchronization: test → production
-- Generated: 2025-10-10T07:20:46.915Z
-- Total statements: 4

BEGIN;

CREATE TABLE IF NOT EXISTS fee_group_fee_items (
  id INTEGER NOT NULL DEFAULT nextval('fee_group_fee_items_id_seq'::regclass),
  fee_group_id INTEGER NOT NULL,
  fee_item_id INTEGER NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  fee_item_group_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS fee_groups (
  id INTEGER NOT NULL DEFAULT nextval('fee_groups_id_seq'::regclass),
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  author TEXT NOT NULL DEFAULT 'System'::text,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fee_item_groups (
  id INTEGER NOT NULL DEFAULT nextval('fee_item_groups_id_seq'::regclass),
  fee_group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  author TEXT NOT NULL DEFAULT 'System'::text,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fee_items (
  id INTEGER NOT NULL DEFAULT nextval('fee_items_id_seq'::regclass),
  fee_item_group_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL,
  default_value TEXT,
  additional_info TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  author TEXT NOT NULL DEFAULT 'System'::text,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

COMMIT;

-- Verification query:
-- SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;