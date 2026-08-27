import type { Metadata } from 'next';
import { TimelineScreen } from '@/components/timeline/TimelineScreen';

export const metadata: Metadata = { title: 'TIMELINE · FLOCKRAFT' };

export default function TimelinePage() {
  return <TimelineScreen />;
}
