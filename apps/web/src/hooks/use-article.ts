'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { articlesApi } from '@/lib/api';
import type { Article, ArticleStatus, PaginatedResponse, PaginationParams } from '@/types';
import { toast } from 'sonner';

// ============================================================
// Query Keys
// ============================================================

export const articleKeys = {
  all: ['articles'] as const,
  lists: () => [...articleKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) => [...articleKeys.lists(), params] as const,
  details: () => [...articleKeys.all, 'detail'] as const,
  detail: (id: string) => [...articleKeys.details(), id] as const,
  versions: (id: string) => [...articleKeys.all, 'versions', id] as const,
};

// ============================================================
// useArticles - List with pagination and filters
// ============================================================

export function useArticles(params?: PaginationParams) {
  return useQuery({
    queryKey: articleKeys.list(params ?? {}),
    queryFn: () => articlesApi.list(params) as Promise<PaginatedResponse<Article>>,
    placeholderData: (previousData) => previousData,
  });
}

// ============================================================
// useArticle - Single article
// ============================================================

export function useArticle(id: string | null) {
  return useQuery({
    queryKey: articleKeys.detail(id ?? ''),
    queryFn: () => articlesApi.get(id!) as Promise<Article>,
    enabled: !!id,
  });
}

// ============================================================
// useGenerateArticle - Mutation with progress callback
// ============================================================

interface GenerateArticleInput {
  projectId: string;
  keyword: string;
  title?: string;
  tone?: string;
  wordCount?: number;
  includeImages?: boolean;
  includeFaq?: boolean;
  includeToc?: boolean;
  targetAudience?: string;
  additionalInstructions?: string;
}

export function useGenerateArticle(onProgress?: (step: string, pct: number) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GenerateArticleInput) => {
      onProgress?.('Analyzing topic...', 10);
      const result = await articlesApi.generate(input);
      onProgress?.('Article generated', 100);
      return result as Article;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      queryClient.setQueryData(articleKeys.detail(data.id), data);
      toast.success('Article generated successfully!');
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate article: ${error.message}`);
    },
  });
}

// ============================================================
// useUpdateArticle
// ============================================================

export function useUpdateArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Article> }) =>
      articlesApi.update(id, data) as Promise<Article>,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      toast.success('Article updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });
}

// ============================================================
// useDeleteArticle
// ============================================================

export function useDeleteArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => articlesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: articleKeys.all });
      toast.success('Article deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });
}

// ============================================================
// useRegenerateArticle
// ============================================================

export function useRegenerateArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => articlesApi.regenerate(id) as Promise<Article>,
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(id) });
      queryClient.setQueryData(articleKeys.detail(id), data);
      toast.success('Article regenerated');
    },
    onError: (error: Error) => {
      toast.error(`Regeneration failed: ${error.message}`);
    },
  });
}

// ============================================================
// useHumanizeArticle
// ============================================================

export function useHumanizeArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => articlesApi.humanize(id) as Promise<Article>,
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(id) });
      queryClient.setQueryData(articleKeys.detail(id), data);
      toast.success('Article humanized');
    },
    onError: (error: Error) => {
      toast.error(`Humanization failed: ${error.message}`);
    },
  });
}

// ============================================================
// useArticleVersions
// ============================================================

export function useArticleVersions(articleId: string | null) {
  return useQuery({
    queryKey: articleKeys.versions(articleId ?? ''),
    queryFn: () => articlesApi.getVersions(articleId!) as Promise<{ id: string; version: number; createdAt: string }[]>,
    enabled: !!articleId,
  });
}

// ============================================================
// useRevertArticleVersion
// ============================================================

export function useRevertArticleVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ articleId, versionId }: { articleId: string; versionId: string }) =>
      articlesApi.revertVersion(articleId, versionId) as Promise<Article>,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: articleKeys.versions(data.id) });
      toast.success('Version reverted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to revert version: ${error.message}`);
    },
  });
}
