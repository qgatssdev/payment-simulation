import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StoreLockedError } from './store.errors';

export interface SnapshotWriter {
  write(contents: string): Promise<void>;
}

/**
 * Replace `file` atomically: write a temp file, fsync it, rename it over the target, then fsync
 * the directory so the rename itself is durable. A crash at any point leaves either the old
 * snapshot or the new one, never a half-written file. (rename is atomic within a filesystem.)
 */
export class AtomicFileWriter implements SnapshotWriter {
  constructor(private readonly file: string) {}

  async write(contents: string): Promise<void> {
    const temp = `${this.file}.tmp`;
    const handle = await open(temp, 'w');
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, this.file);
    await syncDirectory(dirname(this.file));
  }
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some platforms (Windows) cannot fsync a directory; the rename is still atomic there.
  }
}

export async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export async function ensureDirectory(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Single-writer guard: `<file>.lock` holds the owner's pid, created exclusively ('wx'). A lock
 * whose pid is gone is stale (the owner crashed) and is taken over. Returns a release function.
 */
export async function acquireLock(file: string): Promise<() => Promise<void>> {
  const lockFile = `${file}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        const owner = await readIfExists(lockFile);
        if (owner?.trim() === String(process.pid))
          await unlink(lockFile).catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number((await readIfExists(lockFile))?.trim());
      // Our own pid means another store in this process holds it.
      if (Number.isInteger(pid) && (pid === process.pid || isAlive(pid))) {
        throw new StoreLockedError(file, pid);
      }
      await unlink(lockFile).catch(() => undefined);
    }
  }
  throw new Error(`Could not acquire ${lockFile}`);
}
