"use client";

import { useActionState } from "react";
import { createDealAction, type CreateDealState } from "./actions";

interface Option {
  id: string;
  label: string;
}

export function CreateDealForm({
  accounts,
  practiceLines,
  stages,
  owners,
  defaultStageId,
}: {
  accounts: Option[];
  practiceLines: Option[];
  stages: Option[];
  owners: Option[];
  defaultStageId: string | undefined;
}) {
  const [state, formAction, pending] = useActionState<CreateDealState, FormData>(createDealAction, null);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium text-ink">
          Deal name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoFocus
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="accountId" className="text-sm font-medium text-ink">
          Account
        </label>
        <select
          id="accountId"
          name="accountId"
          required
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Select an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="practiceLineId" className="text-sm font-medium text-ink">
          Practice line
        </label>
        <select
          id="practiceLineId"
          name="practiceLineId"
          required
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Select a practice line</option>
          {practiceLines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="stageId" className="text-sm font-medium text-ink">
          Stage
        </label>
        <select
          id="stageId"
          name="stageId"
          required
          defaultValue={defaultStageId}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">Client type</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="clientType" value="new" required /> New
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="clientType" value="existing" /> Existing
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ownerId" className="text-sm font-medium text-ink">
          Owner
        </label>
        <select
          id="ownerId"
          name="ownerId"
          required
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Select an owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="expectedCloseDate" className="text-sm font-medium text-ink">
          Expected close date
        </label>
        <input
          id="expectedCloseDate"
          name="expectedCloseDate"
          type="date"
          required
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="proposalValue" className="text-sm font-medium text-ink">
          Proposal value (NGN, optional)
        </label>
        <input
          id="proposalValue"
          name="proposalValue"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="brief" className="text-sm font-medium text-ink">
          Brief (optional)
        </label>
        <textarea
          id="brief"
          name="brief"
          rows={3}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {state?.ok === false ? (
        <p role="alert" aria-live="polite" className="text-sm text-lost">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-4 py-2 font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create deal"}
      </button>
    </form>
  );
}
