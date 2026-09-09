import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildApp } from '../../app';
import type { Image, ImageVariant, NewImage, NewImageVariant, User } from '../../infrastructure/database/schema';
import type { ObjectStorage } from '../../infrastructure/storage/storage.port';
import type { UserRepository } from '../auth/auth.types';
import type { ImageRepository } from './image.types';

class InMemoryUserRepository implements UserRepository {
  private readonly users: User[] = [];

  async findByUsername(username: string): Promise<User | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async create(input: { username: string; passwordHash: string }): Promise<User> {
    const user: User = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.push(user);
    return user;
  }
}

class InMemoryImageRepository implements ImageRepository {
  readonly images: Image[] = [];
  readonly variants: ImageVariant[] = [];
  failVariantCreation = false;

  async create(input: NewImage): Promise<Image> {
    const image: Image = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      extension: input.extension,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      checksum: input.checksum,
      createdAt: new Date(),
    };

    this.images.push(image);
    return image;
  }

  async findOwnedById(imageId: string, userId: string): Promise<Image | null> {
    return this.images.find((image) => image.id === imageId && image.userId === userId) ?? null;
  }

  async listOwned(userId: string, options: { offset: number; limit: number }) {
    const items = this.images
      .filter((image) => image.userId === userId)
      .slice(options.offset, options.offset + options.limit);

    return {
      items,
      total: this.images.filter((image) => image.userId === userId).length,
    };
  }

  async findOwnedWithVariants(imageId: string, userId: string): Promise<{ image: Image; variants: ImageVariant[] } | null> {
    const index = this.images.findIndex((image) => image.id === imageId && image.userId === userId);

    if (index < 0) return null;

    const image = this.images[index];

    if (!image) return null;

    const variants = this.variants.filter((variant) => variant.imageId === image.id);
    return { image, variants };
  }

  async deleteOwnedById(imageId: string, userId: string): Promise<boolean> {
    const index = this.images.findIndex((image) => image.id === imageId && image.userId === userId);
    if (index < 0) return false;

    const [image] = this.images.splice(index, 1);
    if (!image) return false;
    this.variants.splice(0, this.variants.length, ...this.variants.filter((variant) => variant.imageId !== image.id));
    return true;
  }

  async getOwnedStorageUsage(userId: string): Promise<number> {
    const imageIds = new Set(this.images.filter((image) => image.userId === userId).map((image) => image.id));
    const originalBytes = this.images
      .filter((image) => image.userId === userId)
      .reduce((total, image) => total + image.sizeBytes, 0);
    const variantBytes = this.variants
      .filter((variant) => imageIds.has(variant.imageId))
      .reduce((total, variant) => total + variant.sizeBytes, 0);
    return originalBytes + variantBytes;
  }

  async createVariant(input: NewImageVariant): Promise<ImageVariant> {
    if (this.failVariantCreation) throw new Error('database unavailable');

    const variant: ImageVariant = {
      id: input.id ?? randomUUID(),
      imageId: input.imageId,
      storageKey: input.storageKey,
      transformations: input.transformations,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      checksum: input.checksum,
      createdAt: new Date(),
    };

    this.variants.push(variant);
    return variant;
  }

  async findOwnedVariant(variantId: string, userId: string): Promise<ImageVariant | null> {
    const variant = this.variants.find((item) => item.id === variantId);
    return variant && this.images.some((image) => image.id === variant.imageId && image.userId === userId)
      ? variant
      : null;
  }
}

class InMemoryStorage implements ObjectStorage {
  readonly files = new Map<string, Buffer>();

  async put(key: string, source: Readable): Promise<void> {
    const chunks: Buffer[] = [];

    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    this.files.set(key, Buffer.concat(chunks));
  }

  async get(key: string): Promise<Readable> {
    const file = this.files.get(key);

    if (!file) {
      throw new Error('File not found');
    }

    return Readable.from(file);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }
}

