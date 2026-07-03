import { Observable } from 'rxjs';

/**
 * Token usage tracking for AI provider calls.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

/**
 * Options for generating content via an AI provider.
 */
export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
  systemPrompt?: string;
  thinking?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'text' | 'json_object' | 'json_schema';
  jsonSchema?: Record<string, unknown>;
  maxRetries?: number;
  timeout?: number;
  signal?: AbortSignal;
  tags?: Record<string, string>;
  user?: string;
}

/**
 * Result from a content generation request.
 */
export interface ContentResult {
  content: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  latencyMs: number;
  finishReason?: string;
  cached?: boolean;
  thinking?: string;
}

/**
 * A single chunk from a streaming content generation response.
 */
export interface StreamChunk {
  content: string;
  model: string;
  provider: string;
  done: boolean;
  usage?: TokenUsage;
  finishReason?: string;
  thinking?: string;
}

/**
 * A chat message in a conversation.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/**
 * Provider health status information.
 */
export interface ProviderStatus {
  name: string;
  available: boolean;
  models: string[];
  latencyMs: number;
  errorRate: number;
  totalCalls: number;
  successCalls: number;
  lastError?: string;
  lastSuccessAt?: Date;
  configurable: boolean;
}

/**
 * Provider cost breakdown per model.
 */
export interface ProviderCosts {
  inputPerToken: number;
  outputPerToken: number;
  currency: string;
}

/**
 * Core interface that all AI providers must implement.
 *
 * Each provider is responsible for communicating with its respective API,
 * handling authentication, request formatting, response parsing, and
 * error handling.
 */
export interface AiProviderInterface {
  /** Unique provider name identifier (e.g., 'deepseek', 'claude') */
  readonly name: string;

  /**
   * Generate content synchronously from a prompt.
   * Returns the complete generated text along with metadata.
   */
  generateContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Promise<ContentResult>;

  /**
   * Stream content from a prompt as an Observable of chunks.
   * Each chunk represents a partial generation result.
   * The final chunk will have done: true and may include usage info.
   */
  streamContent(
    prompt: string,
    options?: Partial<GenerateOptions>,
  ): Observable<StreamChunk>;

  /**
   * Check if the provider is currently available and operational.
   * Should return false if the API key is missing, the service is down,
   * or rate limits are exceeded.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the list of models available through this provider.
   * May return a configured subset or query the API for available models.
   */
  getModels(): Promise<string[]>;

  /**
   * Get per-model cost information for usage tracking.
   */
  getCosts(model?: string): ProviderCosts;
}

/**
 * Error types for AI provider operations.
 */
export enum AiErrorType {
  AUTHENTICATION = 'authentication_error',
  RATE_LIMIT = 'rate_limit_error',
  TIMEOUT = 'timeout_error',
  INSUFFICIENT_QUOTA = 'insufficient_quota',
  CONTENT_FILTER = 'content_filter',
  MODEL_UNAVAILABLE = 'model_unavailable',
  BAD_REQUEST = 'bad_request',
  SERVER_ERROR = 'server_error',
  CIRCUIT_OPEN = 'circuit_open',
  PROVIDER_UNAVAILABLE = 'provider_unavailable',
  ALL_PROVIDERS_FAILED = 'all_providers_failed',
  UNKNOWN = 'unknown_error',
}

/**
 * Custom error class for AI provider failures.
 */
export class AiProviderError extends Error {
  public readonly type: AiErrorType;
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    type: AiErrorType = AiErrorType.UNKNOWN,
    provider: string = 'unknown',
    statusCode?: number,
    retryable?: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.type = type;
    this.provider = provider;
    this.statusCode = statusCode;

    // Determine retryability based on error type
    if (retryable !== undefined) {
      this.retryable = retryable;
    } else {
      this.retryable = [
        AiErrorType.RATE_LIMIT,
        AiErrorType.TIMEOUT,
        AiErrorType.SERVER_ERROR,
        AiErrorType.CIRCUIT_OPEN,
        AiErrorType.PROVIDER_UNAVAILABLE,
      ].includes(type);
    }
  }
}
