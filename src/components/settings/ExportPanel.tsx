'use client';

import { useCallback, useState } from 'react';
import { Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { Panel, SectionLabel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { getRepository } from '@/lib/store';
import { buildArtifact, collectExport, downloadArtifact, type ExportFormat } from '@/lib/export';
import { logError } from '@/lib/logger';

/**
 * EXPORT
 * ---------------------------------------------------------------------------
 * Three explicit choices rather than one control with a hidden format setting.
 * Each button says what it produces and who it is for, because the difference
 * between "a spreadsheet of what I saw" and "a backup I can restore from"
 * matters far more than saving a tap.
 *
 * The exclusion of images is stated here, not buried in the file. An operator
 * who believes they hold a complete backup and does not is worse off than one
 * who holds none.
 */

const OPTIONS: Array<{
  format: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    format: 'sightings-csv',
    label: 'Sightings',
    description:
      'One row per sighting — time, duration, confidence, direction, attributes. The sheet to open when you want to analyse activity.',
    icon: <FileSpreadsheet aria-hidden className="size-3.5" />,
  },
  {
    format: 'entities-csv',
    label: 'Entities',
    description:
      'One row per subject, with its profile fields, note text and first and last sighting.',
    icon: <FileSpreadsheet aria-hidden className="size-3.5" />,
  },
  {
    format: 'json',
    label: 'Full backup',
    description:
      'Every record, losslessly, including provenance and co-visibility. Machine-readable rather than legible.',
    icon: <FileJson aria-hidden className="size-3.5" />,
  },
];

export function ExportPanel() {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (format: ExportFormat) => {
    setBusy(format);
    setMessage(null);
    try {
      const bundle = await collectExport(getRepository());
      if (bundle.entities.length === 0) {
        setMessage('Nothing to export yet.');
        return;
      }
      const artifact = buildArtifact(bundle, format);
      downloadArtifact(artifact);
      setMessage(
        `${artifact.filename} — ${bundle.entities.length} entities, ${bundle.sightings.length} sightings.`,
      );
    } catch (error) {
      logError('store', error);
      setMessage('Export failed. Nothing was written.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <>
      <SectionLabel className="mt-6">Export</SectionLabel>
      <Panel className="divide-y divide-hairline">
        {OPTIONS.map((option) => (
          <div
            key={option.format}
            className="flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">
                {option.label}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ash">{option.description}</p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 sm:w-auto"
              disabled={busy !== null}
              icon={option.icon}
              onClick={() => void run(option.format)}
            >
              {busy === option.format ? 'Preparing…' : 'Download'}
            </Button>
          </div>
        ))}
      </Panel>

      <div className="mt-2 flex items-start gap-2 px-1">
        <Download aria-hidden className="mt-0.5 size-3 shrink-0 text-slate" />
        <p className="text-[11px] leading-relaxed text-slate">
          Exports are generated on this device and never uploaded. Stored images are not included
          in any format — a full backup restores records, not thumbnails.
        </p>
      </div>

      {message && (
        <p role="status" className="mt-2 px-1 font-mono text-[11px] text-tactical">
          {message}
        </p>
      )}
    </>
  );
}
