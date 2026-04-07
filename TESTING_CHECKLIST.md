# Testing Checklist for Core CRM

## Pre-Deployment Testing Requirements

Before deploying any changes to the Core CRM application, ensure all tests pass and coverage requirements are met.

### ✅ Test Categories Completed

#### 1. Component Tests (`client/src/__tests__/components/`)
- ✅ **Header Component** - Navigation, user display, responsive design
- ✅ **Sidebar Component** - Role-based navigation, collapsible functionality, user profile
- ✅ **AuthGuard Component** - Authentication protection, role-based access control

#### 2. Page Tests (`client/src/__tests__/pages/`)
- ✅ **Dashboard Page** - Admin dashboard metrics, agent dashboard, error handling
- ✅ **Merchants Page** - Data display, search/filtering, CRUD operations, role restrictions
- ✅ **Prospects Page** - Hierarchical agent view, prospect management, status tracking
- ✅ **Campaigns Page** - Campaign management, tabbed interface, admin access control

#### 3. API & Backend Tests (`server/__tests__/`)
- ✅ **Routes Test** - All API endpoints, authentication, authorization, error handling
- ✅ **Storage Test** - Database operations, data persistence, transaction handling

#### 4. Schema Validation Tests (`shared/__tests__/`)
- ✅ **Validation Test** - Prospect, merchant, campaign schemas, email/phone validation

#### 5. Integration Tests (`client/src/__tests__/integration/`)
- ✅ **API Integration** - Query client integration, error handling, data flow

### 📊 Coverage Requirements

| Component Type | Minimum Coverage | Current Status |
|----------------|------------------|----------------|
| Pages | 80% | ✅ Implemented |
| Components | 75% | ✅ Implemented |
| API Routes | 85% | ✅ Implemented |
| Schema Validation | 90% | ✅ Implemented |

### 🧪 Test Command Quick Reference

```bash
# Run all tests
npx jest

# Run with coverage report
npx jest --coverage

# Run specific test category
npx jest client/src/__tests__/pages/
npx jest server/__tests__/
npx jest shared/__tests__/

# Run specific test file
npx jest prospects.test.tsx
npx jest routes.test.ts

# Watch mode for development
npx jest --watch
```

### 🎯 Critical Test Scenarios

#### Authentication & Authorization
- ✅ User login/logout functionality
- ✅ Role-based access control (admin, agent, merchant, corporate)
- ✅ Protected route access
- ✅ Session management

#### Core Business Logic
- ✅ Prospect creation and management
- ✅ Merchant onboarding workflow
- ✅ Campaign management (admin only)
- ✅ Agent assignment and filtering
- ✅ Status transitions and tracking

#### Data Integrity
- ✅ Form validation (email, phone, required fields)
- ✅ Database schema enforcement
- ✅ API request/response validation
- ✅ Error handling and user feedback

#### User Experience
- ✅ Responsive design components
- ✅ Loading states and error messages
- ✅ Search and filtering functionality
- ✅ Navigation and routing

### 🔍 Testing Best Practices Applied

1. **Test Utilities** - Centralized mock data and authentication context
2. **Comprehensive Mocking** - API calls, authentication, database operations
3. **Error Scenarios** - Network errors, validation failures, access denied
4. **Role-Based Testing** - Different user roles with appropriate access levels
5. **Integration Testing** - End-to-end workflows and component interactions

### ⚠️ Pre-Deployment Checklist

Before deploying, ensure:

- [ ] All tests pass without errors
- [ ] No console errors or warnings in test output
- [ ] Coverage meets minimum thresholds
- [ ] Critical user flows are tested end-to-end
- [ ] Authentication and authorization work correctly
- [ ] Database operations are tested with proper rollback
- [ ] API endpoints return correct status codes and data
- [ ] Form validation prevents invalid submissions

### 🚀 Ready for Production

✅ **Testing Framework Status**: Fully implemented and operational

The Core CRM application now has comprehensive test coverage across all major components and workflows. The TDD framework is ready to support continued development with confidence in code quality and reliability.

### 📋 Manual Test Cases for Communication Management

Non-technical users should complete these manual tests before deployment to verify all communication features are working correctly.

#### Email Templates (Action Templates - Email Type)

