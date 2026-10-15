import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '../logger/logger';
import type { SnapshotWriter } from './json-file';
import {
  AtomicFileWriter,
  acquireLock,
  ensureDirectory,
  readIfExists,
} from './json-file';
import { cloneRecord } from './clone';
import { Mutex } from './mutex';
import { StorageUnavailableError, StoreLoadError } from './store.errors';

/** How one collection's records are keyed, and which fields are Dates on the way back in. */
export interface CollectionDefinition<R> {
  key: keyof R & string;
  dates?: ReadonlyArray<keyof R & string>;
}

export type CollectionDefinitions<C> = { [K in keyof C]: CollectionDefinition<C[K]> };

export interface JsonStoreOptions<C> {
  collections: CollectionDefinitions<C>;
  /** Snapshot format identifier; a file with a different one is refused. */
  format: string;
  /** JSON file to load from and persist to. Omit for a purely in-memory store. */
  file?: string;
  logger: Logger;
  /** Override how snapshots are written (tests inject failures). */
  writer?: SnapshotWriter;
  /** Time source for record timestamps; injectable for deterministic tests. */
  clock?: () => Date;
}

interface Snapshot {
  format: string;
  savedAt: string;
  sequences: Record<string, number>;
  collections: Record<string, unknown[]>;
}

const DELETED = Symbol('deleted');
type Slot = object | typeof DELETED;

/** Everything a unit of work can do; changes become visible to others only on commit. */
export interface Transaction<C> {
  get<K extends keyof C>(name: K, key: string): C[K] | undefined;
  find<K extends keyof C>(
    name: K,
    predicate?: (record: Readonly<C[K]>) => boolean,
  ): C[K][];
  put<K extends keyof C>(name: K, record: C[K]): void;
  delete<K extends keyof C>(name: K, key: string): void;
  /** Next value of a named, strictly increasing counter (committed with the transaction). */
  nextSequence(name: string): number;
  /** Run after the transaction is committed and durable, e.g. to notify subscribers. */
  afterCommit(hook: () => void): void;
}

/**
 * A small transactional document store persisted as one JSON file.
 *
 * - Write transactions are serialized by a mutex and buffer their changes in an overlay: reads
 *   inside a transaction see its own writes; a throw discards the overlay (rollback); commit
 *   applies it in one synchronous step, so no reader ever sees half a transaction.
 * - Durability by group commit: a transaction resolves only once a snapshot containing it has
 *   been written atomically. Transactions committing while a write is in flight share the next
 *   write, so throughput does not collapse to one fsync per request.
 * - Everything handed in or out is cloned: callers cannot mutate stored state behind its back.
 */
export class JsonStore<C extends { [K in keyof C]: object }> {
  private readonly data = new Map<keyof C, Map<string, object>>();
  private readonly sequences = new Map<string, number>();
  private readonly mutex = new Mutex();
  private readonly context = new AsyncLocalStorage<StoreTransaction<C>>();
  private readonly writer: SnapshotWriter | undefined;

  private committedGeneration = 0;
  private flushedGeneration = 0;
  private flushing: Promise<void> | undefined;
  private waiters: Array<{
    generation: number;
    resolve: () => void;
    reject: (e: Error) => void;
  }> = [];
  private lastFlushError: Error | undefined;
  private releaseLock: (() => Promise<void>) | undefined;
  private flushCount = 0;
  /** The clock repositories use for createdAt/updatedAt. */
  readonly now: () => Date;

  private constructor(private readonly options: JsonStoreOptions<C>) {
    for (const name of Object.keys(options.collections) as Array<keyof C>) {
      this.data.set(name, new Map());
    }
    this.writer = options.file
      ? (options.writer ?? new AtomicFileWriter(options.file))
      : undefined;
    this.now = options.clock ?? (() => new Date());
  }

  static async open<C extends { [K in keyof C]: object }>(
    options: JsonStoreOptions<C>,
  ): Promise<JsonStore<C>> {
    const store = new JsonStore(options);
    if (options.file) {
      await ensureDirectory(options.file);
      store.releaseLock = await acquireLock(options.file);
      try {
        await store.load(options.file);
      } catch (err) {
        await store.releaseLock();
        throw err;
      }
    }
    return store;
  }

  get persistent(): boolean {
    return this.writer !== undefined;
  }

  /** False after a failed write until a later write succeeds. */
  get healthy(): boolean {
    return this.lastFlushError === undefined;
  }

  /** Snapshot writes performed so far (observability and tests). */
  get flushes(): number {
    return this.flushCount;
  }

