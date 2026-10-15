import type { IncomingHttpHeaders, Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface SseEvent {
  id?: string;
  event: string;
  data: unknown;
}

export interface SseConnection {
  status: number;
  headers: IncomingHttpHeaders;
  /** Parsed events, in arrival order. */
  events: SseEvent[];
  comments: string[];
  /** Raw body for non-stream responses (errors). */
  body(): string;
  /** Resolve with the next event (after those already consumed) matching `predicate`. */
  next(predicate?: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
  /** Resolve once the server ends the stream. */
  ended: Promise<void>;
  close(): void;
}

/** A real HTTP server on an ephemeral port: SSE needs a live socket, not supertest's buffering. */
export async function listen(app: Express): Promise<{ baseUrl: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

export async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

/** Minimal EventSource for tests: parses frames and lets a test await specific events. */
export function openSse(
  url: string,
  headers: Record<string, string> = {},
): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { headers: { Accept: 'text/event-stream', ...headers } },
      (res) => {
        const events: SseEvent[] = [];
        const comments: string[] = [];
        let raw = '';
        let buffer = '';
        let consumed = 0;
        const waiters: Array<() => void> = [];
        let endResolve: () => void = () => undefined;
        const ended = new Promise<void>((r) => (endResolve = r));

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          raw += chunk;
          buffer += chunk;
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const fields: Record<string, string> = {};
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) comments.push(line.slice(1).trim());
              else {
                const sep = line.indexOf(':');
                fields[line.slice(0, sep)] = line.slice(sep + 1).trimStart();
              }
            }
            if (fields.data !== undefined) {
              events.push({
                id: fields.id,
                event: fields.event ?? 'message',
                data: JSON.parse(fields.data) as unknown,
              });
              waiters.splice(0).forEach((w) => w());
            }
          }
        });
        res.on('end', () => endResolve());
        res.on('close', () => endResolve());

        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          events,
          comments,
          body: () => raw,
          ended,
          close: () => req.destroy(),
          next(predicate = () => true, timeoutMs = 5_000) {
            return new Promise<SseEvent>((resolveNext, rejectNext) => {
              const timer = setTimeout(
                () =>
                  rejectNext(new Error(`no matching SSE event within ${timeoutMs}ms`)),
                timeoutMs,
              );
              const check = () => {
                while (consumed < events.length) {
                  const event = events[consumed++] as SseEvent;
                  if (predicate(event)) {
                    clearTimeout(timer);
                    resolveNext(event);
                    return;
                  }
                }
                waiters.push(check);
              };
              check();
            });
          },
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
