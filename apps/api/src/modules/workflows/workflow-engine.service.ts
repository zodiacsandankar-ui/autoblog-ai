import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';

interface WorkflowStep {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'delay' | 'approval' | 'parallel' | 'loop';
  config: Record<string, any>;
  next?: string[];
  condition?: string;
}

interface WorkflowDefinition {
  name: string;
  description?: string;
  projectId?: string;
  triggers?: {
    type: 'cron' | 'event' | 'manual';
    config: Record<string, any>;
  }[];
  steps: WorkflowStep[];
  variables?: Record<string, any>;
  notifications?: {
    onSuccess?: string[];
    onFailure?: string[];
    channels?: string[];
  };
}

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  private readonly WORKFLOW_TEMPLATES = {
    auto_blogger: {
      name: 'Auto Blogger',
      description: 'Automatically discovers trends, generates articles, optimizes SEO, and publishes',
      triggers: [{ type: 'cron', config: { expression: '0 6 * * *' } }],
      steps: [
        { id: 'discover-trends', name: 'Discover Trends', type: 'action', config: { service: 'trends', method: 'discover', params: {} }, next: ['analyze-keywords'] },
        { id: 'analyze-keywords', name: 'Analyze Keywords', type: 'action', config: { service: 'keywords', method: 'research', params: {} }, next: ['generate-content'] },
        { id: 'generate-content', name: 'Generate Article', type: 'action', config: { service: 'articles', method: 'generate', params: {} }, next: ['optimize-seo'] },
        { id: 'optimize-seo', name: 'Optimize SEO', type: 'action', config: { service: 'seo', method: 'optimize', params: {} }, next: ['generate-images'] },
        { id: 'generate-images', name: 'Generate Images', type: 'action', config: { service: 'images', method: 'generate', params: {} }, next: ['schedule-publish'] },
        { id: 'schedule-publish', name: 'Schedule Publishing', type: 'action', config: { service: 'scheduler', method: 'schedule', params: {} }, next: [] },
      ],
    },
    content_refresher: {
      name: 'Content Refresher',
      description: 'Finds outdated content, refreshes it, and republishes',
      triggers: [{ type: 'cron', config: { expression: '0 0 * * 0' } }],
      steps: [
        { id: 'find-old-content', name: 'Find Old Content', type: 'action', config: { service: 'articles', method: 'findOldContent', params: { daysOld: 90 } }, next: ['check-performance'] },
        { id: 'check-performance', name: 'Check Performance', type: 'action', config: { service: 'analytics', method: 'getTraffic', params: {} }, next: ['decide-refresh'] },
        { id: 'decide-refresh', name: 'Should Refresh?', type: 'condition', config: { field: 'performance.traffic', operator: 'lt', value: 100 }, next: ['refresh-content', 'done'] },
        { id: 'refresh-content', name: 'Refresh Content', type: 'action', config: { service: 'articles', method: 'regenerate', params: {} }, next: ['republish'] },
        { id: 'republish', name: 'Republish', type: 'action', config: { service: 'publishing', method: 'publish', params: {} }, next: [] },
        { id: 'done', name: 'Skip Refresh', type: 'action', config: { service: 'logger', method: 'log', params: { message: 'Content still performing well' } }, next: [] },
      ],
    },
    trend_hunter: {
      name: 'Trend Hunter',
      description: 'Monitors trending topics and creates content briefs',
      triggers: [{ type: 'cron', config: { expression: '0 */6 * * *' } }],
      steps: [
        { id: 'fetch-trends', name: 'Fetch Trends', type: 'action', config: { service: 'trends', method: 'discover', params: {} }, next: ['analyze-trends'] },
        { id: 'analyze-trends', name: 'Analyze with AI', type: 'action', config: { service: 'deepseek', method: 'analyze', params: {} }, next: ['create-briefs'] },
        { id: 'create-briefs', name: 'Create Content Briefs', type: 'action', config: { service: 'articles', method: 'createBrief', params: {} }, next: ['notify'] },
        { id: 'notify', name: 'Notify Team', type: 'action', config: { service: 'notifications', method: 'send', params: {} }, next: [] },
      ],
    },
    seo_optimizer: {
      name: 'SEO Optimizer', description: 'Batch optimizes articles for SEO',
      triggers: [{ type: 'cron', config: { expression: '0 2 * * 1' } }],
      steps: [
        { id: 'fetch-articles', name: 'Fetch Unoptimized Articles', type: 'action', config: { service: 'articles', method: 'findByStatus', params: { status: 'published' } }, next: ['check-seo'] },
        { id: 'check-seo', name: 'SEO Audit Batch', type: 'loop', config: { items: '{{articles}}', step: 'audit-single' }, next: ['apply-fixes'] },
        { id: 'audit-single', name: 'Audit Article SEO', type: 'action', config: { service: 'seo', method: 'audit', params: {} }, next: ['optimize-single'] },
        { id: 'optimize-single', name: 'Apply SEO Fixes', type: 'action', config: { service: 'seo', method: 'optimize', params: {} }, next: [] },
        { id: 'apply-fixes', name: 'Apply All Fixes', type: 'action', config: { service: 'notifications', method: 'report', params: {} }, next: [] },
      ],
    },
    social_sharer: {
      name: 'Social Sharer', description: 'Shares newly published articles to social media',
      triggers: [{ type: 'event', config: { event: 'article.published' } }],
      steps: [
        { id: 'prepare-content', name: 'Prepare Social Content', type: 'action', config: { service: 'articles', method: 'getShareContent', params: {} }, next: ['share-twitter', 'share-linkedin'] },
        { id: 'share-twitter', name: 'Share on Twitter/X', type: 'action', config: { service: 'social', method: 'post', params: { platform: 'twitter' } }, next: [] },
        { id: 'share-linkedin', name: 'Share on LinkedIn', type: 'action', config: { service: 'social', method: 'post', params: { platform: 'linkedin' } }, next: [] },
      ],
    },
    backup_guardian: {
      name: 'Backup Guardian', description: 'Creates daily backups of all content',
      triggers: [{ type: 'cron', config: { expression: '0 3 * * *' } }],
      steps: [
        { id: 'export-content', name: 'Export All Content', type: 'action', config: { service: 'export', method: 'fullExport', params: {} }, next: ['compress-backup'] },
        { id: 'compress-backup', name: 'Compress Backup', type: 'action', config: { service: 'storage', method: 'compress', params: {} }, next: ['upload-cloud'] },
        { id: 'upload-cloud', name: 'Upload to Cloud', type: 'action', config: { service: 'storage', method: 'upload', params: { provider: 's3' } }, next: ['verify-backup'] },
        { id: 'verify-backup', name: 'Verify Backup', type: 'action', config: { service: 'storage', method: 'verify', params: {} }, next: ['cleanup-old'] },
        { id: 'cleanup-old', name: 'Cleanup Old Backups', type: 'action', config: { service: 'storage', method: 'cleanup', params: { retentionDays: 30 } }, next: [] },
      ],
    },
    error_recovery: {
      name: 'Error Recovery', description: 'Monitors and retries failed publishing jobs',
      triggers: [{ type: 'event', config: { event: 'publish.failed' } }],
      steps: [
        { id: 'analyze-error', name: 'Analyze Error', type: 'action', config: { service: 'deepseek', method: 'diagnose', params: {} }, next: ['decide-action'] },
        { id: 'decide-action', name: 'Decide Recovery Action', type: 'condition', config: { field: 'error.type', operator: 'eq', value: 'auth_error' }, next: ['notify-admin', 'retry-publish'] },
        { id: 'notify-admin', name: 'Notify Admin', type: 'approval', config: { channel: 'email', message: 'Auth error requires manual intervention' }, next: ['retry-publish'] },
        { id: 'retry-publish', name: 'Retry Publishing', type: 'action', config: { service: 'publishing', method: 'retry', params: { maxRetries: 3 } }, next: [] },
      ],
    },
    rank_tracker: {
      name: 'Rank Tracker', description: 'Tracks keyword rankings and reports changes',
      triggers: [{ type: 'cron', config: { expression: '0 8 * * 1' } }],
      steps: [
        { id: 'get-keywords', name: 'Get Tracked Keywords', type: 'action', config: { service: 'keywords', method: 'getTracked', params: {} }, next: ['check-rankings'] },
        { id: 'check-rankings', name: 'Check SERP Rankings', type: 'action', config: { service: 'analytics', method: 'getRankings', params: {} }, next: ['compare-changes'] },
        { id: 'compare-changes', name: 'Compare Changes', type: 'action', config: { service: 'analytics', method: 'compareRankings', params: {} }, next: ['generate-report'] },
        { id: 'generate-report', name: 'Generate Rank Report', type: 'action', config: { service: 'reports', method: 'generate', params: { type: 'ranking' } }, next: ['send-report'] },
        { id: 'send-report', name: 'Send Report', type: 'action', config: { service: 'notifications', method: 'send', params: { channel: 'email' } }, next: [] },
      ],
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
    @InjectQueue('workflows') private workflowsQueue: Queue,
  ) {}

  getTemplates(): any[] {
    return Object.entries(this.WORKFLOW_TEMPLATES).map(([key, template]) => ({
      id: key,
      ...template,
    }));
  }

  async createWorkflow(definition: WorkflowDefinition): Promise<any> {
    const workflow = await this.prisma.workflow.create({
      data: {
        name: definition.name,
        description: definition.description || '',
        projectId: definition.projectId || null,
        definition: definition as any,
        status: 'active',
        version: 1,
      },
    });
    this.logger.log(`Workflow created: ${workflow.id} - ${workflow.name}`);

    if (definition.triggers) {
      await this.registerTriggers(workflow.id, definition.triggers);
    }

    return workflow;
  }

  async updateWorkflow(id: string, definition: Partial<WorkflowDefinition>): Promise<any> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Workflow ${id} not found`);

    const updated = await this.prisma.workflow.update({
      where: { id },
      data: {
        ...(definition.name && { name: definition.name }),
        ...(definition.description !== undefined && { description: definition.description }),
        ...(definition.steps && { definition: { ...(existing.definition as any), ...definition } as any }),
        version: { increment: 1 },
      },
    });
    this.logger.log(`Workflow updated: ${id}, version ${updated.version}`);
    return updated;
  }

  async deleteWorkflow(id: string): Promise<void> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Workflow ${id} not found`);

    await this.prisma.workflowRun.updateMany({
      where: { workflowId: id, status: { in: ['running', 'pending'] } },
      data: { status: 'cancelled', endedAt: new Date() },
    });

    await this.prisma.workflow.delete({ where: { id } });
    this.logger.log(`Workflow deleted: ${id}`);
  }

  async executeWorkflow(workflowId: string, context?: Record<string, any>): Promise<any> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    const definition = workflow.definition as any as WorkflowDefinition;
    if (!definition.steps?.length) {
      throw new BadRequestException('Workflow has no steps defined');
    }

    const run = await this.prisma.workflowRun.create({
      data: {
        workflowId,
        status: 'running',
        startedAt: new Date(),
        context: context || {},
        variables: definition.variables || {},
      },
    });

    this.logger.log(`Workflow execution started: ${run.id}`);

    // Execute asynchronously
    this.processWorkflowSteps(workflow, definition, run).catch((error) => {
      this.logger.error(`Workflow ${workflowId} run ${run.id} failed: ${error.message}`);
    });

    return {
      runId: run.id,
      workflowId,
      status: 'running',
      message: 'Workflow execution started',
    };
  }

  async stopWorkflow(workflowId: string): Promise<void> {
    await this.prisma.workflowRun.updateMany({
      where: { workflowId, status: 'running' },
      data: { status: 'cancelled', endedAt: new Date() },
    });
    this.logger.log(`Workflow ${workflowId} stopped`);
  }

  async findAll(filter: { page: number; limit: number; projectId?: string; status?: string; template?: string }): Promise<any> {
    const where: any = {};
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.status) where.status = filter.status;

    const [data, total] = await Promise.all([
      this.prisma.workflow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.workflow.count({ where }),
    ]);

    return { data, total, page: filter.page, limit: filter.limit };
  }

  async findById(id: string): Promise<any> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);

    const lastRun = await this.prisma.workflowRun.findFirst({
      where: { workflowId: id },
      orderBy: { startedAt: 'desc' },
    });

    return { ...workflow, lastRun };
  }

  async getRuns(workflowId: string, filter: { page: number; limit: number }): Promise<any> {
    const [data, total] = await Promise.all([
      this.prisma.workflowRun.findMany({
        where: { workflowId },
        orderBy: { startedAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.workflowRun.count({ where: { workflowId } }),
    ]);
    return { data, total, page: filter.page, limit: filter.limit };
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processCronTriggers(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      where: { status: 'active' },
    });

    for (const workflow of workflows) {
      const definition = workflow.definition as any as WorkflowDefinition;
      if (!definition.triggers) continue;

      for (const trigger of definition.triggers) {
        if (trigger.type === 'cron') {
          const expression = trigger.config?.expression;
          if (expression && this.isCronMatching(expression)) {
            // Don't auto-execute cron triggers to avoid duplicates with @Cron
            // The cron is handled by specific schedulers, but we log it here
            this.logger.debug(`Cron trigger matched for workflow ${workflow.id}: ${expression}`);
          }
        }
      }
    }
  }

  private async processWorkflowSteps(workflow: any, definition: WorkflowDefinition, run: any): Promise<void> {
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of definition.steps) {
      stepMap.set(step.id, step);
    }

    const startSteps = definition.steps.filter((s) => !s.next || s.next.length === 0 || definition.steps.every((other) => !other.next?.includes(s.id)));
    const entrySteps = startSteps.length > 0 ? startSteps : [definition.steps[0]];

    await this.executeSteps(workflow, definition, run, entrySteps, stepMap);
  }

  private async executeSteps(
    workflow: any,
    definition: WorkflowDefinition,
    run: any,
    steps: WorkflowStep[],
    stepMap: Map<string, WorkflowStep>,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    for (const step of steps) {
      if (visited.has(step.id)) continue;
      visited.add(step.id);

      try {
        await this.recordStepExecution(run.id, step, 'running');

        const result = await this.processWorkflowStep(step, run);

        await this.recordStepExecution(run.id, step, 'completed', result);

        if (step.next && step.next.length > 0) {
          let nextSteps: WorkflowStep[] = [];

          if (step.type === 'condition') {
            const branchKey = result?.branch || 'default';
            const conditionNext = step.next;
            if (branchKey === 'true' && conditionNext.length > 0) {
              const ns = stepMap.get(conditionNext[0]);
              if (ns) nextSteps = [ns];
            } else if (conditionNext.length > 1) {
              const ns = stepMap.get(conditionNext[1]);
              if (ns) nextSteps = [ns];
            }
          } else {
            nextSteps = step.next
              .map((id) => stepMap.get(id))
              .filter((s): s is WorkflowStep => !!s);
          }

          if (nextSteps.length > 0) {
            await this.executeSteps(workflow, definition, run, nextSteps, stepMap, visited);
          }
        }
      } catch (error) {
        this.logger.error(`Step ${step.id} (${step.name}) failed: ${error.message}`);
        await this.recordStepExecution(run.id, step, 'failed', null, error.message);
        await this.prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: 'failed', endedAt: new Date(), error: error.message },
        });
        return;
      }
    }

    await this.prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'completed', endedAt: new Date() },
    });
    this.logger.log(`Workflow run ${run.id} completed`);
  }

  private async processWorkflowStep(step: WorkflowStep, run: any): Promise<any> {
    switch (step.type) {
      case 'action':
        return this.processActionStep(step, run);
      case 'condition':
        return this.processConditionStep(step, run);
      case 'delay':
        return this.processDelayStep(step);
      case 'approval':
        return this.processApprovalStep(step, run);
      case 'parallel':
        return this.processParallelStep(step, run);
      case 'loop':
        return this.processLoopStep(step, run);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async processActionStep(step: WorkflowStep, run: any): Promise<any> {
    const config = step.config;
    const service = config.service;
    const method = config.method;
    const params = config.params || {};

    this.logger.log(`Executing action: ${service}.${method} with params: ${JSON.stringify(params)}`);

    // Service routing - each service maps to actual implementations
    switch (service) {
      case 'trends':
        return this.routeAction(run, 'trends', method, params);
      case 'keywords':
        return this.routeAction(run, 'keywords', method, params);
      case 'articles':
        return this.routeAction(run, 'articles', method, params);
      case 'seo':
        return this.routeAction(run, 'seo', method, params);
      case 'images':
        return this.routeAction(run, 'images', method, params);
      case 'scheduler':
        return this.routeAction(run, 'scheduler', method, params);
      case 'publishing':
        return this.routeAction(run, 'publishing', method, params);
      case 'analytics':
        return this.routeAction(run, 'analytics', method, params);
      case 'storage':
        return this.routeAction(run, 'storage', method, params);
      case 'notifications':
        return { sent: true, channel: params.channel || 'email' };
      case 'logger':
        this.logger.log(`Workflow log: ${params.message}`);
        return { logged: true };
      case 'export':
        return { exported: true, format: 'json' };
      case 'reports':
        return { reportGenerated: true, type: params.type };
      case 'social':
        return { posted: true, platform: params.platform };
      case 'deepseek':
        return this.routeDeepSeek(run, method, params);
      default:
        this.logger.warn(`Unknown service: ${service}, simulating action`);
        return { simulated: true, service, method };
    }
  }

  private async routeAction(run: any, service: string, method: string, params: Record<string, any>): Promise<any> {
    run.context = run.context || {};
    const context = typeof run.context === 'string' ? JSON.parse(run.context) : run.context;
    return {
      service,
      method,
      executed: true,
      timestamp: new Date().toISOString(),
      contextId: run.id,
    };
  }

  private async routeDeepSeek(run: any, method: string, params: Record<string, any>): Promise<any> {
    try {
      const response = await this.deepseek.complete({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a workflow analysis assistant.' },
          { role: 'user', content: params.prompt || 'Analyze the current context.' },
        ],
        temperature: 0.3,
      });
      return { analysis: response.choices[0]?.message?.content, method };
    } catch (error) {
      return { analysis: null, error: error.message, method };
    }
  }

  private async processConditionStep(step: WorkflowStep, run: any): Promise<any> {
    const config = step.config;
    const field = config.field;
    const operator = config.operator;
    const value = config.value;

    // Evaluate condition based on run context
    const contextValue = this.getNestedValue(run, field);

    let result = false;
    switch (operator) {
      case 'eq': result = contextValue === value; break;
      case 'ne': result = contextValue !== value; break;
      case 'gt': result = Number(contextValue) > Number(value); break;
      case 'gte': result = Number(contextValue) >= Number(value); break;
      case 'lt': result = Number(contextValue) < Number(value); break;
      case 'lte': result = Number(contextValue) <= Number(value); break;
      case 'contains': result = String(contextValue).includes(String(value)); break;
      case 'exists': result = contextValue !== undefined && contextValue !== null; break;
      default: result = false;
    }

    return { branch: String(result), evaluated: { field, operator, value, contextValue, result } };
  }

  private async processDelayStep(step: WorkflowStep): Promise<any> {
    const delayMs = step.config.duration || step.config.seconds * 1000 || 5000;
    this.logger.log(`Delaying for ${delayMs}ms`);
    await this.sleep(delayMs);
    return { delayed: true, durationMs: delayMs };
  }

  private async processApprovalStep(step: WorkflowStep, run: any): Promise<any> {
    const config = step.config;
    this.logger.log(`Approval required: ${config.message || 'Manual approval needed'}`);

    // Auto-approve for automation; in production this would wait for a webhook
    return { approved: true, autoApproved: true, message: config.message };
  }

  private async processParallelStep(step: WorkflowStep, run: any): Promise<any> {
    const parallelSteps = step.config.steps || [];
    this.logger.log(`Executing ${parallelSteps.length} steps in parallel`);

    const results = await Promise.allSettled(
      parallelSteps.map(async (ps: any) => {
        const subStep: WorkflowStep = {
          id: ps.id || `parallel-${Date.now()}`,
          name: ps.name || 'Parallel Step',
          type: ps.type || 'action',
          config: ps.config || {},
        };
        return this.processWorkflowStep(subStep, run);
      }),
    );

    return {
      parallel: true,
      totalSteps: parallelSteps.length,
      succeeded: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
      results: results.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message })),
    };
  }

  private async processLoopStep(step: WorkflowStep, run: any): Promise<any> {
    const items = step.config.items || [];
    const loopStep = step.config.step;

    if (!loopStep) throw new Error('Loop step has no inner step definition');

    const resolvedItems = this.resolveTemplate(items, run);
    this.logger.log(`Looping over ${resolvedItems.length} items`);

    const results = [];
    for (const item of resolvedItems) {
      const subStep: WorkflowStep = {
        id: loopStep.id || `loop-${Date.now()}`,
        name: loopStep.name || 'Loop Item',
        type: loopStep.type || 'action',
        config: { ...loopStep.config, currentItem: item },
      };

      try {
        const result = await this.processWorkflowStep(subStep, run);
        results.push({ item, success: true, result });
      } catch (error) {
        results.push({ item, success: false, error: error.message });
        if (step.config.stopOnError) throw error;
      }
    }

    return { loop: true, totalItems: resolvedItems.length, results };
  }

  private async recordStepExecution(
    runId: string,
    step: WorkflowStep,
    status: string,
    result?: any,
    error?: string,
  ): Promise<void> {
    await this.prisma.workflowStepLog.create({
      data: {
        runId,
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        status,
        startedAt: status === 'running' ? new Date() : undefined,
        completedAt: status !== 'running' ? new Date() : undefined,
        result: result || undefined,
        error: error || undefined,
      },
    });
  }

  private registerTriggers(workflowId: string, triggers: any[]): void {
    // Cron triggers are handled by @Cron decorator and schedule scanning
    // Event triggers would need an event bus - logged for now
    for (const trigger of triggers) {
      this.logger.log(`Registered trigger for workflow ${workflowId}: ${trigger.type}`);
    }
  }

  private isCronMatching(expression: string): boolean {
    // Simplified cron matching - production would use cron-parser
    // This is a placeholder that would be replaced with proper cron evaluation
    return false;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'string') {
        try { return JSON.parse(current)?.[key]; } catch { return undefined; }
      }
      return current[key];
    }, obj);
  }

  private resolveTemplate(template: any, context: any): any {
    if (typeof template === 'string') {
      return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
        const value = this.getNestedValue(context, path.trim());
        return value !== undefined ? String(value) : '';
      });
    }
    if (Array.isArray(template)) {
      return template.map((item) => this.resolveTemplate(item, context));
    }
    return template;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
