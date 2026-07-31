"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/domain/money";
import type { DealListRow, PipelineStageOption } from "@/services/deals";
import { changeStageAction } from "./actions";

// Native HTML5 drag-and-drop, not a library - no dnd dependency exists in this repo yet, and
// CLAUDE.md requires a recorded decision (docs/DECISIONS.md) before adding one. Good enough for a
// single-list-per-column Kanban board.
//
// Optimistic update, rolling back visibly on failure (docs/06-ui-spec.md). Deliberately does NOT
// try to recompute weightedValue client-side after an optimistic move: that figure depends on
// whether the deal has a probabilityOverride, which this row shape doesn't carry (only the already-
// resolved value), so a client-side guess could show a number that's briefly wrong in a way a stale
// one wouldn't be. The card's stage/column updates immediately; router.refresh() settles the exact
// weighted value from the server within the same round trip.
export function PipelineBoard({
  deals: initialDeals,
  stages,
}: {
  deals: DealListRow[];
  stages: PipelineStageOption[];
}) {
  const router = useRouter();
  const [deals, setDeals] = useState(initialDeals);
  const [error, setError] = useState<string | null>(null);
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  const openStages = stages.filter((s) => s.stageType === "open").sort((a, b) => a.sortOrder - b.sortOrder);
  const closingStages = stages.filter((s) => s.stageType !== "open").sort((a, b) => a.sortOrder - b.sortOrder);

  async function handleDrop(toStage: PipelineStageOption) {
    const dealId = draggingDealId;
    setDraggingDealId(null);
    setDragOverStageId(null);
    if (!dealId) return;

    const previous = deals;
    const deal = previous.find((d) => d.id === dealId);
    if (!deal || deal.stage.id === toStage.id) return;

    setError(null);
    setDeals((current) =>
      current.map((d) =>
        d.id === dealId
          ? { ...d, stage: { id: toStage.id, name: toStage.name, sortOrder: toStage.sortOrder, stageType: toStage.stageType } }
          : d,
      ),
    );

    const result = await changeStageAction(dealId, toStage.id);
    if (!result.ok) {
      setDeals(previous); // roll back visibly
      setError(`${deal.reference}: ${result.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" aria-live="polite" className="rounded-token border border-lost bg-surface px-3 py-2 text-sm text-lost">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {openStages.map((stage) => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            deals={deals.filter((d) => d.stage.id === stage.id)}
            isDropTarget
            isDragOver={dragOverStageId === stage.id}
            onDragOver={() => setDragOverStageId(stage.id)}
            onDragLeave={() => setDragOverStageId((current) => (current === stage.id ? null : current))}
            onDrop={() => handleDrop(stage)}
            onCardDragStart={setDraggingDealId}
          />
        ))}
        {closingStages.map((stage) => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            deals={deals.filter((d) => d.stage.id === stage.id)}
            isDropTarget={false}
            isDragOver={false}
            onCardDragStart={setDraggingDealId}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  stage,
  deals,
  isDropTarget,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
}: {
  stage: PipelineStageOption;
  deals: DealListRow[];
  isDropTarget: boolean;
  isDragOver: boolean;
  onDragOver?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
  onCardDragStart: (dealId: string) => void;
}) {
  return (
    <div
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-token border p-2 ${
        isDragOver ? "border-accent bg-raised" : "border-line bg-raised"
      }`}
      onDragOver={
        isDropTarget
          ? (e) => {
              e.preventDefault();
              onDragOver?.();
            }
          : undefined
      }
      onDragLeave={isDropTarget ? onDragLeave : undefined}
      onDrop={
        isDropTarget
          ? (e) => {
              e.preventDefault();
              onDrop?.();
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-ink">{stage.name}</h2>
        <span className="text-xs text-muted">{deals.length}</span>
      </div>
      {!isDropTarget ? (
        <p className="px-1 text-xs text-muted">Mark Won/Lost lands later - not a drop target yet.</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {deals.map((deal) => (
          <div
            key={deal.id}
            draggable
            onDragStart={() => onCardDragStart(deal.id)}
            className="cursor-grab rounded-token border border-line bg-surface p-2 text-[13.5px] active:cursor-grabbing"
          >
            <p className="font-medium text-ink">{deal.name}</p>
            <p className="text-xs text-muted">
              {deal.reference} · {deal.accountName}
            </p>
            <p className="text-xs text-muted">{deal.ownerName ?? "Unowned"}</p>
            {deal.value ? <p className="mt-1 text-xs text-ink">{formatMoney(deal.value)}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
