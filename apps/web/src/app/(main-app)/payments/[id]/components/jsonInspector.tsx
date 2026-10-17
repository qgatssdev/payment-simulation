'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { CopyButton } from '@/components/ui/copyButton';
import { cn } from '@/lib/utils';

/** Pretty JSON, keys and punctuation receding so values read first. Monochrome by design. */
function Json({ value, indent = 0 }: { value: unknown; indent?: number }): ReactNode {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (value === null) return <span className="text-ink-3">null</span>;
  if (typeof value === 'string')
    return <span className="text-ink">&quot;{value}&quot;</span>;
  if (typeof value !== 'object') {
    return <span className="font-medium text-ink">{JSON.stringify(value)}</span>;
  }
  const entries = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  if (entries.length === 0)
    return <span className="text-ink-3">{Array.isArray(value) ? '[]' : '{}'}</span>;
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <>
      <span className="text-ink-3">{open}</span>
      {'\n'}
      {entries.map(([k, v], i) => (
        <span key={k}>
          {inner}
          {!Array.isArray(value) && (
            <>
              <span className="text-ink-2">&quot;{k}&quot;</span>
              <span className="text-ink-3">: </span>
            </>
          )}
          <Json value={v} indent={indent + 1} />
          {i < entries.length - 1 && <span className="text-ink-3">,</span>}
          {'\n'}
        </span>
      ))}
      {pad}
      <span className="text-ink-3">{close}</span>
    </>
  );
}

export interface InspectorTab {
  id: string;
  label: string;
  /** A one-line summary above the body, e.g. "POST /api/v1/payments". */
  summary?: ReactNode;
  value: unknown;
}

/** Request, response and resource bodies in tabs, each with a copy button. */
export function JsonInspector({ tabs, label }: { tabs: InspectorTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  const text = JSON.stringify(tab.value, null, 2);
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={cn(
              'pressable h-8 shrink-0 rounded-[10px] px-3 text-[13px] font-medium',
              t.id === tab.id
                ? 'bg-brand-wash text-brand-ink'
                : 'text-ink-2 hover:bg-sunken hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab.id}`}
        aria-labelledby={`tab-${tab.id}`}
        className="mt-3 overflow-hidden rounded-2xl bg-panel-2"
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3 text-xs text-ink-2">
          <span className="min-w-0 truncate font-mono">{tab.summary}</span>
          <CopyButton value={text} label={`Copy ${tab.label.toLowerCase()} JSON`} />
        </div>
        <pre className="max-h-[420px] overflow-auto px-4 pt-1 pb-4 font-mono text-[12px] leading-[1.65]">
          <Json value={tab.value} />
        </pre>
      </div>
    </div>
  );
}
