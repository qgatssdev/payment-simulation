import type { PaymentEventView, PaymentStatus } from '@payment-sim/shared';
import { PAYMENT_TRANSITIONS } from '@payment-sim/shared';
import { STATUS_LABEL } from './status-badge';

const NODE_W = 120;
const NODE_H = 38;
const COL = 160;
const ROW = 84;
const PAD = 8;

/** Lifecycle layout: the happy path left to right, the alternative endings beneath. */
const POSITION: Record<PaymentStatus, [col: number, row: number]> = {
  PENDING: [0, 0],
  PROCESSING: [1, 0],
  SUCCEEDED: [2, 0],
  REFUNDED: [3, 0],
  CANCELLED: [0, 1],
  FAILED: [1, 1],
};

const center = (s: PaymentStatus) => {
  const [c, r] = POSITION[s];
  return { x: PAD + c * COL + NODE_W / 2, y: PAD + r * ROW + NODE_H / 2 };
};

/** Edge from one box's border to the next's, along the line between their centres. */
function edge(from: PaymentStatus, to: PaymentStatus) {
  const a = center(from);
  const b = center(to);
  const horizontal = a.y === b.y;
  return horizontal
    ? { x1: a.x + NODE_W / 2, y1: a.y, x2: b.x - NODE_W / 2 - 4, y2: b.y }
    : { x1: a.x, y1: a.y + NODE_H / 2, x2: b.x, y2: b.y - NODE_H / 2 - 4 };
}

/**
 * The shared state machine, drawn from the same transition table the API enforces, with this
 * payment's path through it highlighted and its current status emphasised.
 */
export function StateMachineDiagram({
  status,
  events,
}: {
  status: PaymentStatus;
  events: PaymentEventView[];
}) {
  const visited = new Set<PaymentStatus>([status]);
  const taken = new Set<string>();
  for (const e of events) {
    if (e.toStatus) visited.add(e.toStatus);
    if (e.fromStatus && e.toStatus) taken.add(`${e.fromStatus}>${e.toStatus}`);
  }
  const width = PAD * 2 + 3 * COL + NODE_W;
  const height = PAD * 2 + ROW + NODE_H;
  const path = events.filter((e) => e.toStatus).map((e) => STATUS_LABEL[e.toStatus!]);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Payment lifecycle. Current status: ${STATUS_LABEL[status]}. Path so far: ${path.join(' → ')}.`}
      >
        <defs>
          {['line', 'accent'].map((tone) => (
            <marker
              key={tone}
              id={`arrow-${tone}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                fill={`var(--${tone === 'line' ? 'ink-3' : 'accent'})`}
              />
            </marker>
          ))}
        </defs>
        {PAYMENT_TRANSITIONS.map(({ from, to, actor }) => {
          const isTaken = taken.has(`${from}>${to}`);
          return (
            <line
              key={`${from}-${to}`}
              {...edge(from, to)}
              stroke={isTaken ? 'var(--accent)' : 'var(--ink-3)'}
              strokeWidth={isTaken ? 2 : 1}
              strokeDasharray={actor === 'client' ? '4 3' : undefined}
              markerEnd={`url(#arrow-${isTaken ? 'accent' : 'line'})`}
              opacity={isTaken ? 1 : 0.6}
            />
          );
        })}
        {(Object.keys(POSITION) as PaymentStatus[]).map((s) => {
          const [c, r] = POSITION[s];
          const current = s === status;
          const seen = visited.has(s);
          return (
            <g key={s}>
              <rect
                x={PAD + c * COL}
                y={PAD + r * ROW}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={current ? 'var(--accent)' : 'var(--surface)'}
                stroke={current ? 'var(--accent)' : seen ? 'var(--ink-2)' : 'var(--line)'}
                strokeWidth={current ? 2 : 1}
              />
              <text
                x={PAD + c * COL + NODE_W / 2}
                y={PAD + r * ROW + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={current ? 600 : 500}
                fill={current ? '#ffffff' : seen ? 'var(--ink)' : 'var(--ink-3)'}
              >
                {STATUS_LABEL[s]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span>
          <svg width="22" height="6" aria-hidden className="mr-1 inline">
            <line x1="0" x2="22" y1="3" y2="3" stroke="var(--ink-3)" />
          </svg>
          Worker (system) transition
        </span>
        <span>
          <svg width="22" height="6" aria-hidden className="mr-1 inline">
            <line
              x1="0"
              x2="22"
              y1="3"
              y2="3"
              stroke="var(--ink-3)"
              strokeDasharray="4 3"
            />
          </svg>
          Client action (cancel, refund)
        </span>
        <span>
          <svg width="22" height="6" aria-hidden className="mr-1 inline">
            <line x1="0" x2="22" y1="3" y2="3" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          Path this payment took
        </span>
      </figcaption>
    </figure>
  );
}
