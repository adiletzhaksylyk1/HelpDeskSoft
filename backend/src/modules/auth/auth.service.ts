import bcrypt from 'bcryptjs';
import type { UsersRepository } from '../users/users.repository.js';
import type { User } from '../../db/schema.js';
import { UnauthorizedError, ValidationError, ConflictError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export interface AuthUserPayload {
  id: string;
  email: string;
  name: string;
  role: string;
}

export type TokenSigner = (payload: AuthUserPayload) => string;

export interface LoginResult {
  token?: string;
  user?: AuthUserPayload;
  requiresPasswordSetup?: boolean;
  requiresPassword?: boolean;
  email?: string;
  name?: string;
}

export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly signToken: TokenSigner
  ) { }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  toPayload(user: User): AuthUserPayload {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  generateSetupToken(user: User | AuthUserPayload): string {
    return this.signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'setup_pending',
    });
  }

  async login(email: string, password?: string): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersRepo.findByEmail(normalizedEmail);

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account not found or inactive. Please contact administrator.');
    }

    // Account requires initial password creation
    if (!user.passwordHash) {
      const setupToken = this.generateSetupToken(user);
      if (!password) {
        return {
          requiresPasswordSetup: true,
          email: user.email,
          name: user.name,
          token: setupToken,
        };
      }

      if (password.length < 8) {
        throw new ValidationError('Password must be at least 8 characters long');
      }

      const hash = await this.hashPassword(password);
      await this.usersRepo.updatePassword(user.id, hash);
      const authUser = this.toPayload(user);
      const token = this.signToken(authUser);

      logger.info({ userId: user.id, email: user.email }, 'Initial password created and user authenticated');
      return { token, user: authUser };
    }

    // Account has existing password
    if (!password) {
      return {
        requiresPassword: true,
        email: user.email,
        name: user.name,
      };
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const authUser = this.toPayload(user);
    const token = this.signToken(authUser);

    logger.info({ userId: user.id, email: user.email }, 'User successfully authenticated');
    return { token, user: authUser };
  }

  async setupPassword(email: string, password: string): Promise<{ token: string; user: AuthUserPayload }> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersRepo.findByEmail(normalizedEmail);

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account not found or inactive. Please contact administrator.');
    }

    if (user.passwordHash) {
      throw new ConflictError('Password already configured for this account. Please log in with existing password.');
    }

    if (!password || password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    const hash = await this.hashPassword(password);
    await this.usersRepo.updatePassword(user.id, hash);
    const authUser = this.toPayload(user);
    const token = this.signToken(authUser);

    logger.info({ userId: user.id, email: user.email }, 'Password established via setup endpoint');
    return { token, user: authUser };
  }
}
