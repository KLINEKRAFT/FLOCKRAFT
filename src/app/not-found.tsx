import Link from 'next/link';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { TopBar } from '@/components/layout/TopBar';

export default function NotFound() {
  return (
    <>
      <TopBar title="NOT FOUND" />
      <EmptyState
        icon={<Compass aria-hidden className="size-5" />}
        title="No such view"
        description="The requested screen does not exist."
        action={
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-sm border border-hairline bg-gunmetal px-4 font-mono text-xs tracking-[0.12em] uppercase hover:bg-graphite"
          >
            Return to live
          </Link>
        }
      />
    </>
  );
}
