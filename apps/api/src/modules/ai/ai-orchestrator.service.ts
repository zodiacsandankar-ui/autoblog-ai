import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, mergeMap, tap } from 'rxjs/operators';

import {
  AiProviderInterface,
  ContentResult,
  StreamChunk,
  GenerateOptions,
  ProviderStatus,
  AiProviderError,
  AiErrorType,
} from './ai-provider.interface';
import { DeepSeekService } from './providers/deepseek.service';
import { ClaudeService } from './providers/claude.service';
import { OpenAiService } from './providers/openai.service';
import { GeminiService } from './providers/gemini.service';
import { MistralService } from './providers/mistral.service';
import { GroqService } from './providers/groq.service';
import { OpenRouterService } from './providers/openrouter.service';
import { OllamaService } from './providers/ollama.service';
import { CustomApiService } from './providers/custom-api.service';

/**
 * Error thrown when all AI providers in the fallback chain have failed.
 */
export class AllProvidersFailedError extends Error {
  public readonly type = AiErrorType.ALL_PROVIDERS_FAILED;
  public readonly providerErrors: Array<{ provider: string; error: string }>;

  constructor(providerErrors: Array<{ provider: string; error: string }>) {
    super(
      `All AI providers failed. Errors: ${providerErrors
        .map((pe) => `${pe.provider}: ${pe.error}`)
        .join('; ')}`,
    );
    this.name = 'AllProvidersFailedError';
    this.providerErrors = providerErrors;
  }
}

/**
 * Quality score for content evaluation.
 */
interface QualityScore {
  overall: number;
  relevance: number;
  coherence: number;
  completeness: number;
  instructionFollowing: number;
  reasons: string[];
}

/**
 * Provider performance tracking.
 */
interface ProviderPerformance {
  name: string;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalLatencyMs: number;
  totalTokens: number;
  lastCallAt: Date | null;
  averageQualityScore: number;
  successRate: number;
}

/**
 * Task types that can be mapped to optimal providers.
 */
export type AiTaskType =
  | 'article-writing'
  | 'article-editing'
  | 'keyword-research'
  | 'seo-analysis'
  | 'title-generation'
  | 'meta-description'
  | 'content-outline'
  | 'image-generation'
  | 'summary'
  | 'translation'
  | 'sentiment-analysis'
  | 'fact-checking'
  | 'code-generation'
  | 'data-extraction'
  | 'custom';

/**
 * Default task-to-provider mapping.
 */
const TASK_PROVIDER_MAP: Record<AiTaskType, string> = {
  'article-writing': 'deepseek',
  'article-editing': 'deepseek',
  'keyword-research': 'deepseek',
  'seo-analysis': 'deepseek',
  'title-generation': 'deepseek',
  'meta-description': 'deepseek',
  'content-outline': 'deepseek',
  'image-generation': 'openai',  // DALL-E 3
  summary: 'deepseek',
  translation: 'deepseek',
  'sentiment-analysis': 'deepseek',
  'fact-checking': 'deepseek',
  'code-generation': 'deepseek',
  'data-extraction': 'deepseek',
  custom: 'deepseek',
};

/**
 * Fallback provider chain order.
 */
const FALLBACK_CHAIN: string[] = [
  'deepseek',
  'claude',
  'openai',
  'gemini',
  'mistral',
  'groq',
  'openrouter',
  'ollama',
];

/**
 * Quality assessment threshold - minimum score to accept a result.
 */
const QUALITY_THRESHOLD = 0.7;

