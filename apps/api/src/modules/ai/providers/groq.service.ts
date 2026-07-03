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
 * Groq is an ultra-fast inference provider using OpenAI-compatible API.
 * Models: llama-3.3-70b, mixtral-8x7b.
 * Known for extremely high throughput and low latency.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'llama-3.3-70b': { input: 0.00059, output: 0.00079 },
  'mixtral-8x7b': { input: 0.00024, output: 0.00024 },
};

const DEFAULT_MODEL = 'llama-3.3-70b';

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
}

interface GroqResponse {
  id: string;
  object: string;
  created: number;
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
    prompt_time?: number;
    completion_time?: number;
    total_time?: number;
  };
}

interface GroqStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
    logprobs?: any;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  x_groq?: {
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      prompt_time?: number;
      completion_time?: number;
      total_time?: number;
    };
  };
}

@Injectable()
export class GroqService implements AiProviderInterface, OnModuleInit {
  readonly name = 'groq';

  private readonly logger = new Logger(GroqService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly availableModels: string[];
  private readonly timeout: number;

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
      configService?.get<string>('ai.groq.baseUrl') ?? 'https://api.groq.com/openai';
    this.apiKey =
      configService?.get<string>('ai.groq.apiKey') ??
      process.env.GROQ_API_KEY ??
      '';
    this.defaultModel =
      configService?.get<string>('ai.groq.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = configService?.get<string[]>('ai.groq.models') ?? [
      'llama-3.3-70b',
      'mixtral-8x7b',
    ];
    this.timeout = configService?.get<number>('ai.groq.timeout') ?? 30000;
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn('No GROQ_API_KEY configured. Groq provider will be unavailable.');
    } else {
      this.logger.log(`Groq provider initialized with ${this.availableModels.length} models`);
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
      const result = await this.callGroqApi(prompt, options);
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
      const signal = options?.signal;

      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const messages: GroqMessage[] = [
        {
          role: 'system',
          content:
            options?.systemPrompt ??
            'You are a helpful, accurate, and thoughtful AI assistant. Provide clear, well-reasoned responses.',
        },
        { role: 'user', content: prompt },
      ];

      const requestBody: GroqRequest = {
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        top_p: options?.topP ?? 1,
        stream: true,
      };

      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorBody = await response.text();
            throw new AiProviderError(
              `Groq API error: ${response.status} - ${errorBody}`,
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
                  const chunk: GroqStreamChunk = JSON.parse(data);
                  const choice = chunk.choices?.[0];

                  if (choice?.delta?.content) {
                    subscriber.next({
                      content: choice.delta.content,
                      model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  if (choice?.finish_reason) {
                    const groqUsage =
                      chunk.x_groq?.usage ?? chunk.usage;
                    const usage = groqUsage
                      ? {
                          promptTokens: groqUsage.prompt_tokens,
                          completionTokens: groqUsage.completion_tokens,
                          totalTokens: groqUsage.total_tokens,
                        }
                      : undefined;

                    subscriber.next({
                      content: '',
                      model,
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
    const pricing = MODEL_PRICING[model ?? this.defaultModel] ?? MODEL_PRICING[DEFAULT_MODEL]!;
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

  private async callGroqApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const messages: GroqMessage[] = [
      {
        role: 'system',
        content:
          options?.systemPrompt ??
          'You are a helpful, accurate, and thoughtful AI assistant.',
      },
      { role: 'user', content: prompt },
    ];

    const requestBody: GroqRequest = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1,
      frequency_penalty: options?.frequencyPenalty ?? 0,
      presence_penalty: options?.presencePenalty ?? 0,
      stream: false,
    };

    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GroqResponse>(
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
        `Groq API error (${statusCode}): ${errorMessage}`,
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
    return `groq:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
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
