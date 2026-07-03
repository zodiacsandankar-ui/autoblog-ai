// ============================================
// Enums
// ============================================

export enum ArticleStatus {
  DRAFT = 'DRAFT',
  GENERATING = 'GENERATING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  SCHEDULED = 'SCHEDULED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  PUBLISH_FAILED = 'PUBLISH_FAILED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

export enum PlanType {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  BUSINESS = 'BUSINESS',
  ENTERPRISE = 'ENTERPRISE',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
}

export enum TrendStatus {
  DISCOVERED = 'DISCOVERED',
  RESEARCHED = 'RESEARCHED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
}

export enum WorkflowRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RETRYING = 'RETRYING',
}

export enum WebsiteStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  MAINTENANCE = 'MAINTENANCE',
  SUSPENDED = 'SUSPENDED',
}

export enum CommentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SPAM = 'SPAM',
}

// ============================================
// Core Models
// ============================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  plan: PlanType;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  settings: Record<string, any>;
  members?: OrganizationMember[];
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'EDITOR' | 'MEMBER' | 'VIEWER';
  permissions: string[];
  user?: User;
  organization?: Organization;
  joinedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ============================================
// Project
// ============================================

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  language: string;
  targetCountry: string | null;
  tone: string;
  writingStyle: string;
  articleLength: 'short' | 'medium' | 'long';
  postingFrequency: number;
  timezone: string;
  settings: ProjectSettings;
  status: ProjectStatus;
  organizationId: string;
  userId: string;
  organization?: Organization;
  articles?: Article[];
  publishingPlatforms?: PublishingPlatform[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  autoApprove: boolean;
  requireApproval: boolean;
  defaultPlatform: string;
  seoSettings: {
    targetKeywords: string[];
    defaultCategory: string;
    enableFAQ: boolean;
    enableTOC: boolean;
  };
  aiSettings: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  notifications: {
    onPublish: boolean;
    onError: boolean;
    emailRecipients: string[];
  };
}

// ============================================
// Article
// ============================================

export interface Article {
  id: string;
  title: string;
  slug: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  twitterCard: string | null;
  introduction: string | null;
  tableOfContents: TocItem[] | null;
  content: string | null;
  faq: FAQ[] | null;
  schemaMarkup: any | null;
  conclusion: string | null;
  cta: string | null;
  authorBox: AuthorBox | null;
  references: Reference[] | null;
  internalLinks: InternalLink[] | null;
  externalLinks: ExternalLink[] | null;
  imagePrompts: ImagePrompt[] | null;
  images: string[];
  featuredImage: string | null;
  seoScore: number;
  readabilityScore: number;
  aiDetectionScore: number;
  wordCount: number;
  readingTime: number;
  keywordDensity: Record<string, number> | null;
  status: ArticleStatus;
  publishAt: string | null;
  publishedAt: string | null;
  publishedTo: PublishResult[] | null;
  scheduleConfig: any | null;
  aiProviderId: string | null;
  generationId: string | null;
  projectId: string;
  userId: string;
  project?: Project;
  author?: User;
  versions?: ArticleVersion[];
  publishingRecords?: PublishingRecord[];
  seoAudits?: SeoAudit[];
  createdAt: string;
  updatedAt: string;
}

