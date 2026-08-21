import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LocalStorage } from './local-storage';

describe('LocalStorage', () => {
  it('writes, reads, checks and deletes an object', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'image-service-storage-'));
    const storage = new LocalStorage(directory);

    try {
      await storage.put('originals/user-1/image-1.png', Readable.from(Buffer.from('image-content')));

      expect(await storage.exists('originals/user-1/image-1.png')).toBe(true);
      expect(
        await readStream(await storage.get('originals/user-1/image-1.png')),
      ).toEqual(Buffer.from('image-content'));

      await storage.delete('originals/user-1/image-1.png');
      expect(await storage.exists('originals/user-1/image-1.png')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects keys that try to escape the storage root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'image-service-storage-'));
    const storage = new LocalStorage(directory);

    try {
      await expect(
        storage.put('../outside.txt', Readable.from(Buffer.from('unsafe'))),
      ).rejects.toThrow('Invalid storage key');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
