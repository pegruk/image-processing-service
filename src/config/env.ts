import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('image-processing-service'),
  JWT_AUDIENCE: z.string().min(1).default('image-processing-client'),
  JWT_EXPIRES_IN: z.string().min(1).default('15m'),
  STORAGE_ROOT: z.string().min(1).default('./storage'),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_IMAGE_WIDTH: z.coerce.number().int().positive().default(10_000),
  MAX_IMAGE_HEIGHT: z.coerce.number().int().positive().default(10_000),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  DRIZZLE_MIGRATIONS_DIR: z.string().min(1).default('./drizzle'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
