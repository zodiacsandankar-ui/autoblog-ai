import {
  Module,
  Global,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { DeepSeekService } from './providers/deepseek.service';
import { ClaudeService } from './providers/claude.service';
import { OpenAiService } from './providers/openai.service';
import { GeminiService } from './providers/gemini.service';
import { MistralService } from './providers/mistral.service';
import { GroqService } from './providers/groq.service';
import { OpenRouterService } from './providers/openrouter.service';
import { OllamaService } from './providers/ollama.service';
import { CustomApiService } from './providers/custom-api.service';
import { APP_CONFIG_TOKEN } from '../../config/app-config.constants';
import type { AppConfig } from '../../config/app-config.interface';

/**
 * AI Module - Core module for AI provider integration and content generation.
 *
 * Provides a unified interface to multiple AI providers (DeepSeek, Claude,
 * OpenAI, Gemini, Mistral, Groq, OpenRouter, Ollama, Custom API) with
 * intelligent fallback, circuit breaker, retry logic, caching,
 * streaming, and usage tracking.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        timeout: configService.get<number>('ai.httpTimeout', 60000),
        maxRedirects: 5,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    }),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ttl: configService.get<number>('ai.cacheTtl', 300), // 5 minutes default
        max: configService.get<number>('ai.cacheMaxItems', 1000),
        isGlobal: true,
      }),
    }),
    ConfigModule,
  ],
  controllers: [AiController],
  providers: [
    // Core services
    AiService,
    AiOrchestratorService,

    // AI Provider services
    DeepSeekService,
    ClaudeService,
    OpenAiService,
    GeminiService,
    MistralService,
    GroqService,
    OpenRouterService,
    OllamaService,
    CustomApiService,
  ],
  exports: [
    AiService,
    AiOrchestratorService,
    DeepSeekService,
    ClaudeService,
    OpenAiService,
    GeminiService,
    MistralService,
    GroqService,
    OpenRouterService,
    OllamaService,
    CustomApiService,
  ],
})
export class AiModule implements OnModuleInit {
  private readonly logger = new Logger(AiModule.name);

  constructor(
    private readonly orchestrator: AiOrchestratorService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing AI Module...');

    const defaultProvider = this.configService.get<string>(
      'ai.defaultProvider',
      'deepseek',
    );
    const providersEnabled = this.configService.get<string[]>(
      'ai.providersEnabled',
      [
        'deepseek',
        'claude',
        'openai',
        'gemini',
        'mistral',
        'groq',
        'openrouter',
        'ollama',
      ],
    );

    this.logger.log(`Default provider: ${defaultProvider}`);
    this.logger.log(`Enabled providers: ${providersEnabled.join(', ')}`);

    // Perform health check on all providers during initialization
    try {
      await this.orchestrator.checkAllProvidersHealth();
      this.logger.log('AI provider health check complete');
    } catch (error) {
      this.logger.warn(
        `Provider health check encountered errors: ${(error as Error).message}`,
      );
    }

    this.logger.log('AI Module initialization complete');
  }
}
