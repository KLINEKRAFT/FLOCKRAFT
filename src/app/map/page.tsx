import type { Metadata } from 'next';
import { MapScreen } from '@/components/map/MapScreen';

export const metadata: Metadata = { title: 'MAP · FLOCKRAFT' };

export default function MapPage() {
  return <MapScreen />;
}
