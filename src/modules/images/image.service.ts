import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { env } from '../../config/env';
import type { Image } from '../../infrastructure/database/schema';
import type { ObjectStorage } from '../../infrastructure/storage/storage.port';
import { AppError } from '../../shared/errors/app-error';
import type { ImageRepository } from './image.types';
import { imageIdSchema } from './image.schemas';

const supportedFormats = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

interface DetectedFileType {
  mime: string;
  ext: string;
}

const fileTypeFromFile = require('file-type').fileTypeFromFile as (
  filePath: string,
) => Promise<DetectedFileType | undefined>;

export interface UploadInput {
  userId: string;
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
  truncated: boolean;
}

export interface ImageServiceLogger {
  error(object: unknown, message: string): void;
}

export interface ImageResponse {
  id: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  createdAt: Date;
  url: string;
}

export class ImageService {
  private readonly temporaryDirectory = path.join(env.STORAGE_ROOT, '.tmp');

  constructor(
    private readonly imageRepository: ImageRepository,
    private readonly storage: ObjectStorage,
    private readonly logger: ImageServiceLogger = console,
  ) {}

  async upload(input: UploadInput): Promise<Image> {
    const imageId = randomUUID();
    const temporaryPath = path.join(this.temporaryDirectory, `${imageId}.upload`);
    let storageKey: string | undefined;

    try {
      const { sizeBytes, checksum } = await this.writeTemporaryFile(input.stream, temporaryPath);

      if (input.truncated) {
        throw new AppError('O arquivo excede o tamanho máximo permitido.', 'FILE_TOO_LARGE', 413);
      }

      const metadata = await this.validateImage(temporaryPath, sizeBytes);
      const extension = supportedFormats.get(metadata.mimeType);

      if (!extension) {
        throw new AppError('Formato de imagem não suportado.', 'UNSUPPORTED_IMAGE_FORMAT', 415);
      }

      storageKey = `originals/${input.userId}/${imageId}.${extension}`;
      await this.storage.put(storageKey, createReadStream(temporaryPath));

      try {
        return await this.imageRepository.create({
          id: imageId,
          userId: input.userId,
          storageKey,
          originalFilename: sanitizeOriginalFilename(input.filename, imageId),
          mimeType: metadata.mimeType,
          extension,
          sizeBytes,
          width: metadata.width,
          height: metadata.height,
          checksum,
        });
      } catch (error: unknown) {
        await this.deleteAfterPersistenceFailure(storageKey, error);
        throw error;
      }
    } catch (error: unknown) {
      if (isSharpInputError(error)) {
        throw new AppError('O arquivo enviado não é uma imagem válida.', 'INVALID_IMAGE', 422, {
          cause: error,
        });
      }

      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async list(userId: string, page: number, limit: number): Promise<{
    items: ImageResponse[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const result = await this.imageRepository.listOwned(userId, {
      offset: (page - 1) * limit,
      limit,
    });

    return {
      items: result.items.map(toImageResponse),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
      },
    };
  }

  async getOriginal(userId: string, imageId: string): Promise<{ image: Image; stream: Readable }> {
    const validImageId = parseImageId(imageId);
    const image = await this.imageRepository.findOwnedById(validImageId, userId);

    if (!image) {
      throw new AppError('Imagem não encontrada.', 'IMAGE_NOT_FOUND', 404);
    }

    if (!(await this.storage.exists(image.storageKey))) {
      this.logger.error({ imageId: image.id, storageKey: image.storageKey }, 'Image file is missing from storage');
      throw new AppError(
        'O arquivo associado à imagem não está disponível.',
        'IMAGE_FILE_MISSING',
        500,
      );
    }

    return {
      image,
      stream: await this.storage.get(image.storageKey),
    };
  }

  async delete(userId: string, imageId: string): Promise<void> {
    const validImageId = parseImageId(imageId);
    const deleted = await this.imageRepository.deleteOwnedById(validImageId, userId);

    if (!deleted) {
      throw new AppError('Imagem não encontrada.', 'IMAGE_NOT_FOUND', 404);
    }

    try {
      await this.storage.delete(deleted.image.storageKey);
      await Promise.all(deleted.variants.map((variant) => this.storage.delete(variant.storageKey)));
    } catch (error: unknown) {
      this.logger.error(
        {
          error,
          imageId: deleted.image.id,
          storageKeys: [deleted.image.storageKey, ...deleted.variants.map((variant) => variant.storageKey)],
        },
        'Image metadata deleted but storage cleanup failed',
      );
      throw new AppError(
        'A imagem foi removida do banco, mas o arquivo não pôde ser limpo.',
        'STORAGE_CLEANUP_FAILED',
        500,
        { cause: error },
      );
    }
  }

  private async writeTemporaryFile(
    source: NodeJS.ReadableStream,
    temporaryPath: string,
  ): Promise<{ sizeBytes: number; checksum: string }> {
    await mkdir(this.temporaryDirectory, { recursive: true });

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(source, counter, createWriteStream(temporaryPath, { flags: 'wx' }));

    return {
      sizeBytes,
      checksum: hash.digest('hex'),
    };
  }

  private async validateImage(
    temporaryPath: string,
    sizeBytes: number,
  ): Promise<{ mimeType: string; width: number; height: number }> {
    if (sizeBytes === 0) {
      throw new AppError('O arquivo enviado está vazio.', 'EMPTY_FILE', 400);
    }

    if (sizeBytes > env.MAX_UPLOAD_SIZE_BYTES) {
      throw new AppError('O arquivo excede o tamanho máximo permitido.', 'FILE_TOO_LARGE', 413);
    }

    const detectedType = await fileTypeFromFile(temporaryPath);
    const mimeType = detectedType?.mime;

    if (!mimeType || !supportedFormats.has(mimeType)) {
      throw new AppError('Formato de imagem não suportado.', 'UNSUPPORTED_IMAGE_FORMAT', 415);
    }

    const metadata = await sharp(temporaryPath, {
      limitInputPixels: env.MAX_IMAGE_PIXELS,
    }).metadata();

    if (!metadata.width || !metadata.height) {
      throw new AppError('Não foi possível identificar as dimensões da imagem.', 'INVALID_IMAGE', 422);
    }

    if (metadata.width > env.MAX_IMAGE_WIDTH || metadata.height > env.MAX_IMAGE_HEIGHT) {
      throw new AppError('As dimensões da imagem excedem o limite permitido.', 'IMAGE_DIMENSIONS_TOO_LARGE', 413);
    }

    return {
      mimeType,
      width: metadata.width,
      height: metadata.height,
    };
  }

  private async deleteAfterPersistenceFailure(storageKey: string, cause: unknown): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (cleanupError: unknown) {
      this.logger.error(
        { cleanupError, cause, storageKey },
        'Failed to cleanup image after database persistence failure',
      );
    }
  }
}

function sanitizeOriginalFilename(filename: string, fallback: string): string {
  const normalized = filename.normalize('NFKC').replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  const sanitized = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim();

  return (sanitized || `${fallback}.image`).slice(0, 255);
}

function isSharpInputError(error: unknown): boolean {
  return error instanceof Error && /Input file is missing|unsupported image format|Input buffer contains unsupported image format/i.test(error.message);
}

function parseImageId(value: string): string {
  const result = imageIdSchema.safeParse(value);

  if (!result.success) {
    throw new AppError('O identificador da imagem é inválido.', 'VALIDATION_ERROR', 400);
  }

  return result.data;
}

export function toImageResponse(image: Image): ImageResponse {
  return {
    id: image.id,
    originalFilename: image.originalFilename,
    mimeType: image.mimeType,
    extension: image.extension,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    checksum: image.checksum,
    createdAt: image.createdAt,
    url: `/images/${image.id}`,
  };
}
