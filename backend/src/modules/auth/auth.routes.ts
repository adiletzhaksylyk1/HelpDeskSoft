import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { AuthService } from './auth.service.js';
import type { UsersRepository } from '../users/users.repository.js';
import { UnauthorizedError } from '../../shared/errors.js';

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().optional(),
});

const setupPasswordSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  token: z.string().optional(),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  usersRepo: UsersRepository,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
): void {
  // POST /api/auth/login — rate-limited to 10 attempts per 10 minutes per IP
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '10 minutes',
      },
    },
  }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.email, body.password);
    return reply.status(200).send(result);
  });

  // POST /api/auth/setup-password
  app.post('/setup-password', async (req, reply) => {
    const body = setupPasswordSchema.parse(req.body);

    let setupToken = body.token;
    if (!setupToken && req.headers.authorization?.startsWith('Bearer ')) {
      setupToken = req.headers.authorization.slice(7);
    }

    if (setupToken) {
      try {
        const decoded = app.jwt.verify<{ email?: string; id?: string; role?: string }>(setupToken);
        if (decoded.email && decoded.email.toLowerCase() !== body.email.toLowerCase().trim()) {
          throw new UnauthorizedError('Setup token does not match the specified email address');
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedError) throw err;
        throw new UnauthorizedError('Invalid or expired password setup token');
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Identity verification or setup token is required to establish account password');
    }

    const result = await authService.setupPassword(body.email, body.password);
    return reply.status(200).send(result);
  });

  // GET /api/auth/me
  app.get('/me', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    const payload = req.user as { id: string; email: string; role: string; name: string };
    const user = await usersRepo.findById(payload.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account not found or disabled');
    }

    return reply.status(200).send({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  });

  done();
}
