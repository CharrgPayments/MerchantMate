/**
 * Centralized Trigger Keys Dictionary
 * 
 * This file defines all available trigger keys for the Communications Management system.
 * Use these constants when calling triggerService.fireTrigger() to ensure consistency.
 * 
 * Usage:
 *   import { TRIGGER_KEYS } from '@shared/triggerKeys';
 *   await triggerService.fireTrigger(TRIGGER_KEYS.USER.REGISTERED, context);
 */

export const TRIGGER_KEYS = {
  // User Events
  USER: {
    REGISTERED: 'user_registered',
    LOGIN: 'user_login',
    LOGOUT: 'user_logout',
    PASSWORD_RESET_REQUESTED: 'password_reset_requested',
    PASSWORD_RESET_COMPLETED: 'password_reset_completed',
    PASSWORD_CHANGED: 'password_changed',
    EMAIL_VERIFIED: 'email_verified',
    PROFILE_UPDATED: 'profile_updated',
    ACCOUNT_LOCKED: 'account_locked',
    ACCOUNT_UNLOCKED: 'account_unlocked',
    TWO_FACTOR_ENABLED: 'two_factor_enabled',
    TWO_FACTOR_DISABLED: 'two_factor_disabled',
  },

  // Agent Events
  AGENT: {
    REGISTERED: 'agent_registered',
    ACTIVATED: 'agent_activated',
    DEACTIVATED: 'agent_deactivated',
    ASSIGNED_TO_MERCHANT: 'agent_assigned_to_merchant',
    COMMISSION_EARNED: 'agent_commission_earned',
  },

  // Prospect Events
  PROSPECT: {
    CREATED: 'prospect_created',
    INVITATION_SENT: 'prospect_invitation_sent',
    APPLICATION_STARTED: 'prospect_application_started',
    APPLICATION_SAVED: 'prospect_application_saved',
    STATUS_CHANGED: 'prospect_status_changed',
    CONVERTED_TO_MERCHANT: 'prospect_converted_to_merchant',
    DOCUMENT_UPLOADED: 'prospect_document_uploaded',
    DOCUMENT_APPROVED: 'prospect_document_approved',
    DOCUMENT_REJECTED: 'prospect_document_rejected',
  },

  // Application Events
  APPLICATION: {
    SUBMITTED: 'application_submitted',
    APPROVED: 'application_approved',
    REJECTED: 'application_rejected',
    PENDING_REVIEW: 'application_pending_review',
    ADDITIONAL_INFO_REQUESTED: 'application_additional_info_requested',
    RESUBMITTED: 'application_resubmitted',
  },

  // Merchant Events
  MERCHANT: {
    CREATED: 'merchant_created',
    ACTIVATED: 'merchant_activated',
    SUSPENDED: 'merchant_suspended',
    REACTIVATED: 'merchant_reactivated',
    PROFILE_UPDATED: 'merchant_profile_updated',
    LOCATION_ADDED: 'merchant_location_added',
    LOCATION_REMOVED: 'merchant_location_removed',
  },

  // Signature Events
  SIGNATURE: {
    REQUESTED: 'signature_requested',
    CAPTURED: 'signature_captured',
    REMINDER_SENT: 'signature_reminder_sent',
    EXPIRED: 'signature_expired',
    ALL_COLLECTED: 'signature_all_collected',
  },

  // Transaction Events
  TRANSACTION: {
    PROCESSED: 'transaction_processed',
    FAILED: 'transaction_failed',
    REFUNDED: 'transaction_refunded',
    CHARGEBACK: 'transaction_chargeback',
    DAILY_SUMMARY: 'transaction_daily_summary',
    WEEKLY_SUMMARY: 'transaction_weekly_summary',
    MONTHLY_SUMMARY: 'transaction_monthly_summary',
  },

  // Underwriting Events
  UNDERWRITING: {
    TICKET_CREATED: 'underwriting_ticket_created',
    STAGE_COMPLETED: 'underwriting_stage_completed',
    ISSUE_RAISED: 'underwriting_issue_raised',
    ISSUE_RESOLVED: 'underwriting_issue_resolved',
    CHECKPOINT_REACHED: 'underwriting_checkpoint_reached',
    APPROVED: 'underwriting_approved',
    DECLINED: 'underwriting_declined',
  },

  // Campaign Events
  CAMPAIGN: {
    CREATED: 'campaign_created',
    ACTIVATED: 'campaign_activated',
    DEACTIVATED: 'campaign_deactivated',
    PROSPECT_ADDED: 'campaign_prospect_added',
    GOAL_REACHED: 'campaign_goal_reached',
  },

  // System Events
  SYSTEM: {
    MAINTENANCE_SCHEDULED: 'system_maintenance_scheduled',
    MAINTENANCE_COMPLETED: 'system_maintenance_completed',
    ERROR_ALERT: 'system_error_alert',
    SECURITY_ALERT: 'system_security_alert',
    BACKUP_COMPLETED: 'system_backup_completed',
  },

  // Notification Events (for internal alerts)
  NOTIFICATION: {
    ALERT_CREATED: 'notification_alert_created',
    REMINDER: 'notification_reminder',
    DEADLINE_APPROACHING: 'notification_deadline_approaching',
    DEADLINE_PASSED: 'notification_deadline_passed',
  },
} as const;

