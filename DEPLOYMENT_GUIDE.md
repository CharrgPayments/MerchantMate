# Database Deployment Guide: Dev → Test → Production

## ⚠️ CRITICAL: Safe Schema Changes

**NEVER add required fields to existing tables with data!** This causes Drizzle to drop and recreate the table, **deleting all data**.

### ✅ Safe Schema Changes:
- ✅ Add optional columns: `phone: varchar("phone")`
- ✅ Add columns with defaults: `.default("email")`
- ✅ Add new tables

### ❌ Dangerous Schema Changes:
- ❌ Add required fields: `.notNull()` on new columns
- ❌ Change ID column types (serial ↔ varchar)
- ❌ Change column types on tables with data

---

## 🚀 Safe Deployment Strategy

### Option 1: UI-Based Data Sync (Recommended)

The easiest way to sync databases is through the Testing Utilities interface:

1. **Open Testing Utilities**
   - Navigate to: Testing Utilities → Data Utilities tab
   
2. **Use Data Sync**
   - **For Schema Only**: Use the export/import feature
   - **For Schema + Data**: Select full database export

3. **Steps**:
   ```
   Source Environment: development
   Target Environment: test
   ✓ Export from development
   ✓ Import to test
   ```

---

### Option 2: Terminal-Based Schema Sync

#### Step 1: Sync Test Database Schema

```bash
# Set test database as target
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push
```

**When prompted about table creation**:
- You'll see prompts like: "Is email_wrappers table created or renamed?"
- **Answer**: Press Enter to select "create table" (default option)
- **Repeat for each table** - this is safe since test database is empty

#### Step 2: Verify Sync

```bash
tsx scripts/migration-manager.ts status
```

Should show:
```
Development: 2 migrations ✅
Test: 2 migrations ✅
Production: (not configured)
```

---

### Option 3: Advanced Schema Deployment Script

**Use Case**: When you need to add columns to existing tables (not for empty databases)

The `deploy-schema-to-production.ts` script is for **incremental updates** only:
- ✅ Works when: Tables exist but are missing some columns
- ❌ Doesn't work when: Database is completely empty (no tables)

#### Compare Schemas
```bash
tsx scripts/deploy-schema-to-production.ts compare development test
```

#### Generate Deployment SQL
```bash
tsx scripts/deploy-schema-to-production.ts generate development test
```

#### Apply Changes
```bash
tsx scripts/deploy-schema-to-production.ts apply test
```

**Important**: For empty databases, use Option 1 (UI Data Sync) or Option 2 (db:push) instead

---

## 🔒 Safety Guidelines

### ✅ DO:
- Always sync: Dev → Test → Production
- Test thoroughly in test environment before production
- Use `npm run db:push --force` only when you're sure
- Back up production data before major changes

### ❌ DON'T:
- Never deploy directly to production without testing
- Never manually edit SQL (use Drizzle schema)
- Never change ID column types (causes data loss)
- Don't skip the test environment

---

## 🛠 Troubleshooting

### Issue: Interactive Prompts Block Automation

**Problem**: `npm run db:push` shows interactive prompts  
**Solution**: Manually respond to each prompt, or use the UI Data Sync feature

### Issue: Test Database Schema Out of Sync

**Check Status**:
```bash
tsx scripts/migration-manager.ts validate
```

**Fix**:
```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push
```

### Issue: Production Database URL Not Set

**Set in Replit Secrets**:
1. Go to Replit Secrets
2. Add: `PROD_DATABASE_URL` = your production database connection string
3. Restart the application

---

## 📋 Pre-Deployment Checklist

Before deploying to production:

- [ ] Development schema is finalized
- [ ] Test database is synced with development
- [ ] All features tested in test environment
- [ ] Manual test cases completed (see TESTING_CHECKLIST.md)
- [ ] Production database URL is configured
- [ ] Backup of production data created
- [ ] Team notified of deployment

---

## 🎯 Quick Start

**To sync Test database right now:**

```bash
# Method 1: Terminal (requires manual confirmation)
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push

# Method 2: Use Testing Utilities UI
# Navigate to: Testing Utilities → Data Utilities → Data Sync
```

**After syncing Test, verify:**
```bash
tsx scripts/migration-manager.ts status
```

---

## 📞 Need Help?

- Check `MIGRATION_WORKFLOW.md` for detailed migration workflows
- See `TESTING_CHECKLIST.md` for comprehensive testing guide
- Review `replit.md` for system architecture details