**Test Case 1: Create Email Template**
- [ ] Navigate to Communication Management → Email Templates tab
- [ ] Click "New Template" button
- [ ] Fill in template name (e.g., "Welcome Email")
- [ ] Select category (e.g., "welcome")
- [ ] Enter subject line with variables (e.g., "Welcome {{firstName}} {{lastName}}")
- [ ] Add HTML content using the editor
- [ ] Select wrapper type (notification, transactional, marketing, system, or none)
- [ ] Click "Create" to save
- [ ] Verify template appears in the list
- [ ] Verify template shows as actionType "email"

**Test Case 2: Send Test Email**
- [ ] Find the email template you created
- [ ] Click the "Test Email" button (envelope icon)
- [ ] Enter your email address in the recipient field
- [ ] Click "Send Test Email"
- [ ] Check your inbox for the test email
- [ ] Verify subject line and content are correct
- [ ] Verify wrapper styling is applied

**Test Case 3: Edit Email Template**
- [ ] Click the edit button (pencil icon) on an email template
- [ ] Modify the template content
- [ ] Save changes
- [ ] Verify changes appear in the template list
- [ ] Send a test email to confirm changes

#### Notification Templates (Action Templates - Notification Type)

**Test Case 4: Create Notification Template**
- [ ] Navigate to Communication Management → Notifications tab
- [ ] Click "New Notification Template"
- [ ] Enter template name (e.g., "Security Alert")
- [ ] Select category (e.g., "security")
- [ ] Select notification type (info, success, warning, or error)
- [ ] Enter message content with variables (e.g., "Alert: {{alertType}} detected")
- [ ] Add optional action URL (e.g., "/security")
- [ ] Enter available variables as JSON array (e.g., ["alertType", "userName"])
- [ ] Set Active to "Yes"
- [ ] Click "Create Template"
- [ ] Verify template appears in notifications list
- [ ] Verify purple Bell icon is displayed

**Test Case 5: Verify Notification Template Configuration**
- [ ] Click edit on a notification template
- [ ] Verify all fields are populated correctly
- [ ] Verify notification type is saved
- [ ] Verify variables are properly formatted
- [ ] Make a change and save
- [ ] Verify changes persist

#### Email Wrappers

**Test Case 6: Create Email Wrapper**
- [ ] Navigate to Communication Management → Email Wrappers tab
- [ ] Click "New Wrapper"
- [ ] Enter wrapper name (e.g., "Security Wrapper")
- [ ] Select wrapper type (welcome, agentNotification, security, notification, or custom)
- [ ] Enter description
- [ ] Add header gradient CSS (e.g., "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)")
- [ ] Enter header subtitle
- [ ] Configure CTA button (text, URL, color)
- [ ] Add custom footer HTML
- [ ] Ensure "Active" is checked
- [ ] Click "Save Wrapper"
- [ ] Verify wrapper appears in the table

**Test Case 7: Test Wrapper with Email**
- [ ] Create or edit an email template
- [ ] Select the wrapper you just created
- [ ] Send a test email
- [ ] Verify the email uses the wrapper styling
- [ ] Check header gradient, subtitle, CTA button, and footer

#### System Triggers

**Test Case 8: Create System Trigger**
- [ ] Navigate to Communication Management → System Triggers tab
- [ ] Click "New Trigger"
- [ ] Select trigger event from dropdown (e.g., "user_registered")
- [ ] Enter trigger name (e.g., "User Registration Flow")
- [ ] Add description
- [ ] Select category (user, application, merchant, agent, or system)
- [ ] Set status to "Active"
- [ ] Click "Create Trigger"
- [ ] Verify trigger appears in the list

**Test Case 9: Add Sequenced Actions to Trigger**
- [ ] Click on the trigger you created to select it
- [ ] Click "Add Action" button
- [ ] Select an email template from dropdown (should show blue Mail icon)
- [ ] Set sequence order to 1
- [ ] Set delay to 0 seconds
- [ ] Leave preferences unchecked for testing
- [ ] Click "Add Action"
- [ ] Verify action appears with sequence badge "1"

