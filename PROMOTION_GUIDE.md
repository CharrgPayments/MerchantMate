# Database Promotion Guide
## Safe Schema & Data Synchronization Workflow

> **Purpose**: This guide ensures reliable, zero-data-loss promotions from Development → Test → Production with validation at every step.

---

## 🎯 Core Principles

1. **`shared/schema.ts` is the Single Source of Truth**
   - ALL schema changes start here
   - Never make direct SQL changes to databases
   - Schema file drives all migrations

2. **Dev → Test → Production Pipeline**
   - Always test in Dev first
   - Promote to Test for validation
   - Only promote to Production after Test approval

3. **Validation Before & After**
   - Check for drift before promotion
   - Verify sync after promotion
   - Automated rollback if validation fails

---

## 📋 Pre-Promotion Checklist

Before promoting ANY changes:

- [ ] All changes committed to `shared/schema.ts`
- [ ] Development database matches schema.ts
- [ ] No drift detected between environments
- [ ] Lookup data exported from source environment
- [ ] Backup of target environment created

---

## 🔄 Standard Promotion Workflow

### Step 1: Make Changes in Development

```bash
# 1. Edit shared/schema.ts with your changes
# Example: Add a new column
export const merchants = pgTable("merchants", {
  // ... existing columns ...
  taxId: text("tax_id"), // New column
});

# 2. Apply to Development database
npm run db:push

# 3. Verify Development works correctly
# Test the application manually
```

### Step 2: Check for Drift

```bash
# Verify Development and Test are in sync (or identify differences)
tsx scripts/schema-drift-simple.ts

# ✅ If output shows "NO DRIFT DETECTED" → Proceed to Step 3
# ❌ If drift detected → Fix it first before promoting
```

**If Drift Detected:**

```bash
# Option A: Auto-generate sync SQL
tsx scripts/schema-sync-generator.ts
# Review the generated SQL file
# Apply manually if needed

# Option B: Use sync tool (Week 2+)
tsx scripts/sync-environments.ts dev-to-test
```

### Step 3: Promote to Test

```bash
# Run the comprehensive sync tool
tsx scripts/sync-environments.ts dev-to-test

# This will:
# 1. Backup Test database
# 2. Apply schema migrations
# 3. Sync lookup data
# 4. Verify success

# Follow the prompts and confirm when asked
```

### Step 4: Validate Test Environment

```bash
# 1. Verify no drift
tsx scripts/schema-drift-simple.ts

# 2. Check lookup data counts
tsx scripts/data-sync-manager.ts compare development test

# 3. Manual testing
# → Login to Test environment
# → Test new features
# → Verify existing functionality works
```

### Step 5: Promote to Production

```bash
# ⚠️  PRODUCTION PROMOTION - Extra caution required!

# 1. Final drift check
tsx scripts/schema-drift-simple.ts

# 2. Create production backup (automatic in sync tool)
# 3. Promote
tsx scripts/sync-environments.ts test-to-prod

# 4. Validate production
tsx scripts/schema-drift-simple.ts
```

---

## 🛠️ Drift Detection & Resolution

### What is Schema Drift?

**Drift** = When database structure doesn't match `shared/schema.ts`

**Causes:**
- Direct SQL commands (ALTER TABLE, etc.)
- Manual database changes
- Out-of-order promotions

**Prevention:**
- Always edit `shared/schema.ts` first
- Use `npm run db:push` to apply changes
- Never use raw SQL for schema changes

### Detecting Drift

```bash
# Check Development vs Test
tsx scripts/schema-drift-simple.ts

# Output examples:
```

**✅ No Drift:**
```
✅ NO DRIFT DETECTED
Development and Test schemas are perfectly synchronized!
```

**❌ Drift Found:**
```
❌ DRIFT DETECTED
   • 5 columns in Dev NOT in Test
   • 2 columns in Test NOT in Dev

📋 MISSING IN TEST:
  merchants (3 columns):
    • tax_id (text NULL)
    • business_category (text NULL)
    • annual_revenue (numeric NULL)
```

### Fixing Drift

**Method 1: Automated Sync (Recommended)**

```bash
# Generate sync SQL
tsx scripts/schema-sync-generator.ts

# Review the generated migration file
cat migrations/schema-sync-YYYY-MM-DD.sql

# Apply if satisfied
psql "$TEST_DATABASE_URL" < migrations/schema-sync-YYYY-MM-DD.sql

# Verify
tsx scripts/schema-drift-simple.ts
```

**Method 2: Manual Fix**

```bash
# If Test has extra columns (shouldn't exist):
psql "$TEST_DATABASE_URL" -c "ALTER TABLE table_name DROP COLUMN column_name;"

# If Test is missing columns (should exist):
psql "$TEST_DATABASE_URL" -c "ALTER TABLE table_name ADD COLUMN column_name TYPE;"

# Verify
tsx scripts/schema-drift-simple.ts
```

---

## 🚨 Troubleshooting

### Issue: "Column already exists" error

**Cause:** Test database has the column, but it's not in the right position or has different properties.

