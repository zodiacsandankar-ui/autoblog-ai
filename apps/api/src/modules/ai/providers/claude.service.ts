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
import { Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4': { input: 0.003, output: 0.015 },
  'claude-opus-4': { input: 0.015, output: 0.075 },
  'claude-haiku-4': { input: 0.00025, output: 0.00125 },
};

const DEFAULT_MODEL = 'claude-sonnet-4';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: any }>;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  thinking?: {
    type: 'enabled';
    budget_tokens: number;
  };
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface ClaudeStreamEvent {
  type: string;
  message?: {
    id: string;
    type: string;
    role: string;
    content: ClaudeContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  content_block?: {
    type: string;
    text?: string;
    thinking?: string;
  };
  index?: number;
}

@Injectable()
export class ClaudeService implements AiProviderInterface, OnModuleInit {
  readonly name = 'claude';

  private readonly logger = new Logger(ClaudeService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly availableModels: string[];
  private readonly timeout: number;
  private readonly apiVersion: string;

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
      configService?.get<string>('ai.claude.baseUrl') ?? 'https://api.anthropic.com';
    this.apiKey =
      configService?.get<string>('ai.claude.apiKey') ??
      process.env.ANTHROPIC_API_KEY ??
      '';
    this.defaultModel =
      configService?.get<string>('ai.claude.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = configService?.get<string[]>('ai.claude.models') ?? [
      'claude-sonnet-4',
      'claude-opus-4',
      'claude-haiku-4',
    ];
    this.timeout = configService?.get<number>('ai.claude.timeout') ?? 60000;
    this.apiVersion =
      configService?.get<string>('ai.claude.apiVersion') ?? '2023-06-01';
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn('No ANTHROPIC_API_KEY configured. Claude provider will be unavailable.');
    } else {
      this.logger.log(`Claude provider initialized with ${this.availableModels.length} models`);
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
      const result = await this.callClaudeApi(prompt, options);
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

      const systemPrompt = options?.systemPrompt ?? undefined;

      const messages: ClaudeMessage[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      const requestBody: ClaudeRequest & { anthropic_version: string } = {
        model,
        max_tokens: options?.maxTokens ?? 4096,
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 1,
        stream: true,
        anthropic_version: this.apiVersion,
      };

      if (systemPrompt) {
        requestBody.system = systemPrompt;
      }

      if (options?.thinking) {
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: Math.min(options.maxTokens ?? 4096, 32000),
        };
      }

      if (options?.stop?.length) {
        requestBody.stop_sequences = options.stop;
      }

      fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorBody = await response.text();
            throw new AiProviderError(
              `Claude API error: ${response.status} - ${errorBody}`,
              this.classifyError(response.status),
              this.name,
              response.status,
            );
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new AiProviderError('No response body', AiErrorType.SERVER_ERROR, this.name);
          }

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
                if (!line || line.startsWith('event:')) continue;

                if (line.startsWith('data: ')) {
                  const data = line.slice(6);

                  try {
                    const event: ClaudeStreamEvent = JSON.parse(data);

                    switch (event.type) {
                      case 'content_block_delta':
                        if (event.delta?.text) {
                          subscriber.next({
                            content: event.delta.text,
                            model,
                            provider: this.name,
                            done: false,
                          });
                        }
                        if (event.delta?.thinking) {
                          subscriber.next({
                            content: '',
                            model,
                            provider: this.name,
                            done: false,
                            thinking: event.delta.thinking,
                          });
                        }
                        break;

                      case 'message_delta':
                        if (event.delta?.stop_reason) {
                          const usage = event.message?.usage
                            ? {
                                promptTokens: event.message.usage.input_tokens,
                                completionTokens: event.message.usage.output_tokens,
                                totalTokens:
                                  event.message.usage.input_tokens +
                                  event.message.usage.output_tokens,
                              }
                            : undefined;

                          subscriber.next({
                            content: '',
                            model,
                            provider: this.name,
                            done: true,
                            usage,
                            finishReason: event.delta.stop_reason,
                          });
                          subscriber.complete();
                        }
                        break;

                      case 'error':
                        subscriber.error(
                          new AiProviderError(
                            `Claude stream error: ${JSON.stringify(data)}`,
                            AiErrorType.SERVER_ERROR,
                            this.name,
                          ),
                        );
                        break;
                    }
                  } catch {
                    // Skip malformed JSON
                  }
                }
              }

              pump();
            }).catch((err) => {
              subscriber.error(
                new AiProviderError(
                  `Stream error: ${(err as Error).message}`,
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
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
          },
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
            headers: {
              'x-api-key': this.apiKey,
              'anthropic-version': this.apiVersion,
            },
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

  private async callClaudeApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: prompt,
      },
    ];

    const requestBody: ClaudeRequest = {
      model,
      max_tokens: options?.maxTokens ?? 4096,
      messages,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 1,
      stream: false,
    };

    if (options?.systemPrompt) {
      requestBody.system = options.systemPrompt;
    }

    if (options?.thinking) {
      requestBody.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(options.maxTokens ?? 4096, 32000),
      };
    }

    if (options?.stop?.length) {
      requestBody.stop_sequences = options.stop;
    }

    const config: AxiosRequestConfig = {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json',
      },
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<ClaudeResponse>(
          `${this.baseUrl}/v1/messages`,
          requestBody,
          config,
        ),
      );

      const data = response.data;
      const content = data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const thinking = data.content
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking)
        .join('');

      const usage: TokenUsage = {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      };

      return {
        content,
        model: data.model ?? model,
        provider: this.name,
        usage,
        latencyMs: Date.now() - startTime,
        finishReason: data.stop_reason ?? undefined,
        thinking: thinking || undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorMessage =
        (axiosError.response?.data as any)?.error?.message ??
        axiosError.message;

      throw new AiProviderError(
        `Claude API error (${statusCode}): ${errorMessage}`,
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
      systemPrompt: options?.systemPrompt,
    });
    return `claude:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
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
