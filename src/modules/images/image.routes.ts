import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../plugins/authentication';
import { LocalStorage } from '../../infrastructure/storage/local-storage';
import { env } from '../../config/env';
import { DrizzleImageRepository } from './image.repository';
import { ImageService, toImageResponse } from './image.service';
import { ImageTransformService } from './image-transform.service';
import { imageIdSchema, paginationSchema } from './image.schemas';
import type { ImageRepository } from './image.types';
import type { ObjectStorage } from '../../infrastructure/storage/storage.port';
import { AppError } from '../../shared/errors/app-error';

export interface ImageRoutesOptions {
  imageRepository?: ImageRepository;
  storage?: ObjectStorage;
}

export const imageRoutes: FastifyPluginAsync<ImageRoutesOptions> = async (app, options) => {
  const imageRepository = options.imageRepository ?? new DrizzleImageRepository();
  const storage = options.storage ?? new LocalStorage(env.STORAGE_ROOT);
  const imageService = new ImageService(imageRepository, storage, app.log);
  const transformService = new ImageTransformService(imageRepository, storage, app.log);

  app.post(
    '/images',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Faz upload de uma imagem',
        consumes: ['multipart/form-data'],
        security: [{ bearerAuth: [] }],
        response: {
          201: imageResponseSchema(),
          400: errorResponseSchema(),
        },
      },
    },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        return reply.status(400).send({
          error: {
            code: 'FILE_REQUIRED',
            message: 'É necessário enviar um arquivo no campo multipart.',
            requestId: request.id,
          },
        });
      }

      const image = await imageService.upload({
        userId: request.user.sub,
        filename: file.filename,
        mimetype: file.mimetype,
        stream: file.file,
        truncated: file.file.truncated,
      });

      return reply.status(201).send(toImageResponse(image));
    },
  );

  app.get(
    '/images',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Lista as imagens do usuário autenticado',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: imageResponseSchema() },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  total: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
                required: ['page', 'limit', 'total', 'totalPages'],
              },
            },
            required: ['items', 'pagination'],
          },
        },
      },
    },
    async (request) => {
      const query = parsePagination(request.query);
      return imageService.list(request.user.sub, query.page, query.limit);
    },
  );

  app.post(
    '/images/:id/transform',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Cria uma variante transformada da imagem',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: transformationBodySchema(),
        response: {
          201: variantResponseSchema(),
          400: errorResponseSchema(),
          404: errorResponseSchema(),
          422: errorResponseSchema(),
        },
      },
      config: {
        rateLimit: {
          max: env.TRANSFORM_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const params = parseParams(request.params);
      const variant = await transformService.transform(request.user.sub, params.id, request.body);
      return reply.status(201).send(variant);
    },
  );

  app.get(
    '/images/:id/variants/:variantId',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Recupera uma variante transformada',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id', 'variantId'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            variantId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const params = parseVariantParams(request.params);
      const { variant, stream } = await transformService.getVariant(request.user.sub, params.variantId);

      if (variant.imageId !== params.id) {
        throw new AppError('Variante não encontrada.', 'VARIANT_NOT_FOUND', 404);
      }

      return reply
        .type(variant.mimeType)
        .header('Content-Length', String(variant.sizeBytes))
        .header('Content-Disposition', `inline; filename="${safeHeaderFilename(`${variant.id}.${extensionFromMime(variant.mimeType)}`)}"`)
        .send(stream);
    },
  );

  app.get(
    '/images/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Recupera a imagem original',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (request, reply) => {
      const params = parseParams(request.params);
      const { image, stream } = await imageService.getOriginal(request.user.sub, params.id);

      return reply
        .type(image.mimeType)
        .header('Content-Length', String(image.sizeBytes))
        .header('Content-Disposition', `inline; filename="${safeHeaderFilename(image.originalFilename)}"`)
        .send(stream);
    },
  );

  app.delete(
    '/images/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Images'],
        summary: 'Exclui uma imagem e suas variantes',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: {
          204: { type: 'null' },
          404: errorResponseSchema(),
        },
      },
    },
    async (request, reply) => {
      const params = parseParams(request.params);
      await imageService.delete(request.user.sub, params.id);
      return reply.status(204).send();
    },
  );
};

function parseParams(value: unknown): { id: string } {
  const result = imageIdSchema.safeParse((value as { id?: unknown })?.id);

  if (!result.success) {
    throw new AppError('O identificador da imagem é inválido.', 'VALIDATION_ERROR', 400);
  }

  return { id: result.data };
}

function parseVariantParams(value: unknown): { id: string; variantId: string } {
  const params = value as { id?: unknown; variantId?: unknown };
  const imageResult = imageIdSchema.safeParse(params?.id);
  const variantResult = imageIdSchema.safeParse(params?.variantId);

  if (!imageResult.success || !variantResult.success) {
    throw new AppError('Os identificadores informados são inválidos.', 'VALIDATION_ERROR', 400);
  }

  return { id: imageResult.data, variantId: variantResult.data };
}

function parsePagination(value: unknown): { page: number; limit: number } {
  const result = paginationSchema.safeParse(value);

  if (!result.success) {
    throw new AppError('Os parâmetros de paginação são inválidos.', 'VALIDATION_ERROR', 400);
  }

  return result.data;
}

function safeHeaderFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '_');
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function imageResponseSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      originalFilename: { type: 'string' },
      mimeType: { type: 'string' },
      extension: { type: 'string' },
      sizeBytes: { type: 'integer' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      checksum: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      url: { type: 'string' },
    },
    required: [
      'id',
      'originalFilename',
      'mimeType',
      'extension',
      'sizeBytes',
      'width',
      'height',
      'checksum',
      'createdAt',
      'url',
    ],
  } as const;
}

function variantResponseSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      imageId: { type: 'string', format: 'uuid' },
      transformations: transformationBodySchema(),
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      checksum: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      url: { type: 'string' },
    },
    required: [
      'id',
      'imageId',
      'transformations',
      'mimeType',
      'sizeBytes',
      'width',
      'height',
      'checksum',
      'createdAt',
      'url',
    ],
  } as const;
}

function transformationBodySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      resize: {
        type: 'object',
        required: ['width', 'height'],
        properties: { width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'inside', 'outside'] } },
      },
      crop: {
        type: 'object',
        required: ['width', 'height'],
        properties: { width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } },
      },
      rotate: { type: 'integer', minimum: -360, maximum: 360 },
      flip: { type: 'boolean' },
      mirror: { type: 'boolean' },
      format: { type: 'string', enum: ['jpeg', 'png', 'webp'] },
      quality: { type: 'integer', minimum: 1, maximum: 100 },
      filters: { type: 'object', properties: { grayscale: { type: 'boolean' }, sepia: { type: 'boolean' } } },
      watermark: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, position: { type: 'string' }, opacity: { type: 'number' }, fontSize: { type: 'integer' } } },
    },
  } as const;
}

function errorResponseSchema() {
  return {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
        },
        required: ['code', 'message', 'requestId'],
      },
    },
    required: ['error'],
  } as const;
}
