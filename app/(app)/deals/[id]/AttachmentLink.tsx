"use client";

import { useState } from "react";
import { getDocumentDownloadUrlAction } from "./documentActions";

// Never a plain <a href> straight to Storage - the bucket is private (src/lib/storage.ts's own
// comment) and every download must mint a fresh, short-lived signed URL through the caller's own
// RLS-scoped read first. Opens in a new tab so the modal/timeline page itself never navigates away.
//
// The blank tab is opened SYNCHRONOUSLY, inside the click handler, before the server action's
// await - not after. Calling window.open() only once the signed URL comes back (i.e. after an
// await) breaks the browser's "was this still directly caused by the user's click" heuristic, and
// real browsers silently popup-block it (found via manual QA: it worked, but produced no visible
// tab). Opening a blank, same-origin-safe tab up front and redirecting it once the URL is known is
// the standard fix - the tab still only ever navigates to a URL this component fetched.
export function AttachmentLink({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    // Passing "noopener" here would make window.open() return null (per spec, forfeiting the very
    // reference this function needs to redirect the tab once the URL resolves). Setting
    // tab.opener = null from THIS side achieves the identical protection (the new tab can't reach
    // back to window.opener) while still letting this component hold and use its own reference.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const result = await getDocumentDownloadUrlAction(documentId);
    setPending(false);
    if (!result.ok) {
      tab?.close();
      setError(result.message);
      return;
    }
    if (tab) tab.location.href = result.url;
    else window.open(result.url, "_blank", "noopener,noreferrer"); // popup blocked outright; best effort
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        {fileName}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-lost">
          {error}
        </span>
      ) : null}
    </span>
  );
}
