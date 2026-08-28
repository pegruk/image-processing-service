import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { authenticate } from '../../plugins/authentication';
import { AuthService } from './auth.service';
import { loginSchema, registerSchema } from './auth.schemas';
import { DrizzleUserRepository } from './auth.repository';
import type { UserRepository } from './auth.types';

export interface AuthRoutesOptions {
  userRepository?: UserRepository;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const userRepository = options.userRepository ?? new DrizzleUserRepository();
  const authService = new AuthService(userRepository);

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Cadastra um usuário',
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 50 },
            password: { type: 'string', minLength: 8, maxLength: 128, format: 'password' },
          },
        },
        response: {
          201: authResponseSchema(),
          400: errorResponseSchema(),
          409: errorResponseSchema(),
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(registerSchema, request.body);
      const user = await authService.register(input);
      const token = app.jwt.sign({ sub: user.id, username: user.username });

      return reply.status(201).send({ user, token });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Autentica um usuário',
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string', format: 'password' },
          },
        },
        response: {
          200: authResponseSchema(),
          400: errorResponseSchema(),
          401: errorResponseSchema(),
        },
      },
    },
    async (request) => {
      const input = parseBody(loginSchema, request.body);
      const user = await authService.login(input);
      const token = app.jwt.sign({ sub: user.id, username: user.username });

      return { user, token };
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: authenticate,
      schema: {
        tags: ['Auth'],
        summary: 'Retorna os dados do usuário autenticado',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              username: { type: 'string' },
            },
            required: ['id', 'username'],
          },
          401: errorResponseSchema(),
        },
      },
    },
    async (request) => ({
      id: request.user.sub,
      username: request.user.username,
    }),
  );
};

function parseBody<T>(schema: { parse: (value: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new AppError('A requisição contém dados inválidos.', 'VALIDATION_ERROR', 400, {
        cause: error,
      });
    }

    throw error;
  }
}

function authResponseSchema() {
  return {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'username', 'createdAt', 'updatedAt'],
      },
      token: { type: 'string' },
    },
    required: ['user', 'token'],
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
