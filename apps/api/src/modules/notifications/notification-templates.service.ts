import { Injectable } from '@nestjs/common';

export interface NotificationTemplate {
  type: string;
  title: string;
  buildTitle: (data: Record<string, unknown>) => string;
  buildMessage: (data: Record<string, unknown>) => string;
  buildEmailSubject: (data: Record<string, unknown>) => string;
  buildEmailHtml: (data: Record<string, unknown>) => string;
}

@Injectable()
export class NotificationTemplatesService {
  private readonly templates = new Map<string, NotificationTemplate>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      type: 'article_published',
      title: 'Article Published',
      buildTitle: () => 'Article Published Successfully',
      buildMessage: (data) =>
        `Your article "${data.title || 'Untitled'}" has been published on ${data.platform || 'your website'}.`,
      buildEmailSubject: (data) =>
        `Published: ${data.title || 'Article'} — AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>Article Published</h2>
        <p>Your article <strong>${data.title || 'Untitled'}</strong> has been published successfully.</p>
        ${data.url ? `<p>View it here: <a href="${data.url}">${data.url}</a></p>` : ''}
        <p>Platform: ${data.platform || 'Website'}</p>
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'article_failed',
      title: 'Article Generation Failed',
      buildTitle: () => 'Article Generation Failed',
      buildMessage: (data) =>
        `Article "${data.title || 'Untitled'}" failed to generate. Reason: ${data.reason || 'Unknown error'}.`,
      buildEmailSubject: (data) =>
        `Failed: ${data.title || 'Article'} — AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>Article Generation Failed</h2>
        <p>The article <strong>${data.title || 'Untitled'}</strong> could not be generated.</p>
        <p><strong>Reason:</strong> ${data.reason || 'Unknown error'}</p>
        ${data.error ? `<pre style="background:#f5f5f5;padding:10px;border-radius:4px;">${data.error}</pre>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'trend_alert',
      title: 'Trend Alert',
      buildTitle: (data) => `Trend Alert: ${data.topic || 'New Trend'}`,
      buildMessage: (data) =>
        `A new trending topic "${data.topic}" has been detected with a score of ${data.score || 'N/A'}.`,
      buildEmailSubject: (data) =>
        `Trend Alert: ${data.topic || 'New Trend'} — AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>Trend Alert</h2>
        <p>A new trending topic has been discovered:</p>
        <h3>${data.topic}</h3>
        <p><strong>Score:</strong> ${data.score || 'N/A'}</p>
        ${data.summary ? `<p>${data.summary}</p>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'keyword_opportunity',
      title: 'Keyword Opportunity',
      buildTitle: () => 'New Keyword Opportunity Found',
      buildMessage: (data) =>
        `New keyword opportunity: "${data.keyword}" (difficulty: ${data.difficulty || 'N/A'}, volume: ${data.volume || 'N/A'}).`,
      buildEmailSubject: () => 'Keyword Opportunity Found — AutoBlog AI',
      buildEmailHtml: (data) => `
        <h2>Keyword Opportunity</h2>
        <p>A new keyword opportunity has been identified:</p>
        <p><strong>Keyword:</strong> ${data.keyword}</p>
        <p><strong>Difficulty:</strong> ${data.difficulty || 'N/A'}</p>
        <p><strong>Search Volume:</strong> ${data.volume || 'N/A'}</p>
        ${data.opportunityScore ? `<p><strong>Opportunity Score:</strong> ${data.opportunityScore}</p>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'billing_invoice',
      title: 'New Invoice Available',
      buildTitle: () => 'New Invoice Available',
      buildMessage: (data) =>
        `A new invoice for $${(data.amount || 0).toFixed(2)} is available for your ${data.plan || 'subscription'} plan.`,
      buildEmailSubject: () =>
        'Your AutoBlog AI Invoice is Ready',
      buildEmailHtml: (data) => `
        <h2>Invoice Available</h2>
        <p>Your latest invoice is ready:</p>
        <p><strong>Amount:</strong> $${(data.amount || 0).toFixed(2)}</p>
        <p><strong>Plan:</strong> ${data.plan || 'N/A'}</p>
        <p><strong>Period:</strong> ${data.periodStart || 'N/A'} — ${data.periodEnd || 'N/A'}</p>
        ${data.invoiceUrl ? `<p><a href="${data.invoiceUrl}">View Invoice</a></p>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'team_invite',
      title: 'Team Invitation',
      buildTitle: () => 'You\'ve Been Invited to a Team',
      buildMessage: (data) =>
        `You've been invited to join "${data.organization || 'an organization'}" as ${data.role || 'member'}.`,
      buildEmailSubject: (data) =>
        `Join ${data.organization || 'a team'} on AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>Team Invitation</h2>
        <p>You have been invited to join <strong>${data.organization}</strong> on AutoBlog AI.</p>
        <p><strong>Role:</strong> ${data.role || 'Member'}</p>
        ${data.invitedBy ? `<p>Invited by: ${data.invitedBy}</p>` : ''}
        ${data.inviteUrl ? `<p><a href="${data.inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'workflow_complete',
      title: 'Workflow Complete',
      buildTitle: (data) =>
        `Workflow "${data.workflowName || 'Untitled'}" Complete`,
      buildMessage: (data) =>
        `Workflow "${data.workflowName || 'Untitled'}" completed successfully. ${data.articlesGenerated ? `${data.articlesGenerated} articles generated.` : ''}`,
      buildEmailSubject: (data) =>
        `Workflow Complete: ${data.workflowName || 'Untitled'} — AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>Workflow Complete</h2>
        <p>Workflow <strong>${data.workflowName || 'Untitled'}</strong> has completed successfully.</p>
        ${data.articlesGenerated ? `<p>Articles generated: ${data.articlesGenerated}</p>` : ''}
        ${data.duration ? `<p>Duration: ${data.duration}</p>` : ''}
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });

    this.register({
      type: 'error_alert',
      title: 'System Error Alert',
      buildTitle: () => 'System Error Alert',
      buildMessage: (data) =>
        `Error in ${data.service || 'system'}: ${data.message || 'An unexpected error occurred'}.`,
      buildEmailSubject: (data) =>
        `[Alert] ${data.service || 'System'} Error — AutoBlog AI`,
      buildEmailHtml: (data) => `
        <h2>System Error Alert</h2>
        <p><strong>Service:</strong> ${data.service || 'Unknown'}</p>
        <p><strong>Error:</strong> ${data.message || 'An unexpected error occurred'}</p>
        ${data.details ? `<pre style="background:#f5f5f5;padding:10px;border-radius:4px;">${data.details}</pre>` : ''}
        <p><strong>Severity:</strong> ${data.severity || 'medium'}</p>
        <hr>
        <p style="color:#666;">— AutoBlog AI</p>
      `,
    });
  }

  register(template: NotificationTemplate): void {
    this.templates.set(template.type, template);
  }

  get(type: string): NotificationTemplate | undefined {
    return this.templates.get(type);
  }

  getAll(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  buildTitle(type: string, data: Record<string, unknown>): string {
    const template = this.templates.get(type);
    if (!template) return 'Notification';
    return template.buildTitle(data);
  }

  buildMessage(type: string, data: Record<string, unknown>): string {
    const template = this.templates.get(type);
    if (!template) return 'You have a new notification.';
    return template.buildMessage(data);
  }

  buildEmailSubject(type: string, data: Record<string, unknown>): string {
    const template = this.templates.get(type);
    if (!template) return 'AutoBlog AI Notification';
    return template.buildEmailSubject(data);
  }

  buildEmailHtml(type: string, data: Record<string, unknown>): string {
    const template = this.templates.get(type);
    if (!template) return '<p>You have a new notification.</p>';
    return template.buildEmailHtml(data);
  }
}
