import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { getSession, signOut } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.instance.interceptors.request.use(async (config) => {
      if (typeof window !== 'undefined') {
        const session = await getSession();
        if (session?.accessToken) {
          config.headers.Authorization = `Bearer ${session.accessToken}`;
        }
      }
      return config;
    });

    this.instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          const isAuthRoute = error.config?.url?.includes('/auth/');
          if (!isAuthRoute && typeof window !== 'undefined') {
            await signOut({ redirect: true, callbackUrl: '/auth/login' });
          }
        }
        return Promise.reject(this.normalizeError(error));
      },
    );
  }

  private normalizeError(error: AxiosError): Error {
    const message =
      (error.response?.data as any)?.message ||
      (error.response?.data as any)?.error ||
      error.message ||
      'An unexpected error occurred';

    const normalized = new Error(message);
    (normalized as any).status = error.response?.status;
    (normalized as any).data = error.response?.data;
    return normalized;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<{ success: boolean; data: T }>(url, config);
    return response.data.data;
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<{ success: boolean; data: T }>(url, data, config);
    return response.data.data;
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<{ success: boolean; data: T }>(url, data, config);
    return response.data.data;
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.patch<{ success: boolean; data: T }>(url, data, config);
    return response.data.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<{ success: boolean; data: T }>(url, config);
    return response.data.data;
  }

  async upload<T = any>(url: string, formData: FormData, onProgress?: (pct: number) => void): Promise<T> {
    const response = await this.instance.post<{ success: boolean; data: T }>(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
      timeout: 120000,
    });
    return response.data.data;
  }

  getInstance(): AxiosInstance {
    return this.instance;
  }
}

export const api = new ApiClient();

// Typed API functions
export const authApi = {
  login: (dto: { email: string; password: string }) => api.post('/auth/login', dto),
  register: (dto: { email: string; password: string; name: string; acceptTerms: boolean }) =>
    api.post('/auth/register', dto),
  logout: () => api.post('/auth/logout'),
  refreshToken: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
  getProfile: () => api.get('/users/profile'),
  updateProfile: (dto: any) => api.put('/users/profile', dto),
  setupMFA: () => api.post('/auth/mfa/setup'),
  verifyMFA: (code: string) => api.post('/auth/mfa/verify', { code }),
};

export const projectsApi = {
  list: () => api.get('/projects'),
  get: (id: string) => api.get(`/projects/${id}`),
  create: (dto: any) => api.post('/projects', dto),
  update: (id: string, dto: any) => api.put(`/projects/${id}`, dto),
  delete: (id: string) => api.delete(`/projects/${id}`),
};

export const aiApi = {
  getProviders: () => api.get('/ai/providers'),
  generate: (dto: { prompt: string; options?: any }) => api.post('/ai/generate', dto),
  generateStream: (dto: { prompt: string; options?: any }) =>
    api.post('/ai/generate/stream', dto, { responseType: 'stream' }),
  getUsage: () => api.get('/ai/usage'),
};

export const articlesApi = {
  list: (params?: any) => api.get('/articles', { params }),
  get: (id: string) => api.get(`/articles/${id}`),
  generate: (dto: any) => api.post('/articles/generate', dto),
  update: (id: string, dto: any) => api.put(`/articles/${id}`, dto),
  delete: (id: string) => api.delete(`/articles/${id}`),
  regenerate: (id: string) => api.post(`/articles/${id}/regenerate`),
  humanize: (id: string) => api.post(`/articles/${id}/humanize`),
  getVersions: (id: string) => api.get(`/articles/${id}/versions`),
  revertVersion: (id: string, versionId: string) => api.post(`/articles/${id}/revert/${versionId}`),
};

export const trendsApi = {
  list: (params?: any) => api.get('/trends', { params }),
  get: (id: string) => api.get(`/trends/${id}`),
  discover: () => api.post('/trends/discover'),
  getOpportunities: () => api.get('/trends/opportunities'),
};

export const keywordsApi = {
  list: (params?: any) => api.get('/keywords', { params }),
  research: (dto: any) => api.post('/keywords/research', dto),
  cluster: (keywords: string[]) => api.post('/keywords/cluster', { keywords }),
  findGaps: (dto: any) => api.post('/keywords/gaps', dto),
};

export const competitorsApi = {
  list: (params?: any) => api.get('/competitors', { params }),
  analyze: (dto: any) => api.post('/competitors/analyze', dto),
  get: (id: string) => api.get(`/competitors/${id}`),
};

export const publishingApi = {
  publish: (dto: any) => api.post('/publishing/publish', dto),
  crossPost: (dto: any) => api.post('/publishing/cross-post', dto),
  getHistory: (params?: any) => api.get('/publishing/history', { params }),
};

export const analyticsApi = {
  getDashboard: (projectId: string) => api.get(`/analytics/dashboard/${projectId}`),
  getTraffic: (projectId: string, params?: any) => api.get(`/analytics/traffic/${projectId}`, { params }),
  getRankings: (projectId: string) => api.get(`/analytics/rankings/${projectId}`),
  getInsights: (projectId: string) => api.post(`/analytics/insights/${projectId}`),
};

export const websitesApi = {
  list: () => api.get('/websites'),
  get: (id: string) => api.get(`/websites/${id}`),
  create: (dto: any) => api.post('/websites', dto),
  update: (id: string, dto: any) => api.put(`/websites/${id}`, dto),
  updateTheme: (id: string, config: any) => api.put(`/websites/${id}/theme`, config),
  addDomain: (id: string, domain: string) => api.post(`/websites/${id}/domain`, { domain }),
  publish: (id: string) => api.post(`/websites/${id}/publish`),
  getComments: (articleId: string) => api.get(`/websites/comments/${articleId}`),
  createComment: (dto: any) => api.post('/websites/comments', dto),
};
