import { DatabaseStorage } from "../storage";
import type { 
  WorkflowDefinition, WorkflowStage, WorkflowTicket, WorkflowTicketStage,
  WorkflowIssue, WorkflowTask, WorkflowTransition,
  InsertWorkflowTicket, InsertWorkflowTicketStage, InsertWorkflowIssue,
  InsertWorkflowTask, InsertWorkflowTransition
} from "@shared/schema";

export interface StageHandlerContext {
  ticket: WorkflowTicket;
  stage: WorkflowStage;
  ticketStage: WorkflowTicketStage;
  storage: DatabaseStorage;
  entityData: any;
}

export interface StageHandlerResult {
  status: 'passed' | 'failed' | 'pending_review' | 'error';
  issues?: Array<{
    issueCode: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical' | 'blocker';
    title: string;
    description: string;
    affectedField?: string;
    affectedEntity?: string;
    scoreImpact?: number;
    sourceData?: Record<string, any>;
  }>;
  tasks?: Array<{
    taskCode: string;
    title: string;
    description: string;
    priority: string;
    assignedRoles?: string[];
  }>;
  metadata?: Record<string, any>;
  notes?: string;
}

export type StageHandler = (context: StageHandlerContext) => Promise<StageHandlerResult>;

export class WorkflowEngine {
  private handlers: Map<string, StageHandler> = new Map();
  private storage: DatabaseStorage;

  constructor(storage: DatabaseStorage) {
    this.storage = storage;
  }

  registerHandler(handlerKey: string, handler: StageHandler): void {
    this.handlers.set(handlerKey, handler);
  }

  getHandler(handlerKey: string): StageHandler | undefined {
    return this.handlers.get(handlerKey);
  }

