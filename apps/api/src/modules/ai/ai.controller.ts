import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Sse,
  MessageEvent,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, from, map } from 'rxjs';
import { AiService } from './ai.service';
import {
  GenerateOptions,
  ContentResult,
  ProviderStatus,
  AiProviderError,
  AiErrorType,
} from './ai-provider.interface';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class GenerateContentDto {
  /** The text prompt to send to the AI provider */
  prompt: string;

  /** Generation options */
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
    systemPrompt?: string;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high';
    responseFormat?: 'text' | 'json_object';
    timeout?: number;
    tags?: Record<string, string>;
  };

  /** Preferred provider to use */
  preferredProvider?: string;

  /** Task type for automatic provider mapping */
  task?: string;
}

class UpdateProviderConfigDto {
  /** New base URL for the provider */
  baseUrl?: string;

  /** New API key for the provider */
  apiKey?: string;

  /** Default model to use */
  defaultModel?: string;

  /** Available models list */
  models?: string[];

  /** Request timeout in milliseconds */
  timeout?: number;

  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

class ProviderInfo {
  name: string;
  available: boolean;
  models: string[];
  latencyMs: number;
  errorRate: number;
  totalCalls: number;
  successCalls: number;
  configurable: boolean;
}

class UsageStatsDto {
  /** Total token usage across all providers */
  totalTokens: number;

  /** Estimated total cost in USD */
  estimatedCostUsd: number;

  /** Per-provider breakdown */
  byProvider: Record<
    string,
    {
      totalCalls: number;
      successCalls: number;
      errorCalls: number;
      totalTokens: number;
      estimatedCostUsd: number;
      averageLatencyMs: number;
    }
  >;

  /** Usage period */
  period: {
    start: Date;
    end: Date;
  };
}

class GenerateContentResponse {
  content: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  quality?: {
    overall: number;
    relevance: number;
    coherence: number;
    completeness: number;
    instructionFollowing: number;
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  // -----------------------------------------------------------------------
  // Generate content
  // -----------------------------------------------------------------------

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate content using AI',
    description:
      'Generates content using the configured AI providers with automatic fallback. ' +
      'DeepSeek is the primary provider. Supports all generation options including ' +
      'temperature, token limits, JSON mode, streaming, and task-based provider routing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Content generated successfully',
    type: GenerateContentResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 502, description: 'All AI providers failed' })
  async generateContent(
    @Body() dto: GenerateContentDto,
  ): Promise<GenerateContentResponse> {
    if (!dto.prompt || dto.prompt.trim().length === 0) {
      throw new HttpException(
        'Prompt is required and cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `Content generation request (task: ${dto.task ?? 'custom'}, preferred: ${dto.preferredProvider ?? 'none'})`,
    );

    const options: Partial<GenerateOptions> = {
      ...dto.options,
      tags: {
        ...dto.options?.tags,
        ...(dto.task ? { task: dto.task } : {}),
      },
    };

    try {
      const result = await this.aiService.generateContent(
        dto.prompt,
        options,
        dto.preferredProvider,
      );

      this.logger.log(
        `Content generated: provider=${result.provider}, model=${result.model}, tokens=${result.usage.totalTokens}, latency=${result.latencyMs}ms`,
      );

      const response: GenerateContentResponse = {
        content: result.content,
        model: result.model,
        provider: result.provider,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
        latencyMs: result.latencyMs,
      };

      // Include quality scores if available
      if ((result as any).__quality) {
        response.quality = (result as any).__quality;
      }

      return response;
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message: error.message,
            error: error.type,
            provider: error.provider,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.error(
        `Content generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Content generation failed',
          error: (error as Error).message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Stream content via SSE
  // -----------------------------------------------------------------------

  @Post('generate/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream content generation via SSE',
    description:
      'Streams generated content using Server-Sent Events. ' +
      'Returns an SSE stream of content chunks as they are generated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stream of content chunks',
  })
  @Sse()
  streamContent(@Body() dto: GenerateContentDto): Observable<MessageEvent> {
    if (!dto.prompt || dto.prompt.trim().length === 0) {
      throw new HttpException(
        'Prompt is required and cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    const options: Partial<GenerateOptions> = {
      ...dto.options,
      stream: true,
      tags: {
        ...dto.options?.tags,
        ...(dto.task ? { task: dto.task } : {}),
      },
    };

    this.logger.log(
      `Stream content request (task: ${dto.task ?? 'custom'})`,
    );

    return this.aiService.streamContent(
      dto.prompt,
      options,
      dto.preferredProvider,
    ).pipe(
      map((chunk) => {
        const event: MessageEvent = {
          data: JSON.stringify({
            content: chunk.content,
            provider: chunk.provider,
            model: chunk.model,
            done: chunk.done,
            ...(chunk.usage
              ? {
                  usage: {
                    promptTokens: chunk.usage.promptTokens,
                    completionTokens: chunk.usage.completionTokens,
                    totalTokens: chunk.usage.totalTokens,
                  },
                }
              : {}),
            ...(chunk.finishReason
              ? { finishReason: chunk.finishReason }
              : {}),
            ...(chunk.thinking ? { thinking: chunk.thinking } : {}),
          }),
          type: chunk.done ? 'complete' : 'chunk',
          id: chunk.done ? 'done' : undefined,
        };
        return event;
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Provider management
  // -----------------------------------------------------------------------

  @Get('providers')
  @ApiOperation({
    summary: 'List available AI providers with status',
    description:
      'Returns status information for all registered AI providers, ' +
      'including availability, models, latency, and error rates.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of provider statuses',
    type: [ProviderInfo],
  })
  async getProviders(): Promise<ProviderInfo[]> {
    try {
      const statuses = await this.aiService.getProvidersStatus();
      return statuses.map((status) => ({
        name: status.name,
        available: status.available,
        models: status.models,
        latencyMs: status.latencyMs,
        errorRate: status.errorRate,
        totalCalls: status.totalCalls,
        successCalls: status.successCalls,
        configurable: status.configurable,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get provider status: ${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to retrieve provider status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('providers/:name/config')
  @ApiOperation({
    summary: 'Update provider configuration',
    description:
      'Updates runtime configuration for a configurable provider ' +
      '(ollama, custom-api). Supports updating base URL, API key, models, and headers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Provider configuration updated',
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @ApiResponse({ status: 400, description: 'Provider is not configurable' })
  async updateProviderConfig(
    @Param('name') providerName: string,
    @Body() config: UpdateProviderConfigDto,
  ): Promise<{ message: string; provider: string }> {
    try {
      await this.aiService.updateProviderConfig(providerName, config);
      return {
        message: `Provider "${providerName}" configuration updated successfully`,
        provider: providerName,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      this.logger.error(
        `Failed to update provider config: ${(error as Error).message}`,
      );
      throw new HttpException(
        `Failed to update provider configuration: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Usage tracking
  // -----------------------------------------------------------------------

  @Get('usage')
  @ApiOperation({
    summary: 'Get token usage statistics',
    description:
      'Returns aggregated token usage and cost statistics across all AI providers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Usage statistics',
    type: UsageStatsDto,
  })
  getUsage(): UsageStatsDto {
    try {
      return this.aiService.getUsageStats();
    } catch (error) {
      this.logger.error(
        `Failed to get usage stats: ${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to retrieve usage statistics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
