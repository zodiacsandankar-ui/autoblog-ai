import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PrismaService } from '@/database/prisma.service';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { CurrentUser } from '@/modules/auth/current-user.decorator';
import { UserRole, OrgRole } from '@prisma/client';

function isOrgAdmin(orgRole: OrgRole): boolean {
  return [OrgRole.OWNER, OrgRole.ADMIN].includes(orgRole);
}

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Organization created' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Slug already exists' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List organizations for the current user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organizations retrieved' })
  async listForUser(@CurrentUser('id') userId: string) {
    return this.organizationsService.listForUser(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization found' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Organization not found' })
  async getById(@Param('id') id: string) {
    return this.organizationsService.getById(id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get organization by slug' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization found' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Organization not found' })
  async getBySlug(@Param('slug') slug: string) {
    return this.organizationsService.getBySlug(slug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update organization' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization updated' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Organization not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: any,
  ) {
    await this.requireOrgAccess(user.id, id, true);
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete (soft-delete) an organization' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Organization not found' })
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    await this.requireOrgAccess(user.id, id, true);
    await this.organizationsService.delete(id);
    return { message: 'Organization deleted successfully' };
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List organization members' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Members retrieved' })
  async listMembers(@Param('id') id: string, @CurrentUser() user: any) {
    await this.requireOrgAccess(user.id, id, false);
    return this.organizationsService.listMembers(id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a member to the organization' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Member added' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already a member' })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: any,
  ) {
    await this.requireOrgAccess(user.id, id, true);
    return this.organizationsService.addMember(id, dto, user.id);
  }

  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Update a member role' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Member role updated' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') memberId: string,
    @Body('role') role: OrgRole,
    @CurrentUser() user: any,
  ) {
    await this.requireOrgAccess(user.id, id, true);
    return this.organizationsService.updateMemberRole(id, memberId, role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from the organization' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Member removed' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Member not found' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') memberId: string,
    @CurrentUser() user: any,
  ) {
    await this.requireOrgAccess(user.id, id, true);
    await this.organizationsService.removeMember(id, memberId);
    return { message: 'Member removed successfully' };
  }

  private async requireOrgAccess(
    userId: string,
    orgId: string,
    requireAdmin: boolean,
  ): Promise<void> {
    // Check platform-level admin access
    const platformUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (
      platformUser &&
      (platformUser.role === UserRole.ADMIN || platformUser.role === UserRole.SUPER_ADMIN)
    ) {
      return;
    }

    // Check org membership role
    const membership = await this.organizationsService.getUserRole(userId, orgId);

    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    if (requireAdmin && !isOrgAdmin(membership.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
  }
}
