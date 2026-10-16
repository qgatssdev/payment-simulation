'use client';

import type { PaymentStreamMessage } from '@payment-sim/shared';
import {
  PAYMENT_TRANSITIONS,
  PaymentEventType,
  PaymentFailureCode,
  PaymentStatus,
} from '@payment-sim/shared';
import { Repeat } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';
import { REASON, STATUS } from '@/lib/vocabulary';
import { NumberTicker } from '../ui/number-ticker';

type Point = { x: number; y: number };
type Layout = {
  height: number;
  nodes: Record<PaymentStatus, Point>;
  entry: Point;
  /** Which way an edge leaves its node: along a row, or down a column. */
  orientation: 'wide' | 'narrow';
};

const R = 24; // node radius
const LABEL_H = 54; // name and count under each node
const WIDE = 760;

/**
 * Wide: the money path left to right (Pending → Processing → Succeeded → Refunded), the two
 * other endings on a lower row, each directly under the state it leaves. Narrow (phones): two columns, the worker's path down the left,
 * each state's alternative to its right, so labels never collide with edges.
 */
function layoutFor(width: number): Layout {
  if (width >= WIDE) {
    const col = (i: number) => width * [0.13, 0.38, 0.63, 0.88][i]!;
    return {
      orientation: 'wide',
      height: 300,
      entry: { x: 0, y: 72 },
      nodes: {
        PENDING: { x: col(0), y: 72 },
        PROCESSING: { x: col(1), y: 72 },
        SUCCEEDED: { x: col(2), y: 72 },
        REFUNDED: { x: col(3), y: 72 },
        CANCELLED: { x: col(0), y: 212 },
        FAILED: { x: col(1), y: 212 },
      },
    };
  }
  const left = Math.max(70, width * 0.27);
  const right = width * 0.73;
  return {
    orientation: 'narrow',
    height: 440,
    entry: { x: left, y: 0 },
    nodes: {
      PENDING: { x: left, y: 56 },
      CANCELLED: { x: right, y: 56 },
      PROCESSING: { x: left, y: 196 },
      FAILED: { x: right, y: 196 },
      SUCCEEDED: { x: left, y: 336 },
      REFUNDED: { x: right, y: 336 },
    },
  };
}

function edgePath(layout: Layout, from: PaymentStatus, to: PaymentStatus): string {
  const a = layout.nodes[from];
  const b = layout.nodes[to];
  if (a.y === b.y) return `M${a.x + R + 6},${a.y} L${b.x - R - 9},${b.y}`;
  // Straight down: start below the node's name and count, not through them.
  if (a.x === b.x) return `M${a.x},${a.y + R + LABEL_H} L${b.x},${b.y - R - 9}`;
  // Down a row and across: an elbow with a soft corner.
  return `M${a.x},${a.y + R + 6} C${a.x},${b.y} ${a.x},${b.y} ${a.x + 48},${b.y} L${b.x - R - 9},${b.y}`;
}

function entryPath(layout: Layout): string {
  const p = layout.nodes.PENDING;
  return layout.orientation === 'wide'
    ? `M${layout.entry.x + 4},${p.y} L${p.x - R - 9},${p.y}`
    : `M${p.x},${layout.entry.y + 2} L${p.x},${p.y - R - 9}`;
}

/** A loop out of Processing and back: where retried attempts circle. */
function retryPath(layout: Layout): string {
  const p = layout.nodes.PROCESSING;
  if (layout.orientation === 'wide') {
    return `M${p.x - 12},${p.y - R - 2} C${p.x - 34},${p.y - R - 52} ${p.x + 34},${p.y - R - 52} ${p.x + 12},${p.y - R - 4}`;
  }
  return `M${p.x - R - 2},${p.y - 12} C${p.x - R - 52},${p.y - 34} ${p.x - R - 52},${p.y + 34} ${p.x - R - 4},${p.y + 12}`;
}

const ORDER: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
];

const DOT_MS = 900;
const MAX_DOTS = 80;

/**
 * Moving dots, drawn imperatively: dozens at 60 fps without re-rendering React. Owns the
 * edge paths and node elements it animates (registered through ref callbacks).
 */
class DotEngine {
  private root: HTMLElement | null = null;
  private dots: Array<{
    el: SVGCircleElement;
    path: SVGPathElement;
    start: number;
    target?: string;
  }> = [];
  private frame = 0;

