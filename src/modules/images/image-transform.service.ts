import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp, { type Sharp } from 'sharp';
import { env } from '../../config/env';
import type { ImageVariant } from '../../infrastructure/database/schema';
import type { ObjectStorage } from '../../infrastructure/storage/storage.port';
import { AppError } from '../../shared/errors/app-error';
import { imageIdSchema, transformationsSchema, type Transformations } from './image.schemas';
import type { ImageRepository } from './image.types';

const formatInfo = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const;

export interface ImageVariantResponse extends Omit<ImageVariant, 'storageKey'> {
  url: string;
}

export class ImageTransformService {
  constructor(
    private readonly imageRepository: ImageRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async transform(userId: string, imageId: string, rawTransformations: unknown): Promise<ImageVariantResponse> {
    const validImageId = parseUuid(imageId, 'O identificador da imagem é inválido.');
    const transformations = parseTransformations(rawTransformations);
    const image = await this.imageRepository.findOwnedById(validImageId, userId);

    if (!image) {
      throw new AppError('Imagem não encontrada.', 'IMAGE_NOT_FOUND', 404);
    }

    if (!(await this.storage.exists(image.storageKey))) {
      throw new AppError(
        'O arquivo associado à imagem não está disponível.',
        'IMAGE_FILE_MISSING',
        500,
      );
    }

    try {
      const source = await streamToBuffer(await this.storage.get(image.storageKey));
      const output = await processImage(source, image.mimeType, transformations);

      if (output.buffer.length > env.MAX_UPLOAD_SIZE_BYTES) {
        throw new AppError(
          'A imagem transformada excede o tamanho máximo permitido.',
          'TRANSFORMED_IMAGE_TOO_LARGE',
          413,
        );
      }

      const variantId = randomUUID();
      const storageKey = `variants/${image.id}/${variantId}.${output.extension}`;
      await this.storage.put(storageKey, Readable.from(output.buffer));

      try {
        const variant = await this.imageRepository.createVariant({
          id: variantId,
          imageId: image.id,
          storageKey,
          transformations,
          mimeType: output.mimeType,
          sizeBytes: output.buffer.length,
          width: output.width,
          height: output.height,
          checksum: createHash('sha256').update(output.buffer).digest('hex'),
        });

        return toVariantResponse(variant);
      } catch (error: unknown) {
        await this.storage.delete(storageKey).catch(() => undefined);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'Não foi possível processar a imagem com os parâmetros informados.',
        'INVALID_TRANSFORMATION',
        422,
        { cause: error },
      );
    }
  }

  async getVariant(userId: string, variantId: string): Promise<{ variant: ImageVariant; stream: Readable }> {
    const validVariantId = parseUuid(variantId, 'O identificador da variante é inválido.');
    const variant = await this.imageRepository.findOwnedVariant(validVariantId, userId);

    if (!variant) {
      throw new AppError('Variante não encontrada.', 'VARIANT_NOT_FOUND', 404);
    }

    if (!(await this.storage.exists(variant.storageKey))) {
      throw new AppError(
        'O arquivo associado à variante não está disponível.',
        'VARIANT_FILE_MISSING',
        500,
      );
    }

    return {
      variant,
      stream: await this.storage.get(variant.storageKey),
    };
  }
}

function parseUuid(value: string, message: string): string {
  const result = imageIdSchema.safeParse(value);

  if (!result.success) {
    throw new AppError(message, 'VALIDATION_ERROR', 400);
  }

  return result.data;
}

function parseTransformations(value: unknown): Transformations {
  const result = transformationsSchema.safeParse(value);

  if (!result.success) {
    throw new AppError('Os parâmetros de transformação são inválidos.', 'VALIDATION_ERROR', 400, {
      cause: result.error,
    });
  }

  return result.data;
}

async function processImage(
  source: Buffer,
  sourceMimeType: string,
  transformations: Transformations,
): Promise<{
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}> {
  let processor: Sharp = sharp(source, { limitInputPixels: env.MAX_IMAGE_PIXELS });

  if (transformations.rotate !== undefined && transformations.rotate !== 0) {
    processor = processor.rotate(transformations.rotate);
  }

  if (transformations.flip) {
    processor = processor.flip();
  }

  if (transformations.mirror) {
    processor = processor.flop();
  }

  if (transformations.resize) {
    processor = processor.resize({
      width: transformations.resize.width,
      height: transformations.resize.height,
      fit: transformations.resize.fit,
    });
  }

  if (transformations.crop) {
    processor = processor.extract({
      left: transformations.crop.x,
      top: transformations.crop.y,
      width: transformations.crop.width,
      height: transformations.crop.height,
    });
  }

  if (transformations.filters?.grayscale) {
    processor = processor.grayscale();
  }

  if (transformations.filters?.sepia) {
    processor = processor.grayscale().tint('#704214');
  }

  if (transformations.watermark) {
    processor = processor.composite([
      {
        input: Buffer.from(createWatermarkSvg(transformations.watermark.text, transformations.watermark.fontSize, transformations.watermark.opacity)),
        gravity: transformations.watermark.position,
      },
    ]);
  }

  const outputFormat = resolveFormat(transformations.format, sourceMimeType);
  processor = applyOutputFormat(processor, outputFormat.extension, transformations.quality);
  const buffer = await processor.toBuffer();
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('The transformed image has no dimensions.');
  }

  return {
    buffer,
    mimeType: outputFormat.mimeType,
    extension: outputFormat.extension,
    width: metadata.width,
    height: metadata.height,
  };
}

function resolveFormat(format: Transformations['format'], sourceMimeType: string) {
  if (format) {
    return formatInfo[format];
  }

  const sourceFormat = Object.values(formatInfo).find((item) => item.mimeType === sourceMimeType);
  return sourceFormat ?? formatInfo.png;
}

function applyOutputFormat(processor: Sharp, extension: string, quality: number | undefined): Sharp {
  if (extension === 'jpg') {
    return processor.jpeg(quality ? { quality } : undefined);
  }

  if (extension === 'webp') {
    return processor.webp(quality ? { quality } : undefined);
  }

  return processor.png(
    quality === undefined
      ? undefined
      : { compressionLevel: Math.max(0, Math.min(9, Math.round((100 - quality) / 100 * 9))) },
  );
}

function createWatermarkSvg(text: string, fontSize: number, opacity: number): string {
  const escapedText = escapeXml(text);
  const padding = Math.ceil(fontSize * 0.4);
  const width = Math.max(fontSize * 4, escapedText.length * fontSize * 0.65 + padding * 2);
  const height = fontSize + padding * 2;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black" fill-opacity="${opacity * 0.55}" rx="${padding}"/><text x="${padding}" y="${fontSize + padding * 0.65}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="white" fill-opacity="${opacity}">${escapedText}</text></svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '\"': '&quot;',
  })[character] ?? character);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function toVariantResponse(variant: ImageVariant): ImageVariantResponse {
  const { storageKey: _storageKey, ...publicVariant } = variant;

  return {
    ...publicVariant,
    url: `/images/${variant.imageId}/variants/${variant.id}`,
  };
}
