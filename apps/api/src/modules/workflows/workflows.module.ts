import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowEngineService } from './workflow-engine.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    BullModule.registerQueue({
      name: 'workflows',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    }),
    DeepSeekModule,
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WorkflowsModule {}
