import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../infrastructure/database/client';
import {
  imageVariants,
  images,
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
      .where(and(eq(images.id, imageId), eq(images.userId, userId)))
      .limit(1);

    return image ?? null;
  }

  async listOwned(userId: string, options: ImageListOptions): Promise<ImageListResult> {
    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(images)
        .where(eq(images.userId, userId))
        .orderBy(desc(images.createdAt), desc(images.id))
        .limit(options.limit)
        .offset(options.offset),
      db.select({ total: count() }).from(images).where(eq(images.userId, userId)),
    ]);

    return {
      items,
      total: Number(countResult[0]?.total ?? 0),
    };
  }

  async deleteOwnedById(imageId: string, userId: string): Promise<{ image: Image; variants: ImageVariant[] } | null> {
    return db.transaction(async (transaction) => {
      const [image] = await transaction
        .select()
        .from(images)
        .where(and(eq(images.id, imageId), eq(images.userId, userId)))
        .limit(1);

      if (!image) {
        return null;
      }

      const variants = await transaction
        .select()
        .from(imageVariants)
        .where(eq(imageVariants.imageId, image.id));

      await transaction.delete(images).where(and(eq(images.id, imageId), eq(images.userId, userId)));

      return { image, variants };
    });
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
      .where(and(eq(imageVariants.id, variantId), eq(images.userId, userId)))
      .limit(1);

    return result?.variant ?? null;
  }
}
