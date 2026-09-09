import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

const baseEnvironment = {
  DATABASE_URL: 'postgres://image_service:image_service@localhost:5432/image_service',
  JWT_SECRET: 'a-unique-test-secret-with-at-least-32-characters',
};

describe('environment configuration', () => {
  it('rejects the documented development JWT secret in production', () => {
    expect(() => envSchema.parse({
      ...baseEnvironment,
      NODE_ENV: 'production',
      JWT_SECRET: 'change-this-secret-with-at-least-32-characters',
    })).toThrow('JWT_SECRET must be replaced');
  });

  it('accepts a unique JWT secret in production', () => {
    expect(envSchema.parse({ ...baseEnvironment, NODE_ENV: 'production' }).JWT_SECRET).toBe(baseEnvironment.JWT_SECRET);
  });
});
