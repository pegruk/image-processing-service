import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';
import { env } from '../../config/env';

async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: env.DRIZZLE_MIGRATIONS_DIR });
  await pool.end();
}

runMigrations().catch(async (error: unknown) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
