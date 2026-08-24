import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/app-error';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const validation = error instanceof Error && 'validation' in error ? error.validation : undefined;

    if (validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A requisição contém dados inválidos.',
          requestId: request.id,
        },
      });
    }

    if (error instanceof AppError) {
      const response: {
        error: {
          code: string;
          message: string;
          requestId: string;
          details?: unknown;
        };
      } = {
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      };

      return reply.status(error.statusCode).send(response);
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A requisição contém dados inválidos.',
          requestId: request.id,
        },
      });
    }

    if (isClientRequestError(error)) {
      const statusCode = error.statusCode;
      const code = statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST';
      const message = statusCode === 413
        ? 'O payload excede o limite permitido.'
        : statusCode === 415
          ? 'O tipo de conteúdo da requisição não é suportado.'
          : 'A requisição multipart é inválida.';

      return reply.status(statusCode).send({
        error: {
          code,
          message,
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocorreu um erro interno.',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Rota não encontrada.',
        requestId: request.id,
      },
    });
  });
}

function isClientRequestError(error: unknown): error is { statusCode: 400 | 413 | 415 } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415)
  );
}
