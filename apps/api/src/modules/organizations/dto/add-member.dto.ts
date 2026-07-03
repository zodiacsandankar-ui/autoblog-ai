import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ description: 'User ID to add to the organization' })
  @IsString()
  userId: string;

  @ApiProperty({ enum: OrgRole, default: OrgRole.MEMBER })
  @IsEnum(OrgRole)
  role: OrgRole;
}
