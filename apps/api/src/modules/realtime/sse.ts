import type { Response } from 'express';
import { ServiceUnavailableError } from '../../libs/core/errors';

export interface SseFrame {
  id?: number;
  event: string;
  data: unknown;
}

/** Tells EventSource how long to wait before reconnecting after a drop. */
const CLIENT_RETRY_MS = 3_000;

/**
 * One Server-Sent Events response. Frames are written as they come; a comment line every
 * heartbeat keeps proxies and load balancers from closing an idle connection and lets us
 * notice dead clients.
 */
export class SseStream {
  private closed = false;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(
    private readonly res: Response,
    heartbeatMs: number,
  ) {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable response buffering in nginx-style proxies.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${CLIENT_RETRY_MS}\n\n`);
    this.heartbeat = setInterval(() => this.comment('ping'), heartbeatMs);
    res.on('close', () => this.dispose());
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send({ id, event, data }: SseFrame): void {
    if (this.closed) return;
    const idLine = id === undefined ? '' : `id: ${id}\n`;
    this.res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  comment(text: string): void {
    if (!this.closed) this.res.write(`: ${text}\n\n`);
  }

  onClose(handler: () => void): void {
    if (this.closed) handler();
    else this.closeHandlers.push(handler);
  }

  close(): void {
    if (this.closed) return;
    this.dispose();
    this.res.end();
  }

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const handler of this.closeHandlers.splice(0)) handler();
  }
}

/** Every open stream in this process: enforces a cap and closes them all on shutdown. */
export class SseRegistry {
  private readonly streams = new Set<SseStream>();

  constructor(
    private readonly maxClients: number,
    private readonly heartbeatMs: number,
  ) {}

  get size(): number {
    return this.streams.size;
  }

  open(res: Response): SseStream {
    if (this.streams.size >= this.maxClients) {
      throw new ServiceUnavailableError(
        'Too many live connections, please retry shortly',
        5,
      );
    }
    const stream = new SseStream(res, this.heartbeatMs);
    this.streams.add(stream);
    stream.onClose(() => this.streams.delete(stream));
    return stream;
  }

  /** Without this, open streams would hold server.close() until the shutdown timeout. */
  closeAll(): void {
    for (const stream of [...this.streams]) stream.close();
  }
}
