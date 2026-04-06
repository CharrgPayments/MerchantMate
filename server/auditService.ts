import { Request, Response } from 'express';
import { db, isShutdownInProgress } from './db';
import { auditLogs, securityEvents, dataAccessLogs, type InsertAuditLog, type InsertSecurityEvent, type InsertDataAccessLog } from '@shared/schema';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';

export interface AuditContext {
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  method?: string;
  endpoint?: string;
  requestParams?: any;
  requestBody?: any;
  statusCode?: number;
  responseTime?: number;
  environment?: string;
}

export class AuditService {
  private startTime: number = Date.now();
  private database: any;
  
  constructor(database?: any) {
    this.database = database || db; // Use provided database or default to static db
  }
  
  /**
   * Log a comprehensive audit trail entry
   */
  async logAction(
    action: string,
    resource: string,
    context: AuditContext,
    options?: {
      resourceId?: string;
      oldValues?: any;
      newValues?: any;
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
      dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
      notes?: string;
      tags?: any;
      complianceFlags?: any;
    }
  ): Promise<number> {
    try {
      // Skip logging if we're shutting down to prevent pool errors
      if (isShutdownInProgress()) {
        console.log('Skipping audit log - shutdown in progress');
        return -1;
      }
      
      const auditEntry: InsertAuditLog = {
        userId: context.userId || null,
        userEmail: context.userEmail || null,
        sessionId: context.sessionId || null,
        ipAddress: context.ipAddress || 'unknown',
        userAgent: context.userAgent || null,
        
        action,
        resource,
        resourceId: options?.resourceId || null,
        
        method: context.method || null,
        endpoint: context.endpoint || null,
        requestParams: context.requestParams || null,
        requestBody: this.sanitizeRequestBody(context.requestBody),
        
        statusCode: context.statusCode || null,
        responseTime: context.responseTime || null,
        
        oldValues: options?.oldValues || null,
        newValues: options?.newValues || null,
        
        riskLevel: options?.riskLevel || 'low',
        complianceFlags: options?.complianceFlags || null,
        dataClassification: options?.dataClassification || null,
        
        environment: context.environment || 'production',
        applicationVersion: process.env.APP_VERSION || 'unknown',
        tags: options?.tags || null,
        notes: options?.notes || null,
      };

      const [result] = await this.database.insert(auditLogs).values(auditEntry).returning({ id: auditLogs.id });
      
      // Check if this action should trigger a security event
      await this.checkForSecurityEvents(result.id, action, resource, context, options);
      
      return result.id;
    } catch (error) {
      console.error('Failed to log audit entry:', error);
      // Don't throw error - just log it to prevent app crashes
      return -1;
    }
  }

  /**
   * Log data access for compliance tracking
   */
  async logDataAccess(
    userId: string,
    dataType: string,
    tableName: string,
    accessType: 'read' | 'write' | 'delete' | 'export',
    context: {
      auditLogId?: number;
      recordId?: string;
      fieldAccessed?: string;
      accessReason?: string;
      dataVolume?: number;
      lawfulBasis?: string;
      retentionPeriod?: number;
    } = {}
  ): Promise<void> {
    try {
      const dataAccessEntry: InsertDataAccessLog = {
        auditLogId: context.auditLogId || null,
        userId,
        dataType,
        tableName,
        recordId: context.recordId || null,
        fieldAccessed: context.fieldAccessed || null,
        accessType,
        accessReason: context.accessReason || null,
        dataVolume: context.dataVolume || null,
        lawfulBasis: context.lawfulBasis || null,
        retentionPeriod: context.retentionPeriod || null,
      };

      await this.database.insert(dataAccessLogs).values(dataAccessEntry);
    } catch (error) {
      console.error('Failed to log data access:', error);
    }
  }

