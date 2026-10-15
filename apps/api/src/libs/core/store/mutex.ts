/**
 * FIFO async mutex. Node runs one callback at a time, but an async function yields at every
 * await; without this, two transactions could interleave their reads and writes.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Resolves with a release function once every earlier holder has released. */
  lock(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const acquired = this.tail.then(() => release);
    this.tail = this.tail.then(() => held);
    return acquired;
  }
}