  /** The container holding the track; edges, nodes and the dot layer are found by data-*. */
  mount(root: HTMLElement | null) {
    this.root = root;
  }

  handle(message: PaymentStreamMessage) {
    const { event } = message;
    if (event.type === PaymentEventType.CREATED) {
      this.launch('entry', STATUS.PENDING.color, PaymentStatus.PENDING);
    } else if (event.type === PaymentEventType.ATTEMPT_FAILED) {
      const code =
        (event.metadata.code as PaymentFailureCode | undefined) ??
        PaymentFailureCode.PROCESSING_ERROR;
      this.launch(
        'retry',
        (REASON[code] ?? REASON.processing_error).color,
        PaymentStatus.PROCESSING,
      );
    } else if (event.fromStatus && event.toStatus) {
      this.launch(
        `${event.fromStatus}>${event.toStatus}`,
        STATUS[event.toStatus].color,
        event.toStatus,
      );
    }
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const dot of this.dots) dot.el.remove();
    this.dots = [];
  }

  private pulse(status: PaymentStatus) {
    const color = STATUS[status].color;
    this.root
      ?.querySelector<HTMLElement>(`[data-node="${status}"]`)
      ?.animate(
        [
          { boxShadow: `0 0 0 0 color-mix(in oklab, ${color} 45%, transparent)` },
          { boxShadow: `0 0 0 14px color-mix(in oklab, ${color} 0%, transparent)` },
        ],
        { duration: 700, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
  }

  private launch(edge: string, color: string, target: PaymentStatus) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.pulse(target);
      return;
    }
    const path = this.root?.querySelector<SVGPathElement>(`[data-edge="${edge}"]`);
    const layer = this.root?.querySelector<SVGGElement>('[data-dots]');
    if (!path || !layer || this.dots.length >= MAX_DOTS) return;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', '5');
    el.setAttribute('fill', color);
    el.setAttribute('stroke', 'var(--panel)');
    el.setAttribute('stroke-width', '2');
    layer.appendChild(el);
    this.dots.push({ el, path, start: performance.now(), target });
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.dots = this.dots.filter((dot) => {
      const t = Math.min(1, (now - dot.start) / DOT_MS);
      const eased = 1 - (1 - t) ** 3;
      const point = dot.path.getPointAtLength(eased * dot.path.getTotalLength());
      dot.el.setAttribute('cx', String(point.x));
      dot.el.setAttribute('cy', String(point.y));
      dot.el.setAttribute('opacity', String(t > 0.85 ? (1 - t) / 0.15 : 1));
      if (t >= 1) {
        dot.el.remove();
        if (dot.target) this.pulse(dot.target as PaymentStatus);
        return false;
      }
      return true;
    });
    this.frame = this.dots.length ? requestAnimationFrame(this.tick) : 0;
  };
}

/**
 * The signature view: the shared state machine drawn as a track. Each state shows how many
 * payments are in it now; as events stream in, a dot in the destination's colour travels the
 * edge it took, and the node it reaches pulses. Retried attempts circle the loop above
 * Processing in the colour of their failure reason.
 */
