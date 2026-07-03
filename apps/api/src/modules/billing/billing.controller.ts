import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  RawBodyRequest,
  Logger,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { BillingService, PLAN_DEFINITIONS } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe checkout session for a plan' })
  @ApiResponse({ status: 201, description: 'Checkout session created' })
  @ApiResponse({ status: 400, description: 'Invalid plan or request' })
  async createCheckout(
    @CurrentUser() user: JwtUser,
    @Body(new ValidationPipe({ transform: true })) dto: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckoutSession(
      user.id,
      dto.plan,
      dto.organizationId,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel subscription at period end' })
  @ApiResponse({ status: 200, description: 'Subscription will cancel at period end' })
  async cancelSubscription(@CurrentUser() user: JwtUser) {
    await this.billingService.cancelSubscription(user.id);
    return { message: 'Subscription will be cancelled at the end of the billing period' };
  }

  @Post('resume')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a cancelled subscription' })
  @ApiResponse({ status: 200, description: 'Subscription resumed' })
  async resumeSubscription(@CurrentUser() user: JwtUser) {
    await this.billingService.resumeSubscription(user.id);
    return { message: 'Subscription has been resumed' };
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change subscription plan (prorated)' })
  @ApiResponse({ status: 200, description: 'Plan changed' })
  async changePlan(
    @CurrentUser() user: JwtUser,
    @Body('plan') plan: string,
  ) {
    await this.billingService.changePlan(user.id, plan as any);
    return { message: `Plan changed to ${plan}` };
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current usage stats for an organization' })
  @ApiResponse({ status: 200, description: 'Usage statistics' })
  async getUsage(
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.billingService.getUsage(organizationId);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get billing history / past invoices' })
  @ApiResponse({ status: 200, description: 'Billing history list' })
  async getBillingHistory(
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.billingService.getBillingHistory(organizationId);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List all available plans with pricing and limits' })
  @ApiResponse({ status: 200, description: 'Plan definitions' })
  async getPlans() {
    return Object.values(PLAN_DEFINITIONS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      limits: plan.limits,
    }));
  }

  @Get('invoice')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a PDF invoice for a given month' })
  @ApiResponse({ status: 200, description: 'Invoice data (JSON stream)' })
  async generateInvoice(
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('month') month: string,
  ) {
    const invoice = await this.billingService.generateInvoice(
      organizationId,
      month,
    );
    return {
      data: JSON.parse(invoice.toString('utf-8')),
    };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      this.logger.warn('Webhook received without stripe-signature header');
      return { received: true };
    }

    const webhookSecret = this.configService.get<string>(
      'stripe.webhookSecret',
    );

    if (!webhookSecret) {
      this.logger.warn('Stripe webhook secret not configured');
      return { received: true };
    }

    try {
      // We reconstruct the Stripe event from the raw body
      const Stripe = require('stripe');
      const stripe = new Stripe(this.configService.get<string>('stripe.secretKey'), {
        apiVersion: '2025-03-31',
      });

      const event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        webhookSecret,
      );

      await this.billingService.handleWebhook(event);
      return { received: true };
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw err;
    }
  }
}
