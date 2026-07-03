import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType } from '@prisma/client';

export class CreateCheckoutDto {
  @ApiProperty({
    description: 'The plan to subscribe to',
    enum: PlanType,
    example: PlanType.PROFESSIONAL,
  })
  @IsEnum(PlanType)
  plan: PlanType;

  @ApiPropertyOptional({
    description: 'Organization ID to associate the subscription with',
    example: 'org_abc123',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'Stripe customer ID if resubscribing',
  })
  @IsOptional()
  @IsString()
  stripeCustomerId?: string;

  @ApiPropertyOptional({
    description: 'Success URL after checkout',
    example: 'https://app.autoblog.ai/billing/success',
  })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiPropertyOptional({
    description: 'Cancel URL after checkout',
    example: 'https://app.autoblog.ai/billing/cancel',
  })
  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
