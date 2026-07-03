import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

import {
  AiProviderInterface,
  ContentResult,
  StreamChunk,
  GenerateOptions,
  ProviderStatus,
  AiProviderError,
  AiErrorType,
} from './ai-provider.interface';
import {
  AiOrchestratorService,
  AllProvidersFailedError,
  AiTaskType,
} from './ai-orchestrator.service';
import { OllamaService } from './providers/ollama.service';
import { CustomApiService } from './providers/custom-api.service';

/**
 * Provider configuration update interface.
 */
interface ProviderConfigUpdate {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  models?: string[];
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Per-provider usage breakdown.
 */
interface ProviderUsage {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  averageLatencyMs: number;
}

/**
 * Aggregated usage statistics.
 */
interface UsageStats {
  totalTokens: number;
  estimatedCostUsd: number;
  byProvider: Record<string, ProviderUsage>;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * AiService - High-level service wrapping the AI orchestrator.
 *
 * Provides a simplified interface for content generation, provider management,
 * and usage tracking. Acts as the main entry point for all AI operations
 * in the application.
 */
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  /**
   * Session-level usage tracking (resets on service restart).
   * For persistent tracking, the database TokenUsage model should be used.
   */
  private usageTracker: UsageStats;

  constructor(
    private readonly orchestrator: AiOrchestratorService,
    private readonly ollamaService: OllamaService,
    private readonly customApiService: CustomApiService,
    private readonly configService: ConfigService,
  ) {
    this.usageTracker = this.createEmptyUsageStats();
  }

  onModuleInit(): void {
    this.usageTracker = this.createEmptyUsageStats();
    this.logger.log('AiService initialized with usage tracking');
  }

  // -----------------------------------------------------------------------
  // Content generation
  // -----------------------------------------------------------------------

  /**
   * Generate content using the AI provider chain.
   *
   * @param prompt - The text prompt to send to the AI provider
   * @param options - Generation options (model, temperature, maxTokens, etc.)
   * @param preferredProvider - Optional preferred provider name
   * @returns ContentResult with generated text and metadata
   * @throws AllProvidersFailedError if all providers fail
   */
  async generateContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
    preferredProvider?: string,
  ): Promise<ContentResult> {
    this.validatePrompt(prompt);

    const result = await this.orchestrator.generateWithFallback(
      prompt,
      options,
      preferredProvider,
    );

    // Track usage
    this.trackUsage(
      result.provider,
      true,
      result.usage.totalTokens,
      result.latencyMs,
    );

    return result;
  }

