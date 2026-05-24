import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { createClient } from 'redis';
import { healthRoutes } from './routes/health';
import { streamRoutes } from './routes/streams';
import { playlistRoutes } from './routes/playlists';
import { authRoutes } from './routes/auth';

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: NODE_ENV === 'production' ? 'warn' : 'info',
      transport: NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    trustProxy: true,
    requestTimeout: 30_000,
  });

  // ── Redis ─────────────────────────────────────────────────
  const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
  redis.on('error', e => app.log.error({ msg: 'Redis error', err: e }));
  await redis.connect();
  app.decorate('redis', redis);

  // ── Plugins ───────────────────────────────────────────────
  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: (process.env.CORS_ORIGIN ?? '*').split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 200),
    timeWindow: Number(process.env.RATE_LIMIT_WINDOW ?? 60_000),
    redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Limite de requisições atingido. Tente em instantes.',
    }),
  });

  // ── Rotas ─────────────────────────────────────────────────
  await app.register(healthRoutes,  { prefix: '/api/v1/health' });
  await app.register(streamRoutes,  { prefix: '/api/v1/streams' });
  await app.register(playlistRoutes,{ prefix: '/api/v1/playlists' });
  await app.register(authRoutes,    { prefix: '/api/v1/auth' });

  // Health check raiz
  app.get('/', async () => ({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0' }));

  // 404
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'Not Found', statusCode: 404 });
  });

  // Error handler global
  app.setErrorHandler((err, req, reply) => {
    app.log.error({ err, url: req.url });
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: status >= 500 ? 'Internal Server Error' : err.message,
      statusCode: status,
      ...(NODE_ENV === 'development' && { stack: err.stack }),
    });
  });

  // ── Start ─────────────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`🚀 API Gateway running on port ${PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});

// TypeScript: extender Fastify com redis
declare module 'fastify' {
  interface FastifyInstance {
    redis: ReturnType<typeof createClient>;
  }
}
