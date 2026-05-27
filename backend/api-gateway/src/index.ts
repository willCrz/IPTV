import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { createClient } from 'redis';
import { MemoryCache, type RedisLike } from './lib/redis';
import { healthRoutes } from './routes/health';
import { streamRoutes } from './routes/streams';
import { playlistRoutes } from './routes/playlists';
import { authRoutes } from './routes/auth';
import { monitorRoutes, startServerMonitor } from './routes/monitor';

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
    ignoreTrailingSlash: true,
  });

  // ── Redis (optional — falls back to in-memory cache) ──────
  let redis: RedisLike;
  const useRealRedis = Boolean(process.env.REDIS_URL);

  if (useRealRedis) {
    const realRedis = createClient({ url: process.env.REDIS_URL });
    realRedis.on('error', e => app.log.error({ msg: 'Redis error', err: e }));
    await realRedis.connect();
    redis = realRedis as unknown as RedisLike;
  } else {
    app.log.warn('REDIS_URL not set — using in-memory cache (data lost on restart)');
    redis = new MemoryCache();
  }
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
    ...(useRealRedis && { redis: redis as ReturnType<typeof createClient> }),
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
  await app.register(monitorRoutes, { prefix: '/api/v1/monitor' });

  app.get('/', async () => ({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0' }));

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'Not Found', statusCode: 404 });
  });

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

  startServerMonitor(
    Number(process.env.HEALTH_CHECK_INTERVAL ?? 30_000),
    Number(process.env.PING_TIMEOUT ?? 5_000),
  );

  const shutdown = async () => {
    await app.close();
    if (useRealRedis) await (redis as ReturnType<typeof createClient>).disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisLike;
  }
}