  /**
   * Stream content generation from the AI provider chain.
   *
   * @param prompt - The text prompt to send
   * @param options - Generation options
   * @param preferredProvider - Optional preferred provider
   * @returns Observable stream of content chunks
   */
  streamContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
    preferredProvider?: string,
  ): Observable<StreamChunk> {
    this.validatePrompt(prompt);

    return this.orchestrator.streamWithFallback(
      prompt,
      options,
      preferredProvider,
    );
  }

  /**
   * Generate content using a specific provider by name.
   */
  async generateWithProvider(
    providerName: string,
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const provider = this.getProvider(providerName);
    const available = await provider.isAvailable();

    if (!available) {
      throw new AiProviderError(
        `Provider "${providerName}" is not available`,
        AiErrorType.PROVIDER_UNAVAILABLE,
        providerName,
      );
    }

    const result = await provider.generateContent(prompt, options);

    this.trackUsage(providerName, true, result.usage.totalTokens, result.latencyMs);

    return result;
  }

  // -----------------------------------------------------------------------
  // Provider management
  // -----------------------------------------------------------------------

  /**
   * Get all registered provider names.
   */
  getProviderNames(): string[] {
    return this.orchestrator.getFallbackChain().filter((name) => {
      return this.orchestrator.getProvider(name) !== undefined;
    });
  }

  /**
   * Get a specific provider by name.
   */
  getProvider(name: string): AiProviderInterface {
    const provider = this.orchestrator.getProvider(name);
    if (!provider) {
      throw new NotFoundException(
        `AI provider "${name}" not found. Available providers: ${this.getProviderNames().join(', ')}`,
      );
    }
    return provider;
  }

  /**
   * Get status of all registered providers.
   */
  async getProvidersStatus(): Promise<ProviderStatus[]> {
    return this.orchestrator.getAllProvidersStatus();
  }

  /**
   * Update configuration for a configurable provider.
   * Currently supports: ollama, custom-api
   */
  async updateProviderConfig(
    providerName: string,
    config: ProviderConfigUpdate,
  ): Promise<void> {
    switch (providerName) {
      case 'ollama':
        this.ollamaService.updateConfig({
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
          models: config.models,
          timeout: config.timeout,
        });
        this.logger.log(`Ollama configuration updated via service`);
        break;

      case 'custom-api':
        this.customApiService.updateConfig({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          defaultModel: config.defaultModel,
          models: config.models,
          timeout: config.timeout,
          headers: config.headers,
        });
        this.logger.log(`Custom API configuration updated via service`);
        break;

      default:
        throw new BadRequestException(
          `Provider "${providerName}" does not support runtime configuration. ` +
          'Only "ollama" and "custom-api" are configurable at runtime.',
        );
    }
  }

  /**
   * Check availability of a specific provider.
   */
  async checkProviderAvailability(providerName: string): Promise<boolean> {
    try {
      const provider = this.getProvider(providerName);
      return await provider.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Get the optimal provider for a given task type.
   */
  getProviderForTask(taskType: string): string {
    return this.orchestrator.getProviderForTask(taskType as AiTaskType);
  }

  /**
   * Get the fallback chain order.
   */
  getFallbackChain(): string[] {
    return this.orchestrator.getFallbackChain();
  }

  // -----------------------------------------------------------------------
  // Usage tracking
  // -----------------------------------------------------------------------

  /**
   * Get aggregated usage statistics.
   */
  getUsageStats(): UsageStats {
    return {
      totalTokens: this.usageTracker.totalTokens,
      estimatedCostUsd: this.usageTracker.estimatedCostUsd,
      byProvider: { ...this.usageTracker.byProvider },
      period: { ...this.usageTracker.period },
    };
  }

  /**
   * Get usage statistics for a specific provider.
   */
  getProviderUsage(providerName: string): ProviderUsage | null {
    return this.usageTracker.byProvider[providerName] ?? null;
  }

  /**
   * Reset usage tracking (for testing or billing cycles).
   */
  resetUsageTracking(): void {
    this.usageTracker = this.createEmptyUsageStats();
    this.logger.log('Usage tracking has been reset');
  }

  /**
   * Get performance metrics for all providers.
   */
  getProviderPerformance() {
    return this.orchestrator.getAllPerformance();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Validate the prompt is not empty.
   */
  private validatePrompt(prompt: string): void {
    if (!prompt || prompt.trim().length === 0) {
      throw new BadRequestException('Prompt cannot be empty');
    }

    const maxPromptLength =
      this.configService.get<number>('ai.maxPromptLength', 100000);
    if (prompt.length > maxPromptLength) {
      throw new BadRequestException(
        `Prompt exceeds maximum length of ${maxPromptLength} characters`,
      );
    }
  }

  /**
   * Track token usage and cost for a generation request.
   */
  private trackUsage(
    providerName: string,
    success: boolean,
    tokensUsed: number,
    latencyMs: number,
  ): void {
    // Update global totals
    this.usageTracker.totalTokens += tokensUsed;
    this.usageTracker.estimatedCostUsd += this.estimateCost(
      providerName,
      tokensUsed,
    );

    // Update per-provider stats
    if (!this.usageTracker.byProvider[providerName]) {
      this.usageTracker.byProvider[providerName] = {
        totalCalls: 0,
        successCalls: 0,
        errorCalls: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        averageLatencyMs: 0,
      };
    }

    const providerStats = this.usageTracker.byProvider[providerName]!;
    providerStats.totalCalls++;
    if (success) providerStats.successCalls++;
    else providerStats.errorCalls++;
    providerStats.totalTokens += tokensUsed;
    providerStats.estimatedCostUsd += this.estimateCost(
      providerName,
      tokensUsed,
    );
    providerStats.averageLatencyMs =
      (providerStats.averageLatencyMs * (providerStats.totalCalls - 1) +
        latencyMs) /
      providerStats.totalCalls;
  }

  /**
   * Estimate cost for token usage.
   * Uses approximate per-token costs when provider pricing is not available.
   */
  private estimateCost(providerName: string, tokensUsed: number): number {
    // Rough average costs per 1K tokens across providers
    const avgCostPer1K: Record<string, number> = {
      deepseek: 0.0005,
      claude: 0.008,
      openai: 0.003,
      gemini: 0.001,
      mistral: 0.002,
      groq: 0.0005,
      openrouter: 0.002,
      ollama: 0,
      'custom-api': 0,
    };

    const costPer1K = avgCostPer1K[providerName] ?? 0.001;
    return (tokensUsed / 1000) * costPer1K;
  }

  /**
   * Create an empty usage stats object.
   */
  private createEmptyUsageStats(): UsageStats {
    return {
      totalTokens: 0,
      estimatedCostUsd: 0,
      byProvider: {},
      period: {
        start: new Date(),
        end: new Date(),
      },
    };
  }
}
