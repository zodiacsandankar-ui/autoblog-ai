import { PrismaClient, UserRole, OrgRole, PlanType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding AutoBlog AI database...');

  // Clean existing data
  await prisma.tokenUsage.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.publishingRecord.deleteMany();
  await prisma.scheduledPost.deleteMany();
  await prisma.seoAudit.deleteMany();
  await prisma.articleVersion.deleteMany();
  await prisma.article.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.keyword.deleteMany();
  await prisma.trend.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.analyticsConfig.deleteMany();
  await prisma.analyticsSnapshot.deleteMany();
  await prisma.publishingPlatform.deleteMany();
  await prisma.image.deleteMany();
  await prisma.contentTemplate.deleteMany();
  await prisma.customPage.deleteMany();
  await prisma.website.deleteMany();
  await prisma.subscriber.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.aiProvider.deleteMany();
  await prisma.plugin.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  await prisma.theme.deleteMany();

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@autoblog.ai',
      passwordHash: adminPasswordHash,
      name: 'Admin User',
      role: UserRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });
  console.log(`✅ Created admin user: ${admin.email}`);

  // Create demo user
  const demoPasswordHash = await bcrypt.hash('Demo@123456', 12);
  const demo = await prisma.user.create({
    data: {
      email: 'demo@autoblog.ai',
      passwordHash: demoPasswordHash,
      name: 'Demo User',
      role: UserRole.USER,
      emailVerified: true,
    },
  });
  console.log(`✅ Created demo user: ${demo.email}`);

  // Create organization
  const org = await prisma.organization.create({
    data: {
      name: 'AutoBlog Demo',
      slug: 'autoblog-demo',
      plan: PlanType.PROFESSIONAL,
      settings: {
        timezone: 'America/New_York',
        defaultLanguage: 'en',
        features: ['ai-generation', 'trends', 'publishing', 'analytics'],
      },
    },
  });

  // Add admin as owner
  await prisma.organizationMember.create({
    data: {
      userId: admin.id,
      organizationId: org.id,
      role: OrgRole.OWNER,
      permissions: ['*'],
    },
  });

  // Add demo as member
  await prisma.organizationMember.create({
    data: {
      userId: demo.id,
      organizationId: org.id,
      role: OrgRole.EDITOR,
      permissions: ['articles:read', 'articles:write', 'trends:read', 'keywords:read'],
    },
  });

  // Create subscription
  await prisma.subscription.create({
    data: {
      userId: admin.id,
      organizationId: org.id,
      plan: PlanType.PROFESSIONAL,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
    },
  });

  // Create AI provider (DeepSeek - Primary)
  await prisma.aiProvider.create({
    data: {
      name: 'deepseek',
      displayName: 'DeepSeek AI',
      baseUrl: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-placeholder',
      isDefault: true,
      isActive: true,
      priority: 1,
      models: [
        { name: 'deepseek-v4-pro', type: 'general', maxTokens: 8192 },
        { name: 'deepseek-v4-flash', type: 'fast', maxTokens: 4096 },
        { name: 'deepseek-chat', type: 'chat', maxTokens: 4096 },
        { name: 'deepseek-reasoner', type: 'reasoning', maxTokens: 8192 },
      ],
      rateLimitRpm: 60,
      rateLimitRpd: 10000,
      costPer1kTokens: {
        'deepseek-v4-pro': { input: 0.0005, output: 0.0015 },
        'deepseek-v4-flash': { input: 0.0001, output: 0.0003 },
        'deepseek-chat': { input: 0.00014, output: 0.00028 },
        'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
      },
      organizationId: org.id,
    },
  });

  // Create project
  const project = await prisma.project.create({
    data: {
      name: 'My First Blog',
      slug: 'my-first-blog',
      description: 'A demo blog project for testing AutoBlog AI features',
      language: 'en',
      targetCountry: 'US',
      tone: 'professional',
      writingStyle: 'informative',
      articleLength: 'medium',
      postingFrequency: 3,
      timezone: 'America/New_York',
      settings: {
        autoApprove: false,
        requireApproval: true,
        defaultPlatform: 'website',
        seoSettings: {
          targetKeywords: ['ai', 'technology', 'software'],
          defaultCategory: 'Technology',
          enableFAQ: true,
          enableTOC: true,
        },
        aiSettings: {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          temperature: 0.7,
          maxTokens: 4000,
        },
        notifications: {
          onPublish: true,
          onError: true,
          emailRecipients: ['admin@autoblog.ai'],
        },
      },
      organizationId: org.id,
      userId: admin.id,
    },
  });

  // Create sample article
  const article = await prisma.article.create({
    data: {
      title: 'Getting Started with AI-Powered Content Creation',
      slug: 'getting-started-ai-content-creation',
      metaTitle: 'Getting Started with AI-Powered Content Creation | AutoBlog AI',
      metaDescription: 'Learn how AI can transform your content creation workflow with this comprehensive guide.',
      content: '<h2>Introduction to AI Content Creation</h2><p>Artificial intelligence is revolutionizing how we create content. In this guide, we explore the fundamentals of AI-powered writing and how you can leverage it for your blog.</p>',
      tableOfContents: [
        { id: 'introduction', text: 'Introduction', level: 'h2' },
        { id: 'benefits', text: 'Benefits of AI Writing', level: 'h2' },
        { id: 'getting-started', text: 'Getting Started', level: 'h2' },
      ],
      faq: [
        { question: 'Is AI-generated content good for SEO?', answer: 'Yes, when properly optimized and reviewed by humans, AI content can rank very well on search engines.' },
      ],
      seoScore: 85,
      readabilityScore: 72,
      wordCount: 1250,
      readingTime: 7,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      aiProviderId: 'deepseek',
      projectId: project.id,
      userId: admin.id,
    },
  });

  // Create publishing platform
  await prisma.publishingPlatform.create({
    data: {
      projectId: project.id,
      type: 'website',
      name: 'Built-in Website',
      config: {
        domain: 'my-first-blog.autoblog.ai',
        ssl: true,
      },
      isActive: true,
    },
  });

  // Create themes
  const themes = [
    {
      name: 'Minimal Blog',
      slug: 'minimal-blog',
      description: 'Clean, typography-focused design for personal blogs',
      category: 'BLOG',
      isOfficial: true,
      defaultConfig: {
        colors: { primary: '#2563eb', secondary: '#4f46e5', accent: '#f59e0b', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0' },
        typography: { fontHeading: 'Inter', fontBody: 'Inter', fontCode: 'JetBrains Mono', fontSizeBase: 16, lineHeight: 1.7 },
        layout: { maxWidth: 720, sidebar: 'none', headerStyle: 'sticky', footerStyle: 'minimal' },
        spacing: 'normal',
        borderRadius: 'soft',
        darkMode: 'system',
        animations: 'subtle',
        pageTransitions: false,
      },
    },
    {
      name: 'Magazine',
      slug: 'magazine',
      description: 'Grid layout with featured stories for news sites',
      category: 'MAGAZINE',
      isOfficial: true,
      defaultConfig: {
        colors: { primary: '#dc2626', secondary: '#1e293b', accent: '#eab308', background: '#fefefe', surface: '#f5f5f5', text: '#171717', textMuted: '#737373', border: '#d4d4d4' },
        typography: { fontHeading: 'Playfair Display', fontBody: 'Georgia', fontCode: 'Fira Code', fontSizeBase: 17, lineHeight: 1.6 },
        layout: { maxWidth: 1280, sidebar: 'right', headerStyle: 'fixed', footerStyle: 'full' },
        spacing: 'normal',
        borderRadius: 'sharp',
        darkMode: 'toggle',
        animations: 'full',
        pageTransitions: true,
      },
    },
  ];

  for (const theme of themes) {
    await prisma.theme.create({ data: theme });
  }
  console.log(`✅ Created ${themes.length} themes`);

  // Create sample workflow
  await prisma.workflow.create({
    data: {
      name: 'Auto Blogger',
      description: 'Automatically discover trends, research keywords, generate articles, and publish',
      trigger: { type: 'cron', config: { cron: '0 9 * * 1-5' } },
      steps: [
        { id: '1', name: 'discover-trends', type: 'action', config: { module: 'trends', action: 'discover' }, nextSteps: ['2'], onError: 'skip' },
        { id: '2', name: 'filter-trends', type: 'condition', config: { field: 'compositeScore', operator: 'gte', value: 70 }, nextSteps: ['3', 'end'], onError: 'skip' },
        { id: '3', name: 'research-keywords', type: 'action', config: { module: 'keywords', action: 'research' }, nextSteps: ['4'], onError: 'fail' },
        { id: '4', name: 'generate-article', type: 'action', config: { module: 'articles', action: 'generate' }, nextSteps: ['5'], onError: 'retry' },
        { id: '5', name: 'publish', type: 'action', config: { module: 'publishing', action: 'publish' }, nextSteps: [], onError: 'retry' },
      ],
      isActive: true,
      projectId: project.id,
    },
  });

  console.log('✅ Seed completed successfully!');
  console.log('');
  console.log('📧 Admin login: admin@autoblog.ai / Admin@123456');
  console.log('📧 Demo login: demo@autoblog.ai / Demo@123456');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
