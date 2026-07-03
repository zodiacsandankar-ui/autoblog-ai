// ============================================================
// Theme System for AutoBlog AI
// Provides preset themes and CSS variable generation
// ============================================================

export interface ThemeConfig {
  preset: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    card: string;
    cardForeground: string;
    border: string;
    ring: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  typography: {
    fontFamily: string;
    headingFont: string;
    fontSize: {
      base: string;
      xs: string;
      sm: string;
      md: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
      '4xl': string;
    };
    lineHeight: {
      tight: string;
      normal: string;
      relaxed: string;
    };
    fontWeight: {
      normal: string;
      medium: string;
      semibold: string;
      bold: string;
    };
  };
  layout: {
    maxWidth: string;
    contentWidth: string;
    sidebarWidth: string;
    gap: string;
    padding: string;
    borderRadius: string;
  };
  spacing: {
    unit: string;
    sectionPadding: string;
    elementGap: string;
    containerPadding: string;
  };
  darkMode: {
    enabled: boolean;
    defaultMode: 'light' | 'dark' | 'system';
    colors?: Partial<ThemeConfig['colors']>;
  };
  animations: {
    enabled: boolean;
    duration: string;
    easing: string;
    hoverEffects: boolean;
    scrollAnimations: boolean;
  };
}

// ============================================================
// CSS Variable Mapping
// ============================================================

const CSS_VAR_MAP: Record<string, (config: ThemeConfig) => string> = {
  '--color-primary': (c) => c.colors.primary,
  '--color-secondary': (c) => c.colors.secondary,
  '--color-accent': (c) => c.colors.accent,
  '--color-background': (c) => c.colors.background,
  '--color-foreground': (c) => c.colors.foreground,
  '--color-muted': (c) => c.colors.muted,
  '--color-muted-foreground': (c) => c.colors.mutedForeground,
  '--color-card': (c) => c.colors.card,
  '--color-card-foreground': (c) => c.colors.cardForeground,
  '--color-border': (c) => c.colors.border,
  '--color-ring': (c) => c.colors.ring,
  '--color-success': (c) => c.colors.success,
  '--color-warning': (c) => c.colors.warning,
  '--color-error': (c) => c.colors.error,
  '--color-info': (c) => c.colors.info,
  '--font-family': (c) => c.typography.fontFamily,
  '--font-heading': (c) => c.typography.headingFont,
  '--font-size-base': (c) => c.typography.fontSize.base,
  '--font-size-xs': (c) => c.typography.fontSize.xs,
  '--font-size-sm': (c) => c.typography.fontSize.sm,
  '--font-size-md': (c) => c.typography.fontSize.md,
  '--font-size-lg': (c) => c.typography.fontSize.lg,
  '--font-size-xl': (c) => c.typography.fontSize.xl,
  '--font-size-2xl': (c) => c.typography.fontSize['2xl'],
  '--font-size-3xl': (c) => c.typography.fontSize['3xl'],
  '--font-size-4xl': (c) => c.typography.fontSize['4xl'],
  '--line-height-tight': (c) => c.typography.lineHeight.tight,
  '--line-height-normal': (c) => c.typography.lineHeight.normal,
  '--line-height-relaxed': (c) => c.typography.lineHeight.relaxed,
  '--font-weight-normal': (c) => c.typography.fontWeight.normal,
  '--font-weight-medium': (c) => c.typography.fontWeight.medium,
  '--font-weight-semibold': (c) => c.typography.fontWeight.semibold,
  '--font-weight-bold': (c) => c.typography.fontWeight.bold,
  '--layout-max-width': (c) => c.layout.maxWidth,
  '--layout-content-width': (c) => c.layout.contentWidth,
  '--layout-sidebar-width': (c) => c.layout.sidebarWidth,
  '--layout-gap': (c) => c.layout.gap,
  '--layout-padding': (c) => c.layout.padding,
  '--layout-border-radius': (c) => c.layout.borderRadius,
  '--spacing-unit': (c) => c.spacing.unit,
  '--spacing-section': (c) => c.spacing.sectionPadding,
  '--spacing-element': (c) => c.spacing.elementGap,
  '--spacing-container': (c) => c.spacing.containerPadding,
  '--animation-duration': (c) => c.animations.duration,
  '--animation-easing': (c) => c.animations.easing,
};

