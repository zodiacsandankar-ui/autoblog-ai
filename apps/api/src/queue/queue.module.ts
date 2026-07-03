import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'content-generation' },
      { name: 'article-processing' },
      { name: 'publish-articles' },
      { name: 'publish-retry' },
      { name: 'analyze-trends' },
      { name: 'image-generation' },
      { name: 'seo-audit' },
      { name: 'analytics-snapshot' },
      { name: 'webhook-dispatch' },
      { name: 'email-notifications' },
    ),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
