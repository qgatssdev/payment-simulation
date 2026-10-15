import type { Logger } from '../../../libs/core/logger/logger';

/** A dependency the service cannot serve traffic without (e.g. the database). */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, CheckResult>;
}

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
  version: string;
}

export class HealthService {
  constructor(
    private readonly checks: readonly ReadinessCheck[],
    private readonly logger: Logger,
    private readonly version: string,
    private readonly timeoutMs = 2000,
  ) {}

  /** Liveness: the process is up and the event loop answers. Never touches dependencies. */
  liveness(): LivenessReport {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      version: this.version,
    };
  }

  /**
   * Readiness: every dependency answered within the timeout. Failure reasons are logged but
   * not returned, so a public probe endpoint does not leak infrastructure details.
   */
  async readiness(): Promise<ReadinessReport> {
    const entries = await Promise.all(
      this.checks.map(async (c) => [c.name, await this.run(c)] as const),
    );
    return {
      ready: entries.every(([, result]) => result.status === 'up'),
      checks: Object.fromEntries(entries),
    };
  }

  private async run(check: ReadinessCheck): Promise<CheckResult> {
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
      return { status: 'up', latencyMs: elapsed(startedAt) };
    } catch (err) {
      this.logger.warn({ err, check: check.name }, 'readiness check failed');
      return { status: 'down', latencyMs: elapsed(startedAt) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
