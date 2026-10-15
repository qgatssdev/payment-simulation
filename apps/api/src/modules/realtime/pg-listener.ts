import { Client } from 'pg';
import type { Logger } from '../../libs/core/logger/logger';

export interface PgListenerOptions {
  /** Must be a direct connection: LISTEN does not survive a transaction-mode pooler. */
  connectionString: string;
  channels: readonly string[];
  logger: Logger;
  onNotification(channel: string, payload: string): void;
  /** Called after every successful (re)connect, so callers can catch up on anything missed. */
  onConnected?(info: { reconnect: boolean }): void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export const LISTENER_APPLICATION_NAME = 'payment-api-listener';

/**
 * One long-lived connection per process holding LISTEN on the given channels. Never throws
 * once constructed: connection failures are logged and retried with capped exponential
 * backoff, and the API keeps serving REST while realtime is degraded.
 */
export class PgListener {
  private client: Client | undefined;
  private stopped = true;
  private failures = 0;
  private everConnected = false;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: PgListenerOptions) {}

  get connected(): boolean {
    return this.client !== undefined;
  }

  /** Resolves after the first connection attempt, whether or not it succeeded. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const { connectionString, channels, logger } = this.options;
    const client = new Client({
      connectionString,
      application_name: LISTENER_APPLICATION_NAME,
      keepAlive: true,
    });
    client.on('notification', (msg) => {
      this.options.onNotification(msg.channel, msg.payload ?? '');
    });
    client.on('error', (err) => {
      logger.warn({ err }, 'realtime listener connection error');
      this.onDisconnect(client);
    });
    client.on('end', () => this.onDisconnect(client));

    try {
      await client.connect();
      for (const channel of channels) {
        await client.query(`LISTEN ${client.escapeIdentifier(channel)}`);
      }
    } catch (err) {
      logger.warn(
        { err, attempt: this.failures + 1 },
        'realtime listener could not connect',
      );
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
      return;
    }

    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    const reconnect = this.everConnected;
    this.client = client;
    this.failures = 0;
    this.everConnected = true;
    logger.info({ channels, reconnect }, 'realtime listener connected');
    this.options.onConnected?.({ reconnect });
  }

  private onDisconnect(client: Client): void {
    if (client !== this.client) return; // a failed attempt, or an old client already replaced
    this.client = undefined;
    if (!this.stopped) {
      this.options.logger.warn('realtime listener disconnected; reconnecting');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const { reconnectBaseMs = 500, reconnectMaxMs = 30_000 } = this.options;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** this.failures);
    this.failures += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
