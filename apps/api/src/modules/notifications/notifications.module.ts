import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationTemplatesService } from './notification-templates.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplatesService],
  exports: [NotificationsService, NotificationTemplatesService],
})
export class NotificationsModule {}
