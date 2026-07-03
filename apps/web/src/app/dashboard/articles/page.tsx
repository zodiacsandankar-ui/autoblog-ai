'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useArticles, useDeleteArticle } from '@/hooks/use-article';
import { Plus, Search, Filter, MoreHorizontal, Eye, Edit, Trash, Copy } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, formatDate, formatRelativeTime, getStatusColor } from '@/lib/utils';
import type { Article } from '@/types';

const statusFilters = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Published', value: 'PUBLISHED' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Pending Review', value: 'PENDING_REVIEW' },
];

export default function ArticlesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { data, isLoading } = useArticles({
    search,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });
  const deleteMutation = useDeleteArticle();

  const articles = (data as any)?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Articles</h1>
          <p className="text-muted-foreground mt-1">Manage all your AI-generated content</p>
        </div>
        <Button asChild>
          <Link href="/writer">
            <Plus className="mr-2 h-4 w-4" /> New Article
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search articles..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusFilters.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-20" />
            </Card>
          ))}
        </div>
      ) : articles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileIcon className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No articles yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Start generating AI-powered content for your blog
            </p>
            <Button asChild>
              <Link href="/writer">Create Your First Article</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {articles.map((article: Article) => (
            <Card key={article.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/articles/${article.id}`}
                        className="font-medium hover:text-primary truncate"
                      >
                        {article.title}
                      </Link>
                      {article.status === 'PUBLISHED' && (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                          Live
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', getStatusColor(article.status))} />
                        {article.status.replace('_', ' ')}
                      </span>
                      <span>{article.wordCount} words</span>
                      <span>{article.readingTime} min read</span>
                      <span>SEO: {article.seoScore}</span>
                      {article.publishedAt && <span>{formatRelativeTime(article.publishedAt)}</span>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/articles/${article.id}`}>
                          <Eye className="mr-2 h-4 w-4" /> View
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/articles/${article.id}/edit`}>
                          <Edit className="mr-2 h-4 w-4" /> Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Copy className="mr-2 h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm('Delete this article?')) deleteMutation.mutate(article.id);
                        }}
                      >
                        <Trash className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