  /**
   * The transaction this async flow is inside, if it is still open. A promise started inside a
   * transaction can outlive it; once the transaction has ended it must not be joined.
   */
  private active(): StoreTransaction<C> | undefined {
    const current = this.context.getStore();
    return current && !current.closed ? current : undefined;
  }

  // --- reads outside a transaction: committed state -------------------------------------

  get<K extends keyof C>(name: K, key: string): C[K] | undefined {
    const current = this.active();
    if (current) return current.get(name, key);
    const record = this.collection(name).get(key);
    return record === undefined ? undefined : (cloneRecord(record) as C[K]);
  }

  find<K extends keyof C>(
    name: K,
    predicate?: (record: Readonly<C[K]>) => boolean,
  ): C[K][] {
    const current = this.active();
    if (current) return current.find(name, predicate);
    const matches: C[K][] = [];
    for (const record of this.collection(name).values()) {
      if (!predicate || predicate(record as C[K]))
        matches.push(cloneRecord(record) as C[K]);
    }
    return matches;
  }

  count<K extends keyof C>(name: K): number {
    return this.collection(name).size;
  }

  // --- writes ------------------------------------------------------------------------

  /**
   * Run `work` as one atomic unit. Called while already inside a transaction (in the same async
   * flow), it joins that transaction instead of deadlocking on the mutex.
   */
  async transaction<T>(work: (tx: Transaction<C>) => Promise<T> | T): Promise<T> {
    const current = this.active();
    if (current) return work(current);

    const release = await this.mutex.lock();
    const tx = new StoreTransaction(this.data, this.sequences, this.options.collections);
    let result: T;
    let generation: number;
    try {
      result = await this.context.run(tx, () => work(tx));
      generation = this.commit(tx);
    } finally {
      // Committed or rolled back, it is over: late async work must not write into it.
      tx.closed = true;
      release();
    }

    await this.durable(generation);
    for (const hook of tx.hooks) {
      try {
        hook();
      } catch (err) {
        this.options.logger.error({ err }, 'after-commit hook failed');
      }
    }
    return result;
  }

  /** Write pending changes now. Rejects if the write fails (readiness uses this). */
  flush(): Promise<void> {
    return this.durable(this.committedGeneration);
  }

  /** Final flush, then release the file lock. */
  async close(): Promise<void> {
    try {
      if (this.persistent) await this.flush();
    } finally {
      await this.releaseLock?.();
      this.releaseLock = undefined;
    }
  }

  private collection<K extends keyof C>(name: K): Map<string, object> {
    const collection = this.data.get(name);
    if (!collection) throw new Error(`Unknown collection ${String(name)}`);
    return collection;
  }

  /** Synchronous, so the whole overlay lands between two turns of the event loop. */
  private commit(tx: StoreTransaction<C>): number {
    if (!tx.dirty) return this.committedGeneration;
    for (const [name, slots] of tx.overlay) {
      const collection = this.collection(name);
      for (const [key, slot] of slots) {
        if (slot === DELETED) collection.delete(key);
        else collection.set(key, slot);
      }
    }
    for (const [name, value] of tx.sequences) this.sequences.set(name, value);
    return ++this.committedGeneration;
  }

