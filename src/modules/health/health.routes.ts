import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../infrastructure/database/client';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Verifica a saúde da API e da conexão com o banco',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              database: { type: 'string', example: 'up' },
              timestamp: { type: 'string', format: 'date-time' },
            },
            required: ['status', 'database', 'timestamp'],
          },
        },
      },
    },
    async () => {
      await db.execute(sql`select 1`);

      return {
        status: 'ok',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    },
  );
};
