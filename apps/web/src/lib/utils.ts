import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, parseISO, formatDistance } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy');
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy h:mm a');
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatDistanceBetween(from: string | Date, to: string | Date): string {
  const f = typeof from === 'string' ? parseISO(from) : from;
  const t = typeof to === 'string' ? parseISO(to) : to;
  return formatDistance(f, t);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    DRAFT: 'bg-gray-500',
    PENDING_REVIEW: 'bg-yellow-500',
    APPROVED: 'bg-blue-500',
    SCHEDULED: 'bg-purple-500',
    PUBLISHED: 'bg-green-500',
    REJECTED: 'bg-red-500',
    ARCHIVED: 'bg-gray-700',
    ACTIVE: 'bg-green-500',
    INACTIVE: 'bg-gray-500',
    FAILED: 'bg-red-500',
    COMPLETED: 'bg-green-500',
    RUNNING: 'bg-blue-500',
    PENDING: 'bg-yellow-500',
  };
  return colors[status] || 'bg-gray-500';
}

export function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    wordpress: '🔷',
    ghost: '👻',
    medium: '📝',
    shopify: '🛍️',
    blogger: '📰',
    webhook: '🔗',
    rest_api: '🔌',
    graphql: '◈',
  };
  return icons[platform] || '📄';
}

export function estimateReadingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

export function calculateReadabilityScore(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (sentences.length === 0 || words.length === 0) return 0;

  const avgSentenceLength = words.length / sentences.length;
  const syllables = words.reduce((count, word) => count + countSyllables(word), 0);
  const avgSyllablesPerWord = syllables / words.length;
  const fleschKincaid = 0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;
  return Math.max(0, Math.min(100, 100 - fleschKincaid * 5));
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const match = word.match(/[aeiouy]{1,2}/g);
  return match ? match.length : 1;
}
