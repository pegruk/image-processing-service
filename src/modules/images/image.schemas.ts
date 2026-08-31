import { z } from 'zod';

const positiveInteger = z.number().int().positive();

export const imageIdSchema = z.string().uuid('O identificador da imagem é inválido.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const resizeSchema = z
  .object({
    width: positiveInteger.max(10_000),
    height: positiveInteger.max(10_000),
    fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover'),
  })
  .strict();

const cropSchema = z
  .object({
    width: positiveInteger.max(10_000),
    height: positiveInteger.max(10_000),
    x: z.number().int().min(0).default(0),
    y: z.number().int().min(0).default(0),
  })
  .strict();

const filtersSchema = z
  .object({
    grayscale: z.boolean().default(false),
    sepia: z.boolean().default(false),
  })
  .strict();

const watermarkSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    position: z
      .enum(['northwest', 'north', 'northeast', 'west', 'center', 'east', 'southwest', 'south', 'southeast'])
      .default('southeast'),
    opacity: z.number().min(0.05).max(1).default(0.5),
    fontSize: positiveInteger.min(8).max(200).default(32),
  })
  .strict();

export const transformationsSchema = z
  .object({
    resize: resizeSchema.optional(),
    crop: cropSchema.optional(),
    rotate: z.number().int().min(-360).max(360).optional(),
    flip: z.boolean().optional(),
    mirror: z.boolean().optional(),
    format: z.enum(['jpeg', 'png', 'webp']).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    filters: filtersSchema.optional(),
    watermark: watermarkSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'É necessário informar ao menos uma transformação.',
  );

export type Transformations = z.infer<typeof transformationsSchema>;
