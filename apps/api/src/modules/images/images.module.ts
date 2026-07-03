import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { ImagesController } from './images.controller';
import { ImageGeneratorService } from './image-generator.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 60000,
      maxRedirects: 5,
    }),
    DeepSeekModule,
  ],
  controllers: [ImagesController],
  providers: [ImageGeneratorService],
  exports: [ImageGeneratorService],
})
export class ImagesModule {}
