# Environment Synchronization Guide
## For Non-Technical Users

This guide explains how to keep your Development, Test, and Production databases in sync.

---

## 🎯 Quick Reference

| What You Want to Do | Command to Run |
|---------------------|----------------|
| Check current status | `tsx scripts/sync-environments.ts status` |
| Update Test from Dev | `tsx scripts/sync-environments.ts dev-to-test` |
| Update Production from Test | `tsx scripts/sync-environments.ts test-to-prod` |

---

## 📋 The Golden Rule

**Always follow this order:**
```
Development → Test → Production
```

**NEVER skip environments!** Never sync directly from Dev to Production.

---

## 🔍 Step 1: Check Status

Before any sync, always check the current status:

```bash
tsx scripts/sync-environments.ts status
```

This shows you:
- Which migrations are applied in each environment
- Which lookup data is synced
- Any differences between environments

---

## 🔄 Step 2: Sync Development to Test

When you've made changes in Development and want to test them:

```bash
tsx scripts/sync-environments.ts dev-to-test
```

**What this does:**
1. ✅ Creates a backup of Test database
2. ✅ Updates Test database structure (schema)
3. ✅ Copies lookup data from Dev to Test

**When to use:**
- After making schema changes in Dev
- After updating lookup tables in Dev
- Before running tests in Test environment

**Safety:** You'll be asked to confirm before changes are made.

---

## 🚀 Step 3: Sync Test to Production

After testing changes in Test environment and confirming they work:

```bash
tsx scripts/sync-environments.ts test-to-prod
```

**What this does:**
1. ✅ Creates a backup of Production database
2. ✅ Updates Production database structure
3. ✅ Copies lookup data from Test to Production

**When to use:**
- After successfully testing changes in Test
- Only after approval from team lead
- During planned maintenance windows

**Safety:** You'll need to:
1. Type "yes" to confirm
2. Type "SYNC TO PRODUCTION" to double-confirm

---

## ⚠️ Important Notes

### What Gets Synced
✅ **Schema (Database Structure)**
- Table definitions
- Columns and their types
- Relationships between tables

✅ **Lookup Data (Reference Tables)**
- Fee groups and fee items
- Email templates
- Equipment catalogs
- System configurations

❌ **What Doesn't Get Synced**
- User accounts
- Merchant data
- Transaction history
- Audit logs

### Safety Features

1. **Automatic Backups:** Every sync creates a backup first
2. **Confirmation Required:** You must confirm before changes apply
3. **Extra Production Safety:** Production requires double confirmation
4. **Step-by-Step Output:** Shows exactly what's happening

---

## 🆘 Troubleshooting

### "Environment variable not set"
**Problem:** Missing database connection string

**Solution:**
1. Check that DEV_DATABASE_URL, TEST_DATABASE_URL, and DATABASE_URL are set
2. Contact your system administrator

### "Migration failed"
**Problem:** Schema change couldn't be applied

**Solution:**
1. Check the error message
2. Backups are in `migrations/schema-backups/` folder
3. Contact technical support with the error message

### "Environments out of sync"
**Problem:** Test or Production is missing some changes

**Solution:**
1. Run `npm run sync:status` to see what's different
2. Follow the proper pipeline: Dev → Test → Prod
3. Never skip environments

---

## 📞 Getting Help

If you encounter any issues:

1. **Check Status First:** `npm run sync:status`
2. **Review Error Messages:** Copy the full error message
3. **Check Backups:** Look in `migrations/schema-backups/`
4. **Contact Support:** Provide:
   - The command you ran
   - The error message
   - The sync status output

---

## 🔐 Production Safety Checklist

Before syncing to Production:

- [ ] Changes tested successfully in Test environment
- [ ] Team lead approval obtained
- [ ] Backup verified to exist
- [ ] Maintenance window scheduled (if needed)
- [ ] Application users notified (if downtime expected)
- [ ] Rollback plan ready

---

## 📚 Additional Resources

- **Technical Details:** See `MIGRATION_WORKFLOW.md`
- **Backup Location:** `migrations/schema-backups/`
- **Data Exports:** `data-sync/exports/`

---

**Last Updated:** October 2025
