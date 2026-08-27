import type { Metadata } from 'next';
import { LiveScreen } from '@/components/live/LiveScreen';

export const metadata: Metadata = { title: 'LIVE · FLOCKRAFT' };

export default function LivePage() {
  return <LiveScreen />;
}
