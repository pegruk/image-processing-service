import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from './client';
import { imageVariants, images, users } from './schema';
import { DrizzleImageRepository } from '../../modules/images/image.repository';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeIntegration('DrizzleImageRepository', () => {
  const repository = new DrizzleImageRepository();

  const testUserIds: string[] = [];

  afterAll(async () => {
    if (testUserIds.length) await db.delete(users).where(inArray(users.id, testUserIds));
    await pool.end();
  });

  it('isolates images by owner and sums originals and variants for the storage quota', async () => {
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    testUserIds.push(ownerId, otherUserId);
    const ownerImageId = randomUUID();
    const otherImageId = randomUUID();

    await db.insert(users).values([
      { id: ownerId, username: ownerId, passwordHash: 'hash', storageUsedBytes: 120 },
      { id: otherUserId, username: otherUserId, passwordHash: 'hash', storageUsedBytes: 200 },
    ]);
    await db.insert(images).values([
      imageInput(ownerImageId, ownerId, 'originals/owner.png', 100),
      imageInput(otherImageId, otherUserId, 'originals/other.png', 200),
    ]);
    const variantId = randomUUID();
    await db.insert(imageVariants).values({
      id: variantId,
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
    expect(await repository.reserveStorage(ownerId, 380, 500)).toBe(true);
    expect(await repository.reserveStorage(ownerId, 1, 500)).toBe(false);
    expect(await repository.reserveStorage(otherUserId, 301, 500)).toBe(false);
    expect(await repository.findOwnedVariant(variantId, ownerId)).not.toBeNull();
    await repository.claimDeletion(ownerImageId, ownerId);
    expect(await repository.findOwnedVariant(variantId, ownerId)).toBeNull();
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