export function Pipeline({
  counts,
  retries,
}: {
  counts: Record<PaymentStatus, number> | undefined;
  /** Retried attempts in the selected window, shown on the loop. */
  retries: number | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [engine] = useState(() => new DotEngine());
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    engine.mount(box.current);
    return () => engine.stop();
  }, [engine]);
  useLiveEvents((message) => engine.handle(message));

  const layout = layoutFor(width || 1000);
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  const retryLabel = (() => {
    const p = layout.nodes.PROCESSING;
    return layout.orientation === 'wide'
      ? { left: p.x + 30, top: p.y - R - 52 }
      : { left: p.x - R - 74, top: p.y - 46 };
  })();

  return (
    <figure className="relative" aria-labelledby="pipeline-caption">
      <figcaption id="pipeline-caption" className="sr-only">
        Payments by status, now:{' '}
        {ORDER.map((s) => `${STATUS[s].label} ${counts?.[s] ?? 0}`).join(', ')}.
      </figcaption>
      <div ref={box} className="relative w-full" style={{ height: layout.height }}>
        {width > 0 && (
          <svg
            width={width}
            height={layout.height}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            <defs>
              <marker
                id="pipeline-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M1,1 L9,5 L1,9"
                  fill="none"
                  stroke="var(--axis)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            <path
              data-edge={'entry'}
              d={entryPath(layout)}
              fill="none"
              stroke="var(--axis)"
              strokeWidth={1.5}
              strokeDasharray="1 5"
              strokeLinecap="round"
              markerEnd="url(#pipeline-arrow)"
            />
            <path
              data-edge={'retry'}
              d={retryPath(layout)}
              fill="none"
              stroke="var(--axis)"
              strokeWidth={1.5}
              markerEnd="url(#pipeline-arrow)"
            />
            {PAYMENT_TRANSITIONS.map(({ from, to, actor }) => (
              <path
                key={`${from}>${to}`}
                data-edge={`${from}>${to}`}
                d={edgePath(layout, from, to)}
                fill="none"
                stroke="var(--axis)"
                strokeWidth={1.5}
                strokeDasharray={actor === 'client' ? '5 5' : undefined}
                strokeLinecap="round"
                markerEnd="url(#pipeline-arrow)"
              />
            ))}
            <g data-dots="" />
          </svg>
        )}

        {width > 0 && (
          <span
            className="absolute flex items-center gap-1 text-xs text-ink-3"
            style={retryLabel}
            title="Gateway attempts that failed and were retried with backoff, in the selected window"
          >
            <Repeat className="size-3" aria-hidden />
            <span className="tabular-nums">
              {retries === undefined ? '—' : formatCount(retries)}
            </span>{' '}
            retries
          </span>
        )}

        {width > 0 &&
          ORDER.map((status) => (
            <PipelineNode
              key={status}
              status={status}
              at={layout.nodes[status]}
              count={counts?.[status]}
              total={total}
            />
          ))}
      </div>
      <div
        className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2"
        aria-hidden
      >
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="6">
            <line x1="0" x2="24" y1="3" y2="3" stroke="var(--axis)" strokeWidth="1.5" />
          </svg>
          Worker moves it
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="6">
            <line
              x1="0"
              x2="24"
              y1="3"
              y2="3"
              stroke="var(--axis)"
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
          </svg>
          Client cancels or refunds
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="12" height="12">
            <circle
              cx="6"
              cy="6"
              r="4"
              fill="var(--status-processing)"
              stroke="var(--panel)"
              strokeWidth="2"
            />
          </svg>
          A payment in motion, in its new status’s colour
        </span>
      </div>
    </figure>
  );
}

/** One state on the track: its mark (which pulses when a payment arrives), name and count. */
function PipelineNode({
  status,
  at,
  count,
  total,
}: {
  status: PaymentStatus;
  at: Point;
  count: number | undefined;
  total: number;
}) {
  const [hover, setHover] = useState(false);
  const term = STATUS[status];
  const Icon = term.icon;
  const n = count ?? 0;
  const share = total ? Math.round((n / total) * 100) : 0;
  return (
    <div
      className="absolute flex w-[150px] -translate-x-1/2 flex-col items-center text-center"
      style={{ left: at.x, top: at.y - R }}
    >
      <span
        data-node={status}
        tabIndex={0}
        role="img"
        aria-label={`${term.label}: ${formatCount(n)} payments now. ${term.description}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="flex size-12 items-center justify-center rounded-full outline-offset-4"
        style={{
          backgroundColor: `color-mix(in oklab, ${term.color} 14%, var(--panel))`,
        }}
      >
        <Icon
          className={cn(
            'size-5',
            status === PaymentStatus.PROCESSING &&
              n > 0 &&
              'animate-spin [animation-duration:1.6s]',
          )}
          style={{ color: term.color }}
          aria-hidden
        />
      </span>
      <span className="mt-2 text-[13px] font-medium text-ink-2">{term.label}</span>
      <span
        className={cn(
          'text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink',
          count === undefined && 'text-ink-3',
        )}
      >
        {count === undefined ? '—' : <NumberTicker value={n} />}
      </span>
      {hover && (
        <span
          role="tooltip"
          className="absolute top-[-58px] z-10 w-[230px] animate-pop-in rounded-xl bg-panel px-3 py-2 text-left text-xs shadow-float"
        >
          <span className="block font-semibold text-ink">
            {formatCount(n)} {term.label.toLowerCase()} · {share}% of all
          </span>
          <span className="mt-0.5 block text-ink-2">{term.description}</span>
        </span>
      )}
    </div>
  );
}
