'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUploadUrl, registerDocument } from '@/actions/documents';
import { Button } from '@/components/ui/button';

/** Browser-to-Spaces upload: ask the server for a presigned PUT, send the
 *  file straight to storage, then register the record. Keys never reach
 *  the browser; the file never passes through the app server. */
export function UploadButton({ unitId }: { unitId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { url, key } = await createUploadUrl({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        unitId,
      });
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
      await registerDocument({
        key,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        unitId,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : 'Upload document'}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-rag-red font-semibold">
          {error}
        </span>
      )}
    </div>
  );
}
