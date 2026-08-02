"use client";

import { useActionState } from "react";
import { editDealAction, type EditDealState } from "./actions";

export function EditDealForm({
  dealId,
  name,
  clientType,
  expectedCloseDate,
  proposalValue,
  negotiatedValue,
  brief,
}: {
  dealId: string;
  name: string;
  clientType: "new" | "existing";
  expectedCloseDate: string;
  proposalValue: string;
  negotiatedValue: string;
  brief: string;
}) {
  const boundAction = editDealAction.bind(null, dealId);
  const [state, formAction, pending] = useActionState<EditDealState, FormData>(boundAction, null);

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
          defaultValue={name}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">Client type</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="clientType" value="new" defaultChecked={clientType === "new"} required /> New
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="clientType" value="existing" defaultChecked={clientType === "existing"} /> Existing
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="expectedCloseDate" className="text-sm font-medium text-ink">
          Expected close date
        </label>
        <input
          id="expectedCloseDate"
          name="expectedCloseDate"
          type="date"
          required
          defaultValue={expectedCloseDate}
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
          defaultValue={proposalValue}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="negotiatedValue" className="text-sm font-medium text-ink">
          Negotiated value (NGN, optional)
        </label>
        <input
          id="negotiatedValue"
          name="negotiatedValue"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={negotiatedValue}
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
          defaultValue={brief}
          className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {state?.ok === false ? (
        <p role="alert" aria-live="polite" className="text-sm text-lost">
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-token bg-accent px-4 py-2 font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
