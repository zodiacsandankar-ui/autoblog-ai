'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api';
import type { DashboardStats, TrafficData, KeywordRanking, AnalyticsData } from '@/types';

// ============================================================
// Query Keys
// ============================================================

export const analyticsKeys = {
  all: ['analytics'] as const,
  dashboard: (projectId: string) => [...analyticsKeys.all, 'dashboard', projectId] as const,
  traffic: (projectId: string, params?: Record<string, unknown>) =>
    [...analyticsKeys.all, 'traffic', projectId, params] as const,
  rankings: (projectId: string) => [...analyticsKeys.all, 'rankings', projectId] as const,
  insights: (projectId: string) => [...analyticsKeys.all, 'insights', projectId] as const,
};

// ============================================================
// useDashboardStats
// ============================================================

export function useDashboardStats(projectId: string | null) {
  return useQuery({
    queryKey: analyticsKeys.dashboard(projectId ?? ''),
    queryFn: () => analyticsApi.getDashboard(projectId!) as Promise<DashboardStats>,
    enabled: !!projectId,
    refetchInterval: 30000,
  });
}

// ============================================================
// useTrafficData
// ============================================================

interface TrafficParams {
  startDate?: string;
  endDate?: string;
  period?: '7d' | '30d' | '90d' | '1y';
}

export function useTrafficData(projectId: string | null, params?: TrafficParams) {
  return useQuery({
    queryKey: analyticsKeys.traffic(projectId ?? '', params),
    queryFn: () => analyticsApi.getTraffic(projectId!, params) as Promise<TrafficData>,
    enabled: !!projectId,
  });
}

// ============================================================
// useKeywordRankings
// ============================================================

export function useKeywordRankings(projectId: string | null) {
  return useQuery({
    queryKey: analyticsKeys.rankings(projectId ?? ''),
    queryFn: () => analyticsApi.getRankings(projectId!) as Promise<KeywordRanking[]>,
    enabled: !!projectId,
    refetchInterval: 60000,
  });
}

// ============================================================
// useAnalyticsData - Combined analytics
// ============================================================

export function useAnalyticsData(projectId: string | null, params?: TrafficParams) {
  const stats = useDashboardStats(projectId);
  const traffic = useTrafficData(projectId, params);
  const rankings = useKeywordRankings(projectId);

  return {
    stats: stats.data,
    traffic: traffic.data,
    rankings: rankings.data,
    isLoading: stats.isLoading || traffic.isLoading || rankings.isLoading,
    isError: stats.isError || traffic.isError || rankings.isError,
    errors: [stats.error, traffic.error, rankings.error].filter(Boolean),
    refetchAll: () => {
      stats.refetch();
      traffic.refetch();
      rankings.refetch();
    },
  };
}

// ============================================================
// useInsights
// ============================================================

export function useInsights(projectId: string | null) {
  return useQuery({
    queryKey: analyticsKeys.insights(projectId ?? ''),
    queryFn: () => analyticsApi.getInsights(projectId!) as Promise<Record<string, unknown>>,
    enabled: !!projectId,
  });
}
