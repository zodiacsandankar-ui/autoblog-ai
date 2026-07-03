'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  FileText,
  BarChart3,
  Send,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Zap,
  Clock,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDate, formatNumber, formatRelativeTime } from '@/lib/utils';

const stats = [
  {
    title: 'Total Articles',
    value: '1,247',
    change: '+12.5%',
    trend: 'up',
    icon: FileText,
  },
  {
    title: 'Organic Traffic',
    value: '45.2K',
    change: '+8.2%',
    trend: 'up',
    icon: TrendingUp,
  },
  {
    title: 'Avg. SEO Score',
    value: '87',
    change: '+3.1%',
    trend: 'up',
    icon: BarChart3,
  },
  {
    title: 'Published Today',
    value: '8',
    change: '-2',
    trend: 'down',
    icon: Send,
  },
];

const recentArticles = [
  {
    id: '1',
    title: 'The Complete Guide to AI Content Marketing in 2025',
    status: 'PUBLISHED',
    platform: 'wordpress',
    publishedAt: new Date(Date.now() - 3600000).toISOString(),
    views: 2340,
  },
  {
    id: '2',
    title: 'How Machine Learning is Transforming SEO Strategies',
    status: 'SCHEDULED',
    platform: 'ghost',
    publishedAt: new Date(Date.now() + 7200000).toISOString(),
    views: 0,
  },
  {
    id: '3',
    title: '10 Python Libraries Every Data Scientist Should Know',
    status: 'DRAFT',
    platform: null,
    publishedAt: null,
    views: 0,
  },
  {
    id: '4',
    title: 'Understanding Large Language Models: A Non-Technical Guide',
    status: 'PUBLISHED',
    platform: 'medium',
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    views: 5620,
  },
  {
    id: '5',
    title: 'The Future of Autonomous Vehicles in Urban Planning',
    status: 'PENDING_REVIEW',
    platform: null,
    publishedAt: null,
    views: 0,
  },
];

const trendingTopics = [
  { topic: 'AI Content Creation', score: 94, growth: '+45%' },
  { topic: 'Web Development Trends', score: 88, growth: '+32%' },
  { topic: 'Sustainable Tech', score: 82, growth: '+28%' },
  { topic: 'Cybersecurity Best Practices', score: 79, growth: '+25%' },
  { topic: 'Remote Work Tools', score: 75, growth: '+18%' },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back! Here&apos;s what&apos;s happening with your content.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Clock className="mr-2 h-4 w-4" /> Last 30 Days
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Article
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{stat.title}</span>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{stat.value}</span>
                  <span
                    className={cn(
                      'flex items-center text-xs font-medium',
                      stat.trend === 'up' ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {stat.trend === 'up' ? (
                      <ArrowUpRight className="mr-0.5 h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="mr-0.5 h-3 w-3" />
                    )}
                    {stat.change}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        {/* Recent Articles */}
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Articles</CardTitle>
              <CardDescription>Your latest content across all platforms</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/articles">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentArticles.map((article) => (
                <div
                  key={article.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/articles/${article.id}`}
                      className="font-medium hover:text-primary truncate block"
                    >
                      {article.title}
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] px-1.5', {
                          'border-green-500 text-green-600': article.status === 'PUBLISHED',
                          'border-purple-500 text-purple-600': article.status === 'SCHEDULED',
                          'border-yellow-500 text-yellow-600':
                            article.status === 'PENDING_REVIEW',
                          'border-gray-400 text-gray-500': article.status === 'DRAFT',
                        })}
                      >
                        {article.status.replace('_', ' ')}
                      </Badge>
                      {article.platform && (
                        <span className="text-xs text-muted-foreground">{article.platform}</span>
                      )}
                      {article.publishedAt && (
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(article.publishedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {article.views > 0 && (
                    <div className="ml-4 text-right">
                      <p className="text-sm font-medium">{formatNumber(article.views)}</p>
                      <p className="text-xs text-muted-foreground">views</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right Sidebar */}
        <div className="lg:col-span-3 space-y-6">
          {/* Trending Topics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Trending Topics
              </CardTitle>
              <CardDescription>High-opportunity topics to write about</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {trendingTopics.map((topic, i) => (
                  <div key={topic.topic} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-muted-foreground/50">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{topic.topic}</p>
                        <p className="text-xs text-success">{topic.growth}</p>
                      </div>
                    </div>
                    <Badge variant="secondary">{topic.score}</Badge>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
                <Link href="/trends">Explore All Trends</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/writer">
                  <PencilIcon className="mr-2 h-4 w-4" /> Generate New Article
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/trends/discover">
                  <TrendingUp className="mr-2 h-4 w-4" /> Discover Trends
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/keywords/research">
                  <SearchIcon className="mr-2 h-4 w-4" /> Research Keywords
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/competitors/analyze">
                  <Users className="mr-2 h-4 w-4" /> Analyze Competitors
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PencilIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