  async createTicket(params: {
    workflowCode: string;
    entityType: string;
    entityId: number;
    createdById: string;
    priority?: string;
    metadata?: Record<string, any>;
  }): Promise<WorkflowTicket> {
    const definition = await this.storage.getWorkflowDefinitionByCode(params.workflowCode);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${params.workflowCode}`);
    }

    const ticketNumber = await this.storage.generateTicketNumber(params.workflowCode);
    
    const stages = await this.storage.getWorkflowStages(definition.id);
    const firstStage = stages.find(s => s.orderIndex === 0) || stages[0];
    
    const ticket = await this.storage.createWorkflowTicket({
      ticketNumber,
      workflowDefinitionId: definition.id,
      entityType: params.entityType,
      entityId: params.entityId,
      status: 'submitted',
      priority: params.priority || 'normal',
      currentStageId: firstStage?.id || null,
      submittedAt: new Date(),
      metadata: params.metadata || {},
    });

    await this.storage.createWorkflowTransition({
      ticketId: ticket.id,
      fromStageId: null,
      toStageId: firstStage?.id || null,
      transitionType: 'status_change',
      triggeredBy: params.createdById,
      notes: 'Ticket created',
    });

    return ticket;
  }

  async startProcessing(ticketId: number, userId: string): Promise<WorkflowTicket> {
    const ticket = await this.storage.getWorkflowTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    if (ticket.status !== 'submitted' && ticket.status !== 'pending') {
      throw new Error(`Cannot start processing: ticket status is ${ticket.status}. Must be 'pending' or 'submitted'.`);
    }

    const updated = await this.storage.updateWorkflowTicket(ticketId, {
      status: 'in_progress',
      startedAt: new Date(),
    });

    await this.storage.createWorkflowTransition({
      ticketId: ticket.id,
      fromStageId: ticket.currentStageId,
      toStageId: ticket.currentStageId,
      transitionType: 'status_change',
      fromValue: ticket.status,
      toValue: 'in_progress',
      triggeredBy: userId,
      notes: 'Processing started',
    });

    if (ticket.currentStageId) {
      await this.initializeStage(ticketId, ticket.currentStageId);
    }

    return updated!;
  }

  async initializeStage(ticketId: number, stageId: number): Promise<WorkflowTicketStage> {
    const existingStages = await this.storage.getWorkflowTicketStages(ticketId);
    const existing = existingStages.find(s => s.stageId === stageId);
    
    if (existing) {
      return existing;
    }

    const ticketStage = await this.storage.createWorkflowTicketStage({
      ticketId,
      stageId,
      status: 'pending',
      startedAt: new Date(),
    });

    return ticketStage;
  }

  async executeCurrentStage(ticketId: number, userId: string): Promise<StageHandlerResult | null> {
    const ticket = await this.storage.getWorkflowTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    if (!ticket.currentStageId) {
      return null;
    }

    const stage = await this.storage.getWorkflowStage(ticket.currentStageId);
    if (!stage) {
      throw new Error(`Stage not found: ${ticket.currentStageId}`);
    }

    const ticketStages = await this.storage.getWorkflowTicketStages(ticketId);
    let ticketStage = ticketStages.find(ts => ts.stageId === stage.id);
    
    if (!ticketStage) {
      ticketStage = await this.initializeStage(ticketId, stage.id);
    }

    await this.storage.updateWorkflowTicketStage(ticketStage.id, {
      status: 'in_progress',
      startedAt: new Date(),
      executionCount: (ticketStage.executionCount || 0) + 1,
      lastExecutedAt: new Date(),
      lastExecutedBy: userId,
    });

    const entityData = await this.loadEntityData(ticket);

    const isAutomated = stage.stageType === 'automated';
    const handler = stage.handlerKey ? this.handlers.get(stage.handlerKey) : null;
    
    let result: StageHandlerResult;
    
    if (handler && isAutomated) {
      const context: StageHandlerContext = {
        ticket,
        stage,
        ticketStage,
        storage: this.storage,
        entityData,
      };
      
      try {
        result = await handler(context);
      } catch (error) {
        result = {
          status: 'error',
          issues: [{
            issueCode: 'SYSTEM_ERROR',
            type: 'system',
            severity: 'high',
            title: 'Handler execution failed',
            description: error instanceof Error ? error.message : 'Unknown error',
          }],
        };
      }
    } else {
      result = {
        status: 'pending_review',
        notes: 'Manual review required',
      };
    }

    await this.processHandlerResult(ticket, stage, ticketStage, result, userId);

    return result;
  }

  private async processHandlerResult(
    ticket: WorkflowTicket,
    stage: WorkflowStage,
    ticketStage: WorkflowTicketStage,
    result: StageHandlerResult,
    userId: string
  ): Promise<void> {
    if (result.issues) {
      for (const issue of result.issues) {
        await this.storage.createWorkflowIssue({
          ticketId: ticket.id,
          ticketStageId: ticketStage.id,
          issueCode: issue.issueCode,
          issueType: issue.type,
          severity: issue.severity,
          title: issue.title,
          description: issue.description || null,
          affectedField: issue.affectedField || null,
          affectedEntity: issue.affectedEntity || null,
          scoreImpact: issue.scoreImpact || null,
          sourceData: issue.sourceData || {},
          status: 'open',
        });
      }
    }

    if (result.tasks) {
      for (const task of result.tasks) {
        await this.storage.createWorkflowTask({
          ticketId: ticket.id,
          taskType: task.taskCode,
          title: task.title,
          description: task.description,
          status: 'pending',
          priority: task.priority,
          assignedToRole: task.assignedRoles?.join(',') || null,
          createdBy: userId,
        });
      }
    }

    const stageResult = result.status === 'passed' ? 'pass' : 
                        result.status === 'failed' ? 'fail' :
                        result.status === 'error' ? 'error' : 'warning';
    
    const hasBlockingIssues = result.issues?.some(i => 
      i.severity === 'critical' || i.severity === 'blocker' || i.severity === 'high'
    );

    let stageStatus = result.status === 'passed' ? 'completed' :
                      result.status === 'failed' ? 'failed' :
                      result.status === 'pending_review' ? 'blocked' : 'failed';

    if (hasBlockingIssues) {
      stageStatus = 'blocked';
      await this.storage.updateWorkflowTicket(ticket.id, {
        status: 'pending_review',
      });
    }

    await this.storage.updateWorkflowTicketStage(ticketStage.id, {
      status: stageStatus,
      result: stageResult,
      completedAt: stageStatus === 'completed' || stageStatus === 'failed' ? new Date() : null,
      handlerResponse: result.metadata || {},
    });

    if (stageStatus === 'completed' && !hasBlockingIssues && stage.autoAdvance) {
      await this.advanceToNextStage(ticket, stage, userId);
    }
  }

  async advanceToNextStage(ticket: WorkflowTicket, currentStage: WorkflowStage, userId: string): Promise<WorkflowTicket | null> {
    const stages = await this.storage.getWorkflowStages(ticket.workflowDefinitionId);
    const currentIndex = stages.findIndex(s => s.id === currentStage.id);
    const nextStage = stages[currentIndex + 1];

    if (!nextStage) {
      const updated = await this.storage.updateWorkflowTicket(ticket.id, {
        status: 'approved',
        currentStageId: null,
        completedAt: new Date(),
      });

      await this.storage.createWorkflowTransition({
        ticketId: ticket.id,
        fromStageId: currentStage.id,
        toStageId: null,
        transitionType: 'status_change',
        fromValue: ticket.status,
        toValue: 'approved',
        triggeredBy: userId,
        notes: 'Workflow completed',
      });

      return updated!;
    }

    const updated = await this.storage.updateWorkflowTicket(ticket.id, {
      currentStageId: nextStage.id,
    });

    await this.storage.createWorkflowTransition({
      ticketId: ticket.id,
      fromStageId: currentStage.id,
      toStageId: nextStage.id,
      transitionType: 'stage_change',
      triggeredBy: userId,
      notes: `Advanced to stage: ${nextStage.name}`,
    });

    await this.initializeStage(ticket.id, nextStage.id);

    const isAutomated = nextStage.stageType === 'automated';
    if (isAutomated && nextStage.handlerKey) {
      await this.executeCurrentStage(ticket.id, userId);
    }

    return updated!;
  }

  async resolveCheckpoint(ticketId: number, decision: 'approve' | 'reject', userId: string, notes?: string): Promise<WorkflowTicket> {
    const ticket = await this.storage.getWorkflowTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    if (ticket.status !== 'pending_review') {
      throw new Error(`Ticket not in pending review status: ${ticket.status}`);
    }

    const openIssues = await this.storage.getOpenWorkflowIssues(ticketId);
    for (const issue of openIssues) {
      if (decision === 'approve') {
        await this.storage.overrideWorkflowIssue(issue.id, notes || 'Checkpoint approved', userId);
      } else {
        await this.storage.updateWorkflowIssue(issue.id, { status: 'dismissed' });
      }
    }

    if (decision === 'reject') {
      const updated = await this.storage.updateWorkflowTicket(ticketId, {
        status: 'rejected',
        completedAt: new Date(),
      });

      await this.storage.createWorkflowTransition({
        ticketId: ticket.id,
        fromStageId: ticket.currentStageId,
        toStageId: null,
        transitionType: 'status_change',
        fromValue: 'pending_review',
        toValue: 'rejected',
        triggeredBy: userId,
        reason: notes || 'Checkpoint rejected',
        notes: notes || 'Checkpoint rejected',
      });

      return updated!;
    }

    const updated = await this.storage.updateWorkflowTicket(ticketId, {
      status: 'in_progress',
      lastReviewedAt: new Date(),
      lastReviewedBy: userId,
      reviewCount: (ticket.reviewCount || 0) + 1,
    });

    await this.storage.createWorkflowTransition({
      ticketId: ticket.id,
      fromStageId: ticket.currentStageId,
      toStageId: ticket.currentStageId,
      transitionType: 'status_change',
      fromValue: 'pending_review',
      toValue: 'in_progress',
      triggeredBy: userId,
      notes: notes || 'Checkpoint approved - continuing processing',
    });

    if (ticket.currentStageId) {
      const stage = await this.storage.getWorkflowStage(ticket.currentStageId);
      if (stage) {
        const ticketStages = await this.storage.getWorkflowTicketStages(ticketId);
        const currentTicketStage = ticketStages.find(ts => ts.stageId === stage.id);
        if (currentTicketStage) {
          await this.storage.updateWorkflowTicketStage(currentTicketStage.id, {
            status: 'completed',
            result: 'pass',
            reviewedAt: new Date(),
            reviewedBy: userId,
            reviewNotes: notes || null,
            reviewDecision: 'approve',
          });
        }
        await this.advanceToNextStage(updated!, stage, userId);
      }
    }

    return updated!;
  }

  async assignTicket(ticketId: number, assigneeId: string, assignedById: string, notes?: string): Promise<void> {
    const ticket = await this.storage.getWorkflowTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const currentAssignment = await this.storage.getActiveWorkflowAssignment(ticketId);
    if (currentAssignment) {
      await this.storage.deactivateWorkflowAssignment(currentAssignment.id);
    }

    await this.storage.createWorkflowAssignment({
      ticketId,
      assignedToId: assigneeId,
      assignedById,
      isActive: true,
      notes,
    });

    await this.storage.updateWorkflowTicket(ticketId, {
      assignedToId: assigneeId,
      assignedAt: new Date(),
    });

    await this.storage.createWorkflowTransition({
      ticketId,
      fromStageId: ticket.currentStageId,
      toStageId: ticket.currentStageId,
      transitionType: 'assignment_change',
      toValue: assigneeId,
      triggeredBy: assignedById,
      notes: `Assigned to user`,
    });
  }

  async addNote(ticketId: number, noteType: string, content: string, createdBy: string, isInternal: boolean = true): Promise<void> {
    await this.storage.createWorkflowNote({
      ticketId,
      ticketStageId: null,
      noteType,
      content,
      createdBy,
      isInternal,
    });
  }

  async getTicketDetails(ticketId: number): Promise<{
    ticket: WorkflowTicket;
    definition: WorkflowDefinition | null;
    stages: WorkflowStage[];
    ticketStages: WorkflowTicketStage[];
    issues: WorkflowIssue[];
    tasks: WorkflowTask[];
    transitions: WorkflowTransition[];
    currentStage: WorkflowStage | null;
  }> {
    const ticket = await this.storage.getWorkflowTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const definition = await this.storage.getWorkflowDefinition(ticket.workflowDefinitionId);
    const stages = await this.storage.getWorkflowStages(ticket.workflowDefinitionId);
    const ticketStages = await this.storage.getWorkflowTicketStages(ticketId);
    const issues = await this.storage.getWorkflowIssues(ticketId);
    const tasks = await this.storage.getWorkflowTasks(ticketId);
    const transitions = await this.storage.getWorkflowTransitions(ticketId);
    const currentStage = ticket.currentStageId 
      ? stages.find(s => s.id === ticket.currentStageId) || null 
      : null;

    return {
      ticket,
      definition: definition || null,
      stages,
      ticketStages,
      issues,
      tasks,
      transitions,
      currentStage,
    };
  }

  private async loadEntityData(ticket: WorkflowTicket): Promise<any> {
    switch (ticket.entityType) {
      case 'prospect':
      case 'prospect_application':
        return this.storage.getMerchantProspect(ticket.entityId);
      case 'merchant':
        return this.storage.getMerchant(ticket.entityId);
      default:
        return null;
    }
  }
}

export function createWorkflowEngine(storage: DatabaseStorage): WorkflowEngine {
  return new WorkflowEngine(storage);
}
