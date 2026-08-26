import argon2 from 'argon2';
import { AppError } from '../../shared/errors/app-error';
import type { LoginInput, RegisterInput } from './auth.schemas';
import type { PublicUser, UserRepository } from './auth.types';
import { toPublicUser } from './auth.types';

export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const existingUser = await this.userRepository.findByUsername(input.username);

    if (existingUser) {
      throw new AppError('Username já está em uso.', 'USERNAME_ALREADY_EXISTS', 409);
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    try {
      const user = await this.userRepository.create({
        username: input.username,
        passwordHash,
      });

      return toPublicUser(user);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new AppError('Username já está em uso.', 'USERNAME_ALREADY_EXISTS', 409);
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<PublicUser> {
    const user = await this.userRepository.findByUsername(input.username);

    if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new AppError('Username ou senha inválidos.', 'INVALID_CREDENTIALS', 401);
    }

    return toPublicUser(user);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
