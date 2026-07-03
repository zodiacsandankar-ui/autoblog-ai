import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../database/prisma.service';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check(): Promise<{
    status: string;
    timestamp: string;
    version: string;
    services: Record<string, string>;
  }> {
    const checks: Record<string, string> = {};

    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      checks.database = 'healthy';
    } catch {
      checks.database = 'unhealthy';
    }

    try {
      const redisOk = await this.cacheService.ping();
      checks.redis = redisOk ? 'healthy' : 'unhealthy';
    } catch {
      checks.redis = 'unhealthy';
    }

    const allHealthy = Object.values(checks).every((s) => s === 'healthy');

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services: checks,
    };
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe' })
  async readiness(): Promise<{ status: string }> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      return { status: 'not_ready' };
    }
  }

  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe' })
  liveness(): { status: string } {
    return { status: 'alive' };
  }
}
