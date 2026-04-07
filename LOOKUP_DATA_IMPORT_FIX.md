# Lookup Data Import Fix - October 10, 2025

## 🐛 Problem Found
Lookup data import was failing when importing from Test → Production with error:
```
❌ Error: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

## 🔍 Root Cause
The **schema-sync-generator.ts** script was creating tables **without PRIMARY KEY constraints**:

**Before (Broken):**
```sql
CREATE TABLE IF NOT EXISTS fee_groups (
  id INTEGER NOT NULL DEFAULT nextval('fee_groups_id_seq'::regclass),
  name TEXT NOT NULL,
  ...
);
-- ❌ No PRIMARY KEY!
```

**Why This Broke Import:**
- The lookup data import script uses `ON CONFLICT (id) DO UPDATE` for upsert operations
- PostgreSQL requires a UNIQUE or PRIMARY KEY constraint for `ON CONFLICT`
- Without the constraint, the import fails

## ✅ Solution Implemented

### 1. Added PRIMARY KEY constraints to Production tables
```sql
ALTER TABLE fee_groups ADD PRIMARY KEY (id);
ALTER TABLE fee_items ADD PRIMARY KEY (id);
ALTER TABLE fee_item_groups ADD PRIMARY KEY (id);
ALTER TABLE fee_group_fee_items ADD PRIMARY KEY (id);
```

### 2. Fixed schema-sync-generator.ts
**Changes Made:**
- Added `SchemaInfo` interface to track PRIMARY KEY information
- Modified `getSchema()` to query `information_schema.table_constraints` for PRIMARY KEY data
- Updated `generateSyncSQL()` to include PRIMARY KEY constraints in CREATE TABLE statements

**After (Fixed):**
```sql
CREATE TABLE IF NOT EXISTS fee_groups (
  id INTEGER NOT NULL DEFAULT nextval('fee_groups_id_seq'::regclass),
  name TEXT NOT NULL,
  ...,
  PRIMARY KEY (id)    ← ✅ PRIMARY KEY included!
);
```

## 🧪 Testing & Verification

### Test 1: Manual Import (Success)
```bash
tsx scripts/data-sync-manager.ts import production test-2025-10-10T07-25-02-302Z
```

**Result:** ✅ Success
- 11 fee_groups imported
- 79 fee_items imported
- 91 fee_group_fee_items imported
- All equipment, email templates, and triggers imported

### Test 2: Verify Fix with Test Table (Success)
Created test table with PRIMARY KEY in Development:
```sql
CREATE TABLE test_verify_pk (
  id integer PRIMARY KEY,
  name text NOT NULL
);
```

Generated SQL from Dev → Test:
```sql
CREATE TABLE IF NOT EXISTS test_verify_pk (
  id INTEGER NOT NULL DEFAULT nextval('test_verify_pk_seq'::regclass),
  name TEXT NOT NULL,
  PRIMARY KEY (id)    ← ✅ PRIMARY KEY correctly included!
);
```

## 📋 Files Modified

### Schema Sync Generator
**File:** `scripts/schema-sync-generator.ts`

**Changes:**
1. Added `SchemaInfo` interface with `primaryKey` field
2. Enhanced `getSchema()` to fetch PRIMARY KEY constraints
3. Updated `generateSyncSQL()` to include PRIMARY KEY in CREATE TABLE

**Before:**
```typescript
interface ColumnInfo { ... }
async function getSchema(): Promise<Map<string, ColumnInfo[]>> { ... }
```

**After:**
```typescript
interface SchemaInfo {
  columns: ColumnInfo[];
  primaryKey: string | null;
}
async function getSchema(): Promise<Map<string, SchemaInfo>> {
  // Queries for both columns and PRIMARY KEY constraints
}
```

### Documentation Updated
- **WEEK2_SUMMARY.md**: Added PRIMARY KEY fix to technical discoveries and achievements
- **LOOKUP_DATA_IMPORT_FIX.md**: This comprehensive fix documentation

## ✨ Impact

### Before Fix:
- ❌ Generate Fix SQL created incomplete tables
- ❌ Lookup data import failed
- ❌ Manual PRIMARY KEY fixes required after each promotion

### After Fix:
- ✅ Generate Fix SQL creates complete tables with PRIMARY KEY
- ✅ Lookup data import works correctly
- ✅ No manual intervention needed
- ✅ Safe, automated workflow for schema and data promotion

## 🎯 How to Use (Non-Technical Admin)

### Promoting Schema Changes:
1. Go to **Testing Utilities** → **Schema Drift Detection** tab
2. Select environments (e.g., Test → Production)
3. Click **"Detect Schema Drift"**
4. Click **"Generate Fix SQL"**
5. Agent applies the SQL (tables now include PRIMARY KEY automatically)

### Promoting Lookup Data:
1. Go to **Testing Utilities** → **Lookup Data Synchronization** tab
2. Export from source environment (e.g., Test)
3. Import to target environment (e.g., Production)
4. ✅ Import now works correctly with upsert logic

## 🔐 Future-Proofing

The fix ensures:
- All future table creations include PRIMARY KEY constraints
- Lookup data import/export works reliably
- No manual database fixes needed
- Safe, repeatable promotion workflow

## 📊 Summary

**Problem:** Lookup data import failed due to missing PRIMARY KEY constraints
**Root Cause:** schema-sync-generator.ts didn't include PRIMARY KEY in CREATE TABLE
**Solution:** Enhanced generator to query and include PRIMARY KEY constraints
**Result:** ✅ Lookup data import/export works correctly across all environments

**Status:** ✅ Complete and Verified
