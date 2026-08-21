import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { ObjectStorage } from './storage.port';

export class LocalStorage implements ObjectStorage {
  constructor(private readonly rootDirectory: string) {}

  async put(key: string, source: Readable): Promise<void> {
    const targetPath = this.resolveKey(key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(source, createWriteStream(targetPath, { flags: 'wx' }));
  }

  get(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.resolveKey(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }

  private resolveKey(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error('Invalid storage key.');
    }

    const root = path.resolve(this.rootDirectory);
    const resolved = path.resolve(root, key);

    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Storage key escapes storage root.');
    }

    return resolved;
  }
}

function isSafeStorageKey(key: string): boolean {
  return key.length > 0 && !key.startsWith('/') && !key.includes('\\') && !key.split('/').includes('..');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