**Test Case 10: Add Multiple Action Types (Email → Notification → Email)**
- [ ] With a trigger selected, click "Add Action" again
- [ ] Select a notification template (should show purple Bell icon)
- [ ] Set sequence order to 2
- [ ] Set delay to 5 seconds
- [ ] Click "Add Action"
- [ ] Verify action appears with sequence badge "2"
- [ ] Click "Add Action" again
- [ ] Select a different email template
- [ ] Set sequence order to 3
- [ ] Set delay to 10 seconds
- [ ] Click "Add Action"
- [ ] Verify action appears with sequence badge "3"
- [ ] Verify all 3 actions are displayed in correct order (1, 2, 3)
- [ ] Verify visual differentiation (email = blue Mail, notification = purple Bell)

**Test Case 11: Test Action Preferences and Retry Settings**
- [ ] Edit an existing trigger action
- [ ] Check "Requires email preference"
- [ ] Check "Retry on failure"
- [ ] Set max retries to 5
- [ ] Save changes
- [ ] Verify settings are saved correctly

#### New Trigger Events

**Test Case 12: Verify New Trigger Events in Template Guide**
- [ ] Navigate to Communication Management → Template Guide tab
- [ ] Scroll to "Available Trigger Events" section
- [ ] Verify "email_verification_requested" is documented
- [ ] Confirm it shows "Security Events" badge
- [ ] Verify description: "Fired when a user needs to verify their email address"
- [ ] Check available variables: email, verificationLink, firstName, lastName, userName
- [ ] Verify "two_factor_requested" is documented
- [ ] Confirm it shows "Security Events" badge
- [ ] Verify description: "Fired when a user requests two-factor authentication code"
- [ ] Check available variables: email, twoFactorCode, firstName, lastName, userName, expiresIn

**Test Case 13: Use New Trigger Events**
- [ ] Navigate to System Triggers tab
- [ ] Click "New Trigger"
- [ ] Open trigger event dropdown
- [ ] Verify "Email Verification Requested" appears in options
- [ ] Verify "Two Factor Requested" appears in options
- [ ] Select "Email Verification Requested"
- [ ] Complete trigger creation
- [ ] Verify trigger is created with correct event

#### Communication Activity

**Test Case 14: View Communication Activity**
- [ ] Navigate to Communication Management → Communication Activity tab
- [ ] Verify activity log is displayed
- [ ] Check email delivery status (pending, sent, delivered, opened, clicked, failed)
- [ ] Test filtering by status
- [ ] Test searching by recipient email
- [ ] Verify sent timestamps are displayed
- [ ] Check for opened/clicked timestamps if available

#### Template Usage Tracking

**Test Case 15: Verify Template Usage Indicators**
- [ ] Create an email template
- [ ] Associate it with a trigger action
- [ ] Navigate back to Email Templates tab
- [ ] Find the template in the list
- [ ] Verify "Used in Triggers" column shows the trigger name(s)
- [ ] Hover over the badge to see trigger details
- [ ] Try to delete a template that's in use
- [ ] Verify warning message appears listing triggers using the template

#### Integration Testing

**Test Case 16: End-to-End Communication Flow**
- [ ] Create an email wrapper
- [ ] Create an email template using that wrapper
- [ ] Create a notification template
- [ ] Create a system trigger (e.g., "user_registered")
- [ ] Add sequenced actions: Email → Notification → Email
- [ ] Verify entire flow is configured correctly
- [ ] Check Template Guide for correct variable documentation
- [ ] Send test email to verify wrapper and template work together

### ✅ Communication Management Test Summary

Before deploying communication features, ensure:

- [ ] All email templates create successfully and send test emails
- [ ] All notification templates save with correct configuration
- [ ] Email wrappers apply styling correctly to emails
- [ ] System triggers can be created with all available events
- [ ] Trigger actions can be sequenced in correct order (1, 2, 3...)
- [ ] Different action types can be mixed (email, notification)
- [ ] Visual indicators work (blue Mail icon for email, purple Bell for notification)
- [ ] New trigger events (email_verification_requested, two_factor_requested) are documented
- [ ] Template Guide shows all available variables for each trigger event
- [ ] Communication Activity tab displays email tracking correctly
- [ ] Template usage indicators prevent accidental deletion of active templates
- [ ] Page title shows "Communication Management" instead of "Email Management"

### Next Steps

1. Run `npx jest --coverage` to generate detailed coverage report
2. Address any remaining coverage gaps if identified
3. Complete all manual test cases above before deployment
4. Continue TDD workflow for new features:
   - Write failing tests first
   - Implement minimum code to pass
   - Refactor and improve
   - Repeat cycle