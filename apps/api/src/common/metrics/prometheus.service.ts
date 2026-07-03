import { Injectable } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class PrometheusService {
  private readonly registry: Registry;

  // Counters
  private readonly httpRequestsTotal: Counter;
  private readonly aiGenerationTotal: Counter;
  private readonly aiGenerationFailures: Counter;
  private readonly articlesPublished: Counter;
  private readonly trendsDiscovered: Counter;
  private readonly cacheHits: Counter;
  private readonly cacheMisses: Counter;

  // Histograms
  private readonly httpRequestDuration: Histogram;
  private readonly aiGenerationDuration: Histogram;
  private readonly articleGenerationDuration: Histogram;
  private readonly publishDuration: Histogram;

  // Gauges
  private readonly activeSessions: Gauge;
  private readonly queueSize: Gauge;
  private readonly dbConnectionPool: Gauge;

  constructor() {
    this.registry = new Registry();

    collectDefaultMetrics({
      register: this.registry,
      prefix: 'autoblog_',
    });

    this.httpRequestsTotal = new Counter({
      name: 'autoblog_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.aiGenerationTotal = new Counter({
      name: 'autoblog_ai_generation_total',
      help: 'Total AI generation requests',
      labelNames: ['provider', 'model', 'status'],
      registers: [this.registry],
    });

    this.aiGenerationFailures = new Counter({
      name: 'autoblog_ai_generation_failures_total',
      help: 'Total AI generation failures',
      labelNames: ['provider', 'error_type'],
      registers: [this.registry],
    });

    this.articlesPublished = new Counter({
      name: 'autoblog_articles_published_total',
      help: 'Total articles published',
      labelNames: ['platform', 'status'],
      registers: [this.registry],
    });

    this.trendsDiscovered = new Counter({
      name: 'autoblog_trends_discovered_total',
      help: 'Total trends discovered',
      labelNames: ['source'],
      registers: [this.registry],
    });

    this.cacheHits = new Counter({
      name: 'autoblog_cache_hits_total',
      help: 'Total cache hits',
      labelNames: ['cache_type'],
      registers: [this.registry],
    });

    this.cacheMisses = new Counter({
      name: 'autoblog_cache_misses_total',
      help: 'Total cache misses',
      labelNames: ['cache_type'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'autoblog_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.aiGenerationDuration = new Histogram({
      name: 'autoblog_ai_generation_duration_seconds',
      help: 'AI generation duration in seconds',
      labelNames: ['provider', 'model'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.articleGenerationDuration = new Histogram({
      name: 'autoblog_article_generation_duration_seconds',
      help: 'Full article generation pipeline duration',
      labelNames: ['provider'],
      buckets: [5, 10, 30, 60, 120, 180, 300, 600],
      registers: [this.registry],
    });

    this.publishDuration = new Histogram({
      name: 'autoblog_publish_duration_seconds',
      help: 'Article publishing duration',
      labelNames: ['platform'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.activeSessions = new Gauge({
      name: 'autoblog_active_sessions',
      help: 'Number of active sessions',
      registers: [this.registry],
    });

    this.queueSize = new Gauge({
      name: 'autoblog_queue_size',
      help: 'Current size of processing queues',
      labelNames: ['queue_name', 'status'],
      registers: [this.registry],
    });

    this.dbConnectionPool = new Gauge({
      name: 'autoblog_db_connection_pool',
      help: 'Database connection pool usage',
      labelNames: ['state'],
      registers: [this.registry],
    });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  incrementCounter(
    counter: Counter,
    labels?: Record<string, string>,
    value: number = 1,
  ): void {
    if (labels) {
      counter.labels(labels).inc(value);
    } else {
      counter.inc(value);
    }
  }

  incrementAiGeneration(provider: string, model: string, status: 'success' | 'failure'): void {
    this.aiGenerationTotal.labels({ provider, model, status }).inc();
    if (status === 'failure') {
      this.aiGenerationFailures.labels({ provider, error_type: 'api_error' }).inc();
    }
  }

  observeDuration(
    histogram: Histogram,
    durationMs: number,
    labels?: Record<string, string>,
  ): void {
    const durationSeconds = durationMs / 1000;
    if (labels) {
      histogram.labels(labels).observe(durationSeconds);
    } else {
      histogram.observe(durationSeconds);
    }
  }

  incrementHttpRequest(method: string, route: string, status: number): void {
    this.httpRequestsTotal.labels({ method, route, status: String(status) }).inc();
  }

  incrementCacheHit(type: string): void {
    this.cacheHits.labels({ cache_type: type }).inc();
  }

  incrementCacheMiss(type: string): void {
    this.cacheMisses.labels({ cache_type: type }).inc();
  }

  incrementArticlePublished(platform: string, success: boolean): void {
    this.articlesPublished.labels({ platform, status: success ? 'success' : 'failure' }).inc();
  }

  incrementTrendDiscovered(source: string): void {
    this.trendsDiscovered.labels({ source }).inc();
  }

  setActiveSessions(count: number): void {
    this.activeSessions.set(count);
  }

  setQueueSize(queueName: string, status: string, count: number): void {
    this.queueSize.labels({ queue_name: queueName, status }).set(count);
  }

  setDbConnectionPool(active: number, idle: number, waiting: number): void {
    this.dbConnectionPool.labels({ state: 'active' }).set(active);
    this.dbConnectionPool.labels({ state: 'idle' }).set(idle);
    this.dbConnectionPool.labels({ state: 'waiting' }).set(waiting);
  }
}
