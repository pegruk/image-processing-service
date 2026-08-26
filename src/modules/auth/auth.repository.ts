import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/database/client';
import { users, type NewUser, type User } from '../../infrastructure/database/schema';
import type { UserRepository } from './auth.types';

export class DrizzleUserRepository implements UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    return user ?? null;
  }

  async create(input: { username: string; passwordHash: string }): Promise<User> {
    const newUser: NewUser = {
      username: input.username,
      passwordHash: input.passwordHash,
    };

    const [user] = await db.insert(users).values(newUser).returning();

    if (!user) {
      throw new Error('The user was not returned after insertion.');
    }

    return user;
  }
}
