'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'default' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  default: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

function LoadingSpinner({ size = 'default', className, label }: LoadingSpinnerProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2', className)}
      role="status"
      aria-label={label || 'Loading'}
    >
      <Loader2 className={cn('animate-spin text-muted-foreground', sizeMap[size])} />
      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
      <span className="sr-only">{label || 'Loading'}</span>
    </div>
  );
}

export { LoadingSpinner };
