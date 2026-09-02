"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StageWithBottleneckThreshold } from "@/services/pipelineStages";
import { setStageBottleneckThresholdAction } from "./actions";

interface PipelineStagesAdminProps {
  stages: StageWithBottleneckThreshold[];
}

// M6.3 (docs/07-build-backlog.md): only 'open' stages are shown - a won/lost stage can never be a
// Time in stage boundary (src/services/reports.ts's getTimeInStage only ever aggregates open
// stages, the same reasoning getCohortConversionFunnel's own comment gives for its own boundaries),
// so a threshold field for one would set a value nothing ever reads.
export function PipelineStagesAdmin({ stages }: PipelineStagesAdminProps) {
  const router = useRouter();
  const openStages = stages.filter((stage) => stage.stageType === "open").sort((a, b) => a.sortOrder - b.sortOrder);

  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(openStages.map((stage) => [stage.id, stage.bottleneckThresholdDays?.toString() ?? ""])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(stageId: string) {
    if (savingId) return;
    setSavingId(stageId);
    setErrorId(null);
    setError(null);

    const result = await setStageBottleneckThresholdAction({ stageId, thresholdDays: drafts[stageId] ?? "" });

    setSavingId(null);
    if (!result.ok) {
      setErrorId(stageId);
      setError(result.message);
      return;
    }
    router.refresh();
  }

  if (openStages.length === 0) {
    return <p className="text-sm text-muted">No open stages are configured yet.</p>;
  }

  return (
    <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-muted">
            <th className="pb-2 pr-4 font-medium">Stage</th>
            <th className="pb-2 pr-4 font-medium">Bottleneck threshold (days)</th>
            <th className="pb-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {openStages.map((stage) => (
            <tr key={stage.id} className="border-t border-line">
              <td className="py-2 pr-4 text-ink">{stage.name}</td>
              <td className="py-2 pr-4">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={drafts[stage.id] ?? ""}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                  placeholder="Not set"
                  className="w-32 rounded-token border border-line bg-surface px-3 py-1.5 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </td>
              <td className="py-2">
                <button
                  type="button"
                  onClick={() => handleSave(stage.id)}
                  disabled={savingId === stage.id}
                  className="rounded-token border border-line px-3 py-1.5 text-xs font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  {savingId === stage.id ? "Saving…" : "Save"}
                </button>
                {errorId === stage.id && error ? (
                  <p role="alert" aria-live="polite" className="mt-1 text-xs text-lost">
                    {error}
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
