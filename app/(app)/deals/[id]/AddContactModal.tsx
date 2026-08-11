"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DECISION_ROLES, DECISION_ROLE_LABELS } from "@/domain/contact";
import type { Contact } from "@/services/contacts";
import { addContactToDealAction } from "./addContactActions";

// M5.6 (docs/07-build-backlog.md): "Contact management on the deal with decision-role badges."
// Rendered as a plain trigger button next to Mark Won/Mark Lost, the same boolean-gated-visibility
// shape every other role-conditional modal in this codebase already uses - docs/06-ui-spec.md's own
// "under a menu" line is not followed literally here for the same reason MarkWonModal's own comment
// gives: no dropdown-menu primitive exists yet, and building one for a handful of buttons ahead of
// the rest actually needing it would be premature abstraction (CLAUDE.md #6).
//
// The mode toggle (existing vs. new) is only offered when availableContacts is non-empty - with no
// unlinked contacts at this account, "pick an existing one" is not a real choice, so the form opens
// straight into "new contact" mode instead of showing a picker with nothing to pick.
export function AddContactModal({ dealId, accountId, availableContacts }: { dealId: string; accountId: string; availableContacts: Contact[] }) {
  const router = useRouter();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement & HTMLInputElement>(null);

  const hasExistingContacts = availableContacts.length > 0;
  const [mode, setMode] = useState<"existing" | "new">(hasExistingContacts ? "existing" : "new");
  const [contactId, setContactId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [decisionRole, setDecisionRole] = useState<(typeof DECISION_ROLES)[number]>("unknown");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setMode(hasExistingContacts ? "existing" : "new");
    setContactId(availableContacts[0]?.id ?? "");
    setFirstName("");
    setLastName("");
    setJobTitle("");
    setEmail("");
    setPhone("");
    setLinkedinUrl("");
    setDecisionRole("unknown");
    setError(null);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }

  async function handleSave() {
    if (pending) return;
    if (mode === "existing" && !contactId) {
      setError("Select a contact");
      return;
    }
    if (mode === "new" && firstName.trim().length === 0) {
      setError("First name is required");
      return;
    }
    setPending(true);
    setError(null);

    const result = await addContactToDealAction(
      dealId,
      accountId,
      mode === "existing"
        ? { mode: "existing", contactId, decisionRole }
        : { mode: "new", firstName, lastName, jobTitle, email, phone, linkedinUrl, decisionRole },
    );

    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
    dialogRef.current?.close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
    if (e.key === "Escape") {
      dialogRef.current?.close();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        Add Contact
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-token border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      >
        <form method="dialog" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold text-ink">Add contact</h2>

          {hasExistingContacts ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-ink">Contact</legend>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode("existing")}
                  aria-pressed={mode === "existing"}
                  className={`rounded-token border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    mode === "existing" ? "border-accent bg-accent text-surface" : "border-line bg-raised text-ink"
                  }`}
                >
                  Existing contact
                </button>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  aria-pressed={mode === "new"}
                  className={`rounded-token border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    mode === "new" ? "border-accent bg-accent text-surface" : "border-line bg-raised text-ink"
                  }`}
                >
                  New contact
                </button>
              </div>
            </fieldset>
          ) : null}

          {mode === "existing" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-contactId`} className="text-sm font-medium text-ink">
                Contact
              </label>
              <select
                id={`${idPrefix}-contactId`}
                ref={firstFieldRef}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
              >
                {availableContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName ?? ""}
                    {contact.jobTitle ? ` — ${contact.jobTitle}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-firstName`} className="text-sm font-medium text-ink">
                  First name
                </label>
                <input
                  id={`${idPrefix}-firstName`}
                  ref={firstFieldRef}
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-lastName`} className="text-sm font-medium text-ink">
                  Last name (optional)
                </label>
                <input
                  id={`${idPrefix}-lastName`}
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-jobTitle`} className="text-sm font-medium text-ink">
                  Job title (optional)
                </label>
                <input
                  id={`${idPrefix}-jobTitle`}
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-email`} className="text-sm font-medium text-ink">
                  Email (optional)
                </label>
                <input
                  id={`${idPrefix}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-phone`} className="text-sm font-medium text-ink">
                  Phone (optional)
                </label>
                <input
                  id={`${idPrefix}-phone`}
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-linkedinUrl`} className="text-sm font-medium text-ink">
                  LinkedIn URL (optional)
                </label>
                <input
                  id={`${idPrefix}-linkedinUrl`}
                  type="text"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-decisionRole`} className="text-sm font-medium text-ink">
              Decision role
            </label>
            <select
              id={`${idPrefix}-decisionRole`}
              value={decisionRole}
              onChange={(e) => setDecisionRole(e.target.value as (typeof DECISION_ROLES)[number])}
              className="rounded-token border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-accent"
            >
              {DECISION_ROLES.map((role) => (
                <option key={role} value={role}>
                  {DECISION_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p role="alert" aria-live="polite" className="text-sm text-lost">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Add contact"}
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
