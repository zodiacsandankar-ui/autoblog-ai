import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Observable, from, throwError } from 'rxjs';
import { map, catchError, mergeMap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';

import {
  AiProviderInterface,
  ContentResult,
  StreamChunk,
  GenerateOptions,
  TokenUsage,
  ProviderCosts,
  ProviderStatus,
  AiProviderError,
  AiErrorType,
} from '../ai-provider.interface';

// ---------------------------------------------------------------------------
// Circuit Breaker State
// ---------------------------------------------------------------------------
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  halfOpenRequests: number;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  enableJitter: boolean;
}

// ---------------------------------------------------------------------------
// DeepSeek API response types
// ---------------------------------------------------------------------------
interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

interface DeepSeekChatCompletionRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  response_format?: {
    type: 'text' | 'json_object';
  };
  thinking?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high';
  };
  reasoning_effort?: 'low' | 'medium' | 'high';
}

interface DeepSeekChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
}

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Model pricing (input / output per token in USD)
// ---------------------------------------------------------------------------
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4-pro': { input: 0.0005, output: 0.0015 },
  'deepseek-v4-flash': { input: 0.0001, output: 0.0003 },
  'deepseek-chat': { input: 0.00014, output: 0.00028 },
  'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
};

const DEFAULT_MODEL = 'deepseek-v4-flash';

@Injectable()
export class DeepSeekService implements AiProviderInterface, OnModuleInit {
  readonly name = 'deepseek';

