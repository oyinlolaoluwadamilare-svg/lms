'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface AiResponse {
  configured?: boolean;
  message?: string;
  result?: string;
  error?: string;
}

/** Shared shell for every AI assist: a generate button, a clear
 *  "not configured" state, and an editable result the user copies or adopts.
 *  The model proposes; a person decides. Nothing here writes to the record. */
export function AiPanel({
  title,
  description,
  endpoint,
  payload,
  buttonLabel = 'Generate',
  askMode = false,
}: {
  title: string;
  description: string;
  endpoint: string;
  payload?: Record<string, unknown>;
  buttonLabel?: string;
  askMode?: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setNotice(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(askMode ? { question } : {}) }),
      });
      const data: AiResponse = await res.json();
      if (data.configured === false) {
        setNotice(data.message ?? 'AI assistance is not configured. Set ANTHROPIC_API_KEY to enable it.');
      } else if (data.error) {
        setNotice(data.error);
      } else {
        setResult(data.result ?? '');
      }
    } catch {
      setNotice('The assistant could not be reached. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-midblue">✦</span>
            {title}
          </CardTitle>
          <p className="text-xs text-charcoal/50 mt-0.5">{description}</p>
        </div>
        {!askMode && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={generate}>
            {busy ? 'Thinking…' : buttonLabel}
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {askMode && (
          <form
            className="flex gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) generate();
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which units are dragging the group score, and why?"
              aria-label="Question for the data"
            />
            <Button type="submit" disabled={busy || !question.trim()}>
              {busy ? 'Thinking…' : 'Ask'}
            </Button>
          </form>
        )}
        {notice && (
          <p className="text-sm bg-rag-amber-bg text-rag-amber rounded-lg px-3 py-2">{notice}</p>
        )}
        {result !== null && (
          <div className="space-y-2">
            <div className="text-sm text-charcoal/80 whitespace-pre-wrap bg-surface rounded-lg p-3 border border-line">
              {result}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <span className="text-xs text-charcoal/40">
                Grounded in the computed scorecard. Review before you use it.
              </span>
            </div>
          </div>
        )}
        {result === null && !notice && !askMode && (
          <p className="text-sm text-charcoal/50">
            Nothing generated yet. The assistant only reads the computed scorecard; it never
            writes anything on its own.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