@Injectable()
export class AiOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(AiOrchestratorService.name);

  /**
   * Registry of all available AI providers by name.
   */
  private readonly providers = new Map<string, AiProviderInterface>();

  /**
   * Provider performance tracking.
   */
  private readonly performance = new Map<string, ProviderPerformance>();

  /**
   * Whether the orchestrator is initialized.
   */
  private initialized = false;

  constructor(
    private readonly deepseekService: DeepSeekService,
    private readonly claudeService: ClaudeService,
    private readonly openAiService: OpenAiService,
    private readonly geminiService: GeminiService,
    private readonly mistralService: MistralService,
    private readonly groqService: GroqService,
    private readonly openRouterService: OpenRouterService,
    private readonly ollamaService: OllamaService,
    @Optional() private readonly customApiService?: CustomApiService,
    private readonly configService?: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registerProviders();
    this.initialized = true;
    this.logger.log(
      `AiOrchestrator initialized with ${this.providers.size} providers: ${Array.from(this.providers.keys()).join(', ')}`,
    );
  }

  /**
   * Register all available AI providers.
   */
  private registerProviders(): void {
    const providerList: Array<{ name: string; service: AiProviderInterface; enabled: boolean }> = [
      { name: 'deepseek', service: this.deepseekService, enabled: true },
      { name: 'claude', service: this.claudeService, enabled: true },
      { name: 'openai', service: this.openAiService, enabled: true },
      { name: 'gemini', service: this.geminiService, enabled: true },
      { name: 'mistral', service: this.mistralService, enabled: true },
      { name: 'groq', service: this.groqService, enabled: true },
      { name: 'openrouter', service: this.openRouterService, enabled: true },
      { name: 'ollama', service: this.ollamaService, enabled: true },
    ];

    if (this.customApiService) {
      providerList.push({
        name: 'custom-api',
        service: this.customApiService,
        enabled: true,
      });
    }

    // Check which providers are enabled via config
    const enabledProviders =
      this.configService?.get<string[]>('ai.providersEnabled');

    for (const provider of providerList) {
      const isEnabled =
        !enabledProviders || enabledProviders.includes(provider.name);
      if (isEnabled) {
        this.providers.set(provider.name, provider.service);
        this.initializePerformanceTracking(provider.name);
      }
    }
  }

  /**
   * Initialize performance tracking for a provider.
   */
  private initializePerformanceTracking(name: string): void {
    this.performance.set(name, {
      name,
      totalCalls: 0,
      successCalls: 0,
      errorCalls: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      lastCallAt: null,
      averageQualityScore: 0,
      successRate: 1,
    });
  }

  // -----------------------------------------------------------------------
  // Core generation methods
  // -----------------------------------------------------------------------

  /**
   * Generate content with automatic provider selection and fallback.
   *
   * Tries the preferred or task-optimized provider first, then falls back
   * through the chain. Assesses output quality against a threshold.
   * Tracks per-provider latency and success rate.
   */
  async generateWithFallback(
    prompt: string,
    options?: Partial<GenerateOptions>,
    preferredProvider?: string,
  ): Promise<ContentResult> {
    if (!this.initialized) {
      await this.onModuleInit();
    }

    const taskType: AiTaskType = options?.tags?.task as AiTaskType ?? 'custom';
    const taskProvider = TASK_PROVIDER_MAP[taskType] ?? 'deepseek';

    // Determine provider order
    const providerOrder = this.buildProviderOrder(
      preferredProvider,
      taskProvider,
    );

    const errors: Array<{ provider: string; error: string }> = [];

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        errors.push({
          provider: providerName,
          error: 'Provider not registered',
        });
        continue;
      }

      this.logger.log(
        `Attempting generation with provider: ${providerName} (task: ${taskType})`,
      );

      const startTime = Date.now();

      try {
        // Check availability before calling
        const available = await provider.isAvailable().catch(() => false);
        if (!available) {
          const errorMsg = 'Provider not available';
          this.logger.warn(`${providerName}: ${errorMsg}`);
          this.trackPerformance(providerName, 0, false, 0);
          errors.push({ provider: providerName, error: errorMsg });
          continue;
        }

        const result = await provider.generateContent(prompt, options);

        const latency = Date.now() - startTime;

        // Track performance
        this.trackPerformance(
          providerName,
          latency,
          true,
          result.usage.totalTokens,
        );

        // Quality assessment
        const quality = this.assessQuality(prompt, result.content, options);

        this.logger.log(
          `${providerName} generated content (quality: ${quality.overall.toFixed(2)}, latency: ${latency}ms)`,
        );

        // If quality meets threshold, return immediately
        if (quality.overall >= QUALITY_THRESHOLD) {
          return result;
        }

        // Quality below threshold - log and continue to fallback
        this.logger.warn(
          `${providerName} quality score ${quality.overall.toFixed(2)} below threshold ${QUALITY_THRESHOLD}. Trying fallback.`,
        );
        errors.push({
          provider: providerName,
          error: `Quality score ${quality.overall.toFixed(2)} below threshold`,
        });

        // If the result is still decent but below threshold, return it as the best effort
        if (quality.overall >= 0.5 && providerOrder.indexOf(providerName) === providerOrder.length - 1) {
          this.logger.log(
            `Returning best-effort result from ${providerName} (quality: ${quality.overall.toFixed(2)})`,
          );
          return result;
        }
      } catch (error) {
        const latency = Date.now() - startTime;
        const errorMsg = (error as Error).message;
        this.logger.error(`${providerName} failed: ${errorMsg}`);
        this.trackPerformance(providerName, latency, false, 0);
        errors.push({ provider: providerName, error: errorMsg });
      }
    }

    // All providers failed
    throw new AllProvidersFailedError(errors);
  }

  /**
   * Stream content from the preferred provider with fallback.
   */
  streamWithFallback(
    prompt: string,
    options?: Partial<GenerateOptions>,
    preferredProvider?: string,
  ): Observable<StreamChunk> {
    const taskType: AiTaskType = options?.tags?.task as AiTaskType ?? 'custom';
    const taskProvider = TASK_PROVIDER_MAP[taskType] ?? 'deepseek';
    const providerOrder = this.buildProviderOrder(
      preferredProvider,
      taskProvider,
    );

    return this.tryStreamProvider(prompt, options, providerOrder, 0);
  }

  /**
   * Recursively try streaming providers in order.
   */
  private tryStreamProvider(
    prompt: string,
    options: Partial<GenerateOptions> | undefined,
    providerOrder: string[],
    index: number,
  ): Observable<StreamChunk> {
    if (index >= providerOrder.length) {
      return throwError(
        () => new AllProvidersFailedError([
          { provider: 'all', error: 'All streaming providers failed' },
        ]),
      );
    }

    const providerName = providerOrder[index]!;
    const provider = this.providers.get(providerName);

    if (!provider) {
      return this.tryStreamProvider(prompt, options, providerOrder, index + 1);
    }

    this.logger.log(`Attempting stream with provider: ${providerName}`);

    return provider.streamContent(prompt, options).pipe(
      catchError((error) => {
        this.logger.warn(
          `${providerName} stream failed: ${(error as Error).message}. Trying fallback...`,
        );
        return this.tryStreamProvider(
          prompt,
          options,
          providerOrder,
          index + 1,
        );
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Provider management
  // -----------------------------------------------------------------------

  /**
   * Get a specific provider by name.
   */
  getProvider(name: string): AiProviderInterface | undefined {
    return this.providers.get(name);
  }

  /**
   * Get status of all registered providers.
   */
  async getAllProvidersStatus(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    for (const [name, provider] of this.providers) {
      try {
        const [available, models] = await Promise.all([
          provider.isAvailable(),
          provider.getModels().catch(() => [] as string[]),
        ]);

        const perf = this.performance.get(name);

        statuses.push({
          name,
          available,
          models,
          latencyMs: perf
            ? Math.round(
                perf.totalCalls > 0
                  ? perf.totalLatencyMs / perf.totalCalls
                  : 0,
              )
            : 0,
          errorRate: perf
            ? perf.totalCalls > 0
              ? perf.errorCalls / perf.totalCalls
              : 0
            : 0,
          totalCalls: perf?.totalCalls ?? 0,
          successCalls: perf?.successCalls ?? 0,
          lastError: undefined,
          lastSuccessAt: perf?.lastCallAt ?? undefined,
          configurable:
            name === 'ollama' || name === 'custom-api',
        });
      } catch {
        statuses.push({
          name,
          available: false,
          models: [],
          latencyMs: 0,
          errorRate: 1,
          totalCalls: 0,
          successCalls: 0,
          lastError: 'Health check failed',
          configurable: name === 'ollama' || name === 'custom-api',
        });
      }
    }

    return statuses;
  }

  /**
   * Check health of all providers.
   */
  async checkAllProvidersHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [name, provider] of this.providers) {
      try {
        health[name] = await provider.isAvailable();
      } catch {
        health[name] = false;
      }
    }

    return health;
  }

  /**
   * Get performance statistics for all providers.
   */
  getAllPerformance(): ProviderPerformance[] {
    return Array.from(this.performance.values()).sort(
      (a, b) => b.successRate - a.successRate,
    );
  }

  /**
   * Get the default provider for a given task type.
   */
  getProviderForTask(taskType: AiTaskType): string {
    return TASK_PROVIDER_MAP[taskType] ?? 'deepseek';
  }

  /**
   * Get the fallback chain order.
   */
  getFallbackChain(): string[] {
    return [...FALLBACK_CHAIN];
  }

  // -----------------------------------------------------------------------
  // Quality assessment
  // -----------------------------------------------------------------------

  /**
   * Assess the quality of generated content against the original prompt.
   * Scores based on relevance, coherence, completeness, and instruction following.
   *
   * Uses multiple heuristics to produce a score between 0 and 1.
   */
  assessQuality(
    prompt: string,
    content: string,
    options?: Partial<GenerateOptions>,
  ): QualityScore {
    if (!content || content.trim().length === 0) {
      return {
        overall: 0,
        relevance: 0,
        coherence: 0,
        completeness: 0,
        instructionFollowing: 0,
        reasons: ['Empty response'],
      };
    }

    const reasons: string[] = [];
    const promptLower = prompt.toLowerCase();
    const contentLower = content.toLowerCase();

    // 1. Relevance scoring: keyword overlap between prompt and content
    const promptWords = new Set(
      promptLower
        .split(/\W+/)
        .filter((w) => w.length > 3 && !this.isStopWord(w)),
    );
    const contentWords = new Set(
      contentLower
        .split(/\W+/)
        .filter((w) => w.length > 3 && !this.isStopWord(w)),
    );

    let matchedKeywords = 0;
    for (const word of promptWords) {
      if (contentWords.has(word)) matchedKeywords++;
    }

    const relevance =
      promptWords.size > 0 ? matchedKeywords / promptWords.size : 0.8;

    if (relevance < 0.3) {
      reasons.push('Low keyword relevance between prompt and content');
    }

    // 2. Coherence scoring: sentence structure, length, paragraph count
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgSentenceLength =
      sentences.length > 0
        ? content.length / sentences.length
        : 0;

    // Penalize very short or very long average sentences
    let coherence = 0.8;
    if (avgSentenceLength < 20) {
      coherence -= 0.2;
      reasons.push('Sentences may be too short/abbreviated');
    }
    if (avgSentenceLength > 200) {
      coherence -= 0.2;
      reasons.push('Sentences may be too long/rambling');
    }

    // Penalize lack of paragraphs for long content
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (content.length > 500 && paragraphs.length < 2) {
      coherence -= 0.15;
      reasons.push('Content length without paragraph breaks');
    }

    coherence = Math.max(0, Math.min(1, coherence));

    // 3. Completeness scoring
    let completeness = 0.7;

    // Check for common indicators of incomplete content
    const incompleteIndicators = [
      'i will continue',
      'to be continued',
      'continued...',
      '[continue',
      'i am not able to',
      'i cannot',
      'as an ai',
      'i apologize',
      "i'm sorry",
    ];

    let hasIncompleteIndicator = false;
    for (const indicator of incompleteIndicators) {
      if (contentLower.includes(indicator)) {
        hasIncompleteIndicator = true;
        reasons.push(`Contains incomplete indicator: "${indicator}"`);
        break;
      }
    }

    if (hasIncompleteIndicator) {
      completeness -= 0.2;
    }

    // Check if ended mid-sentence (no period at end for substantial content)
    if (
      content.trim().length > 100 &&
      !content.trim().endsWith('.') &&
      !content.trim().endsWith('!') &&
      !content.trim().endsWith('?') &&
      !content.trim().endsWith('"') &&
      !content.trim().endsWith('`')
    ) {
      completeness -= 0.1;
      reasons.push('Content may end abruptly (no terminal punctuation)');
    }

    // Check requested length vs actual
    if (options?.maxTokens && options.maxTokens < 100) {
      // Short responses don't need completeness checks
      completeness = Math.max(completeness, 0.8);
    }

    completeness = Math.max(0, Math.min(1, completeness));

    // 4. Instruction following
    let instructionFollowing = 0.8;

    // Check for JSON format compliance if requested
    if (options?.responseFormat === 'json_object') {
      try {
        JSON.parse(content);
        instructionFollowing = 1.0;
      } catch {
        instructionFollowing = 0.3;
        reasons.push('Failed to produce valid JSON when JSON format was requested');
      }
    }

    // Check for format keywords in prompt
    if (promptLower.includes('json') || promptLower.includes('return as json')) {
      try {
        JSON.parse(content);
      } catch {
        instructionFollowing -= 0.2;
        reasons.push('Prompt requested JSON but response is not valid JSON');
      }
    }

    instructionFollowing = Math.max(0, Math.min(1, instructionFollowing));

    // 5. Overall score (weighted)
    const overall =
      relevance * 0.3 +
      coherence * 0.2 +
      completeness * 0.25 +
      instructionFollowing * 0.25;

    return {
      overall: Math.round(overall * 100) / 100,
      relevance: Math.round(relevance * 100) / 100,
      coherence: Math.round(coherence * 100) / 100,
      completeness: Math.round(completeness * 100) / 100,
      instructionFollowing: Math.round(instructionFollowing * 100) / 100,
      reasons,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the ordered list of providers to try.
   */
  private buildProviderOrder(
    preferredProvider?: string,
    taskProvider?: string,
  ): string[] {
    const order: string[] = [];
    const added = new Set<string>();

    // 1. Preferred provider (if specified)
    if (preferredProvider && this.providers.has(preferredProvider)) {
      order.push(preferredProvider);
      added.add(preferredProvider);
    }

    // 2. Task-optimized provider
    if (taskProvider && !added.has(taskProvider) && this.providers.has(taskProvider)) {
      order.push(taskProvider);
      added.add(taskProvider);
    }

    // 3. Fallback chain
    for (const name of FALLBACK_CHAIN) {
      if (!added.has(name) && this.providers.has(name)) {
        order.push(name);
        added.add(name);
      }
    }

    return order;
  }

  /**
   * Track performance metrics for a provider.
   */
  private trackPerformance(
    providerName: string,
    latencyMs: number,
    success: boolean,
    tokensUsed: number,
  ): void {
    const perf = this.performance.get(providerName);
    if (!perf) return;

    perf.totalCalls++;
    perf.totalLatencyMs += latencyMs;
    perf.totalTokens += tokensUsed;
    perf.lastCallAt = new Date();

    if (success) {
      perf.successCalls++;
    } else {
      perf.errorCalls++;
    }

    perf.successRate =
      perf.totalCalls > 0 ? perf.successCalls / perf.totalCalls : 1;

    this.performance.set(providerName, perf);
  }

  /**
   * Check if a word is a common stop word.
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
      'their', 'will', 'would', 'could', 'should', 'about', 'which',
      'when', 'where', 'what', 'there', 'also', 'some', 'than', 'then',
      'into', 'more', 'most', 'such', 'only', 'other', 'over', 'after',
      'before', 'between', 'through', 'during', 'without', 'within',
      'along', 'because', 'therefore', 'however', 'further', 'moreover',
    ]);
    return stopWords.has(word);
  }
}
