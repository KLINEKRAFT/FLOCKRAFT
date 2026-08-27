'use client';

import { UserCheck } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { BASIS_LABEL, describeProposal } from '@/lib/vision/entityMatcher';
import type { Track } from '@/types/domain';

/**
 * MATCH CONFIRMATION
 * ---------------------------------------------------------------------------
 * The only path by which a sighting is ever bound to an existing entity.
 *
 * Automatic matching produced a proposal long before this existed, but the
 * proposal was rendered as a single `?` glyph with no way to act on it — so
 * every observation stayed a new entity no matter how good the match was. The
 * feature was, in practice, inert.
 *
 * Three rules govern how this is worded, all downstream of the product's
 * central constraint that FLOCKRAFT does not identify people on its own:
 *
 *  1. The proposal is stated as a possibility, never a finding. "Possible
 *     PERSON 014", with the similarity shown as a number the operator can
 *     judge for themselves.
 *  2. What the suggestion rests on is disclosed. The signals are weak —
 *     colour agreement and recency — and an operator who knows that will
 *     correctly distrust a match they cannot personally corroborate.
 *  3. Declining is exactly as easy as confirming. A confirm-weighted layout
 *     would manufacture agreement, and agreement here writes to permanent
 *     memory.
 */

export interface MatchPromptProps {
  track: Track;
  onConfirm: () => void;
  onReject: () => void;
  className?: string;
}

export function MatchPrompt({ track, onConfirm, onReject, className }: MatchPromptProps) {
  const candidate = track.candidateMatch;
  if (!candidate) return null;

  return (
    <div className={className}>
      <Panel tone="glass" className="p-3">
        <div className="flex items-start gap-2.5">
          <UserCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">
              {describeProposal(candidate)}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ash">
              {track.label} may be the same subject as{' '}
              <span className="text-bone">{candidate.entityLabel}</span>, at{' '}
              <span className="tabular">{Math.round(candidate.similarity * 100)}%</span> similarity.
              Confirm only if you recognise them.
            </p>

            {/* What the guess is actually made of — so it can be discounted. */}
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {candidate.basis.map((basis) => (
                <li
                  key={basis}
                  className="rounded-xs border border-hairline px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-slate uppercase"
                >
                  {BASIS_LABEL[basis]}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant="secondary" fullWidth onClick={onReject}>
            Not a match
          </Button>
          <Button variant="primary" fullWidth onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </Panel>
    </div>
  );
}
