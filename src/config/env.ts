import 'dotenv/config';
import { z } from 'zod';

const insecureDevelopmentJwtSecret = 'change-this-secret-with-at-least-32-characters';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('image-processing-service'),
  JWT_AUDIENCE: z.string().min(1).default('image-processing-client'),
  JWT_EXPIRES_IN: z.string().min(1).default('15m'),
  API_BASE_URL: z.string().url().optional(),
  STORAGE_ROOT: z.string().min(1).default('./storage'),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_IMAGE_WIDTH: z.coerce.number().int().positive().default(10_000),
  MAX_IMAGE_HEIGHT: z.coerce.number().int().positive().default(10_000),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_STORAGE_BYTES_PER_USER: z.coerce.number().int().positive().default(500 * 1024 * 1024),
  MAX_CONCURRENT_TRANSFORMS: z.coerce.number().int().positive().default(2),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  TRANSFORM_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  DRIZZLE_MIGRATIONS_DIR: z.string().min(1).default('./drizzle'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.JWT_SECRET === insecureDevelopmentJwtSecret) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be replaced with a unique secret in production.',
    });
  }
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
