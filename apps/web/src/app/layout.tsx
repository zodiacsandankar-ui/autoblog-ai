import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { cn } from '@/lib/utils';
import '@/styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'AutoBlog AI - AI-Powered Autonomous Blogging Platform',
    template: '%s | AutoBlog AI',
  },
  description:
    'Enterprise-grade AI autonomous blogging SaaS platform. Generate SEO-optimized articles, discover trending topics, and publish to multiple platforms automatically.',
  keywords: [
    'AI blog generator',
    'automated blogging',
    'SEO content writer',
    'AI content creation',
    'blog automation',
    'content marketing',
  ],
  authors: [{ name: 'AutoBlog AI' }],
  creator: 'AutoBlog AI',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL,
    siteName: 'AutoBlog AI',
    title: 'AutoBlog AI - AI-Powered Autonomous Blogging Platform',
    description:
      'Enterprise-grade AI autonomous blogging SaaS platform. Generate SEO-optimized articles automatically.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AutoBlog AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoBlog AI',
    description: 'AI-Powered Autonomous Blogging Platform',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(inter.variable, jetbrainsMono.variable, 'antialiased')}
    >
      <body className="min-h-screen bg-background font-sans text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
