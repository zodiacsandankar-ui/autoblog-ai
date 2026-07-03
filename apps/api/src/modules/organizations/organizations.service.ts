import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { OrgRole, OrgStatus } from '@prisma/client';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new organization and add the creator as OWNER.
   */
  async create(userId: string, dto: CreateOrganizationDto) {
    const existingSlug = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });

    if (existingSlug) {
      throw new ConflictException('An organization with this slug already exists');
    }

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        logo: dto.logo,
        status: OrgStatus.ACTIVE,
      },
    });

    await this.prisma.organizationMember.create({
      data: {
        userId,
        organizationId: org.id,
        role: OrgRole.OWNER,
        joinedAt: new Date(),
      },
    });

    this.logger.log(`Organization created: ${org.id} (${org.slug}) by user ${userId}`);

    return this.getById(org.id);
  }

  /**
   * Update organization details.
   */
  async update(orgId: string, dto: UpdateOrganizationDto) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (org.status === OrgStatus.DELETED) {
      throw new BadRequestException('Organization has been deleted');
    }

    if (dto.slug && dto.slug !== org.slug) {
      const existing = await this.prisma.organization.findUnique({
        where: { slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException('An organization with this slug already exists');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.slug !== undefined) updateData.slug = dto.slug;
    if (dto.logo !== undefined) updateData.logo = dto.logo;
    if (dto.settings !== undefined) updateData.settings = dto.settings;

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: updateData,
    });

    this.logger.log(`Organization updated: ${orgId}`);
    return updated;
  }

  /**
   * Soft-delete an organization.
   */
  async delete(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (org.status === OrgStatus.DELETED) {
      throw new BadRequestException('Organization is already deleted');
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { status: OrgStatus.DELETED },
    });

    this.logger.log(`Organization deleted: ${orgId}`);
  }

  /**
   * Get organization by ID with member count.
   */
  async getById(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: { select: { members: true } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  /**
   * Get organization by slug.
   */
  async getBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      include: {
        _count: { select: { members: true } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  /**
   * List organizations for a user with membership role.
   */
  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((m) => ({
      ...m.organization,
      membershipRole: m.role,
      joinedAt: m.joinedAt,
    }));
  }

  /**
   * Add a member to an organization.
   */
  async addMember(orgId: string, dto: AddMemberDto, invitedBy?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (org.status === OrgStatus.DELETED) {
      throw new BadRequestException('Organization has been deleted');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new BadRequestException('User account is deactivated');
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: dto.userId,
          organizationId: orgId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this organization');
    }

    const member = await this.prisma.organizationMember.create({
      data: {
        userId: dto.userId,
        organizationId: orgId,
        role: dto.role,
        invitedBy,
        joinedAt: new Date(),
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatar: true },
        },
      },
    });

    this.logger.log(`User ${dto.userId} added to organization ${orgId} as ${dto.role}`);
    return member;
  }

  /**
   * Remove a member from an organization.
   */
  async removeMember(orgId: string, memberUserId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: memberUserId,
          organizationId: orgId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === OrgRole.OWNER) {
      const ownerCount = await this.prisma.organizationMember.count({
        where: { organizationId: orgId, role: OrgRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last owner. Transfer ownership first.',
        );
      }
    }

    await this.prisma.organizationMember.delete({
      where: {
        userId_organizationId: {
          userId: memberUserId,
          organizationId: orgId,
        },
      },
    });

    this.logger.log(`User ${memberUserId} removed from organization ${orgId}`);
  }

  /**
   * Update a member's role within an organization.
   */
  async updateMemberRole(orgId: string, memberUserId: string, newRole: OrgRole) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: memberUserId,
          organizationId: orgId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === OrgRole.OWNER && newRole !== OrgRole.OWNER) {
      const ownerCount = await this.prisma.organizationMember.count({
        where: { organizationId: orgId, role: OrgRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot change the role of the last owner. Add another owner first.',
        );
      }
    }

    const updated = await this.prisma.organizationMember.update({
      where: {
        userId_organizationId: {
          userId: memberUserId,
          organizationId: orgId,
        },
      },
      data: { role: newRole },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatar: true },
        },
      },
    });

    this.logger.log(`User ${memberUserId} role updated to ${newRole} in organization ${orgId}`);
    return updated;
  }

  /**
   * List all members of an organization.
   */
  async listMembers(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            role: true,
            status: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  /**
   * Get a user's role and permissions in an organization.
   */
  async getUserRole(
    userId: string,
    orgId: string,
  ): Promise<{ role: OrgRole; permissions: unknown } | null> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
    });

    if (!membership) return null;

    return {
      role: membership.role,
      permissions: membership.permissions,
    };
  }
}
