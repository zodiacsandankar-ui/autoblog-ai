import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrometheusService } from '../metrics/prometheus.service';

@Controller('metrics')
@ApiTags('Metrics')
export class MetricsController {
  constructor(private readonly prometheusService: PrometheusService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async getMetrics(): Promise<string> {
    return this.prometheusService.getMetrics();
  }
}
