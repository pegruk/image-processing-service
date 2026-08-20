import type { Readable } from 'node:stream';

export interface ObjectStorage {
  put(key: string, source: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
