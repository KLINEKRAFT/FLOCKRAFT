'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { logError } from '@/lib/logger';

/**
 * Route-level error boundary. A camera application has many ways to fail on a
 * real device — a lost WebGL context, a storage quota rejection, a revoked
 * permission mid-session — and none of them should leave the operator staring
 * at a blank screen.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError('route', error);
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <EmptyState
        tone="fault"
        icon={<TriangleAlert aria-hidden className="size-5" />}
        title="System fault"
        description={
          error.message || 'An unexpected error interrupted this view. Stored data is unaffected.'
        }
        action={
          <Button variant="primary" onClick={reset}>
            Reload view
          </Button>
        }
      />
    </div>
  );
}
