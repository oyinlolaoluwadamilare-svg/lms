'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Inline PDF preview through the presigned redirect route. */
export function PdfPreview({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide preview' : 'Preview'}
      </Button>
      {open && (
        <iframe
          src={`/api/documents/${documentId}`}
          title={`Preview of ${fileName}`}
          className="w-full h-[70vh] rounded-lg border border-line bg-white"
        />
      )}
    </div>
  );
}
