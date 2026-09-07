import { buildApp } from './app';
import { env } from './config/env';
import { pool } from './infrastructure/database/client';

async function start(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down server');
    await app.close();
    await pool.end();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
