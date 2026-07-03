import { Metadata } from 'next';

interface ArticleSEO {
  title: string;
  metaDescription: string;
  slug: string;
  featuredImage?: string;
  publishedAt?: string;
  updatedAt?: string;
  author?: { name: string; url?: string };
  category?: string;
  tags?: string[];
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function generateArticleMeta(article: ArticleSEO): Metadata {
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/blog/${article.slug}`;

  return {
    title: article.title,
    description: article.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title: article.title,
      description: article.metaDescription,
      type: 'article',
      url,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      images: article.featuredImage ? [{ url: article.featuredImage, width: 1200, height: 630 }] : [],
      authors: article.author ? [article.author.name] : [],
      tags: article.tags || [],
      section: article.category,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.metaDescription,
      images: article.featuredImage ? [article.featuredImage] : [],
    },
  };
}

export function generateArticleSchema(article: {
  title: string;
  description: string;
  slug: string;
  featuredImage?: string;
  publishedAt: string;
  updatedAt?: string;
  author: { name: string; url?: string; type?: string };
  publisher?: { name: string; logo?: string };
  wordCount?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    image: article.featuredImage,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: {
      '@type': article.author.type || 'Person',
      name: article.author.name,
      url: article.author.url,
    },
    publisher: {
      '@type': 'Organization',
      name: article.publisher?.name || 'AutoBlog AI',
      logo: article.publisher?.logo
        ? { '@type': 'ImageObject', url: article.publisher.logo }
        : undefined,
    },
    wordCount: article.wordCount,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${process.env.NEXT_PUBLIC_APP_URL}/blog/${article.slug}`,
    },
  };
}

export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'AutoBlog AI',
    url: process.env.NEXT_PUBLIC_APP_URL,
    logo: `${process.env.NEXT_PUBLIC_APP_URL}/logo.png`,
    sameAs: ['https://twitter.com/autoblogai'],
  };
}

export function generateFAQSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

export function generateWebsiteSchema(site: { name: string; url: string; description: string; searchUrl?: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: site.url,
    description: site.description,
    potentialAction: site.searchUrl
      ? {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: site.searchUrl },
          'query-input': 'required name=search_term_string',
        }
      : undefined,
  };
}

export function generateSitemapXML(
  articles: { slug: string; updatedAt: string; priority?: number }[],
  baseUrl: string,
): string {
  const urls = articles
    .map(
      (a) => `  <url>
    <loc>${baseUrl}/blog/${a.slug}</loc>
    <lastmod>${a.updatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${a.priority || 0.7}</priority>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls}
</urlset>`;
}
