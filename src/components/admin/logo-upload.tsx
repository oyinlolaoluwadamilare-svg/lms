'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLogoUploadUrl, setUnitLogo } from '@/actions/documents';
import { Button } from '@/components/ui/button';

export function LogoUpload({ unitId, hasLogo }: { unitId: string; hasLogo: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { url, key } = await createLogoUploadUrl({ unitId, contentType: file.type });
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
      await setUnitLogo({ unitId, key });
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
        accept="image/png,image/jpeg,image/svg+xml"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : hasLogo ? 'Replace logo' : 'Upload logo'}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-rag-red font-semibold">
          {error}
        </span>
      )}
    </div>
  );
}
