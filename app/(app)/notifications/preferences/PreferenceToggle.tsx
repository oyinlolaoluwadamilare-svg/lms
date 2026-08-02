"use client";

import { useId, useState } from "react";
import { setNotificationPreferenceAction } from "./actions";

interface PreferenceToggleProps {
  eventType: string;
  label: string;
  initialEnabled: boolean;
}

// One toggle per row, saved immediately on change - the same "no separate Save step" convention
// TaskRow's own inline actions already established for this codebase's other server-action-backed
// controls.
export function PreferenceToggle({ eventType, label, initialEnabled }: PreferenceToggleProps) {
  const id = useId();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    if (pending) return;
    const previous = enabled;
    setEnabled(next);
    setPending(true);
    setError(null);
    const result = await setNotificationPreferenceAction(eventType, next);
    setPending(false);
    if (!result.ok) {
      setEnabled(previous);
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0">
      <label htmlFor={id} className="flex items-center justify-between gap-4 text-sm text-ink">
        <span>{label}</span>
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => handleChange(e.target.checked)}
          className="h-4 w-4 rounded border-line text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        />
      </label>
      {error ? (
        <p role="alert" aria-live="polite" className="text-xs text-lost">
          {error}
        </p>
      ) : null}
    </div>
  );
}
