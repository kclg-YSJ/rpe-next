import { appendFile, rename, rm, stat } from 'node:fs/promises';

export interface Diagnostics {
  write(entry: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export function createDiagnostics(path: string, { maxBytes = 1024 * 1024, archives = 3 }: { maxBytes?: number; archives?: number } = {}): Diagnostics {
  let pending: Promise<void> = Promise.resolve(), size: number | undefined;
  return {
    write(entry: Record<string, unknown>): void {
      const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
      pending = pending.then(async () => {
        size ??= await stat(path).then(info => info.size, () => 0);
        const bytes = Buffer.byteLength(line);
        if (size && size + bytes > maxBytes) {
          await rm(path + '.' + archives, { force: true });
          for (let index = archives - 1; index >= 1; index--) await rename(path + '.' + index, path + '.' + (index + 1)).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
          await rename(path, path + '.1'); size = 0;
        }
        await appendFile(path, line); size += bytes;
      }).catch(() => {});
    },
    flush(): Promise<void> { return pending; },
  };
}