export interface TocItem {
  id: string;
  text: string;
  level: 'h2' | 'h3';
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface AuthorBox {
  name: string;
  bio: string;
  credentials: string;
  avatar?: string;
  social?: {
    twitter?: string;
    linkedin?: string;
    website?: string;
  };
}

export interface Reference {
  title: string;
  url: string;
  date?: string;
}

export interface InternalLink {
  anchor: string;
  suggestedUrl: string;
}

export interface ExternalLink {
  anchor: string;
  url: string;
  authority: number;
}

export interface ImagePrompt {
  section: string;
  prompt: string;
  altText: string;
}

export interface ArticleVersion {
  id: string;
  articleId: string;
  version: number;
  content: string;
  metadata: any;
  diff: string | null;
  reason: string | null;
  userId: string;
  createdAt: string;
}

export interface SeoAudit {
  id: string;
  articleId: string;
  score: number;
  issues: SEOIssue[];
  optimizedContent: string | null;
  metaTags: any;
  schemaMarkup: any;
  keywordDensity: Record<string, number>;
  createdAt: string;
}

export interface SEOIssue {
  type: 'missing' | 'suboptimal' | 'error';
  element: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  suggestedFix: string;
}

// ============================================
// Trends & Keywords
// ============================================

export interface Trend {
  id: string;
  title: string;
  category: string;
  compositeScore: number;
  searchVolume: number;
  trendGrowth: number;
  viralityScore: number;
  socialMentions: number;
  newsFrequency: number;
  businessPotential: number;
  userIntent: 'informational' | 'navigational' | 'transactional' | 'commercial';
  seasonalityIndex: number;
  rawData: any;
  status: TrendStatus;
  source: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Keyword {
  id: string;
  term: string;
  type: 'PRIMARY' | 'SECONDARY' | 'LONG_TAIL' | 'SEMANTIC' | 'LSI' | 'QUESTION';
  searchVolume: number;
  difficulty: number;
  cpc: number;
  intent: string;
  priority: 'high' | 'medium' | 'low';
  clusterName: string | null;
  opportunityScore: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeywordResearchResult {
  primaryKeywords: Keyword[];
  secondaryKeywords: Keyword[];
  longTailKeywords: Keyword[];
  semanticKeywords: Keyword[];
  questionKeywords: Keyword[];
  clusters: KeywordCluster[];
  contentGaps: ContentGap[];
  recommendations: KeywordRecommendations;
}

export interface KeywordCluster {
  name: string;
  keywords: string[];
  searchVolume: number;
  difficulty: number;
  contentType: string;
}

export interface ContentGap {
  topic: string;
  opportunity: string;
  estimatedTraffic: number;
}

export interface KeywordRecommendations {
  targetKeyword: string;
  recommendedWordCount: number;
  contentType: string;
  headingStructure: string[];
  internalLinks: string[];
  externalAuthorityLinks: string[];
}

// ============================================
// Competitors
// ============================================

export interface Competitor {
  id: string;
  url: string;
  title: string;
  metaDescription: string;
  wordCount: number;
  headingCount: number;
  internalLinks: number;
  externalLinks: number;
  images: number;
  readabilityScore: number;
  schemaTypes: string[];
  contentGaps: string[];
  backlinksCount: number | null;
  domainAuthority: number | null;
  socialShares: number | null;
  pageSpeed: number | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorAnalysisResult {
  competitorSummary: {
    analyzedCount: number;
    averageWordCount: number;
    averageHeadingCount: number;
    topPerformer: string;
  };
  contentGaps: ContentGap[];
  recommendations: CompetitorRecommendations;
  contentBrief: ContentBrief;
}

export interface CompetitorRecommendations {
  targetWordCount: number;
  headingStructure: { level: string; text: string; keyword: string }[];
  internalLinks: string[];
  externalAuthorityLinks: { url: string; anchor: string; authority: number }[];
  schemaTypes: string[];
  imageCount: number;
  faqCount: number;
  tableCount: number;
}

export interface ContentBrief {
  title: string;
  metaDescription: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  outline: { heading: string; subheadings: string[]; keyPoints: string[] }[];
  mustInclude: string[];
  tone: string;
  wordCountTarget: number;
  readingLevel: string;
}

// ============================================
// Publishing
// ============================================

export interface PublishingPlatform {
  id: string;
  projectId: string;
  type: string;
  name: string;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublishResult {
  platform: string;
  success: boolean;
  url?: string;
  postId?: string;
  publishedAt?: string;
  error?: string;
}

export interface PublishingRecord {
  id: string;
  articleId: string;
  platform: string;
  platformPostId: string | null;
  url: string | null;
  status: string;
  metadata: Record<string, any>;
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Workflow
// ============================================

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTrigger {
  type: 'cron' | 'event' | 'manual' | 'webhook';
  config: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'delay' | 'approval' | 'parallel' | 'loop';
  config: Record<string, any>;
  nextSteps: string[];
  onError: 'retry' | 'skip' | 'fail' | 'fallback';
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  input: Record<string, any>;
  output: Record<string, any>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ============================================
// Website Builder
// ============================================

export interface Website {
  id: string;
  projectId: string;
  domain: string;
  subdomain: string;
  customDomain: string | null;
  sslEnabled: boolean;
  status: WebsiteStatus;
  themeId: string;
  themeConfig: ThemeConfig;
  siteTitle: string;
  siteDescription: string;
  siteLogo: string | null;
  favicon: string | null;
  googleAnalyticsId: string | null;
  gtmId: string | null;
  socialLinks: Record<string, string>;
  headerConfig: any;
  footerConfig: any;
  homePage: any;
  settings: any;
  theme?: Theme;
  pages?: CustomPage[];
  createdAt: string;
  updatedAt: string;
}

export interface Theme {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  preview: string | null;
  category: 'BLOG' | 'MAGAZINE' | 'CORPORATE' | 'ECOMMERCE' | 'PORTFOLIO' | 'SAAS' | 'NEWSLETTER' | 'NICHE';
  thumbnail: string | null;
  screenshots: string[];
  defaultConfig: ThemeConfig;
  cssVariables: string | null;
  customCSS: string | null;
  availableBlocks: string[];
  isPublic: boolean;
  isOfficial: boolean;
}

export interface ThemeConfig {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };
  typography: {
    fontHeading: string;
    fontBody: string;
    fontCode: string;
    fontSizeBase: number;
    lineHeight: number;
  };
  layout: {
    maxWidth: number;
    sidebar: 'left' | 'right' | 'none';
    headerStyle: 'fixed' | 'sticky' | 'static';
    footerStyle: 'minimal' | 'full' | 'newsletter';
  };
  spacing: 'compact' | 'normal' | 'relaxed';
  borderRadius: 'sharp' | 'soft' | 'rounded';
  darkMode: 'system' | 'light' | 'dark' | 'toggle';
  darkColors?: {
    background: string;
    surface: string;
    text: string;
  };
  animations: 'none' | 'subtle' | 'full';
  pageTransitions: boolean;
  customCSS?: string;
}

export interface CustomPage {
  id: string;
  websiteId: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  blocks: PageBlock[];
  schemaMarkup: any;
  canonicalUrl: string | null;
  noindex: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageBlock {
  id: string;
  type: 'hero' | 'article-grid' | 'featured-post' | 'category-list' | 'newsletter' | 'testimonials' | 'cta' | 'text' | 'image' | 'video' | 'embed' | 'code' | 'table' | 'divider' | 'spacer';
  config: BlockConfig;
  content: Record<string, any>;
  styles: Record<string, any>;
  responsive: ResponsiveConfig;
}

export interface BlockConfig {
  title?: string;
  backgroundColor?: string;
  textColor?: string;
  columns?: number;
  cardStyle?: 'default' | 'bordered' | 'minimal';
  [key: string]: any;
}

export interface ResponsiveConfig {
  mobile: Record<string, any>;
  tablet: Record<string, any>;
  desktop: Record<string, any>;
}

// ============================================
// Analytics
// ============================================

export interface DashboardStats {
  totalArticles: number;
  totalViews: number;
  totalKeywords: number;
  avgSeoScore: number;
  articlesThisMonth: number;
  publishedToday: number;
  scheduledCount: number;
  draftCount: number;
  trendsDiscovered: number;
  apiUsageThisMonth: {
    totalTokens: number;
    totalCost: number;
    byProvider: Record<string, { tokens: number; cost: number }>;
  };
  revenue: number;
}

export interface TrafficData {
  sessions: number;
  users: number;
  pageviews: number;
  bounceRate: number;
  avgSessionDuration: number;
  dailyTraffic: { date: string; sessions: number; users: number }[];
  topSources: { source: string; sessions: number }[];
  topArticles: { title: string; slug: string; views: number }[];
}

export interface KeywordRanking {
  keyword: string;
  position: number;
  previousPosition: number;
  searchVolume: number;
  url: string;
  change: 'up' | 'down' | 'same';
}

// ============================================
// AI Providers
// ============================================

export interface AIProvider {
  id: string;
  name: string;
  displayName: string;
  isDefault: boolean;
  isActive: boolean;
  priority: number;
  models: string[];
  status: 'available' | 'unavailable' | 'rate_limited' | 'error';
}

export interface AIUsage {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number; requests: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  daily: { date: string; tokens: number; cost: number }[];
}

// ============================================
// Billing
// ============================================

export interface Subscription {
  id: string;
  userId: string;
  organizationId: string;
  plan: PlanType;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'TRIALING';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  usage: {
    articlesThisMonth: number;
    projectsCount: number;
    usersCount: number;
    storageUsed: number;
  };
  limits: {
    maxArticlesPerMonth: number;
    maxProjects: number;
    maxUsers: number;
    maxStorageGb: number;
    customDomain: boolean;
    whiteLabel: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
  };
}

export interface PlanConfig {
  type: PlanType;
  name: string;
  price: number;
  interval: 'month' | 'year';
  features: string[];
  limits: Subscription['limits'];
}

// ============================================
// Images & Media
// ============================================

export interface Image {
  id: string;
  projectId: string;
  url: string;
  alt?: string;
  caption?: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: string;
  variants: ImageVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageVariant {
  id: string;
  imageId: string;
  url: string;
  width: number;
  height: number;
  label: 'thumbnail' | 'small' | 'medium' | 'large' | 'og';
}

// ============================================
// Analytics
// ============================================

export interface AnalyticsData {
  pageViews: { date: string; value: number }[];
  visitors: { date: string; value: number }[];
  pageviewsBySource: { source: string; count: number; percentage: number }[];
  topPages: { path: string; title: string; views: number; avgTimeOnPage: number }[];
  deviceBreakdown: { device: string; sessions: number; percentage: number }[];
  countryBreakdown: { country: string; sessions: number; percentage: number }[];
  bounceRate: number;
  avgSessionDuration: number;
  pagesPerSession: number;
}

export interface MemberRole {
  OWNER: 'OWNER';
  ADMIN: 'ADMIN';
  MEMBER: 'MEMBER';
  VIEWER: 'VIEWER';
}

// ============================================
// API Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    pagination?: PaginationMeta;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  status?: string;
  [key: string]: any;
}

// ============================================
// Comments & Subscribers
// ============================================

export interface Comment {
  id: string;
  articleId: string;
  parentId: string | null;
  authorName: string;
  authorEmail: string;
  authorAvatar: string | null;
  userId: string | null;
  content: string;
  status: CommentStatus;
  isFlagged: boolean;
  likes: number;
  replies?: Comment[];
  createdAt: string;
  updatedAt: string;
}

export interface Subscriber {
  id: string;
  websiteId: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'UNSUBSCRIBED' | 'BOUNCED';
  preferences: Record<string, any>;
  verifiedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}
