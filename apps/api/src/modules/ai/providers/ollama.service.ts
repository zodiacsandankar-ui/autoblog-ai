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
 * OllamaService - Self-hosted local LLM provider.
 * Uses OpenAI-compatible API at a configurable base URL.
 * Default: http://localhost:11434/v1
 * Supports any model available locally via Ollama.
 * Zero cost per token (runs locally).
 */
const DEFAULT_MODEL = 'llama3.1';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: string;
}

interface OllamaResponse {
  id: string;
  model: string;
  created_at: string;
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

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  choices?: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

@Injectable()
export class OllamaService implements AiProviderInterface, OnModuleInit {
  readonly name = 'ollama';

  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
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
      configService?.get<string>('ai.ollama.baseUrl') ?? 'http://localhost:11434/v1';
    this.defaultModel =
      configService?.get<string>('ai.ollama.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = configService?.get<string[]>('ai.ollama.models') ?? [
      'llama3.1',
      'llama3.2',
      'mistral',
      'mixtral',
      'codellama',
      'phi3',
      'gemma2',
      'qwen2',
    ];
    this.timeout = configService?.get<number>('ai.ollama.timeout') ?? 120000;
  }

  onModuleInit(): void {
    this.logger.log(`Ollama provider initialized with baseUrl=${this.baseUrl}`);
    // Ollama is self-hosted, no API key required
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
      const result = await this.callOllamaApi(prompt, options);
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

      const messages: OllamaMessage[] = [
        {
          role: 'system',
          content:
            options?.systemPrompt ??
            'You are a helpful, accurate, and thoughtful AI assistant.',
        },
        { role: 'user', content: prompt },
      ];

      const requestBody: OllamaRequest = {
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        top_p: options?.topP ?? 1,
        stream: true,
        keep_alive: '5m',
      };

      fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorBody = await response.text();
            throw new AiProviderError(
              `Ollama API error: ${response.status} - ${errorBody}`,
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
                if (!line) continue;

                try {
                  const chunk: OllamaStreamChunk = JSON.parse(line);

                  // Handle Ollama native streaming format
                  if (chunk.message?.content) {
                    subscriber.next({
                      content: chunk.message.content,
                      model: chunk.model ?? model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  // Handle OpenAI-compatible streaming format
                  if (chunk.choices?.[0]?.delta?.content) {
                    subscriber.next({
                      content: chunk.choices[0].delta.content,
                      model: chunk.model ?? model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  if (chunk.done) {
                    const usage: TokenUsage = {
                      promptTokens: chunk.prompt_eval_count ?? 0,
                      completionTokens: chunk.eval_count ?? 0,
                      totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
                    };

                    subscriber.next({
                      content: '',
                      model: chunk.model ?? model,
                      provider: this.name,
                      done: true,
                      usage,
                      finishReason: 'stop',
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
    try {
      await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/models`, {
          timeout: 3000,
        }),
      );
      return true;
    } catch {
      try {
        // Try Ollama native endpoint as fallback
        const base = this.baseUrl.replace('/v1', '');
        await firstValueFrom(
          this.httpService.get(`${base}/api/tags`, {
            timeout: 3000,
          }),
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const base = this.baseUrl.replace('/v1', '');
      const response = await firstValueFrom(
        this.httpService.get<{ models: Array<{ name: string }> }>(
          `${base}/api/tags`,
          { timeout: 5000 },
        ),
      );
      return response.data.models.map((m) => m.name.replace(':latest', ''));
    } catch {
      return this.availableModels;
    }
  }

  getCosts(_model?: string): ProviderCosts {
    // Ollama is self-hosted - zero direct token cost
    return {
      inputPerToken: 0,
      outputPerToken: 0,
      currency: 'USD',
    };
  }

  getStatus(): ProviderStatus {
    return {
      name: this.name,
      available: true, // Will be checked dynamically
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
      configurable: true,
    };
  }

  private async callOllamaApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const messages: OllamaMessage[] = [
      {
        role: 'system',
        content:
          options?.systemPrompt ??
          'You are a helpful, accurate, and thoughtful AI assistant.',
      },
      { role: 'user', content: prompt },
    ];

    const requestBody: OllamaRequest = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 1,
      stream: false,
      keep_alive: '5m',
    };

    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<OllamaResponse>(
          `${this.baseUrl}/chat/completions`,
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
        `Ollama API error (${statusCode}): ${errorMessage}`,
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
    return `ollama:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
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
      case 400:
        return AiErrorType.BAD_REQUEST;
      case 404:
        return AiErrorType.MODEL_UNAVAILABLE;
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
