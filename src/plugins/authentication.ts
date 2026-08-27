import type { FastifyRequest } from 'fastify';
import { AppError } from '../shared/errors/app-error';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      username: string;
    };
    user: {
      sub: string;
      username: string;
    };
  }
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError('Token ausente ou inválido.', 'UNAUTHORIZED', 401);
  }
}
