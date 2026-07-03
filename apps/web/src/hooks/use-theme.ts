'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { websitesApi } from '@/lib/api';
import type { ThemeConfig } from '@/types';
import { applyTheme, getPresetTheme, PRESET_THEMES } from '@/lib/themes';
import { toast } from 'sonner';

// ============================================================
// Query Keys
// ============================================================

export const themeKeys = {
  all: ['themes'] as const,
  config: (websiteId: string) => [...themeKeys.all, 'config', websiteId] as const,
  presets: () => [...themeKeys.all, 'presets'] as const,
};

// ============================================================
// useThemeConfig - Get current theme config for a website
// ============================================================

export function useThemeConfig(websiteId: string | null) {
  return useQuery({
    queryKey: themeKeys.config(websiteId ?? ''),
    queryFn: async () => {
      const website = await websitesApi.get(websiteId!) as { theme?: { config: ThemeConfig } };
      return website.theme?.config ?? null;
    },
    enabled: !!websiteId,
  });
}

// ============================================================
// useThemePresets - Get available theme presets
// ============================================================

export function useThemePresets() {
  return useQuery({
    queryKey: themeKeys.presets(),
    queryFn: async () => {
      return Object.entries(PRESET_THEMES).map(([id, config]) => ({
        id,
        name: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        config,
      }));
    },
    staleTime: Infinity,
  });
}

// ============================================================
// useApplyTheme - Apply a theme config to a website
// ============================================================

export function useApplyTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ websiteId, config }: { websiteId: string; config: ThemeConfig }) => {
      const result = await websitesApi.updateTheme(websiteId, config) as { theme?: { config: ThemeConfig } };
      return result;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: themeKeys.config(variables.websiteId) });

      // Apply CSS variables to document
      const cssVars = applyTheme(variables.config);
      const styleId = `theme-vars-${variables.websiteId}`;
      let styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `:root { ${cssVars} }`;

      toast.success('Theme applied successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to apply theme: ${error.message}`);
    },
  });
}

// ============================================================
// useApplyPreset - Apply a preset theme by name
// ============================================================

export function useApplyPreset() {
  const applyThemeMutation = useApplyTheme();

  return useMutation({
    mutationFn: async ({ websiteId, presetName }: { websiteId: string; presetName: string }) => {
      const config = getPresetTheme(presetName);
      if (!config) {
        throw new Error(`Preset theme "${presetName}" not found`);
      }
      return applyThemeMutation.mutateAsync({ websiteId, config });
    },
    onError: (error: Error) => {
      toast.error(`Failed to apply preset: ${error.message}`);
    },
  });
}
