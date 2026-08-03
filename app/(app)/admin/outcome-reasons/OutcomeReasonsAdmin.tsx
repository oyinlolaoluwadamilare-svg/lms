"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { OutcomeReason, OutcomeType } from "@/services/outcomeReasons";
import { createOutcomeReasonAction, setOutcomeReasonActiveAction } from "./actions";

interface OutcomeReasonsAdminProps {
  reasons: OutcomeReason[];
}

const TYPE_LABELS: Record<OutcomeType, string> = { win: "Win reasons", loss: "Loss reasons" };

// M5.1 (docs/07-build-backlog.md): "`outcome_reasons` admin configuration." The first admin CRUD
// screen this codebase has - docs/06-ui-spec.md's own Admin screen names "Outcome Reasons" as one
// tab among several (Pipeline Stages, Practice Lines, Custom Fields, ...), none of which exist yet
// either; this builds only the one tab this milestone actually names, not a placeholder shell for
// the other seven. Scoped to create + activate/deactivate only, per src/data/outcomeReasons.ts's
// own comment - no label/reorder editing UI yet, since nothing in the backlog through M5.4 asks
// for one.
export function OutcomeReasonsAdmin({ reasons }: OutcomeReasonsAdminProps) {
  const router = useRouter();
  const idPrefix = useId();

  const [type, setType] = useState<OutcomeType>("win");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const byType = (t: OutcomeType) => reasons.filter((r) => r.type === t);
  const nextSortOrder = (t: OutcomeType) => byType(t).reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

  async function handleCreate() {
    if (creating || label.trim().length === 0) return;
    setCreating(true);
    setError(null);
    const result = await createOutcomeReasonAction({ type, label, sortOrder: String(nextSortOrder(type)) });
    setCreating(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLabel("");
    router.refresh();
  }

  async function handleToggle(reason: OutcomeReason) {
    if (togglingId) return;
    setTogglingId(reason.id);
    setError(null);
    const result = await setOutcomeReasonActiveAction(reason.id, !reason.isActive);
    setTogglingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {(["win", "loss"] as const).map((t) => (
        <section key={t} className="flex flex-col gap-2 rounded-token border border-line bg-raised p-6">
          <h2 className="text-sm font-semibold text-ink">{TYPE_LABELS[t]}</h2>
          {byType(t).length === 0 ? (
            <p className="text-sm text-muted">No {t} reasons yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {byType(t).map((reason) => (
                <li key={reason.id} className="flex items-center justify-between gap-3 rounded-token border border-line bg-surface px-3 py-2">
                  <span className={`text-sm ${reason.isActive ? "text-ink" : "text-muted line-through"}`}>{reason.label}</span>
                  <button
                    type="button"
                    onClick={() => handleToggle(reason)}
                    disabled={togglingId === reason.id}
                    className="rounded-token border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                  >
                    {reason.isActive ? "Deactivate" : "Activate"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
        <h2 className="text-sm font-semibold text-ink">Add a reason</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-ink">
              Type
            </label>
            <select
              id={`${idPrefix}-type`}
              value={type}
              onChange={(e) => setType(e.target.value as OutcomeType)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-label`} className="text-sm font-medium text-ink">
              Label
            </label>
            <input
              id={`${idPrefix}-label`}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || label.trim().length === 0}
            className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            {creating ? "Adding…" : "Add reason"}
          </button>
        </div>
        {error ? (
          <p role="alert" aria-live="polite" className="text-xs text-lost">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
