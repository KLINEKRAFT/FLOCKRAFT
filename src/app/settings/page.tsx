import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export const metadata: Metadata = { title: 'SETTINGS · FLOCKRAFT' };

export default function SettingsPage() {
  return <SettingsScreen />;
}