// ============================================================
// applyTheme - Converts ThemeConfig to CSS custom properties string
// ============================================================

export function applyTheme(config: ThemeConfig): string {
  const entries: string[] = [];

  for (const [cssVar, fn] of Object.entries(CSS_VAR_MAP)) {
    entries.push(`  ${cssVar}: ${fn(config)};`);
  }

  if (config.darkMode.colors) {
    const darkColors = config.darkMode.colors;
    entries.push('');
    entries.push('  /* Dark mode overrides */');
    if (darkColors.primary) entries.push(`  --color-primary-dark: ${darkColors.primary};`);
    if (darkColors.secondary) entries.push(`  --color-secondary-dark: ${darkColors.secondary};`);
    if (darkColors.accent) entries.push(`  --color-accent-dark: ${darkColors.accent};`);
    if (darkColors.background) entries.push(`  --color-background-dark: ${darkColors.background};`);
    if (darkColors.foreground) entries.push(`  --color-foreground-dark: ${darkColors.foreground};`);
    if (darkColors.muted) entries.push(`  --color-muted-dark: ${darkColors.muted};`);
    if (darkColors.mutedForeground) entries.push(`  --color-muted-foreground-dark: ${darkColors.mutedForeground};`);
    if (darkColors.card) entries.push(`  --color-card-dark: ${darkColors.card};`);
    if (darkColors.cardForeground) entries.push(`  --color-card-foreground-dark: ${darkColors.cardForeground};`);
    if (darkColors.border) entries.push(`  --color-border-dark: ${darkColors.border};`);
  }

  return entries.join('\n');
}

// ============================================================
// getPresetTheme - Retrieve a preset theme by name
// ============================================================

export function getPresetTheme(presetName: string): ThemeConfig | undefined {
  const key = presetName.toUpperCase().replace(/\s+/g, '_');
  return (PRESET_THEMES as Record<string, ThemeConfig>)[key];
}

// ============================================================
// applyThemeToDocument - Applies theme CSS vars to document root
// ============================================================

export function applyThemeToDocument(config: ThemeConfig): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const cssVars = applyTheme(config);

  if (config.darkMode.enabled) {
    if (config.darkMode.defaultMode === 'dark') {
      root.classList.add('dark');
    } else if (config.darkMode.defaultMode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  }

  const lines = cssVars.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^--[\w-]+:/);
    if (match) {
      const [varName, ...rest] = trimmed.split(':');
      const value = rest.join(':').replace(';', '').trim();
      root.style.setProperty(varName.trim(), value);
    }
  }
}

// ============================================================
// PRESET THEMES - 8 Fully Defined Themes
// ============================================================

