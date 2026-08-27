import type { Metadata } from 'next';
import { EntitiesScreen } from '@/components/entities/EntitiesScreen';

export const metadata: Metadata = { title: 'ENTITIES · FLOCKRAFT' };

export default function EntitiesPage() {
  return <EntitiesScreen />;
}
