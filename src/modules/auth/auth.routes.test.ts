import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import type { User, NewUser } from '../../infrastructure/database/schema';
import type { UserRepository } from './auth.types';

class InMemoryUserRepository implements UserRepository {
  private readonly users: User[] = [];

  async findByUsername(username: string): Promise<User | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async create(input: NewUser): Promise<User> {
    const user: User = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.push(user);
    return user;
  }
}

describe('authentication routes', () => {
  it('registers and authenticates a user', async () => {
    const app = await buildApp({ userRepository: new InMemoryUserRepository() });

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: '  User.One ',
        password: 'password123',
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    expect(registerResponse.json()).toMatchObject({
      user: {
        username: 'user.one',
      },
    });
    expect(registerResponse.json().user.passwordHash).toBeUndefined();
    expect(registerResponse.json().token).toEqual(expect.any(String));

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'USER.ONE',
        password: 'password123',
      },
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json().token).toEqual(expect.any(String));

    await app.close();
  });

  it('rejects invalid credentials without revealing which field failed', async () => {
    const app = await buildApp({ userRepository: new InMemoryUserRepository() });

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'user1',
        password: 'password123',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'user1',
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Username ou senha inválidos.',
      },
    });

    await app.close();
  });

  it('protects the current-user endpoint with JWT', async () => {
    const app = await buildApp({ userRepository: new InMemoryUserRepository() });

    const unauthorizedResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });

    expect(unauthorizedResponse.statusCode).toBe(401);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'user2',
        password: 'password123',
      },
    });

    const { token, user } = registerResponse.json();
    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toEqual({
      id: user.id,
      username: 'user2',
    });

    await app.close();
  });

  it('validates credentials and rejects duplicate usernames', async () => {
    const app = await buildApp({ userRepository: new InMemoryUserRepository() });

    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'x',
        password: 'short',
      },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const validPayload = {
      username: 'duplicate-user',
      password: 'password123',
    };

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: validPayload,
        })
      ).statusCode,
    ).toBe(201);

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: validPayload,
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toMatchObject({
      error: { code: 'USERNAME_ALREADY_EXISTS' },
    });

    await app.close();
  });
});
