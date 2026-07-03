import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CacheService } from '../../cache/cache.service';
import {
  PluginDefinition,
  PluginHookContext,
  PluginHookResult,
  InstalledPlugin,
} from './plugin-sdk.interface';

@Injectable()
export class PluginsService {
  private readonly logger = new Logger(PluginsService.name);

  /** In-memory registry of plugin definitions (id -> definition) */
  private readonly registry = new Map<string, PluginDefinition>();

  /** In-memory registry of active hook handlers (hookName -> handler[]) */
  private readonly hookRegistry = new Map<string, Array<{ pluginId: string; handler: (ctx: PluginHookContext) => Promise<PluginHookResult> }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // -----------------------------------------------------------------------
  // Plugin Registration
  // -----------------------------------------------------------------------

  async registerPlugin(definition: PluginDefinition): Promise<void> {
    // Validate the plugin definition
    const validation = this.validatePlugin(definition);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid plugin definition: ${validation.errors.join(', ')}`,
      );
    }

    if (this.registry.has(definition.id)) {
      throw new ConflictException(
        `Plugin "${definition.id}" is already registered`,
      );
    }

    this.registry.set(definition.id, definition);

    // Register hook handlers
    for (const [hookName, handler] of Object.entries(definition.hooks)) {
      if (!this.hookRegistry.has(hookName)) {
        this.hookRegistry.set(hookName, []);
      }
      this.hookRegistry.get(hookName)!.push({
        pluginId: definition.id,
        handler: async (ctx) => handler(ctx),
      });
    }

    this.logger.log(
      `Plugin registered: ${definition.id} v${definition.version} with ${Object.keys(definition.hooks).length} hooks`,
    );
  }

  // -----------------------------------------------------------------------
  // Plugin Installation
  // -----------------------------------------------------------------------

  async installPlugin(
    pluginId: string,
    organizationId: string,
  ): Promise<void> {
    const definition = this.registry.get(pluginId);
    if (!definition) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not registered. Register it first.`,
      );
    }

    // Check if already installed for this org
    const existing = await this.prisma.plugin.findFirst({
      where: {
        slug: pluginId,
        organizationId,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Plugin "${pluginId}" is already installed for this organization`,
      );
    }

    await this.prisma.plugin.create({
      data: {
        name: definition.name,
        slug: definition.id,
        description: definition.description,
        version: definition.version,
        author: definition.author,
        icon: definition.icon,
        entryPoint: typeof definition.entryPoint === 'string'
          ? definition.entryPoint
          : `${definition.id}:main`,
        config: (definition.defaultConfig || {}) as Record<string, unknown>,
        permissions: definition.permissions,
        isActive: true,
        isPublic: false,
        organizationId,
      },
    });

    await this.cache.del(`plugins:installed:${organizationId}`);
    this.logger.log(`Plugin "${pluginId}" installed for org=${organizationId}`);
  }

  async uninstallPlugin(
    pluginId: string,
    organizationId: string,
  ): Promise<void> {
    const plugin = await this.prisma.plugin.findFirst({
      where: { slug: pluginId, organizationId },
    });

    if (!plugin) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not installed for this organization`,
      );
    }

    await this.prisma.plugin.delete({
      where: { id: plugin.id },
    });

    await this.cache.del(`plugins:installed:${organizationId}`);
    this.logger.log(`Plugin "${pluginId}" uninstalled for org=${organizationId}`);
  }

  // -----------------------------------------------------------------------
  // Plugin State Management
  // -----------------------------------------------------------------------

  async enablePlugin(
    pluginId: string,
    organizationId: string,
  ): Promise<void> {
    const plugin = await this.prisma.plugin.findFirst({
      where: { slug: pluginId, organizationId },
    });

    if (!plugin) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not installed for this organization`,
      );
    }

    await this.prisma.plugin.update({
      where: { id: plugin.id },
      data: { isActive: true },
    });

    await this.cache.del(`plugins:installed:${organizationId}`);
    this.logger.log(`Plugin "${pluginId}" enabled for org=${organizationId}`);
  }

  async disablePlugin(
    pluginId: string,
    organizationId: string,
  ): Promise<void> {
    const plugin = await this.prisma.plugin.findFirst({
      where: { slug: pluginId, organizationId },
    });

    if (!plugin) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not installed for this organization`,
      );
    }

    await this.prisma.plugin.update({
      where: { id: plugin.id },
      data: { isActive: false },
    });

    await this.cache.del(`plugins:installed:${organizationId}`);
    this.logger.log(`Plugin "${pluginId}" disabled for org=${organizationId}`);
  }

  // -----------------------------------------------------------------------
  // Hook Execution
  // -----------------------------------------------------------------------

  async executePluginHook(
    pluginId: string,
    hookName: string,
    context: PluginHookContext,
  ): Promise<PluginHookResult> {
    const definition = this.registry.get(pluginId);
    if (!definition) {
      throw new NotFoundException(
        `Plugin "${pluginId}" is not registered`,
      );
    }

    const handler = definition.hooks[hookName];
    if (!handler) {
      throw new BadRequestException(
        `Plugin "${pluginId}" does not implement hook "${hookName}"`,
      );
    }

    try {
      const result = await handler(context);
      return result;
    } catch (error) {
      this.logger.error(
        `Plugin "${pluginId}" hook "${hookName}" failed: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
        data: context.data,
      };
    }
  }

  /**
   * Execute a named hook across all enabled plugins for an organization.
   * Hooks are executed in sequence, each receiving the output of the previous.
   */
  async executeAllHooks(
    hookName: string,
    context: Omit<PluginHookContext, 'metadata'>,
  ): Promise<PluginHookResult[]> {
    const handlers = this.hookRegistry.get(hookName) || [];
    if (handlers.length === 0) {
      return [];
    }

    // Get installed enabled plugins for this organization
    const installedPlugins = await this.listInstalled(context.organizationId);
    const enabledIds = new Set(
      installedPlugins
        .filter((p) => p.enabled)
        .map((p) => p.definition.id),
    );

    const results: PluginHookResult[] = [];
    let cumulativeMetadata: Record<string, unknown> = {};

    for (const { pluginId } of handlers) {
      if (!enabledIds.has(pluginId)) continue;

      const result = await this.executePluginHook(pluginId, hookName, {
        ...context,
        metadata: cumulativeMetadata,
      });

      results.push(result);

      if (result.metadata) {
        cumulativeMetadata = { ...cumulativeMetadata, ...result.metadata };
      }

      // Update last used timestamp
      await this.prisma.plugin.updateMany({
        where: { slug: pluginId, organizationId: context.organizationId },
        data: { isActive: true },
      });
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Listing
  // -----------------------------------------------------------------------

  async listAvailable(): Promise<PluginDefinition[]> {
    return Array.from(this.registry.values()).map((def) => ({
      ...def,
      // Don't expose internal handler functions in API responses
      hooks: Object.keys(def.hooks).reduce(
        (acc, key) => {
          acc[key] = null as unknown as any;
          return acc;
        },
        {} as Record<string, any>,
      ),
    }));
  }

  async listInstalled(
    organizationId: string,
  ): Promise<InstalledPlugin[]> {
    const cacheKey = `plugins:installed:${organizationId}`;
    const cached = await this.cache.get<InstalledPlugin[]>(cacheKey);
    if (cached) return cached;

    const plugins = await this.prisma.plugin.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const installed = plugins
      .map((p) => {
        const definition = this.registry.get(p.slug);
        if (!definition) return null;

        return {
          definition: {
            ...definition,
            hooks: Object.keys(definition.hooks).reduce(
              (acc, key) => {
                acc[key] = null as unknown as any;
                return acc;
              },
              {} as Record<string, any>,
            ),
          },
          enabled: p.isActive,
          config: (p.config as Record<string, unknown>) || {},
          installedAt: p.createdAt,
        } as InstalledPlugin;
      })
      .filter(Boolean) as InstalledPlugin[];

    await this.cache.set(cacheKey, installed, 300); // 5 min cache
    return installed;
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  validatePlugin(definition: PluginDefinition): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!definition.id || typeof definition.id !== 'string') {
      errors.push('Plugin id is required and must be a string');
    }

    if (!definition.name || typeof definition.name !== 'string') {
      errors.push('Plugin name is required and must be a string');
    }

    if (!definition.version || typeof definition.version !== 'string') {
      errors.push('Plugin version is required and must be a string');
    } else if (!/^\d+\.\d+\.\d+$/.test(definition.version)) {
      errors.push('Plugin version must be semver (e.g., "1.0.0")');
    }

    if (!definition.author || typeof definition.author !== 'string') {
      errors.push('Plugin author is required and must be a string');
    }

    if (!definition.description || typeof definition.description !== 'string') {
      errors.push('Plugin description is required and must be a string');
    }

    if (!Array.isArray(definition.permissions)) {
      errors.push('Plugin permissions must be an array of strings');
    }

    if (
      !definition.hooks ||
      typeof definition.hooks !== 'object' ||
      Object.keys(definition.hooks).length === 0
    ) {
      errors.push(
        'Plugin must define at least one hook handler',
      );
    } else {
      const validHooks = [
        'article:beforeGenerate',
        'article:afterGenerate',
        'article:beforePublish',
        'article:afterPublish',
        'trend:afterDiscover',
        'image:beforeGenerate',
        'seo:beforeAudit',
        'seo:afterAudit',
        'keyword:afterResearch',
        'workflow:beforeRun',
        'workflow:afterRun',
        'page:beforeRender',
      ];

      for (const hookName of Object.keys(definition.hooks)) {
        if (!validHooks.includes(hookName)) {
          errors.push(`Unknown hook: "${hookName}". Valid hooks are: ${validHooks.join(', ')}`);
        }
        if (typeof definition.hooks[hookName] !== 'function') {
          errors.push(`Hook "${hookName}" handler must be a function`);
        }
      }
    }

    if (definition.configSchema) {
      if (
        typeof definition.configSchema !== 'object' ||
        Array.isArray(definition.configSchema)
      ) {
        errors.push('configSchema must be an object (JSON Schema)');
      }
    }

    // Validate permissions format
    for (const perm of definition.permissions) {
      if (!/^[a-z]+:[a-z]+$/.test(perm)) {
        errors.push(
          `Invalid permission format: "${perm}". Use "resource:action" (e.g., "articles:read")`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  getDefinition(pluginId: string): PluginDefinition | undefined {
    return this.registry.get(pluginId);
  }

  isRegistered(pluginId: string): boolean {
    return this.registry.has(pluginId);
  }
}
