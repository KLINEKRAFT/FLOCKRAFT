import type { Metadata } from 'next';
import { EntityProfile } from '@/components/entities/EntityProfile';

export const metadata: Metadata = { title: 'ENTITY · FLOCKRAFT' };

/**
 * Entity records live in the browser's own IndexedDB, so this route cannot be
 * statically pre-rendered per id — the page shell renders and the client
 * resolves the record on mount.
 */
export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntityProfile entityId={id} />;
}