**Solution:**
```bash
# Drop and recreate with correct structure
psql "$TEST_DATABASE_URL" << EOF
ALTER TABLE table_name DROP COLUMN IF EXISTS column_name;
ALTER TABLE table_name ADD COLUMN column_name TYPE;
EOF
```

### Issue: "Table does not exist"

**Cause:** Complete table missing in target environment.

**Solution:**
```bash
# Apply schema from Development
npm run db:push

# Then sync to Test
tsx scripts/sync-environments.ts dev-to-test
```

### Issue: "Sync fails with foreign key constraint"

**Cause:** Column order or dependencies out of sync.

**Solution:**
```bash
# 1. Drop dependent foreign keys
# 2. Sync schema
# 3. Recreate foreign keys
# (Automated in Week 2+ tools)
```

---

## 📊 Lookup Data Synchronization

### What is Lookup Data?

Static/semi-static reference data:
- Fee groups and items
- Equipment items
- Email templates and triggers
- Pricing types

### Syncing Lookup Data

```bash
# Export from Development
tsx scripts/data-sync-manager.ts export development

# Import to Test (with confirmation)
tsx scripts/data-sync-manager.ts import test <export-name>

# Compare to verify
tsx scripts/data-sync-manager.ts compare development test
```

### Automated Sync (Recommended)

```bash
# Complete schema + data sync
tsx scripts/sync-environments.ts dev-to-test

# This handles:
# ✓ Schema migration
# ✓ Lookup data export
# ✓ Lookup data import
# ✓ Validation
# ✓ Rollback on failure
```

---

## 🎛️ Command Reference

### Quick Commands

```bash
# Check for drift
tsx scripts/schema-drift-simple.ts

# Generate sync SQL
tsx scripts/schema-sync-generator.ts

# Full promotion (schema + data)
tsx scripts/sync-environments.ts dev-to-test
tsx scripts/sync-environments.ts test-to-prod

# Compare data
tsx scripts/data-sync-manager.ts compare development test

# Manual export/import
tsx scripts/data-sync-manager.ts export development
tsx scripts/data-sync-manager.ts import test <export-name>

# Apply schema changes
npm run db:push
npm run db:push --force  # If prompted and safe
```

### Environment Variables

Ensure these are set in `.env`:

```env
DEV_DATABASE_URL=postgresql://...
TEST_DATABASE_URL=postgresql://...
DATABASE_URL=postgresql://...  # Production
```

---

## ✅ Success Criteria

After promotion, all checks should pass:

**Schema Validation:**
- [ ] `tsx scripts/schema-drift-simple.ts` shows "NO DRIFT"
- [ ] Database Utilities → Compare Schemas shows 0 differences

**Data Validation:**
- [ ] All lookup tables have expected row counts
- [ ] Foreign key relationships intact
- [ ] No orphaned records

**Functional Validation:**
- [ ] User authentication works
- [ ] Core features functional
- [ ] No console errors

---

## 🔐 Safety Features

### Automatic Backups

- Created before every promotion
- Stored with timestamp
- Include rollback instructions

### Validation Gates

- Pre-flight drift detection
- Post-sync verification
- Checksum validation for data

### Rollback Procedures

If sync fails:

```bash
# Automatic rollback triggered
# Backup automatically restored
# Error log generated for review
```

---

## 📅 Maintenance Schedule

**Daily:**
- [ ] Check for drift: `tsx scripts/schema-drift-simple.ts`

**Weekly:**
- [ ] Sync Test from Dev (if changes made)
- [ ] Review migration logs

**Before Production Deployment:**
- [ ] Full validation suite
- [ ] Stakeholder approval
- [ ] Backup verification

---

## 🎓 Training for Non-Technical Users

### For Admins (GUI Coming in Week 3+)

1. **Login to Database Utilities**
2. **Click "Promote Release" tab**
3. **Select source and target environments**
4. **Review changes preview**
5. **Click "Run Promotion" button**
6. **Wait for success confirmation**

### Current CLI Workflow (Week 1)

```bash
# 1. Open terminal
# 2. Run drift check
tsx scripts/schema-drift-simple.ts

# 3. If clear, run sync
tsx scripts/sync-environments.ts dev-to-test

# 4. Type 'yes' when prompted
# 5. Wait for completion
# 6. Verify success
```

---

## 📚 Related Documentation

- `SYNC_GUIDE.md` - Detailed sync tool usage
- `MIGRATION_WORKFLOW.md` - Migration best practices
- `replit.md` - Architecture overview
- `DEPLOYMENT_GUIDE.md` - Production deployment

---

## 🆘 Getting Help

**If promotion fails:**

1. Don't panic - automatic rollback active
2. Check error messages carefully
3. Review drift detection output
4. Consult this guide's troubleshooting section
5. Contact development team if stuck

**Important:** Never try to "force" a failed promotion with manual SQL changes. This creates drift and compounds the problem.

---

*Last Updated: October 2025*  
*Week 1 Foundation - Schema Drift Detection & Prevention*