describe('image routes', () => {
  it('uploads a valid image and persists its metadata', async () => {
    const userRepository = new InMemoryUserRepository();
    const imageRepository = new InMemoryImageRepository();
    const storage = new InMemoryStorage();
    const app = await buildApp({ userRepository, imageRepository, storage });
    const token = await registerAndGetToken(app);
    const imageBuffer = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: { r: 220, g: 40, b: 40 },
      },
    })
      .png()
      .toBuffer();

    const response = await app.inject({
      method: 'POST',
      url: '/images',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=upload-boundary',
      },
      payload: makeMultipartBody('upload-boundary', 'file', '../avatar.png', 'image/png', imageBuffer),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      originalFilename: 'avatar.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: imageBuffer.length,
      width: 4,
      height: 3,
    });
    expect(imageRepository.images).toHaveLength(1);
    expect(storage.files.size).toBe(1);
    expect([...storage.files.keys()][0]).toMatch(/^originals\/[0-9a-f-]+\/[0-9a-f-]+\.png$/);

    await app.close();
  });

  it('rejects content that is not a supported image', async () => {
    const userRepository = new InMemoryUserRepository();
    const imageRepository = new InMemoryImageRepository();
    const storage = new InMemoryStorage();
    const app = await buildApp({ userRepository, imageRepository, storage });
    const token = await registerAndGetToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/images',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=invalid-boundary',
      },
      payload: makeMultipartBody(
        'invalid-boundary',
        'file',
        'notes.txt',
        'image/png',
        Buffer.from('this is not an image'),
      ),
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      error: { code: 'UNSUPPORTED_IMAGE_FORMAT' },
    });
    expect(imageRepository.images).toHaveLength(0);
    expect(storage.files.size).toBe(0);

    await app.close();
  });

  it('lists, serves, transforms and deletes images with owner isolation', async () => {
    const userRepository = new InMemoryUserRepository();
    const imageRepository = new InMemoryImageRepository();
    const storage = new InMemoryStorage();
    const app = await buildApp({ userRepository, imageRepository, storage });
    const token = await registerAndGetToken(app, 'owner-user');
    const imageBuffer = await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: { r: 220, g: 40, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const upload = await app.inject({
      method: 'POST',
      url: '/images',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=management-boundary',
      },
      payload: makeMultipartBody('management-boundary', 'file', 'photo.png', 'image/png', imageBuffer),
    });
    const image = upload.json();

    const oversizedTransform = await app.inject({
      method: 'POST',
      url: `/images/${image.id}/transform`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { resize: { width: 10_000, height: 10_000, fit: 'cover' } },
    });
    expect(oversizedTransform.statusCode).toBe(413);
    expect(oversizedTransform.json()).toMatchObject({
      error: { code: 'TRANSFORMED_IMAGE_DIMENSIONS_TOO_LARGE' },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/images?page=1&limit=10',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [{ id: image.id, url: `/images/${image.id}` }],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    const original = await app.inject({
      method: 'GET',
      url: `/images/${image.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(original.statusCode).toBe(200);
    expect(original.headers['content-type']).toContain('image/png');
    expect(original.rawPayload).toEqual(imageBuffer);

    const transform = await app.inject({
      method: 'POST',
      url: `/images/${image.id}/transform`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        resize: { width: 100, height: 100, fit: 'cover' },
        rotate: 90,
        format: 'webp',
        quality: 80,
        filters: { grayscale: true },
        watermark: { text: 'demo', position: 'southeast', opacity: 0.5, fontSize: 8 },
      },
    });
    expect(transform.statusCode).toBe(201);
    expect(transform.json()).toMatchObject({
      imageId: image.id,
      mimeType: 'image/webp',
      width: 100,
      height: 100,
      transformations: {
        resize: { width: 100, height: 100, fit: 'cover' },
        rotate: 90,
        format: 'webp',
      },
    });
    const variant = transform.json();

    const variantResponse = await app.inject({
      method: 'GET',
      url: `/images/${image.id}/variants/${variant.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(variantResponse.statusCode).toBe(200);
    expect(variantResponse.headers['content-type']).toContain('image/webp');
    expect(variantResponse.rawPayload.length).toBeGreaterThan(0);

    const otherToken = await registerAndGetToken(app, 'other-user');
    const forbiddenByOwnership = await app.inject({
      method: 'GET',
      url: `/images/${image.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(forbiddenByOwnership.statusCode).toBe(404);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/images/${image.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(storage.files.size).toBe(0);

    const missingAfterDelete = await app.inject({
      method: 'GET',
      url: `/images/${image.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingAfterDelete.statusCode).toBe(404);

    await app.close();
  });

  it('returns a server error when persisting a variant fails', async () => {
    const userRepository = new InMemoryUserRepository();
    const imageRepository = new InMemoryImageRepository();
    const storage = new InMemoryStorage();
    const app = await buildApp({ userRepository, imageRepository, storage });
    const token = await registerAndGetToken(app, 'persistence-user');
    const imageBuffer = await sharp({
      create: { width: 8, height: 6, channels: 3, background: { r: 40, g: 40, b: 220 } },
    }).png().toBuffer();
    const upload = await app.inject({
      method: 'POST',
      url: '/images',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=persistence-boundary',
      },
      payload: makeMultipartBody('persistence-boundary', 'file', 'photo.png', 'image/png', imageBuffer),
    });
    imageRepository.failVariantCreation = true;

    const response = await app.inject({
      method: 'POST',
      url: `/images/${upload.json().id}/transform`,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'webp' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR' } });
    expect(storage.files.size).toBe(1);
    await app.close();
  });
});

async function registerAndGetToken(
  app: Awaited<ReturnType<typeof buildApp>>,
  username = 'image-user',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username,
      password: 'password123',
    },
  });

  return response.json().token as string;
}

function makeMultipartBody(
  boundary: string,
  fieldName: string,
  filename: string,
  contentType: string,
  content: Buffer,
): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  return Buffer.concat([header, content, footer]);
}
