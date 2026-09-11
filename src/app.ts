import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync, FastifyPluginCallback } from 'fastify';
import type { FastifyJWTOptions } from '@fastify/jwt';
import { env } from './config/env';
import { DrizzleUserRepository } from './modules/auth/auth.repository';
import { authRoutes } from './modules/auth/auth.routes';
import type { UserRepository } from './modules/auth/auth.types';
import { healthRoutes } from './modules/health/health.routes';
import { imageRoutes } from './modules/images/image.routes';
import type { ImageRepository } from './modules/images/image.types';
import type { ObjectStorage } from './infrastructure/storage/storage.port';
import multipart from '@fastify/multipart';
import { registerErrorHandler } from './plugins/error-handler';

export interface BuildAppOptions {
  userRepository?: UserRepository;
  imageRepository?: ImageRepository;
  storage?: ObjectStorage;
}

const jwtPlugin: FastifyPluginCallback<FastifyJWTOptions> = require('@fastify/jwt') as FastifyPluginCallback<FastifyJWTOptions>;

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Image Processing Service API',
        description: 'API para upload, armazenamento e processamento de imagens.',
        version: '0.1.0',
      },
      servers: [{ url: env.API_BASE_URL ?? `http://localhost:${env.PORT}` }],
      tags: [
        { name: 'System', description: 'Operações de infraestrutura' },
        { name: 'Auth', description: 'Autenticação de usuários' },
        { name: 'Images', description: 'Gerenciamento e processamento de imagens' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transformObject(documentObject) {
      if (!('openapiObject' in documentObject)) return documentObject.swaggerObject;

      const document = documentObject.openapiObject as unknown as {
        paths?: Record<string, { post?: { requestBody?: unknown } }>;
      };
      const uploadOperation = document.paths?.['/images']?.post;

      if (uploadOperation) {
        uploadOperation.requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Imagem JPEG, PNG ou WebP.' },
                },
              },
            },
          },
        };
      }

      return documentObject.openapiObject;
    },
  });

  await app.register(jwtPlugin as unknown as FastifyPluginAsync<FastifyJWTOptions>, {
    secret: env.JWT_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: env.MAX_UPLOAD_SIZE_BYTES,
      parts: 1,
    },
  });

  registerErrorHandler(app);
  await app.register(authRoutes, {
    userRepository: options.userRepository ?? new DrizzleUserRepository(),
  });
  await app.register(imageRoutes, {
    ...(options.imageRepository ? { imageRepository: options.imageRepository } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
  });
  await app.register(healthRoutes);

  return app;
}
