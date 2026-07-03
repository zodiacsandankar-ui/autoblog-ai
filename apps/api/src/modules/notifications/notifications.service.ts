import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { NotificationTemplatesService } from './notification-templates.service';
import { Notification } from '@prisma/client';

export interface SendNotificationOptions {
  userId: string;
  type: string;
  title?: string;
  message?: string;
  data?: Record<string, unknown>;
  channels?: {
    email?: boolean;
    slack?: boolean;
    discord?: boolean;
    teams?: boolean;
    telegram?: boolean;
    sms?: boolean;
  };
  email?: {
    to?: string;
    subject?: string;
  };
  slack?: {
    webhookUrl: string;
  };
  discord?: {
    webhookUrl: string;
  };
  teams?: {
    webhookUrl: string;
  };
  telegram?: {
    chatId: string;
  };
  sms?: {
    to: string;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly templates: NotificationTemplatesService,
  ) {}

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  async send(options: SendNotificationOptions): Promise<Notification> {
    const { userId, type, data, channels } = options;

    const title = options.title || this.templates.buildTitle(type, data || {});
    const message =
      options.message || this.templates.buildMessage(type, data || {});

    // Store in database
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: (data || {}) as Record<string, unknown>,
      },
    });

    this.logger.log(`Notification created: ${type} for user=${userId}`);

    // Send via requested channels
    if (!channels || Object.keys(channels).length === 0) {
      // Default: just in-app notification (already saved)
      return notification;
    }

    const promises: Promise<void>[] = [];

    if (channels.email) {
      const emailTo =
        options.email?.to || (await this.getUserEmail(userId));
      const subject =
        options.email?.subject ||
        this.templates.buildEmailSubject(type, data || {});
      const html = this.templates.buildEmailHtml(type, data || {});
      promises.push(this.sendEmail(emailTo, subject, html));
    }

    if (channels.slack && options.slack?.webhookUrl) {
      promises.push(this.sendSlack(options.slack.webhookUrl, message));
    }

    if (channels.discord && options.discord?.webhookUrl) {
      promises.push(this.sendDiscord(options.discord.webhookUrl, message));
    }

    if (channels.teams && options.teams?.webhookUrl) {
      promises.push(this.sendTeams(options.teams.webhookUrl, message));
    }

    if (channels.telegram && options.telegram?.chatId) {
      promises.push(
        this.sendTelegram(options.telegram.chatId, message),
      );
    }

    if (channels.sms && options.sms?.to) {
      promises.push(this.sendSMS(options.sms.to, message));
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    return notification;
  }

  // -----------------------------------------------------------------------
  // Channel senders
  // -----------------------------------------------------------------------

  async sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const provider = this.configService.get<string>('email.provider', 'sendgrid');

    try {
      switch (provider) {
        case 'sendgrid':
          await this.sendViaSendGrid(to, subject, html);
          break;
        case 'mailgun':
          await this.sendViaMailgun(to, subject, html);
          break;
        case 'ses':
          await this.sendViaSES(to, subject, html);
          break;
        default:
          this.logger.warn(`Unknown email provider: ${provider}. Skipping email.`);
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);
    }
  }

  async sendSlack(webhookUrl: string, message: string): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });

      if (!response.ok) {
        this.logger.error(`Slack webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Slack send error: ${error.message}`);
    }
  }

  async sendDiscord(webhookUrl: string, message: string): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          allowed_mentions: { parse: [] },
        }),
      });

      if (!response.ok) {
        this.logger.error(`Discord webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Discord send error: ${error.message}`);
    }
  }

  async sendTeams(webhookUrl: string, message: string): Promise<void> {
    try {
      const payload = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: 'AutoBlog AI Notification',
        title: 'Notification',
        text: message,
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.error(`Teams webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Teams send error: ${error.message}`);
    }
  }

  async sendTelegram(chatId: string, message: string): Promise<void> {
    const botToken = this.configService.get<string>('telegram.botToken');
    if (!botToken) {
      this.logger.warn('Telegram bot token not configured');
      return;
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`Telegram send failed: ${err}`);
      }
    } catch (error) {
      this.logger.error(`Telegram send error: ${error.message}`);
    }
  }

  async sendSMS(to: string, message: string): Promise<void> {
    const accountSid = this.configService.get<string>('twilio.accountSid');
    const authToken = this.configService.get<string>('twilio.authToken');
    const fromNumber = this.configService.get<string>('twilio.fromNumber');

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.warn('Twilio not configured. Skipping SMS.');
      return;
    }

    try {
      const encoded = new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: message,
      });

      const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString(
        'base64',
      );

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
          body: encoded.toString(),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`Twilio SMS failed: ${err}`);
      }
    } catch (error) {
      this.logger.error(`SMS send error: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Notification management
  // -----------------------------------------------------------------------

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async getUnread(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getNotifications(
    userId: string,
    pagination: { page?: number; limit?: number; unreadOnly?: boolean },
  ): Promise<{ data: Notification[]; total: number; page: number; limit: number }> {
    const page = pagination.page || 1;
    const limit = Math.min(pagination.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId };
    if (pagination.unreadOnly) {
      where.isRead = false;
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({
        where: where as any,
      }),
    ]);

    return { data, total, page, limit };
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  async notifyTeam(
    projectId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        organization: {
          include: {
            members: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const members = project.organization.members;

    await Promise.allSettled(
      members.map((member) =>
        this.send({
          userId: member.userId,
          type,
          data,
        }),
      ),
    );

    this.logger.log(
      `Team notification sent: type=${type}, project=${projectId}, members=${members.length}`,
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async getUserEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email || '';
  }

  private async sendViaSendGrid(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const apiKey = this.configService.get<string>('email.sendgrid.apiKey');
    if (!apiKey) {
      this.logger.warn('SendGrid API key not configured');
      return;
    }

    const from = this.configService.get<string>('email.from', 'noreply@autoblog.ai');

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`SendGrid error: ${err}`);
    }
  }

  private async sendViaMailgun(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const apiKey = this.configService.get<string>('email.mailgun.apiKey');
    const domain = this.configService.get<string>('email.mailgun.domain');
    const from = this.configService.get<string>('email.from', 'noreply@autoblog.ai');

    if (!apiKey || !domain) {
      this.logger.warn('Mailgun not configured');
      return;
    }

    const formData = new URLSearchParams({
      from,
      to,
      subject,
      html,
    });

    const response = await fetch(
      `https://api.mailgun.net/v3/${domain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Mailgun error: ${err}`);
    }
  }

  private async sendViaSES(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const region = this.configService.get<string>('email.ses.region', 'us-east-1');
    const from = this.configService.get<string>('email.from', 'noreply@autoblog.ai');

    this.logger.log(
      `SES email would be sent to ${to} with subject "${subject}" (region: ${region}, from: ${from})`,
    );
    this.logger.debug(
      `SES payload: to=${to}, subject=${subject}, from=${from}, region=${region}`,
    );
  }
}
