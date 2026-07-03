import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@ApiTags('Plugins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('plugins')
export class PluginsController {
  private readonly logger = new Logger(PluginsController.name);

  constructor(private readonly pluginsService: PluginsService) {}

  @Get()
  @ApiOperation({ summary: 'List all available (public) plugins' })
  @ApiResponse({ status: 200, description: 'List of available plugin definitions' })
  async listAvailable() {
    return this.pluginsService.listAvailable();
  }

  @Get('installed')
  @ApiOperation({ summary: 'List plugins installed for an organization' })
  @ApiResponse({ status: 200, description: 'Installed plugins list' })
  async listInstalled(
    @CurrentUser() user: JwtUser,
    @Body('organizationId') organizationId?: string,
  ) {
    const orgId = organizationId || (user as any).organizationId;
    if (!orgId) {
      return [];
    }
    return this.pluginsService.listInstalled(orgId);
  }

  @Post('install')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Install a plugin for an organization' })
  @ApiResponse({ status: 201, description: 'Plugin installed' })
  @ApiResponse({ status: 409, description: 'Plugin already installed' })
  async install(
    @Body('pluginId') pluginId: string,
    @Body('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    await this.pluginsService.installPlugin(pluginId, organizationId);
    return { message: `Plugin "${pluginId}" installed successfully` };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Uninstall a plugin from an organization' })
  @ApiResponse({ status: 200, description: 'Plugin uninstalled' })
  @ApiResponse({ status: 404, description: 'Plugin not installed' })
  async uninstall(
    @Param('id') id: string,
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    await this.pluginsService.uninstallPlugin(id, organizationId);
    return { message: `Plugin "${id}" uninstalled successfully` };
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable a plugin for an organization' })
  @ApiResponse({ status: 200, description: 'Plugin enabled' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async enable(
    @Param('id') id: string,
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    await this.pluginsService.enablePlugin(id, organizationId);
    return { message: `Plugin "${id}" enabled` };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a plugin for an organization' })
  @ApiResponse({ status: 200, description: 'Plugin disabled' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async disable(
    @Param('id') id: string,
    @Query('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    await this.pluginsService.disablePlugin(id, organizationId);
    return { message: `Plugin "${id}" disabled` };
  }
}
