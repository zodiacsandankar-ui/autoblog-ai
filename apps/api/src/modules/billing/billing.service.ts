import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { PlanType, SubscriptionStatus } from '@prisma/client';
import * as Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------
export interface PlanLimits {
  articlesPerMonth: number;
  projects: number;
  users: number;
  websites: number;
  customDomains: boolean;
  apiAccess: boolean;
  analytics: boolean;
  prioritySupport: boolean;
  whiteLabel: boolean;
  [key: string]: number | boolean;
}

export interface PlanDefinition {
  id: PlanType;
  name: string;
  price: number;
  priceId: string;
  limits: PlanLimits;
}

export const PLAN_DEFINITIONS: Record<PlanType, PlanDefinition> = {
  [PlanType.FREE]: {
    id: PlanType.FREE,
    name: 'Free',
    price: 0,
    priceId: 'price_free',
    limits: {
      articlesPerMonth: 5,
      projects: 1,
      users: 1,
      websites: 1,
      customDomains: false,
      apiAccess: false,
      analytics: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  [PlanType.STARTER]: {
    id: PlanType.STARTER,
    name: 'Starter',
    price: 29,
    priceId: 'price_starter_29',
    limits: {
      articlesPerMonth: 50,
      projects: 3,
      users: 3,
      websites: 3,
      customDomains: true,
      apiAccess: true,
      analytics: true,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  [PlanType.PROFESSIONAL]: {
    id: PlanType.PROFESSIONAL,
    name: 'Professional',
    price: 99,
    priceId: 'price_pro_99',
    limits: {
      articlesPerMonth: 200,
      projects: 10,
      users: 10,
      websites: 10,
      customDomains: true,
      apiAccess: true,
      analytics: true,
      prioritySupport: true,
      whiteLabel: false,
    },
  },
  [PlanType.BUSINESS]: {
    id: PlanType.BUSINESS,
    name: 'Business',
    price: 299,
    priceId: 'price_business_299',
    limits: {
      articlesPerMonth: 1000,
      projects: 9999,
      users: 25,
      websites: 50,
      customDomains: true,
      apiAccess: true,
      analytics: true,
      prioritySupport: true,
      whiteLabel: true,
    },
  },
  [PlanType.ENTERPRISE]: {
    id: PlanType.ENTERPRISE,
    name: 'Enterprise',
    price: 999,
    priceId: 'price_enterprise_999',
    limits: {
      articlesPerMonth: 99999,
      projects: 99999,
      users: 99999,
      websites: 99999,
      customDomains: true,
      apiAccess: true,
      analytics: true,
      prioritySupport: true,
      whiteLabel: true,
    },
  },
};

// Feature key to plan limit mapping
const FEATURE_LIMIT_MAP: Record<string, string> = {
  articles: 'articlesPerMonth',
  projects: 'projects',
  users: 'users',
  websites: 'websites',
  custom_domains: 'customDomains',
  api_access: 'apiAccess',
  analytics: 'analytics',
  priority_support: 'prioritySupport',
  white_label: 'whiteLabel',
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-03-31' as Stripe.LatestApiVersion,
      });
    } else {
      this.logger.warn(
        'Stripe secret key not configured. Payment features will be unavailable.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Checkout
  // -----------------------------------------------------------------------

  async createCheckoutSession(
    userId: string,
    plan: PlanType,
    organizationId?: string,
    successUrl?: string,
    cancelUrl?: string,
  ) {
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not configured');
    }

    const planDef = PLAN_DEFINITIONS[plan];
    if (!planDef) {
      throw new BadRequestException(`Invalid plan: ${plan}`);
    }

    // FREE plan doesn't need a checkout
    if (plan === PlanType.FREE) {
      throw new BadRequestException('Free plan cannot be purchased via checkout');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find or create Stripe customer
    let customerId: string;
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        stripeCustomerId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingSubscription?.stripeCustomerId) {
      customerId = existingSubscription.stripeCustomerId;
    } else {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId,
          organizationId: organizationId || '',
        },
      });
      customerId = customer.id;
    }

    const priceId = this.getPriceId(plan);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        organizationId: organizationId || '',
        plan,
      },
      success_url:
        successUrl || `${this.getAppUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${this.getAppUrl()}/billing/cancel`,
      subscription_data: {
        metadata: {
          userId,
          organizationId: organizationId || '',
          plan,
        },
      },
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  // -----------------------------------------------------------------------
  // Webhook handler
  // -----------------------------------------------------------------------

  async handleWebhook(event: Stripe.Event): Promise<void> {
    this.logger.log(`Processing Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
        );
        break;

      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;

      default:
        this.logger.log(`Unhandled webhook event type: ${event.type}`);
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const organizationId = session.metadata?.organizationId;
    const plan = session.metadata?.plan as PlanType;

    if (!userId || !plan) {
      this.logger.error('Checkout session missing metadata');
      return;
    }

    const subscriptionId = session.subscription as string;
    const customerId = session.customer as string;

    if (!subscriptionId) {
      this.logger.error('No subscription ID in checkout session');
      return;
    }

    // Retrieve full subscription details from Stripe
    const subscription = await this.stripe!.subscriptions.retrieve(subscriptionId);

    const planLimits = PLAN_DEFINITIONS[plan]?.limits || PLAN_DEFINITIONS[PlanType.FREE].limits;

    await this.prisma.subscription.create({
      data: {
        userId,
        organizationId: organizationId || undefined,
        plan,
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId: customerId as string,
        stripeSubscriptionId: subscriptionId,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        usage: {},
        limits: planLimits as Record<string, unknown>,
      },
    });

    // Update organization plan if linked
    if (organizationId) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { plan },
      });
    }

    await this.cache.del(`billing:limits:${organizationId || userId}`);
    this.logger.log(`Subscription created for user=${userId}, plan=${plan}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) {
      this.logger.warn(`No local subscription found for Stripe sub=${subscription.id}`);
      return;
    }

    const status = this.mapStripeStatus(subscription.status);
    const plan = dbSubscription.plan;

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    if (dbSubscription.organizationId && status !== SubscriptionStatus.ACTIVE) {
      await this.prisma.organization.update({
        where: { id: dbSubscription.organizationId },
        data: { plan: PlanType.FREE },
      });
    }

    await this.cache.del(`billing:limits:${dbSubscription.organizationId || dbSubscription.userId}`);
    this.logger.log(`Subscription ${subscription.id} updated to status=${status}`);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) {
      this.logger.warn(`No local subscription found for deleted Stripe sub=${subscription.id}`);
      return;
    }

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
      },
    });

    if (dbSubscription.organizationId) {
      await this.prisma.organization.update({
        where: { id: dbSubscription.organizationId },
        data: { plan: PlanType.FREE },
      });
    }

    await this.cache.del(`billing:limits:${dbSubscription.organizationId || dbSubscription.userId}`);
    this.logger.log(`Subscription ${subscription.id} deleted (expired)`);
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId) return;

    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (!dbSubscription) return;

    // Store invoice as payment record in subscription usage metadata
    const invoiceData = {
      id: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      periodStart: new Date((invoice.period_start as number) * 1000).toISOString(),
      periodEnd: new Date((invoice.period_end as number) * 1000).toISOString(),
      paidAt: new Date().toISOString(),
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      invoicePdf: invoice.invoice_pdf,
    };

    const existingUsage = (dbSubscription.usage as Record<string, unknown>) || {};
    const invoices = (existingUsage.invoices as Record<string, unknown>[]) || [];
    invoices.push(invoiceData);

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        usage: { ...existingUsage, invoices },
      },
    });

    this.logger.log(`Invoice ${invoice.id} payment succeeded for sub=${subscriptionId}`);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId) return;

    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (!dbSubscription) return;

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    this.logger.warn(
      `Invoice payment failed for sub=${subscriptionId}, invoice=${invoice.id}`,
    );
  }

  // -----------------------------------------------------------------------
  // Subscription management
  // -----------------------------------------------------------------------

  async cancelSubscription(userId: string): Promise<void> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not configured');
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException('No Stripe subscription to cancel');
    }

    // Cancel at period end
    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });

    await this.cache.del(
      `billing:limits:${subscription.organizationId || subscription.userId}`,
    );
    this.logger.log(`Subscription ${subscription.id} set to cancel at period end`);
  }

  async resumeSubscription(userId: string): Promise<void> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not configured');
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        cancelAtPeriodEnd: true,
        status: SubscriptionStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No cancelled subscription found to resume');
    }

    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException('No Stripe subscription to resume');
    }

    // Remove cancel_at_period_end
    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false },
    });

    await this.cache.del(
      `billing:limits:${subscription.organizationId || subscription.userId}`,
    );
    this.logger.log(`Subscription ${subscription.id} resumed`);
  }

  async changePlan(
    userId: string,
    newPlan: PlanType,
  ): Promise<void> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not configured');
    }

    if (newPlan === PlanType.FREE) {
      throw new BadRequestException(
        'Cannot change to FREE plan via this endpoint. Cancel your subscription instead.',
      );
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    const newPriceId = this.getPriceId(newPlan);

    // Update the subscription item to the new price
    const stripeSub = await this.stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId!,
    );

    const subscriptionItemId = stripeSub.items.data[0]?.id;
    if (!subscriptionItemId) {
      throw new InternalServerErrorException('No subscription item found');
    }

    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId!, {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });

    const planLimits = PLAN_DEFINITIONS[newPlan]?.limits || PLAN_DEFINITIONS[PlanType.FREE].limits;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: newPlan,
        limits: planLimits as Record<string, unknown>,
      },
    });

    if (subscription.organizationId) {
      await this.prisma.organization.update({
        where: { id: subscription.organizationId },
        data: { plan: newPlan },
      });
    }

    await this.cache.del(
      `billing:limits:${subscription.organizationId || subscription.userId}`,
    );
    this.logger.log(`Subscription ${subscription.id} changed to plan=${newPlan}`);
  }

  // -----------------------------------------------------------------------
  // Usage and limits
  // -----------------------------------------------------------------------

  async getUsage(organizationId: string) {
    const cacheKey = `billing:usage:${organizationId}`;
    const cached = await this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const planDef = await this.getOrgPlan(organizationId);

    // Count current usage
    const [
      articleCount,
      projectCount,
      memberCount,
      websiteCount,
    ] = await Promise.all([
      this.prisma.article.count({
        where: {
          project: { organizationId },
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      this.prisma.project.count({
        where: { organizationId, status: { not: 'ARCHIVED' } },
      }),
      this.prisma.organizationMember.count({
        where: { organizationId },
      }),
      this.prisma.website.count({
        where: { project: { organizationId } },
      }),
    ]);

    const usage = {
      articles: articleCount,
      projects: projectCount,
      users: memberCount,
      websites: websiteCount,
      plan: planDef,
      limits: planDef.limits,
      percentages: {
        articles:
          planDef.limits.articlesPerMonth === 99999
            ? 0
            : Math.round((articleCount / planDef.limits.articlesPerMonth) * 100),
        projects:
          planDef.limits.projects === 99999
            ? 0
            : Math.round((projectCount / planDef.limits.projects) * 100),
        users:
          planDef.limits.users === 99999
            ? 0
            : Math.round((memberCount / planDef.limits.users) * 100),
        websites:
          planDef.limits.websites === 99999
            ? 0
            : Math.round((websiteCount / planDef.limits.websites) * 100),
      },
    };

    await this.cache.set(cacheKey, usage, 300); // 5 min cache
    return usage;
  }

  async checkLimits(organizationId: string, feature: string): Promise<void> {
    const limitKey = FEATURE_LIMIT_MAP[feature];
    if (!limitKey) {
      // Unknown feature - allow by default
      return;
    }

    const cacheKey = `billing:limits:${organizationId}`;
    const cached = await this.cache.get<{ allowed: boolean }>(cacheKey);
    if (cached) {
      if (!cached.allowed) {
        throw new ForbiddenException(
          `Plan limit exceeded for feature: ${feature}. Please upgrade your plan.`,
        );
      }
      return;
    }

    const planDef = await this.getOrgPlan(organizationId);
    const limitValue = planDef.limits[limitKey];

    // If limit is 99999 (unlimited), allow
    if (limitValue === 99999 || limitValue === true) {
      await this.cache.set(cacheKey, { allowed: true }, 60);
      return;
    }

    if (typeof limitValue === 'boolean' && !limitValue) {
      await this.cache.set(cacheKey, { allowed: false }, 60);
      throw new ForbiddenException(
        `Your plan does not support: ${feature}. Please upgrade.`,
      );
    }

    // Count current usage
    const count = await this.getCurrentCount(organizationId, feature);
    if (count >= (limitValue as number)) {
      await this.cache.set(cacheKey, { allowed: false }, 60);
      throw new ForbiddenException(
        `Plan limit exceeded for ${feature} (${count}/${limitValue}). Please upgrade your plan.`,
      );
    }

    await this.cache.set(cacheKey, { allowed: true }, 60);
  }

  // -----------------------------------------------------------------------
  // Invoices / Billing History
  // -----------------------------------------------------------------------

  async generateInvoice(organizationId: string, month: string): Promise<Buffer> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const planDef = PLAN_DEFINITIONS[subscription.plan];
    const invoices = ((subscription.usage as Record<string, unknown>)?.invoices as Record<string, unknown>[]) || [];

    // Filter invoices for the given month
    const monthInvoices = invoices.filter((inv) => {
      const invDate = new Date(inv.paidAt as string);
      const invMonth = `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}`;
      return invMonth === month;
    });

    const totalAmount = monthInvoices.reduce(
      (sum, inv) => sum + ((inv.amount as number) || 0),
      0,
    );

    // Simple PDF-like invoice as a structured JSON (can be enhanced with PDFKit later)
    const invoiceData = {
      invoiceNumber: `INV-${org.slug}-${month}`,
      organization: org.name,
      plan: planDef.name,
      billingPeriod: month,
      items: monthInvoices.map((inv) => ({
        description: `Subscription - ${planDef.name} Plan`,
        amount: inv.amount as number,
        currency: inv.currency as string,
        date: inv.paidAt as string,
        invoiceUrl: inv.hostedInvoiceUrl as string,
      })),
      total: totalAmount,
      generatedAt: new Date().toISOString(),
    };

    // Return as buffer (in production use PDFKit or similar)
    const content = JSON.stringify(invoiceData, null, 2);
    return Buffer.from(content, 'utf-8');
  }

  async getBillingHistory(organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return [];
    }

    const invoices = ((subscription.usage as Record<string, unknown>)?.invoices as Record<string, unknown>[]) || [];

    return invoices
      .map((inv: Record<string, unknown>) => ({
        id: inv.id as string,
        amount: inv.amount as number,
        currency: inv.currency as string,
        status: inv.status as string,
        periodStart: inv.periodStart as string,
        periodEnd: inv.periodEnd as string,
        paidAt: inv.paidAt as string,
        hostedInvoiceUrl: inv.hostedInvoiceUrl as string,
        invoicePdf: inv.invoicePdf as string,
      }))
      .sort(
        (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
      );
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async getOrgPlan(organizationId: string): Promise<PlanDefinition> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return PLAN_DEFINITIONS[org.plan] || PLAN_DEFINITIONS[PlanType.FREE];
  }

  private async getCurrentCount(
    organizationId: string,
    feature: string,
  ): Promise<number> {
    switch (feature) {
      case 'articles':
        return this.prisma.article.count({
          where: {
            project: { organizationId },
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        });
      case 'projects':
        return this.prisma.project.count({
          where: { organizationId, status: { not: 'ARCHIVED' } },
        });
      case 'users':
        return this.prisma.organizationMember.count({
          where: { organizationId },
        });
      case 'websites':
        return this.prisma.website.count({
          where: { project: { organizationId } },
        });
      default:
        return 0;
    }
  }

  private getPriceId(plan: PlanType): string {
    const configPriceId = this.configService.get<string>(
      `stripe.prices.${plan.toLowerCase()}`,
    );
    if (configPriceId) return configPriceId;

    // Fallback to plan definition price ID
    return PLAN_DEFINITIONS[plan]?.priceId || `price_${plan.toLowerCase()}`;
  }

  private getAppUrl(): string {
    return this.configService.get<string>('APP_URL', 'https://app.autoblog.ai');
  }

  private mapStripeStatus(
    stripeStatus: Stripe.Subscription.Status,
  ): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return stripeStatus === 'trialing'
          ? SubscriptionStatus.TRIALING
          : SubscriptionStatus.ACTIVE;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
        return SubscriptionStatus.CANCELLED;
      case 'unpaid':
        return SubscriptionStatus.PAST_DUE;
      case 'incomplete':
      case 'incomplete_expired':
        return SubscriptionStatus.EXPIRED;
      default:
        return SubscriptionStatus.EXPIRED;
    }
  }
}
