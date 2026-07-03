import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues: Map<string, Queue> = new Map();

  constructor(
    @InjectQueue('content-generation') private readonly contentGenQueue: Queue,
    @InjectQueue('article-processing') private readonly articleQueue: Queue,
    @InjectQueue('publish-articles') private readonly publishQueue: Queue,
    @InjectQueue('publish-retry') private readonly retryQueue: Queue,
    @InjectQueue('analyze-trends') private readonly trendsQueue: Queue,
    @InjectQueue('image-generation') private readonly imageQueue: Queue,
    @InjectQueue('seo-audit') private readonly seoQueue: Queue,
    @InjectQueue('analytics-snapshot') private readonly analyticsQueue: Queue,
    @InjectQueue('webhook-dispatch') private readonly webhookQueue: Queue,
    @InjectQueue('email-notifications') private readonly emailQueue: Queue,
  ) {
    this.queues.set('content-generation', contentGenQueue);
    this.queues.set('article-processing', articleQueue);
    this.queues.set('publish-articles', publishQueue);
    this.queues.set('publish-retry', retryQueue);
    this.queues.set('analyze-trends', trendsQueue);
    this.queues.set('image-generation', imageQueue);
    this.queues.set('seo-audit', seoQueue);
    this.queues.set('analytics-snapshot', analyticsQueue);
    this.queues.set('webhook-dispatch', webhookQueue);
    this.queues.set('email-notifications', emailQueue);
  }

  async add(
    queueName: string,
    data: any,
    options?: JobOptions,
  ): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }

    const defaultOptions: JobOptions = {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
      ...options,
    };

    const job = await queue.add(data, defaultOptions);
    this.logger.debug(`Added job ${job.id} to queue "${queueName}"`);
    return job;
  }

  async addBulk(
    queueName: string,
    items: { data: any; options?: JobOptions }[],
  ): Promise<Job[]> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }

    const jobs = items.map((item) => ({
      data: item.data,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
        ...item.options,
      },
    }));

    const addedJobs = await queue.addBulk(jobs);
    this.logger.debug(`Added ${addedJobs.length} bulk jobs to queue "${queueName}"`);
    return addedJobs;
  }

  async getJob(queueName: string, jobId: string): Promise<Job | null> {
    const queue = this.queues.get(queueName);
    if (!queue) return null;
    return queue.getJob(jobId);
  }

  async getJobCounts(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.queues.get(queueName);
    if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    return queue.getJobCounts();
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) return;
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  async cleanQueue(queueName: string, graceMs: number = 3600000): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) return;
    await queue.clean(graceMs, 'completed');
    await queue.clean(graceMs, 'failed');
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) return;
    await queue.pause();
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) return;
    await queue.resume();
  }

  async getAllQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    for (const [name, queue] of this.queues) {
      stats[name] = await queue.getJobCounts();
    }
    return stats;
  }

  emit(event: string, data: any): void {
    this.logger.debug(`Event emitted: ${event}`, data);
  }
}
