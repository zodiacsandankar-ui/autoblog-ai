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

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    responseSchema?: any;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      role: string;
      parts: Array<{ text: string }>;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
    tokenCount?: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

@Injectable()
export class GeminiService implements AiProviderInterface, OnModuleInit {
  readonly name = 'gemini';

  private readonly logger = new Logger(GeminiService.name);
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
      configService?.get<string>('ai.gemini.baseUrl') ??
      'https://generativelanguage.googleapis.com';
    this.apiKey =
      configService?.get<string>('ai.gemini.apiKey') ??
      process.env.GEMINI_API_KEY ??
      '';
    this.defaultModel =
      configService?.get<string>('ai.gemini.defaultModel') ?? DEFAULT_MODEL;
    this.availableModels = configService?.get<string[]>('ai.gemini.models') ?? [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ];
    this.timeout = configService?.get<number>('ai.gemini.timeout') ?? 60000;
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn('No GEMINI_API_KEY configured. Gemini provider will be unavailable.');
    } else {
      this.logger.log(`Gemini provider initialized with ${this.availableModels.length} models`);
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
      const result = await this.callGeminiApi(prompt, options);
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

      const contents: GeminiContent[] = [
        { role: 'user', parts: [{ text: prompt }] },
      ];

      const requestBody: GeminiRequest = {
        contents,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 4096,
          topP: options?.topP ?? 1,
        },
      };

      if (options?.systemPrompt) {
        requestBody.systemInstruction = {
          parts: [{ text: options.systemPrompt }],
        };
      }

      if (options?.responseFormat === 'json_object') {
        requestBody.generationConfig!.responseMimeType = 'application/json';
      }

      fetch(
        `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          if (!response.ok) {
            const errorBody = await response.text();
            throw new AiProviderError(
              `Gemini API error: ${response.status} - ${errorBody}`,
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
                if (!data || data === '[DONE]') continue;

                try {
                  const chunk: GeminiStreamChunk = JSON.parse(data);
                  const candidate = chunk.candidates?.[0];

                  if (candidate?.content?.parts?.[0]?.text) {
                    subscriber.next({
                      content: candidate.content.parts[0].text,
                      model,
                      provider: this.name,
                      done: false,
                    });
                  }

                  if (candidate?.finishReason) {
                    const usage = chunk.usageMetadata
                      ? {
                          promptTokens: chunk.usageMetadata.promptTokenCount,
                          completionTokens: chunk.usageMetadata.candidatesTokenCount,
                          totalTokens: chunk.usageMetadata.totalTokenCount,
                        }
                      : undefined;

                    subscriber.next({
                      content: '',
                      model,
                      provider: this.name,
                      done: true,
                      usage,
                      finishReason: candidate.finishReason,
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
        this.httpService.get(
          `${this.baseUrl}/v1beta/models?key=${this.apiKey}`,
          { timeout: 5000 },
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ models: Array<{ name: string }> }>(
          `${this.baseUrl}/v1beta/models?key=${this.apiKey}`,
          { timeout: 10000 },
        ),
      );
      return response.data.models.map((m) => m.name.split('/').pop()!);
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

  private async callGeminiApi(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult> {
    const startTime = Date.now();
    const model = options?.model ?? this.defaultModel;

    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096,
        topP: options?.topP ?? 1,
      },
    };

    if (options?.systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    if (options?.responseFormat === 'json_object') {
      requestBody.generationConfig!.responseMimeType = 'application/json';
    }

    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.timeout,
      signal: options?.signal,
      params: { key: this.apiKey },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GeminiResponse>(
          `${this.baseUrl}/v1beta/models/${model}:generateContent`,
          requestBody,
          config,
        ),
      );

      const data = response.data;
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p) => p.text).join('') ?? '';

      const usage: TokenUsage = {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      };

      return {
        content,
        model: data.modelVersion ?? model,
        provider: this.name,
        usage,
        latencyMs: Date.now() - startTime,
        finishReason: candidate?.finishReason ?? undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;

      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorMessage =
        (axiosError.response?.data as any)?.error?.message ?? axiosError.message;

      throw new AiProviderError(
        `Gemini API error (${statusCode}): ${errorMessage}`,
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
    return `gemini:${crypto.createHash('sha256').update(hashInput).digest('hex')}`;
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
