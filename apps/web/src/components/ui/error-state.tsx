'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
}

function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again later.',
  error,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-6 text-center',
        className
      )}
      role="alert"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 mb-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {error?.message || message}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          className="mt-4"
          onClick={onRetry}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      )}
    </div>
  );
}

export { ErrorState };
