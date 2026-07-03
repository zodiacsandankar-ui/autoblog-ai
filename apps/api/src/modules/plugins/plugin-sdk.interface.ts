import { Type } from '@nestjs/common';

/**
 * Defines the structure of an AutoBlog AI plugin.
 * Plugins are self-contained modules that can extend platform functionality
 * by registering hooks that fire at specific points in the content pipeline.
 */
export interface PluginDefinition {
  /** Unique plugin identifier (e.g., "grammar-checker", "seo-optimizer") */
  id: string;

  /** Human-readable plugin name */
  name: string;

  /** Semantic version string (e.g., "1.0.0") */
  version: string;

  /** Author name or organization */
  author: string;

  /** Short description of the plugin's purpose */
  description: string;

  /** URL to plugin icon/logo */
  icon?: string;

  /** Permissions required by the plugin (e.g., ["articles:read", "articles:write"]) */
  permissions: string[];

  /**
   * Hook handlers: a map of hook names to handler functions.
   * Each handler receives a context object and returns a result.
   *
   * Available hooks:
   * - "article:beforeGenerate"  – modify prompts before article generation
   * - "article:afterGenerate"   – transform generated content
   * - "article:beforePublish"   – validate/modify before publishing
   * - "article:afterPublish"    – post-publish actions
   * - "trend:afterDiscover"     – process discovered trends
   * - "image:beforeGenerate"    – modify image generation prompts
   * - "seo:beforeAudit"         – pre-process SEO audit
   * - "seo:afterAudit"          – post-process audit results
   * - "keyword:afterResearch"   – process keyword research results
   * - "workflow:beforeRun"      – before workflow execution
   * - "workflow:afterRun"       – after workflow execution
   * - "page:beforeRender"       – modify page rendering
   */
  hooks: Record<string, PluginHookHandler>;

  /** JSON Schema for plugin configuration */
  configSchema?: Record<string, unknown>;

  /** Default configuration values */
  defaultConfig?: Record<string, unknown>;

  /** Main entry point – can be a service class or factory function */
  entryPoint?: Type<unknown> | string;

  /** Minimum platform version required */
  minPlatformVersion?: string;

  /** List of plugin IDs that this plugin depends on */
  dependencies?: string[];
}

/**
 * Context object passed to a plugin hook handler.
 */
export interface PluginHookContext {
  /** The plugin instance executing this hook */
  pluginId: string;

  /** Organization ID where the plugin is installed */
  organizationId: string;

  /** The project context (if applicable) */
  projectId?: string;

  /** The user who triggered the hook */
  userId?: string;

  /** Arbitrary data payload depending on the hook */
  data: Record<string, unknown>;

  /** Any existing metadata collected from previous hooks in the chain */
  metadata: Record<string, unknown>;
}

/**
 * Result returned from a plugin hook handler.
 */
export interface PluginHookResult {
  /** Whether the hook executed successfully */
  success: boolean;

  /** Modified or new data to pass down the chain */
  data?: Record<string, unknown>;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Error message if success is false */
  error?: string;
}

/**
 * Signature for a plugin hook handler function.
 */
export type PluginHookHandler = (
  context: PluginHookContext,
) => Promise<PluginHookResult> | PluginHookResult;

/**
 * Runtime representation of an installed plugin.
 */
export interface InstalledPlugin {
  /** Plugin definition as registered */
  definition: PluginDefinition;

  /** Whether the plugin is currently enabled */
  enabled: boolean;

  /** Organization-specific configuration */
  config: Record<string, unknown>;

  /** Timestamp when the plugin was installed */
  installedAt: Date;

  /** Timestamp when the plugin was last used */
  lastUsedAt?: Date;
}
