import type { User } from '../../infrastructure/database/schema';

export type PublicUser = Pick<User, 'id' | 'username' | 'createdAt' | 'updatedAt'>;

export interface UserRepository {
  findByUsername(username: string): Promise<User | null>;
  create(input: { username: string; passwordHash: string }): Promise<User>;
}

export interface AuthenticatedUser {
  sub: string;
  username: string;
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