  /**
   * Create a security event for high-risk actions
   */
  async createSecurityEvent(
    auditLogId: number,
    eventType: string,
    severity: 'info' | 'warning' | 'error' | 'critical',
    options?: {
      detectionMethod?: string;
      detectedBy?: string;
      affectedUsers?: string[];
      affectedResources?: any[];
      notes?: string;
    }
  ): Promise<void> {
    try {
      const securityEvent: InsertSecurityEvent = {
        auditLogId,
        eventType,
        severity,
        detectionMethod: options?.detectionMethod || 'automatic',
        detectedBy: options?.detectedBy || 'system',
        affectedUsers: options?.affectedUsers || null,
        affectedResources: options?.affectedResources || null,
        investigationNotes: options?.notes || null,
      };

      await this.database.insert(securityEvents).values(securityEvent);
    } catch (error) {
      console.error('Failed to create security event:', error);
    }
  }

  /**
   * Express middleware for automatic audit logging
   */
  auditMiddleware() {
    return async (req: Request & { user?: any; dynamicDB?: any; dbEnv?: string }, res: Response, next: Function) => {
      const startTime = Date.now();
      
      try {
        // Continue processing the request
        next();
        
        // Log the action after response (non-blocking)
        res.on('finish', async () => {
          try {
            const responseTime = Date.now() - startTime;
            const userId = (req.session as any)?.userId || null;
            const sessionId = req.sessionID || null;
            
            // Only log API endpoints to reduce noise
            if (req.path.startsWith('/api/')) {
              // Use request database if available, otherwise fall back to instance database
              const dbToUse = req.dynamicDB || this.database;
              console.log(`Audit logging to database environment: ${req.dbEnv || 'production'}`);
              
              // Create a temporary audit service instance with the correct database
              const contextualAuditService = new AuditService(dbToUse);
              
              await contextualAuditService.logAction(
                req.method.toLowerCase(),
                req.path,
                {
                  userId,
                  sessionId,
                  ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                  userAgent: req.get('User-Agent') || null,
                  method: req.method,
                  endpoint: req.path,
                  requestParams: req.query,
                  statusCode: res.statusCode,
                  responseTime,
                  environment: req.dbEnv || process.env.NODE_ENV || 'production'
                },
                {
                  riskLevel: this.calculateRiskLevel(req.method, req.path, res.statusCode),
                  dataClassification: this.classifyDataType(req.path),
                  notes: `${req.method} ${req.path} - ${res.statusCode}`
                }
              );
            }
          } catch (error) {
            // Silent error - don't block the response
            console.log('Audit logging error:', error instanceof Error ? error.message : 'Unknown error');
          }
        });
      } catch (error) {
        // Don't block the request if audit logging fails
        console.log('Audit middleware error:', error instanceof Error ? error.message : 'Unknown error');
        next();
      }
    };
  }

  /**
   * Parse endpoint to determine action and resource
   */
  private parseEndpoint(method: string, url: string): { action: string; resource: string } {
    const path = url.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    
    // Default values
    let action = method.toLowerCase();
    let resource = 'unknown';
    
    // Map HTTP methods to CRUD actions
    switch (method) {
      case 'GET':
        action = 'read';
        break;
      case 'POST':
        action = 'create';
        break;
      case 'PUT':
      case 'PATCH':
        action = 'update';
        break;
      case 'DELETE':
        action = 'delete';
        break;
    }
    
    // Extract resource from URL
    if (segments.includes('api')) {
      const apiIndex = segments.indexOf('api');
      if (segments[apiIndex + 1]) {
        resource = segments[apiIndex + 1];
        
        // Handle special cases
        if (resource === 'auth') {
          if (segments[apiIndex + 2] === 'login') action = 'login';
          if (segments[apiIndex + 2] === 'logout') action = 'logout';
          resource = 'authentication';
        }
        
        if (resource === 'admin') {
          resource = segments[apiIndex + 2] || 'admin';
          action = 'admin_' + action;
        }
      }
    }
    
    return { action, resource };
  }

