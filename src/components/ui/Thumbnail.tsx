'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { EntityKind, MediaId } from '@/types/domain';
import { getRepository } from '@/lib/store';
import { KIND_ACCENT } from '@/lib/taxonomy';
import { cn } from '@/lib/cn';

/**
 * Thumbnail — resolves a media id to an object URL and renders it.
 *
 * Object URLs are revoked on unmount and whenever the id changes. Without that
 * revocation, scrolling a long timeline leaks a blob reference per row and the
 * tab's memory grows without bound — one of the easiest ways to make a
 * media-heavy PWA crash on iOS.
 */
interface ThumbnailProps {
  mediaId?: MediaId;
  alt: string;
  kind: EntityKind;
  size?: number;
  className?: string;
  rounded?: boolean;
}

export function Thumbnail({
  mediaId,
  alt,
  kind,
  size = 56,
  className,
  rounded = true,
}: ThumbnailProps) {
  const url = useMediaUrl(mediaId);
  const accent = KIND_ACCENT[kind];

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden border border-hairline bg-abyss',
        rounded ? 'rounded-sm' : '',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? (
        // A plain <img> is correct here: the source is a runtime blob URL, which
        // next/image cannot optimise and would only wrap in extra machinery.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} width={size} height={size} className="size-full object-cover" />
      ) : (
        <div
          className="flex size-full items-center justify-center"
          style={{ backgroundColor: accent.wash }}
          aria-label={mediaId ? 'Image unavailable' : 'No image stored'}
          role="img"
        >
          <ImageOff aria-hidden className="size-4" style={{ color: accent.color, opacity: 0.5 }} />
        </div>
      )}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5"
        style={{ backgroundColor: accent.color, opacity: 0.7 }}
      />
    </div>
  );
}

/**
 * Resolves a media id to a blob object URL, revoking the previous one.
 *
 * The resolved URL is stored together with the id it belongs to. That pairing
 * is what makes stale results impossible without a synchronous state reset on
 * every id change: a URL is only rendered when its id still matches the one
 * being asked for.
 */
export function useMediaUrl(mediaId: MediaId | undefined): string | null {
  const [resolved, setResolved] = useState<{ id: MediaId; url: string } | null>(null);

  useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    void getRepository()
      .getMedia(mediaId)
      .then((record) => {
        if (cancelled || !record?.blob) return;
        objectUrl = URL.createObjectURL(record.blob);
        setResolved({ id: mediaId, url: objectUrl });
      })
      .catch(() => {
        // A missing or unreadable record simply renders the placeholder.
      });

    return () => {
      cancelled = true;
      // Revoking is essential: without it, scrolling a long list leaks one blob
      // reference per row and the tab grows without bound.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId]);

  return resolved && resolved.id === mediaId ? resolved.url : null;
}
