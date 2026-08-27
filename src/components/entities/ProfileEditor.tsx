'use client';

import { useId, useMemo, useState } from 'react';
import type { Entity } from '@/types/domain';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import {
  applyProfileEdit,
  normalizePlate,
  profileFieldsFor,
  type ProfileFieldDef,
} from '@/lib/profiles';
import { cn } from '@/lib/cn';

/**
 * ProfileEditor — records what the operator observed.
 *
 * The whole form is rendered from the field definitions in `lib/profiles.ts`,
 * so a new field is one line there rather than a change here. Every value is
 * stored with `source: 'user'`, which is what lets the profile view distinguish
 * an operator's reading of a plate from a colour the detector sampled.
 *
 * Local state holds only the fields actually touched, and every other value is
 * read straight from the entity. That overlay is what makes the form safe
 * against a background sync: a pull that updates an untouched field shows the
 * new value immediately, while a field under the cursor is never rewritten.
 * It also removes any need to copy the profile into state when the sheet opens.
 */
interface ProfileEditorProps {
  entity: Entity;
  open: boolean;
  onClose: () => void;
  onSave: (profile: Entity['profile']) => Promise<void>;
}

export function ProfileEditor({ entity, open, onClose, onSave }: ProfileEditorProps) {
  const fields = useMemo(() => profileFieldsFor(entity.kind), [entity.kind]);
  /** Only the fields the operator has touched this session. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const valueOf = (key: string) => edits[key] ?? entity.profile?.[key]?.value ?? '';

  // Discarding edits is just dropping the overlay; the stored profile shows
  // through again with nothing to copy back.
  const dismiss = () => {
    setEdits({});
    onClose();
  };

  const save = async () => {
    setBusy(true);
    try {
      // Every field is submitted, not just the touched ones, so clearing a
      // select back to its "nothing recorded" option removes the stored value.
      const submitted: Record<string, string> = {};
      for (const field of fields) submitted[field.key] = valueOf(field.key);
      await onSave(applyProfileEdit(entity.profile, submitted));
      setEdits({});
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title={`Profile · ${entity.label}`}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={dismiss}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth disabled={busy} onClick={() => void save()}>
            Save profile
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-[12px] leading-relaxed text-ash">
          Recorded by you, stored as observations. FLOCKRAFT does not infer these from the camera —
          leaving a field unset is a valid and honest answer.
        </p>

        {fields.map((field) => (
          <ProfileInput
            key={field.key}
            def={field}
            value={valueOf(field.key)}
            modelSourced={entity.profile?.[field.key]?.source === 'model'}
            onChange={(value) => setEdits((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
      </div>
    </Sheet>
  );
}

function ProfileInput({
  def,
  value,
  modelSourced,
  onChange,
}: {
  def: ProfileFieldDef;
  value: string;
  modelSourced: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const inputClass =
    'w-full rounded-sm border border-hairline bg-abyss px-3 text-[13px] text-bone placeholder:text-shadowtext focus:border-tactical/40';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="fk-label">
          {def.label}
        </label>
        {modelSourced && (
          <span className="font-mono text-[9px] tracking-[0.12em] text-slate uppercase">
            detected
          </span>
        )}
      </div>

      {def.type === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, 'h-11 appearance-none')}
        >
          {/* The first option in every set means "nothing recorded", so an
              untouched field never reads as a deliberate answer. */}
          {def.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : def.type === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          rows={3}
          maxLength={def.maxLength}
          placeholder={def.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, 'py-2 leading-relaxed')}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          maxLength={def.maxLength}
          placeholder={def.placeholder}
          // Plates are alphanumeric identifiers, not prose: autocorrect and
          // capitalisation would fight the operator on every entry.
          autoCapitalize={def.type === 'plate' ? 'characters' : 'sentences'}
          autoCorrect={def.type === 'plate' ? 'off' : 'on'}
          spellCheck={def.type !== 'plate'}
          onChange={(event) =>
            onChange(def.type === 'plate' ? normalizePlate(event.target.value) : event.target.value)
          }
          className={cn(inputClass, 'h-11', def.type === 'plate' && 'font-mono tracking-[0.12em]')}
        />
      )}

      {def.hint && <p className="mt-1.5 text-[11px] leading-relaxed text-slate">{def.hint}</p>}
    </div>
  );
}
