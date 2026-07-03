'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { websitesApi } from '@/lib/api';
import type { Website, ThemeConfig, WebsiteSettings } from '@/types';
import { toast } from 'sonner';

// ============================================================
// Query Keys
// ============================================================

export const websiteKeys = {
  all: ['websites'] as const,
  lists: () => [...websiteKeys.all, 'list'] as const,
  list: (params?: Record<string, unknown>) => [...websiteKeys.lists(), params] as const,
  details: () => [...websiteKeys.all, 'detail'] as const,
  detail: (id: string) => [...websiteKeys.details(), id] as const,
  comments: (articleId: string) => [...websiteKeys.all, 'comments', articleId] as const,
};

// ============================================================
// useWebsites - List all websites
// ============================================================

export function useWebsites() {
  return useQuery({
    queryKey: websiteKeys.list(),
    queryFn: () => websitesApi.list() as Promise<Website[]>,
  });
}

// ============================================================
// useWebsite - Single website
// ============================================================

export function useWebsite(id: string | null) {
  return useQuery({
    queryKey: websiteKeys.detail(id ?? ''),
    queryFn: () => websitesApi.get(id!) as Promise<Website>,
    enabled: !!id,
  });
}

// ============================================================
// useCreateWebsite
// ============================================================

export function useCreateWebsite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: { name: string; domain?: string; platform?: string }) =>
      websitesApi.create(dto) as Promise<Website>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.lists() });
      toast.success('Website created!');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create website: ${error.message}`);
    },
  });
}

// ============================================================
// useUpdateWebsite
// ============================================================

export function useUpdateWebsite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Website> }) =>
      websitesApi.update(id, data) as Promise<Website>,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: websiteKeys.lists() });
      toast.success('Website updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update website: ${error.message}`);
    },
  });
}

// ============================================================
// useUpdateTheme
// ============================================================

export function useUpdateTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: ThemeConfig }) =>
      websitesApi.updateTheme(id, config) as Promise<Website>,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.detail(variables.id) });
      toast.success('Theme updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update theme: ${error.message}`);
    },
  });
}

// ============================================================
// usePublishWebsite
// ============================================================

export function usePublishWebsite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => websitesApi.publish(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: websiteKeys.lists() });
      toast.success('Website published!');
    },
    onError: (error: Error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });
}

// ============================================================
// useAddDomain
// ============================================================

export function useAddDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, domain }: { id: string; domain: string }) =>
      websitesApi.addDomain(id, domain),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.detail(variables.id) });
      toast.success('Domain added! DNS verification may be required.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to add domain: ${error.message}`);
    },
  });
}

// ============================================================
// useComments
// ============================================================

export function useComments(articleId: string | null) {
  return useQuery({
    queryKey: websiteKeys.comments(articleId ?? ''),
    queryFn: () => websitesApi.getComments(articleId!) as Promise<{ id: string; author: string; content: string; createdAt: string }[]>,
    enabled: !!articleId,
  });
}

// ============================================================
// useCreateComment
// ============================================================

export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: { articleId: string; author: string; email: string; content: string; website?: string }) =>
      websitesApi.createComment(dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: websiteKeys.comments(variables.articleId) });
      toast.success('Comment submitted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to submit comment: ${error.message}`);
    },
  });
}
