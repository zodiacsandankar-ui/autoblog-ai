import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';

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

/**
 * OpenRouter provides access to 100+ models through a unified API.
 * Uses OpenAI-compatible chat completions endpoint.
 * Supports model routing, fallbacks, and provider preferences.
 */
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// Representative pricing for common OpenRouter models (per 1K tokens, USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'anthropic/claude-sonnet-4': { input: 0.003, output: 0.015 },
  'anthropic/claude-opus-4': { input: 0.015, output: 0.075 },
  'google/gemini-2.5-pro': { input: 0.00125, output: 0.005 },
  'google/gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'mistralai/mistral-large': { input: 0.002, output: 0.006 },
  'meta-llama/llama-3.3-70b': { input: 0.00059, output: 0.00079 },
  'deepseek/deepseek-chat': { input: 0.00014, output: 0.00028 },
};

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  seed?: number;
  transforms?: string[];
  route?: 'flexible' | 'fallback';
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    data_collection?: 'deny' | 'allow';
  };
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class OpenRouterService implements AiProviderInterface, OnModuleInit {
  readonly name = 'openrouter';

  private readonly logger = new Logger(OpenRouterService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly availableModels: string[];
  private readonly timeout: number;
  private readonly referer?: string;
  private readonly title?: string;

  private metrics = {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    totalLatencyMs: 0,
    lastError: null as string | null,
    lastSuccessAt: null as Date | null,
    tokensUsed: 0,
    estimatedCostUsd: 0,
  };

  constructor(
    private readonly httpService: HttpService,
    @Optional() @Inject(CACHE_MANAGER) private cacheManager?: Cache,
    private readonly configService?: ConfigService,
  ) {
    this.baseUrl =
      configService?.get<string>('ai.openrouter.baseUrl') ?? 'https://openrouter.ai/api';
    this.apiKey =
      configService?.get<string>('ai.openrouter.apiKey') ??
      process.env.OPENROUTER_API_KEY ??
      '';
    this.defaultModel =
      configService?.get<string>('ai.openrouter.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = configService?.get<string[]>('ai.openrouter.models') ?? [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'mistralai/mistral-large',
      'meta-llama/llama-3.3-70b',
    ];
    this.timeout = configService?.get<number>('ai.openrouter.timeout') ?? 60000;
    this.referer = configService?.get<string>('ai.openrouter.referer');
    this.title = configService?.get<string>('ai.openrouter.title');
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn('No OPENROUTER_API_KEY configured. OpenRouter provider will be unavailable.');
    } else {
      this.logger.log(`OpenRouter provider initialized with ${this.availableModels.length} models`);
    }
  }

  async generateContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    this.metrics.totalCalls++;
    const model = options?.model ?? this.defaultModel;

    const cacheKey = this.generateCacheKey(prompt, options);
    const cached = await this.getCachedResult(cacheKey);
    if (cached) {
      this.recordMetrics(startTime, true);
      return { ...cached, cached: true, latencyMs: Date.now() - startTime };
    }

    try {
      const result = await this.callOpenRouterApi(prompt, options);
      await this.setCachedResult(cacheKey, result);
      this.recordMetrics(startTime, true);
      this.metrics.tokensUsed += result.usage.totalTokens;
      return result;
    } catch (error) {
      this.recordMetrics(startTime, false);
      throw error;
    }
  }

  streamContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Observable<StreamChunk> {
    const model = options?.model ?? this.defaultModel;

    return new Observable<StreamChunk>((subscriber) => {
      const controller = new AbortController();

      const messages: OpenRouterMessage[] = [
        {
          role: 'system',
          content:
            options?.systemPrompt ??
            'You are a helpful, accurate, and thoughtful AI assistant.',
        },
        { role: 'user', content: prompt },
      ];

      const requestBody: OpenRouterRequest = {
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        top_p: options?.topP ?? 1,
        stream: true,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      };
      if (this.referer) headers['HTTP-Referer'] = this.referer;
      if (this.title) headers['X-Title'] = this.title;

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
              `OpenRouter API error: ${response.status} - ${errorBody}`,
              this.classifyError(response.status),
              this.name,
              response.status,
            );
          }

          const reader = response.body?.getReader();
          if (!reader) throw new AiProviderError('No response body', AiErrorType.SERVER_ERROR, this.name);

          const decoder = new TextDecoder();
          let buffer = '';

          const pump = () => {
            reader.read().then(({ done, value }) => {
              if (done) {
                subscriber.complete();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || !line.startsWith('data: ')) continue;

                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  subscriber.next({
                    content: '',
                    model,
                    provider: this.name,
                    done: true,
                    finishReason: 'stop',
                  });
                  subscriber.complete();
                  return;
                }

                try {
                  const chunk: OpenRouterStreamChunk = JSON.parse(data);
                  const choice = chunk.choices?.[0];

                  if (choice?.delta?.content) {
                    subscriber.next({
                      content: choice.delta.content,
                      model: chunk.model ?? model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  if (choice?.finish_reason) {
                    const usage = chunk.usage
                      ? {
                          promptTokens: chunk.usage.prompt_tokens,
                          completionTokens: chunk.usage.completion_tokens,
                          totalTokens: chunk.usage.total_tokens,
                        }
                      : undefined;

                    subscriber.next({
                      content: '',
                      model: chunk.model ?? model,
                      provider: this.name,
                      done: true,
                      usage,
                      finishReason: choice.finish_reason,
                    });
                    subscriber.complete();
                  }
                } catch {
                  // Skip malformed JSON
                }
              }

              pump();
            }).catch((err) => {
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
          subscriber.error(err);
        });

      return () => controller.abort();
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeout: 5000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ data: Array<{ id: string }> }>(
          `${this.baseUrl}/v1/models`,
          {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeout: 10000,
          },
        ),
      );
      return response.data.data.map((m) => m.id);
    } catch {
      return this.availableModels;
    }
  }

  getCosts(model?: string): ProviderCosts {
    const pricing = MODEL_PRICING[model ?? this.defaultModel] ?? { input: 0.001, output: 0.003 };
    return {
      inputPerToken: pricing.input,
      outputPerToken: pricing.output,
      currency: 'USD',
    };
  }

  getStatus(): ProviderStatus {
    return {
      name: this.name,
      available: !!this.apiKey,
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

  private async callOpenRouterApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content:
          options?.systemPrompt ??
          'You are a helpful, accurate, and thoughtful AI assistant.',
      },
      { role: 'user', content: prompt },
    ];

    const requestBody: OpenRouterRequest = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1,
      stream: false,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.referer) headers['HTTP-Referer'] = this.referer;
    if (this.title) headers['X-Title'] = this.title;

    const config: AxiosRequestConfig = {
      headers,
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<OpenRouterResponse>(
          `${this.baseUrl}/v1/chat/completions`,
          requestBody,
          config,
        ),
      );

      const data = response.data;
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? '';

      const usage: TokenUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      return {
        content,
        model: data.model ?? model,
        provider: this.name,
        usage,
        latencyMs: Date.now() - startTime,
        finishReason: choice?.finish_reason ?? undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorMessage =
        (axiosError.response?.data as any)?.error?.message ?? axiosError.message;

      throw new AiProviderError(
        `OpenRouter API error (${statusCode}): ${errorMessage}`,
        this.classifyError(statusCode),
        this.name,
        statusCode,
      );
    }
  }

  private generateCacheKey(prompt: string, options?: Partial<GenerateOptions>): string {
    const hashInput = JSON.stringify({
      prompt,
      model: options?.model,
      temperature: options?.temperature,
    });
    return `openrouter:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
  }

  private async getCachedResult(key: string): Promise<ContentResult | null> {
    if (!this.cacheManager) return null;
    try {
      return (await this.cacheManager.get<ContentResult>(key)) ?? null;
    } catch {
      return null;
    }
  }

  private async setCachedResult(key: string, result: ContentResult): Promise<void> {
    if (!this.cacheManager) return;
    try {
      await this.cacheManager.set(key, result, 300000);
    } catch {
      // Non-critical
    }
  }

  private classifyError(statusCode?: number): AiErrorType {
    switch (statusCode) {
      case 401:
      case 403:
        return AiErrorType.AUTHENTICATION;
      case 429:
        return AiErrorType.RATE_LIMIT;
      case 400:
        return AiErrorType.BAD_REQUEST;
      case 500:
      case 502:
      case 503:
        return AiErrorType.SERVER_ERROR;
      default:
        return AiErrorType.UNKNOWN;
    }
  }

  private recordMetrics(startTime: number, success: boolean): void {
    const latency = Date.now() - startTime;
    this.metrics.totalLatencyMs += latency;
    if (success) {
      this.metrics.successCalls++;
      this.metrics.lastSuccessAt = new Date();
    } else {
      this.metrics.errorCalls++;
    }
  }
}