  private readonly logger = new Logger(DeepSeekService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly availableModels: string[];
  private readonly timeout: number;

  // Circuit breaker state
  private cbConfig: CircuitBreakerConfig;
  private cbState: CircuitBreakerState;

  // Retry config
  private retryConfig: RetryConfig;

  // Metrics
  private metrics: {
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
    totalLatencyMs: number;
    lastError: string | null;
    lastSuccessAt: Date | null;
    tokensUsed: number;
    estimatedCostUsd: number;
  };

  constructor(
    private readonly httpService: HttpService,
    @Optional() @Inject(CACHE_MANAGER) private cacheManager?: Cache,
    @Optional() @Inject('MetricsService') private metricsService?: any,
    private readonly configService?: ConfigService,
  ) {
    const cfg = this.configService;

    this.baseUrl =
      cfg?.get<string>('ai.deepseek.baseUrl') ?? 'https://api.deepseek.com';
    this.apiKey =
      cfg?.get<string>('ai.deepseek.apiKey') ?? process.env.DEEPSEEK_API_KEY ?? '';
    this.defaultModel =
      cfg?.get<string>('ai.deepseek.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = cfg?.get<string[]>('ai.deepseek.models') ?? [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-chat',
      'deepseek-reasoner',
    ];
    this.timeout = cfg?.get<number>('ai.deepseek.timeout') ?? 60000;

    // Circuit breaker defaults
    this.cbConfig = {
      failureThreshold: cfg?.get<number>('ai.deepseek.circuitBreaker.failureThreshold', 5) ?? 5,
      resetTimeoutMs: cfg?.get<number>('ai.deepseek.circuitBreaker.resetTimeoutMs', 30000) ?? 30000,
      halfOpenMaxRequests: cfg?.get<number>('ai.deepseek.circuitBreaker.halfOpenMaxRequests', 3) ?? 3,
    };
    this.cbState = this.createInitialCircuitState();

    // Retry defaults
    this.retryConfig = {
      maxRetries: cfg?.get<number>('ai.deepseek.retry.maxRetries', 5) ?? 5,
      baseDelayMs: cfg?.get<number>('ai.deepseek.retry.baseDelayMs', 1000) ?? 1000,
      maxDelayMs: cfg?.get<number>('ai.deepseek.retry.maxDelayMs', 60000) ?? 60000,
      enableJitter: cfg?.get<boolean>('ai.deepseek.retry.enableJitter', true) ?? true,
    };

    // Metrics
    this.metrics = {
      totalCalls: 0,
      successCalls: 0,
      errorCalls: 0,
      totalLatencyMs: 0,
      lastError: null,
      lastSuccessAt: null,
      tokensUsed: 0,
      estimatedCostUsd: 0,
    };

    if (cfg) {
      this.logger.log(
        `DeepSeek configured: baseUrl=${this.baseUrl}, defaultModel=${this.defaultModel}`,
      );
    }
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn(
        'No DEEPSEEK_API_KEY configured. DeepSeek provider will be unavailable.',
      );
    } else {
      this.logger.log(
        `DeepSeek provider initialized with ${this.availableModels.length} models`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // AiProviderInterface implementation
  // -----------------------------------------------------------------------

  /**
   * Generate content using DeepSeek with full reliability guarantees:
   * semantic cache lookup -> circuit breaker check -> retry loop -> API call -> cache result
   */
  async generateContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    this.metrics.totalCalls++;

    const model = options?.model ?? this.defaultModel;
    const cacheKey = this.generateCacheKey(prompt, options);

    // 1. Semantic cache check
    const cached = await this.getCachedResult(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for prompt (model=${model})`);
      this.recordMetrics(startTime, true);
      return {
        ...cached,
        cached: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // 2. Circuit breaker check
    this.checkCircuitBreaker();

    // 3. Attempt API call with retry
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = await this.callDeepSeekApi(prompt, options);

        // 4. Cache successful result
        await this.setCachedResult(cacheKey, result);

        // Circuit breaker: record success
        this.recordCircuitSuccess();
        this.recordMetrics(startTime, true);

        // Track usage
        this.metrics.tokensUsed += result.usage.totalTokens;

        return result;
      } catch (error) {
        lastError = error as Error;

        // Determine if this error is retryable
        if (!this.isRetryableError(error)) {
          this.recordCircuitFailure();
          this.recordMetrics(startTime, false);
          throw error;
        }

        // If this was the last attempt, don't delay
        if (attempt >= this.retryConfig.maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        await this.delay(this.calculateBackoff(attempt));

        this.logger.warn(
          `Retry attempt ${attempt + 1}/${this.retryConfig.maxRetries} for DeepSeek call: ${(error as Error).message}`,
        );
      }
    }

    // All retries exhausted
    this.recordCircuitFailure();
    this.recordMetrics(startTime, false);

    // 5. Auto-fallback to next provider if configured
    if (options?.maxRetries !== 0) {
      this.logger.warn(
        `DeepSeek failed after ${this.retryConfig.maxRetries + 1} attempts. Attempting fallback...`,
      );
      return this.fallbackToNextProvider(prompt, options);
    }

    throw lastError ?? new AiProviderError(
      'DeepSeek API call failed after all retries',
      AiErrorType.SERVER_ERROR,
      this.name,
    );
  }

  /**
   * Stream content from DeepSeek using Server-Sent Events.
   * Returns an Observable of StreamChunk objects.
   */
  streamContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Observable<StreamChunk> {
    const model = options?.model ?? this.defaultModel;

    this.checkCircuitBreaker();

    const messages = this.buildMessages(prompt, options);
    const requestBody: DeepSeekChatCompletionRequest = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1,
      frequency_penalty: options?.frequencyPenalty ?? 0,
      presence_penalty: options?.presencePenalty ?? 0,
      stop: options?.stop,
      stream: true,
    };

    // Add response_format for JSON mode
    if (options?.responseFormat === 'json_object') {
      requestBody.response_format = { type: 'json_object' };
    }

    // Add thinking/reasoning support
    if (options?.thinking) {
      requestBody.thinking = {
        enabled: true,
        effort: options?.reasoningEffort ?? 'medium',
      };
    }
    if (options?.reasoningEffort) {
      requestBody.reasoning_effort = options.reasoningEffort;
    }

    return new Observable<StreamChunk>((subscriber) => {
      const controller = new AbortController();
      const signal = options?.signal;

      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };

      // Use the abort signal for cleanup
      let accumulatedContent = '';
      let accumulatedThinking = '';
      const requestId = uuidv4();

      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorBody = await response.text();
            throw new AiProviderError(
              `DeepSeek API error: ${response.status} ${response.statusText} - ${errorBody}`,
              this.classifyError(response.status),
              this.name,
              response.status,
            );
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new AiProviderError(
              'Response body is not readable',
              AiErrorType.SERVER_ERROR,
              this.name,
            );
          }

          const decoder = new TextDecoder();
          let buffer = '';

          const processLine = (line: string) => {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();

              // [DONE] signal
              if (data === '[DONE]') {
                subscriber.next({
                  content: '',
                  model,
                  provider: this.name,
                  done: true,
                  finishReason: 'stop',
                });
                subscriber.complete();
                this.recordCircuitSuccess();
                return;
              }

              try {
                const parsed: DeepSeekStreamChunk = JSON.parse(data);
                const choice = parsed.choices?.[0];

                if (choice) {
                  const delta = choice.delta;

                  if (delta?.content) {
                    accumulatedContent += delta.content;
                    subscriber.next({
                      content: delta.content,
                      model: parsed.model ?? model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  if (delta?.reasoning_content) {
                    accumulatedThinking += delta.reasoning_content;
                    subscriber.next({
                      content: '',
                      model: parsed.model ?? model,
                      provider: this.name,
                      done: false,
                      thinking: delta.reasoning_content,
                    });
                  }

                  if (choice.finish_reason) {
                    const usage = parsed.usage
                      ? {
                          promptTokens: parsed.usage.prompt_tokens,
                          completionTokens: parsed.usage.completion_tokens,
                          totalTokens: parsed.usage.total_tokens,
                          cachedTokens: parsed.usage.cached_tokens,
                        }
                      : undefined;

                    subscriber.next({
                      content: '',
                      model: parsed.model ?? model,
                      provider: this.name,
                      done: true,
                      usage,
                      finishReason: choice.finish_reason,
                    });
                    subscriber.complete();
                    this.recordCircuitSuccess();
                  }
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          };

          const pump = () => {
            reader
              .read()
              .then(({ done, value }) => {
                if (done) {
                  subscriber.complete();
                  return;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

                for (const line of lines) {
                  processLine(line.trim());
                }

                pump();
              })
              .catch((err) => {
                subscriber.error(
                  new AiProviderError(
                    `Stream read error: ${(err as Error).message}`,
                    AiErrorType.SERVER_ERROR,
                    this.name,
                  ),
                );
              });
          };

          pump();
        })
        .catch((err) => {
          if ((err as Error).name === 'AbortError') {
            subscriber.complete();
            return;
          }
          subscriber.error(
            err instanceof AiProviderError
              ? err
              : new AiProviderError(
                  `DeepSeek stream error: ${(err as Error).message}`,
                  AiErrorType.SERVER_ERROR,
                  this.name,
                ),
          );
          this.recordCircuitFailure();
        });

      // Cleanup on unsubscribe
      return () => {
        controller.abort();
      };
    });
  }

  /**
   * Check if the DeepSeek API is available.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;

    // If circuit is open, provider is not available
    if (this.cbState.state === CircuitState.OPEN) {
      return false;
    }

    try {
      await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/models`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          timeout: 5000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available DeepSeek models.
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data: Array<{ id: string }> }>(
          `${this.baseUrl}/v1/models`,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              Accept: 'application/json',
            },
            timeout: 10000,
          },
        ),
      );
      return response.data.data.map((m) => m.id);
    } catch {
      // Fall back to configured models
      return this.availableModels;
    }
  }

  /**
   * Get cost information for a specific model.
   */
  getCosts(model?: string): ProviderCosts {
    const config = MODEL_PRICING[model ?? this.defaultModel] ?? MODEL_PRICING[DEFAULT_MODEL]!;
    return {
      inputPerToken: config.input,
      outputPerToken: config.output,
      currency: 'USD',
    };
  }

  /**
   * Get current provider status for health checks.
   */
  getStatus(): ProviderStatus {
    return {
      name: this.name,
      available: this.cbState.state !== CircuitState.OPEN && !!this.apiKey,
      models: this.availableModels,
      latencyMs:
        this.metrics.totalCalls > 0
          ? Math.round(this.metrics.totalLatencyMs / this.metrics.totalCalls)
          : 0,
      errorRate:
        this.metrics.totalCalls > 0
          ? this.metrics.errorCalls / this.metrics.totalCalls
          : 0,
      totalCalls: this.metrics.totalCalls,
      successCalls: this.metrics.successCalls,
      lastError: this.metrics.lastError,
      lastSuccessAt: this.metrics.lastSuccessAt,
      configurable: false,
    };
  }

  // -----------------------------------------------------------------------
  // Internal API call with full parameter support
  // -----------------------------------------------------------------------

  /**
   * Core API call to DeepSeek chat completions endpoint.
   * Handles request construction, authentication, response parsing,
   * and error classification.
   */
  private async callDeepSeekApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const messages = this.buildMessages(prompt, options);

    const requestBody: DeepSeekChatCompletionRequest = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1,
      frequency_penalty: options?.frequencyPenalty ?? 0,
      presence_penalty: options?.presencePenalty ?? 0,
      stop: options?.stop,
      stream: false,
    };

    // JSON mode
    if (options?.responseFormat === 'json_object') {
      requestBody.response_format = { type: 'json_object' };
    }

    // Thinking / reasoning support
    if (options?.thinking) {
      requestBody.thinking = {
        enabled: true,
        effort: options?.reasoningEffort ?? 'medium',
      };
    }
    if (options?.reasoningEffort) {
      requestBody.reasoning_effort = options.reasoningEffort;
    }

    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<DeepSeekChatCompletionResponse>(
          `${this.baseUrl}/v1/chat/completions`,
          requestBody,
          config,
        ),
      );

      const data = response.data;
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? '';
      const reasoning = choice?.message?.reasoning_content;

      const usage: TokenUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        cachedTokens: data.usage?.cached_tokens,
      };

      return {
        content,
        model: data.model ?? model,
        provider: this.name,
        usage,
        latencyMs: Date.now() - startTime,
        finishReason: choice?.finish_reason ?? undefined,
        thinking: reasoning,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorMessage =
        (axiosError.response?.data as any)?.error?.message ??
        axiosError.message ??
        'Unknown error';

      throw new AiProviderError(
        `DeepSeek API error (${statusCode}): ${errorMessage}`,
        this.classifyError(statusCode),
        this.name,
        statusCode,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Message construction
  // -----------------------------------------------------------------------

  /**
   * Build the messages array for the DeepSeek API call.
   * Constructs system and user messages from the prompt and options.
   */
  private buildMessages(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): DeepSeekMessage[] {
    const messages: DeepSeekMessage[] = [];

    // System prompt
    const systemPrompt =
      options?.systemPrompt ??
      'You are a helpful, accurate, and thoughtful AI assistant. Provide clear, well-reasoned responses.';

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // User message
    messages.push({
      role: 'user',
      content: prompt,
    });

    return messages;
  }

  // -----------------------------------------------------------------------
  // Cost calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate the cost of a request based on token usage and model pricing.
   */
  calculateCost(
    usage: TokenUsage,
    model?: string,
  ): { inputCost: number; outputCost: number; totalCost: number } {
    const pricing = MODEL_PRICING[model ?? this.defaultModel] ?? MODEL_PRICING[DEFAULT_MODEL]!;
    const inputCost = usage.promptTokens * pricing.input;
    const outputCost = usage.completionTokens * pricing.output;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  // -----------------------------------------------------------------------
  // Cache key generation
  // -----------------------------------------------------------------------

  /**
   * Generate a deterministic cache key from the prompt and options.
   * Uses SHA-256 hashing for consistent, collision-resistant keys.
   */
  generateCacheKey(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): string {
    const hashInput = JSON.stringify({
      prompt,
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      topP: options?.topP,
      systemPrompt: options?.systemPrompt,
      responseFormat: options?.responseFormat,
    });
    return `deepseek:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
  }

  // -----------------------------------------------------------------------
  // Cache helpers
  // -----------------------------------------------------------------------

  private async getCachedResult(
    key: string,
  ): Promise<ContentResult | null> {
    if (!this.cacheManager) return null;
    try {
      const cached = await this.cacheManager.get<ContentResult>(key);
      return cached ?? null;
    } catch {
      return null;
    }
  }

  private async setCachedResult(
    key: string,
    result: ContentResult,
  ): Promise<void> {
    if (!this.cacheManager) return;
    try {
      await this.cacheManager.set(key, result, 300_000); // 5 minutes TTL
    } catch {
      // Cache write failure is non-critical
    }
  }

  // -----------------------------------------------------------------------
  // Fallback chain to next provider
  // -----------------------------------------------------------------------

  /**
   * Fall back through the provider chain in order.
   * Chain: [claude, openai, gemini, mistral, groq, openrouter, ollama, custom-api]
   */
  async fallbackToNextProvider(
    prompt: string,
    options?: Partial<GenerateOptions>,
    _originalError?: Error,
  ): Promise<ContentResult> {
    const fallbackChain = [
      'claude',
      'openai',
      'gemini',
      'mistral',
      'groq',
      'openrouter',
      'ollama',
    ];

    // This method is a hook — it throws to signal to the orchestrator
    // that fallback is needed. The orchestrator handles the actual fallback chain.
    throw new AiProviderError(
      `DeepSeek failed, needs fallback. Suggested providers: ${fallbackChain.join(', ')}`,
      AiErrorType.PROVIDER_UNAVAILABLE,
      this.name,
      undefined,
      true,
    );
  }

  // -----------------------------------------------------------------------
  // Circuit breaker implementation
  // -----------------------------------------------------------------------

  private createInitialCircuitState(): CircuitBreakerState {
    return {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      halfOpenRequests: 0,
    };
  }

  private checkCircuitBreaker(): void {
    if (this.cbState.state === CircuitState.OPEN) {
      // Check if reset timeout has elapsed
      if (
        this.cbState.lastFailureTime &&
        Date.now() - this.cbState.lastFailureTime >= this.cbConfig.resetTimeoutMs
      ) {
        this.logger.debug(
          `Circuit breaker transitioning from OPEN to HALF_OPEN after ${this.cbConfig.resetTimeoutMs}ms`,
        );
        this.cbState.state = CircuitState.HALF_OPEN;
        this.cbState.halfOpenRequests = 0;
      } else {
        throw new AiProviderError(
          `Circuit breaker is OPEN for ${this.name}. Rejecting request.`,
          AiErrorType.CIRCUIT_OPEN,
          this.name,
        );
      }
    }

    if (this.cbState.state === CircuitState.HALF_OPEN) {
      if (this.cbState.halfOpenRequests >= this.cbConfig.halfOpenMaxRequests) {
        throw new AiProviderError(
          `Circuit breaker HALF_OPEN: max probe requests (${this.cbConfig.halfOpenMaxRequests}) reached`,
          AiErrorType.CIRCUIT_OPEN,
          this.name,
        );
      }
      this.cbState.halfOpenRequests++;
    }
  }

  private recordCircuitSuccess(): void {
    if (this.cbState.state === CircuitState.HALF_OPEN) {
      this.logger.log('Circuit breaker HALF_OPEN -> CLOSED (success)');
      this.cbState = this.createInitialCircuitState();
    } else {
      this.cbState.failureCount = 0;
      this.cbState.successCount++;
    }
  }

  private recordCircuitFailure(): void {
    this.cbState.failureCount++;
    this.cbState.lastFailureTime = Date.now();

    if (
      this.cbState.state === CircuitState.HALF_OPEN ||
      this.cbState.failureCount >= this.cbConfig.failureThreshold
    ) {
      this.logger.warn(
        `Circuit breaker OPEN (failureCount=${this.cbState.failureCount}/${this.cbConfig.failureThreshold})`,
      );
      this.cbState.state = CircuitState.OPEN;
      this.cbState.halfOpenRequests = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Retry / backoff helpers
  // -----------------------------------------------------------------------

  private calculateBackoff(attempt: number): number {
    const exponentialDelay =
      this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);

    if (this.retryConfig.enableJitter) {
      // Full jitter: random between 0 and cappedDelay
      return Math.random() * cappedDelay;
    }
    return cappedDelay;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof AiProviderError) {
      return error.retryable;
    }
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      const status = axiosError.response.status;
      return (
        status === 429 || // Rate limit
        status === 500 || // Server error
        status === 502 || // Bad gateway
        status === 503 || // Service unavailable
        status === 504    // Gateway timeout
      );
    }
    // Network errors are retryable
    if (axiosError.code === 'ECONNRESET' || axiosError.code === 'ETIMEDOUT') {
      return true;
    }
    return false;
  }

  private classifyError(statusCode?: number): AiErrorType {
    switch (statusCode) {
      case 401:
        return AiErrorType.AUTHENTICATION;
      case 429:
        return AiErrorType.RATE_LIMIT;
      case 400:
        return AiErrorType.BAD_REQUEST;
      case 403:
        return AiErrorType.INSUFFICIENT_QUOTA;
      case 404:
        return AiErrorType.MODEL_UNAVAILABLE;
      case 500:
      case 502:
      case 503:
      case 504:
        return AiErrorType.SERVER_ERROR;
      default:
        return AiErrorType.UNKNOWN;
    }
  }

  // -----------------------------------------------------------------------
  // Metrics helpers
  // -----------------------------------------------------------------------

  private recordMetrics(startTime: number, success: boolean): void {
    const latency = Date.now() - startTime;
    this.metrics.totalLatencyMs += latency;

    if (success) {
      this.metrics.successCalls++;
      this.metrics.lastSuccessAt = new Date();
    } else {
      this.metrics.errorCalls++;
    }

    // Report to external metrics service if available
    this.reportMetricsToService(success, latency);
  }

  private reportMetricsToService(success: boolean, latencyMs: number): void {
    try {
      this.metricsService?.record?.({
        provider: this.name,
        success,
        latencyMs,
        timestamp: new Date(),
      });
    } catch {
      // Metrics reporting is non-critical
    }
  }
}