/**
 * Trigger Categories for organizing triggers in the UI
 */
export const TRIGGER_CATEGORIES = {
  USER: 'user',
  AGENT: 'agent',
  PROSPECT: 'prospect',
  APPLICATION: 'application',
  MERCHANT: 'merchant',
  SIGNATURE: 'signature',
  TRANSACTION: 'transaction',
  UNDERWRITING: 'underwriting',
  CAMPAIGN: 'campaign',
  SYSTEM: 'system',
  NOTIFICATION: 'notification',
} as const;

/**
 * Trigger metadata for UI display and documentation
 */
export const TRIGGER_METADATA: Record<string, {
  name: string;
  description: string;
  category: string;
  contextVariables: string[];
}> = {
  // User Events
  [TRIGGER_KEYS.USER.REGISTERED]: {
    name: 'User Registered',
    description: 'Triggered when a new user account is created',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'username', 'firstName', 'lastName', 'role'],
  },
  [TRIGGER_KEYS.USER.LOGIN]: {
    name: 'User Login',
    description: 'Triggered when a user successfully logs in',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'username', 'loginTime', 'ipAddress'],
  },
  [TRIGGER_KEYS.USER.PASSWORD_RESET_REQUESTED]: {
    name: 'Password Reset Requested',
    description: 'Triggered when a user requests a password reset',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'resetToken', 'resetLink', 'expiresAt'],
  },
  [TRIGGER_KEYS.USER.PASSWORD_RESET_COMPLETED]: {
    name: 'Password Reset Completed',
    description: 'Triggered when a password reset is successfully completed',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'username'],
  },
  [TRIGGER_KEYS.USER.PASSWORD_CHANGED]: {
    name: 'Password Changed',
    description: 'Triggered when a user changes their password',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'username', 'changedAt'],
  },
  [TRIGGER_KEYS.USER.ACCOUNT_LOCKED]: {
    name: 'Account Locked',
    description: 'Triggered when a user account is locked due to failed login attempts',
    category: TRIGGER_CATEGORIES.USER,
    contextVariables: ['email', 'username', 'lockedAt', 'reason'],
  },

  // Agent Events
  [TRIGGER_KEYS.AGENT.REGISTERED]: {
    name: 'Agent Registered',
    description: 'Triggered when a new agent account is created',
    category: TRIGGER_CATEGORIES.AGENT,
    contextVariables: ['email', 'firstName', 'lastName', 'agentId', 'agentCode'],
  },
  [TRIGGER_KEYS.AGENT.ACTIVATED]: {
    name: 'Agent Activated',
    description: 'Triggered when an agent account is activated',
    category: TRIGGER_CATEGORIES.AGENT,
    contextVariables: ['email', 'firstName', 'lastName', 'agentId'],
  },
  [TRIGGER_KEYS.AGENT.COMMISSION_EARNED]: {
    name: 'Agent Commission Earned',
    description: 'Triggered when an agent earns a commission',
    category: TRIGGER_CATEGORIES.AGENT,
    contextVariables: ['email', 'firstName', 'lastName', 'amount', 'merchantName', 'transactionId'],
  },

  // Prospect Events
  [TRIGGER_KEYS.PROSPECT.CREATED]: {
    name: 'Prospect Created',
    description: 'Triggered when a new prospect is created',
    category: TRIGGER_CATEGORIES.PROSPECT,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'agentName'],
  },
  [TRIGGER_KEYS.PROSPECT.INVITATION_SENT]: {
    name: 'Prospect Invitation Sent',
    description: 'Triggered when an invitation is sent to a prospect',
    category: TRIGGER_CATEGORIES.PROSPECT,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'invitationLink', 'agentName'],
  },
  [TRIGGER_KEYS.PROSPECT.APPLICATION_STARTED]: {
    name: 'Prospect Application Started',
    description: 'Triggered when a prospect starts their application',
    category: TRIGGER_CATEGORIES.PROSPECT,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'applicationId'],
  },
  [TRIGGER_KEYS.PROSPECT.CONVERTED_TO_MERCHANT]: {
    name: 'Prospect Converted to Merchant',
    description: 'Triggered when a prospect is converted to an active merchant',
    category: TRIGGER_CATEGORIES.PROSPECT,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'merchantId'],
  },

  // Application Events
  [TRIGGER_KEYS.APPLICATION.SUBMITTED]: {
    name: 'Application Submitted',
    description: 'Triggered when a merchant application is submitted',
    category: TRIGGER_CATEGORIES.APPLICATION,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'applicationId', 'submittedAt'],
  },
  [TRIGGER_KEYS.APPLICATION.APPROVED]: {
    name: 'Application Approved',
    description: 'Triggered when a merchant application is approved',
    category: TRIGGER_CATEGORIES.APPLICATION,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'applicationId', 'approvedAt'],
  },
  [TRIGGER_KEYS.APPLICATION.REJECTED]: {
    name: 'Application Rejected',
    description: 'Triggered when a merchant application is rejected',
    category: TRIGGER_CATEGORIES.APPLICATION,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'applicationId', 'reason'],
  },
  [TRIGGER_KEYS.APPLICATION.ADDITIONAL_INFO_REQUESTED]: {
    name: 'Additional Information Requested',
    description: 'Triggered when additional information is requested for an application',
    category: TRIGGER_CATEGORIES.APPLICATION,
    contextVariables: ['email', 'firstName', 'lastName', 'businessName', 'applicationId', 'requestedInfo'],
  },

  // Signature Events
  [TRIGGER_KEYS.SIGNATURE.REQUESTED]: {
    name: 'Signature Requested',
    description: 'Triggered when a signature is requested from a signer',
    category: TRIGGER_CATEGORIES.SIGNATURE,
    contextVariables: ['email', 'signerName', 'businessName', 'signatureLink', 'expiresAt'],
  },
  [TRIGGER_KEYS.SIGNATURE.CAPTURED]: {
    name: 'Signature Captured',
    description: 'Triggered when a signature is successfully captured',
    category: TRIGGER_CATEGORIES.SIGNATURE,
    contextVariables: ['email', 'signerName', 'businessName', 'signedAt'],
  },
  [TRIGGER_KEYS.SIGNATURE.ALL_COLLECTED]: {
    name: 'All Signatures Collected',
    description: 'Triggered when all required signatures have been collected',
    category: TRIGGER_CATEGORIES.SIGNATURE,
    contextVariables: ['businessName', 'applicationId', 'totalSigners'],
  },

  // Merchant Events
  [TRIGGER_KEYS.MERCHANT.CREATED]: {
    name: 'Merchant Created',
    description: 'Triggered when a new merchant account is created',
    category: TRIGGER_CATEGORIES.MERCHANT,
    contextVariables: ['email', 'businessName', 'merchantId', 'agentName'],
  },
  [TRIGGER_KEYS.MERCHANT.ACTIVATED]: {
    name: 'Merchant Activated',
    description: 'Triggered when a merchant account is activated',
    category: TRIGGER_CATEGORIES.MERCHANT,
    contextVariables: ['email', 'businessName', 'merchantId', 'activatedAt'],
  },
  [TRIGGER_KEYS.MERCHANT.SUSPENDED]: {
    name: 'Merchant Suspended',
    description: 'Triggered when a merchant account is suspended',
    category: TRIGGER_CATEGORIES.MERCHANT,
    contextVariables: ['email', 'businessName', 'merchantId', 'reason'],
  },

  // Underwriting Events
  [TRIGGER_KEYS.UNDERWRITING.TICKET_CREATED]: {
    name: 'Underwriting Ticket Created',
    description: 'Triggered when a new underwriting ticket is created',
    category: TRIGGER_CATEGORIES.UNDERWRITING,
    contextVariables: ['ticketId', 'businessName', 'assignedTo', 'priority'],
  },
  [TRIGGER_KEYS.UNDERWRITING.ISSUE_RAISED]: {
    name: 'Underwriting Issue Raised',
    description: 'Triggered when an issue is raised during underwriting',
    category: TRIGGER_CATEGORIES.UNDERWRITING,
    contextVariables: ['ticketId', 'businessName', 'issueSeverity', 'issueDescription'],
  },
  [TRIGGER_KEYS.UNDERWRITING.APPROVED]: {
    name: 'Underwriting Approved',
    description: 'Triggered when underwriting is approved',
    category: TRIGGER_CATEGORIES.UNDERWRITING,
    contextVariables: ['ticketId', 'businessName', 'approvedBy', 'approvedAt'],
  },

  // System Events
  [TRIGGER_KEYS.SYSTEM.SECURITY_ALERT]: {
    name: 'Security Alert',
    description: 'Triggered when a security event is detected',
    category: TRIGGER_CATEGORIES.SYSTEM,
    contextVariables: ['alertType', 'severity', 'description', 'affectedUser', 'ipAddress'],
  },
  [TRIGGER_KEYS.SYSTEM.ERROR_ALERT]: {
    name: 'System Error Alert',
    description: 'Triggered when a critical system error occurs',
    category: TRIGGER_CATEGORIES.SYSTEM,
    contextVariables: ['errorType', 'errorMessage', 'stackTrace', 'occurredAt'],
  },
};

/**
 * Helper to get all trigger keys as a flat array
 */
export function getAllTriggerKeys(): string[] {
  const keys: string[] = [];
  for (const category of Object.values(TRIGGER_KEYS)) {
    for (const key of Object.values(category)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Helper to get triggers by category
 */
export function getTriggerKeysByCategory(category: keyof typeof TRIGGER_KEYS): string[] {
  return Object.values(TRIGGER_KEYS[category]);
}

/**
 * Type for trigger keys (for type-safe usage)
 */
export type TriggerKey = typeof TRIGGER_KEYS[keyof typeof TRIGGER_KEYS][keyof typeof TRIGGER_KEYS[keyof typeof TRIGGER_KEYS]];
