import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { captureLogger } from '../../../test/helpers';
import type { SnapshotWriter } from './json-file';
import { AtomicFileWriter } from './json-file';
import type { JsonStoreOptions } from './json-store';
import { JsonStore } from './json-store';
import {
  StorageUnavailableError,
  StoreLoadError,
  StoreLockedError,
} from './store.errors';

interface Note {
  id: string;
  text: string;
  count: number;
  createdAt: Date;
}
interface Tag {
  name: string;
  notes: number;
}
type Collections = { notes: Note; tags: Tag };

const FORMAT = 'test-store/v1';
const definitions: JsonStoreOptions<Collections>['collections'] = {
  notes: { key: 'id', dates: ['createdAt'] },
  tags: { key: 'name' },
};

const note = (id: string, count = 0): Note => ({
  id,
  text: `note ${id}`,
  count,
  createdAt: new Date('2026-10-15T12:00:00.000Z'),
});

function memoryStore() {
  return JsonStore.open<Collections>({
    collections: definitions,
    format: FORMAT,
    logger: captureLogger().logger,
  });
}

describe('JsonStore transactions (in memory)', () => {
  it('commits puts and deletes atomically, keyed by each collection’s key field', async () => {
    const store = await memoryStore();
    await store.transaction((tx) => {
      tx.put('notes', note('a'));
      tx.put('tags', { name: 'urgent', notes: 1 });
    });
    expect(store.get('notes', 'a')?.text).toBe('note a');
    expect(store.get('tags', 'urgent')?.notes).toBe(1);

    await store.transaction((tx) => tx.delete('notes', 'a'));
    expect(store.get('notes', 'a')).toBeUndefined();
    expect(store.count('notes')).toBe(0);
  });

  it('never hands out or keeps references: stored state changes only through a transaction', async () => {
    const store = await memoryStore();
    const input = note('a');
    await store.transaction((tx) => tx.put('notes', input));
    input.text = 'mutated after put';

    const read = store.get('notes', 'a') as Note;
    read.text = 'mutated after get';
    store.find('notes')[0]!.count = 99;

    expect(store.get('notes', 'a')).toMatchObject({ text: 'note a', count: 0 });
    expect(store.get('notes', 'a')?.createdAt).toBeInstanceOf(Date);
  });

  it('rolls back everything, including sequences and hooks, when the work throws', async () => {
    const store = await memoryStore();
    const hook = jest.fn();
    await expect(
      store.transaction((tx) => {
        tx.put('notes', note('a'));
        tx.nextSequence('notes');
        tx.afterCommit(hook);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    expect(store.count('notes')).toBe(0);
    expect(hook).not.toHaveBeenCalled();
    await store.transaction((tx) => expect(tx.nextSequence('notes')).toBe(1));
  });

  it('reads its own writes, while others see only committed state', async () => {
    const store = await memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const pending = store.transaction(async (tx) => {
      tx.put('notes', note('a', 1));
      expect(tx.get('notes', 'a')?.count).toBe(1);
      expect(tx.find('notes')).toHaveLength(1);
      await gate;
    });
    await tick();
    expect(store.get('notes', 'a')).toBeUndefined();

    release();
    await pending;
    expect(store.get('notes', 'a')?.count).toBe(1);
  });

  it('serializes read-modify-write transactions: no lost updates', async () => {
    const store = await memoryStore();
    await store.transaction((tx) => tx.put('notes', note('counter')));

    await Promise.all(
      Array.from({ length: 50 }, () =>
        store.transaction(async (tx) => {
          const current = tx.get('notes', 'counter') as Note;
          await tick(); // yield mid-transaction, where an unserialized store would interleave
          tx.put('notes', { ...current, count: current.count + 1 });
        }),
      ),
    );
    expect(store.get('notes', 'counter')?.count).toBe(50);
  });

  it('find merges committed records with the transaction’s overlay', async () => {
    const store = await memoryStore();
    await store.transaction((tx) => {
      tx.put('notes', note('a', 1));
      tx.put('notes', note('b', 2));
    });
    await store.transaction((tx) => {
      tx.delete('notes', 'a');
      tx.put('notes', note('b', 20));
      tx.put('notes', note('c', 30));
      expect(
        tx
          .find('notes', (n) => n.count >= 20)
          .map((n) => n.id)
          .sort(),
      ).toEqual(['b', 'c']);
    });
  });

  it('a nested transaction joins the outer one instead of deadlocking', async () => {
    const store = await memoryStore();
    await expect(
      store.transaction(async () => {
        await store.transaction((inner) => inner.put('notes', note('a')));
        expect(store.get('notes', 'a')).toBeDefined(); // visible inside the outer transaction
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(store.get('notes', 'a')).toBeUndefined();
  });

  it('work outliving its transaction runs in a new transaction, not the finished one', async () => {
    const store = await memoryStore();
    let late!: Promise<void>;
    await store.transaction(() => {
      late = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await store.transaction((tx) => tx.put('notes', note('late')));
      })();
    });
    await late;
    expect(store.get('notes', 'late')).toBeDefined();
  });

  it('hands out strictly increasing sequence numbers', async () => {
    const store = await memoryStore();
    const seen = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.transaction((tx) => tx.nextSequence('events')),
      ),
    );
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('runs after-commit hooks in order, isolating a failing one', async () => {
    const { logger, lines } = captureLogger();
    const store = await JsonStore.open<Collections>({
      collections: definitions,
      format: FORMAT,
      logger,
    });
    const calls: string[] = [];
    await store.transaction((tx) => {
      tx.put('notes', note('a'));
      tx.afterCommit(() => calls.push(`first sees ${store.get('notes', 'a')?.id}`));
      tx.afterCommit(() => {
        throw new Error('subscriber broke');
      });
      tx.afterCommit(() => calls.push('third'));
    });
    expect(calls).toEqual(['first sees a', 'third']);
    expect(lines().some((l) => l.msg === 'after-commit hook failed')).toBe(true);
  });

  it('refuses records without their key', async () => {
    const store = await memoryStore();
    await expect(
      store.transaction((tx) => tx.put('tags', { notes: 1 } as unknown as Tag)),
    ).rejects.toThrow('Record for tags has no name');
  });
});

describe('JsonStore persistence (JSON file)', () => {
  let dir: string;
  let file: string;
  const open: Array<JsonStore<Collections>> = [];

  async function fileStore(writer?: SnapshotWriter) {
    const store = await JsonStore.open<Collections>({
      collections: definitions,
      format: FORMAT,
      file,
      logger: captureLogger().logger,
      writer,
    });
    open.push(store);
    return store;
  }

  async function reopen() {
    await Promise.all(open.splice(0).map((s) => s.close()));
    return fileStore();
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'json-store-'));
    file = join(dir, 'nested', 'data.json');
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close().catch(() => undefined)));
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty without a file, and survives a restart with dates and sequences intact', async () => {
    const store = await fileStore();
    expect(store.count('notes')).toBe(0);
    await store.transaction((tx) => {
      tx.put('notes', note('a', 7));
      tx.nextSequence('events');
      tx.nextSequence('events');
    });

    const reloaded = await reopen();
    expect(reloaded.get('notes', 'a')).toEqual(note('a', 7));
    expect(reloaded.get('notes', 'a')?.createdAt).toBeInstanceOf(Date);
    await reloaded.transaction((tx) => expect(tx.nextSequence('events')).toBe(3));
  });

  it('writes human-readable JSON tagged with its format', async () => {
    const store = await fileStore();
    await store.transaction((tx) => tx.put('tags', { name: 'urgent', notes: 2 }));
    const contents = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(contents).toMatchObject({
      format: FORMAT,
      collections: { notes: [], tags: [{ name: 'urgent', notes: 2 }] },
    });
  });

  it('acknowledges a transaction only once its snapshot is on disk', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = new AtomicFileWriter(file);
    const store = await fileStore({
      write: async (contents) => {
        await gate;
        await real.write(contents);
      },
    });

    let acknowledged = false;
    const pending = store
      .transaction((tx) => tx.put('notes', note('a')))
      .then(() => (acknowledged = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledged).toBe(false);
    expect(store.get('notes', 'a')).toBeDefined(); // visible in memory before it is durable

    release();
    await pending;
    expect(existsSync(file)).toBe(true);
  });

  it('group-commits: concurrent transactions share writes, and every one is durable', async () => {
    const real = new AtomicFileWriter(file);
    const store = await fileStore({
      write: async (contents) => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // a slow disk
        await real.write(contents);
      },
    });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        store.transaction((tx) => tx.put('notes', note(`n${i}`))),
      ),
    );
    expect(store.flushes).toBeGreaterThan(0);
    expect(store.flushes).toBeLessThan(40);

    const reloaded = await reopen();
    expect(reloaded.count('notes')).toBe(40);
  });

  it('reports a failed write as 503, keeps the change, and recovers on the next write', async () => {
    const real = new AtomicFileWriter(file);
    let failing = true;
    const store = await fileStore({
      write: (contents) =>
        failing
          ? Promise.reject(new Error('ENOSPC: no space left'))
          : real.write(contents),
    });

    const error = await store
      .transaction((tx) => tx.put('notes', note('a')))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(store.healthy).toBe(false);
    expect(store.get('notes', 'a')).toBeDefined();

    failing = false;
    await store.flush();
    expect(store.healthy).toBe(true);
    const reloaded = await reopen();
    expect(reloaded.get('notes', 'a')).toBeDefined();
  });

  it('ignores a temp file left by a crash mid-write', async () => {
    const store = await fileStore();
    await store.transaction((tx) => tx.put('notes', note('a')));
    await writeFile(
      `${file}.tmp`,
      '{"format": "test-store/v1", "collections": {"notes": [{"id": "half',
    );

    const reloaded = await reopen();
    expect(reloaded.get('notes', 'a')).toBeDefined();
  });

  it.each([
    ['invalid JSON', '{ not json', /is not valid JSON/],
    [
      'another format',
      JSON.stringify({ format: 'other/v9', collections: {} }),
      /has format "other\/v9"/,
    ],
    [
      'a broken date',
      JSON.stringify({
        format: FORMAT,
        collections: { notes: [{ ...note('a'), createdAt: 'soon' }] },
      }),
      /notes.createdAt is not a date/,
    ],
  ])(
    'refuses to start from %s and leaves the file untouched',
    async (_label, contents, message) => {
      await fileStore(); // creates the directory
      await Promise.all(open.splice(0).map((s) => s.close()));
      await writeFile(file, contents);

      await expect(fileStore()).rejects.toThrow(StoreLoadError);
      await expect(fileStore()).rejects.toThrow(message);
      expect(await readFile(file, 'utf8')).toBe(contents);
      expect(existsSync(`${file}.lock`)).toBe(false); // the failed open released its lock
    },
  );

  it('allows one writer per file and takes over a lock left by a dead process', async () => {
    await fileStore();
    await expect(fileStore()).rejects.toThrow(StoreLockedError);

    await Promise.all(open.splice(0).map((s) => s.close()));
    expect(existsSync(`${file}.lock`)).toBe(false);

    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    await writeFile(`${file}.lock`, String(deadPid));
    await expect(fileStore()).resolves.toBeDefined();
    expect((await readFile(`${file}.lock`, 'utf8')).trim()).toBe(String(process.pid));
  });
});
