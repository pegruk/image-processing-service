import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/client';
import {
  imageVariants,
  images,
  users,
  type Image,
  type ImageVariant,
  type NewImage,
  type NewImageVariant,
} from '../../infrastructure/database/schema';
import type { ImageListOptions, ImageListResult, ImageRepository } from './image.types';

export class DrizzleImageRepository implements ImageRepository {
  async create(input: NewImage): Promise<Image> {
    const [image] = await db.insert(images).values(input).returning();

    if (!image) {
      throw new Error('The image was not returned after insertion.');
    }

    return image;
  }

  async findOwnedById(imageId: string, userId: string): Promise<Image | null> {
    const [image] = await db
      .select()
      .from(images)
      .where(and(eq(images.id, imageId), eq(images.userId, userId), eq(images.deletionState, 'active')))
      .limit(1);

    return image ?? null;
  }

  async listOwned(userId: string, options: ImageListOptions): Promise<ImageListResult> {
    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(images)
        .where(and(eq(images.userId, userId), eq(images.deletionState, 'active')))
        .orderBy(desc(images.createdAt), desc(images.id))
        .limit(options.limit)
        .offset(options.offset),
      db.select({ total: count() }).from(images).where(and(eq(images.userId, userId), eq(images.deletionState, 'active'))),
    ]);

    return {
      items,
      total: Number(countResult[0]?.total ?? 0),
    };
  }

  async claimDeletion(imageId: string, userId: string): Promise<{ image: Image; variants: ImageVariant[] } | null> {
    return db.transaction(async (transaction) => {
      const [image] = await transaction.update(images)
        .set({ deletionState: 'pending', deletionRequestedAt: new Date() })
        .where(and(eq(images.id, imageId), eq(images.userId, userId), eq(images.deletionState, 'active')))
        .returning();
      const pending = image ?? (await transaction.select().from(images)
        .where(and(eq(images.id, imageId), eq(images.userId, userId), eq(images.deletionState, 'pending')))
        .limit(1))[0];
      if (!pending) return null;
      const variants = await transaction.select().from(imageVariants).where(eq(imageVariants.imageId, pending.id));
      return { image: pending, variants };
    });
  }

  async finalizeDeletion(imageId: string, userId: string): Promise<boolean> {
    return db.transaction(async (transaction) => {
      const variants = await transaction.select({ sizeBytes: imageVariants.sizeBytes }).from(imageVariants).where(eq(imageVariants.imageId, imageId));
      const variantBytes = variants.reduce((total, variant) => total + variant.sizeBytes, 0);
      const [image] = await transaction.delete(images)
        .where(and(eq(images.id, imageId), eq(images.userId, userId), eq(images.deletionState, 'pending')))
        .returning({ sizeBytes: images.sizeBytes });
      if (!image) return false;
      await transaction.update(users).set({ storageUsedBytes: sql`greatest(${users.storageUsedBytes} - ${image.sizeBytes + variantBytes}, 0)` }).where(eq(users.id, userId));
      return true;
    });
  }

  async reserveStorage(userId: string, bytes: number, quota: number): Promise<boolean> {
    const reserved = await db.update(users)
      .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${bytes}` })
      .where(and(eq(users.id, userId), sql`${users.storageUsedBytes} + ${bytes} <= ${quota}`))
      .returning({ id: users.id });
    return reserved.length === 1;
  }

  async releaseStorage(userId: string, bytes: number): Promise<void> {
    await db.update(users).set({ storageUsedBytes: sql`greatest(${users.storageUsedBytes} - ${bytes}, 0)` }).where(eq(users.id, userId));
  }

  async createVariant(input: NewImageVariant): Promise<ImageVariant> {
    const [variant] = await db.insert(imageVariants).values(input).returning();

    if (!variant) {
      throw new Error('The image variant was not returned after insertion.');
    }

    return variant;
  }

  async findOwnedVariant(variantId: string, userId: string): Promise<ImageVariant | null> {
    const [result] = await db
      .select({ variant: imageVariants })
      .from(imageVariants)
      .innerJoin(images, eq(imageVariants.imageId, images.id))
      .where(and(
        eq(imageVariants.id, variantId),
        eq(images.userId, userId),
        eq(images.deletionState, 'active'),
      ))
      .limit(1);

    return result?.variant ?? null;
  }
}
