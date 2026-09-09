import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('application foundation', () => {
  it('exposes the OpenAPI documentation', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/docs',
    });

    expect(response.statusCode).toBe(200);

    const specification = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(specification.json().paths['/images'].post.requestBody).toMatchObject({
      required: true,
      content: {
        'multipart/form-data': {
          schema: { required: ['file'] },
        },
      },
    });
    await app.close();
  });

  it('returns a consistent 404 for unknown routes', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Rota não encontrada.',
      },
    });
    await app.close();
  });
});
