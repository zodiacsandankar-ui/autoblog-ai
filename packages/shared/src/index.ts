// Shared types and utilities between API and Web apps

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number = 1,
  limit: number = 20,
): PaginatedResponse<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export function buildPaginationParams(params: PaginationParams): {
  skip: number;
  take: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
} {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const result: { skip: number; take: number; orderBy?: Record<string, 'asc' | 'desc'> } = {
    skip,
    take: limit,
  };

  if (params.sortBy) {
    result.orderBy = { [params.sortBy]: params.sortOrder || 'desc' };
  }

  return result;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function estimateReadingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

export function countWords(text: string): number {
  return text
    .replace(/<[^>]*>/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function calculateKeywordDensity(
  content: string,
  keyword: string,
): number {
  const cleanContent = content.replace(/<[^>]*>/g, '').toLowerCase();
  const words = cleanContent.split(/\s+/);
  const keywordCount = words.filter(
    (w) => w === keyword.toLowerCase() || w.includes(keyword.toLowerCase()),
  ).length;
  return words.length > 0 ? (keywordCount / words.length) * 100 : 0;
}

export const PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    limits: {
      maxArticlesPerMonth: 5,
      maxProjects: 1,
      maxUsers: 1,
      maxStorageGb: 0.5,
      customDomain: false,
      whiteLabel: false,
      apiAccess: false,
      prioritySupport: false,
    },
    features: ['5 articles/month', '1 project', '1 user', 'Basic AI models', 'Community support'],
  },
  STARTER: {
    name: 'Starter',
    price: 29,
    limits: {
      maxArticlesPerMonth: 50,
      maxProjects: 3,
      maxUsers: 3,
      maxStorageGb: 5,
      customDomain: false,
      whiteLabel: false,
      apiAccess: false,
      prioritySupport: false,
    },
    features: ['50 articles/month', '3 projects', '3 users', 'All AI models', 'Email support'],
  },
  PROFESSIONAL: {
    name: 'Professional',
    price: 99,
    limits: {
      maxArticlesPerMonth: 200,
      maxProjects: 10,
      maxUsers: 10,
      maxStorageGb: 50,
      customDomain: true,
      whiteLabel: false,
      apiAccess: true,
      prioritySupport: true,
    },
    features: [
      '200 articles/month',
      '10 projects',
      '10 users',
      'All AI models',
      'Custom domain',
      'API access',
      'Priority support',
    ],
  },
  BUSINESS: {
    name: 'Business',
    price: 299,
    limits: {
      maxArticlesPerMonth: 1000,
      maxProjects: 999999,
      maxUsers: 25,
      maxStorageGb: 200,
      customDomain: true,
      whiteLabel: true,
      apiAccess: true,
      prioritySupport: true,
    },
    features: [
      '1,000 articles/month',
      'Unlimited projects',
      '25 users',
      'All AI models',
      'White label',
      'API access',
      'Dedicated support',
    ],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 999,
    limits: {
      maxArticlesPerMonth: 999999,
      maxProjects: 999999,
      maxUsers: 999999,
      maxStorageGb: 1000,
      customDomain: true,
      whiteLabel: true,
      apiAccess: true,
      prioritySupport: true,
    },
    features: [
      'Unlimited articles',
      'Unlimited projects',
      'Unlimited users',
      'All AI models',
      'White label',
      'SSO + SAML',
      'Dedicated support',
      'SLA guarantee',
    ],
  },
};

export const SEO_CHECKLIST = [
  { check: 'Title tag 50-60 chars', weight: 10 },
  { check: 'Meta description 150-160 chars', weight: 8 },
  { check: 'Primary keyword in first 100 words', weight: 10 },
  { check: 'Primary keyword in H1', weight: 5 },
  { check: 'Primary keyword in at least 1 H2', weight: 5 },
  { check: 'Secondary keywords distributed', weight: 8 },
  { check: 'Semantic/LSI keywords included', weight: 7 },
  { check: 'Keyword density 1-2%', weight: 5 },
  { check: 'Internal links (3-5 per 1000 words)', weight: 8 },
  { check: 'External authority links (2-3)', weight: 5 },
  { check: 'Image ALT text', weight: 5 },
  { check: 'Schema markup (Article + FAQ)', weight: 10 },
  { check: 'Table of Contents', weight: 5 },
  { check: 'FAQ section with schema', weight: 5 },
  { check: 'Readability score > 60', weight: 5 },
  { check: 'EEAT signals', weight: 5 },
  { check: 'Canonical URL', weight: 3 },
  { check: 'Open Graph tags', weight: 3 },
  { check: 'Twitter Card tags', weight: 3 },
];

export const TASK_PROVIDER_MAP: Record<string, { primary: string; fallback: string[] }> = {
  'article-writing': { primary: 'deepseek', fallback: ['claude', 'openai', 'gemini'] },
  'keyword-research': { primary: 'deepseek', fallback: ['claude', 'openai'] },
  'trend-analysis': { primary: 'deepseek', fallback: ['claude', 'gemini'] },
  'competitor-analysis': { primary: 'deepseek', fallback: ['claude', 'openai'] },
  'seo-optimization': { primary: 'deepseek', fallback: ['claude', 'openai'] },
  'image-generation': { primary: 'dalle3', fallback: ['midjourney', 'stable-diffusion'] },
  'image-prompts': { primary: 'deepseek', fallback: ['claude', 'openai'] },
  humanization: { primary: 'deepseek', fallback: ['claude'] },
  'code-generation': { primary: 'deepseek', fallback: ['claude', 'openai'] },
  'analytics-insights': { primary: 'deepseek', fallback: ['claude', 'gemini'] },
};
