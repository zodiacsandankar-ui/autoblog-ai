import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as bcryptjs from 'bcryptjs';
import { Prisma, User, UserStatus } from '@prisma/client';

export interface PaginatedUsers {
  data: Array<Omit<User, 'passwordHash' | 'twoFactorSecret'>>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  private readonly userSelect = {
    id: true,
    email: true,
    name: true,
    avatar: true,
    role: true,
    status: true,
    emailVerified: true,
    twoFactorEnabled: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } as const;

  /**
   * Sanitize a user object by removing sensitive fields.
   */
  private sanitize(user: User): Omit<User, 'passwordHash' | 'twoFactorSecret'> {
    const { passwordHash, twoFactorSecret, ...sanitized } = user;
    return sanitized;
  }

  /**
   * Create a new user (typically used by admin or during registration via AuthService).
   */
  async create(dto: CreateUserDto): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcryptjs.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        status: UserStatus.ACTIVE,
      },
    });

    this.logger.log(`User created: ${user.id} (${user.email})`);
    return this.sanitize(user);
  }

  /**
   * Find a user by their unique ID.
   */
  async findById(id: string): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Find a user by their email address.
   */
  async findByEmail(
    email: string,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'> | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: this.userSelect,
    });

    return user;
  }

  /**
   * Find a user by email and return with password hash (for auth validation).
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Update a user's profile (name, avatar).
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.avatar !== undefined && { avatar: dto.avatar }),
      },
    });

    this.logger.log(`Profile updated for user ${userId}`);
    return this.sanitize(updated);
  }

  /**
   * Update a user's avatar URL.
   */
  async updateAvatar(
    userId: string,
    avatarUrl: string,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
    });

    this.logger.log(`Avatar updated for user ${userId}`);
    return this.sanitize(updated);
  }

  /**
   * Soft-delete a user (set deletedAt timestamp).
   */
  async deactivateUser(
    userId: string,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new BadRequestException('User is already deactivated');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: UserStatus.INACTIVE,
      },
    });

    this.logger.log(`User deactivated: ${userId}`);
    return this.sanitize(updated);
  }

  /**
   * List users with pagination and filtering (admin).
   */
  async listUsers(params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedUsers> {
    const {
      page = 1,
      limit = 10,
      search,
      role,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role as any;
    }

    if (status) {
      where.status = status as any;
    }

    // Validate sort field
    const allowedSortFields = ['createdAt', 'updatedAt', 'email', 'name', 'role', 'status', 'lastLoginAt'];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: this.userSelect,
        skip,
        take: limit,
        orderBy: { [orderField]: sortOrder },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  /**
   * Admin update user (role, status, etc.).
   */
  async updateUser(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing email
    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        throw new ConflictException('Email is already in use');
      }
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.avatar !== undefined) updateData.avatar = dto.avatar;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    this.logger.log(`User updated by admin: ${userId}`);
    return this.sanitize(updated);
  }
}
