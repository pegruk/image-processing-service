import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from './client';
import { imageVariants, images, users } from './schema';
import { DrizzleImageRepository } from '../../modules/images/image.repository';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeIntegration('DrizzleImageRepository', () => {
  const repository = new DrizzleImageRepository();

  beforeEach(async () => {
    await db.delete(imageVariants);
    await db.delete(images);
    await db.delete(users);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('isolates images by owner and sums originals and variants for the storage quota', async () => {
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    const ownerImageId = randomUUID();
    const otherImageId = randomUUID();

    await db.insert(users).values([
      { id: ownerId, username: 'repository-owner', passwordHash: 'hash' },
      { id: otherUserId, username: 'repository-other', passwordHash: 'hash' },
    ]);
    await db.insert(images).values([
      imageInput(ownerImageId, ownerId, 'originals/owner.png', 100),
      imageInput(otherImageId, otherUserId, 'originals/other.png', 200),
    ]);
    await db.insert(imageVariants).values({
      id: randomUUID(),
      imageId: ownerImageId,
      storageKey: 'variants/owner.webp',
      transformations: { format: 'webp' },
      mimeType: 'image/webp',
      sizeBytes: 20,
      width: 10,
      height: 10,
      checksum: 'b'.repeat(64),
    });

    expect(await repository.findOwnedById(ownerImageId, ownerId)).toMatchObject({ id: ownerImageId });
    expect(await repository.findOwnedById(ownerImageId, otherUserId)).toBeNull();
    expect(await repository.getOwnedStorageUsage(ownerId)).toBe(120);
    expect(await repository.getOwnedStorageUsage(otherUserId)).toBe(200);
  });
});

function imageInput(id: string, userId: string, storageKey: string, sizeBytes: number) {
  return {
    id,
    userId,
    storageKey,
    originalFilename: 'image.png',
    mimeType: 'image/png',
    extension: 'png',
    sizeBytes,
    width: 10,
    height: 10,
    checksum: 'a'.repeat(64),
  };
}