  /**
   * Calculate risk level based on request characteristics
   */
  private calculateRiskLevel(method: string, url: string, statusCode: number): 'low' | 'medium' | 'high' | 'critical' {
    // Critical risk indicators
    if (statusCode === 401 || statusCode === 403) return 'critical';
    if (url.includes('/admin/') || url.includes('/security/')) return 'high';
    if (url.includes('/auth/') && statusCode >= 400) return 'high';
    
    // High risk indicators
    if (method === 'DELETE') return 'high';
    if (url.includes('/api/admin/reset-testing-data')) return 'high';
    if (url.includes('/prospects') && method === 'POST') return 'medium';
    
    // Medium risk indicators
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'medium';
    
    return 'low';
  }

  /**
   * Classify data type based on endpoint
   */
  private classifyDataType(url: string): 'public' | 'internal' | 'confidential' | 'restricted' {
    if (url.includes('/auth/') || url.includes('/security/')) return 'restricted';
    if (url.includes('/admin/')) return 'confidential';
    if (url.includes('/prospects') || url.includes('/merchants')) return 'confidential';
    if (url.includes('/api/')) return 'internal';
    return 'public';
  }

  /**
   * Check if action should trigger security events
   */
  private async checkForSecurityEvents(
    auditLogId: number,
    action: string,
    resource: string,
    context: AuditContext,
    options?: any
  ): Promise<void> {
    // Failed authentication attempts
    if (action === 'login' && context.statusCode === 401) {
      await this.createSecurityEvent(auditLogId, 'failed_login', 'warning', {
        detectionMethod: 'automatic',
        notes: `Failed login attempt from ${context.ipAddress}`,
      });
    }

    // Administrative actions
    if (action.startsWith('admin_') && resource !== 'db-environment') {
      await this.createSecurityEvent(auditLogId, 'admin_action', 'info', {
        detectionMethod: 'automatic',
        notes: `Administrative action: ${action} on ${resource}`,
      });
    }

    // High-risk data operations
    if (options?.riskLevel === 'critical' || options?.riskLevel === 'high') {
      await this.createSecurityEvent(auditLogId, 'high_risk_operation', 'warning', {
        detectionMethod: 'automatic',
        notes: `High-risk operation detected: ${action} on ${resource}`,
      });
    }

    // Data deletion operations
    if (action === 'delete' && context.statusCode === 200) {
      await this.createSecurityEvent(auditLogId, 'data_deletion', 'info', {
        detectionMethod: 'automatic',
        notes: `Data deletion: ${resource}`,
      });
    }
  }

  /**
   * Sanitize request body to remove sensitive information
   */
  private sanitizeRequestBody(body: any): any {
    if (!body) return null;
    
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credit_card', 'ssn'];
    const sanitized = { ...body };
    
    const sanitizeObject = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      const result = Array.isArray(obj) ? [] : {};
      
      for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        if (sensitiveFields.some(field => keyLower.includes(field))) {
          (result as any)[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          (result as any)[key] = sanitizeObject(value);
        } else {
          (result as any)[key] = value;
        }
      }
      
      return result;
    };
    
    return sanitizeObject(sanitized);
  }

  /**
   * Helper function to get client IP
   */
  private getClientIP(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      (req as any).connection?.remoteAddress ||
      (req as any).socket?.remoteAddress ||
      req.ip ||
      "unknown"
    );
  }

  /**
   * Calculate risk level based on request method and path
   */
  private calculateRiskLevel(method: string, path: string, statusCode: number): 'low' | 'medium' | 'high' | 'critical' {
    // High-risk operations - ALL delete operations are high risk
    if (method === 'DELETE' || path.includes('delete') || path.includes('/delete')) return 'high';
    if (path.includes('admin') || path.includes('users') || path.includes('agents')) return 'medium';
    if (statusCode >= 400) return 'medium';
    
    return 'low';
  }

  /**
   * Classify data type based on endpoint
   */
  private classifyDataType(path: string): 'public' | 'internal' | 'confidential' | 'restricted' {
    if (path.includes('auth') || path.includes('user') || path.includes('security')) return 'confidential';
    if (path.includes('admin') || path.includes('agents') || path.includes('merchants')) return 'restricted';
    
    return 'internal';
  }
}

export const auditService = new AuditService();