export const PRESET_THEMES = {
  // ==========================================================
  // 1. Minimal Blog
  // ==========================================================
  MINIMAL_BLOG: {
    preset: 'MINIMAL_BLOG',
    colors: {
      primary: '#1a1a2e',
      secondary: '#e94560',
      accent: '#0f3460',
      background: '#ffffff',
      foreground: '#1a1a2e',
      muted: '#f5f5f5',
      mutedForeground: '#6b7280',
      card: '#ffffff',
      cardForeground: '#1a1a2e',
      border: '#e5e7eb',
      ring: '#1a1a2e',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: {
        base: '16px', xs: '0.75rem', sm: '0.875rem', md: '1rem',
        lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem',
      },
      lineHeight: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1200px', contentWidth: '720px', sidebarWidth: '320px', gap: '24px', padding: '16px', borderRadius: '8px' },
    spacing: { unit: '4px', sectionPadding: '64px', elementGap: '16px', containerPadding: '24px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#e4e4e7', secondary: '#e94560', accent: '#0f3460', background: '#0a0a0f', foreground: '#e4e4e7', muted: '#1a1a2e', mutedForeground: '#a1a1aa', card: '#111118', cardForeground: '#e4e4e7', border: '#27272a' } },
    animations: { enabled: true, duration: '200ms', easing: 'ease-in-out', hoverEffects: true, scrollAnimations: false },
  },

  // ==========================================================
  // 2. Magazine
  // ==========================================================
  MAGAZINE: {
    preset: 'MAGAZINE',
    colors: {
      primary: '#111827', secondary: '#dc2626', accent: '#2563eb',
      background: '#f8fafc', foreground: '#111827', muted: '#f1f5f9',
      mutedForeground: '#64748b', card: '#ffffff', cardForeground: '#111827',
      border: '#e2e8f0', ring: '#dc2626', success: '#16a34a', warning: '#d97706', error: '#dc2626', info: '#2563eb',
    },
    typography: {
      fontFamily: "'Merriweather', Georgia, 'Times New Roman', serif",
      headingFont: "'Playfair Display', Georgia, serif",
      fontSize: { base: '18px', xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.25rem', xl: '1.5rem', '2xl': '2rem', '3xl': '2.5rem', '4xl': '3.5rem' },
      lineHeight: { tight: '1.15', normal: '1.6', relaxed: '1.8' },
      fontWeight: { normal: '400', medium: '500', semibold: '700', bold: '900' },
    },
    layout: { maxWidth: '1400px', contentWidth: '760px', sidebarWidth: '360px', gap: '32px', padding: '24px', borderRadius: '4px' },
    spacing: { unit: '4px', sectionPadding: '80px', elementGap: '24px', containerPadding: '32px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#f1f5f9', secondary: '#ef4444', accent: '#3b82f6', background: '#0c0a0a', foreground: '#f1f5f9', muted: '#1c1919', mutedForeground: '#94a3b8', card: '#141111', cardForeground: '#f1f5f9', border: '#292524' } },
    animations: { enabled: true, duration: '300ms', easing: 'ease-out', hoverEffects: true, scrollAnimations: true },
  },

  // ==========================================================
  // 3. Corporate
  // ==========================================================
  CORPORATE: {
    preset: 'CORPORATE',
    colors: {
      primary: '#1e40af', secondary: '#0f766e', accent: '#0891b2',
      background: '#ffffff', foreground: '#1e293b', muted: '#f1f5f9',
      mutedForeground: '#64748b', card: '#ffffff', cardForeground: '#1e293b',
      border: '#e2e8f0', ring: '#1e40af', success: '#16a34a', warning: '#d97706', error: '#dc2626', info: '#0284c7',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: { base: '15px', xs: '0.7rem', sm: '0.8125rem', md: '0.9375rem', lg: '1.0625rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem' },
      lineHeight: { tight: '1.2', normal: '1.5', relaxed: '1.65' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1280px', contentWidth: '800px', sidebarWidth: '300px', gap: '24px', padding: '20px', borderRadius: '6px' },
    spacing: { unit: '4px', sectionPadding: '60px', elementGap: '20px', containerPadding: '28px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#60a5fa', secondary: '#2dd4bf', accent: '#22d3ee', background: '#0f172a', foreground: '#e2e8f0', muted: '#1e293b', mutedForeground: '#94a3b8', card: '#1a2332', cardForeground: '#e2e8f0', border: '#334155' } },
    animations: { enabled: true, duration: '150ms', easing: 'ease-in-out', hoverEffects: true, scrollAnimations: false },
  },

  // ==========================================================
  // 4. E-commerce
  // ==========================================================
  E_COMMERCE: {
    preset: 'E_COMMERCE',
    colors: {
      primary: '#ea580c', secondary: '#0891b2', accent: '#f59e0b',
      background: '#ffffff', foreground: '#1c1917', muted: '#fafaf9',
      mutedForeground: '#78716c', card: '#ffffff', cardForeground: '#1c1917',
      border: '#e7e5e4', ring: '#ea580c', success: '#16a34a', warning: '#f59e0b', error: '#dc2626', info: '#0284c7',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: { base: '16px', xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.375rem', '2xl': '1.625rem', '3xl': '2rem', '4xl': '2.5rem' },
      lineHeight: { tight: '1.1', normal: '1.4', relaxed: '1.6' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1320px', contentWidth: '840px', sidebarWidth: '340px', gap: '20px', padding: '16px', borderRadius: '8px' },
    spacing: { unit: '4px', sectionPadding: '48px', elementGap: '16px', containerPadding: '20px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#f97316', secondary: '#06b6d4', accent: '#fbbf24', background: '#0c0a09', foreground: '#e7e5e4', muted: '#1c1917', mutedForeground: '#a8a29e', card: '#1a1513', cardForeground: '#e7e5e4', border: '#292524' } },
    animations: { enabled: true, duration: '200ms', easing: 'ease-out', hoverEffects: true, scrollAnimations: true },
  },

  // ==========================================================
  // 5. Portfolio
  // ==========================================================
  PORTFOLIO: {
    preset: 'PORTFOLIO',
    colors: {
      primary: '#6d28d9', secondary: '#ec4899', accent: '#f59e0b',
      background: '#faf5ff', foreground: '#1e1b4b', muted: '#f3e8ff',
      mutedForeground: '#7c3aed', card: '#ffffff', cardForeground: '#1e1b4b',
      border: '#e9d5ff', ring: '#6d28d9', success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#6366f1',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'DM Serif Display', Georgia, serif",
      fontSize: { base: '17px', xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.1875rem', xl: '1.5rem', '2xl': '2rem', '3xl': '2.75rem', '4xl': '3.5rem' },
      lineHeight: { tight: '1.1', normal: '1.5', relaxed: '1.7' },
      fontWeight: { normal: '300', medium: '400', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1200px', contentWidth: '760px', sidebarWidth: '320px', gap: '32px', padding: '24px', borderRadius: '16px' },
    spacing: { unit: '4px', sectionPadding: '96px', elementGap: '24px', containerPadding: '32px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#a78bfa', secondary: '#f472b6', accent: '#fbbf24', background: '#0f0a1a', foreground: '#e9d5ff', muted: '#1a0f2e', mutedForeground: '#a78bfa', card: '#1a1230', cardForeground: '#e9d5ff', border: '#2e1a4a' } },
    animations: { enabled: true, duration: '400ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)', hoverEffects: true, scrollAnimations: true },
  },

  // ==========================================================
  // 6. SaaS
  // ==========================================================
  SAAS: {
    preset: 'SAAS',
    colors: {
      primary: '#6366f1', secondary: '#8b5cf6', accent: '#06b6d4',
      background: '#ffffff', foreground: '#0f172a', muted: '#f8fafc',
      mutedForeground: '#64748b', card: '#ffffff', cardForeground: '#0f172a',
      border: '#e2e8f0', ring: '#6366f1', success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: { base: '16px', xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.375rem', '2xl': '1.75rem', '3xl': '2.25rem', '4xl': '3rem' },
      lineHeight: { tight: '1.1', normal: '1.45', relaxed: '1.65' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1280px', contentWidth: '800px', sidebarWidth: '320px', gap: '28px', padding: '20px', borderRadius: '12px' },
    spacing: { unit: '4px', sectionPadding: '80px', elementGap: '20px', containerPadding: '32px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#818cf8', secondary: '#a78bfa', accent: '#22d3ee', background: '#030712', foreground: '#f1f5f9', muted: '#111827', mutedForeground: '#94a3b8', card: '#0f172a', cardForeground: '#f1f5f9', border: '#1e293b' } },
    animations: { enabled: true, duration: '200ms', easing: 'ease-out', hoverEffects: true, scrollAnimations: true },
  },

  // ==========================================================
  // 7. Newsletter
  // ==========================================================
  NEWSLETTER: {
    preset: 'NEWSLETTER',
    colors: {
      primary: '#be123c', secondary: '#881337', accent: '#fb7185',
      background: '#fffbfc', foreground: '#1f0a12', muted: '#fef2f2',
      mutedForeground: '#9f1239', card: '#ffffff', cardForeground: '#1f0a12',
      border: '#fecdd3', ring: '#be123c', success: '#16a34a', warning: '#ca8a04', error: '#be123c', info: '#2563eb',
    },
    typography: {
      fontFamily: "'Georgia', 'Times New Roman', serif",
      headingFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: { base: '15px', xs: '0.6875rem', sm: '0.8125rem', md: '0.9375rem', lg: '1.0625rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.75rem', '4xl': '2rem' },
      lineHeight: { tight: '1.2', normal: '1.55', relaxed: '1.7' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '680px', contentWidth: '600px', sidebarWidth: '0px', gap: '16px', padding: '12px', borderRadius: '4px' },
    spacing: { unit: '4px', sectionPadding: '40px', elementGap: '12px', containerPadding: '16px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#fb7185', secondary: '#fda4af', accent: '#fecdd3', background: '#1c0a12', foreground: '#fef2f2', muted: '#2d1020', mutedForeground: '#fb7185', card: '#24101a', cardForeground: '#fef2f2', border: '#3d1528' } },
    animations: { enabled: false, duration: '150ms', easing: 'ease-in-out', hoverEffects: true, scrollAnimations: false },
  },

  // ==========================================================
  // 8. Niche
  // ==========================================================
  NICHE: {
    preset: 'NICHE',
    colors: {
      primary: '#059669', secondary: '#047857', accent: '#34d399',
      background: '#f0fdf4', foreground: '#052e16', muted: '#dcfce7',
      mutedForeground: '#166534', card: '#ffffff', cardForeground: '#052e16',
      border: '#bbf7d0', ring: '#059669', success: '#16a34a', warning: '#ca8a04', error: '#dc2626', info: '#0284c7',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headingFont: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: { base: '16px', xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.3125rem', '2xl': '1.625rem', '3xl': '2rem', '4xl': '2.5rem' },
      lineHeight: { tight: '1.2', normal: '1.5', relaxed: '1.75' },
      fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    },
    layout: { maxWidth: '1100px', contentWidth: '700px', sidebarWidth: '340px', gap: '24px', padding: '20px', borderRadius: '12px' },
    spacing: { unit: '4px', sectionPadding: '56px', elementGap: '16px', containerPadding: '24px' },
    darkMode: { enabled: true, defaultMode: 'system', colors: { primary: '#34d399', secondary: '#6ee7b7', accent: '#a7f3d0', background: '#022c16', foreground: '#dcfce7', muted: '#043a1e', mutedForeground: '#6ee7b7', card: '#054a26', cardForeground: '#dcfce7', border: '#065f30' } },
    animations: { enabled: true, duration: '250ms', easing: 'ease-in-out', hoverEffects: true, scrollAnimations: false },
  },
} as const;

// ============================================================
// Utility functions
// ============================================================

export function getThemeColors(config: ThemeConfig) {
  return { ...config.colors, dark: config.darkMode.colors || undefined };
}

export function getThemeTypography(config: ThemeConfig) {
  return config.typography;
}

export function getDefaultTheme(): ThemeConfig {
  return PRESET_THEMES.MINIMAL_BLOG;
}

export function getThemeStyle(config: ThemeConfig): Record<string, string> {
  return {
    '--color-primary': config.colors.primary,
    '--color-secondary': config.colors.secondary,
    '--color-accent': config.colors.accent,
    '--color-background': config.colors.background,
    '--color-foreground': config.colors.foreground,
    '--color-muted': config.colors.muted,
    '--color-muted-foreground': config.colors.mutedForeground,
    '--color-card': config.colors.card,
    '--color-card-foreground': config.colors.cardForeground,
    '--color-border': config.colors.border,
    '--color-ring': config.colors.ring,
  };
}

export function getPresetsByCategory(category: string): { id: string; name: string; config: ThemeConfig }[] {
  return Object.entries(PRESET_THEMES)
    .filter(([, config]) => {
      const cat = config.preset.split('_')[0];
      return cat === category.toUpperCase() || !category;
    })
    .map(([id, config]) => ({
      id,
      name: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      config,
    }));
}

export function mergeThemeConfigs(base: ThemeConfig, overrides: Partial<ThemeConfig>): ThemeConfig {
  return {
    ...base,
    ...overrides,
    colors: { ...base.colors, ...overrides.colors },
    typography: {
      ...base.typography,
      ...overrides.typography,
      fontSize: { ...base.typography.fontSize, ...overrides.typography?.fontSize },
      lineHeight: { ...base.typography.lineHeight, ...overrides.typography?.lineHeight },
      fontWeight: { ...base.typography.fontWeight, ...overrides.typography?.fontWeight },
    },
    layout: { ...base.layout, ...overrides.layout },
    spacing: { ...base.spacing, ...overrides.spacing },
    darkMode: { ...base.darkMode, ...overrides.darkMode, colors: { ...base.darkMode.colors, ...overrides.darkMode?.colors } },
    animations: { ...base.animations, ...overrides.animations },
  };
}
