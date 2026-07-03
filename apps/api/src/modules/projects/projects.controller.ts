import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectsService: ProjectsService) {}

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 409, description: 'Project slug conflict' })
  async create(
    @CurrentUser() user: JwtUser,
    @Body(new ValidationPipe({ transform: true })) dto: CreateProjectDto,
  ) {
    return this.projectsService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all projects for the current user' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  async findAll(@CurrentUser() user: JwtUser) {
    return this.projectsService.findByUser(user.id);
  }

  @Get('org/:organizationId')
  @ApiOperation({ summary: 'Get all projects for an organization' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  async findByOrg(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.projectsService.findByOrg(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID with relations' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const project = await this.projectsService.findById(id);
    if (!project) {
      return { message: 'Project not found' };
    }
    return project;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ transform: true })) dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete (archive) a project' })
  @ApiResponse({ status: 200, description: 'Project archived' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.projectsService.delete(id);
    return { message: 'Project has been archived' };
  }

  // -----------------------------------------------------------------------
  // Publishing Platforms
  // -----------------------------------------------------------------------

  @Post(':id/platforms')
  @ApiOperation({ summary: 'Add a publishing platform to a project' })
  @ApiResponse({ status: 201, description: 'Platform added' })
  async addPlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    platform: {
      type: string;
      name: string;
      config?: Record<string, unknown>;
    },
  ) {
    return this.projectsService.addPublishingPlatform(id, platform);
  }

  @Get(':id/platforms')
  @ApiOperation({ summary: 'Get all publishing platforms for a project' })
  @ApiResponse({ status: 200, description: 'List of platforms' })
  async getPlatforms(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.getPublishingPlatforms(id);
  }

  @Delete(':id/platforms/:platformId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a publishing platform from a project' })
  @ApiResponse({ status: 200, description: 'Platform removed' })
  async removePlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('platformId', ParseUUIDPipe) platformId: string,
  ) {
    await this.projectsService.removePublishingPlatform(id, platformId);
    return { message: 'Publishing platform removed' };
  }

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  @Put(':id/settings')
  @ApiOperation({ summary: 'Update project settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() settings: Record<string, unknown>,
  ) {
    return this.projectsService.updateSettings(id, settings);
  }
}
