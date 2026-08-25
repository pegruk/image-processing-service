import { z } from 'zod';

const username = z
  .string()
  .trim()
  .min(3, 'O username deve ter pelo menos 3 caracteres.')
  .max(50, 'O username deve ter no máximo 50 caracteres.')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'O username contém caracteres inválidos.')
  .transform((value) => value.toLowerCase());

const password = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(128, 'A senha deve ter no máximo 128 caracteres.');

export const registerSchema = z.object({
  username,
  password,
});

export const loginSchema = z.object({
  username,
  password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
