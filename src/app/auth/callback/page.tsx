import type { Metadata } from 'next';
import { AuthCallback } from '@/components/settings/AuthCallback';

export const metadata: Metadata = { title: 'SIGN IN · FLOCKRAFT' };

/**
 * Landing page for the magic link.
 *
 * The exchange happens client-side because the Supabase session lives in the
 * browser — there is no server component in FLOCKRAFT that needs it, and
 * keeping auth entirely on the client avoids shipping a second session store.
 */
export default function AuthCallbackPage() {
  return <AuthCallback />;
}
