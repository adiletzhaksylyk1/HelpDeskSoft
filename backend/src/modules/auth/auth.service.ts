import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { UsersRepository } from "../users/users.repository.js";
import type { User } from "../../db/schema.js";
import { UnauthorizedError, ValidationError } from "../../shared/errors.js";
export interface AuthUserPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  sessionVersion: number;
  purpose: "access";
}
export type TokenSigner = (payload: AuthUserPayload) => string;
export interface LoginResult {
  token: string;
  user: AuthUserPayload;
}
export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly signToken: TokenSigner,
  ) {}
  async hashPassword(password: string): Promise<string> {
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
      throw new ValidationError(
        "Use at least 12 characters and at most 72 UTF-8 bytes",
      );
    return bcrypt.hash(password, 12);
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
      sessionVersion: user.sessionVersion,
      purpose: "access",
    };
  }
  async login(email: string, password?: string): Promise<LoginResult> {
    await this.usersRepo.checkLoginAttempt(email);
    const user = await this.usersRepo.findByEmail(email);
    // A valid cost-12 dummy hash keeps nonexistent/uninitialized accounts on the same expensive path.
    const hash =
      user?.passwordHash ||
      "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
    const valid = await bcrypt.compare(password || "", hash);
    if (
      !user?.isActive ||
      !user.passwordHash ||
      !password ||
      Buffer.byteLength(password) > 72 ||
      !valid
    ) {
      throw new UnauthorizedError(
        "Invalid email or password. Use your invitation for initial setup.",
      );
    }
    await this.usersRepo.clearLoginAttempts(email);
    const payload = this.toPayload(user);
    return { token: this.signToken(payload), user: payload };
  }
  async setupPassword(
    email: string,
    password: string,
    token?: string,
  ): Promise<LoginResult> {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedError("A valid invitation is required");
    const hash = await this.hashPassword(password);
    const user = await this.usersRepo.consumeInvitation(
      email,
      crypto.createHash("sha256").update(token).digest("hex"),
      hash,
    );
    if (!user)
      throw new UnauthorizedError(
        "Invitation expired, already used, or invalid",
      );
    const payload = this.toPayload(user);
    return { token: this.signToken(payload), user: payload };
  }
}