  private durable(generation: number): Promise<void> {
    if (!this.writer || generation <= this.flushedGeneration) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiters.push({ generation, resolve, reject });
      this.flushing ??= this.flushLoop().finally(() => {
        this.flushing = undefined;
      });
    });
  }

  private async flushLoop(): Promise<void> {
    while (this.flushedGeneration < this.committedGeneration) {
      const target = this.committedGeneration;
      const contents = this.serialize();
      try {
        await (this.writer as SnapshotWriter).write(contents);
      } catch (err) {
        this.lastFlushError = err as Error;
        this.options.logger.error(
          { err, file: this.options.file },
          'snapshot write failed',
        );
        this.settle(target, new StorageUnavailableError({ cause: err }));
        return; // retried by the next commit, flush() or close()
      }
      this.flushCount++;
      this.flushedGeneration = target;
      if (this.lastFlushError) this.options.logger.info('snapshot writes recovered');
      this.lastFlushError = undefined;
      this.settle(target);
    }
  }

  private settle(upTo: number, error?: Error): void {
    const remaining: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (waiter.generation > upTo) remaining.push(waiter);
      else if (error) waiter.reject(error);
      else waiter.resolve();
    }
    this.waiters = remaining;
  }

  private serialize(): string {
    const snapshot: Snapshot = {
      format: this.options.format,
      savedAt: new Date().toISOString(),
      sequences: Object.fromEntries(this.sequences),
      collections: Object.fromEntries(
        [...this.data].map(([name, records]) => [name as string, [...records.values()]]),
      ),
    };
    return `${JSON.stringify(snapshot, null, 2)}\n`;
  }

  private async load(file: string): Promise<void> {
    const raw = await readIfExists(file);
    if (raw === undefined) {
      this.options.logger.info({ file }, 'no data file yet; starting empty');
      return;
    }

    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(raw) as Snapshot;
    } catch (err) {
      throw new StoreLoadError(
        `${file} is not valid JSON; refusing to start so it is not overwritten`,
        { cause: err },
      );
    }
    if (snapshot?.format !== this.options.format) {
      throw new StoreLoadError(
        `${file} has format "${String(snapshot?.format)}", expected "${this.options.format}"`,
      );
    }

    // Untyped from here on: the file is just JSON until each record is checked.
    for (const [name, definition] of Object.entries(this.options.collections) as Array<
      [keyof C, { key: string; dates?: readonly string[] }]
    >) {
      const records = snapshot.collections?.[name as string] ?? [];
      if (!Array.isArray(records)) {
        throw new StoreLoadError(`${file}: collection ${String(name)} is not an array`);
      }
      const collection = this.collection(name);
      for (const record of records as Array<Record<string, unknown>>) {
        for (const field of definition.dates ?? []) {
          const value = record[field];
          if (typeof value === 'string') {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
              throw new StoreLoadError(`${file}: ${String(name)}.${field} is not a date`);
            }
            record[field] = date;
          }
        }
        collection.set(String(record[definition.key]), record);
      }
    }
    for (const [name, value] of Object.entries(snapshot.sequences ?? {})) {
      this.sequences.set(name, value);
    }
    this.options.logger.info(
      {
        file,
        savedAt: snapshot.savedAt,
        counts: Object.fromEntries([...this.data].map(([n, c]) => [n, c.size])),
      },
      'data file loaded',
    );
  }
}

class StoreTransaction<C extends { [K in keyof C]: object }> implements Transaction<C> {
  readonly overlay = new Map<keyof C, Map<string, Slot>>();
  readonly sequences = new Map<string, number>();
  readonly hooks: Array<() => void> = [];
  closed = false;

  constructor(
    private readonly base: ReadonlyMap<keyof C, Map<string, object>>,
    private readonly baseSequences: ReadonlyMap<string, number>,
    private readonly definitions: CollectionDefinitions<C>,
  ) {}

  get dirty(): boolean {
    return this.overlay.size > 0 || this.sequences.size > 0;
  }

  get<K extends keyof C>(name: K, key: string): C[K] | undefined {
    const slot = this.overlay.get(name)?.get(key);
    if (slot === DELETED) return undefined;
    const record = slot ?? this.base.get(name)?.get(key);
    return record === undefined ? undefined : (cloneRecord(record) as C[K]);
  }

  find<K extends keyof C>(
    name: K,
    predicate?: (record: Readonly<C[K]>) => boolean,
  ): C[K][] {
    const overlay = this.overlay.get(name);
    const matches: C[K][] = [];
    const consider = (record: object) => {
      if (!predicate || predicate(record as C[K]))
        matches.push(cloneRecord(record) as C[K]);
    };
    for (const [key, record] of this.base.get(name) ?? []) {
      if (!overlay?.has(key)) consider(record);
    }
    for (const slot of overlay?.values() ?? []) {
      if (slot !== DELETED) consider(slot);
    }
    return matches;
  }

  put<K extends keyof C>(name: K, record: C[K]): void {
    this.slots(name).set(this.keyOf(name, record), cloneRecord(record));
  }

  delete<K extends keyof C>(name: K, key: string): void {
    this.slots(name).set(key, DELETED);
  }

  nextSequence(name: string): number {
    const next = (this.sequences.get(name) ?? this.baseSequences.get(name) ?? 0) + 1;
    this.sequences.set(name, next);
    return next;
  }

  afterCommit(hook: () => void): void {
    this.hooks.push(hook);
  }

  private slots(name: keyof C): Map<string, Slot> {
    let slots = this.overlay.get(name);
    if (!slots) {
      slots = new Map();
      this.overlay.set(name, slots);
    }
    return slots;
  }

  private keyOf<K extends keyof C>(name: K, record: C[K]): string {
    const field = this.definitions[name].key;
    const key = (record as Record<string, unknown>)[field];
    if (typeof key !== 'string' || key === '') {
      throw new Error(`Record for ${String(name)} has no ${field}`);
    }
    return key;
  }
}
